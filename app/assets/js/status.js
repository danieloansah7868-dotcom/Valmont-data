/* Order status page — fetch by reference, poll while active. */

(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const STATUS_LABEL = {
    pending: "Awaiting payment",
    paid: "Payment received",
    delivering: "Delivering…",
    delivered: "Delivered ✓",
    failed: "Delivery failed",
    refunded: "Refunded",
  };

  async function lookup(ref, poll = false) {
    const result = $("#result");
    try {
      const res = await fetch("/api/orders?reference=" + encodeURIComponent(ref), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        result.innerHTML = `<div class="notice">${data.error || "Order not found"}</div>`;
        return;
      }
      const o = data.order;
      const gb = o.bundle.size_mb >= 1024 ? o.bundle.size_mb / 1024 + "GB" : o.bundle.size_mb + "MB";
      const validity = o.bundle.validity_days ? o.bundle.validity_days + "-day rollover" : "No Expiry";
      const netCode = o.bundle.network || (o.bundle.network_name ? o.bundle.network_name.toLowerCase().replace(/[^a-z]/g, "") : "");
      result.innerHTML = `
        <div class="track-card">
          <div class="oid">${o.reference} <span class="pill ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
            <small>${gb} <span class="net-chip ${netCode}">${o.bundle.network_name}</span> → ${o.phone} · ${"GH₵" + o.amount.toFixed(2)}</small>
          </div>
          <div class="details">
            <div class="drow"><span>Network</span><b class="net-chip ${netCode}">${o.bundle.network_name}</b></div>
            <div class="drow"><span>Validity</span><b>${validity}</b></div>
            <div class="drow"><span>Placed</span><b>${new Date(o.created_at).toLocaleString("en-GH")}</b></div>
            ${o.delivered_at ? `<div class="drow"><span>Delivered</span><b>${new Date(o.delivered_at).toLocaleString("en-GH")}</b></div>` : ""}
            ${o.attempts > 1 ? `<div class="drow"><span>Delivery attempts</span><b>${o.attempts}</b></div>` : ""}
            ${o.supplier_error ? `<div class="drow"><span>Status detail</span><b style="color:#ff9d92">${o.supplier_error}</b></div>` : ""}
          </div>
          ${o.status === "refunded" ? `<div class="notice ok" style="margin-top:14px"><b>Refunded.</b> If this was a wallet payment the money is already back; MoMo refunds land within 24h.</div>` : ""}
          ${o.status === "failed" ? `<div class="notice"><b>We're on it.</b> Failed deliveries retry automatically (up to 3 attempts). If it stays failed, you get an automatic refund.</div>` : ""}
        </div>`;
      if (poll && ["pending", "paid", "delivering"].includes(o.status)) {
        setTimeout(() => lookup(ref, true), 4000);
      }
    } catch {
      result.innerHTML = `<div class="notice">Network error — try again.</div>`;
    }
  }

  $("#trackForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const ref = $("#trackRef").value.trim();
    if (!ref) return;
    lookup(ref, true);
  });

  const fromUrl = new URLSearchParams(location.search).get("reference");
  if (fromUrl) {
    $("#trackRef").value = fromUrl;
    lookup(fromUrl, true);
  }
})();
