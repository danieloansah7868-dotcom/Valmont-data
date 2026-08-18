"use client";

import { useState } from "react";
import type { Badge } from "@/lib/reputation";

const TONE: Record<Badge["tone"], string> = {
  gold: "bg-amber-50 text-amber-900 ring-amber-300",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
  red: "bg-red-50 text-red-700 ring-red-200",
};

/* Most buyers here are on a phone, where `title` never appears — there is no
   hover on a touch screen. A badge whose reason cannot be read is just a shiny
   sticker, which is the thing this system exists to avoid. So each badge is a
   real button that reveals its reason on tap, and keeps the tooltip for mouse
   users. The reason is also in the accessible name, so a screen reader hears
   "Trusted Seller. Sold 6 items with no rejected ads in 100 days." */
export default function SellerBadges({
  badges,
  size = "md",
}: {
  badges: Badge[];
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (!badges.length) return null;

  return (
    <div>
      <ul className="flex flex-wrap gap-1.5">
        {badges.map((b) => {
          const isOpen = open === b.code;
          return (
            <li key={b.code}>
              <button
                type="button"
                title={b.reason}
                aria-label={`${b.label}. ${b.reason}`}
                aria-expanded={isOpen}
                onClick={(e) => {
                  /* Badges sit inside ad-card links; a tap must explain the
                     badge, not navigate away from the page. */
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(isOpen ? null : b.code);
                }}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-full ring-1 transition ${TONE[b.tone]} ${
                  size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
                } font-bold hover:brightness-95 focus:ring-2 focus:ring-[var(--color-navy-700)] focus:outline-none`}
              >
                <span aria-hidden>{b.icon}</span>
                {b.label}
                <span aria-hidden className="opacity-45">
                  {isOpen ? "▴" : "▾"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <p className="animate-fade-up mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">
          {badges.find((b) => b.code === open)?.reason}
        </p>
      )}
    </div>
  );
}
