"use client";

import { useState } from "react";
import type { Bundle } from "./BundleGrid";
import { NETWORKS } from "@/lib/format";

export type SelectedBundle = Bundle;

type Stage = "form" | "waiting" | "done" | "error";

export default function BuyModal({
  bundle,
  onClose,
  onPlaced,
}: {
  bundle: SelectedBundle;
  onClose: () => void;
  onPlaced: (orderId: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"momo" | "wallet">("momo");
  const [momoNet, setMomoNet] = useState(bundle.network);
  const [stage, setStage] = useState<Stage>("form");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState("");

  const submit = async () => {
    if (!/^(0\d{9}|\+233\d{9})$/.test(phone.replace(/\s/g, ""))) {
      setMessage("Enter a valid Ghana number, e.g. 024 000 0000");
      setStage("error");
      return;
    }
    setStage("waiting");
    setMessage("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: bundle.network,
          bundle_gb: bundle.gb,
          number: phone,
          payment_method: method,
          momo_network: method === "momo" ? momoNet : undefined,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Something went wrong");
        setStage("error");
        return;
      }
      setOrderId(data.order.id);
      setMessage(
        data.payment?.message ||
          (method === "wallet" ? "Order placed — wallet debited" : "Order placed — payment received")
      );
      setStage("done");
    } catch {
      setMessage("Network error — try again");
      setStage("error");
    }
  };

  return (
    <div className="modal-back open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {stage === "form" && (
          <>
            <button className="m-close" onClick={onClose} aria-label="Close">×</button>
            <h3>
              Buy {bundle.gb}GB — {NETWORKS[bundle.network].name}
            </h3>
            <div className="m-sub">
              {NETWORKS[bundle.network].badge} · auto delivery
            </div>
            <div className="order-summary">
              <div className="row">
                <span>Bundle</span>
                <b>
                  {bundle.gb}GB {NETWORKS[bundle.network].name} Data
                </b>
              </div>
              <div className="row total">
                <span>Total</span>
                <b>GH₵{bundle.price.toFixed(2)}</b>
              </div>
            </div>
            <div className="field">
              <label htmlFor="bm-phone">Recipient phone number</label>
              <input
                className="inp"
                id="bm-phone"
                inputMode="tel"
                placeholder="e.g. 024 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <div className="hint">⚠️ Verify carefully — no refunds for wrong numbers.</div>
            </div>
            <div className="field">
              <label>Pay with</label>
              <div className="pay-opts">
                <button
                  className={"pay-opt" + (method === "momo" ? " on" : "")}
                  onClick={() => setMethod("momo")}
                >
                  <b>Mobile Money</b>
                  <small>MTN MoMo · Telecel Cash · AT Money</small>
                </button>
                <button
                  className={"pay-opt" + (method === "wallet" ? " on" : "")}
                  onClick={() => setMethod("wallet")}
                >
                  <b>Wallet</b>
                  <small>Pay from balance (requires sign-in)</small>
                </button>
              </div>
            </div>
            {method === "momo" && (
              <div className="field">
                <label htmlFor="bm-momonet">MoMo network</label>
                <select
                  className="inp"
                  id="bm-momonet"
                  value={momoNet}
                  onChange={(e) => setMomoNet(e.target.value as typeof momoNet)}
                >
                  <option value="mtn">MTN Mobile Money</option>
                  <option value="telecel">Telecel Cash</option>
                  <option value="airteltigo">AirtelTigo Money</option>
                </select>
              </div>
            )}
            <button className="btn btn-green btn-block" onClick={submit}>
              Continue to Payment →
            </button>
            <div className="demo-note">
              In dev mode (no Paystack key) payment auto-approves. In production a MoMo prompt is
              sent to your phone.
            </div>
          </>
        )}

        {stage === "waiting" && (
          <div className="momo-prompt">
            <div className="spin"></div>
            <h4>Processing payment…</h4>
            <p>
              {method === "momo" ? "Approve the Mobile Money prompt on your phone" : "Confirming wallet payment"}
            </p>
          </div>
        )}

        {stage === "done" && (
          <div style={{ textAlign: "center", padding: "6px 0 4px" }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
            <h3>Order placed!</h3>
            <div className="m-sub">{message}</div>
            <div className="track-card" style={{ textAlign: "left" }}>
              <div className="oid">
                {orderId}
                <small>
                  {bundle.gb}GB {NETWORKS[bundle.network].name} → {phone} · GH₵
                  {bundle.price.toFixed(2)}
                </small>
              </div>
            </div>
            <button className="btn btn-green btn-block" style={{ marginTop: 14 }} onClick={() => onPlaced(orderId)}>
              Track this order →
            </button>
          </div>
        )}

        {stage === "error" && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
            <h3>Could not place order</h3>
            <div className="m-sub">{message}</div>
            <button className="btn btn-ghost btn-block" onClick={() => setStage("form")}>
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
