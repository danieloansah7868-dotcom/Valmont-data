"use client";

import { useEffect, useState } from "react";

/* Sharing is how a classifieds site actually spreads in Ghana — somebody sees a
   car they like and forwards it to a brother on WhatsApp. So the priority order
   here is deliberate:

     1. The phone's own share sheet, when the browser supports it. One tap and
        the buyer picks WhatsApp, Telegram, SMS, whatever they actually use.
     2. WhatsApp explicitly, because it is the default channel here and desktop
        users have no share sheet.
     3. Copy link, which always works, including in the in-app browsers inside
        Facebook and Instagram where the other two are unreliable.

   The link is built from window.location rather than a prop so it is always the
   real URL the visitor is on, including on a preview or a custom domain. */

type Props = {
  title: string;
  price: string;
  town: string;
  /** Compact style for the sticky bar; full style for the page body. */
  variant?: "full" | "compact";
};

export default function ShareAd({ title, price, town, variant = "full" }: Props) {
  const [url, setUrl] = useState("");
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.href);
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  /* A forwarded message should stand on its own — the person receiving it has
     no idea what they are being sent, so lead with the item, price and town. */
  const message = `${title} — ${price} in ${town}\n\nSeen on Valmont Ads:\n${url}`;

  async function nativeShare() {
    try {
      await navigator.share({ title, text: `${title} — ${price} in ${town}`, url });
    } catch {
      /* The user dismissed the sheet, or the browser refused. Not an error
         worth showing them — the other two buttons are right there. */
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* Clipboard API needs a secure context and permission; fall back to the
         old execCommand path so copy still works on older Android browsers. */
      const el = document.createElement("textarea");
      el.value = url;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* Nothing else to try. */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(message)}`;

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2">
        {canNativeShare ? (
          <button
            type="button"
            onClick={nativeShare}
            aria-label="Share this ad"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-lg ring-1 ring-black/10 transition hover:bg-slate-50 active:scale-95"
          >
            <span aria-hidden>↗</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Link copied" : "Copy link to this ad"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-lg ring-1 ring-black/10 transition hover:bg-slate-50 active:scale-95"
          >
            <span aria-hidden>{copied ? "✓" : "🔗"}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-sm font-bold text-[var(--color-navy-900)]">Know someone who needs this?</p>
      <p className="mt-0.5 text-xs text-slate-500">Send them the link — they do not need an account to view it.</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98]"
        >
          <span aria-hidden>💬</span> Share on WhatsApp
        </a>

        {canNativeShare ? (
          <button
            type="button"
            onClick={nativeShare}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--color-navy-900)] px-4 text-sm font-bold text-white transition hover:brightness-110 active:scale-[0.98]"
          >
            <span aria-hidden>↗</span> More apps
          </button>
        ) : (
          <button
            type="button"
            onClick={copy}
            aria-live="polite"
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--color-navy-900)] px-4 text-sm font-bold text-white transition hover:brightness-110 active:scale-[0.98]"
          >
            <span aria-hidden>{copied ? "✓" : "🔗"}</span> {copied ? "Link copied" : "Copy link"}
          </button>
        )}
      </div>

      {canNativeShare && (
        <button
          type="button"
          onClick={copy}
          aria-live="polite"
          className="mt-2 w-full text-center text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
        >
          {copied ? "✓ Link copied to clipboard" : "or copy the link"}
        </button>
      )}
    </div>
  );
}
