"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function SortSelect() {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <select
      aria-label="Sort results"
      value={params.get("sort") ?? "recent"}
      onChange={(e) => {
        const sp = new URLSearchParams(params.toString());
        sp.set("sort", e.target.value);
        sp.delete("page");
        router.push(`/ads?${sp}`);
      }}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--color-navy-700)]"
    >
      <option value="recent">Newest first</option>
      <option value="price-asc">Price: low to high</option>
      <option value="price-desc">Price: high to low</option>
      <option value="popular">Most viewed</option>
    </select>
  );
}
