import type { Badge } from "@/lib/reputation";

const TONE: Record<Badge["tone"], string> = {
  gold: "bg-amber-50 text-amber-900 ring-amber-300",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
  red: "bg-red-50 text-red-700 ring-red-200",
};

export default function SellerBadges({
  badges,
  size = "md",
}: {
  badges: Badge[];
  size?: "sm" | "md";
}) {
  if (!badges.length) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <li
          key={b.code}
          title={b.reason}
          className={`inline-flex items-center gap-1 rounded-full ring-1 ${TONE[b.tone]} ${
            size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
          } font-bold`}
        >
          <span aria-hidden>{b.icon}</span>
          {b.label}
        </li>
      ))}
    </ul>
  );
}
