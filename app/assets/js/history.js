/* ============================================================================
   Purchase History — /history.html

   Talks to GET /api/account/history (customer token required):
     · delivery-progress pulse  (fast lane / standard queue / checking now)
     · debounced search across phone, reference, provider ref and track no.
     · status + network filters, pagination ("load more")
     · expandable order cards with copy-to-clipboard refs and a receipt the
       customer can paste to whoever they bought the bundle for.

   Auto-refreshes every 30s while any order is still processing.
   ========================================================================== */

(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const money = (n) => "GH₵" + Number(n || 0).toFixed(2);

  const token = () =>
    localStorage.getItem("vd_token") || localStorage.getItem("vd_customer_token");

  const state = {
    q: "",
    status: "all",
    network: "all",
    page: 1,
    perPage: 10,
    orders: [],
    progress: null,
    totals: null,
    hasMore: false,
    open: new Set(),
    loading: false,
    timer: null,
  };

  /* ---------- helpers ---------- */
  function timeOnly(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("en-GH", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    }).toLowerCase();
  }
  function dayTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.toLocaleDateString("en-GH", { day: "numeric", month: "short" })} at ${timeOnly(iso)}`;
  }
  function fullDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })} at ${d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function netShort(code) {
    return { mtn: "MTN", telecel: "TELECEL", airteltigo: "AT" }[code] || (code || "?").toUpperCase();
  }

  function toast(msg, bad) {
    const t = document.createElement("div");
    t.className = "conn-pill";
    t.style.background = bad ? "var(--red)" : "var(--green)";
    t.style.color = bad ? "#fff" : "#04231a";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    if (btn) {
      btn.classList.add("done");
      setTimeout(() => btn.classList.remove("done"), 1200);
    }
    toast("Copied");
  }

  const COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  /* ---------- data ---------- */
  async function load({ append = false } = {}) {
    const tok = token();
    if (!tok) {
      $("#histList").innerHTML =
        `<div class="hist-empty"><b>Sign in to see your orders</b>Your purchase history is tied to your Valmont Data account.
         <div style="margin-top:16px"><a class="btn btn-orange" href="signin.html">Sign in</a></div></div>`;
      return;
    }
    if (state.loading) return;
    state.loading = true;
    if (!append) $("#histList").innerHTML = '<div class="hist-skel"></div><div class="hist-skel"></div><div class="hist-skel"></div>';

    const qs = new URLSearchParams({
      q: state.q,
      status: state.status,
      network: state.network,
      page: String(state.page),
      per_page: String(state.perPage),
    });

    try {
      const res = await fetch("/api/account/history?" + qs, {
        headers: { Authorization: "Bearer " + tok },
        cache: "no-store",
      });
      if (res.status === 401) {
        $("#histList").innerHTML =
          `<div class="hist-empty"><b>Your session expired</b>Sign in again to view your purchase history.
           <div style="margin-top:16px"><a class="btn btn-orange" href="signin.html">Sign in</a></div></div>`;
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load history");

      state.orders = append ? state.orders.concat(data.orders) : data.orders;
      state.progress = data.progress;
      state.totals = data.totals;
      state.hasMore = data.has_more;

      renderProgress();
      renderSummary();
      renderList();
      scheduleRefresh();
    } catch (e) {
      $("#histList").innerHTML = `<div class="hist-empty"><b>Couldn't load your orders</b>${esc(e.message)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  /* ---------- delivery progress ---------- */
  function laneHtml(lane, kind) {
    if (!lane) return "";
    const icon =
      kind === "fast"
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline></svg>';
    return `
      <div class="prog-lane ${kind === "fast" ? "fast" : "std"}">
        <div class="prog-lane-top">
          ${icon}
          <b>${esc(lane.lane)} · ${esc(lane.duration || "—")}</b>
          <span class="prog-track">#${esc(lane.track)}</span>
        </div>
        <small>placed ${esc(dayTime(lane.placed_at))} → delivered ${esc(dayTime(lane.delivered_at))}</small>
      </div>`;
  }

  function renderProgress() {
    const p = state.progress;
    const card = $("#progCard");
    if (!p || (!p.fast_lane && !p.checking_now)) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    $("#progBody").innerHTML = `
      <div class="prog-notice ${p.network_slow ? "slow" : "ok"}">
        <span class="dot"></span><span>${esc(p.notice)}</span>
      </div>
      ${p.fast_lane || p.standard_queue
        ? `<div class="prog-lanes">${laneHtml(p.fast_lane, "fast")}${laneHtml(p.standard_queue, "std")}</div>`
        : ""}
      ${p.checking_now
        ? `<div class="prog-checking"><span class="spinner"></span>Checking now <span>· #${esc(p.checking_now.track)}</span></div>`
        : ""}
      <div class="prog-foot">Last checked ${esc(new Date(p.checked_at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }))}</div>
    `;
  }

  function renderSummary() {
    const t = state.totals;
    if (!t) return;
    const filtering = state.q || state.status !== "all" || state.network !== "all";
    $("#histSummary").innerHTML = filtering
      ? `Showing <b>${t.matched}</b> of <b>${t.all}</b> orders`
      : `<b>${t.all}</b> orders · <b>${t.delivered}</b> delivered · <b>${t.processing}</b> processing · <b>${money(t.spent)}</b> spent`;
  }

  /* ---------- order cards ---------- */
  function receiptText(o) {
    return [
      "VALMONT DATA — RECEIPT",
      `${o.network_name} ${o.size_label}`,
      `Number : ${o.phone}`,
      `Amount : ${money(o.amount)}`,
      `Status : ${o.status_label}`,
      `Track  : #${o.track}`,
      `Ref    : ${o.provider_reference || o.reference}`,
      `Placed : ${fullDate(o.created_at)}`,
      o.delivered_at ? `Delivered: ${fullDate(o.delivered_at)}` : "",
      "",
      "Track your order at valmontdata.com/status.html",
    ].filter(Boolean).join("\n");
  }

  function cardHtml(o) {
    const open = state.open.has(o.track);
    return `
    <div class="ord-card ${open ? "open" : ""}" data-track="${esc(o.track)}">
      <button class="ord-top" data-toggle>
        <span class="ord-logo ${esc(o.network || "")}">${esc(netShort(o.network))}</span>
        <span class="ord-mid">
          <span class="ord-line1">
            <span class="ord-net">${esc(o.network_name || "")}</span>
            <span class="ord-size">${esc(o.size_label || "")}</span>
          </span>
          <span class="pill ${esc(o.status)}" style="margin-top:6px">${esc(o.status_label)}</span>
        </span>
        <span class="ord-right">
          <span class="ord-amount">${money(o.amount)}</span>
        </span>
        <svg class="ord-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>

      ${open ? `
      <div class="ord-body">
        <div class="ord-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"></path></svg>
          <span class="lbl">Phone</span><span class="val">${esc(o.phone)}</span>
          <button class="copy-btn" data-copy="${esc(o.phone)}" title="Copy number">${COPY_ICON}</button>
        </div>

        <div class="ord-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          <span class="lbl">Ref</span><span class="val">${esc(o.provider_reference || o.reference)}</span>
          <button class="copy-btn" data-copy="${esc(o.provider_reference || o.reference)}" title="Copy reference">${COPY_ICON}</button>
        </div>

        <div class="ord-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>
          <span class="lbl">Track</span><span class="val track">${esc(o.track)}</span>
          <button class="copy-btn" data-copy="${esc(o.track)}" title="Copy tracking number">${COPY_ICON}</button>
        </div>

        <div class="ord-note ${esc(o.explain.tone)}">
          <b>${esc(o.explain.title)}</b>${esc(o.explain.body)}
        </div>

        ${o.queue_hint ? `<div class="ord-note info"><b>${esc(o.queue_hint.title)}</b>${esc(o.queue_hint.body)}</div>` : ""}

        ${o.duration ? `<div class="ord-date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline></svg>Turnaround<span class="val">${esc(o.duration)}</span></div>` : ""}

        <div class="ord-date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          <span class="val">${esc(fullDate(o.created_at))}</span>
        </div>

        <div class="ord-actions">
          <button class="btn-copy-all" data-copy-all>${COPY_ICON} Copy All Details</button>
          <button class="btn-receipt" data-receipt>🧾 Receipt for Customer</button>
        </div>
      </div>` : ""}
    </div>`;
  }

  function renderList() {
    const host = $("#histList");
    if (!state.orders.length) {
      const filtering = state.q || state.status !== "all" || state.network !== "all";
      host.innerHTML = filtering
        ? `<div class="hist-empty"><b>No matching orders</b>Try a different search or clear your filters.</div>`
        : `<div class="hist-empty"><b>No orders yet</b>Your data purchases will show up here.
           <div style="margin-top:16px"><a class="btn btn-orange" href="/">Buy data</a></div></div>`;
      $("#histMore").hidden = true;
      return;
    }
    host.innerHTML = state.orders.map(cardHtml).join("");
    $("#histMore").hidden = !state.hasMore;
    wireCards();
  }

  function wireCards() {
    $$(".ord-card").forEach((card) => {
      const track = card.dataset.track;
      const order = state.orders.find((o) => o.track === track);

      $("[data-toggle]", card)?.addEventListener("click", () => {
        if (state.open.has(track)) state.open.delete(track);
        else state.open.add(track);
        renderList();
      });

      $$("[data-copy]", card).forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          copy(b.dataset.copy, b);
        })
      );

      $("[data-copy-all]", card)?.addEventListener("click", (e) => {
        e.stopPropagation();
        copy(
          [
            `${order.network_name} ${order.size_label} — ${money(order.amount)}`,
            `Phone: ${order.phone}`,
            `Ref: ${order.provider_reference || order.reference}`,
            `Track: #${order.track}`,
            `Status: ${order.status_label}`,
            `Placed: ${fullDate(order.created_at)}`,
          ].join("\n")
        );
      });

      $("[data-receipt]", card)?.addEventListener("click", (e) => {
        e.stopPropagation();
        copy(receiptText(order));
      });
    });
  }

  /* ---------- auto refresh while orders are in flight ---------- */
  function scheduleRefresh() {
    clearTimeout(state.timer);
    const active = state.orders.some((o) => o.status_group === "processing");
    if (!active) return;
    state.timer = setTimeout(() => {
      state.page = 1;
      load();
    }, 30000);
  }

  /* ---------- wiring ---------- */
  function activeFilterCount() {
    return (state.status !== "all" ? 1 : 0) + (state.network !== "all" ? 1 : 0);
  }
  function syncFilterBadge() {
    const n = activeFilterCount();
    const el = $("#filtersCount");
    el.hidden = n === 0;
    el.textContent = String(n);
  }

  let debounce;
  $("#histSearch").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = e.target.value.trim();
      state.page = 1;
      load();
    }, 320);
  });

  $("#btnFilters").addEventListener("click", () => {
    const panel = $("#filtersPanel");
    panel.hidden = !panel.hidden;
    $("#btnFilters").setAttribute("aria-expanded", String(!panel.hidden));
  });

  $$("#statusChips .fchip").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#statusChips .fchip").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      state.status = b.dataset.status;
      state.page = 1;
      syncFilterBadge();
      load();
    })
  );

  $$("#networkChips .fchip").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#networkChips .fchip").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      state.network = b.dataset.network;
      state.page = 1;
      syncFilterBadge();
      load();
    })
  );

  $("#btnMore").addEventListener("click", () => {
    state.page += 1;
    load({ append: true });
  });

  $("#btnRefresh").addEventListener("click", () => {
    const btn = $("#btnRefresh");
    btn.classList.add("spin");
    state.page = 1;
    load().finally(() => setTimeout(() => btn.classList.remove("spin"), 500));
  });

  // Deep link: /history.html?q=0541234567
  const initialQ = new URLSearchParams(location.search).get("q");
  if (initialQ) {
    state.q = initialQ;
    $("#histSearch").value = initialQ;
  }

  load();
})();
