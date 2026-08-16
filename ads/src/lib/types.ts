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
  views: number;
  leads: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  rejectionReason?: string;
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
