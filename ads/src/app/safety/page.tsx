import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Safety tips & posting rules",
  description: "How to buy and sell safely on Valmont Ads, and what is not allowed on the platform.",
};

const BUYER_TIPS = [
  { t: "Meet in public, in daylight", d: "Choose a busy place — a mall, a filling station, a bank forecourt. Take someone with you for expensive items." },
  { t: "Inspect before you pay", d: "Switch the phone on, test the laptop, start the car. If a seller refuses inspection, walk away." },
  { t: "Never pay in advance", d: "No deposit, no “delivery fee”, no “clearing fee”. MoMo transfers to the wrong person are not reversible." },
  { t: "Check documents", d: "For vehicles and land, verify the registration, indenture and site plan with the relevant authority before any payment." },
  { t: "Trust your instincts", d: "A price far below market value is the oldest trick there is. If it feels wrong, it is wrong." },
];

const SELLER_TIPS = [
  { t: "Confirm payment yourself", d: "Wait for the MoMo alert on your own phone. Screenshots are trivially faked." },
  { t: "Don't share OTPs", d: "No genuine buyer needs a code sent to your phone. That code empties your wallet." },
  { t: "Describe faults honestly", d: "Hidden faults cause disputes and get your account banned. State them upfront — buyers respect it." },
  { t: "Keep chats on the record", d: "Agree the price and terms over WhatsApp so both sides have the same understanding." },
];

const BANNED = [
  "Counterfeit or replica goods",
  "Stolen property",
  "Drugs, tobacco and related paraphernalia",
  "Weapons and ammunition",
  "Adult services",
  "Live animals for fighting",
  "Advance-fee or “investment” schemes",
  "Someone else's personal data",
  "Fake “was” prices and invented discounts",
];

export default function SafetyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-xs font-black tracking-widest text-[var(--color-orange-brand)] uppercase">Trust &amp; safety</p>
      <h1 className="mt-2 text-3xl font-black text-[var(--color-navy-900)] sm:text-4xl">
        Buy and sell without getting burned
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
        Valmont Ads is a listings platform — we connect buyers and sellers, but the deal itself happens between the
        two of you. We moderate every ad, and these habits keep you safe for the rest.
      </p>

      <div className="mt-8 rounded-2xl bg-[var(--color-navy-900)] p-6 text-white">
        <h2 className="text-lg font-black">The one rule that matters</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          <strong className="text-[var(--color-orange-brand)]">Never send money before you have the item in your
          hands.</strong>{" "}
          Almost every scam on any classifieds site in Ghana comes down to a buyer paying in advance, or a seller
          releasing goods against a faked payment alert.
        </p>
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-black text-[var(--color-navy-900)]">If you are buying</h2>
        <div className="mt-4 grid gap-3">
          {BUYER_TIPS.map((tip, i) => (
            <div key={tip.t} className="flex gap-4 rounded-2xl bg-white p-5 ring-1 ring-black/5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--color-paper)] text-sm font-black text-[var(--color-navy-900)]">
                {i + 1}
              </span>
              <div>
                <h3 className="font-bold text-[var(--color-navy-900)]">{tip.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{tip.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-black text-[var(--color-navy-900)]">If you are selling</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SELLER_TIPS.map((tip) => (
            <div key={tip.t} className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
              <h3 className="font-bold text-[var(--color-navy-900)]">{tip.t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{tip.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-black text-[var(--color-navy-900)]">What we do not allow</h2>
        <p className="mt-2 text-sm text-slate-600">
          Ads containing these are rejected automatically or removed by a moderator, and repeat posters are blocked.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {BANNED.map((b) => (
            <li key={b} className="flex items-start gap-2.5 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/5">
              <span className="text-red-500">✕</span>
              <span className="text-slate-700">{b}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-xl font-black text-[var(--color-navy-900)]">Spotted a bad ad?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Note the ad reference (it starts with <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">VA-</code>)
          and report it to our moderation team. We review every report, and ads that break the rules come down fast.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/ads"
            className="rounded-xl bg-[var(--color-navy-900)] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[var(--color-navy-700)]"
          >
            Back to browsing
          </Link>
          <Link
            href="/post"
            className="rounded-xl bg-[var(--color-orange-brand)] px-5 py-3 text-sm font-extrabold text-white transition hover:brightness-110"
          >
            Post an ad
          </Link>
        </div>
      </section>
    </div>
  );
}
