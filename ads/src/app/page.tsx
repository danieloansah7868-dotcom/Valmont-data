import Link from "next/link";
import AdCard from "@/components/AdCard";
import { categoryCounts, listAds, stats } from "@/lib/store";
import { CATEGORIES, REGIONS } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const s = stats();
  const counts = categoryCounts();
  const featured = listAds({ perPage: 4, sort: "recent" }).items.filter((a) => a.featured).slice(0, 4);
  const recent = listAds({ perPage: 12, sort: "recent", featuredFirst: false }).items;
  const popular = listAds({ perPage: 4, sort: "popular" }).items;

  return (
    <>
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[var(--color-navy-900)] text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 -right-28 h-96 w-96 rounded-full bg-[var(--color-orange-brand)]/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-sky-400/10 blur-3xl"
        />

        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
            <div className="animate-fade-up">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {s.activeAds} live ads · {s.regions} regions · {s.last24h} posted today
              </span>

              <h1 className="mt-5 text-4xl leading-[1.05] font-black tracking-tight sm:text-5xl lg:text-6xl">
                Buy and sell anything <br />
                <span className="text-[var(--color-orange-brand)]">in Ghana.</span> Free.
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
                Post your ad in under two minutes and reach buyers from Accra to Tamale. Free to post, and we never
                touch your money — you agree your own price and get paid directly.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/post"
                  className="rounded-xl bg-[var(--color-orange-brand)] px-6 py-3.5 text-sm font-extrabold shadow-lg shadow-orange-900/20 transition hover:brightness-110 active:scale-95"
                >
                  + Post a free ad
                </Link>
                <Link
                  href="/ads"
                  className="rounded-xl bg-white/10 px-6 py-3.5 text-sm font-extrabold ring-1 ring-white/20 transition hover:bg-white/15 active:scale-95"
                >
                  Browse {s.activeAds} ads →
                </Link>
              </div>

              <p className="mt-6 text-xs text-white/50">
                ✔ Free to post &nbsp;·&nbsp; ✔ Every ad reviewed before it goes live &nbsp;·&nbsp; ✔ Ghana-wide
                reach
              </p>
            </div>

            {/* trending panel */}
            <div className="animate-fade-up rounded-2xl bg-white/5 p-5 ring-1 ring-white/10 backdrop-blur-sm">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-black tracking-wider uppercase">🔥 Most viewed this week</h2>
              </div>
              <div className="mt-4 grid gap-2.5">
                {popular.map((ad, i) => (
                  <Link
                    key={ad.id}
                    href={`/ads/${ad.slug}`}
                    className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5 transition hover:bg-white/10"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--color-orange-brand)]/20 text-xs font-black text-[var(--color-orange-brand)]">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{ad.title}</span>
                      <span className="block text-[11px] text-white/50">
                        {ad.town} · {ad.views.toLocaleString()} views
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-black text-[var(--color-orange-brand)]">
                      {ad.price === null ? "—" : `GH₵${ad.price.toLocaleString()}`}
                    </span>
                  </Link>
                ))}
              </div>
              <Link
                href="/ads?sort=popular"
                className="mt-4 block rounded-lg bg-white/10 py-2.5 text-center text-xs font-bold transition hover:bg-white/15"
              >
                See all trending ads →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ──────────────────────────────────────── */}
      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-black/5 px-4 sm:grid-cols-4">
          {[
            { label: "Live ads", value: s.activeAds.toLocaleString() },
            { label: "Total views", value: s.views.toLocaleString() },
            { label: "Active sellers", value: s.sellers.toLocaleString() },
            { label: "Regions covered", value: `${s.regions}/10` },
          ].map((k) => (
            <div key={k.label} className="px-3 py-6 text-center">
              <p className="text-2xl font-black text-[var(--color-navy-900)] sm:text-3xl">{k.value}</p>
              <p className="mt-1 text-[11px] font-bold tracking-wider text-slate-500 uppercase">{k.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CATEGORIES ───────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-widest text-[var(--color-orange-brand)] uppercase">
              Browse by category
            </p>
            <h2 className="mt-2 text-2xl font-black text-[var(--color-navy-900)] sm:text-3xl">
              Everything Ghanaians buy and sell
            </h2>
          </div>
          <Link href="/categories" className="hidden shrink-0 text-sm font-bold text-[var(--color-navy-700)] hover:underline sm:block">
            All categories →
          </Link>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/ads?category=${c.slug}`}
              className="group rounded-2xl bg-white p-4 ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="text-3xl" aria-hidden>
                {c.icon}
              </span>
              <h3 className="mt-3 text-sm leading-tight font-bold text-[var(--color-navy-900)]">{c.name}</h3>
              <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{c.blurb}</p>
              <p className="mt-2.5 text-[11px] font-bold text-[var(--color-orange-brand)]">
                {counts[c.slug] ?? 0} ads →
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── FEATURED ─────────────────────────────────────────── */}
      {featured.length > 0 && (
        <section className="bg-white py-14">
          <div className="mx-auto max-w-7xl px-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black tracking-widest text-[var(--color-orange-brand)] uppercase">
                  Featured
                </p>
                <h2 className="mt-2 text-2xl font-black text-[var(--color-navy-900)] sm:text-3xl">
                  Hand-picked listings
                </h2>
              </div>
              <Link href="/ads" className="hidden shrink-0 text-sm font-bold text-[var(--color-navy-700)] hover:underline sm:block">
                View all →
              </Link>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {featured.map((ad) => (
                <AdCard key={ad.id} ad={ad} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── RECENT ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-widest text-[var(--color-orange-brand)] uppercase">
              Fresh listings
            </p>
            <h2 className="mt-2 text-2xl font-black text-[var(--color-navy-900)] sm:text-3xl">Just posted</h2>
          </div>
          <Link href="/ads" className="hidden shrink-0 text-sm font-bold text-[var(--color-navy-700)] hover:underline sm:block">
            See everything →
          </Link>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {recent.map((ad) => (
            <AdCard key={ad.id} ad={ad} />
          ))}
        </div>

        <div className="mt-9 text-center">
          <Link
            href="/ads"
            className="inline-block rounded-xl bg-[var(--color-navy-900)] px-7 py-3.5 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] active:scale-95"
          >
            Browse all {s.activeAds} ads
          </Link>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4">
          <div className="text-center">
            <p className="text-xs font-black tracking-widest text-[var(--color-orange-brand)] uppercase">
              How it works
            </p>
            <h2 className="mt-2 text-2xl font-black text-[var(--color-navy-900)] sm:text-3xl">
              Selling takes two minutes
            </h2>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                n: "1",
                t: "Post your ad",
                d: "Add a clear title, an honest description and your price. No account required — just your phone number.",
              },
              {
                n: "2",
                t: "We review it",
                d: "Every listing passes automated screening plus a human check, so buyers trust what they see.",
              },
              {
                n: "3",
                t: "Buyers call you",
                d: "Your number and WhatsApp button appear on the ad. Agree, meet in public, inspect, get paid.",
              },
            ].map((step) => (
              <div key={step.n} className="rounded-2xl bg-[var(--color-paper)] p-6 ring-1 ring-black/5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-navy-900)] text-lg font-black text-[var(--color-orange-brand)]">
                  {step.n}
                </span>
                <h3 className="mt-4 text-lg font-black text-[var(--color-navy-900)]">{step.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── REGIONS ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-black text-[var(--color-navy-900)]">Browse by region</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <Link
              key={r}
              href={`/ads?region=${encodeURIComponent(r)}`}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--color-navy-900)] ring-1 ring-black/5 transition hover:bg-[var(--color-navy-900)] hover:text-white"
            >
              {r}
            </Link>
          ))}
        </div>
      </section>

      {/* ── SISTER PRODUCT: VALMONT WEB ──────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-10">
        <div className="grid items-center gap-8 rounded-3xl bg-white p-8 ring-1 ring-black/5 sm:p-10 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="text-xs font-black tracking-widest text-[var(--color-orange-brand)] uppercase">
              Selling every week?
            </p>
            <h2 className="mt-2 text-2xl font-black text-[var(--color-navy-900)] sm:text-3xl">
              An ad sells one item. A website builds a business.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
              Valmont Ads is a noticeboard — brilliant for shifting a phone, a car or a spare plot fast. But a
              listing expires, and the customer belongs to the search, not to you. If you sell regularly, our
              sister company <strong className="text-[var(--color-navy-900)]">Valmont Web Services</strong> builds
              you a real shop at your own address: your brand, your customer list, MoMo and card paid straight
              into your account.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="https://valmontweb.com"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-[var(--color-navy-900)] px-6 py-3.5 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] active:scale-95"
              >
                See what they build →
              </a>
              <Link
                href="/post"
                className="rounded-xl bg-white px-6 py-3.5 text-sm font-extrabold text-[var(--color-navy-900)] ring-1 ring-black/10 transition hover:bg-slate-50 active:scale-95"
              >
                Just post an ad for now
              </Link>
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--color-paper)] p-6 ring-1 ring-black/5">
            <p className="text-xs font-black tracking-wider text-slate-500 uppercase">Which one do I need?</p>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="font-bold text-[var(--color-navy-900)]">Valmont Ads — free</dt>
                <dd className="mt-0.5 text-slate-600">
                  One-off items. Live in minutes, expires in 30 days.
                </dd>
              </div>
              <div className="border-t border-black/5 pt-3">
                <dt className="font-bold text-[var(--color-navy-900)]">Valmont Web — from GH₵3,500</dt>
                <dd className="mt-0.5 text-slate-600">
                  Permanent shop, your own domain, checkout, repeat customers.
                </dd>
              </div>
              <div className="border-t border-black/5 pt-3">
                <dt className="font-bold text-[var(--color-navy-900)]">+ Promotion add-on</dt>
                <dd className="mt-0.5 text-slate-600">
                  We feature your products here and send every click to your own site.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-4">
        <div className="relative overflow-hidden rounded-3xl bg-[var(--color-navy-900)] px-6 py-14 text-center text-white sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-20 -right-10 h-64 w-64 rounded-full bg-[var(--color-orange-brand)]/20 blur-3xl"
          />
          <div className="relative">
            <h2 className="text-2xl font-black sm:text-4xl">Got something to sell?</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base">
              Thousands of buyers are searching right now. Listing is free and always will be.
            </p>
            <Link
              href="/post"
              className="mt-7 inline-block rounded-xl bg-[var(--color-orange-brand)] px-8 py-4 text-sm font-extrabold shadow-lg transition hover:brightness-110 active:scale-95"
            >
              Post your free ad now
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
