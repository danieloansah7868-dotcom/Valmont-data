"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CATEGORIES, CATEGORY_MAP, CONDITIONS, REGIONS } from "@/lib/taxonomy";

export default function Filters({ total }: { total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  const get = (k: string) => params.get(k) ?? "";
  const category = get("category");
  const subs = CATEGORY_MAP.get(category)?.subcategories ?? [];

  function apply(patch: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    if (patch.category !== undefined) sp.delete("subcategory");
    sp.delete("page");
    router.push(`/ads${sp.toString() ? `?${sp}` : ""}`);
  }

  const activeCount = ["category", "subcategory", "region", "condition", "min", "max"].filter((k) => get(k)).length;

  const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-navy-700)] focus:ring-2 focus:ring-[var(--color-navy-700)]/10";
  const label = "mb-1.5 block text-[11px] font-black tracking-wider text-slate-500 uppercase";

  const body = (
    <div className="grid gap-4">
      <div>
        <label className={label} htmlFor="f-cat">Category</label>
        <select id="f-cat" className={field} value={category} onChange={(e) => apply({ category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </div>

      {subs.length > 0 && (
        <div>
          <label className={label} htmlFor="f-sub">Subcategory</label>
          <select id="f-sub" className={field} value={get("subcategory")} onChange={(e) => apply({ subcategory: e.target.value })}>
            <option value="">All</option>
            {subs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={label} htmlFor="f-region">Region</label>
        <select id="f-region" className={field} value={get("region")} onChange={(e) => apply({ region: e.target.value })}>
          <option value="">All Ghana</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="f-cond">Condition</label>
        <select id="f-cond" className={field} value={get("condition")} onChange={(e) => apply({ condition: e.target.value })}>
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className={label}>Price range (GH₵)</span>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            apply({ min: String(fd.get("min") ?? ""), max: String(fd.get("max") ?? "") });
          }}
        >
          <input name="min" type="number" min="0" placeholder="Min" defaultValue={get("min")} className={field} />
          <span className="text-slate-400">–</span>
          <input name="max" type="number" min="0" placeholder="Max" defaultValue={get("max")} className={field} />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-[var(--color-navy-900)] px-3 py-2.5 text-xs font-bold text-white transition hover:bg-[var(--color-navy-700)]"
          >
            Go
          </button>
        </form>
      </div>

      {activeCount > 0 && (
        <button
          onClick={() => {
            const sp = new URLSearchParams();
            const q = get("q");
            if (q) sp.set("q", q);
            router.push(`/ads${sp.toString() ? `?${sp}` : ""}`);
          }}
          className="rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
        >
          Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* mobile toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-4 flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 text-sm font-bold text-[var(--color-navy-900)] ring-1 ring-black/5 lg:hidden"
      >
        <span>
          Filters {activeCount > 0 && <span className="ml-1 rounded-full bg-[var(--color-orange-brand)] px-2 py-0.5 text-[10px] text-white">{activeCount}</span>}
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      <aside className={`${open ? "block" : "hidden"} lg:block`}>
        <div className="rounded-2xl bg-white p-5 ring-1 ring-black/5 lg:sticky lg:top-40">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-black text-[var(--color-navy-900)]">Refine</h2>
            <span className="text-xs text-slate-500">{total} result{total === 1 ? "" : "s"}</span>
          </div>
          {body}
        </div>
      </aside>
    </>
  );
}
