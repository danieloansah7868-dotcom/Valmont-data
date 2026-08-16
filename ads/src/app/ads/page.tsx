import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import AdCard from "@/components/AdCard";
import Filters from "@/components/Filters";
import SortSelect from "@/components/SortSelect";
import { listAds } from "@/lib/store";
import { CATEGORY_MAP } from "@/lib/taxonomy";
import type { ListQuery } from "@/lib/types";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const cat = CATEGORY_MAP.get(one(sp.category) ?? "");
  const q = one(sp.q);
  const region = one(sp.region);
  const bits = [cat?.name ?? "All ads", region, q ? `“${q}”` : null].filter(Boolean);
  return {
    title: `${bits.join(" · ")} — classifieds in Ghana`,
    description: `Browse ${cat?.name ?? "free classified"} ads${region ? ` in ${region}` : " across Ghana"} on Valmont Ads.`,
  };
}

export default async function AdsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;

  const numOr = (v: string | undefined) => {
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const page = numOr(one(sp.page)) ?? 1;
  const query: ListQuery = {
    q: one(sp.q),
    category: one(sp.category),
    subcategory: one(sp.subcategory),
    region: one(sp.region),
    condition: one(sp.condition),
    min: numOr(one(sp.min)),
    max: numOr(one(sp.max)),
    sort: (one(sp.sort) as ListQuery["sort"]) ?? "recent",
    page,
    perPage: 12,
  };

  const { items, total, pages, page: current } = listAds(query);
  const cat = CATEGORY_MAP.get(query.category ?? "");

  const heading = query.q
    ? `Results for “${query.q}”`
    : cat
      ? `${cat.icon} ${cat.name}`
      : query.region
        ? `Ads in ${query.region}`
        : "All ads in Ghana";

  function pageHref(p: number) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = one(v);
      if (val && k !== "page") next.set(k, val);
    }
    if (p > 1) next.set("page", String(p));
    return `/ads${next.toString() ? `?${next}` : ""}`;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-slate-500">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span>/</span>
        <span className="font-semibold text-[var(--color-navy-900)]">{cat ? cat.name : "All ads"}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-[var(--color-navy-900)] sm:text-3xl">{heading}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} live ad{total === 1 ? "" : "s"}
            {cat ? ` in ${cat.name}` : ""}
            {query.region ? ` · ${query.region}` : ""}
          </p>
        </div>
        <Suspense fallback={null}>
          <SortSelect />
        </Suspense>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Suspense fallback={<div className="hidden lg:block" />}>
          <Filters total={total} />
        </Suspense>

        <div>
          {items.length === 0 ? (
            <div className="rounded-2xl bg-white p-12 text-center ring-1 ring-black/5">
              <p className="text-4xl" aria-hidden>
                🔍
              </p>
              <h2 className="mt-4 text-lg font-black text-[var(--color-navy-900)]">No ads match that search</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                Try fewer filters or a broader keyword. New ads are posted every day.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Link
                  href="/ads"
                  className="rounded-lg bg-[var(--color-navy-900)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--color-navy-700)]"
                >
                  Clear filters
                </Link>
                <Link
                  href="/post"
                  className="rounded-lg bg-[var(--color-orange-brand)] px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Post an ad
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {items.map((ad) => (
                  <AdCard key={ad.id} ad={ad} />
                ))}
              </div>

              {pages > 1 && (
                <nav className="mt-10 flex items-center justify-center gap-1.5" aria-label="Pagination">
                  {current > 1 && (
                    <Link
                      href={pageHref(current - 1)}
                      className="rounded-lg bg-white px-3.5 py-2 text-sm font-bold ring-1 ring-black/5 transition hover:bg-slate-50"
                    >
                      ← Prev
                    </Link>
                  )}
                  {Array.from({ length: pages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === pages || Math.abs(p - current) <= 1)
                    .map((p, i, arr) => (
                      <span key={p} className="flex items-center gap-1.5">
                        {i > 0 && arr[i - 1] !== p - 1 && <span className="px-1 text-slate-400">…</span>}
                        <Link
                          href={pageHref(p)}
                          aria-current={p === current ? "page" : undefined}
                          className={`rounded-lg px-3.5 py-2 text-sm font-bold ring-1 transition ${
                            p === current
                              ? "bg-[var(--color-navy-900)] text-white ring-transparent"
                              : "bg-white ring-black/5 hover:bg-slate-50"
                          }`}
                        >
                          {p}
                        </Link>
                      </span>
                    ))}
                  {current < pages && (
                    <Link
                      href={pageHref(current + 1)}
                      className="rounded-lg bg-white px-3.5 py-2 text-sm font-bold ring-1 ring-black/5 transition hover:bg-slate-50"
                    >
                      Next →
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
