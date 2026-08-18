import Link from "next/link";
import type { Metadata } from "next";
import { CATEGORIES } from "@/lib/taxonomy";
import { categoryCounts } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All categories",
  description: "Browse every category on Valmont Ads — phones, vehicles, property, jobs, services and more.",
};

export default function CategoriesPage() {
  const counts = categoryCounts();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-black text-[var(--color-navy-900)]">All categories</h1>
      <p className="mt-2 text-sm text-slate-600">Pick a category to see what people are selling near you.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((c) => (
          <div key={c.slug} className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
            <div className="flex items-start justify-between">
              <span className="text-4xl" aria-hidden>
                {c.icon}
              </span>
              <span className="rounded-full bg-[var(--color-paper)] px-3 py-1 text-xs font-bold text-slate-600">
                {counts[c.slug] ?? 0} ads
              </span>
            </div>

            <h2 className="mt-4 text-lg font-black text-[var(--color-navy-900)]">
              <Link href={`/ads?category=${c.slug}`} className="hover:underline">
                {c.name}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-slate-500">{c.blurb}</p>

            <ul className="mt-4 flex flex-wrap gap-1.5">
              {c.subcategories.map((s) => (
                <li key={s}>
                  <Link
                    href={`/ads?category=${c.slug}&subcategory=${encodeURIComponent(s)}`}
                    className="inline-block rounded-full bg-[var(--color-paper)] px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-[var(--color-navy-900)] hover:text-white"
                  >
                    {s}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
