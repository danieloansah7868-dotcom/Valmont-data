/* ============================================================================
   lib/reviews.js — verified-purchase product reviews.

   The whole point of this module is that a rating on this site is a *fact*
   somebody can be asked about: every review is tied to a delivered order for
   that exact bundle, placed by that customer account. That is what makes it
   safe to render the numbers on a public landing page and to emit
   AggregateRating/Review schema for them — the schema can only ever describe
   reviews that exist and are visible.

   Rules enforced here (and by the table's constraints):
     • verified purchase only — a delivered order for THIS bundle, by THIS account
     • one review per customer per bundle (posting again edits it)
     • rating 1..5; title ≤ 80 chars; body ≤ 600 chars
     • never publish a phone number, email or full name — first name only
     • removal is a status change, not a DELETE (the audit trail survives)
     • aggregates are computed from published rows only

   Nothing in here invents a number: if a bundle has no reviews, the summary is
   {count: 0, average: 0} and the caller must not emit any rating schema.
   ============================================================================ */

const { db } = require("./supabase");
const { sizeSlug } = require("./keywords");
const { siteOrigin } = require("./runtime");

const MAX_TITLE = 80;
const MAX_BODY = 600;
const NETWORK_CODES = ["mtn", "telecel", "airteltigo"];

/** The canonical review entry route. Keep this tied to keywords.sizeSlug() so
    email/SMS/History links cannot drift from generated bundle URL conventions. */
function reviewPath(network, sizeMb) {
  const code = String(network || "").trim().toLowerCase();
  const size = Number(sizeMb);
  if (!NETWORK_CODES.includes(code) || !Number.isFinite(size) || size <= 0) return null;
  const slug = sizeSlug(size);
  if (!/^[0-9]+(?:-[0-9]+)?(?:mb|gb)$/.test(slug)) return null;
  return `/rev/${code}/${slug}`;
}

function reviewUrl(network, sizeMb) {
  const path = reviewPath(network, sizeMb);
  return path ? `${siteOrigin()}${path}` : null;
}

/* Reviews are public and get indexed, so a phone number typed into one would be
   published forever. Ghana mobile numbers are 10 digits starting with 0 — they
   are scrubbed at write time (not on the way out, so the stored row is already
   clean and nothing downstream has to remember to filter). */
const GH_NUMBER = /\b0\d{9}\b/g;
function scrub(text) {
  return String(text == null ? "" : text).replace(GH_NUMBER, "[number removed]");
}

/* -------------------------------------------------------------------------- */
/* lookups                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * (network code, size_mb) → the live bundle row. The catalogue is addressed by
 * network+size everywhere on the site (that is what the URLs are built from),
 * while orders reference bundle_id, so this is the bridge.
 * @returns {Promise<{id:number, network_id:number, code:string, size_mb:number}|null>}
 */
async function resolveBundle(network, size_mb) {
  const code = String(network || "").toLowerCase().trim();
  const size = Number(size_mb);
  if (!NETWORK_CODES.includes(code) || !isFinite(size) || size <= 0) return null;

  const networks = await db.select({ from: "networks", where: { code: `eq.${code}` } });
  if (!networks.length) return null;

  const bundles = await db.select({
    from: "bundles",
    where: { network_id: `eq.${networks[0].id}`, size_mb: `eq.${size}`, is_active: "eq.true" },
  });
  const b = bundles.find((x) => Number(x.size_mb) === size);
  if (!b) return null;

  return { id: b.id, network_id: networks[0].id, code, size_mb: size };
}

/** The delivered order that makes this customer a verified buyer of this bundle. */
async function findVerifiedOrder(customerId, bundle) {
  const rows = await db.select({
    from: "orders",
    where: { customer_id: `eq.${customerId}`, bundle_id: `eq.${bundle.id}`, status: "eq.delivered" },
    order: "delivered_at.desc",
    limit: 1,
  });
  return rows && rows.length ? rows[0] : null;
}

/** This customer's existing review of this bundle, if any (any status). */
async function findOwnReview(customerId, bundle) {
  const rows = await db.select({
    from: "product_reviews",
    where: { customer_id: `eq.${customerId}`, bundle_id: `eq.${bundle.id}` },
    limit: 1,
  });
  return rows && rows.length ? rows[0] : null;
}

/**
 * First names of the reviewers, keyed by customer id — one query for the whole
 * page, and nothing but the first name leaves this function.
 */
async function firstNames(customerIds) {
  const ids = [...new Set((customerIds || []).map(Number).filter((n) => n > 0))];
  const out = {};
  for (const id of ids) out[id] = "Valmont customer";
  if (!ids.length) return out;
  const rows = await db.select({ from: "customers", where: { id: `in.(${ids.join(",")})` } });
  for (const r of rows || []) {
    const name = String(r.name || "").trim();
    out[Number(r.id)] = name ? name.split(/\s+/)[0] : "Valmont customer";
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* public read                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Published reviews + the aggregate for one bundle.
 * `summary` is the only thing callers may turn into rating schema, and only when
 * `summary.count > 0`.
 */
async function listForBundle(network, size_mb, opts) {
  const limit = Math.min(Math.max(Number((opts && opts.limit) || 20), 1), 100);
  const bundle = await resolveBundle(network, size_mb);
  if (!bundle) return { bundle: null, reviews: [], summary: emptySummary() };

  const rows = await db.select({
    from: "product_reviews",
    // Keep the explicit provenance guard in the public read as well as in the
    // write path. A row that an admin has hidden must never surface if its
    // status was independently altered outside this API.
    where: { bundle_id: `eq.${bundle.id}`, status: "eq.published", hidden_by_admin: "eq.false" },
    order: "created_at.desc",
    limit,
  });
  const list = rows || [];
  const names = await firstNames(list.map((r) => r.customer_id));

  const reviews = list.map((r) => ({
    id: r.id,
    rating: Number(r.rating),
    title: r.title ? String(r.title).trim() : "",
    body: r.body ? String(r.body).trim() : "",
    author: names[r.customer_id] || "Valmont customer",
    verified: true, // structurally true: the row cannot exist without a delivered order
    order_reference: r.order_reference || null,
    created_at: r.created_at || null,
  }));

  return { bundle: { network: bundle.code, size_mb: bundle.size_mb }, reviews, summary: summarise(reviews) };
}

function emptySummary() {
  return { count: 0, average: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
}

/**
 * Aggregate over the reviews we are actually showing. Rounded to 2dp for the
 * schema's `ratingValue` and to 1dp for display, from the same numbers.
 */
function summarise(reviews) {
  const s = emptySummary();
  if (!reviews.length) return s;
  let total = 0;
  for (const r of reviews) {
    const n = Number(r.rating);
    if (!(n >= 1 && n <= 5)) continue;
    total += n;
    s.histogram[n] = (s.histogram[n] || 0) + 1;
    s.count++;
  }
  s.average = s.count ? Math.round((total / s.count) * 100) / 100 : 0;
  return s;
}

/* -------------------------------------------------------------------------- */
/* write                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Create or update a review. Verified purchases only.
 * @returns {Promise<{ok:true, review:object, created:boolean}|{ok:false, error:string, status?:number}>}
 */
async function upsertReview(customerId, input) {
  const bundle = await resolveBundle(input && input.network, input && input.size_mb);
  if (!bundle) return { ok: false, status: 404, error: "We do not sell that bundle" };

  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, status: 400, error: "Rating must be a whole number from 1 to 5" };
  }

  // scrub first, then cap: the widget enforces maxlength, this is the safety net
  const title = scrub(String(input.title == null ? "" : input.title).trim()).slice(0, MAX_TITLE);
  const body = scrub(String(input.body == null ? "" : input.body).trim()).slice(0, MAX_BODY);

  const order = await findVerifiedOrder(customerId, bundle);
  if (!order) {
    return {
      ok: false,
      status: 403,
      error: "Reviews are for verified purchases only — buy this bundle and once it delivers you can review it here",
    };
  }

  const existing = await findOwnReview(customerId, bundle);
  if (existing && existing.hidden_by_admin) {
    return {
      ok: false,
      status: 403,
      error: "This review is hidden by an administrator and cannot be republished or changed from your account.",
    };
  }

  const fields = {
    bundle_id: bundle.id,
    network_id: bundle.network_id,
    size_mb: bundle.size_mb,
    customer_id: customerId,
    order_id: order.id,
    order_reference: order.reference || null,
    rating,
    title: title || null,
    body: body || null,
    // An author can republish a review they personally retracted, but cannot
    // override the separate hidden_by_admin guard above.
    status: "published",
    hidden_by_admin: false,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Make the admin-hidden guard part of the write itself, not just the
    // earlier read. That closes the hide-vs-author-update race across two
    // serverless instances: once moderation wins, an author update cannot turn
    // the row back into a published review.
    const updated = await db.update("product_reviews", fields, {
      id: `eq.${existing.id}`,
      hidden_by_admin: "eq.false",
    });
    if (!updated.length) {
      return {
        ok: false,
        status: 403,
        error: "This review is hidden by an administrator and cannot be republished or changed from your account.",
      };
    }
    return { ok: true, created: false, review: publicShape(updated[0]) };
  }

  const inserted = await db.insert("product_reviews", fields);
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  return { ok: true, created: true, review: publicShape(row || fields) };
}

/** Can this customer review this bundle right now? Used to show or hide the form. */
async function canReview(customerId, network, size_mb) {
  const bundle = await resolveBundle(network, size_mb);
  if (!bundle) return { ok: false, reason: "unknown-bundle" };
  const order = await findVerifiedOrder(customerId, bundle);
  if (!order) return { ok: false, reason: "no-delivered-order" };
  const existing = await findOwnReview(customerId, bundle);
  if (existing && existing.hidden_by_admin) {
    return {
      ok: false,
      reason: "hidden-by-admin",
      order_reference: order.reference || null,
      already_reviewed: true,
    };
  }
  return { ok: true, order_reference: order.reference || null, already_reviewed: Boolean(existing) };
}

/** Your own review of this bundle (any status), for pre-filling the edit form. */
async function myReview(customerId, network, size_mb) {
  const bundle = await resolveBundle(network, size_mb);
  if (!bundle) return null;
  const row = await findOwnReview(customerId, bundle);
  return row ? publicShape(row) : null;
}

/**
 * Hide your own review (an author may retract). Anything that is not yours → 403;
 * admins use removeReview() instead. Never a row delete, so the review, its
 * author and the order that verified it all stay on file.
 */
async function removeOwnReview(customerId, reviewId) {
  const rows = await db.select({ from: "product_reviews", where: { id: `eq.${reviewId}` }, limit: 1 });
  if (!rows.length) return { ok: false, status: 404, error: "No such review" };
  if (Number(rows[0].customer_id) !== Number(customerId)) {
    return { ok: false, status: 403, error: "That is not your review" };
  }
  if (rows[0].hidden_by_admin) {
    return { ok: false, status: 403, error: "This review is currently hidden by an administrator." };
  }
  await db.update("product_reviews", { status: "removed", updated_at: new Date().toISOString() }, { id: `eq.${reviewId}` });
  return { ok: true, id: Number(reviewId) };
}

/**
 * Admin-only moderation. Status is intentionally the only customer-visible
 * state that changes: the original row, author/order link and timestamps stay
 * in place. hidden_by_admin blocks the author update path until an admin
 * explicitly publishes the row again.
 */
async function moderateReview(reviewId, nextStatus, actor = "administrator") {
  const status = String(nextStatus || "").toLowerCase();
  if (!["published", "removed"].includes(status)) {
    return { ok: false, status: 400, error: "Status must be published or removed" };
  }
  const rows = await db.select({ from: "product_reviews", where: { id: `eq.${reviewId}` }, limit: 1 });
  if (!rows.length) return { ok: false, status: 404, error: "No such review" };
  const now = new Date().toISOString();
  const moderator = String(actor || "administrator").slice(0, 80);
  const existingHistory = Array.isArray(rows[0].moderation_history) ? rows[0].moderation_history : [];
  // Keep prior hide/unhide events even after the visible status changes. The
  // bounded array protects a single review from an unbounded JSONB row.
  const moderation_history = [
    ...existingHistory.slice(-49),
    { action: status === "removed" ? "hide" : "unhide", at: now, by: moderator },
  ];
  const fields = {
    status,
    hidden_by_admin: status === "removed",
    moderated_at: now,
    moderated_by: moderator,
    moderation_history,
    updated_at: now,
  };
  if (status === "removed") fields.admin_hidden_at = now;
  else fields.admin_unhidden_at = now;
  await db.update("product_reviews", fields, { id: `eq.${reviewId}` });
  return { ok: true, id: Number(reviewId), status, hidden_by_admin: fields.hidden_by_admin, moderation_history };
}

/** Backward-compatible helper for the existing DELETE admin route. */
async function removeReview(reviewId) {
  return moderateReview(reviewId, "removed");
}

/**
 * Internal moderation queue. It returns only admin-appropriate first-name and
 * order verification data; no phone/email data is exposed through this route.
 */
async function listForAdmin({ network, status, limit } = {}) {
  const code = String(network || "all").trim().toLowerCase();
  const requestedStatus = String(status || "all").trim().toLowerCase();
  if (code !== "all" && !NETWORK_CODES.includes(code)) {
    return { ok: false, status: 400, error: "Unknown network" };
  }
  if (requestedStatus !== "all" && !['published', 'removed'].includes(requestedStatus)) {
    return { ok: false, status: 400, error: "Unknown review status" };
  }

  const where = {};
  if (code !== "all") {
    const networks = await db.select({ from: "networks", where: { code: `eq.${code}` }, limit: 1 });
    if (!networks.length) return { ok: true, reviews: [] };
    where.network_id = `eq.${networks[0].id}`;
  }
  if (requestedStatus !== "all") where.status = `eq.${requestedStatus}`;
  const rows = await db.select({
    from: "product_reviews",
    where,
    order: "created_at.desc",
    limit: Math.min(Math.max(Number(limit || 100), 1), 200),
  });
  const ids = [...new Set(rows.map((r) => Number(r.order_id)).filter((id) => id > 0))];
  const linkedOrders = ids.length
    ? await db.select({ from: "orders", where: { id: `in.(${ids.join(",")})` } })
    : [];
  const orderById = new Map(linkedOrders.map((o) => [Number(o.id), o]));
  const names = await firstNames(rows.map((r) => r.customer_id));
  const networks = await db.select({ from: "networks" });

  return {
    ok: true,
    reviews: rows.map((r) => {
      const order = orderById.get(Number(r.order_id));
      let verification = { valid: false, reason: "linked order is missing" };
      if (order) {
        const exact = Number(order.customer_id) === Number(r.customer_id)
          && Number(order.bundle_id) === Number(r.bundle_id)
          && order.status === "delivered"
          && (!r.order_reference || r.order_reference === order.reference);
        verification = {
          valid: exact,
          reason: exact
            ? "delivered order matches review"
            : order.status !== "delivered"
              ? `linked order status is ${order.status}`
              : "linked order does not match the review record",
          reference: order.reference || r.order_reference || null,
          order_status: order.status || null,
        };
      }
      const net = networks.find((n) => Number(n.id) === Number(r.network_id));
      return {
        id: r.id,
        network: net?.code || null,
        size_mb: Number(r.size_mb),
        rating: Number(r.rating),
        title: r.title ? String(r.title).trim() : "",
        body: r.body ? String(r.body).trim() : "",
        author: names[Number(r.customer_id)] || "Valmont customer",
        order_reference: r.order_reference || order?.reference || null,
        order_verification: verification,
        status: r.status,
        hidden_by_admin: Boolean(r.hidden_by_admin),
        created_at: r.created_at || null,
        updated_at: r.updated_at || null,
        admin_hidden_at: r.admin_hidden_at || null,
        admin_unhidden_at: r.admin_unhidden_at || null,
        moderated_at: r.moderated_at || null,
        moderated_by: r.moderated_by || null,
        moderation_history: Array.isArray(r.moderation_history) ? r.moderation_history : [],
      };
    }),
  };
}

function publicShape(r) {
  return {
    id: r.id,
    rating: Number(r.rating),
    title: r.title ? String(r.title).trim() : "",
    body: r.body ? String(r.body).trim() : "",
    order_reference: r.order_reference || null,
    verified: true,
    created_at: r.created_at || null,
  };
}

module.exports = {
  MAX_TITLE,
  MAX_BODY,
  resolveBundle,
  listForBundle,
  upsertReview,
  canReview,
  myReview,
  removeOwnReview,
  removeReview,
  moderateReview,
  listForAdmin,
  reviewPath,
  reviewUrl,
  scrub,
  summarise,
};
