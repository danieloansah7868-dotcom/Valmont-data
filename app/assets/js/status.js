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
    refund_pending: "Refund being arranged",
    refunded: "Refund completed",
  };
  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const safeStatus = (value) => Object.prototype.hasOwnProperty.call(STATUS_LABEL, value) ? value : "failed";

  async function lookup(ref, poll = false) {
    const result = $("#result");
    try {
      const res = await fetch("/api/orders?reference=" + encodeURIComponent(ref), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        result.innerHTML = `<div class="notice">${escapeHtml(data.error || "Order not found")}</div>`;
        return;
      }
      const o = data.order || {};
      const bundle = o.bundle || {};
      const status = safeStatus(o.status);
      const sizeMb = Number(bundle.size_mb) || 0;
      const gb = sizeMb >= 1024 ? sizeMb / 1024 + "GB" : sizeMb + "MB";
      const validity = bundle.validity_days ? Number(bundle.validity_days) + "-day rollover" : "No Expiry";
      const netCode = String(bundle.network || (bundle.network_name ? bundle.network_name.toLowerCase().replace(/[^a-z]/g, "") : "")).replace(/[^a-z]/g, "");
      const networkName = escapeHtml(bundle.network_name || "Network");
      const refundNote = escapeHtml(o.refund_note || "Our team is arranging a refund to the original payment method.");
      const amount = Number(o.amount || 0).toFixed(2);
      result.innerHTML = `
        <div class="track-card">
          <div class="oid">${escapeHtml(o.reference)} <span class="pill ${status}">${STATUS_LABEL[status]}</span>
            <small>${gb} <span class="net-chip ${netCode}">${networkName}</span> → ${escapeHtml(o.phone)} · ${"GH₵" + amount}</small>
          </div>
          <div class="details">
            <div class="drow"><span>Network</span><b class="net-chip ${netCode}">${networkName}</b></div>
            <div class="drow"><span>Validity</span><b>${validity}</b></div>
            <div class="drow"><span>Placed</span><b>${escapeHtml(new Date(o.created_at).toLocaleString("en-GH"))}</b></div>
            ${o.delivered_at ? `<div class="drow"><span>Delivered</span><b>${escapeHtml(new Date(o.delivered_at).toLocaleString("en-GH"))}</b></div>` : ""}
            ${Number(o.attempts || 0) > 1 ? `<div class="drow"><span>Delivery attempts</span><b>${Number(o.attempts)}</b></div>` : ""}
            ${o.supplier_error ? `<div class="drow"><span>Status detail</span><b style="color:#ff9d92">${escapeHtml(o.supplier_error)}</b></div>` : ""}
          </div>
          ${status === "refund_pending" ? `<div class="notice" style="margin-top:14px"><b>Refund being arranged.</b> ${refundNote} We will confirm after it is completed.</div>` : ""}
          ${status === "refunded" ? `<div class="notice ok" style="margin-top:14px"><b>Refund completed.</b> ${refundNote} Provider timing can vary before it appears.</div>` : ""}
          ${status === "failed" ? `<div class="notice"><b>We're on it.</b> Failed deliveries may retry automatically (up to 3 attempts). If delivery cannot be completed, our team arranges a refund to the original payment method.</div>` : ""}
        </div>`;
      if (poll && ["pending", "paid", "delivering"].includes(status)) {
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
