import Link from "next/link";
import type { Ad } from "@/lib/types";
import { cedis, timeAgo } from "@/lib/format";
import { CATEGORY_MAP } from "@/lib/taxonomy";

export default function AdCard({ ad }: { ad: Ad }) {
  const cat = CATEGORY_MAP.get(ad.category);
  const img = ad.images[0];
  const promo = ad.promotion && +new Date(ad.promotion.expiresAt) > Date.now() ? ad.promotion : null;

  return (
    <Link
      href={`/ads/${ad.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-black/10"
    >
      <div className="relative aspect-4/3 overflow-hidden bg-slate-100">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={ad.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-linear-to-br from-slate-100 to-slate-200 text-5xl">
            <span aria-hidden>{cat?.icon ?? "🏷️"}</span>
          </div>
        )}

        <div className="absolute top-2 left-2 flex gap-1.5">
          {promo && (
            <span className="rounded-md bg-[var(--color-navy-900)] px-2 py-1 text-[10px] font-black tracking-wide text-white uppercase shadow ring-1 ring-white/20">
              Sponsored
            </span>
          )}
          {ad.featured && !promo && (
            <span className="rounded-md bg-[var(--color-orange-brand)] px-2 py-1 text-[10px] font-black tracking-wide text-white uppercase shadow">
              Featured
            </span>
          )}
          {ad.status === "sold" && (
            <span className="rounded-md bg-slate-900/85 px-2 py-1 text-[10px] font-black tracking-wide text-white uppercase">
              Sold
            </span>
          )}
        </div>

        {ad.sellerType === "business" && (
          <span className="absolute top-2 right-2 rounded-md bg-white/95 px-2 py-1 text-[10px] font-bold text-[var(--color-navy-900)] shadow-sm">
            ✔ Business
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="line-clamp-2 text-sm leading-snug font-bold text-[var(--color-navy-900)] group-hover:text-[var(--color-navy-700)]">
          {ad.title}
        </h3>

        <p className="mt-2 text-base font-black text-[var(--color-navy-900)]">
          {cedis(ad.price)}
          {ad.negotiable && ad.price !== null && (
            <span className="ml-1.5 align-middle text-[10px] font-bold text-emerald-600">NEG</span>
          )}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] text-slate-500">
          <span className="truncate">📍 {ad.town}</span>
          <span className="shrink-0">{timeAgo(ad.createdAt)}</span>
        </div>

        {promo && (
          <p className="mt-2 truncate border-t border-dashed border-slate-100 pt-2 text-[10px] font-semibold text-slate-400">
            Paid promotion by {promo.clientName}
          </p>
        )}
      </div>
    </Link>
  );
}
