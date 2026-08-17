"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_MAP, CONDITIONS, REGIONS, TOWNS } from "@/lib/taxonomy";
import type { Ad } from "@/lib/types";

const field =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--color-navy-700)] focus:ring-2 focus:ring-[var(--color-navy-700)]/10";
const labelCls = "mb-1.5 block text-sm font-bold text-[var(--color-navy-900)]";
const hint = "mt-1 text-xs text-slate-500";

export default function PostForm() {
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contactPrice, setContactPrice] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Ad | null>(null);

  const subs = useMemo(() => CATEGORY_MAP.get(category)?.subcategories ?? [], [category]);
  const towns = TOWNS[region] ?? [];

  function onFiles(files: FileList | null) {
    if (!files) return;
    const room = 6 - images.length;
    Array.from(files)
      .slice(0, room)
      .forEach((file) => {
        if (!file.type.startsWith("image/")) return;
        if (file.size > 4 * 1024 * 1024) {
          setError("Each photo must be under 4MB");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => setImages((prev) => (prev.length >= 6 ? prev : [...prev, String(reader.result)]));
        reader.readAsDataURL(file);
      });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: fd.get("title"),
          category: fd.get("category"),
          subcategory: fd.get("subcategory"),
          price: contactPrice ? null : Number(fd.get("price")),
          negotiable: fd.get("negotiable") === "on",
          condition: fd.get("condition"),
          region: fd.get("region"),
          town: fd.get("town"),
          description: fd.get("description"),
          images,
          sellerName: fd.get("sellerName"),
          sellerPhone: fd.get("sellerPhone"),
          whatsapp: fd.get("whatsapp") === "on",
          sellerType: fd.get("sellerType"),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not post your ad");

      try {
        const key = "vads_my_phone";
        localStorage.setItem(key, String(fd.get("sellerPhone") ?? ""));
      } catch {
        /* ignore */
      }

      setCreated(data.ad as Ad);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- success state ---------- */
  if (created) {
    const rejected = created.status === "rejected";
    return (
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center ring-1 ring-black/5">
        <span className="text-5xl" aria-hidden>
          {rejected ? "🚫" : "🎉"}
        </span>
        <h2 className="mt-4 text-2xl font-black text-[var(--color-navy-900)]">
          {rejected ? "Ad rejected by screening" : "Ad submitted!"}
        </h2>

        {rejected ? (
          <p className="mt-3 text-sm text-slate-600">
            {created.rejectionReason}. Edit the wording and post again — see our{" "}
            <Link href="/safety" className="font-bold text-[var(--color-navy-700)] underline">
              posting rules
            </Link>
            .
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Your ad is in the moderation queue and usually goes live within minutes. Save your reference:
          </p>
        )}

        <p className="mt-4 inline-block rounded-xl bg-[var(--color-paper)] px-5 py-3 font-mono text-lg font-black tracking-wider text-[var(--color-navy-900)]">
          {created.ref}
        </p>

        <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
          <Link
            href={`/ads/${created.slug}`}
            className="rounded-xl bg-[var(--color-navy-900)] py-3 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)]"
          >
            Preview my ad
          </Link>
          <Link
            href="/my-ads"
            className="rounded-xl bg-[var(--color-orange-brand)] py-3 text-sm font-extrabold text-white transition hover:brightness-110"
          >
            Go to My ads
          </Link>
        </div>

        <button
          onClick={() => {
            setCreated(null);
            setImages([]);
            setTitle("");
            setDescription("");
          }}
          className="mt-4 text-sm font-bold text-slate-500 hover:underline"
        >
          Post another ad
        </button>
      </div>
    );
  }

  /* ---------- form ---------- */
  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="grid gap-5">
        {/* 1 — what */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="flex items-center gap-2 text-lg font-black text-[var(--color-navy-900)]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-navy-900)] text-xs font-black text-[var(--color-orange-brand)]">
              1
            </span>
            What are you selling?
          </h2>

          <div className="mt-5 grid gap-4">
            <div>
              <label className={labelCls} htmlFor="title">
                Ad title *
              </label>
              <input
                id="title"
                name="title"
                required
                minLength={6}
                maxLength={90}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. iPhone 13 Pro 128GB — clean, no fault"
                className={field}
              />
              <p className={hint}>{title.length}/90 — be specific, buyers search these words.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="category">
                  Category *
                </label>
                <select
                  id="category"
                  name="category"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={field}
                >
                  <option value="">Choose a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls} htmlFor="subcategory">
                  Subcategory
                </label>
                <select id="subcategory" name="subcategory" disabled={!subs.length} className={field}>
                  <option value="">{subs.length ? "Choose…" : "Pick a category first"}</option>
                  {subs.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="condition">
                Condition
              </label>
              <select id="condition" name="condition" defaultValue="used-good" className={field}>
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="description">
                Description *
              </label>
              <textarea
                id="description"
                name="description"
                required
                minLength={20}
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the item honestly: age, condition, what's included, any faults, and where the buyer can inspect it."
                className={`${field} resize-y`}
              />
              <p className={hint}>
                {description.length} characters — honest descriptions get{" "}
                <strong className="text-[var(--color-navy-900)]">3× more replies</strong>.
              </p>
            </div>
          </div>
        </section>

        {/* 2 — price */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="flex items-center gap-2 text-lg font-black text-[var(--color-navy-900)]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-navy-900)] text-xs font-black text-[var(--color-orange-brand)]">
              2
            </span>
            Price
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="price">
                Asking price (GH₵) {!contactPrice && "*"}
              </label>
              <input
                id="price"
                name="price"
                type="number"
                min="0"
                step="1"
                required={!contactPrice}
                disabled={contactPrice}
                placeholder="0"
                className={`${field} disabled:bg-slate-50 disabled:text-slate-400`}
              />
            </div>

            <div className="flex flex-col justify-end gap-2.5 pb-1">
              <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={contactPrice}
                  onChange={(e) => setContactPrice(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-orange-brand)]"
                />
                Contact me for price
              </label>
              <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
                <input name="negotiable" type="checkbox" className="h-4 w-4 accent-[var(--color-orange-brand)]" />
                Price is negotiable
              </label>
            </div>
          </div>

          <p className="mt-4 rounded-lg bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
            ⚠ No fake &ldquo;was&rdquo; prices. Inflated crossed-out prices get the ad removed.
          </p>
        </section>

        {/* 3 — photos */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="flex items-center gap-2 text-lg font-black text-[var(--color-navy-900)]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-navy-900)] text-xs font-black text-[var(--color-orange-brand)]">
              3
            </span>
            Photos <span className="text-sm font-semibold text-slate-400">({images.length}/6)</span>
          </h2>

          <div className="mt-5">
            <label
              htmlFor="photos"
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-8 text-center transition hover:border-[var(--color-orange-brand)] hover:bg-orange-50/40"
            >
              <span className="text-3xl" aria-hidden>
                📷
              </span>
              <span className="mt-2 text-sm font-bold text-[var(--color-navy-900)]">Tap to add photos</span>
              <span className="mt-1 text-xs text-slate-500">Up to 6 images, max 4MB each</span>
            </label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onFiles(e.target.files)}
              className="hidden"
            />

            {images.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
                {images.map((src, i) => (
                  <div key={i} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Upload ${i + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Remove photo ${i + 1}`}
                      className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white opacity-0 transition group-hover:opacity-100"
                    >
                      ✕
                    </button>
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-[var(--color-orange-brand)] px-1.5 py-0.5 text-[9px] font-black text-white">
                        COVER
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 4 — location + contact */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="flex items-center gap-2 text-lg font-black text-[var(--color-navy-900)]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-navy-900)] text-xs font-black text-[var(--color-orange-brand)]">
              4
            </span>
            Location &amp; contact
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="region">
                Region *
              </label>
              <select
                id="region"
                name="region"
                required
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className={field}
              >
                <option value="">Choose a region</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="town">
                Town / area
              </label>
              <input
                id="town"
                name="town"
                list="town-list"
                placeholder={towns[0] ?? "e.g. Spintex"}
                className={field}
              />
              <datalist id="town-list">
                {towns.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>

            <div>
              <label className={labelCls} htmlFor="sellerName">
                Your name *
              </label>
              <input id="sellerName" name="sellerName" required placeholder="e.g. Kwame Boateng" className={field} />
            </div>

            <div>
              <label className={labelCls} htmlFor="sellerPhone">
                Phone number *
              </label>
              <input
                id="sellerPhone"
                name="sellerPhone"
                required
                inputMode="tel"
                placeholder="0241234567"
                className={field}
              />
              <p className={hint}>Buyers call this number. MTN, Telecel or AirtelTigo.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="sellerType">
                I am a
              </label>
              <select id="sellerType" name="sellerType" defaultValue="private" className={field}>
                <option value="private">Private seller</option>
                <option value="business">Business / shop</option>
              </select>
            </div>

            <label className="flex items-end gap-2.5 pb-3 text-sm font-semibold text-slate-700">
              <input
                name="whatsapp"
                type="checkbox"
                defaultChecked
                className="h-4 w-4 accent-[var(--color-orange-brand)]"
              />
              Show a WhatsApp button
            </label>
          </div>
        </section>

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 ring-1 ring-red-100">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--color-orange-brand)] py-4 text-base font-extrabold text-white shadow-lg shadow-orange-900/10 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? "Posting…" : "Post my ad — free"}
        </button>
      </div>

      {/* sidebar tips */}
      <aside className="lg:sticky lg:top-40 lg:self-start">
        <div className="rounded-2xl bg-[var(--color-navy-900)] p-6 text-white/80">
          <h3 className="text-sm font-black text-white">💡 Sell faster</h3>
          <ul className="mt-4 grid gap-3 text-xs leading-relaxed">
            <li>
              <strong className="text-white">Take real photos.</strong> Natural daylight, plain background, show any
              damage honestly.
            </li>
            <li>
              <strong className="text-white">Price it right.</strong> Check similar ads before you set your price.
            </li>
            <li>
              <strong className="text-white">Answer fast.</strong> Ads answered within an hour sell far quicker.
            </li>
            <li>
              <strong className="text-white">Be reachable.</strong> Turn on the WhatsApp button — most buyers message
              first.
            </li>
          </ul>

          <div className="mt-5 border-t border-white/10 pt-5">
            <h3 className="text-sm font-black text-white">Not allowed</h3>
            <p className="mt-2 text-xs leading-relaxed">
              Counterfeits, stolen goods, drugs, weapons, live animals for fighting, adult services, and any listing
              asking for an advance fee.
            </p>
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <h3 className="text-sm font-black text-white">Selling as a business?</h3>
            <p className="mt-2 text-xs leading-relaxed">
              Ads expire after 30 days. If you sell every week, our sister company{" "}
              <a
                href="https://valmontweb.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[var(--color-orange-brand)] underline"
              >
                Valmont Web Services
              </a>{" "}
              builds you a permanent shop with your own domain and checkout.
            </p>
          </div>
        </div>
      </aside>
    </form>
  );
}
