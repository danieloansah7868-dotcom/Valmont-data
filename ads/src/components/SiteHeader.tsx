"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CATEGORIES } from "@/lib/taxonomy";

function SearchBox({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const sp = new URLSearchParams();
        if (q.trim()) sp.set("q", q.trim());
        router.push(`/ads${sp.toString() ? `?${sp}` : ""}`);
      }}
      className={`flex w-full items-center gap-2 rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-black/5 ${
        compact ? "" : "sm:p-2"
      }`}
    >
      <span className="pl-2 text-slate-400" aria-hidden>
        🔍
      </span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="What are you looking for? e.g. iPhone, Corolla, 2 bedroom"
        aria-label="Search ads"
        className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-slate-400"
      />
      <button
        type="submit"
        className="shrink-0 rounded-lg bg-[var(--color-orange-brand)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 active:scale-95"
      >
        Search
      </button>
    </form>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    { href: "/ads", label: "Browse ads" },
    { href: "/categories", label: "Categories" },
    { href: "/my-ads", label: "My ads" },
    { href: "/safety", label: "Safety" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--color-navy-900)] text-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-orange-brand)] text-lg font-black text-[var(--color-navy-900)]">
            V
          </span>
          <span className="text-lg leading-none font-black tracking-tight">
            Valmont<span className="text-[var(--color-orange-brand)]">Ads</span>
            <span className="block text-[10px] font-semibold tracking-widest text-white/50 uppercase">
              Ghana classifieds
            </span>
          </span>
        </Link>

        <div className="mx-2 hidden max-w-xl flex-1 lg:block">
          <Suspense fallback={null}>
            <SearchBox compact />
          </Suspense>
        </div>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition hover:bg-white/10 ${
                pathname === l.href ? "bg-white/10 text-white" : "text-white/80"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/post"
            className="ml-2 rounded-lg bg-[var(--color-orange-brand)] px-4 py-2 text-sm font-extrabold text-white transition hover:brightness-110 active:scale-95"
          >
            + Post free ad
          </Link>
        </nav>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
          className="ml-auto rounded-lg p-2 text-2xl leading-none md:hidden"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      <div className="px-4 pb-3 lg:hidden">
        <Suspense fallback={null}>
          <SearchBox compact />
        </Suspense>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-[var(--color-navy-950)] px-4 py-3 md:hidden">
          <div className="grid gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/10"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/post"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-lg bg-[var(--color-orange-brand)] px-3 py-2.5 text-center text-sm font-extrabold"
            >
              + Post free ad
            </Link>
          </div>
        </div>
      )}

      {/* category strip */}
      <div className="hidden border-t border-white/10 bg-[var(--color-navy-950)] md:block">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 text-xs no-scrollbar">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/ads?category=${c.slug}`}
              className="shrink-0 rounded-md px-2.5 py-1.5 font-semibold whitespace-nowrap text-white/65 transition hover:bg-white/10 hover:text-white"
            >
              <span className="mr-1" aria-hidden>
                {c.icon}
              </span>
              {c.name}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
