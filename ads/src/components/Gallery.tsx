"use client";

import { useState } from "react";

export default function Gallery({ images, title, icon }: { images: string[]; title: string; icon: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="grid aspect-16/10 w-full place-items-center rounded-2xl bg-linear-to-br from-slate-100 to-slate-200">
        <div className="text-center">
          <p className="text-6xl" aria-hidden>
            {icon}
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-400">No photo provided</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[active]} alt={title} className="aspect-16/10 w-full object-cover" />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
          {images.map((src, i) => (
            <button
              key={src}
              onClick={() => setActive(i)}
              aria-label={`Photo ${i + 1}`}
              className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
                i === active ? "ring-[var(--color-orange-brand)]" : "ring-transparent opacity-70 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
