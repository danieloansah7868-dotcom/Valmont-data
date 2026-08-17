import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AdCard from "@/components/AdCard";
import SellerBadges from "@/components/SellerBadges";
import ShareAd from "@/components/ShareAd";
import { getSellerStats, listAds } from "@/lib/store";
import { maskPhone, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = Promise<{ phone: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { phone } = await params;
  const seller = getSellerStats(decodeURIComponent(phone));
  if (!seller) return { title: "Seller not found" };
  return {
    title: `${seller.name} — ${seller.activeAds} ads`,
    description: `${seller.name} on Valmont Ads: ${seller.sold} items sold, ${seller.activeAds} live listings.`,
  };
}

export default async function SellerPage({ params }: { params: Params }) {
  const { phone } = await params;
  const seller = getSellerStats(decodeURIComponent(phone));
  if (!seller) notFound();

  const { items } = listAds({ status: "active", perPage: 48, sort: "recent" });
  const theirAds = items.filter((a) => a.sellerPhone === seller.phone);

  const scoreTone =
    seller.score >= 70 ? "text-emerald-600" : seller.score >= 40 ? "text-amber-600" : "text-slate-500";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-slate-500">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span>/</span>
        <span className="font-semibold text-[var(--color-navy-900)]">{seller.name}</span>
      </nav>

      {/* profile header */}
      <div className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <div className="flex flex-wrap items-start gap-5">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[var(--color-navy-900)] text-2xl font-black text-[var(--color-orange-brand)]">
            {seller.name.charAt(0).toUpperCase()}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-black text-[var(--color-navy-900)]">{seller.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {maskPhone(seller.phone)} · member since {timeAgo(seller.firstSeen)}
            </p>
            <div className="mt-3">
              <SellerBadges badges={seller.badges} />
            </div>
          </div>

          <div className="text-center">
            <p className={`text-4xl font-black ${scoreTone}`}>{seller.score}</p>
            <p className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Reputation</p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-4">
          {[
            { k: "Items sold", v: seller.sold },
            { k: "Live ads", v: seller.activeAds },
            { k: "Buyer enquiries", v: seller.leadsReceived },
            { k: "Days active", v: seller.daysActive },
          ].map((s) => (
            <div key={s.k} className="text-center">
              <dt className="text-2xl font-black text-[var(--color-navy-900)]">{s.v}</dt>
              <dd className="mt-0.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">{s.k}</dd>
            </div>
          ))}
        </dl>

        {seller.badges.some((b) => b.code === "caution") && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
            ⚠️ Some of this seller&apos;s ads were removed by moderation. Inspect carefully and never pay in advance.
          </p>
        )}
      </div>

      <div className="mt-4">
        <ShareAd
          title={`${seller.name} on Valmont Ads`}
          price={`${seller.activeAds} live ${seller.activeAds === 1 ? "ad" : "ads"}`}
          town="Ghana"
        />
      </div>

      {/* how badges work */}
      <details className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-black/5">
        <summary className="cursor-pointer text-sm font-bold text-[var(--color-navy-900)]">
          How do sellers earn these badges?
        </summary>
        <ul className="mt-3 grid gap-2 text-sm text-slate-600">
          <li>
            🛡️ <strong>ID Verified</strong> — Valmont checked their ID or business in person.
          </li>
          <li>
            🛡️ <strong>Verified by record</strong> — earned automatically: 5+ sales over 60+ days, 5+ ads, nothing
            ever removed. Nobody met them; the trading record is the evidence, and the badge says so.
          </li>
          <li>✅ <strong>Trusted Seller</strong> — 3+ items sold, no ads ever removed, active 2+ weeks.</li>
          <li>🏆 <strong>Top Seller</strong> — 10 or more completed sales.</li>
          <li>📅 <strong>Long-standing</strong> — 3+ months here with a clean record.</li>
          <li>💬 <strong>Responsive</strong> — has handled 10+ buyer enquiries.</li>
          <li>⚠️ <strong>Take care</strong> — 2 or more of their ads were removed.</li>
          <li>🌱 <strong>New seller</strong> — no history here yet. Not an accusation, just a fact.</li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Badges are earned by behaviour and can be lost. They cannot be bought — paying for a promotion buys
          placement and an orange <strong>Ad · Paid</strong> label, never a trust badge.
        </p>
      </details>

      {/* their ads */}
      <section className="mt-8">
        <h2 className="text-xl font-black text-[var(--color-navy-900)]">
          {theirAds.length} live ad{theirAds.length === 1 ? "" : "s"}
        </h2>
        {theirAds.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-black/5">
            This seller has no live ads right now.
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {theirAds.map((ad) => (
              <AdCard key={ad.id} ad={ad} reputation={seller} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
