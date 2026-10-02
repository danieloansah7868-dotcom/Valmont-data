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
import { sellerStats, type SellerStats } from "./reputation";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  SESSION_TTL_MS,
  codeMatches,
  generateCode,
  hashCode,
  newToken,
  type LoginCode,
  type Session,
} from "./session";

const MODE = process.env.ADS_STORE === "memory" ? "memory" : "file";
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "ads.json");

interface DB {
  ads: Ad[];
  leads: Lead[];
  savedSearches: { id: string; query: string; createdAt: string }[];
  /** Phone numbers an admin has ID-verified in person. */
  verifiedSellers: string[];
  /** One pending login code per phone number. */
  loginCodes: LoginCode[];
  /** Signed-in sellers. Token is the only thing the browser holds. */
  sessions: Session[];
}

/* Survive Next.js dev hot-reloads by hanging state off globalThis. */
const g = globalThis as unknown as { __valmontAdsDB?: DB };

function emptyDB(): DB {
  return { ads: [], leads: [], savedSearches: [], verifiedSellers: [], loginCodes: [], sessions: [] };
}

/* ---------------------------------------------------------------- expiry

   Every ad is stamped with expiresAt 30 days out at creation. Until now that
   field was written and never read, so nothing ever expired: a listing posted
   in January still sat in "Live" in December, with a phone number that had
   long stopped answering. Nothing rots a classifieds site faster than ads for
   things that sold months ago.

   The sweep runs lazily — on read, throttled to once a minute — rather than on
   a cron. This app has no scheduler and serverless deploys freeze between
   requests, so anything time-based has to hang off traffic. A page load is the
   only reliable clock we have.

   Only "active" ads expire. Pending ones are waiting on us, not on the seller,
   and sold/rejected are already final states. */
let lastSweep = 0;
const SWEEP_EVERY_MS = 60 * 1000;

function sweep(db: DB): boolean {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return false;
  lastSweep = now;

  let changed = false;

  for (const ad of db.ads) {
    if (ad.status !== "active") continue;
    if (!ad.expiresAt) continue;
    if (+new Date(ad.expiresAt) > now) continue;
    /* A paid campaign that is still running keeps its ad alive. The client
       bought a window of exposure; ending it early because the free 30-day
       clock ran out would be taking money for nothing. */
    if (ad.promotion && +new Date(ad.promotion.expiresAt) > now) continue;
    ad.status = "expired";
    ad.updatedAt = new Date(now).toISOString();
    changed = true;
  }

  /* Login codes and sessions are garbage-collected on the same pass so the
     store does not grow forever with dead credentials. */
  const codesBefore = db.loginCodes.length;
  db.loginCodes = db.loginCodes.filter((c) => +new Date(c.expiresAt) > now);
  const sessionsBefore = db.sessions.length;
  db.sessions = db.sessions.filter((sn) => +new Date(sn.expiresAt) > now);
  if (db.loginCodes.length !== codesBefore || db.sessions.length !== sessionsBefore) changed = true;

  return changed;
}

function load(): DB {
  if (g.__valmontAdsDB) {
    if (sweep(g.__valmontAdsDB)) persist();
    return g.__valmontAdsDB;
  }

  let db: DB | null = null;
  if (MODE === "file") {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        if (parsed && Array.isArray(parsed.ads)) {
          /* Spread over emptyDB() so a store written by an older build, before
             sessions existed, gains the new arrays instead of crashing on
             undefined.push. */
          db = { ...emptyDB(), ...parsed } as DB;
          if (!Array.isArray(db.loginCodes)) db.loginCodes = [];
          if (!Array.isArray(db.sessions)) db.sessions = [];
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

/* ------------------------------------------------- seller reputation (public) */

export function isVerifiedSeller(phone: string): boolean {
  return load().verifiedSellers.includes(phone);
}

/** Public reputation for one seller — badges buyers can see. */
export function getSellerStats(phone: string): SellerStats | null {
  const db = load();
  const p = normalisePhone(phone) ?? phone;
  if (!db.ads.some((a) => a.sellerPhone === p)) return null;
  return sellerStats(p, db.ads, db.leads, db.verifiedSellers.includes(p));
}

/** Admin-only: grant or remove the manual ID-verified badge. */
export function setVerified(phone: string, verified: boolean): SellerStats | null {
  const db = load();
  const p = normalisePhone(phone) ?? phone;
  if (!db.ads.some((a) => a.sellerPhone === p)) return null;
  const has = db.verifiedSellers.includes(p);
  if (verified && !has) db.verifiedSellers.push(p);
  if (!verified && has) db.verifiedSellers = db.verifiedSellers.filter((x) => x !== p);
  persist();
  return sellerStats(p, db.ads, db.leads, db.verifiedSellers.includes(p));
}

/** Stats for many sellers at once — one pass over the DB instead of one per
    ad card. Returns a phone → stats map for the callers that render grids. */
export function sellerStatsFor(phones: string[]): Map<string, SellerStats> {
  const db = load();
  const out = new Map<string, SellerStats>();
  for (const raw of new Set(phones)) {
    const phone = normalisePhone(raw);
    if (!phone) continue;
    out.set(raw, sellerStats(phone, db.ads, db.leads, db.verifiedSellers.includes(phone)));
  }
  return out;
}

/** Leaderboard for the admin console + a future "top sellers" page. */
export function topSellers(limit = 10): SellerStats[] {
  const db = load();
  const phones = [...new Set(db.ads.map((a) => a.sellerPhone))];
  return phones
    .map((p) => sellerStats(p, db.ads, db.leads, db.verifiedSellers.includes(p)))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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

/* ---------------------------------------------------------------------------
   Sponsored slots.

   The obvious way to sell promotion is to float paid ads to the top of every
   page. It is also the way to make the site feel like an advert board: a buyer
   who scrolls three pages and sees the same shop five times stops trusting the
   listings and leaves, which destroys the free audience the paid layer is
   being sold against.

   So paid placement is rationed instead:
     - at most SPONSORED_PER_PAGE paid ads on any page of results;
     - never the first card — organic content leads, always;
     - a campaign appears at most once per page, no stacking;
     - campaigns ROTATE by page, and with few clients there are REST PAGES
       carrying no paid ads at all, so nobody follows a buyer down the list;
     - on the default view a paid ad occupies its sponsored slot INSTEAD of its
       organic position, never both, so buying placement can never multiply how
       often one shop is seen. Every other sort and filter ignores money
       completely and shows paid ads in their honest position.
   ------------------------------------------------------------------------- */
export const SPONSORED_PER_PAGE = 2;
/* Never let paid ads exceed ~1 in 6 cards. A flat cap of 2 is fine on a
   12-card page but is a third of a 6-card page, which is what makes a
   marketplace feel like an advert board. */
export function slotBudget(perPage: number): number {
  return Math.max(0, Math.min(SPONSORED_PER_PAGE, Math.floor(perPage / 6)));
}
const SPONSORED_SLOTS = [2, 7]; // 0-based: third card, then eighth

/** Which campaigns get a bonus slot on this page. Empty on most pages.

    A promotion buys a BOUNDED amount of extra exposure, not a recurring one.
    Each campaign is dealt exactly one bonus slot across the whole result set,
    on a deterministic page, so a client can never reappear again and again as
    a buyer scrolls — which is the thing that makes a marketplace feel like an
    advert board. Campaigns that do not fit still appear organically, because
    nothing is ever removed from the listing. */
function sponsoredForPage(live: Ad[], page: number, maxSlots: number): Ad[] {
  if (live.length === 0 || maxSlots <= 0 || page < 1) return [];
  const from = (page - 1) * maxSlots;
  return live.slice(from, from + maxSlots);
}

/** Drop the chosen campaigns into fixed slots, never position 0. */
function insertSponsored(pageItems: Ad[], chosen: Ad[]): Ad[] {
  if (chosen.length === 0 || pageItems.length === 0) return pageItems;

  const out = pageItems.slice();
  const seen = new Set<string>();
  for (let i = 0; i < chosen.length; i++) {
    const ad = chosen[i];
    if (seen.has(ad.id)) continue; // one appearance per campaign per page
    seen.add(ad.id);

    const slot = SPONSORED_SLOTS[i] ?? SPONSORED_SLOTS[SPONSORED_SLOTS.length - 1];
    /* Never the first card, and never past the end of a short page. */
    out.splice(Math.max(1, Math.min(slot, out.length)), 0, ad);
  }
  return out;
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

  /* "Featured" is a free editorial pick by the moderator, not a paid slot, so
     it can lift an ad on the default view without anyone having paid. */
  if (sort === "recent") {
    rows.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
  }

  /* Paid placement.

     Earlier versions LIFTED promoted ads out of the organic list so a paid slot
     replaced their natural position. That quietly broke two things: the paging
     cursor drifted and dropped honest listings, and any campaign that lost the
     rotation vanished from the site altogether — a paying client with an
     invisible ad. Both are far worse than a busy-looking page.

     So nothing is ever removed from the listing. Every ad, paid or not, keeps
     its honest position and stays reachable. On top of that, a small number of
     campaigns per page get ONE bonus slot each:
       - at most slotBudget(perPage) bonus slots (~1 paid card in 6);
       - never the first card;
       - only for a campaign not already visible on this page, so a bonus can
         never make the same shop appear twice on one screen;
       - rotated, with rest pages, so no client follows a buyer down the list.
     Sorting by price or popularity disables bonus slots entirely. */
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), pages);

  const pageItems = rows.slice((safePage - 1) * perPage, safePage * perPage);
  let items = pageItems;
  let bonusSlots = 0;

  if (sort === "recent") {
    /* A campaign that already sits on some page organically has its exposure
       there — giving it a bonus slot as well is what made one shop appear three
       times to a buyer scrolling a small page size. So a bonus slot only ever
       goes to a campaign whose organic position is FURTHER ON than this page,
       and it is dealt exactly once. Net effect: each campaign is seen once,
       earlier than it would have been. That is what the money buys. */
    const organicPage = new Map<string, number>();
    rows.forEach((a, i) => {
      if (isPromoted(a)) organicPage.set(a.id, Math.floor(i / perPage) + 1);
    });

    /* Strictly further on than the NEXT page. A bonus insert shifts the rows
       after it, so an ad whose organic home is the very next page can slide
       back onto it and be seen twice; requiring a gap of one page removes that
       overlap without needing to model the shift exactly. */
    const eligible = rows.filter((a) => isPromoted(a) && (organicPage.get(a.id) ?? 0) > safePage + 1);

    /* Spend only the budget this page has not already used organically. If paid
       ads happen to rank here on their own merit, that IS the exposure — piling
       bonus slots on top is what turns a listing into an advert board. */
    const alreadyPaid = pageItems.filter((a) => isPromoted(a)).length;
    const remaining = Math.max(0, slotBudget(perPage) - alreadyPaid);
    const chosen = sponsoredForPage(eligible, safePage, remaining);

    /* Deliberately NOT truncated back to perPage: trimming the tail would push
       an honest listing off the page and it would never reappear, since the
       next page starts at a fixed offset. A page one or two cards longer is a
       trivial cost next to a seller's ad silently disappearing. */
    bonusSlots = chosen.length;
    items = insertSponsored(pageItems, chosen);
  }

  return { items, total, page: safePage, pages, perPage, bonusSlots };
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

/* ------------------------------------------------- seller login (sessions)

   Free classifieds sellers do not have accounts and should not need one. What
   we do need is proof that the person asking to see a number's private
   messages actually holds that number. A one-time code does that with no
   signup, and it is the same flow every Ghanaian already uses for MoMo.  */

/** Step 1: send a code. Rate-limited so this cannot be used to spam a number. */
export function requestLoginCode(
  rawPhone: string,
): { ok: true; phone: string; code: string; resendIn: number } | { ok: false; error: string; retryIn?: number } {
  const db = load();
  const phone = normalisePhone(rawPhone);
  if (!phone) return { ok: false, error: "Enter a valid Ghana phone number (e.g. 0241234567)" };

  /* Only numbers that have actually posted can log in. Otherwise this endpoint
     becomes a free way to send SMS to any number in Ghana on our bill. */
  if (!db.ads.some((a) => a.sellerPhone === phone)) {
    return { ok: false, error: "No ads found on that number. Post an ad first." };
  }

  const now = Date.now();
  const existing = db.loginCodes.find((c) => c.phone === phone);
  if (existing) {
    const since = now - +new Date(existing.sentAt);
    if (since < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        error: "A code was just sent. Wait a moment before asking for another.",
        retryIn: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000),
      };
    }
  }

  const code = generateCode();
  const entry: LoginCode = {
    phone,
    codeHash: hashCode(phone, code),
    expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
    attempts: 0,
    sentAt: new Date(now).toISOString(),
  };
  db.loginCodes = db.loginCodes.filter((c) => c.phone !== phone);
  db.loginCodes.push(entry);
  persist();

  return { ok: true, phone, code, resendIn: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
}

/** Step 2: exchange a correct code for a session token. */
export function verifyLoginCode(
  rawPhone: string,
  code: string,
): { ok: true; token: string; phone: string; expiresAt: string } | { ok: false; error: string } {
  const db = load();
  const phone = normalisePhone(rawPhone);
  if (!phone) return { ok: false, error: "Enter a valid Ghana phone number" };

  const entry = db.loginCodes.find((c) => c.phone === phone);
  if (!entry) return { ok: false, error: "No code was requested for that number, or it has expired" };

  if (+new Date(entry.expiresAt) <= Date.now()) {
    db.loginCodes = db.loginCodes.filter((c) => c.phone !== phone);
    persist();
    return { ok: false, error: "That code has expired. Ask for a new one." };
  }

  /* Burn the code after a handful of wrong guesses — six digits is only a
     million combinations and an unlimited retry loop walks straight through
     that. */
  if (entry.attempts >= MAX_ATTEMPTS) {
    db.loginCodes = db.loginCodes.filter((c) => c.phone !== phone);
    persist();
    return { ok: false, error: "Too many wrong tries. Ask for a new code." };
  }

  const supplied = String(code || "").replace(/\D/g, "");
  if (!codeMatches(phone, supplied, entry.codeHash)) {
    entry.attempts += 1;
    persist();
    const left = MAX_ATTEMPTS - entry.attempts;
    return { ok: false, error: left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Ask for a new code." };
  }

  db.loginCodes = db.loginCodes.filter((c) => c.phone !== phone);

  const now = Date.now();
  const session: Session = {
    token: newToken(),
    phone,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  db.sessions.push(session);
  persist();

  return { ok: true, token: session.token, phone, expiresAt: session.expiresAt };
}

/** Which phone number, if any, does this token prove ownership of? */
export function phoneForToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const db = load();
  const session = db.sessions.find((sn) => sn.token === token);
  if (!session) return null;
  if (+new Date(session.expiresAt) <= Date.now()) return null;
  return session.phone;
}

export function endSession(token: string | null | undefined): boolean {
  if (!token) return false;
  const db = load();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((sn) => sn.token !== token);
  if (db.sessions.length === before) return false;
  persist();
  return true;
}

/* ------------------------------------------------ seller-owned ad changes

   Everything below takes the phone number proved by a session token and
   refuses to touch an ad belonging to anyone else. The ownership check is
   deliberately repeated in each function rather than assumed at the route:
   the store is the last line of defence and it should not depend on a caller
   remembering to check.  */

const SELLER_EDITABLE_STATUSES: AdStatus[] = ["pending", "active", "expired"];

/**
 * Edit an ad you own.
 *
 * Only the fields a seller has a legitimate reason to change after posting.
 * Category, region and phone number are deliberately NOT editable: those are
 * what buyers filtered on to find the ad, and letting a seller swap a cheap
 * phone listing into a car listing after approval is the oldest trick in
 * classifieds. Anyone who genuinely needs a different category posts again.
 *
 * A material edit sends the ad back to pending, because otherwise editing is a
 * hole straight through moderation: post something clean, get approved, then
 * rewrite it as a scam. Cosmetic edits (price, photos) do not re-queue.
 */
export function updateAdBySeller(
  idOrRef: string,
  phone: string,
  patch: { title?: string; description?: string; price?: number | null; negotiable?: boolean; condition?: Ad["condition"]; images?: string[]; town?: string },
): { ok: true; ad: Ad; requeued: boolean } | { ok: false; error: string; status: number } {
  const db = load();
  const ad = db.ads.find((a) => a.id === idOrRef || a.ref === idOrRef || a.slug === idOrRef);
  if (!ad) return { ok: false, error: "Ad not found", status: 404 };
  if (ad.sellerPhone !== phone) return { ok: false, error: "That is not your ad", status: 403 };
  if (!SELLER_EDITABLE_STATUSES.includes(ad.status)) {
    return { ok: false, error: `A ${ad.status} ad cannot be edited`, status: 400 };
  }

  let requeued = false;

  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (title.length < 6) return { ok: false, error: "Title must be at least 6 characters", status: 400 };
    if (title.length > 90) return { ok: false, error: "Title must be 90 characters or fewer", status: 400 };
    if (title !== ad.title) {
      ad.title = title;
      requeued = true;
    }
  }

  if (patch.description !== undefined) {
    const description = String(patch.description).trim();
    if (description.length < 20) return { ok: false, error: "Description must be at least 20 characters", status: 400 };
    if (description !== ad.description) {
      ad.description = description;
      requeued = true;
    }
  }

  if (patch.price !== undefined) {
    const price = patch.price === null ? null : Number(patch.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return { ok: false, error: "Price must be a positive number, or blank", status: 400 };
    }
    ad.price = price;
  }

  if (patch.negotiable !== undefined) ad.negotiable = Boolean(patch.negotiable);
  if (patch.condition !== undefined) ad.condition = patch.condition;
  if (patch.images !== undefined) ad.images = patch.images.slice(0, 6);
  if (patch.town !== undefined) ad.town = String(patch.town).trim() || ad.region;

  /* Re-screen the new words. An edit that introduces a blocked phrase is
     rejected outright, exactly as it would have been at posting time. */
  if (requeued) {
    const verdict = screen(
      {
        title: ad.title,
        description: ad.description,
        price: ad.price,
        category: ad.category,
        subcategory: ad.subcategory,
        region: ad.region,
        town: ad.town,
        images: ad.images,
        sellerName: ad.sellerName,
        sellerPhone: ad.sellerPhone,
        sellerType: ad.sellerType,
      },
      ad.context ?? {},
      historyFor(ad.sellerPhone),
    );
    ad.flags = verdict.flags;
    ad.riskScore = verdict.score;
    if (verdict.block) {
      ad.status = "rejected";
      ad.rejectionReason = verdict.reason;
    } else if (ad.status === "active") {
      ad.status = "pending";
    }
  }

  /* An expired ad that gets edited is being actively tended, so give it a
     fresh 30 days rather than leaving it invisible. */
  if (ad.status === "expired") {
    ad.status = "pending";
    ad.expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    requeued = true;
  }

  ad.updatedAt = new Date().toISOString();
  persist();
  return { ok: true, ad, requeued };
}

/** Mark your own ad sold — the single most-wanted button on the site. */
export function markSoldBySeller(idOrRef: string, phone: string): { ok: true; ad: Ad } | { ok: false; error: string; status: number } {
  const db = load();
  const ad = db.ads.find((a) => a.id === idOrRef || a.ref === idOrRef || a.slug === idOrRef);
  if (!ad) return { ok: false, error: "Ad not found", status: 404 };
  if (ad.sellerPhone !== phone) return { ok: false, error: "That is not your ad", status: 403 };
  if (ad.status === "sold") return { ok: true, ad };
  if (ad.status !== "active" && ad.status !== "expired") {
    return { ok: false, error: `A ${ad.status} ad cannot be marked sold`, status: 400 };
  }
  ad.status = "sold";
  ad.updatedAt = new Date().toISOString();
  persist();
  return { ok: true, ad };
}

/** Re-list an expired or sold ad for another 30 days. */
export function relistBySeller(idOrRef: string, phone: string): { ok: true; ad: Ad } | { ok: false; error: string; status: number } {
  const db = load();
  const ad = db.ads.find((a) => a.id === idOrRef || a.ref === idOrRef || a.slug === idOrRef);
  if (!ad) return { ok: false, error: "Ad not found", status: 404 };
  if (ad.sellerPhone !== phone) return { ok: false, error: "That is not your ad", status: 403 };
  if (ad.status !== "expired" && ad.status !== "sold") {
    return { ok: false, error: "Only expired or sold ads can be re-listed", status: 400 };
  }
  /* Back through moderation: it may have been months, and prices and rules
     both move. */
  ad.status = "pending";
  ad.expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  ad.updatedAt = new Date().toISOString();
  persist();
  return { ok: true, ad };
}

/**
 * Delete your own ad.
 *
 * A real delete, not a hidden flag: someone who posted their personal phone
 * number and now wants it off the internet should get exactly that. Their
 * leads go with it, since those contain buyers' numbers too and keeping them
 * attached to a deleted ad serves nobody.
 *
 * The one thing kept is the seller's reputation record — deleting a rejected
 * ad must not be a way to wash a bad moderation history — so the count is
 * folded into a tombstone rather than the whole ad being resurrectable.
 */
export function deleteAdBySeller(
  idOrRef: string,
  phone: string,
): { ok: true; deleted: string } | { ok: false; error: string; status: number } {
  const db = load();
  const ad = db.ads.find((a) => a.id === idOrRef || a.ref === idOrRef || a.slug === idOrRef);
  if (!ad) return { ok: false, error: "Ad not found", status: 404 };
  if (ad.sellerPhone !== phone) return { ok: false, error: "That is not your ad", status: 403 };

  /* A rejected ad stays on the books. Otherwise the caution badge is one tap
     away from being erased, which makes it worthless. */
  if (ad.status === "rejected") {
    return { ok: false, error: "A rejected ad cannot be deleted. It stays on your record.", status: 400 };
  }

  db.ads = db.ads.filter((a) => a.id !== ad.id);
  db.leads = db.leads.filter((l) => l.adId !== ad.id);
  persist();
  return { ok: true, deleted: ad.ref };
}

/** Test/demo helper — wipe and re-seed. */
export function resetStore() {
  const db = emptyDB();
  db.ads = seedAds();
  g.__valmontAdsDB = db;
  persist();
  return db;
}
