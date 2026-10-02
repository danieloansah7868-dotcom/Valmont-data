"use client";

import Link from "next/link";
import { useState } from "react";
import { maskPhone, prettyPhone, waLink } from "@/lib/format";
import SellerBadges from "./SellerBadges";
import type { SellerStats } from "@/lib/reputation";

interface Props {
  adId: string;
  adRef: string;
  adTitle: string;
  sellerName: string;
  sellerPhone: string;
  whatsapp: boolean;
  sellerType: "private" | "business";
  active: boolean;
  reputation?: SellerStats | null;
}

export default function ContactSeller({
  adId,
  adRef,
  adTitle,
  sellerName,
  sellerPhone,
  whatsapp,
  sellerType,
  active,
  reputation,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waText = `Hello ${sellerName}, I saw your ad "${adTitle}" (${adRef}) on Valmont Ads. Is it still available?`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/ads/${adId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          phone: fd.get("phone"),
          message: fd.get("message"),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not send your message");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  const field =
    "w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-navy-700)] focus:ring-2 focus:ring-[var(--color-navy-700)]/10";

  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-navy-900)] text-base font-black text-[var(--color-orange-brand)]">
          {sellerName.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold text-[var(--color-navy-900)]">{sellerName}</p>
          <p className="text-xs text-slate-500">
            {sellerType === "business" ? "✔ Business seller" : "Private seller"}
            {reputation ? ` · ${reputation.sold} sold` : ""}
          </p>
        </div>
      </div>

      {reputation && reputation.badges.length > 0 && (
        <div className="mt-3">
          <SellerBadges badges={reputation.badges} size="sm" />
          <Link
            href={`/seller/${reputation.phone}`}
            className="mt-2 inline-block text-xs font-bold text-[var(--color-navy-700)] hover:underline"
          >
            See all {reputation.activeAds} ads from this seller →
          </Link>
        </div>
      )}

      {!active ? (
        <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-center text-sm font-semibold text-slate-500">
          This ad is no longer active.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-2.5">
            {revealed ? (
              <a
                href={`tel:${sellerPhone}`}
                className="rounded-xl bg-[var(--color-navy-900)] py-3.5 text-center text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] active:scale-95"
              >
                📞 {prettyPhone(sellerPhone)}
              </a>
            ) : (
              <button
                onClick={() => setRevealed(true)}
                className="rounded-xl bg-[var(--color-navy-900)] py-3.5 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)] active:scale-95"
              >
                📞 Show contact — {maskPhone(sellerPhone)}
              </button>
            )}

            {whatsapp && (
              <a
                href={waLink(sellerPhone, waText)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-emerald-500 py-3.5 text-center text-sm font-extrabold text-white transition hover:brightness-105 active:scale-95"
              >
                💬 Chat on WhatsApp
              </a>
            )}
          </div>

          <div className="mt-5 border-t border-slate-100 pt-5">
            {sent ? (
              <div className="rounded-xl bg-emerald-50 p-4 text-center">
                <p className="text-sm font-bold text-emerald-800">✔ Message sent</p>
                <p className="mt-1 text-xs text-emerald-700">
                  {sellerName} received your details and will call you back.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="grid gap-2.5">
                <p className="text-xs font-black tracking-wider text-slate-500 uppercase">Or send a message</p>
                <input name="name" required placeholder="Your name" className={field} />
                <input
                  name="phone"
                  required
                  inputMode="tel"
                  placeholder="Your phone e.g. 0241234567"
                  className={field}
                />
                <textarea
                  name="message"
                  required
                  rows={3}
                  defaultValue={`Hi, is "${adTitle}" still available?`}
                  className={`${field} resize-none`}
                />
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded-xl bg-[var(--color-orange-brand)] py-3 text-sm font-extrabold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-60"
                >
                  {sending ? "Sending…" : "Send message"}
                </button>
              </form>
            )}
          </div>
        </>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        ⚠ Never send money before you inspect the item. Valmont Ads does not handle payments.
      </p>
    </div>
  );
}
