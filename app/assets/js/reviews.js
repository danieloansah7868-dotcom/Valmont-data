/* ============================================================================
   Verified-purchase reviews — /bundles/<network>/<size>.html

   Reads GET /api/reviews?network=<code>&size_mb=<mb> and renders:
     · the aggregate ("Rated 4.6 out of 5 · 12 verified reviews") + histogram
     · the reviews themselves, each marked "Verified buyer"
     · the write/edit form — only for a signed-in customer the API confirms has
       had THAT bundle delivered. Everyone else gets the reason, not the form.

   Structured data: when (and only when) the API returns at least one published
   review, `aggregateRating` and `review[]` are added to the Product node that
   is already in the page's JSON-LD. They are built from the very same response
   that produced the visible list, so the schema can never claim a rating, a
   count or a review that the reader cannot see. When there are no reviews, no
   rating schema is emitted at all — a product with no reviews must not show
   stars, and must not tell Google it has them.

   Nothing here is fabricated: no seeded reviews, no placeholder stars, no
   "4.9 from 2,000 customers" until 2,000 customers have actually said so.

   Zero dependencies, plain DOM, works with `defer`.
   ========================================================================== */

(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const token = () =>
    localStorage.getItem("vd_token") || localStorage.getItem("vd_customer_token");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function stars(n) {
    const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return '<span class="rv-stars" role="img" aria-label="' + v + ' out of 5">' +
      "★★★★★".slice(0, v) + '<span class="rv-stars-off">' + "★★★★★".slice(0, 5 - v) + "</span></span>";
  }

  function when(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
  }

  /* One decimal for display, exactly as the schema reports it (rounded to 2dp
     server-side; a whole number like 5 shows as 5.0 here, not 5). */
  const avg = (n) => Number(n || 0).toFixed(1);

  async function api(path, opts) {
    const headers = Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {});
    const t = token();
    if (t) headers.Authorization = "Bearer " + t;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, ok: res.ok, data: data || {} };
  }

  /* ------------------------------------------------------------------ */
  /* structured data                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Add the rating to the Product node already in the page — never a second
   * Product node, and never when there is nothing to rate.
   * @returns {boolean} whether a Product node was found and updated
   */
  function syncSchema(data) {
    const hasReviews = data && data.summary && Number(data.summary.count) > 0 && data.reviews.length > 0;
    const blocks = $$('script[type="application/ld+json"]');
    let touched = false;

    for (const block of blocks) {
      let parsed;
      try { parsed = JSON.parse(block.textContent); } catch { continue; }
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const product = nodes.find((n) => n && n["@type"] === "Product");
      if (!product) continue;

      if (!hasReviews) {
        // No reviews → no rating. Removing the keys keeps an earlier injection
        // from outliving the data (e.g. after an admin hides the last review).
        delete product.aggregateRating;
        delete product.review;
      } else {
        product.aggregateRating = {
          "@type": "AggregateRating",
          ratingValue: String(data.summary.average),
          reviewCount: Number(data.summary.count),
          bestRating: "5",
          worstRating: "1",
        };
        product.review = data.reviews.map((r) => {
          const node = {
            "@type": "Review",
            author: { "@type": "Person", name: r.author },
            reviewRating: { "@type": "Rating", ratingValue: String(r.rating), bestRating: "5", worstRating: "1" },
          };
          const text = String(r.body || r.title || "").trim();
          if (text) node.reviewBody = text;
          if (r.title) node.name = r.title;
          const day = when(r.created_at);
          if (day) node.datePublished = String(r.created_at).slice(0, 10);
          return node;
        });
      }

      block.textContent = JSON.stringify(parsed, null, 2);
      touched = true;
    }
    return touched;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */

  function summaryHtml(data, label) {
    const s = data.summary;
    if (!s.count) {
      return (
        '<p class="rv-none">No verified reviews for ' + esc(label) + " yet. The form opens for a customer once their order for this bundle shows as delivered — every rating here comes from a purchase we delivered.</p>"
      );
    }
    const rows = [5, 4, 3, 2, 1]
      .map((n) => {
        const c = Number((s.histogram && s.histogram[n]) || 0);
        const pct = s.count ? Math.round((c / s.count) * 100) : 0;
        return (
          '<div class="rv-bar"><span class="rv-bar-label">' + n + ' star' + (n === 1 ? "" : "s") + '</span>' +
          '<span class="rv-bar-track"><span class="rv-bar-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="rv-bar-count">' + c + "</span></div>"
        );
      })
      .join("");
    return (
      '<div class="rv-summary">' +
        '<p class="rv-score">' + stars(s.average) + ' <b>' + avg(s.average) + " out of 5</b>" +
        ' <span class="rv-count">· ' + s.count + " verified review" + (s.count === 1 ? "" : "s") + "</span></p>" +
        '<div class="rv-histogram">' + rows + "</div>" +
      "</div>"
    );
  }

  function listHtml(data) {
    if (!data.reviews.length) return "";
    return (
      '<ul class="rv-list">' +
      data.reviews
        .map((r) => {
          const date = when(r.created_at);
          return (
            '<li class="rv-item">' +
              '<p class="rv-item-head">' + stars(r.rating) +
                (r.title ? ' <b class="rv-title">' + esc(r.title) + "</b>" : "") +
              "</p>" +
              (r.body ? '<p class="rv-body">' + esc(r.body) + "</p>" : "") +
              '<p class="rv-meta"><span class="rv-verified">✓ Verified buyer</span>' +
                " <span class=\"rv-author\">" + esc(r.author) + "</span>" +
                (date ? ' <span class="rv-date">· ' + esc(date) + "</span>" : "") +
              "</p>" +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  /** The form, or the honest reason there is no form. */
  function panelHtml(data, label) {
    const you = data.you;

    if (!you || !you.signed_in) {
      return (
        '<div class="rv-panel rv-panel-note">' +
          "<p><b>Reviewed this bundle?</b> Sign in with the account you ordered with — reviews are open to verified buyers only.</p>" +
          '<p><a class="rv-link" href="/signin.html">Sign in to review ' + esc(label) + "</a></p>" +
        "</div>"
      );
    }

    if (!you.can_review) {
      return (
        '<div class="rv-panel rv-panel-note">' +
          "<p>You can review " + esc(label) + " once an order for it shows as <b>delivered</b> on your account. We do not open reviews to accounts that have not received the bundle.</p>" +
          '<p><a class="rv-link" href="/history.html">Check your order history</a></p>' +
        "</div>"
      );
    }

    const mine = you.review || null;
    const rating = mine ? Number(mine.rating) : 0;
    const radios = [1, 2, 3, 4, 5]
      .map((n) =>
        '<label class="rv-rate"><input type="radio" name="rv-rating" value="' + n + '"' +
        (rating === n ? " checked" : "") + '><span>' + n + " star" + (n === 1 ? "" : "s") + "</span></label>"
      )
      .join("");

    return (
      '<form class="rv-form" novalidate>' +
        '<fieldset class="rv-field"><legend>Your rating</legend><div class="rv-rates">' + radios + "</div></fieldset>" +
        '<label class="rv-field"><span>Title <em>(optional)</em></span>' +
          '<input type="text" name="rv-title" maxlength="80" placeholder="Sums it up in a line" value="' + esc(mine ? mine.title : "") + '"></label>' +
        '<label class="rv-field"><span>Your review <em>(optional)</em></span>' +
          '<textarea name="rv-body" maxlength="600" rows="3" placeholder="How fast did it land? Anything worth knowing? Please do not include your phone number.">' + esc(mine ? mine.body : "") + "</textarea></label>" +
        (mine && mine.created_at
          ? '<p class="rv-hint">You reviewed this on ' + esc(when(mine.created_at)) + ". Submitting updates your review — you cannot post a second one.</p>"
          : '<p class="rv-hint">Posted against your delivered order' + (you.order_reference ? " " + esc(you.order_reference) : "") + ", marked as a verified purchase.</p>") +
        '<p class="rv-actions"><button type="submit" class="rv-submit">' + (mine ? "Update review" : "Post review") + "</button>" +
          (mine ? ' <button type="button" class="rv-retract">Retract my review</button>' : "") + "</p>" +
        '<p class="rv-msg" role="status" aria-live="polite"></p>' +
      "</form>"
    );
  }

  function render(mount, data, label) {
    mount.innerHTML =
      summaryHtml(data, label) +
      listHtml(data) +
      '<div class="rv-write">' + panelHtml(data, label) + "</div>";
    syncSchema(data);
  }

  function fail(mount, label, message) {
    mount.innerHTML =
      '<p class="rv-none">Reviews for ' + esc(label) + " could not be loaded" + (message ? " (" + esc(message) + ")" : "") + ". " +
      'Reload the page to try again.</p>';
    // No schema on failure: if we cannot show the reviews we must not rate.
    syncSchema({ summary: { count: 0 }, reviews: [] });
  }

  /* ------------------------------------------------------------------ */
  /* behaviour                                                           */
  /* ------------------------------------------------------------------ */

  function wire(mount, ctx) {
    const form = $(".rv-form", mount);
    if (!form) return;
    const msg = $(".rv-msg", mount);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const rating = Number(fd.get("rv-rating") || 0);
      if (!(rating >= 1 && rating <= 5)) {
        msg.textContent = "Pick a star rating first.";
        msg.className = "rv-msg rv-msg-bad";
        return;
      }
      const submit = $(".rv-submit", form);
      submit.disabled = true;
      msg.textContent = "Posting…";
      msg.className = "rv-msg";

      const res = await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          network: ctx.network,
          size_mb: ctx.size_mb,
          rating,
          title: String(fd.get("rv-title") || "").trim(),
          body: String(fd.get("rv-body") || "").trim(),
        }),
      });
      submit.disabled = false;

      if (!res.ok) {
        msg.textContent = (res.data && res.data.error) || "Could not save your review.";
        msg.className = "rv-msg rv-msg-bad";
        return;
      }
      await refresh(mount, ctx);
    });

    const retract = $(".rv-retract", form);
    if (retract) {
      retract.addEventListener("click", async () => {
        if (!window.confirm("Remove your review from this page?")) return;
        const id = ctx.reviewId;
        retract.disabled = true;
        const res = await api("/api/reviews?id=" + encodeURIComponent(id), { method: "DELETE" });
        if (!res.ok) {
          msg.textContent = (res.data && res.data.error) || "Could not remove your review.";
          msg.className = "rv-msg rv-msg-bad";
          retract.disabled = false;
          return;
        }
        await refresh(mount, ctx);
      });
    }
  }

  async function load(mount, ctx) {
    const url = "/api/reviews?network=" + encodeURIComponent(ctx.network) + "&size_mb=" + encodeURIComponent(ctx.size_mb);
    const res = await api(url);
    if (!res.ok) return fail(mount, ctx.label, (res.data && res.data.error) || "HTTP " + res.status);
    const data = res.data;
    if (!data || !Array.isArray(data.reviews) || !data.summary) return fail(mount, ctx.label, "unexpected response");
    ctx.reviewId = data.you && data.you.review ? data.you.review.id : null;
    render(mount, data, ctx.label);
    wire(mount, ctx);
  }

  async function refresh(mount, ctx) {
    // Re-read from the API rather than patching the DOM: the visible list and
    // the injected schema both come from that one response, so they cannot drift.
    await load(mount, ctx);
  }

  function init() {
    const mounts = $$(".reviews-mount");
    if (!mounts.length) return;
    for (const mount of mounts) {
      const network = (mount.getAttribute("data-network") || "").toLowerCase();
      const size_mb = mount.getAttribute("data-size-mb") || "";
      const label = mount.getAttribute("data-label") || network.toUpperCase() + " " + size_mb + "MB";
      if (!network || !size_mb) {
        mount.innerHTML = '<p class="rv-none">Reviews are not available for this page.</p>';
        continue;
      }
      mount.classList.add("rv-loading");
      load(mount, { network, size_mb, label, reviewId: null })
        .catch((err) => fail(mount, label, err && err.message))
        .finally(() => mount.classList.remove("rv-loading"));
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Exposed for the test suite and for debugging from the console.
  window.ValmontReviews = { init, load, syncSchema };
})();
