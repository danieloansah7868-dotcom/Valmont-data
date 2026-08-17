/* ============================================================================
   Seller reputation — badges people EARN by behaving well.

   Design rules:
     1. Earned by behaviour, never bought. A promotion buys placement; it can
        never buy a trust badge. The moment badges are for sale they stop
        meaning anything to buyers.
     2. Automatic from real activity (ads sold, replies to buyers, time on the
        site, clean moderation record) — except ID Verified, which is a
        deliberate human check.
     3. Losable. Get rejected repeatedly and the badge goes. A badge that only
        ever goes up is just an age counter.
     4. Honest wording. "Sold 5 items here" is a fact; "Top Seller" alone is
        marketing. Every badge shows the reason behind it.
   ========================================================================== */

import type { Ad, Lead } from "./types";

export type BadgeCode =
  | "verified"
  | "trusted"
  | "established"
  | "quick-replier"
  | "top-seller"
  | "new-seller"
  | "caution";

export interface Badge {
  code: BadgeCode;
  label: string;
  icon: string;
  /** Plain-English reason, shown on hover/tap so it never feels arbitrary. */
  reason: string;
  /** Visual weight: gold = strongest earned trust. */
  tone: "gold" | "green" | "blue" | "grey" | "red";
}

export interface SellerStats {
  phone: string;
  name: string;
  totalAds: number;
  activeAds: number;
  sold: number;
  rejected: number;
  /** Distinct buyers who messaged, across all their ads. */
  leadsReceived: number;
  firstSeen: string;
  daysActive: number;
  /** Manually granted by an admin after checking ID/shop. */
  idVerified: boolean;
  badges: Badge[];
  /** 0-100, shown as "reputation" on the seller's public page. */
  score: number;
}

/* ------------------------------------------------------------------ badges */

export function computeBadges(input: {
  totalAds: number;
  sold: number;
  rejected: number;
  leadsReceived: number;
  daysActive: number;
  idVerified: boolean;
}): Badge[] {
  const { totalAds, sold, rejected, leadsReceived, daysActive, idVerified } = input;
  const badges: Badge[] = [];

  /* Manual human check — the strongest signal, so it must never be automatic. */
  if (idVerified) {
    badges.push({
      code: "verified",
      label: "ID Verified",
      icon: "🛡️",
      reason: "Valmont has checked this seller's ID or business in person",
      tone: "gold",
    });
  }

  /* Sold something, clean record, been around a bit. */
  if (sold >= 3 && rejected === 0 && daysActive >= 14) {
    badges.push({
      code: "trusted",
      label: "Trusted Seller",
      icon: "✅",
      reason: `Sold ${sold} items with no rejected ads in ${daysActive} days`,
      tone: "green",
    });
  }

  if (sold >= 10) {
    badges.push({
      code: "top-seller",
      label: "Top Seller",
      icon: "🏆",
      reason: `${sold} completed sales on Valmont Ads`,
      tone: "gold",
    });
  }

  if (daysActive >= 90 && totalAds >= 5 && rejected === 0) {
    badges.push({
      code: "established",
      label: "Long-standing",
      icon: "📅",
      reason: `Posting here for ${Math.floor(daysActive / 30)} months with a clean record`,
      tone: "blue",
    });
  }

  /* Buyers actually get answers — inferred from repeat lead volume. */
  if (leadsReceived >= 10 && sold >= 1) {
    badges.push({
      code: "quick-replier",
      label: "Responsive",
      icon: "💬",
      reason: `Handled ${leadsReceived} buyer enquiries`,
      tone: "blue",
    });
  }

  /* Warn buyers rather than hide the problem. */
  if (rejected >= 2) {
    badges.push({
      code: "caution",
      label: "Take care",
      icon: "⚠️",
      reason: `${rejected} of this seller's ads were removed by moderation`,
      tone: "red",
    });
  }

  if (totalAds <= 1 && sold === 0 && !idVerified) {
    badges.push({
      code: "new-seller",
      label: "New seller",
      icon: "🌱",
      reason: "First ad on Valmont Ads — meet in public and inspect before paying",
      tone: "grey",
    });
  }

  return badges;
}

/** 0-100 reputation. Deliberately hard to max out without real sales. */
export function computeScore(input: {
  sold: number;
  rejected: number;
  leadsReceived: number;
  daysActive: number;
  idVerified: boolean;
}): number {
  const { sold, rejected, leadsReceived, daysActive, idVerified } = input;
  let score = 0;
  score += Math.min(40, sold * 8); // sales matter most
  score += Math.min(20, leadsReceived * 2); // buyer interest
  score += Math.min(20, Math.floor(daysActive / 9)); // staying power
  if (idVerified) score += 20; // human check
  score -= rejected * 15; // moderation hits hurt
  return Math.max(0, Math.min(100, score));
}

/** Build the full public reputation for one seller. */
export function sellerStats(phone: string, ads: Ad[], leads: Lead[], idVerified: boolean): SellerStats {
  const mine = ads.filter((a) => a.sellerPhone === phone);
  const myIds = new Set(mine.map((a) => a.id));
  const myLeads = leads.filter((l) => myIds.has(l.adId));

  const sorted = mine.slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const firstSeen = sorted[0]?.createdAt ?? new Date().toISOString();
  const daysActive = Math.max(0, Math.floor((Date.now() - +new Date(firstSeen)) / 86_400_000));

  const sold = mine.filter((a) => a.status === "sold").length;
  const rejected = mine.filter((a) => a.status === "rejected").length;

  const base = {
    totalAds: mine.length,
    sold,
    rejected,
    leadsReceived: myLeads.length,
    daysActive,
    idVerified,
  };

  return {
    phone,
    name: sorted[sorted.length - 1]?.sellerName ?? "Seller",
    activeAds: mine.filter((a) => a.status === "active").length,
    firstSeen,
    badges: computeBadges(base),
    score: computeScore(base),
    ...base,
  };
}

/* An ad card has room for exactly one badge, so pick the one a buyer most
   needs to see. Warnings outrank praise: if a seller has had ads rejected,
   that matters more to a buyer than the fact that they also sell a lot. */
const HEADLINE_ORDER: BadgeCode[] = [
  "caution",
  "verified",
  "top-seller",
  "trusted",
  "established",
  "quick-replier",
  "new-seller",
];

export function headlineBadge(badges: Badge[], opts: { includeNew?: boolean } = {}): Badge | null {
  for (const code of HEADLINE_ORDER) {
    /* "New seller" is the default state of every account, so on a grid of ads
       it would print on almost every card and mean nothing. It is worth saying
       on a profile or next to a phone number, where the buyer is deciding. */
    if (code === "new-seller" && !opts.includeNew) continue;
    const hit = badges.find((b) => b.code === code);
    if (hit) return hit;
  }
  return null;
}
