/* ============================================================================
   app/lib/keywords.js — THE SEARCH VOCABULARY FOR VALMONT DATA.

   What this file is for
   ---------------------
   Our catalogue talks like a database ("size_mb: 1024", "validity_days: null",
   "UP2U", "iShare", "60-day rollover"). Customers type like humans ("data",
   "megs", "vodafone", "non expiry", "cheap bundle", "2 gigs"). This module is
   the one place where the two vocabularies are mapped to each other.

   It is deliberately ISOMORPHIC (plain CommonJS that also attaches itself to
   `window`) so a single list of words drives four things and they can never
   drift apart:

     1. the static landing pages  → scripts/generate-seo-pages.js
        (visible "also searched as" copy, <title>, meta description,
         meta keywords, H1, FAQ wording, URL slugs)
     2. the on-site catalogue search → assets/js/catalogue-search.js
        (synonym expansion folded into the relevance score as a BOOST)
     3. the ValmontAI website assistant → assets/js/valmontai.js
        ("cheap data" now answers with a link to the cheap-bundles page)
     4. the WhatsApp ordering bot → lib/whatsapp-bot.js
        ("tigo 2gb" resolves to AirtelTigo, not Telecel)

   Rules we follow here
   --------------------
   • Every term must be a word a real Ghanaian customer plausibly types.
     No invented slang, no competitor-brand baiting, no keyword stuffing.
   • Ambiguous short forms ("at", "g", "tc") are only accepted as PHRASES
     ("at data"), never as bare tokens, so we never misread normal English.
   • Synonyms expand a query into a score BOOST. They never act as a hard
     filter: an exact size or network match must still win.
   • Nothing here claims anything we cannot prove from the catalogue
     (see `CATEGORIES[*].claim` — used by the generator, sourced from data).

   Maintenance: add a word to `terms` (short/synonym) or `phrases` (long-tail
   intent) and re-run `npm run seo:generate`. The pages, the sitemap and the
   search index all pick it up. `npm run test:seo` fails if a new short term
   returns nothing.
   ============================================================================ */

"use strict";

/* -------------------------------------------------------------------------- */
/* Site facts (all sourced — no marketing invention)                           */
/* -------------------------------------------------------------------------- */

const SITE = {
  name: "Valmont Data",
  legalName: "Valmont Data — Valmont Group of Companies",
  origin: "https://valmontdata.com",
  currency: "GHS",
  currencySymbol: "GH₵",
  country: "GH",
  countryName: "Ghana",
  city: "Accra",
  region: "Greater Accra",
  email: "support@valmontdata.com",
  whatsapp: "+233 54 245 1578",
  whatsappE164: "233542451578",
  /* Title template: the company name always goes LAST. The <title> of a page
     leads with the searcher's intent, not with us. */
  titleTemplate: "%s | Valmont Data",
};

/* -------------------------------------------------------------------------- */
/* Locations we serve                                                          */
/* --------------------------------------------------------------------------
   IMPORTANT — read before generating "data bundles in <city>" pages.

   Valmont Data sells a digital good: a bundle is credited to a Ghanaian
   MSISDN seconds after payment. There is no delivery radius, no branch, no
   local stock, no local pricing and no local turnaround. The service a
   customer in Wa receives is byte-for-byte the service a customer in Tema
   receives.

   That means city × service pages would carry NO differentiated information,
   which is the doorway-page pattern Google treats as spam. So this list is
   used for copy and schema (`areaServed`), NOT for page generation:

     • Organisation/LocalBusiness JSON-LD → areaServed = Ghana (nationwide)
     • landing-page copy → "any MTN, Telecel or AirtelTigo number in Ghana"
     • the Accra headquarters is real, so LocalBusiness address is real

   If we ever open a physical presence, add local facts (address, opening
   hours, local reseller names, local payment points) to a location entry and
   only then generate pages for it.
   -------------------------------------------------------------------------- */

const LOCATIONS = {
  servedCountry: { code: "GH", name: "Ghana", scope: "nationwide" },
  headquarters: { city: "Accra", region: "Greater Accra", country: "Ghana" },
  /* Cities/regions our customers are in. Nationwide digital delivery — used
     for `areaServed` and honest copy only (see the comment above). */
  cities: [
    "Accra", "Tema", "Madina", "Kasoa", "Kumasi", "Obuasi", "Ejisu",
    "Takoradi", "Sekondi", "Cape Coast", "Winneba", "Nsawam", "Koforidua",
    "Ho", "Aflao", "Sunyani", "Techiman", "Bolgatanga", "Bawku", "Wa", "Tamale",
  ],
};

/* -------------------------------------------------------------------------- */
/* Site-wide terms — what the whole business is called by customers            */
/* -------------------------------------------------------------------------- */

const SITE_TERMS = [
  "data", "data bundle", "data bundles", "bundle", "bundles", "mobile data",
  "internet bundle", "megabytes", "megs", "gb", "data plan", "data plans",
  "buy data", "data top up", "top up", "topup", "recharge", "reload",
  "data price", "data prices", "cheap data", "ghana data", "data ghana",
  "momo data", "data with momo", "valmont", "valmont data",
];

/* -------------------------------------------------------------------------- */
/* The vocabulary, per category / brand / service                              */
/* --------------------------------------------------------------------------
   kind:
     network  → a brand we sell (MTN, Telecel, AirtelTigo)
     category → an attribute of the catalogue (non-expiry, rollover)
     tier     → a real, derived slice of the catalogue (cheap, big)
     service  → something we do (auto top-up, WhatsApp ordering, reselling)
     utility  → a reference page with real data (network prefixes, tracking)

   `page` is the indexable route the term should land on. `terms` are short
   colloquial synonyms (including the wrong-but-common names people use);
   `phrases` are long-tail intent phrases used in visible copy and in the
   meta-keywords list.
   -------------------------------------------------------------------------- */

const CATEGORIES = {
  /* ---------------- networks (brands we sell) ---------------- */
  mtn: {
    kind: "network",
    label: "MTN",
    page: "/bundles/mtn.html",
    /* "UP2U" is the MTN product name our own storefront already uses. */
    terms: [
      "mtn", "mtn data", "mtn bundle", "mtn bundles", "mtn ghana", "up2u",
      "mtn up2u", "mtn megs", "mtn internet", "mtn non expiry", "mtn no expiry",
      "mtn data bundle", "mtn data price",
    ],
    phrases: [
      "mtn data bundle price in ghana", "buy mtn data", "mtn non expiry data bundles",
      "cheapest mtn data bundle", "mtn 10gb price", "mtn unlimited data", "mtn up2u prices",
      "how much is mtn data", "mtn data bundle accra", "mtn megs price",
    ],
  },
  telecel: {
    kind: "network",
    label: "Telecel",
    page: "/bundles/telecel.html",
    /* Telecel Ghana was Vodafone Ghana until 2023 — most people still type
       "vodafone". Our own assistant already knows this alias. */
    terms: [
      "telecel", "telecel data", "telecel bundle", "telecel bundles", "vodafone",
      "vodafone ghana", "vodafone data", "voda", "voda data", "telecel ghana",
      "telecel megs", "telecel rollover", "telecel data price",
    ],
    phrases: [
      "telecel data bundle price", "vodafone data bundle ghana", "buy telecel data",
      "telecel 100gb price", "telecel 60 day rollover", "cheapest telecel bundle",
      "vodafone non expiry data", "telecel data bundle accra", "how much is telecel data",
    ],
  },
  airteltigo: {
    kind: "network",
    label: "AirtelTigo",
    page: "/bundles/airteltigo.html",
    /* "at" alone is an English word — only accepted inside phrases. */
    terms: [
      "airteltigo", "airtel tigo", "airtel", "tigo", "airteltigo data", "airtel data",
      "tigo data", "airteltigo bundle", "ishare", "at", "at ishare", "at data", "at bundle",
      "at megs", "airteltigo megs", "airteltigo rollover", "airteltigo data price",
    ],
    phrases: [
      "airteltigo data bundle price", "buy airteltigo data", "at data bundle ghana",
      "airteltigo 5gb price", "tigo data bundle", "cheapest airteltigo bundle",
      "airteltigo 60 day rollover", "airtel tigo non expiry", "how much is airteltigo data",
    ],
  },

  /* ---------------- catalogue attributes ---------------- */
  "non-expiry": {
    kind: "category",
    label: "Non-expiry data",
    page: "/bundles/mtn.html", // every non-expiry bundle we stock is MTN
    terms: [
      "non expiry", "non-expiry", "no expiry", "nonexpiry", "never expires",
      "doesnt expire", "doesn't expire", "no validity", "data without expiry",
      "lifetime data", "rollover free", "unlimited time data",
    ],
    phrases: [
      "non expiry data bundles ghana", "data bundle that does not expire",
      "mtn non expiry bundle price", "buy non expiry data", "no expiry data ghana",
      "cheapest non expiry data", "non expiry data meaning",
    ],
  },
  rollover: {
    kind: "category",
    label: "60-day rollover data",
    page: "/bundles/rollover.html",
    terms: [
      "rollover", "roll over", "60 day", "60 days", "60-day", "two months data",
      "2 months data", "data with expiry", "expiring data", "validity",
    ],
    phrases: [
      "60 day rollover data bundle", "telecel 60 days data", "airteltigo rollover bundle",
      "data bundle valid for 60 days", "rollover data ghana", "2 month data bundle price",
    ],
  },

  /* ---------------- price/size tiers (derived slices) ---------------- */
  cheap: {
    kind: "tier",
    label: "Cheap data bundles",
    page: "/bundles/cheap.html",
    terms: [
      "cheap", "cheapest", "cheap data", "cheap bundle", "cheap bundles", "affordable",
      "affordable data", "low price", "low cost", "budget", "small data", "small bundle",
      "cheaper", "best price", "discount", "promo", "under 10 cedis", "under 20 cedis",
      "small money", "3 cedis", "5 cedis", "10 cedis",
    ],
    phrases: [
      "cheapest data bundle in ghana", "cheap data bundle ghana", "data bundle under 20 cedis",
      "cheapest 1gb data ghana", "affordable data bundles", "cheap mtn data bundle",
      "low cost internet bundle ghana", "data bundle price in ghana", "cheapest data seller in ghana",
    ],
  },
  big: {
    kind: "tier",
    label: "Big data bundles",
    page: "/bundles/big.html",
    terms: [
      "big", "big data", "large", "large bundle", "bulk", "bulk data", "heavy", "heavy user",
      "unlimited", "unlimited data", "biggest bundle", "largest data bundle", "more data",
      "lots of data", "plenty data", "streaming", "downloading", "work from home",
    ],
    phrases: [
      "100gb data bundle price ghana", "50gb mtn bundle price", "biggest data bundle in ghana",
      "unlimited data bundle ghana", "bulk data bundle ghana", "large data bundle for streaming",
      "telecel 100gb price", "40gb data bundle price",
    ],
  },

  /* ---------------- services ---------------- */
  "auto-top-up": {
    kind: "service",
    label: "Automatic data top-up (auto-reload)",
    page: "/auto-top-up.html",
    terms: [
      "auto reload", "autoreload", "auto-reload", "auto top up", "auto topup",
      "automatic top up", "auto renew", "automatic renewal", "recurring data",
      "subscription", "data subscription", "top me up", "top up automatically",
      "when my data finishes", "never run out", "automatic data",
    ],
    phrases: [
      "automatic data top up ghana", "auto reload mtn data", "renew my data automatically",
      "data subscription ghana", "top up my data when it finishes", "auto renew data bundle momo",
      "automatic data renewal ghana",
    ],
  },
  whatsapp: {
    kind: "service",
    label: "Buy data on WhatsApp",
    page: "/buy-data-on-whatsapp.html",
    terms: [
      "whatsapp", "whats app", "wa", "chat", "whatsapp bot", "whatsapp number",
      "order on whatsapp", "whatsapp order", "message", "text",
    ],
    phrases: [
      "buy data on whatsapp ghana", "order mtn data on whatsapp", "data bundle whatsapp number",
      "buy data through whatsapp", "whatsapp data seller ghana", "pay momo on whatsapp for data",
    ],
  },
  reseller: {
    kind: "service",
    label: "Reseller programme",
    page: "/store.html",
    terms: [
      "reseller", "resell", "reselling", "resale", "data business", "sell data",
      "selling data", "data shop", "shop", "agent", "dealer", "markup", "store",
      "storefront", "wholesale", "earn", "side hustle", "business",
    ],
    phrases: [
      "how to start a data business in ghana", "become a data reseller ghana",
      "data reselling business ghana", "buy wholesale data ghana", "data reseller platform ghana",
      "sell mtn data online", "open a data shop ghana", "data reseller markup",
    ],
  },
  referral: {
    kind: "service",
    label: "Refer & earn",
    page: "/faq.html#referrals",
    terms: [
      "referral", "refer", "refer a friend", "referral code", "invite", "free data",
      "earn credit", "bonus", "promo code", "coupon",
    ],
    phrases: [
      "valmont data referral code", "free data ghana", "earn free data by referring friends",
      "data referral programme ghana",
    ],
  },

  /* ---------------- utility / trust pages ---------------- */
  tracking: {
    kind: "utility",
    label: "Track an order",
    page: "/status.html",
    terms: [
      "track", "track order", "order status", "status", "tracking", "tracking number",
      "receipt", "where is my data", "delivery status", "my order", "not delivered",
      "pending", "failed", "refund", "refunded",
    ],
    phrases: [
      "track my data order", "valmont data order status", "my data has not arrived",
      "data bundle delivery status ghana", "how long does data delivery take",
    ],
  },
  prefixes: {
    kind: "utility",
    label: "Ghana network prefixes",
    page: "/network-prefixes.html",
    terms: [
      "prefix", "prefixes", "number prefix", "which network", "network checker",
      "what network", "my number", "sim prefix", "024", "025", "020", "050",
      "026", "027", "028", "054", "055", "056", "057", "059", "023", "053",
    ],
    phrases: [
      "024 which network ghana", "055 which network", "020 is which network",
      "ghana mobile number prefixes", "mtn prefixes list", "telecel prefixes ghana",
      "airteltigo prefixes", "how to know my network in ghana",
    ],
  },
  /* Someone typing "support" or "help" into the search box is not looking for a
     bundle — sending them to an empty result is the worst possible answer. This
     category only feeds the search page-hints and the keywords meta; ValmontAI's
     own router still hands these queries to a human first (see the guard in
     assets/js/valmontai.js), and the WhatsApp bot has its own handoff. */
  /* Brand words. Someone typing the company name into our own search box is
     usually checking they are in the right place; send them home rather than
     showing an empty catalogue. */
  brand: {
    kind: "utility",
    label: "Valmont Data",
    page: "/",
    terms: [
      "valmont", "valmont data", "valmontdata", "valmont ghana", "valmont data ghana",
      "valmont group", "valmont bundles",
    ],
    phrases: [
      "valmont data official website", "who owns valmont data",
      "is valmont data legit", "is valmont data real",
    ],
  },
  support: {
    kind: "utility",
    label: "Contact support",
    page: "/contact.html",
    terms: [
      "support", "help", "customer support", "contact valmont", "valmont support",
      "valmont help", "help me", "assistance", "phone number", "email address",
      "reach you", "customer service",
    ],
    phrases: [
      "how do i contact valmont data", "valmont data customer care number",
      "i need help with my order", "who do i talk to",
    ],
  },
  payment: {
    kind: "utility",
    label: "Paying with Mobile Money",
    page: "/faq.html#payment",
    terms: [
      "momo", "mobile money", "mtn momo", "telecel cash", "at money", "mo mo",
      "card", "visa", "mastercard", "pay with momo", "valmont pay", "valmontpay",
      "payment", "pin", "wallet",
    ],
    phrases: [
      "buy data with momo", "pay for data bundle with mobile money", "data bundle card payment ghana",
      "is valmont data safe", "momo payment for data ghana",
    ],
  },
  catalogue: {
    kind: "category",
    label: "All data bundles",
    page: "/bundles/",
    terms: [
      "data", "bundle", "bundles", "data bundle", "data bundles", "mobile data",
      "internet", "internet bundle", "megabytes", "megs", "mb", "gb", "gigabyte",
      "gigabytes", "gig", "gigs", "plan", "plans", "data plan", "data plans",
      "top up", "topup", "recharge", "reload", "hotspot data", "buy data",
      "catalogue", "catalog", "all bundles", "every bundle", "price list",
      "prices", "bundle prices", "data prices", "list of bundles",
      "what do you sell", "what do you have",
    ],
    phrases: [
      "buy data bundle ghana", "data bundle price in ghana", "cheapest data bundles ghana",
      "buy mobile data ghana", "data bundle for any network ghana", "online data bundle ghana",
      "best data bundle site in ghana", "data bundle delivery in seconds",
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Normalisation helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Lowercase, drop punctuation, collapse whitespace. Keeps digits + apostrophes. */
function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word tokens of a normalised string. */
function tokensOf(text) {
  const n = normalise(text);
  return n ? n.split(" ") : [];
}

/**
 * Parse a data size out of free text: "2gb", "2 gb", "500mb", "1.5gb",
 * "2 gigs", "10240 mb".
 * Deliberately ignores bare "g" ("5g" is a network generation, not a size).
 * Note: we keep the decimal point here — `normalise()` strips it, which would
 * turn "1.5gb" into "1 5gb" and silently sell the wrong bundle.
 * @returns {number|null} size in MB
 */
function sizeFromText(text) {
  const t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9'.\s]/g, " ").replace(/\s+/g, " ") + " ";
  const m = /(\d+(?:\.\d+)?)\s*(gb|gigabyte|gigabytes|gigs?|mb|megabyte|megabytes|megs?)\b/.exec(t);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num) || num <= 0) return null;
  const unit = m[2];
  const isGb = unit === "gb" || unit.startsWith("gig");
  return isGb ? Math.round(num * 1024) : Math.round(num);
}

/** Human size label used everywhere on the site: 1024 → "1GB", 512 → "512MB". */
function sizeLabel(sizeMb) {
  const mb = Number(sizeMb);
  if (mb >= 1024) {
    const gb = mb / 1024;
    return (Number.isInteger(gb) ? String(gb) : gb.toFixed(1).replace(/\.0$/, "")) + "GB";
  }
  return mb + "MB";
}

/** Slug form of a size for URLs: 10240 → "10gb", 1536 → "1.5gb", 512 → "512mb". */
function sizeSlug(sizeMb) {
  return sizeLabel(sizeMb).toLowerCase().replace(/\./g, "-");
}

/* -------------------------------------------------------------------------- */
/* Term index — built once, term → category ids                                */
/* -------------------------------------------------------------------------- */

/**
 * Terms that are real English words as well as customer vocabulary. They only
 * count when they appear inside a phrase ("at data", "my order status"), never
 * as a bare token — otherwise "I want to buy data at home" would match AirtelTigo.
 * Everything else in the vocabulary matches as a single word too, including the
 * one-word queries that matter most: "data", "bundle", "megs", "gb", "momo".
 */
const PHRASE_ONLY_TERMS = new Set([
  "at", "wa", "shop", "store", "business", "earn", "text", "message", "chat",
  "status", "pending", "failed", "pin", "wallet", "card", "my order",
]);

const TERM_INDEX = (() => {
  const index = new Map(); // term → Set(categoryId)
  for (const [id, cat] of Object.entries(CATEGORIES)) {
    for (const term of cat.terms.concat(cat.phrases)) {
      const key = normalise(term);
      if (!key) continue;
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(id);
    }
  }
  return index;
})();

/** Reverse lookup: every category id that mentions `term`. */
function categoriesForTerm(term) {
  const key = normalise(term);
  return Array.from(TERM_INDEX.get(key) || []);
}

/* -------------------------------------------------------------------------- */
/* Query expansion                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Map a raw query to the categories it means.
 * This is the synonym-expansion function: "voda megs" → ['telecel','catalogue'].
 *
 * Matching is longest-phrase-first so "mtn non expiry" wins over "mtn", and
 * phrase-only terms (see PHRASE_ONLY_TERMS) never match on their own token.
 *
 * @param {string} rawQuery
 * @returns {{ raw:string, norm:string, tokens:string[], categories:string[],
 *             networks:string[], sizes:number[], matchedTerms:string[],
 *             phrases:string[] }}
 */
function expandQuery(rawQuery) {
  const raw = String(rawQuery || "");
  const norm = normalise(raw);
  const tokens = tokensOf(norm);
  const padded = " " + norm + " ";
  const categories = new Set();
  const matchedTerms = [];
  /* A one- or two-word query is a navigation/keyword query, so even the
     ambiguous words count ("store" → reseller, "status" → tracking). Inside a
     sentence they don't ("buy data for my business" is not a reseller query). */
  const shortQuery = tokens.length <= 2;

  /* 1. multi-word terms and phrases (longest first) */
  const phraseKeys = Array.from(TERM_INDEX.keys())
    .filter((k) => k.includes(" "))
    .sort((a, b) => b.length - a.length);
  for (const phrase of phraseKeys) {
    if (padded.includes(" " + phrase + " ") || padded.includes(phrase)) {
      for (const id of TERM_INDEX.get(phrase)) categories.add(id);
      matchedTerms.push(phrase);
    }
  }

  /* 2. single-word terms, skipping the ambiguous ones in longer queries */
  for (const key of TERM_INDEX.keys()) {
    if (key.includes(" ")) continue;
    if (PHRASE_ONLY_TERMS.has(key) && !shortQuery) continue;
    if (tokens.includes(key)) {
      for (const id of TERM_INDEX.get(key)) categories.add(id);
      matchedTerms.push(key);
    }
  }

  /* 3. network detection (alias-aware) */
  const networks = [];
  for (const code of ["mtn", "telecel", "airteltigo"]) {
    if (categories.has(code)) networks.push(code);
  }

  /* 4. explicit sizes — parsed from the RAW text, never from `norm`, because
        normalise() strips the decimal point in "1.5gb". */
  const sizes = [];
  const sizeMatches =
    raw.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:gb|gigabytes?|gigs?|mb|megabytes?|megs?)\b/g) || [];
  for (const sm of sizeMatches) {
    const mb = sizeFromText(sm);
    if (mb) sizes.push(mb);
  }

  /* 5. bare Ghana prefixes ("055 which network") */
  const prefixHit = /\b0\d{2}\b/.exec(norm);
  if (prefixHit && categories.has("prefixes") === false) {
    // only treat it as a prefix query when the rest of the query asks about networks
    if (/(which|what|whose|network|prefix)/.test(norm)) categories.add("prefixes");
  }

  return {
    raw,
    norm,
    tokens,
    categories: Array.from(categories),
    networks,
    sizes: Array.from(new Set(sizes)),
    matchedTerms: Array.from(new Set(matchedTerms)),
    phrases: matchedTerms.filter((t) => t.includes(" ")),
  };
}

/** Convenience: just the category ids a query maps to. */
function matchCategories(rawQuery) {
  return expandQuery(rawQuery).categories;
}

/**
 * Alias-aware network detection. Replaces the hand-rolled versions that used to
 * live in lib/whatsapp-bot.js (which mapped "tigo" → Telecel) and
 * assets/js/valmontai.js.
 * @returns {"mtn"|"telecel"|"airteltigo"|null}
 */
function detectNetwork(text) {
  const norm = normalise(text);
  if (!norm) return null;
  const tokens = norm.split(" ");
  /* exact alias token first */
  const exact = { mtn: ["mtn"], telecel: ["telecel", "vodafone", "voda"], airteltigo: ["airteltigo", "airtel", "tigo", "ishare"] };
  for (const [code, aliases] of Object.entries(exact)) {
    if (aliases.some((a) => tokens.includes(a))) return code;
  }
  /* then substring ("airteltigo" written as one word, "mtnghana", …) */
  if (/airteltigo|airtel|tigo/.test(norm)) return "airteltigo";
  if (/telecel|vodafone|voda/.test(norm)) return "telecel";
  if (/mtn/.test(norm)) return "mtn";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Catalogue relevance scoring                                                 */
/* --------------------------------------------------------------------------
   Weights are ordered so that an EXACT match always beats a synonym match:
   the vocabulary expands the query and adds a boost, it never overrides the
   thing the customer actually typed.
   -------------------------------------------------------------------------- */

const WEIGHTS = {
  EXACT_SIZE: 140,       // "10gb" and the item is the 10GB bundle
  EXACT_SIZE_PLUS_NET: 60, // …and the right network too
  NETWORK_EXACT: 80,     // "mtn" token in the query
  NETWORK_SYNONYM: 55,   // "vodafone" → Telecel via the vocabulary
  CATEGORY_TERM: 45,     // "non expiry" / "rollover" describes this item
  NEAREST_SIZE_MAX: 30,  // requested size is not stocked → nearest sizes surface
  SIZE_WORD: 12,         // "gb"/"megs" with no number → any data item
  LABEL_TOKEN: 8,        // a query token appears in the item's own label
  CHEAP_TIER_MAX: 34,    // price-rank boost for "cheap" queries
  BIG_TIER_MAX: 34,      // size-rank boost for "big"/"bulk" queries
  SITE_TERM: 6,          // generic "data bundle" wording
};

/**
 * Score one catalogue item against a raw query.
 * @param {string} rawQuery
 * @param {{network:string,size_mb:number,validity_days?:number|null,price:number,
 *          label?:string,keywords?:string[]}} item
 * @param {{priceRank?:number,sizeRank?:number,total?:number}} [ranks]
 *        precomputed ranks (0 = cheapest / largest) from searchCatalogue
 * @returns {{score:number, why:string[]}}
 */
function scoreItem(rawQuery, item, ranks) {
  const q = expandQuery(rawQuery);
  const why = [];
  let score = 0;
  const label = item.label || sizeLabel(item.size_mb);
  const labelNorm = normalise(label);
  const itemKeywords = (item.keywords || []).map(normalise);
  const netLabel = { mtn: "mtn", telecel: "telecel", airteltigo: "airteltigo" }[item.network] || item.network;

  /* size */
  if (q.sizes.length) {
    if (q.sizes.includes(Number(item.size_mb))) {
      score += WEIGHTS.EXACT_SIZE;
      why.push("exact size " + label);
      if (q.networks.includes(item.network)) {
        score += WEIGHTS.EXACT_SIZE_PLUS_NET;
        why.push("exact size + network");
      }
    } else {
      /* We don't stock that exact size (e.g. someone typed "1.5gb"). Surface
         the nearest sizes instead of an empty result — a graded boost, so it
         can never outrank an exact match. */
      let best = Infinity;
      for (const want of q.sizes) best = Math.min(best, Math.abs(Number(item.size_mb) - want) / want);
      const boost = Math.round(WEIGHTS.NEAREST_SIZE_MAX * Math.max(0, 1 - Math.min(1, best)));
      if (boost > 0) { score += boost; why.push("nearest stocked size to " + q.sizes.map(sizeLabel).join("/")); }
    }
  } else if (q.categories.includes("catalogue")) {
    score += WEIGHTS.SIZE_WORD;
    why.push("generic data word");
  }

  /* network: exact token beats synonym */
  if (q.tokens.includes(netLabel) || q.tokens.includes(String(item.network).toLowerCase())) {
    score += WEIGHTS.NETWORK_EXACT;
    why.push("network typed exactly");
  } else if (q.networks.includes(item.network)) {
    score += WEIGHTS.NETWORK_SYNONYM;
    why.push("network via synonym (" + q.matchedTerms.join(", ") + ")");
  }

  /* attribute categories that describe this item */
  const isNonExpiry = !item.validity_days;
  if (q.categories.includes("non-expiry") && isNonExpiry) {
    score += WEIGHTS.CATEGORY_TERM;
    why.push("non-expiry match");
  }
  if (q.categories.includes("rollover") && item.validity_days) {
    score += WEIGHTS.CATEGORY_TERM;
    why.push(item.validity_days + "-day rollover match");
  }

  /* price / size tiers — graded boosts, so "cheap" ranks cheap items first
     without hiding everything else */
  if (q.categories.includes("cheap") && ranks && typeof ranks.priceRank === "number") {
    const boost = Math.max(0, WEIGHTS.CHEAP_TIER_MAX - ranks.priceRank * 3);
    if (boost > 0) { score += boost; why.push("low-price rank #" + (ranks.priceRank + 1)); }
  }
  if (q.categories.includes("big") && ranks && typeof ranks.sizeRank === "number") {
    const boost = Math.max(0, WEIGHTS.BIG_TIER_MAX - ranks.sizeRank * 3);
    if (boost > 0) { score += boost; why.push("large-size rank #" + (ranks.sizeRank + 1)); }
  }

  /* query token appears in the item's own label or keyword list */
  for (const t of q.tokens) {
    if (t.length < 2) continue;
    if (labelNorm.includes(t) || itemKeywords.some((k) => k.includes(t))) {
      score += WEIGHTS.LABEL_TOKEN;
      why.push("label/keyword token '" + t + "'");
      break;
    }
  }

  /* generic site vocabulary keeps a bare "data" query from returning nothing */
  if (score === 0 && q.matchedTerms.some((t) => SITE_TERMS.includes(t))) {
    score += WEIGHTS.SITE_TERM;
    why.push("site-wide term");
  }

  return { score, why };
}

/**
 * On-site catalogue search with synonym expansion.
 *
 * Never returns an empty page: if nothing scores, every item comes back in its
 * default order and `matched` is false so the UI can say "no exact match —
 * showing all bundles".
 *
 * @param {string} rawQuery
 * @param {Array<object>} items catalogue items (see scoreItem)
 * @param {{limit?:number}} [opts]
 */
function searchCatalogue(rawQuery, items, opts) {
  const limit = (opts && opts.limit) || items.length;
  const list = (items || []).slice();

  /* precompute ranks used by the tier boosts */
  const byPrice = list.slice().sort((a, b) => a.price - b.price);
  const bySize = list.slice().sort((a, b) => b.size_mb - a.size_mb);
  const priceRank = new Map(byPrice.map((b, i) => [key(b), i]));
  const sizeRank = new Map(bySize.map((b, i) => [key(b), i]));

  const scored = list.map((item) => {
    const ranks = { priceRank: priceRank.get(key(item)), sizeRank: sizeRank.get(key(item)), total: list.length };
    const s = scoreItem(rawQuery, item, ranks);
    return { item, score: s.score, why: s.why };
  });

  const matched = scored.some((r) => r.score > 0);
  const results = matched
    ? scored.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.item.price - b.item.price)
    : scored;

  return {
    query: rawQuery,
    expanded: expandQuery(rawQuery),
    matched,
    count: Math.min(results.length, limit),
    total: list.length,
    results: results.slice(0, limit),
  };
}

function key(b) { return b.network + ":" + b.size_mb; }

/* -------------------------------------------------------------------------- */
/* Meta keywords + visible "also searched as"                                  */
/* -------------------------------------------------------------------------- */

/**
 * The `keywords` meta value for a page. Google ignores it (since 2009) and a
 * few other engines still read it, so it stays short and honest — the words
 * that actually rank are in the <title>, description, H1 and visible copy.
 */
function metaKeywords(categoryIds, extra) {
  const out = [];
  for (const id of categoryIds || []) {
    const cat = CATEGORIES[id];
    if (!cat) continue;
    out.push(cat.label.toLowerCase());
    for (const t of cat.terms.slice(0, 8)) out.push(t);
  }
  for (const e of extra || []) out.push(String(e).toLowerCase());
  const seen = new Set();
  return out.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).slice(0, 24);
}

/**
 * Visible "also searched as" words for a set of categories.
 * Round-robin across the categories so a page about several things shows the
 * vocabulary of each, not just the first fourteen words of the first one.
 */
function alsoSearchedAs(categoryIds, max) {
  const limit = max || 12;
  const lists = (categoryIds || [])
    .map((id) => CATEGORIES[id])
    .filter(Boolean)
    .map((cat) => cat.terms.slice());
  const out = [];
  const seen = new Set();
  let i = 0;
  while (out.length < limit && lists.some((l) => l.length)) {
    for (const list of lists) {
      while (list.length) {
        const t = list.shift();
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
        break;
      }
      if (out.length >= limit) break;
    }
    if (++i > 200) break; // belt and braces — the lists are finite anyway
  }
  return out;
}

/**
 * Keywords for one catalogue item — used for the product-page meta keywords and
 * as the `keywords` field the search scorer reads.
 */
function itemKeywords(item) {
  const label = sizeLabel(item.size_mb);
  const net = { mtn: "MTN", telecel: "Telecel", airteltigo: "AirtelTigo" }[item.network] || item.network;
  const words = [
    (net + " " + label).toLowerCase(),
    (net + " data " + label).toLowerCase(),
    (net + " bundle " + label).toLowerCase(),
    label.toLowerCase(),
    (label.toLowerCase() + " data"),
    (label.toLowerCase() + " price"),
    item.size_mb + "mb",
    net.toLowerCase(),
  ];
  for (const w of alsoSearchedAs([item.network], 6)) words.push(w);
  words.push(item.validity_days ? item.validity_days + "-day rollover" : "non-expiry");
  const seen = new Set();
  return words.filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
}

/* -------------------------------------------------------------------------- */
/* Export (Node) + attach (browser)                                            */
/* -------------------------------------------------------------------------- */

const api = {
  SITE,
  LOCATIONS,
  SITE_TERMS,
  CATEGORIES,
  WEIGHTS,
  normalise,
  tokensOf,
  sizeFromText,
  sizeLabel,
  sizeSlug,
  categoriesForTerm,
  expandQuery,
  matchCategories,
  detectNetwork,
  scoreItem,
  searchCatalogue,
  metaKeywords,
  alsoSearchedAs,
  itemKeywords,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.ValmontKeywords = api;
