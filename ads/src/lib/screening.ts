/* ============================================================================
   Screening engine.

   Philosophy: code is good at patterns, terrible at judgement. So we split the
   work.

     • BLOCK  — unambiguous rubbish (advance-fee wording, banned goods).
                Auto-rejected; a human never wastes time on it.
     • WARN   — suspicious but plausibly innocent (price far below market, a
                phone number hidden in the text). Held for review WITH the
                reason spelled out, so the moderator decides in seconds.
     • INFO   — context worth knowing, not suspicious on its own.

   What this can never catch: a well-written ad for goods the seller doesn't
   own. That needs a human, which is exactly why the WARN reasons are written
   in plain English rather than as codes.
   ========================================================================== */

import type { AdInput, Flag, PostContext } from "./types";

/* ---------------------------------------------------------------- wordlists */

const BLOCK_PHRASES: { pattern: RegExp; label: string }[] = [
  { pattern: /\badvance fee\b/i, label: "Asks for an advance fee" },
  { pattern: /\bwestern union only\b/i, label: "Western Union only — classic scam pattern" },
  { pattern: /\bwire transfer only\b/i, label: "Wire transfer only — classic scam pattern" },
  { pattern: /\bfree money\b/i, label: "“Free money” wording" },
  { pattern: /\b(send|pay).{0,20}\bbefore\b.{0,20}\b(delivery|shipping|inspection)\b/i, label: "Demands payment before inspection" },
  { pattern: /\b(blank atm|cloned card|hacked account|money doubling|double your money)\b/i, label: "Financial fraud offer" },
  { pattern: /\b(cocaine|heroin|tramadol|weed for sale|wee for sale)\b/i, label: "Drugs" },
  { pattern: /\b(ak47|ak-47|pistol for sale|ammunition|live bullets)\b/i, label: "Weapons" },
  { pattern: /\b(human hair for ritual|body parts|juju|sakawa)\b/i, label: "Prohibited/ritual content" },
  { pattern: /\b(escort service|sex for|ashawo)\b/i, label: "Adult services" },
  { pattern: /\b(stolen|hot phone|no questions asked)\b/i, label: "Suggests stolen goods" },
  { pattern: /\b(fake|replica|first copy|mirror copy)\b.{0,15}\b(iphone|rolex|gucci|samsung|louis vuitton)\b/i, label: "Counterfeit goods" },
];

const WARN_PHRASES: { pattern: RegExp; label: string; points: number }[] = [
  { pattern: /\b(urgent|quick sale|must go today|leaving the country)\b/i, label: "Urgency pressure wording", points: 15 },
  { pattern: /\b(no inspection|no test|as is where is)\b/i, label: "Refuses inspection", points: 25 },
  { pattern: /\b(deposit|down payment)\b.{0,30}\b(before|first|to reserve)\b/i, label: "Wants a deposit to reserve", points: 25 },
  { pattern: /\b(dm me|whatsapp only|don'?t call)\b/i, label: "Avoids phone contact", points: 10 },
  { pattern: /\b(agent|middleman)\b.{0,20}\b(not allowed|no)\b/i, label: "Anti-agent wording", points: 5 },
  { pattern: /\b(bitcoin|crypto|usdt|forex|investment plan|roi)\b/i, label: "Crypto/investment angle", points: 30 },
  { pattern: /\b(loan|borrow money|credit available)\b/i, label: "Lending offer — needs licence check", points: 20 },
  { pattern: /\b(visa|work permit|travel abroad|relocate to canada)\b/i, label: "Travel/visa offer — common scam area", points: 25 },
];

/** Rough market floors. Absurdly cheap = bait. */
const PRICE_FLOORS: { pattern: RegExp; floor: number; what: string }[] = [
  { pattern: /\biphone\s*(1[1-9]|x|xr|xs)\b/i, floor: 1200, what: "iPhone" },
  { pattern: /\bmacbook\b/i, floor: 2000, what: "MacBook" },
  { pattern: /\bplaystation\s*5|\bps5\b/i, floor: 2500, what: "PlayStation 5" },
  { pattern: /\b(toyota|honda|hyundai|kia|nissan|mercedes|bmw)\b/i, floor: 15000, what: "car" },
  { pattern: /\bsamsung\s*(galaxy\s*)?s(2[0-9]|1[0-9])\b/i, floor: 1000, what: "Samsung flagship" },
  { pattern: /\bgenerator\b/i, floor: 800, what: "generator" },
];

/* ------------------------------------------------------------------ helpers */

/** Phone numbers hidden in the description — used to dodge contact tracking. */
function hiddenPhoneNumbers(text: string): number {
  const normalised = text
    .replace(/[oO]/g, "0")
    .replace(/[lI]/g, "1")
    .replace(/[^\d+]/g, " ");
  const matches = normalised.match(/(?:\+?233|0)\s?[235]\d{8}/g) ?? [];
  return matches.length;
}

function externalLinks(text: string): number {
  return (text.match(/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|shop|store|ng|gh)\b/gi) ?? []).length;
}

function shoutiness(text: string): number {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 20) return 0;
  const caps = text.replace(/[^A-Z]/g, "").length;
  return caps / letters.length;
}

export function ghanaNetwork(phone: string): "MTN" | "Telecel" | "AirtelTigo" | "Unknown" {
  const p = phone.slice(0, 3);
  if (["024", "025", "053", "054", "055", "059"].includes(p)) return "MTN";
  if (["020", "050"].includes(p)) return "Telecel";
  if (["026", "027", "056", "057"].includes(p)) return "AirtelTigo";
  return "Unknown";
}

/** Parse a User-Agent into something a human can read at a glance. */
export function describeDevice(ua = ""): { device: string; browser: string; os: string } {
  const s = ua.toLowerCase();

  let os = "Unknown OS";
  if (/android/.test(s)) os = `Android${/android\s([\d.]+)/.exec(s)?.[1] ? " " + /android\s([\d.]+)/.exec(s)![1] : ""}`;
  else if (/iphone|ipad|ios/.test(s)) os = "iOS";
  else if (/windows/.test(s)) os = "Windows";
  else if (/mac os x/.test(s)) os = "macOS";
  else if (/linux/.test(s)) os = "Linux";

  let browser = "Unknown browser";
  if (/edg\//.test(s)) browser = "Edge";
  else if (/opr\/|opera/.test(s)) browser = "Opera";
  else if (/chrome\//.test(s)) browser = "Chrome";
  else if (/firefox/.test(s)) browser = "Firefox";
  else if (/safari/.test(s)) browser = "Safari";

  let device = "Desktop";
  if (/ipad|tablet/.test(s)) device = "Tablet";
  else if (/mobile|android|iphone/.test(s)) device = "Phone";
  if (/bot|crawler|spider|curl|python|postman|wget|node-fetch/.test(s)) device = "⚠ Bot/script";

  return { device, browser, os };
}

/* -------------------------------------------------------------- the engine */

export interface ScreenResult {
  flags: Flag[];
  score: number;
  /** true → auto-reject, never shown to a moderator. */
  block: boolean;
  reason?: string;
}

export function screen(
  input: AdInput,
  ctx: PostContext = {},
  history: { adsLast24h: number; totalAds: number; rejected: number; isRepeatOffender: boolean } = {
    adsLast24h: 0,
    totalAds: 0,
    rejected: 0,
    isRepeatOffender: false,
  },
): ScreenResult {
  const flags: Flag[] = [];
  const title = input.title ?? "";
  const description = input.description ?? "";
  const text = `${title} ${description}`;

  const add = (code: string, label: string, severity: Flag["severity"], points: number) =>
    flags.push({ code, label, severity, points });

  /* ---- hard blocks ---- */
  for (const { pattern, label } of BLOCK_PHRASES) {
    if (pattern.test(text)) add("banned_phrase", label, "block", 100);
  }

  /* ---- price sanity ---- */
  if (input.price !== null && input.price !== undefined) {
    if (input.price > 5_000_000) add("price_absurd", "Price above the allowed maximum", "block", 100);
    if (input.price > 0 && input.price < 3 && input.category !== "jobs") {
      add("price_token", "Token price — likely bait to appear cheapest", "warn", 30);
    }
    for (const { pattern, floor, what } of PRICE_FLOORS) {
      if (pattern.test(title) && input.price > 0 && input.price < floor) {
        add(
          "price_too_low",
          `Priced at GH₵${input.price.toLocaleString()} — far below normal for a ${what}. Classic bait.`,
          "warn",
          40,
        );
        break;
      }
    }
  }

  /* ---- contact evasion ---- */
  const hidden = hiddenPhoneNumbers(description);
  if (hidden > 0) {
    add("hidden_phone", `${hidden} phone number${hidden > 1 ? "s" : ""} hidden in the description`, "warn", 25);
  }
  const links = externalLinks(description);
  if (links > 0) {
    add("external_link", `${links} external link${links > 1 ? "s" : ""} in the description`, "warn", 20);
  }

  /* ---- warn wordlist ---- */
  for (const { pattern, label, points } of WARN_PHRASES) {
    if (pattern.test(text)) add("suspicious_phrase", label, "warn", points);
  }

  /* ---- quality signals ---- */
  if (shoutiness(text) > 0.6) add("all_caps", "Mostly written in capital letters", "warn", 10);
  if (!input.images?.length) add("no_photo", "No photo attached", "info", 10);
  if (description.length < 60) add("thin_description", "Very short description", "info", 10);
  if (/(.)\1{6,}/.test(text)) add("spam_chars", "Repeated character spam", "warn", 15);

  /* ---- behaviour ---- */
  if (history.adsLast24h >= 10) {
    add("flooding", `Posted ${history.adsLast24h} ads in the last 24 hours`, "warn", 35);
  } else if (history.adsLast24h >= 5) {
    add("high_volume", `Posted ${history.adsLast24h} ads today`, "info", 15);
  }
  if (history.isRepeatOffender) {
    add("repeat_offender", `Previously rejected ${history.rejected} time${history.rejected > 1 ? "s" : ""}`, "warn", 45);
  }

  /* ---- automation signals ---- */
  const dev = describeDevice(ctx.userAgent);
  if (dev.device.includes("Bot")) add("bot_ua", "Submitted by a script, not a browser", "warn", 50);
  if (typeof ctx.fillSeconds === "number" && ctx.fillSeconds >= 0 && ctx.fillSeconds < 8) {
    add("too_fast", `Form completed in ${ctx.fillSeconds}s — too fast to be typed`, "warn", 30);
  }
  if (ctx.timezone && !/africa\/accra|gmt|utc/i.test(ctx.timezone)) {
    add("foreign_tz", `Posted from timezone ${ctx.timezone} (not Ghana)`, "info", 15);
  }

  const score = Math.min(100, flags.reduce((s, f) => s + f.points, 0));
  const blockFlag = flags.find((f) => f.severity === "block");
  const block = Boolean(blockFlag) || score >= 70;

  return {
    flags,
    score,
    block,
    reason: blockFlag?.label ?? (block ? "Multiple risk signals — see flags" : undefined),
  };
}
