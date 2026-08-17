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
