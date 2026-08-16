import Link from "next/link";
import { CATEGORIES } from "@/lib/taxonomy";

export default function SiteFooter() {
  return (
    <footer className="mt-20 bg-[var(--color-navy-900)] text-white/70">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 text-white">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-orange-brand)] text-lg font-black text-[var(--color-navy-900)]">
              V
            </span>
            <span className="text-lg font-black">
              Valmont<span className="text-[var(--color-orange-brand)]">Ads</span>
            </span>
          </div>
          <p className="mt-4 text-sm leading-relaxed">
            Ghana&apos;s free classifieds marketplace. Post an ad in under two minutes, reach buyers in every
            region, and deal directly — we never take a cut of your sale.
          </p>
          <p className="mt-4 text-xs text-white/45">A Valmont Group of Companies platform · Accra, Ghana</p>
        </div>

        <div>
          <h3 className="text-sm font-bold tracking-wider text-white uppercase">Popular categories</h3>
          <ul className="mt-4 space-y-2 text-sm">
            {CATEGORIES.slice(0, 6).map((c) => (
              <li key={c.slug}>
                <Link href={`/ads?category=${c.slug}`} className="transition hover:text-[var(--color-orange-brand)]">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold tracking-wider text-white uppercase">Marketplace</h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link href="/ads" className="transition hover:text-[var(--color-orange-brand)]">
                Browse all ads
              </Link>
            </li>
            <li>
              <Link href="/post" className="transition hover:text-[var(--color-orange-brand)]">
                Post a free ad
              </Link>
            </li>
            <li>
              <Link href="/my-ads" className="transition hover:text-[var(--color-orange-brand)]">
                Manage my ads
              </Link>
            </li>
            <li>
              <Link href="/safety" className="transition hover:text-[var(--color-orange-brand)]">
                Safety tips
              </Link>
            </li>
            <li>
              <Link href="/admin" className="transition hover:text-[var(--color-orange-brand)]">
                Moderation console
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold tracking-wider text-white uppercase">The rules</h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>✔ Free to post, free to browse</li>
            <li>✔ Every ad reviewed before it goes live</li>
            <li>✔ No fake &ldquo;was&rdquo; prices, ever</li>
            <li>✔ Never pay before you inspect</li>
          </ul>
          <p className="mt-5 text-xs leading-relaxed text-white/45">
            Valmont Ads is a listings platform. We do not handle payments or delivery between buyers and sellers.
          </p>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Valmont Group of Companies · Accra, Ghana</p>
          <p className="text-white/45">Buy and sell safely — meet in public, inspect before you pay.</p>
        </div>
      </div>
    </footer>
  );
}
