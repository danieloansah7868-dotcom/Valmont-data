"use client";

/* The seller's dashboard.

   Two states: signed out (phone → code) and signed in (their ads, their
   messages, and the buttons to actually manage a listing). Before this, the
   page took any phone number and showed that person's private messages — see
   src/lib/session.ts. */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Ad, Lead } from "@/lib/types";
import { cedis, timeAgo } from "@/lib/format";

const TOKEN_KEY = "vads_session";

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

const CONDITIONS: { value: Ad["condition"]; label: string }[] = [
  { value: "brand-new", label: "Brand new" },
  { value: "used-excellent", label: "Used — excellent" },
  { value: "used-good", label: "Used — good" },
  { value: "used-fair", label: "Used — fair" },
  { value: "not-applicable", label: "Not applicable" },
];

const field =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-navy-700)] focus:ring-2 focus:ring-[var(--color-navy-700)]/10";

function daysLeft(iso: string): number {
  return Math.ceil((+new Date(iso) - Date.now()) / 86_400_000);
}

/* --------------------------------------------------------------- sign in */

function SignIn({ onDone }: { onDone: (token: string) => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", phone }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not send a code");
        return;
      }
      setStage("code");
      /* In development the server hands the code back so the flow can be
         tested without an SMS account. It is never returned in production. */
      setHint(data.devCode ? `Development mode — your code is ${data.devCode}` : "");
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", phone, code }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "That code did not work");
        return;
      }
      try {
        localStorage.setItem(TOKEN_KEY, data.token);
      } catch {
        /* private browsing — the session just won't survive a reload */
      }
      onDone(data.token);
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-6 ring-1 ring-black/5">
      {stage === "phone" ? (
        <form onSubmit={requestCode}>
          <h2 className="text-lg font-black text-[var(--color-navy-900)]">Sign in to manage your ads</h2>
          <p className="mt-1.5 text-sm text-slate-600">
            Enter the number you posted with. We&apos;ll text you a 6-digit code — no password, no account.
          </p>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="0244118822"
            aria-label="Your phone number"
            className={`${field} mt-4`}
          />
          {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-[var(--color-navy-900)] px-6 py-3 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send me a code"}
          </button>
          <p className="mt-4 text-center text-xs text-slate-500">
            Haven&apos;t posted yet?{" "}
            <Link href="/post" className="font-bold text-[var(--color-navy-900)] underline">
              Post a free ad
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          <h2 className="text-lg font-black text-[var(--color-navy-900)]">Enter your code</h2>
          <p className="mt-1.5 text-sm text-slate-600">
            Sent to <span className="font-mono font-bold">{phone}</span>. It expires in 10 minutes.
          </p>
          {hint && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
              {hint}
            </p>
          )}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            aria-label="6-digit code"
            className={`${field} mt-4 text-center font-mono text-2xl tracking-[0.4em]`}
          />
          {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-[var(--color-orange-brand)] px-6 py-3 text-sm font-extrabold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("phone");
              setCode("");
              setError("");
            }}
            className="mt-3 w-full py-2 text-xs font-bold text-slate-500 underline"
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- edit dialog */

function EditPanel({
  ad,
  token,
  onClose,
  onSaved,
}: {
  ad: Ad;
  token: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [title, setTitle] = useState(ad.title);
  const [description, setDescription] = useState(ad.description);
  const [price, setPrice] = useState(ad.price === null ? "" : String(ad.price));
  const [negotiable, setNegotiable] = useState(ad.negotiable);
  const [condition, setCondition] = useState<Ad["condition"]>(ad.condition);
  const [town, setTown] = useState(ad.town);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const wordsChanged = title !== ad.title || description !== ad.description;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/my-ads/${ad.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-session-token": token },
        body: JSON.stringify({
          title,
          description,
          price: price.trim() === "" ? null : Number(price),
          negotiable,
          condition,
          town,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not save");
        return;
      }
      onSaved(data.requeued ? "Saved — back in review because the wording changed." : "Saved.");
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="grid gap-3">
        <label className="block">
          <span className="text-xs font-bold text-slate-600 uppercase">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mt-1`} maxLength={90} />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-600 uppercase">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={`${field} mt-1`}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold text-slate-600 uppercase">Price (GH₵)</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              placeholder="Leave blank to say Contact for price"
              className={`${field} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-600 uppercase">Town</span>
            <input value={town} onChange={(e) => setTown(e.target.value)} className={`${field} mt-1`} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold text-slate-600 uppercase">Condition</span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as Ad["condition"])}
              className={`${field} mt-1`}
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-6 flex items-center gap-2.5 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={negotiable}
              onChange={(e) => setNegotiable(e.target.checked)}
              className="h-5 w-5 rounded"
            />
            Price is negotiable
          </label>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Category, region and phone number can&apos;t be changed — buyers found this ad by those. Post a new ad instead.
      </p>
      {wordsChanged && ad.status === "active" && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
          Changing the title or description sends the ad back for review.
        </p>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--color-navy-900)] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-600 ring-1 ring-slate-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- dashboard */

export default function MyAdsClient() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [phone, setPhone] = useState("");
  const [ads, setAds] = useState<Ad[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    const res = await fetch("/api/my-ads", { headers: { "x-session-token": t } });
    if (res.status === 401) {
      /* Token expired or the store was reset — drop it and show sign-in. */
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      setToken(null);
      return;
    }
    const data = await res.json();
    setAds(data.ads ?? []);
    setLeads(data.leads ?? []);
    setPhone(data.phone ?? "");
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    if (saved) {
      setToken(saved);
      load(saved).finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [load]);

  async function act(adId: string, action: "sold" | "relist") {
    if (!token) return;
    const res = await fetch(`/api/my-ads/${adId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-token": token },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setNotice(data.ok ? (action === "sold" ? "Marked as sold." : "Re-listed — back in review.") : data.error);
    if (data.ok) load(token);
  }

  async function remove(adId: string) {
    if (!token) return;
    const res = await fetch(`/api/my-ads/${adId}`, {
      method: "DELETE",
      headers: { "x-session-token": token },
    });
    const data = await res.json();
    setNotice(data.ok ? "Ad deleted." : data.error);
    setConfirmDelete(null);
    if (data.ok) load(token);
  }

  function signOut() {
    if (token) {
      fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": token },
        body: JSON.stringify({ action: "logout" }),
      }).catch(() => {});
    }
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setAds([]);
    setLeads([]);
  }

  if (!ready) {
    return <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (!token) {
    return (
      <SignIn
        onDone={(t) => {
          setToken(t);
          load(t);
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
        <p className="text-sm text-slate-600">
          Signed in as <span className="font-mono font-bold text-[var(--color-navy-900)]">{phone}</span>
        </p>
        <button onClick={signOut} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500 underline">
          Sign out
        </button>
      </div>

      {notice && (
        <p className="mt-3 rounded-xl bg-[var(--color-navy-900)] px-4 py-3 text-sm font-semibold text-white">
          {notice}
        </p>
      )}

      {ads.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-white p-10 text-center ring-1 ring-black/5">
          <p className="text-4xl" aria-hidden>
            📭
          </p>
          <h2 className="mt-3 text-lg font-black text-[var(--color-navy-900)]">No ads yet</h2>
          <p className="mt-2 text-sm text-slate-500">Post your first ad — it takes two minutes.</p>
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
            {ads.map((ad) => {
              const left = daysLeft(ad.expiresAt);
              return (
                <div key={ad.id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {ad.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ad.images[0]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-2xl">🏷️</div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/ads/${ad.slug}`}
                        className="line-clamp-1 font-bold text-[var(--color-navy-900)] hover:underline"
                      >
                        {ad.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {ad.ref} · {cedis(ad.price)} · posted {timeAgo(ad.createdAt)}
                      </p>
                      {ad.status === "rejected" && ad.rejectionReason && (
                        <p className="mt-1 text-xs font-semibold text-red-600">{ad.rejectionReason}</p>
                      )}
                      {ad.status === "active" && left <= 7 && left > 0 && (
                        <p className="mt-1 text-xs font-semibold text-amber-700">
                          Expires in {left} {left === 1 ? "day" : "days"}
                        </p>
                      )}
                      {ad.status === "expired" && (
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          Expired — re-list it to put it back in front of buyers.
                        </p>
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

                  {/* Actions. Big tap targets — most sellers here are on a phone. */}
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {(ad.status === "active" || ad.status === "pending" || ad.status === "expired") && (
                      <button
                        onClick={() => setEditing(editing === ad.id ? null : ad.id)}
                        className="min-h-11 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-[var(--color-navy-900)] transition hover:bg-slate-200"
                      >
                        ✏️ {editing === ad.id ? "Close" : "Edit"}
                      </button>
                    )}
                    {(ad.status === "active" || ad.status === "expired") && (
                      <button
                        onClick={() => act(ad.id, "sold")}
                        className="min-h-11 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                      >
                        ✅ Mark sold
                      </button>
                    )}
                    {(ad.status === "expired" || ad.status === "sold") && (
                      <button
                        onClick={() => act(ad.id, "relist")}
                        className="min-h-11 rounded-xl bg-[var(--color-orange-brand)]/10 px-4 py-2.5 text-sm font-bold text-[var(--color-orange-brand)] ring-1 ring-[var(--color-orange-brand)]/30 transition hover:bg-[var(--color-orange-brand)]/20"
                      >
                        🔄 Re-list
                      </button>
                    )}
                    {ad.status !== "rejected" &&
                      (confirmDelete === ad.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-red-700">Delete for good?</span>
                          <button
                            onClick={() => remove(ad.id)}
                            className="min-h-11 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white"
                          >
                            Yes, delete
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="min-h-11 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-600 ring-1 ring-slate-200"
                          >
                            Keep it
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(ad.id)}
                          className="min-h-11 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 ring-1 ring-red-100 transition hover:bg-red-100"
                        >
                          🗑️ Delete
                        </button>
                      ))}
                  </div>

                  {editing === ad.id && (
                    <EditPanel
                      ad={ad}
                      token={token}
                      onClose={() => setEditing(null)}
                      onSaved={(msg) => {
                        setEditing(null);
                        setNotice(msg);
                        load(token);
                      }}
                    />
                  )}
                </div>
              );
            })}
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
                      <span className="text-xs text-slate-400">
                        {timeAgo(l.createdAt)} · {l.adRef}
                      </span>
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
    </div>
  );
}
