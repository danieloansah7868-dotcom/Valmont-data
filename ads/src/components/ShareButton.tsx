"use client";

import { useState } from "react";

/* A share control that lives INSIDE an ad card, which is itself one big link.
   Every handler therefore has to stop the click reaching the card, or tapping
   "share" would navigate to the ad instead — the classic nested-interactive
   bug. The card link stays the primary action; this is a deliberate opt-out. */

export default function ShareButton({ slug, title, price, town }: {
  slug: string;
  title: string;
  price: string;
  town: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const url = `${window.location.origin}/ads/${slug}`;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: `${title} — ${price} in ${town}`, url });
        return;
      } catch {
        /* Sheet dismissed, or the browser refused. Fall through to copying so
           the tap still does something useful rather than nothing. */
      }
    }

    try {
      await navigator.clipboard.writeText(url);
    } catch {
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
        /* Nothing further to try. */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label={copied ? "Link copied" : `Share ${title}`}
      title="Share this ad"
      className="grid h-8 w-8 place-items-center rounded-lg bg-white/95 text-sm shadow-sm ring-1 ring-black/10 transition hover:bg-white active:scale-90"
    >
      <span aria-hidden>{copied ? "✓" : "↗"}</span>
    </button>
  );
}
