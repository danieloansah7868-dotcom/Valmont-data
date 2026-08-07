"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign-up failed");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="wrap" style={{ maxWidth: 520 }}>
        <div className="auth-box" style={{ margin: "0 auto" }}>
          <h1>Create account</h1>
          <div className="sub">Takes under 30 seconds · free forever</div>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="suName">Full name</label>
              <input className="inp" id="suName" placeholder="e.g. Ama Owusu" value={form.name} onChange={set("name")} required />
            </div>
            <div className="field">
              <label htmlFor="suEmail">Email</label>
              <input className="inp" id="suEmail" type="email" placeholder="you@example.com" value={form.email} onChange={set("email")} required />
            </div>
            <div className="field">
              <label htmlFor="suPhone">Mobile number</label>
              <input className="inp" id="suPhone" inputMode="tel" placeholder="e.g. 024 000 0000" value={form.phone} onChange={set("phone")} required />
            </div>
            <div className="field">
              <label htmlFor="suPass">Password</label>
              <input className="inp" id="suPass" type="password" placeholder="Min 6 characters" value={form.password} onChange={set("password")} required />
            </div>
            {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
            <button className="btn btn-green btn-block" type="submit" disabled={busy}>
              {busy ? "…" : "Create Account →"}
            </button>
          </form>
          <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--muted)", marginTop: 18 }}>
            Already have an account?{" "}
            <Link href="/signin">
              <b>Sign In</b>
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
