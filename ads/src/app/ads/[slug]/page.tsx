import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AdCard from "@/components/AdCard";
import ContactSeller from "@/components/ContactSeller";
import Gallery from "@/components/Gallery";
import ViewPing from "@/components/ViewPing";
import { getAd, relatedAds, getSellerStats, sellerStatsFor } from "@/lib/store";
import { cedis, timeAgo } from "@/lib/format";
import { CATEGORY_MAP, CONDITION_LABEL } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const ad = getAd(slug);
  if (!ad) return { title: "Ad not found" };
  return {
    title: `${ad.title} — ${cedis(ad.price)} in ${ad.town}`,
    description: ad.description.slice(0, 155),
    openGraph: { title: ad.title, description: ad.description.slice(0, 155), images: ad.images },
  };
}

export default async function AdDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const ad = getAd(slug);
  if (!ad) notFound();

  const cat = CATEGORY_MAP.get(ad.category);
  const related = relatedAds(ad, 4);
  const isActive = ad.status === "active";
  const promo = ad.promotion && +new Date(ad.promotion.expiresAt) > Date.now() ? ad.promotion : null;
  const reputation = getSellerStats(ad.sellerPhone);
  const relatedReps = sellerStatsFor(related.map((r) => r.sellerPhone));

  const specs = [
    { k: "Condition", v: CONDITION_LABEL[ad.condition] ?? ad.condition },
    { k: "Category", v: cat?.name ?? ad.category },
    ad.subcategory ? { k: "Type", v: ad.subcategory } : null,
    { k: "Location", v: `${ad.town}, ${ad.region}` },
    { k: "Ad reference", v: ad.ref },
    { k: "Posted", v: timeAgo(ad.createdAt) },
  ].filter(Boolean) as { k: string; v: string }[];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <ViewPing id={ad.id} />

      <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span>/</span>
        <Link href={`/ads?category=${ad.category}`} className="hover:underline">
          {cat?.name}
        </Link>
        <span>/</span>
        <span className="truncate font-semibold text-[var(--color-navy-900)]">{ad.title}</span>
      </nav>

      {!isActive && (
        <div className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
          {ad.status === "pending" && "⏳ This ad is awaiting moderation — it is not publicly listed yet."}
          {ad.status === "sold" && "✅ This item has been sold."}
          {ad.status === "rejected" && `🚫 This ad was rejected. ${ad.rejectionReason ?? ""}`}
          {ad.status === "expired" && "📅 This ad has expired."}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <Gallery images={ad.images} title={ad.title} icon={cat?.icon ?? "🏷️"} />

          <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-xl leading-snug font-black text-[var(--color-navy-900)] sm:text-2xl">
                {ad.title}
              </h1>
              {ad.featured && (
                <span className="shrink-0 rounded-md bg-[var(--color-orange-brand)] px-2.5 py-1 text-[10px] font-black tracking-wide text-white uppercase">
                  Featured
                </span>
              )}
            </div>

            <p className="mt-3 text-3xl font-black text-[var(--color-navy-900)]">
              {cedis(ad.price)}
              {ad.negotiable && ad.price !== null && (
                <span className="ml-2 align-middle text-xs font-bold text-emerald-600">Negotiable</span>
              )}
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                📍 {ad.town}, {ad.region}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                🏷️ {CONDITION_LABEL[ad.condition]}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                👁️ {ad.views.toLocaleString()} views
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                🕒 {timeAgo(ad.createdAt)}
              </span>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <h2 className="text-sm font-black tracking-wider text-slate-500 uppercase">Description</h2>
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-slate-700">{ad.description}</p>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <h2 className="text-sm font-black tracking-wider text-slate-500 uppercase">Details</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {specs.map((s) => (
                  <div key={s.k} className="flex justify-between gap-3 border-b border-dashed border-slate-100 py-1.5">
                    <dt className="text-sm text-slate-500">{s.k}</dt>
                    <dd className="text-right text-sm font-semibold text-[var(--color-navy-900)]">{s.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[var(--color-navy-900)] p-5 text-white/80">
            <h2 className="text-sm font-black text-white">🛡️ Stay safe on Valmont Ads</h2>
            <ul className="mt-3 grid gap-1.5 text-xs leading-relaxed sm:grid-cols-2">
              <li>• Meet in a busy public place during the day.</li>
              <li>• Inspect and test the item before you pay.</li>
              <li>• Never pay a &ldquo;delivery fee&rdquo; in advance.</li>
              <li>• Wrong-number MoMo transfers cannot be reversed.</li>
            </ul>
            <Link href="/safety" className="mt-3 inline-block text-xs font-bold text-[var(--color-orange-brand)] hover:underline">
              Read all safety tips →
            </Link>
          </div>
        </div>

        <div className="lg:sticky lg:top-40 lg:self-start">
          {promo && (
            <div className="mb-4 rounded-2xl bg-[var(--color-navy-900)] p-5 text-white">
              <p className="text-[10px] font-black tracking-widest text-white/50 uppercase">Sponsored</p>
              <p className="mt-2 text-sm leading-relaxed text-white/80">
                <strong className="text-white">{promo.clientName}</strong> has a full online shop — browse their
                complete range, prices and delivery options on their own website.
              </p>
              <a
                href={`/api/go/${ad.id}`}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="mt-4 block rounded-xl bg-[var(--color-orange-brand)] py-3 text-center text-sm font-extrabold transition hover:brightness-110 active:scale-95"
              >
                Visit {promo.clientName} →
              </a>
              <p className="mt-3 text-[10px] leading-relaxed text-white/40">
                You buy directly from {promo.clientName} on their own site. Valmont Ads takes no commission and
                handles no payment.
              </p>
            </div>
          )}

          <ContactSeller
            adId={ad.id}
            adRef={ad.ref}
            adTitle={ad.title}
            sellerName={ad.sellerName}
            sellerPhone={ad.sellerPhone}
            whatsapp={ad.whatsapp}
            sellerType={ad.sellerType}
            active={isActive}
            reputation={reputation}
          />
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-black text-[var(--color-navy-900)]">Similar ads in {cat?.name}</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {related.map((r) => (
              <AdCard key={r.id} ad={r} reputation={relatedReps.get(r.sellerPhone)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
