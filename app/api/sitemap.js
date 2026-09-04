/* ============================================================================
   GET /api/sitemap  →  served as https://valmontdata.com/sitemap-stores.xml
   (see the rewrite in vercel.json)

   The *dynamic* half of this site's sitemap: reseller storefronts at /s/<slug>.

   Why it is not in sitemap.xml: storefronts are created by customers at runtime,
   so no build step can know them, and a static list would go stale the moment
   someone opened or closed a store. robots.txt advertises both sitemaps — Google
   accepts several Sitemap: lines — so /s/<slug> pages become discoverable while
   the 43 catalogue/marketing URLs stay in the committed sitemap.xml.

   Function budget: this is the 11th serverless function (Vercel Hobby caps at
   12), which is why it is its own tiny file rather than a branch inside
   api/account.js — it must be reachable without auth and return XML, not JSON.

   Only slugs and timestamps are published here. No store names, owners, markups
   or earnings (see resellers.listActiveStores).
   ============================================================================ */

const { wrap } = require("../lib/http");
const resellers = require("../lib/resellers");

const SITE = (process.env.SITE_URL || "https://valmontdata.com").replace(/\/$/, "");

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** `<lastmod>` wants a W3C date; the column is a timestamptz. */
const dateOnly = (v) => {
  const s = String(v || "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};

function urlset(entries) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries +
    "</urlset>\n"
  );
}

async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.end(urlset("  <!-- GET only -->\n"));
  }

  let stores;
  try {
    stores = await resellers.listActiveStores();
  } catch (err) {
    /* Never answer a database hiccup with an empty 200 — that tells Google the
       storefronts have gone away. 503 is a fetch error: it retries. */
    console.error("[sitemap] store list failed:", err.message);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(urlset("  <!-- temporarily unavailable — retry later -->\n"));
  }

  const today = new Date().toISOString().slice(0, 10);
  const entries = stores
    .map((s) => {
      const lastmod = dateOnly(s.updated_at) || today;
      return (
        "  <url>\n" +
        "    <loc>" + esc(SITE + "/s/" + encodeURIComponent(s.slug)) + "</loc>\n" +
        "    <lastmod>" + lastmod + "</lastmod>\n" +
        "    <changefreq>weekly</changefreq>\n" +
        "    <priority>0.5</priority>\n" +
        "  </url>\n"
      );
    })
    .join("");

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  /* An hour in the browser, a day at the edge: storefronts change slowly and
     this endpoint must not become a per-crawler database query. */
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.end(urlset(entries));
}

module.exports = wrap(handler);
