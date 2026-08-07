"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SessionUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  tier: string;
};

const LINKS = [
  { href: "/buy", label: "Buy Data" },
  { href: "/deposit", label: "Deposit" },
  { href: "/track", label: "Track Order" },
  { href: "/api-doc", label: "API" },
];

export default function Nav() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link className="brand" href="/">
          <span className="logo">◈</span>
          <span>
            VALMONT<b style={{ color: "var(--green)" }}>DATA</b>
            <small>by Valmont Group · Accra</small>
          </span>
        </Link>
        <nav className={"nav-links" + (open ? " open" : "")} id="navLinks">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          {user ? (
            <>
              <Link href="/dashboard" onClick={() => setOpen(false)}>
                Dashboard
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" onClick={() => setOpen(false)}>
                Sign In
              </Link>
              <Link className="btn btn-green btn-sm" href="/signup" onClick={() => setOpen(false)}>
                Sign Up Free
              </Link>
            </>
          )}
        </nav>
        <button className="nav-burger" aria-label="Menu" onClick={() => setOpen(!open)}>
          ☰
        </button>
      </div>
    </header>
  );
}
