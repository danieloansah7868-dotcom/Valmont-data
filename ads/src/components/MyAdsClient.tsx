"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Ad, Lead } from "@/lib/types";
import { cedis, timeAgo } from "@/lib/format";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  sold: "bg-slate-100 text-slate-600 ring-slate-200",
  expired: "bg-slate-100 text-slate-500 ring-slate-200",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Live",
  pending: "In review",
  rejected: "Rejected",
  sold: "Sold",
  expired: "Expired",
};

export default function MyAdsClient() {
  const [phone, setPhone] = useState("");
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/my-ads?phone=${encodeURIComponent(value)}`);
      const data = await res.json();
      setAds(data.ads ?? []);
      setLeads(data.leads ?? []);
      try {
        localStorage.setItem("vads_my_phone", value);
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("vads_my_phone");
      if (saved) {
        setPhone(saved);
        lookup(saved);
      }
    } catch {
      /* ignore */
    }
  }, [lookup]);

  const field =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-navy-700)] focus:ring-2 focus:ring-[var(--color-navy-700)]/10";

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(phone);
        }}
        className="flex flex-wrap gap-2.5 rounded-2xl bg-white p-4 ring-1 ring-black/5"
      >
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="Your phone number e.g. 0244118822"
          aria-label="Your phone number"
          className={`${field} min-w-0 flex-1`}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--color-navy-900)] px-6 py-3 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] disabled:opacity-60"
        >
          {busy ? "Looking…" : "Find my ads"}
        </button>
      </form>

      {ads !== null && (
        <>
          {ads.length === 0 ? (
            <div className="mt-6 rounded-2xl bg-white p-10 text-center ring-1 ring-black/5">
              <p className="text-4xl" aria-hidden>
                📭
              </p>
              <h2 className="mt-3 text-lg font-black text-[var(--color-navy-900)]">No ads on that number</h2>
              <p className="mt-2 text-sm text-slate-500">
                Check the number, or post your first ad — it takes two minutes.
              </p>
              <Link
                href="/post"
                className="mt-5 inline-block rounded-xl bg-[var(--color-orange-brand)] px-6 py-3 text-sm font-extrabold text-white transition hover:brightness-110"
              >
                Post a free ad
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Total ads", value: ads.length },
                  { label: "Live", value: ads.filter((a) => a.status === "active").length },
                  { label: "Views", value: ads.reduce((s, a) => s + a.views, 0) },
                  { label: "Messages", value: leads.length },
                ].map((k) => (
                  <div key={k.label} className="rounded-2xl bg-white p-4 text-center ring-1 ring-black/5">
                    <p className="text-2xl font-black text-[var(--color-navy-900)]">{k.value.toLocaleString()}</p>
                    <p className="mt-0.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">{k.label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-3">
                {ads.map((ad) => (
                  <div key={ad.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                    <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {ad.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ad.images[0]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-2xl">🏷️</div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <Link href={`/ads/${ad.slug}`} className="line-clamp-1 font-bold text-[var(--color-navy-900)] hover:underline">
                        {ad.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {ad.ref} · {cedis(ad.price)} · posted {timeAgo(ad.createdAt)}
                      </p>
                      {ad.status === "rejected" && ad.rejectionReason && (
                        <p className="mt-1 text-xs font-semibold text-red-600">{ad.rejectionReason}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-center">
                      <div>
                        <p className="text-sm font-black text-[var(--color-navy-900)]">{ad.views}</p>
                        <p className="text-[10px] tracking-wide text-slate-400 uppercase">views</p>
                      </div>
                      <div>
                        <p className="text-sm font-black text-[var(--color-navy-900)]">{ad.leads}</p>
                        <p className="text-[10px] tracking-wide text-slate-400 uppercase">leads</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-black uppercase ring-1 ${STATUS_STYLE[ad.status]}`}
                      >
                        {STATUS_LABEL[ad.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {leads.length > 0 && (
                <section className="mt-8">
                  <h2 className="text-xl font-black text-[var(--color-navy-900)]">Messages from buyers</h2>
                  <div className="mt-4 grid gap-2.5">
                    {leads.map((l) => (
                      <div key={l.id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-bold text-[var(--color-navy-900)]">
                            {l.name} <span className="ml-1 font-mono text-xs font-semibold text-slate-500">{l.phone}</span>
                          </p>
                          <span className="text-xs text-slate-400">{timeAgo(l.createdAt)} · {l.adRef}</span>
                        </div>
                        <p className="mt-1.5 text-sm text-slate-600">{l.message}</p>
                        <a
                          href={`tel:${l.phone}`}
                          className="mt-3 inline-block rounded-lg bg-[var(--color-navy-900)] px-4 py-2 text-xs font-bold text-white transition hover:bg-[var(--color-navy-700)]"
                        >
                          📞 Call back
                        </a>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {ads === null && (
        <p className="mt-6 rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-black/5">
          Try the demo number <button onClick={() => { setPhone("0244118822"); lookup("0244118822"); }} className="font-mono font-bold text-[var(--color-navy-900)] underline">0244118822</button> to see a seller dashboard with live data.
        </p>
      )}
    </div>
  );
}
