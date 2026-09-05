/* ============================================================================
   Reseller program — earn margin on every bundle sold through your store.

   Flow:
   1. Customer opens a store → picks name, slug, markup %
   2. Gets a link: valmontdata.com/s/{slug}
   3. Customers buy through that link → order tagged with reseller_id
   4. On delivery, reseller earns (sell_price × markup%)
   5. Earnings tracked in reseller_earnings ledger
   6. Payout to reseller's MoMo number when they request it

   Functions:
     createStore(customerId, data) — open a new store
     updateStore(customerId, data) — update name/tagline/markup
     getStoreBySlug(slug) — public store data (safe columns only)
     getStoreForCustomer(customerId) — full store data for the owner
     getEarnings(resellerId) — earnings ledger + balance
     requestPayout(resellerId, amount) — request payout to MoMo
   ============================================================================ */

const { db } = require("./supabase");

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/* Open a new reseller store */
async function createStore(customerId, { store_name, slug, tagline, markup_percent, momo_number }) {
  if (!store_name || !store_name.trim()) {
    return { ok: false, error: "Store name is required" };
  }

  const generatedSlug = slug ? slugify(slug) : slugify(store_name);
  if (generatedSlug.length < 3) {
    return { ok: false, error: "Slug must be at least 3 characters" };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(generatedSlug)) {
    return { ok: false, error: "Slug can only contain letters, numbers, and hyphens" };
  }

  const markup = Math.max(0, Math.min(100, Number(markup_percent) || 10));

  // Check for existing store
  const existing = await db.select({ from: "resellers", where: { customer_id: `eq.${customerId}` } });
  if (existing.length) {
    return { ok: false, error: "You already have a store", store: existing[0] };
  }

  try {
    const rows = await db.insert("resellers", {
      customer_id: customerId,
      store_name: store_name.trim(),
      slug: generatedSlug,
      tagline: (tagline || "").trim() || null,
      markup_percent: markup,
      status: "active",
      momo_number: momo_number || null,
    });
    return { ok: true, store: rows[0] };
  } catch (e) {
    if (e.status === 409) {
      if (e.message.includes("slug")) return { ok: false, error: "That store URL is already taken — try another" };
      return { ok: false, error: "You already have a store" };
    }
    throw e;
  }
}

/* Update store settings */
async function updateStore(customerId, { store_name, tagline, markup_percent, momo_number, status }) {
  const existing = await db.select({ from: "resellers", where: { customer_id: `eq.${customerId}` } });
  if (!existing.length) return { ok: false, error: "No store found" };

  const updates = {};
  if (store_name) updates.store_name = store_name.trim();
  if (tagline !== undefined) updates.tagline = tagline.trim() || null;
  if (markup_percent !== undefined) updates.markup_percent = Math.max(0, Math.min(100, Number(markup_percent) || 10));
  if (momo_number !== undefined) updates.momo_number = momo_number || null;
  if (status) updates.status = status;
  updates.updated_at = new Date().toISOString();

  if (!Object.keys(updates).length) return { ok: false, error: "Nothing to update" };

  const rows = await db.update("resellers", updates, { customer_id: `eq.${customerId}` });
  return { ok: true, store: rows[0] };
}

/* Get public store data (safe columns — no earnings details) */
async function getStoreBySlug(slug) {
  const rows = await db.select({ from: "resellers", where: { slug: `eq.${slug}`, status: "eq.active" } });
  if (!rows.length) return null;
  const store = rows[0];

  // Get the store owner's name
  const customers = await db.select({ from: "customers", where: { id: `eq.${store.customer_id}` } });
  const ownerName = customers[0]?.name || store.store_name;

  return {
    id: store.id,
    store_name: store.store_name,
    slug: store.slug,
    tagline: store.tagline,
    markup_percent: Number(store.markup_percent),
    owner_name: ownerName.split(" ")[0],
    total_orders: store.total_orders,
    created_at: store.created_at,
  };
}

/* Get full store data for the owner */
async function getStoreForCustomer(customerId) {
  const rows = await db.select({ from: "resellers", where: { customer_id: `eq.${customerId}` } });
  if (!rows.length) return null;
  const store = rows[0];

  const balance = Number(await db.rpc("current_reseller_balance", { p_reseller_id: store.id }) || 0);

  return {
    ...store,
    markup_percent: Number(store.markup_percent),
    total_revenue: Number(store.total_revenue),
    total_earnings: Number(store.total_earnings),
    balance,
    store_url: `${(process.env.SITE_URL || "https://valmontdata.com").replace(/\/$/, "")}/s/${store.slug}`,
  };
}

/* Get earnings ledger */
async function getEarnings(resellerId, limit = 50) {
  const rows = await db.select({
    from: "reseller_earnings",
    where: { reseller_id: `eq.${resellerId}` },
    order: "id.desc",
    limit,
  });
  const balance = Number(await db.rpc("current_reseller_balance", { p_reseller_id: resellerId }) || 0);
  return {
    balance,
    entries: rows.map((e) => ({
      id: e.id,
      direction: e.direction,
      amount: Number(e.amount),
      balance_after: Number(e.balance_after),
      note: e.note,
      created_at: e.created_at,
    })),
  };
}

/* Get reseller's recent orders (through their store) */
async function getStoreOrders(resellerId, limit = 20) {
  const rows = await db.select({
    from: "orders",
    where: { reseller_id: `eq.${resellerId}` },
    order: "created_at.desc",
    limit,
  });
  return rows.map((o) => ({
    reference: o.reference,
    phone: o.phone,
    amount: Number(o.amount),
    status: o.status,
    created_at: o.created_at,
    delivered_at: o.delivered_at,
  }));
}

/* Slugs of every active store, most recently updated first.
   Feeds /sitemap-stores.xml so reseller storefronts are discoverable by search
   engines without being enumerable from the static sitemap (they are created at
   runtime, by customers, so no build step can know them).
   Only the slug and its timestamp leave this function — never the store name,
   the owner, the markup or the earnings. The projection is done here in JS on
   purpose: the mock data layer returns whole rows, and this list is public. */
async function listActiveStores(limit = 5000) {
  const rows = await db.select({
    from: "resellers",
    where: { status: "eq.active" },
    select: "slug,updated_at",
    order: "updated_at.desc",
    limit,
  });
  return (rows || [])
    .filter((r) => r && r.slug)
    .map((r) => ({ slug: String(r.slug), updated_at: r.updated_at || null }))
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

/* Check if slug is available */
async function isSlugAvailable(slug) {
  const rows = await db.select({ from: "resellers", where: { slug: `eq.${slug}` } });
  return !rows.length;
}

module.exports = {
  slugify,
  createStore,
  updateStore,
  getStoreBySlug,
  getStoreForCustomer,
  getEarnings,
  getStoreOrders,
  isSlugAvailable,
  listActiveStores,
};
