/* ============================================================================
   assets/js/catalogue-search.js — on-site catalogue search, driven by the
   SAME vocabulary module as the landing pages (lib/keywords.js).

   Why this exists
   ---------------
   A visitor who types "voda" or "megs" or "non expiry" into a search box that
   only matches the literal catalogue words ("telecel", "size_mb", "60-day
   rollover") gets an empty page. An empty page is a lost sale and a bounce
   signal. So the raw query is expanded through lib/keywords.js — synonyms,
   brand aliases, sizes typed as "2 gigs", price-tier words — and folded into
   the relevance score as a BOOST.

   Two rules this file obeys:
     • Exact matches still win. "mtn 10gb" puts the MTN 10GB bundle first
       because an exact size+network score outranks every synonym score.
     • Never render nothing. If a query matches no bundle, we say so plainly
       and leave the full static price list on the page below.

   Progressive enhancement: the tables on the page are real HTML rendered at
   build time. If JavaScript is off (or this file 404s) the search box simply
   submits to /bundles/?q=… and the visitor still sees every price.
   ============================================================================ */

(function () {
  "use strict";

  var form = document.getElementById("catalogueSearch");
  var input = document.getElementById("catalogueQuery");
  var meta = document.getElementById("searchMeta");
  var out = document.getElementById("searchResults");
  var dataEl = document.getElementById("catalogueData");
  if (!form || !input || !out) return;

  var K = window.ValmontKeywords;
  var items = [];
  if (dataEl) {
    try { items = JSON.parse(dataEl.textContent || "[]"); } catch (e) { items = []; }
  }
  if (!K || !items.length) {
    // No vocabulary or no data → leave the static tables to do the job.
    if (meta) meta.textContent = "";
    return;
  }

  var MAX_RESULTS = 12;

  /* Pages (not bundles) that a query can mean — pulled from the shared
     vocabulary so this list can never drift from the generated pages. */
  function pageHints(expanded) {
    var hints = [];
    var cats = expanded.categories || [];
    for (var i = 0; i < cats.length; i++) {
      var cat = K.CATEGORIES[cats[i]];
      if (!cat || !cat.page) continue;
      if (cat.kind !== "service" && cat.kind !== "utility" && cat.kind !== "network" && cat.kind !== "tier" && cat.kind !== "category") continue;
      if (hints.some(function (h) { return h.href === cat.page; })) continue;
      hints.push({ href: cat.page, label: cat.label });
    }
    return hints.slice(0, 3);
  }

  function money(n) { return K.SITE.currencySymbol + Number(n).toFixed(2); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function render(query) {
    var q = String(query || "").trim();
    if (!q) {
      out.innerHTML = "";
      if (meta) meta.innerHTML = "";
      return;
    }

    var res = K.searchCatalogue(q, items, { limit: MAX_RESULTS });
    var expanded = res.expanded;
    var hints = pageHints(expanded);
    var html = "";

    if (hints.length) {
      html += hints
        .map(function (h) {
          return '<a class="seo-hit seo-pagehit" href="' + esc(h.href) + '">' +
            '<span class="who">' + esc(h.label) + '</span>' +
            '<span class="what">Open →</span></a>';
        })
        .join("");
    }

    html += res.results
      .map(function (r) {
        var it = r.item;
        return '<a class="seo-hit" href="' + esc(it.url) + '">' +
          '<span><span class="who">' + esc(it.network_name) + " " + esc(it.size_label) + "</span>" +
          '<span class="why"> · ' + esc(it.validity_label) +
          (r.why && r.why.length ? " · matched: " + esc(r.why.slice(0, 2).join(", ")) : "") +
          "</span></span>" +
          '<span class="what">' + money(it.price) + "</span></a>";
      })
      .join("");

    out.innerHTML = html;

    if (meta) {
      var words = expanded.matchedTerms && expanded.matchedTerms.length
        ? " <b>" + esc(expanded.matchedTerms.slice(0, 4).join(", ")) + "</b>"
        : "";
      if (res.matched) {
        meta.innerHTML =
          "<b>" + res.count + "</b> of " + res.total + " bundles match" +
          (res.count > MAX_RESULTS ? " (showing the first " + MAX_RESULTS + ")" : "") +
          (words ? " — understood as:" + words : "") +
          ". The full price list is below.";
      } else {
        meta.innerHTML =
          "No bundle matches <b>" + esc(q) + "</b> — nothing is hidden: all " +
          res.total + " bundles are listed below." +
          (hints.length ? "" : " Try a network (MTN, Telecel, AirtelTigo) or a size (10gb).");
      }
    }
  }

  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    var v = input.value;
    timer = setTimeout(function () {
      render(v);
      // Keep the address bar shareable without creating crawlable variants:
      // the page canonical is always the plain listing URL.
      try {
        var url = new URL(window.location.href);
        if (v.trim()) url.searchParams.set("q", v.trim());
        else url.searchParams.delete("q");
        window.history.replaceState({}, "", url.toString());
      } catch (e) { /* older browsers — cosmetic only */ }
    }, 140);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    render(input.value);
    if (out.scrollIntoView) out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  /* Deep link: /bundles/?q=voda+20gb (and the ?q= the form submits without JS) */
  var initial = "";
  try { initial = new URLSearchParams(window.location.search).get("q") || ""; } catch (e) { initial = ""; }
  if (initial) {
    input.value = initial;
    render(initial);
  }
})();
