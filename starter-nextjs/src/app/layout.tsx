import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Valmont Data — Cheapest Data Bundles Ghana | MTN, Telecel, AirtelTigo",
  description:
    "Ghana's cheapest data bundle marketplace. MTN, Telecel and AirtelTigo non-expiry bundles, MoMo & wallet payment, reseller stores and a developer API. By Valmont Group, Accra.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
