"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Ad, AdStatus, Lead, PosterProfile, Promotion } from "@/lib/types";
import type { SellerStats } from "@/lib/reputation";
import SellerBadges from "./SellerBadges";
import { cedis, timeAgo } from "@/lib/format";

type QueuedAd = Ad & { poster: PosterProfile | null };

function RiskBadge({ score }: { score: number }) {
  const tone =
    score >= 70
      ? "bg-red-100 text-red-800 ring-red-200"
      : score >= 35
        ? "bg-amber-100 text-amber-900 ring-amber-200"
        : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  const word = score >= 70 ? "High risk" : score >= 35 ? "Check this" : "Looks clean";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ring-1 ${tone}`}>
      {word} · {score}
    </span>
  );
}

type PromoRow = Promotion & {
  id: string;
  ref: string;
  slug: string;
  title: string;
  status: AdStatus;
  live: boolean;
  ctr: number;
};

interface Stats {
  activeAds: number;
  pending: number;
  sold: number;
  rejected: number;
  totalAds: number;
  last24h: number;
  leads: number;
  views: number;
}

const TABS: { key: AdStatus | "all"; label: string }[] = [
  { key: "pending", label: "Pending review" },
  { key: "active", label: "Live" },
  { key: "rejected", label: "Rejected" },
  { key: "sold", label: "Sold" },
  { key: "all", label: "Everything" },
];

export default function AdminConsole() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<AdStatus | "all">("pending");
  const [ads, setAds] = useState<QueuedAd[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [promoting, setPromoting] = useState<Ad | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promotions, setPromotions] = useState<PromoRow[]>([]);
  const [sellers, setSellers] = useState<SellerStats[]>([]);

  const load = useCallback(
    async (pw: string, status: AdStatus | "all") => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin?status=${status}`, { headers: { "x-admin-password": pw } });
        if (res.status === 401) {
          setAuthed(false);
          setError("Wrong password");
          return;
        }
        const data = await res.json();
        setAds(data.ads ?? []);
        setLeads(data.leads ?? []);
        setStats(data.stats ?? null);
        setPromotions(data.promotions ?? []);
        setSellers(data.sellers ?? []);
        setAuthed(true);
        try {
          sessionStorage.setItem("vads_admin_pw", pw);
        } catch {
          /* ignore */
        }
      } catch {
        setError("Could not reach the server");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("vads_admin_pw");
      if (saved) {
        setPassword(saved);
        load(saved, "pending");
      }
    } catch {
      /* ignore */
    }
  }, [load]);

  async function submitPromotion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!promoting) return;
    setPromoError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": password },
      body: JSON.stringify({
        id: promoting.id,
        action: "promote",
        tier: fd.get("tier"),
        clientName: fd.get("clientName"),
        websiteUrl: fd.get("websiteUrl"),
        packageRef: fd.get("packageRef"),
        days: fd.get("days") ? Number(fd.get("days")) : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setPromoError(data.error || "Could not start the promotion");
      return;
    }
    setPromoting(null);
    load(password, tab);
  }

  async function verify(phone: string, on: boolean) {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": password },
      body: JSON.stringify({ phone, action: on ? "verify" : "unverify" }),
    });
    load(password, tab);
  }

  async function act(id: string, action: string, reason?: string) {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": password },
      body: JSON.stringify({ id, action, reason }),
    });
    load(password, tab);
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-8 ring-1 ring-black/5">
        <h1 className="text-2xl font-black text-[var(--color-navy-900)]">Moderation console</h1>
        <p className="mt-2 text-sm text-slate-500">Staff only. Dev password is <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">admin123</code>.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(password, tab);
          }}
          className="mt-6 grid gap-3"
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Admin password"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[var(--color-navy-700)]"
          />
          {error && <p className="text-sm font-bold text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[var(--color-navy-900)] py-3 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] disabled:opacity-60"
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-[var(--color-navy-900)]">Moderation console</h1>
          <p className="mt-1 text-sm text-slate-500">Approve, reject and feature listings.</p>
        </div>
        <button
          onClick={() => {
            setAuthed(false);
            setPassword("");
            try {
              sessionStorage.removeItem("vads_admin_pw");
            } catch {
              /* ignore */
            }
          }}
          className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-600 ring-1 ring-black/5 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>

      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Pending", value: stats.pending, accent: stats.pending > 0 },
            { label: "Live", value: stats.activeAds },
            { label: "Rejected", value: stats.rejected },
            { label: "Sold", value: stats.sold },
            { label: "New (24h)", value: stats.last24h },
            { label: "Leads", value: stats.leads },
          ].map((k) => (
            <div
              key={k.label}
              className={`rounded-2xl p-4 text-center ring-1 ${
                k.accent ? "bg-[var(--color-orange-brand)] text-white ring-transparent" : "bg-white ring-black/5"
              }`}
            >
              <p className={`text-2xl font-black ${k.accent ? "text-white" : "text-[var(--color-navy-900)]"}`}>
                {k.value}
              </p>
              <p className={`mt-0.5 text-[11px] font-bold tracking-wider uppercase ${k.accent ? "text-white/80" : "text-slate-500"}`}>
                {k.label}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-7 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              load(password, t.key);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              tab === t.key
                ? "bg-[var(--color-navy-900)] text-white"
                : "bg-white text-slate-600 ring-1 ring-black/5 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3">
        {ads.length === 0 && (
          <p className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500 ring-1 ring-black/5">
            Nothing in this queue. 🎉
          </p>
        )}

        {ads.map((ad) => (
          <div key={ad.id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                {ad.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.images[0]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-2xl">🏷️</div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/ads/${ad.slug}`} className="font-bold text-[var(--color-navy-900)] hover:underline">
                    {ad.title}
                  </Link>
                  {ad.featured && (
                    <span className="rounded bg-[var(--color-orange-brand)] px-2 py-0.5 text-[10px] font-black text-white uppercase">
                      Featured
                    </span>
                  )}
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600 uppercase">
                    {ad.status}
                  </span>
                  <RiskBadge score={ad.riskScore ?? 0} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {ad.ref} · {cedis(ad.price)} · {ad.town}, {ad.region} · {ad.sellerName} ({ad.sellerPhone}) ·{" "}
                  {timeAgo(ad.createdAt)}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{ad.description}</p>
                {ad.rejectionReason && (
                  <p className="mt-1.5 text-xs font-semibold text-red-600">⚠ {ad.rejectionReason}</p>
                )}

                {/* why this ad smells */}
                {ad.flags && ad.flags.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {ad.flags.map((f, i) => (
                      <li
                        key={`${f.code}-${i}`}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                          f.severity === "block"
                            ? "bg-red-100 text-red-800"
                            : f.severity === "warn"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {f.severity === "block" ? "🚫" : f.severity === "warn" ? "⚠" : "ℹ"} {f.label}
                      </li>
                    ))}
                  </ul>
                )}

                {/* who posted it */}
                {ad.poster && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span className="font-bold text-[var(--color-navy-900)]">
                      {ad.poster.isTrusted ? "✅ Trusted" : ad.poster.isRepeatOffender ? "🚩 Repeat offender" : "👤 Poster"}
                    </span>
                    <span>{ad.poster.network}</span>
                    <span>{ad.poster.totalAds} ads total</span>
                    <span className={ad.poster.rejected > 0 ? "font-bold text-red-600" : ""}>
                      {ad.poster.rejected} rejected ({ad.poster.rejectionRate}%)
                    </span>
                    <span>{ad.poster.sold} sold</span>
                    <span>{ad.poster.adsLast24h} today</span>
                    <span>member {timeAgo(ad.poster.firstSeen)}</span>
                    <button
                      onClick={() => setExpanded(expanded === ad.id ? null : ad.id)}
                      className="font-bold text-[var(--color-navy-700)] underline"
                    >
                      {expanded === ad.id ? "hide details" : "more details"}
                    </button>
                  </div>
                )}

                {expanded === ad.id && (
                  <dl className="mt-2.5 grid gap-x-6 gap-y-1 rounded-lg bg-[var(--color-paper)] p-3 text-[11px] sm:grid-cols-2">
                    {[
                      ["Device", ad.context?.device ?? "unknown"],
                      ["Operating system", ad.context?.os ?? "unknown"],
                      ["Browser", ad.context?.browser ?? "unknown"],
                      ["IP address", ad.context?.ip ?? "not captured"],
                      ["Timezone", ad.context?.timezone ?? "unknown"],
                      ["Language", ad.context?.language ?? "unknown"],
                      [
                        "Time to fill form",
                        ad.context?.fillSeconds !== undefined ? `${ad.context.fillSeconds}s` : "unknown",
                      ],
                      ["Came from", ad.context?.referrer ?? "direct"],
                      ["Risk score", String(ad.riskScore ?? 0)],
                      ["Photos", String(ad.images.length)],
                      ["Categories used", String(ad.poster?.distinctCategories ?? "—")],
                      ["Regions used", String(ad.poster?.distinctRegions ?? "—")],
                      ["Devices seen", ad.poster?.devices.join(", ") || "—"],
                      ["Buyer messages", String(ad.poster?.totalLeads ?? 0)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 border-b border-dashed border-black/5 py-0.5">
                        <dt className="text-slate-500">{k}</dt>
                        <dd className="truncate text-right font-semibold text-[var(--color-navy-900)]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {ad.status !== "active" && (
                  <button
                    onClick={() => act(ad.id, "active")}
                    className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-105"
                  >
                    ✔ Approve
                  </button>
                )}
                {ad.status !== "rejected" && (
                  <button
                    onClick={() => {
                      const reason = prompt("Reason for rejection?", "Does not meet posting rules");
                      if (reason !== null) act(ad.id, "rejected", reason);
                    }}
                    className="rounded-lg bg-red-500 px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-105"
                  >
                    ✕ Reject
                  </button>
                )}
                <button
                  onClick={() => act(ad.id, "feature")}
                  className="rounded-lg bg-[var(--color-orange-brand)] px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-110"
                >
                  ★ {ad.featured ? "Unfeature" : "Feature"}
                </button>
                {ad.promotion ? (
                  <button
                    onClick={() => act(ad.id, "unpromote")}
                    className="rounded-lg bg-[var(--color-navy-900)] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[var(--color-navy-700)]"
                  >
                    ⏹ End promo
                  </button>
                ) : (
                  <button
                    onClick={() => setPromoting(ad)}
                    className="rounded-lg bg-[var(--color-navy-900)] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[var(--color-navy-700)]"
                  >
                    📣 Promote
                  </button>
                )}
                {ad.status !== "sold" && (
                  <button
                    onClick={() => act(ad.id, "sold")}
                    className="rounded-lg bg-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-300"
                  >
                    Mark sold
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── promote modal ─────────────────────────────────────── */}
      {promoting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6">
            <h2 className="text-xl font-black text-[var(--color-navy-900)]">Promote this ad</h2>
            <p className="mt-1 text-sm text-slate-500">
              Sold as an add-on to a Valmont Web package. Every click goes to the client&apos;s own website.
            </p>
            <p className="mt-3 truncate rounded-lg bg-[var(--color-paper)] px-3 py-2 text-sm font-semibold text-[var(--color-navy-900)]">
              {promoting.title}
            </p>

            <form onSubmit={submitPromotion} className="mt-4 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-black tracking-wider text-slate-500 uppercase" htmlFor="p-tier">
                    Tier
                  </label>
                  <select
                    id="p-tier"
                    name="tier"
                    defaultValue="spotlight"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-navy-700)]"
                  >
                    <option value="spotlight">Spotlight — 30 days</option>
                    <option value="boost">Boost — 14 days</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-black tracking-wider text-slate-500 uppercase" htmlFor="p-days">
                    Override days
                  </label>
                  <input
                    id="p-days"
                    name="days"
                    type="number"
                    min="1"
                    max="365"
                    placeholder="default by tier"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-navy-700)]"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black tracking-wider text-slate-500 uppercase" htmlFor="p-client">
                  Client / business name *
                </label>
                <input
                  id="p-client"
                  name="clientName"
                  required
                  defaultValue={promoting.sellerName}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-navy-700)]"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black tracking-wider text-slate-500 uppercase" htmlFor="p-url">
                  Their website URL *
                </label>
                <input
                  id="p-url"
                  name="websiteUrl"
                  required
                  type="url"
                  placeholder="https://clientshop.com"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-navy-700)]"
                />
                <p className="mt-1 text-xs text-slate-500">
                  The site Valmont Web built them. Traffic goes here — we never sit in the middle.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black tracking-wider text-slate-500 uppercase" htmlFor="p-ref">
                  Valmont Web package ref
                </label>
                <input
                  id="p-ref"
                  name="packageRef"
                  placeholder="e.g. VW-2026-0142"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-navy-700)]"
                />
              </div>

              {promoError && <p className="text-sm font-bold text-red-600">{promoError}</p>}

              <div className="mt-2 flex gap-2.5">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-[var(--color-orange-brand)] py-3 text-sm font-extrabold text-white transition hover:brightness-110"
                >
                  Start promotion
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPromoting(null);
                    setPromoError(null);
                  }}
                  className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-600 ring-1 ring-black/10 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── seller reputation ─────────────────────────────────── */}
      {sellers.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-black text-[var(--color-navy-900)]">Seller reputation</h2>
          <p className="mt-1 text-sm text-slate-500">
            Badges are earned automatically. <strong>ID Verified</strong> is the only one you grant by hand — do it
            after meeting the seller or checking their shop.
          </p>
          <div className="mt-4 grid gap-2.5">
            {sellers.map((s) => (
              <div key={s.phone} className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-navy-900)] text-base font-black text-[var(--color-orange-brand)]">
                  {s.name.charAt(0).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <Link href={`/seller/${s.phone}`} className="font-bold text-[var(--color-navy-900)] hover:underline">
                    {s.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {s.phone} · {s.sold} sold · {s.activeAds} live · {s.rejected} rejected · {s.daysActive}d
                  </p>
                  <div className="mt-1.5">
                    <SellerBadges badges={s.badges} size="sm" />
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-2xl font-black text-[var(--color-navy-900)]">{s.score}</p>
                  <p className="text-[10px] tracking-wide text-slate-400 uppercase">score</p>
                </div>

                <div className="text-right">
                  <button
                    onClick={() => verify(s.phone, !s.manualVerified)}
                    className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                      s.manualVerified
                        ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                        : "bg-amber-500 text-white hover:brightness-105"
                    }`}
                  >
                    {s.manualVerified ? "Remove hand check" : "🛡️ I checked them"}
                  </button>
                  {s.verifiedVia === "record" && !s.manualVerified && (
                    <p className="mt-1 text-[10px] font-semibold text-emerald-600">
                      Auto-verified by record
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── campaign report ───────────────────────────────────── */}
      {promotions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-black text-[var(--color-navy-900)]">Paid promotions</h2>
          <p className="mt-1 text-sm text-slate-500">
            Click-throughs to each client&apos;s own website — the number to show them at renewal.
          </p>
          <div className="mt-4 overflow-x-auto rounded-2xl bg-white ring-1 ring-black/5">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-[11px] tracking-wider text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Ad</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Package</th>
                  <th className="px-4 py-3 text-right">Views</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">CTR</th>
                  <th className="px-4 py-3">Ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {promotions.map((p) => (
                  <tr key={p.id} className={p.live ? "" : "opacity-50"}>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-[var(--color-navy-900)]">{p.clientName}</span>
                      {!p.live && <span className="ml-2 text-[10px] font-black text-slate-400 uppercase">expired</span>}
                      <a
                        href={p.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-xs text-slate-500 hover:underline"
                      >
                        {p.websiteUrl}
                      </a>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3">
                      <Link href={`/ads/${p.slug}`} className="hover:underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize">{p.tier}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.packageRef ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{p.impressions.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-[var(--color-navy-900)]">{p.clicks}</td>
                    <td className="px-4 py-3 text-right">{(p.ctr * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">
                      {new Date(p.expiresAt).toLocaleDateString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {leads.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-black text-[var(--color-navy-900)]">Recent buyer messages</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl bg-white ring-1 ring-black/5">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-[11px] tracking-wider text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Ad</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{timeAgo(l.createdAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{l.adRef}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-semibold text-[var(--color-navy-900)]">{l.name}</span>
                      <span className="ml-1.5 font-mono text-xs text-slate-500">{l.phone}</span>
                    </td>
                    <td className="max-w-md truncate px-4 py-3 text-slate-600">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
