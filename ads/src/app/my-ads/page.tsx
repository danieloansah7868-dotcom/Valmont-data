import type { Metadata } from "next";
import MyAdsClient from "@/components/MyAdsClient";

export const metadata: Metadata = {
  title: "My ads",
  description: "Look up the ads you posted with your phone number and see the messages buyers have sent you.",
};

export default function MyAdsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-black text-[var(--color-navy-900)]">My ads</h1>
      <p className="mt-2 max-w-xl text-sm text-slate-600">
        No account needed — sign in with the phone number you posted with and we&apos;ll text you a code. Then you
        can edit, mark sold, re-list or delete your ads, and read every message buyers have sent.
      </p>
      <div className="mt-8">
        <MyAdsClient />
      </div>
    </div>
  );
}
