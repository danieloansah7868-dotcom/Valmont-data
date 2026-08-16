export function cedis(value: number | null, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined) return "Contact for price";
  if (opts.compact && value >= 1000) {
    const k = value / 1000;
    return `GH₵${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `GH₵${value.toLocaleString("en-GH", { maximumFractionDigits: 2 })}`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - +new Date(iso);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** 0241234567 → 024 *** 4567 (shown until the buyer taps "show contact") */
export function maskPhone(phone: string): string {
  if (phone.length < 10) return phone;
  return `${phone.slice(0, 3)} *** ${phone.slice(-4)}`;
}

export function prettyPhone(phone: string): string {
  if (phone.length !== 10) return phone;
  return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
}

export function waLink(phone: string, text: string): string {
  const intl = phone.startsWith("0") ? `233${phone.slice(1)}` : phone;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
