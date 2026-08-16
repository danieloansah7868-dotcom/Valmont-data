"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Ad, AdStatus, Lead } from "@/lib/types";
import { cedis, timeAgo } from "@/lib/format";

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
  const [ads, setAds] = useState<Ad[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {ad.ref} · {cedis(ad.price)} · {ad.town}, {ad.region} · {ad.sellerName} ({ad.sellerPhone}) ·{" "}
                  {timeAgo(ad.createdAt)}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{ad.description}</p>
                {ad.rejectionReason && (
                  <p className="mt-1.5 text-xs font-semibold text-red-600">⚠ {ad.rejectionReason}</p>
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
