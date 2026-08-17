/* ============================================================================
   Data layer for Valmont Ads.

   Persistence strategy (mirrors the repo's "works with zero setup" rule):
     • Default  → file-backed JSON store at .data/ads.json (survives restarts,
                  shared across every browser hitting the server).
     • ADS_STORE=memory → pure in-memory (used by tests / ephemeral deploys).

   Server-side only. Never import this from a client component.
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Ad, AdInput, AdStatus, Lead, ListQuery, PosterProfile, PostContext, PromotionTier } from "./types";
import { seedAds } from "./seed";
import { describeDevice, ghanaNetwork, screen } from "./screening";

const MODE = process.env.ADS_STORE === "memory" ? "memory" : "file";
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "ads.json");

interface DB {
  ads: Ad[];
  leads: Lead[];
  savedSearches: { id: string; query: string; createdAt: string }[];
}

/* Survive Next.js dev hot-reloads by hanging state off globalThis. */
const g = globalThis as unknown as { __valmontAdsDB?: DB };

function emptyDB(): DB {
  return { ads: [], leads: [], savedSearches: [] };
}

function load(): DB {
  if (g.__valmontAdsDB) return g.__valmontAdsDB;

  let db: DB | null = null;
  if (MODE === "file") {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        if (parsed && Array.isArray(parsed.ads)) {
          db = { ...emptyDB(), ...parsed } as DB;
        }
      }
    } catch {
      db = null;
    }
  }

  if (!db) {
    db = emptyDB();
    db.ads = seedAds();
    g.__valmontAdsDB = db;
    persist();
    return db;
  }

  g.__valmontAdsDB = db;
  return db;
}

function persist() {
  if (MODE !== "file") return;
  const db = g.__valmontAdsDB;
  if (!db) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch {
    /* read-only filesystem (e.g. serverless) → stay in memory */
  }
}

/* ---------------------------------------------------------------- helpers */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

export function genRef(date = new Date()): string {
  const yymmdd = date.toISOString().slice(2, 10).replace(/-/g, "");
  return `VA-${yymmdd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Ghana MSISDN normaliser: 0241234567 / +233241234567 / 233241234567 → 0241234567 */
export function normalisePhone(raw: string): string | null {
  const digits = String(raw || "").replace(/[^\d+]/g, "");
  let d = digits.replace(/^\+/, "");
  if (d.startsWith("233")) d = "0" + d.slice(3);
  if (d.length === 9 && !d.startsWith("0")) d = "0" + d;
  if (!/^0[235][0-9]{8}$/.test(d)) return null;
  return d;
}

/** Posting history for one phone number — feeds the risk score. */
function historyFor(phone: string) {
  const db = load();
  const mine = db.ads.filter((a) => a.sellerPhone === phone);
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const rejected = mine.filter((a) => a.status === "rejected").length;
  return {
    adsLast24h: mine.filter((a) => +new Date(a.createdAt) > dayAgo).length,
    totalAds: mine.length,
    rejected,
    isRepeatOffender: rejected >= 2,
  };
}

/**
 * Full profile of whoever posted an ad, so a moderator can judge the person
 * and not just the words. Surfaced in the admin queue.
 */
export function posterProfile(phone: string): PosterProfile | null {
  const db = load();
  const mine = db.ads.filter((a) => a.sellerPhone === phone);
  if (mine.length === 0) return null;

  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const rejected = mine.filter((a) => a.status === "rejected").length;
  const approved = mine.filter((a) => a.status === "active").length;
  const sold = mine.filter((a) => a.status === "sold").length;
  const sorted = mine.slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  const devices = [
    ...new Set(
      mine
        .map((a) => a.context?.device && `${a.context.device} · ${a.context.os}`)
        .filter((d): d is string => Boolean(d)),
    ),
  ];
  const ips = [...new Set(mine.map((a) => a.context?.ip).filter((i): i is string => Boolean(i)))];

  return {
    phone,
    displayName: sorted[sorted.length - 1].sellerName,
    network: ghanaNetwork(phone),
    firstSeen: sorted[0].createdAt,
    totalAds: mine.length,
    activeAds: approved,
    approved,
    rejected,
    sold,
    rejectionRate: mine.length > 0 ? Math.round((rejected / mine.length) * 100) : 0,
    adsLast24h: mine.filter((a) => +new Date(a.createdAt) > dayAgo).length,
    adsLast7d: mine.filter((a) => +new Date(a.createdAt) > weekAgo).length,
    distinctCategories: new Set(mine.map((a) => a.category)).size,
    distinctRegions: new Set(mine.map((a) => a.region)).size,
    totalLeads: mine.reduce((s, a) => s + a.leads, 0),
    isRepeatOffender: rejected >= 2,
    isTrusted: sold >= 1 && rejected === 0 && mine.length >= 3,
    devices,
    ips,
  };
}

/* ------------------------------------------------------------------ reads */

/** A promotion counts only while it is inside its paid window. */
export function isPromoted(ad: Ad): boolean {
  if (!ad.promotion) return false;
  return +new Date(ad.promotion.expiresAt) > Date.now();
}

export function listAds(query: ListQuery = {}) {
  const db = load();
  const {
    q,
    category,
    subcategory,
    region,
    min,
    max,
    condition,
    sort = "recent",
    status = "active",
    page = 1,
    perPage = 12,
    featuredFirst = true,
  } = query;

  let rows = db.ads.slice();

  if (status !== "all") rows = rows.filter((a) => a.status === status);
  if (category) rows = rows.filter((a) => a.category === category);
  if (subcategory) rows = rows.filter((a) => a.subcategory === subcategory);
  if (region) rows = rows.filter((a) => a.region === region);
  if (condition) rows = rows.filter((a) => a.condition === condition);
  if (typeof min === "number" && !Number.isNaN(min)) rows = rows.filter((a) => (a.price ?? 0) >= min);
  if (typeof max === "number" && !Number.isNaN(max)) rows = rows.filter((a) => (a.price ?? 0) <= max);

  if (q && q.trim()) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    rows = rows.filter((a) => {
      const hay = `${a.title} ${a.description} ${a.category} ${a.subcategory ?? ""} ${a.town} ${a.region}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  const cmp: Record<string, (a: Ad, b: Ad) => number> = {
    recent: (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    "price-asc": (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    "price-desc": (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    popular: (a, b) => b.views - a.views,
  };
  rows.sort(cmp[sort] ?? cmp.recent);

  /* Paid placement only ever reorders the DEFAULT view. When a buyer states an
     intent — cheapest first, most viewed — money must not move the results, or
     the rankings become worthless and buyers stop trusting them. */
  if (sort === "recent") {
    const rank = (a: Ad) => (isPromoted(a) ? 2 : a.featured ? 1 : 0);
    rows.sort((a, b) => rank(b) - rank(a));
  }

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), pages);
  const items = rows.slice((safePage - 1) * perPage, safePage * perPage);

  return { items, total, page: safePage, pages, perPage };
}

export function getAd(idOrSlug: string): Ad | undefined {
  const db = load();
  return db.ads.find((a) => a.id === idOrSlug || a.slug === idOrSlug || a.ref === idOrSlug);
}

export function relatedAds(ad: Ad, limit = 4): Ad[] {
  const db = load();
  return db.ads
    .filter((a) => a.status === "active" && a.id !== ad.id && a.category === ad.category)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.views - a.views)
    .slice(0, limit);
}

export function categoryCounts(): Record<string, number> {
  const db = load();
  const out: Record<string, number> = {};
  for (const a of db.ads) {
    if (a.status !== "active") continue;
    out[a.category] = (out[a.category] ?? 0) + 1;
  }
  return out;
}

export function stats() {
  const db = load();
  const active = db.ads.filter((a) => a.status === "active");
  const since = Date.now() - 24 * 3600 * 1000;
  return {
    activeAds: active.length,
    pending: db.ads.filter((a) => a.status === "pending").length,
    sold: db.ads.filter((a) => a.status === "sold").length,
    rejected: db.ads.filter((a) => a.status === "rejected").length,
    totalAds: db.ads.length,
    last24h: db.ads.filter((a) => +new Date(a.createdAt) > since).length,
    leads: db.leads.length,
    views: db.ads.reduce((s, a) => s + a.views, 0),
    regions: new Set(active.map((a) => a.region)).size,
    sellers: new Set(active.map((a) => a.sellerPhone)).size,
  };
}

export function listLeads(adId?: string): Lead[] {
  const db = load();
  const rows = adId ? db.leads.filter((l) => l.adId === adId) : db.leads;
  return rows.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function findByPhone(phone: string): Ad[] {
  const db = load();
  const p = normalisePhone(phone);
  if (!p) return [];
  return db.ads
    .filter((a) => a.sellerPhone === p)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/* ----------------------------------------------------------------- writes */

export function createAd(
  input: AdInput,
  ctx: PostContext = {},
): { ok: true; ad: Ad } | { ok: false; error: string } {
  const db = load();

  const title = (input.title || "").trim();
  if (title.length < 6) return { ok: false, error: "Title must be at least 6 characters" };
  if (title.length > 90) return { ok: false, error: "Title must be 90 characters or fewer" };
  const description = (input.description || "").trim();
  if (description.length < 20) return { ok: false, error: "Description must be at least 20 characters" };
  if (!input.category) return { ok: false, error: "Category is required" };
  if (!input.region) return { ok: false, error: "Region is required" };

  const phone = normalisePhone(input.sellerPhone);
  if (!phone) return { ok: false, error: "Enter a valid Ghana phone number (e.g. 0241234567)" };

  const price = input.price === null || input.price === undefined ? null : Number(input.price);
  if (price !== null && (Number.isNaN(price) || price < 0)) {
    return { ok: false, error: "Price must be a positive number" };
  }

  /* duplicate guard — same seller, same title, within 10 minutes */
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const dupe = db.ads.find(
    (a) => a.sellerPhone === phone && a.title.toLowerCase() === title.toLowerCase() && +new Date(a.createdAt) > tenMinAgo,
  );
  if (dupe) return { ok: false, error: "You just posted this ad — check My Ads" };

  const verdict = screen({ ...input, title, description }, ctx, historyFor(phone));
  const now = new Date();
  const id = crypto.randomUUID();
  const base = slugify(title);
  let slug = base;
  let n = 2;
  while (db.ads.some((a) => a.slug === slug)) slug = `${base}-${n++}`;

  const ad: Ad = {
    id,
    ref: genRef(now),
    title,
    slug,
    category: input.category,
    subcategory: input.subcategory || undefined,
    price,
    negotiable: Boolean(input.negotiable),
    condition: input.condition ?? "used-good",
    region: input.region,
    town: (input.town || "").trim() || input.region,
    description,
    images: (input.images ?? []).slice(0, 6),
    sellerName: (input.sellerName || "").trim() || "Private seller",
    sellerPhone: phone,
    whatsapp: input.whatsapp !== false,
    sellerType: input.sellerType === "business" ? "business" : "private",
    status: verdict.block ? "rejected" : "pending",
    featured: false,
    views: 0,
    leads: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
    rejectionReason: verdict.block ? verdict.reason : undefined,
    flags: verdict.flags,
    riskScore: verdict.score,
    context: {
      ...ctx,
      ...describeDevice(ctx.userAgent),
    },
  };

  db.ads.unshift(ad);
  persist();
  return { ok: true, ad };
}

export function setStatus(id: string, status: AdStatus, reason?: string): Ad | null {
  const db = load();
  const ad = db.ads.find((a) => a.id === id || a.ref === id);
  if (!ad) return null;
  ad.status = status;
  ad.rejectionReason = status === "rejected" ? reason || "Does not meet posting rules" : undefined;
  ad.updatedAt = new Date().toISOString();
  persist();
  return ad;
}

export function toggleFeatured(id: string): Ad | null {
  const db = load();
  const ad = db.ads.find((a) => a.id === id || a.ref === id);
  if (!ad) return null;
  ad.featured = !ad.featured;
  ad.updatedAt = new Date().toISOString();
  persist();
  return ad;
}

/* ------------------------------------------------------- promotions (paid) */

const PROMO_DAYS: Record<PromotionTier, number> = { spotlight: 30, boost: 14 };

/**
 * Attach a paid promotion, sold as an add-on to a Valmont Web package.
 * `websiteUrl` is mandatory: the whole proposition is driving traffic to the
 * client's OWN site, so a promotion with nowhere to send people is invalid.
 */
export function promoteAd(
  id: string,
  input: { tier: PromotionTier; clientName: string; websiteUrl: string; packageRef?: string; days?: number },
): { ok: true; ad: Ad } | { ok: false; error: string } {
  const db = load();
  const ad = db.ads.find((a) => a.id === id || a.ref === id);
  if (!ad) return { ok: false, error: "Ad not found" };

  const tier: PromotionTier = input.tier === "boost" ? "boost" : "spotlight";

  let url: URL;
  try {
    url = new URL(input.websiteUrl.trim());
  } catch {
    return { ok: false, error: "A valid website URL is required (e.g. https://client.com)" };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, error: "Website URL must start with http:// or https://" };
  }

  const clientName = (input.clientName || "").trim();
  if (clientName.length < 2) return { ok: false, error: "Client/business name is required" };

  const now = new Date();
  const days = input.days && input.days > 0 ? Math.min(input.days, 365) : PROMO_DAYS[tier];

  ad.promotion = {
    tier,
    clientName,
    websiteUrl: url.toString(),
    packageRef: input.packageRef?.trim() || undefined,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 24 * 3600 * 1000).toISOString(),
    impressions: ad.promotion?.impressions ?? 0,
    clicks: ad.promotion?.clicks ?? 0,
  };
  /* A promoted ad must be visible to be worth paying for. */
  if (ad.status === "pending") ad.status = "active";
  ad.updatedAt = now.toISOString();
  persist();
  return { ok: true, ad };
}

export function unpromoteAd(id: string): Ad | null {
  const db = load();
  const ad = db.ads.find((a) => a.id === id || a.ref === id);
  if (!ad) return null;
  delete ad.promotion;
  ad.updatedAt = new Date().toISOString();
  persist();
  return ad;
}

/** Click-through to the client's own site — the metric they actually bought. */
export function recordPromoClick(id: string): string | null {
  const db = load();
  const ad = db.ads.find((a) => a.id === id || a.slug === id || a.ref === id);
  if (!ad?.promotion || !isPromoted(ad)) return null;
  ad.promotion.clicks += 1;
  persist();
  return ad.promotion.websiteUrl;
}

export function recordImpressions(ids: string[]) {
  const db = load();
  let touched = false;
  for (const id of ids) {
    const ad = db.ads.find((a) => a.id === id);
    if (ad?.promotion && isPromoted(ad)) {
      ad.promotion.impressions += 1;
      touched = true;
    }
  }
  if (touched) persist();
}

/** Campaign report for the admin console. */
export function promotionReport() {
  const db = load();
  const promoted = db.ads.filter((a) => a.promotion);
  return promoted
    .map((a) => ({
      id: a.id,
      ref: a.ref,
      slug: a.slug,
      title: a.title,
      status: a.status,
      live: isPromoted(a),
      ...a.promotion!,
      ctr: a.promotion!.impressions > 0 ? a.promotion!.clicks / a.promotion!.impressions : 0,
    }))
    .sort((x, y) => Number(y.live) - Number(x.live) || y.clicks - x.clicks);
}

export function recordView(id: string) {
  const db = load();
  const ad = db.ads.find((a) => a.id === id || a.slug === id);
  if (!ad) return;
  ad.views += 1;
  persist();
}

export function createLead(
  adId: string,
  body: { name: string; phone: string; message: string },
): { ok: true; lead: Lead } | { ok: false; error: string } {
  const db = load();
  const ad = db.ads.find((a) => a.id === adId || a.slug === adId || a.ref === adId);
  if (!ad) return { ok: false, error: "Ad not found" };
  if (ad.status !== "active") return { ok: false, error: "This ad is no longer active" };

  const phone = normalisePhone(body.phone);
  if (!phone) return { ok: false, error: "Enter a valid Ghana phone number" };
  const message = (body.message || "").trim();
  if (message.length < 5) return { ok: false, error: "Message is too short" };

  const lead: Lead = {
    id: crypto.randomUUID(),
    adId: ad.id,
    adRef: ad.ref,
    name: (body.name || "").trim() || "Buyer",
    phone,
    message: message.slice(0, 600),
    createdAt: new Date().toISOString(),
  };
  db.leads.unshift(lead);
  ad.leads += 1;
  persist();
  return { ok: true, lead };
}

/** Test/demo helper — wipe and re-seed. */
export function resetStore() {
  const db = emptyDB();
  db.ads = seedAds();
  g.__valmontAdsDB = db;
  persist();
  return db;
}
