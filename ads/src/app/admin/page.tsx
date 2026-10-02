import type { Metadata } from "next";
import AdminConsole from "@/components/AdminConsole";

export const metadata: Metadata = {
  title: "Moderation console",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <AdminConsole />
    </div>
  );
}
