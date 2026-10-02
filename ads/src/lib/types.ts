export type AdStatus = "pending" | "active" | "rejected" | "sold" | "expired";
export type AdCondition = "brand-new" | "used-excellent" | "used-good" | "used-fair" | "not-applicable";

export interface Ad {
  id: string;
  ref: string;
  title: string;
  slug: string;
  category: string;
  subcategory?: string;
  price: number | null;
  negotiable: boolean;
  condition: AdCondition;
  region: string;
  town: string;
  description: string;
  images: string[];
  sellerName: string;
  sellerPhone: string;
  whatsapp: boolean;
  sellerType: "private" | "business";
  status: AdStatus;
  featured: boolean;
  /** Paid placement, sold as a Valmont Web add-on. Absent = ordinary free ad. */
  promotion?: Promotion;
  views: number;
  leads: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  rejectionReason?: string;
  /** Why this ad was flagged. Empty = nothing suspicious found. */
  flags?: Flag[];
  /** 0 = clean. 70+ is auto-rejected. */
  riskScore?: number;
  /** Device/network fingerprint captured when the ad was posted. */
  context?: PostContext;
}

/* ---------------------------------------------------------------------------
   Promotions — the paid layer.

   Bought as an add-on to a Valmont Web package. A promoted ad ALWAYS links out
   to the client's own website: we drive traffic to the shop we built them, we
   never sit between them and their customer. That keeps this consistent with
   the valmontweb.com promise ("100% yours — keys included").
   ------------------------------------------------------------------------- */

export type PromotionTier = "spotlight" | "boost";

export interface Promotion {
  tier: PromotionTier;
  /** Business name as it should appear on the sponsored label. */
  clientName: string;
  /** The client's own domain — where every click goes. Required. */
  websiteUrl: string;
  /** Valmont Web package/invoice reference this promotion was sold under. */
  packageRef?: string;
  startedAt: string;
  expiresAt: string;
  impressions: number;
  clicks: number;
}

/* ---------------------------------------------------------------------------
   Moderation signals.

   Two jobs:
     1. Auto-reject the obvious rubbish so a human never sees it.
     2. For everything else, show the moderator WHY something smells, plus who
        the poster is, so the call takes seconds instead of guesswork.
   ------------------------------------------------------------------------- */

export type FlagSeverity = "block" | "warn" | "info";

export interface Flag {
  code: string;
  /** Plain-English sentence shown in the admin queue. */
  label: string;
  severity: FlagSeverity;
  /** Points added to the ad's risk score. */
  points: number;
}

/** Captured at post time. Best-effort — never trusted for security. */
export interface PostContext {
  ip?: string;
  userAgent?: string;
  device?: string;
  browser?: string;
  os?: string;
  /** Minutes the poster spent filling the form — bots submit instantly. */
  fillSeconds?: number;
  language?: string;
  /** IANA timezone reported by the browser; non-Ghana is worth a look. */
  timezone?: string;
  referrer?: string;
}

/** Everything the moderator needs to judge the person, not just the ad. */
export interface PosterProfile {
  phone: string;
  displayName: string;
  network: "MTN" | "Telecel" | "AirtelTigo" | "Unknown";
  firstSeen: string;
  totalAds: number;
  activeAds: number;
  approved: number;
  rejected: number;
  sold: number;
  /** Rejected ÷ total, as a percentage. */
  rejectionRate: number;
  adsLast24h: number;
  adsLast7d: number;
  distinctCategories: number;
  distinctRegions: number;
  totalLeads: number;
  isRepeatOffender: boolean;
  isTrusted: boolean;
  devices: string[];
  ips: string[];
}

export interface Lead {
  id: string;
  adId: string;
  adRef: string;
  name: string;
  phone: string;
  message: string;
  createdAt: string;
}

export interface Category {
  slug: string;
  name: string;
  icon: string;
  blurb: string;
  subcategories: string[];
}

export interface AdInput {
  title: string;
  category: string;
  subcategory?: string;
  price: number | null;
  negotiable?: boolean;
  condition?: AdCondition;
  region: string;
  town: string;
  description: string;
  images?: string[];
  sellerName: string;
  sellerPhone: string;
  whatsapp?: boolean;
  sellerType?: "private" | "business";
}

export interface ListQuery {
  q?: string;
  category?: string;
  subcategory?: string;
  region?: string;
  min?: number;
  max?: number;
  condition?: string;
  sort?: "recent" | "price-asc" | "price-desc" | "popular";
  status?: AdStatus | "all";
  page?: number;
  perPage?: number;
  featuredFirst?: boolean;
}
