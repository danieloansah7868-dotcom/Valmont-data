"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

type Order = {
  public_id: string;
  network: string;
  bundle_gb: number;
  price: string;
  recipient_phone: string;
  payment_method: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
};
type Event = { status: string; note: string | null; created_at: string };

const STATUS_LABEL: Record<string, string> = {
  unpaid: "Awaiting payment",
  paid: "Payment received",
  processing: "Queued on the fast lane",
  delivered: "Data delivered",
  failed: "Delivery failed",
  refunded: "Refunded to wallet",
};

function TrackInner() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("id") || "");
  const [order, setOrder] = useState<Order | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const lookup = useCallback(async (id: string, poll = false) => {
    if (!id.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id.trim())}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Order not found");
        setOrder(null);
        setEvents([]);
        return;
      }
      setOrder(data.order);
      setEvents(data.events);
      const active = ["unpaid", "paid", "processing"].includes(data.order.status);
      if (active && poll) setTimeout(() => lookup(id, true), 5000); // poll while active
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (params.get("id")) lookup(params.get("id")!, true);
  }, [params, lookup]);

  return (
    <section>
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="k">Order Tracking</div>
        <h1 className="t" style={{ margin: "8px 0 12px" }}>
          Track Your Order
        </h1>
        <p className="lead">
          Enter the order ID from your confirmation (e.g. <b>VD-260802-4831</b>).
        </p>

        <form
          className="inp-group"
          style={{ marginTop: 24 }}
          onSubmit={(e) => {
            e.preventDefault();
            lookup(query, true);
          }}
        >
          <input
            className="inp"
            placeholder="Order ID, e.g. VD-260802-4831"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-green" type="submit">
            {loading ? "…" : "Track →"}
          </button>
        </form>

        {error && <div className="notice" style={{ marginTop: 16 }}>{error}</div>}

        {order && (
          <div className="track-card">
            <div className="oid">
              {order.public_id}{" "}
              <span className={"pill " + order.status}>
                {(STATUS_LABEL[order.status] || order.status).toUpperCase()}
              </span>
              <small>
                {order.bundle_gb}GB {order.network} → {order.recipient_phone} · GH₵
                {Number(order.price).toFixed(2)} · paid via{" "}
                {order.payment_method === "wallet" ? "Wallet" : "MoMo"}
              </small>
            </div>
            <div className="timeline">
              {events.map((ev, i) => (
                <div
                  key={i}
                  className={
                    "tl-item " +
                    (i < events.length - 1
                      ? "done"
                      : ["unpaid", "paid", "processing"].includes(order.status)
                        ? "active"
                        : "done")
                  }
                >
                  <b>{STATUS_LABEL[ev.status] || ev.status}</b>
                  <span>{new Date(ev.created_at).toLocaleString("en-GH")}</span>
                  {ev.note && <span> · {ev.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function TrackPage() {
  return (
    <Suspense>
      <TrackInner />
    </Suspense>
  );
}
