"use client";

import { useEffect, useState } from "react";
import BuyModal, { type SelectedBundle } from "./BuyModal";
import { NETWORKS } from "@/lib/format";

export type Bundle = {
  network: "mtn" | "telecel" | "airteltigo";
  gb: number;
  price: number;
  expiry_policy: string;
};

export default function BundleGrid() {
  const [net, setNet] = useState<"mtn" | "telecel" | "airteltigo">("mtn");
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [tier, setTier] = useState("guest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SelectedBundle | null>(null);

  const load = async (network: "mtn" | "telecel" | "airteltigo") => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/bundles?network=${network}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load bundles");
      setBundles(data.bundles);
      setTier(data.tier);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bundles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(net);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  return (
    <div>
      <div className="net-tabs" style={{ maxWidth: 560, margin: "24px 0 6px" }}>
        {(Object.keys(NETWORKS) as Array<"mtn" | "telecel" | "airteltigo">).map((k) => (
          <button
            key={k}
            className={"net-tab" + (net === k ? " on" : "")}
            data-net={k}
            onClick={() => setNet(k)}
          >
            {NETWORKS[k].name}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
        {tier === "guest" ? (
          <>
            Guest prices shown. <a href="/signup">Create a free account</a> to unlock member pricing.
          </>
        ) : (
          <>
            <b style={{ color: "var(--lime)" }}>{tier}</b> pricing active.
          </>
        )}
      </p>

      {error && <div className="notice">{error}</div>}

      {loading ? (
        <p style={{ color: "var(--muted)", padding: 30 }}>Loading bundles…</p>
      ) : (
        <div className="bundle-grid">
          {bundles.map((b) => (
            <button
              key={b.network + b.gb}
              className="bundle"
              onClick={() => setSelected(b)}
              style={{ textAlign: "left", fontFamily: "inherit", color: "inherit", width: "100%" }}
            >
              <div className={`net ${b.network}`}>{NETWORKS[b.network].name}</div>
              <div className="gb">{b.gb} GB</div>
              <div className="price">
                {"GH₵" + b.price.toFixed(2)}{" "}
                <small>{b.expiry_policy === "rollover_60d" ? "60-Day Rollover" : "No Expiry"}</small>
              </div>
              <div className="meta">
                <span>⚡ Auto delivery</span>
                <span>MoMo accepted</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <BuyModal
          bundle={selected}
          onClose={() => setSelected(null)}
          onPlaced={(orderId) => {
            setSelected(null);
            window.location.href = "/track?id=" + orderId;
          }}
        />
      )}
    </div>
  );
}
