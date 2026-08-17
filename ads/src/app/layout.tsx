import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

/* Without this, Next cannot turn a relative OG/Twitter image into the absolute
   URL that WhatsApp and Facebook require — and a shared listing renders with no
   preview image, which matters a lot when most sharing here happens on WhatsApp.
   Set NEXT_PUBLIC_SITE_URL to the real domain at deploy time. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Valmont Ads — Free classifieds in Ghana | Buy & sell anything",
    template: "%s · Valmont Ads",
  },
  description:
    "Post a free ad and reach buyers across Ghana. Phones, cars, property, jobs and services in Greater Accra, Ashanti, Western and every other region. A Valmont Group platform.",
  keywords: ["Ghana classifieds", "buy and sell Ghana", "free ads Accra", "Valmont Ads", "Ghana marketplace"],
  openGraph: {
    title: "Valmont Ads — Free classifieds in Ghana",
    description: "Buy and sell anything in Ghana. Post a free ad in under two minutes.",
    type: "website",
    locale: "en_GH",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1a38",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH">
      <body className="flex min-h-screen flex-col antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
