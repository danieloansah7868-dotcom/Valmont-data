import type { Metadata } from "next";
import PostForm from "@/components/PostForm";

export const metadata: Metadata = {
  title: "Post a free ad",
  description: "List your item on Valmont Ads in under two minutes. Free to post, no cut of your sale, Ghana-wide reach.",
};

export default function PostPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="text-center">
        <p className="text-xs font-black tracking-widest text-[var(--color-orange-brand)] uppercase">
          Free to post · We take no cut
        </p>
        <h1 className="mt-2 text-3xl font-black text-[var(--color-navy-900)] sm:text-4xl">Post your ad</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-slate-600">
          Fill in the details below. Your ad goes to moderation and is usually live within minutes.
        </p>
      </div>

      <div className="mt-9">
        <PostForm />
      </div>
    </div>
  );
}
