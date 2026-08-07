"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign-in failed");
        return;
      }
      router.push(params.get("next") || "/dashboard");
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
          <h1>Welcome back 👋</h1>
          <div className="sub">Sign in to continue</div>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="siEmail">Email</label>
              <input
                className="inp"
                id="siEmail"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="siPass">Password</label>
              <input
                className="inp"
                id="siPass"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
            <button className="btn btn-green btn-block" type="submit" disabled={busy}>
              {busy ? "…" : "Sign In →"}
            </button>
          </form>
          <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--muted)", marginTop: 18 }}>
            Don&apos;t have an account?{" "}
            <Link href="/signup">
              <b>Sign Up</b>
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
