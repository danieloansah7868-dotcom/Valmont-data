import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-lg place-items-center px-4 py-24 text-center">
      <span className="text-6xl" aria-hidden>
        🔍
      </span>
      <h1 className="mt-6 text-3xl font-black text-[var(--color-navy-900)]">Page not found</h1>
      <p className="mt-3 text-sm text-slate-600">
        That ad may have been sold, expired or removed by moderation. Plenty more where it came from.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/ads"
          className="rounded-xl bg-[var(--color-navy-900)] px-6 py-3 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)]"
        >
          Browse all ads
        </Link>
        <Link
          href="/"
          className="rounded-xl bg-white px-6 py-3 text-sm font-extrabold text-[var(--color-navy-900)] ring-1 ring-black/10 transition hover:bg-slate-50"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
