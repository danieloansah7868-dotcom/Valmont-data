"use client";

import { useEffect } from "react";

/** Fire-and-forget view counter — one ping per ad per browser session. */
export default function ViewPing({ id }: { id: string }) {
  useEffect(() => {
    const key = `vads_seen_${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode — ping anyway */
    }
    fetch(`/api/ads/${id}`, { method: "POST" }).catch(() => {});
  }, [id]);

  return null;
}
