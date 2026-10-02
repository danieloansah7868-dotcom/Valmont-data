import type { Category } from "./types";

export const CATEGORIES: Category[] = [
  {
    slug: "phones-tablets",
    name: "Phones & Tablets",
    icon: "📱",
    blurb: "iPhones, Samsung, Tecno, accessories",
    subcategories: ["Mobile Phones", "Tablets", "Accessories", "Smart Watches"],
  },
  {
    slug: "electronics",
    name: "Electronics",
    icon: "💻",
    blurb: "Laptops, TVs, audio, gaming",
    subcategories: ["Laptops", "TVs", "Audio & Speakers", "Gaming", "Cameras"],
  },
  {
    slug: "vehicles",
    name: "Vehicles",
    icon: "🚗",
    blurb: "Cars, motorbikes, spare parts",
    subcategories: ["Cars", "Motorbikes", "Trucks & Buses", "Vehicle Parts"],
  },
  {
    slug: "property",
    name: "Property",
    icon: "🏠",
    blurb: "Rentals, land, houses for sale",
    subcategories: ["Apartments for Rent", "Houses for Sale", "Land & Plots", "Commercial", "Short Let"],
  },
  {
    slug: "home-furniture",
    name: "Home & Furniture",
    icon: "🛋️",
    blurb: "Furniture, appliances, decor",
    subcategories: ["Furniture", "Home Appliances", "Kitchen", "Decor"],
  },
  {
    slug: "fashion",
    name: "Fashion & Beauty",
    icon: "👗",
    blurb: "Clothing, shoes, bags, hair",
    subcategories: ["Clothing", "Shoes", "Bags", "Hair & Beauty", "Jewellery"],
  },
  {
    slug: "jobs",
    name: "Jobs",
    icon: "💼",
    blurb: "Full-time, part-time, gigs",
    subcategories: ["Full Time", "Part Time", "Internships", "Remote"],
  },
  {
    slug: "services",
    name: "Services",
    icon: "🛠️",
    blurb: "Repairs, cleaning, events, tutoring",
    subcategories: ["Repairs", "Cleaning", "Events", "Tutoring", "Building & Trades", "Transport"],
  },
  {
    slug: "business-industrial",
    name: "Business & Industrial",
    icon: "🏭",
    blurb: "Equipment, generators, supplies",
    subcategories: ["Generators", "Printing", "Restaurant Equipment", "Farm Machinery"],
  },
  {
    slug: "agriculture",
    name: "Agriculture & Food",
    icon: "🌾",
    blurb: "Livestock, produce, farm inputs",
    subcategories: ["Livestock", "Produce", "Feeds & Seeds", "Farm Land"],
  },
];

export const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const REGIONS = [
  "Greater Accra",
  "Ashanti",
  "Western",
  "Central",
  "Eastern",
  "Volta",
  "Northern",
  "Bono",
  "Upper East",
  "Upper West",
];

export const TOWNS: Record<string, string[]> = {
  "Greater Accra": ["Accra Central", "East Legon", "Osu", "Spintex", "Tema", "Madina", "Adenta", "Dansoman", "Kasoa", "Achimota"],
  Ashanti: ["Kumasi", "Adum", "Ejisu", "Obuasi", "Konongo", "Asokwa"],
  Western: ["Takoradi", "Sekondi", "Tarkwa", "Axim"],
  Central: ["Cape Coast", "Winneba", "Elmina", "Swedru"],
  Eastern: ["Koforidua", "Nsawam", "Akosombo", "Nkawkaw"],
  Volta: ["Ho", "Keta", "Hohoe", "Aflao"],
  Northern: ["Tamale", "Yendi", "Savelugu"],
  Bono: ["Sunyani", "Techiman", "Berekum"],
  "Upper East": ["Bolgatanga", "Navrongo", "Bawku"],
  "Upper West": ["Wa", "Lawra", "Tumu"],
};

export const CONDITIONS: { value: string; label: string }[] = [
  { value: "brand-new", label: "Brand New" },
  { value: "used-excellent", label: "Used — Excellent" },
  { value: "used-good", label: "Used — Good" },
  { value: "used-fair", label: "Used — Fair" },
  { value: "not-applicable", label: "Not applicable" },
];

export const CONDITION_LABEL: Record<string, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.value, c.label]),
);
