/* Admin console — float, prices sync, orders, P&L, webhook audit. */

(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const TOKEN_KEY = "vd_admin_token";
  const fmt = (n) => "GH₵" + Number(n).toFixed(2);
  const NET_NAMES = { mtn: "MTN", telecel: "Telecel", airteltigo: "AirtelTigo" };

  let activePlDays = 7;
  let syncReviewData = null;

  function token() { return sessionStorage.getItem(TOKEN_KEY) || ""; }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      location.reload();
      throw new Error("UNAUTHORIZED");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  /* ---------- login ---------- */
  $("#loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginErr").innerHTML = "";
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("#loginPass").value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      sessionStorage.setItem(TOKEN_KEY, data.token);
      enter();
    } catch (err) {
      $("#loginErr").innerHTML = `<div class="notice" style="margin-top:12px">${err.message}</div>`;
    }
  });

  function enter() {
    const lv = $("#loginView");
    const dv = $("#dashView");
    if (lv) lv.style.display = "none";
    if (dv) dv.style.display = "block";
    loadFloat();
    loadCatalog();
    loadOrders();
    loadPl(activePlDays);
    loadWebhooks();
  }
  if (token()) enter();

  $("#logoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  /* ---------- seed initial float (one click, fresh deploy) ---------- */
  const seedBtn = $("#seedFloatBtn");
  if (seedBtn) {
    seedBtn.addEventListener("click", async () => {
      seedBtn.disabled = true;
      seedBtn.textContent = "Seeding…";
      try {
        const d = await api("/api/admin/float/seed", { method: "POST", body: "{}" });
        const msg = $("#seedFloatMsg");
        if (msg) {
          msg.textContent = d.message + " · " + d.results
            .map((r) => `${NET_NAMES[r.code] || r.code}: ${r.seeded ? "seeded " + fmt(d.seed_amount) : "already has " + fmt(r.balance)}`)
            .join(" · ");
        }
        loadFloat();
      } catch (err) {
        alert(err.message);
      } finally {
        seedBtn.disabled = false;
        seedBtn.textContent = "Seed initial float (GH₵500 / network)";
      }
    });
  }

  /* ---------- tabs ---------- */
  $$(".admin-tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".admin-tab").forEach((x) => x.classList.remove("on"));
      t.classList.add("on");
      const activeTab = t.dataset.tab;
      ["float", "prices", "orders", "pl", "webhooks"].forEach((k) => {
        const panel = $("#tab-" + k);
        if (panel) panel.style.display = k === activeTab ? "block" : "none";
      });
      if (activeTab === "float") loadFloat();
      else if (activeTab === "prices") loadCatalog();
      else if (activeTab === "orders") loadOrders();
      else if (activeTab === "pl") loadPl(activePlDays);
      else if (activeTab === "webhooks") loadWebhooks();
    })
  );

  /* ---------- float + supplier wallet ---------- */
  async function loadFloat() {
    try {
      const d = await api("/api/admin/float");
      let walletInfo = null;
      try {
        walletInfo = await api("/api/admin/wallet-balance");
      } catch {}

      const cards = $("#floatCards");
      if (cards && d.balances) {
        let cardsHtml = d.balances
          .map(
            (b) => `<div class="stat-card stat-card-${b.code}">
              <div class="label"><span class="net-chip ${b.code}">${NET_NAMES[b.code] || b.code}</span> float</div>
              <div class="value ${b.low ? "low" : "ok"}">${fmt(b.balance)}</div>
              <div class="sub">${b.low ? "⚠ LOW — below " + fmt(b.threshold) : "healthy"}</div>
            </div>`
          )
          .join("");

        if (walletInfo) {
          cardsHtml += `<div class="stat-card" style="border-top:3px solid var(--orange)">
            <div class="label">RemaData Wallet</div>
            <div class="value ok">${fmt(walletInfo.balance)}</div>
            <div class="sub">${walletInfo.mock ? "Simulated wallet" : "Live wholesale balance"}</div>
          </div>`;
        }

        cards.innerHTML = cardsHtml;
      }

      const ledger = $("#ledgerBody");
      if (ledger) {
        ledger.innerHTML = d.ledger && d.ledger.length
          ? d.ledger
              .map(
                (l) => `<tr>
                  <td>${new Date(l.created_at).toLocaleString("en-GH")}</td>
                  <td><span class="net-chip ${l.network}">${NET_NAMES[l.network] || l.network}</span></td>
                  <td>${l.direction}</td>
                  <td>${l.direction === "debit" ? "−" : "+"}${fmt(l.amount)}</td>
                  <td><b style="color:#fff">${fmt(l.balance_after)}</b></td>
                  <td>${l.note || ""}</td>
                </tr>`
              )
              .join("")
          : `<tr><td colspan="6" class="empty">No float ledger entries yet — top up float or seed initial float above to start.</td></tr>`;
      }
    } catch {
      // Handled by api()
    }
  }

  $("#topupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/float/topup", {
        method: "POST",
        body: JSON.stringify({ network: $("#topupNet").value, amount: Number($("#topupAmount").value) }),
      });
      $("#topupAmount").value = "";
      loadFloat();
    } catch (err) {
      alert(err.message);
    }
  });

  /* ---------- prices & sync ---------- */
  async function loadCatalog() {
    try {
      const d = await api("/api/admin/bundles");
      const body = $("#catalogBody");
      if (!body) return;
      body.innerHTML = d.bundles && d.bundles.length
        ? d.bundles
            .map((b) => {
              const gb = b.size_mb >= 1024 ? b.size_mb / 1024 + "GB" : b.size_mb + "MB";
              const margin = Number((b.sell_price - b.cost_price).toFixed(2));
              const pct = b.cost_price > 0 ? ((margin / b.cost_price) * 100).toFixed(1) + "%" : "—";
              return `<tr>
                <td><span class="net-chip ${b.network_code}">${b.network_name || b.network_code}</span></td>
                <td><b>${gb}</b></td>
                <td>${b.validity_days ? b.validity_days + " days" : "No Expiry"}</td>
                <td>${fmt(b.cost_price)}</td>
                <td><b style="color:#fff">${fmt(b.sell_price)}</b></td>
                <td><span class="badge-ok">+${fmt(margin)} (${pct})</span></td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="6" class="empty">No bundles found in catalogue.</td></tr>`;
    } catch {
      // Handled by api()
    }
  }

  $("#btnSyncPrices")?.addEventListener("click", async () => {
    const btn = $("#btnSyncPrices");
    const msg = $("#syncStatusMsg");
    const reviewArea = $("#priceReviewArea");
    const reviewBody = $("#priceReviewBody");

    btn.disabled = true;
    btn.textContent = "Fetching RemaData prices…";
    if (msg) msg.innerHTML = "";

    try {
      const data = await api("/api/admin/remadata-prices");
      syncReviewData = data.bundles || [];

      let lossCount = 0;
      reviewBody.innerHTML = syncReviewData
        .map((b) => {
          const gb = b.size_mb >= 1024 ? b.size_mb / 1024 + "GB" : b.size_mb + "MB";
          if (b.is_loss) lossCount++;
          const costDiff = Number((b.new_cost - b.current_cost).toFixed(2));
          const diffStr = costDiff > 0 ? ` (+${fmt(costDiff)})` : costDiff < 0 ? ` (${fmt(costDiff)})` : " (same)";

          return `<tr class="${b.is_loss ? "row-loss" : ""}">
            <td><span class="net-chip ${b.network}">${b.network_name}</span></td>
            <td><b>${gb}</b></td>
            <td>${fmt(b.current_cost)}</td>
            <td><b style="color:var(--orange)">${fmt(b.new_cost)}</b><small style="color:var(--muted)">${diffStr}</small></td>
            <td>${fmt(b.current_sell)}</td>
            <td>${fmt(b.current_margin)}</td>
            <td>
              <input class="inp inp-suggested-sell" type="number" step="0.1"
                     data-id="${b.id}" data-cost="${b.new_cost}"
                     value="${b.is_loss ? b.suggested_sell.toFixed(2) : b.current_sell.toFixed(2)}"
                     style="width:110px;padding:6px 10px;font-size:13px;background:rgba(0,0,0,0.3)">
            </td>
            <td><b class="${b.is_loss ? "err" : ""}" id="margin-preview-${b.id}">${fmt(b.new_margin)}</b></td>
            <td>${b.is_loss ? '<span class="badge-loss">⚠️ AT LOSS</span>' : '<span class="badge-ok">✓ Margin OK</span>'}</td>
          </tr>`;
        })
        .join("");

      // Update margin preview on custom sell price input change
      $$(".inp-suggested-sell", reviewBody).forEach((inp) => {
        inp.addEventListener("input", () => {
          const id = inp.dataset.id;
          const cost = Number(inp.dataset.cost);
          const sell = Number(inp.value) || 0;
          const marginEl = $(`#margin-preview-${id}`);
          if (marginEl) {
            const m = Number((sell - cost).toFixed(2));
            marginEl.textContent = fmt(m);
            marginEl.className = sell <= cost ? "err" : "";
          }
        });
      });

      if (reviewArea) reviewArea.style.display = "block";
      if (msg) {
        msg.innerHTML = `<div class="notice ok" style="margin-top:10px">
          Fetched <b>${syncReviewData.length}</b> bundle costs from RemaData.
          ${lossCount > 0 ? `<b style="color:var(--red)">${lossCount} bundles</b> are selling at or below the new wholesale cost. Suggested sell prices have been calculated (+15% margin). Review below and click Apply.` : "All margins are healthy."}
        </div>`;
      }
    } catch (err) {
      if (msg) msg.innerHTML = `<div class="notice err" style="margin-top:10px">${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "⚡ Sync prices from RemaData";
    }
  });

  $("#btnCancelPrices")?.addEventListener("click", () => {
    const reviewArea = $("#priceReviewArea");
    if (reviewArea) reviewArea.style.display = "none";
    const msg = $("#syncStatusMsg");
    if (msg) msg.innerHTML = "";
    syncReviewData = null;
  });

  $("#btnApplyPrices")?.addEventListener("click", async () => {
    if (!syncReviewData) return;
    const btn = $("#btnApplyPrices");
    btn.disabled = true;
    btn.textContent = "Applying updates…";

    const updates = [];
    $$(".inp-suggested-sell", $("#priceReviewBody")).forEach((inp) => {
      const id = Number(inp.dataset.id);
      const cost = Number(inp.dataset.cost);
      const sell = Number(inp.value);
      if (id && cost >= 0) {
        updates.push({ id, cost_price: cost, sell_price: sell > 0 ? sell : undefined });
      }
    });

    try {
      const res = await api("/api/admin/bundles/update-prices", {
        method: "POST",
        body: JSON.stringify({ updates }),
      });
      alert(res.message || "Prices updated successfully!");
      $("#priceReviewArea").style.display = "none";
      const msg = $("#syncStatusMsg");
      if (msg) msg.innerHTML = `<div class="notice ok">${res.message || "Prices updated and active in catalogue."}</div>`;
      syncReviewData = null;
      loadCatalog();
      loadFloat();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Apply confirmed updates";
    }
  });

  /* ---------- orders ---------- */
  async function loadOrders() {
    try {
      const status = $("#fStatus")?.value || "all";
      const network = $("#fNetwork")?.value || "all";
      const isFiltered = status !== "all" || network !== "all";
      const d = await api(`/api/admin/orders?status=${status}&network=${network}&limit=60`);
      const body = $("#ordersBody");
      if (!body) return;
      body.innerHTML = d.orders && d.orders.length
        ? d.orders
            .map(
              (o) => `<tr>
                <td><b style="color:#fff">${o.reference}</b></td>
                <td>${o.phone}</td>
                <td>${o.bundle} <span class="net-chip ${o.network}">${NET_NAMES[o.network] || ""}</span></td>
                <td>${fmt(o.amount)}</td>
                <td style="color:var(--muted)">${fmt(o.cost)}</td>
                <td>${fmt(o.margin)}</td>
                <td><span class="pill ${o.status}">${o.status}</span></td>
                <td>${o.attempts}</td>
                <td>${o.supplier_error ? `<span class="err">${o.supplier_error}</span>` : o.supplier_ref || "—"}</td>
                <td>${o.retryable ? `<button class="btn btn-ghost btn-sm" data-retry="${o.reference}">Retry</button>` : ""}</td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="10" class="empty">${isFiltered ? "No orders match the selected filters." : "No orders yet — they'll appear here after your first sale."}</td></tr>`;

      $$("[data-retry]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            const r = await api("/api/admin/orders/retry", {
              method: "POST",
              body: JSON.stringify({ reference: b.dataset.retry }),
            });
            alert(`${b.dataset.retry}: retried → ${r.ok ? "delivered" : r.reason || "failed"}`);
            loadOrders();
          } catch (err) {
            alert(err.message);
            b.disabled = false;
          }
        })
      );
    } catch {
      // Handled by api()
    }
  }

  $("#orderFilters")?.addEventListener("submit", (e) => {
    e.preventDefault();
    loadOrders();
  });

  /* ---------- P&L ---------- */
  async function loadPl(days) {
    try {
      activePlDays = days;
      const d = await api(`/api/admin/pl?days=${days}`);
      const body = $("#plBody");
      if (!body) return;
      let total = { orders: 0, revenue: 0, cost: 0, margin: 0 };
      body.innerHTML = d.rows && d.rows.length
        ? d.rows
            .map((r) => {
              total.orders += Number(r.orders);
              total.revenue += Number(r.revenue);
              total.cost += Number(r.cost);
              total.margin += Number(r.margin);
              return `<tr>
                <td>${r.day}</td>
                <td><span class="net-chip ${r.network}">${NET_NAMES[r.network] || r.network}</span></td>
                <td>${r.orders}</td>
                <td>${fmt(r.revenue)}</td>
                <td style="color:var(--muted)">${fmt(r.cost)}</td>
                <td><b style="color:var(--green)">${fmt(r.margin)}</b></td>
              </tr>`;
            })
            .join("") +
          `<tr style="border-top:2px solid var(--line-strong)">
            <td><b style="color:#fff">Total</b></td><td></td>
            <td><b style="color:#fff">${total.orders}</b></td>
            <td><b style="color:#fff">${fmt(total.revenue)}</b></td>
            <td><b style="color:#fff">${fmt(total.cost)}</b></td>
            <td><b style="color:var(--green)">${fmt(total.margin)}</b></td>
          </tr>`
        : `<tr><td colspan="6" class="empty">No sales data yet — revenue and margin breakdown will appear here after orders are paid and delivered.</td></tr>`;
    } catch {
      // Handled by api()
    }
  }

  $$("[data-days]").forEach((b) =>
    b.addEventListener("click", () => {
      const days = Number(b.dataset.days);
      activePlDays = days;
      $$("[data-days]").forEach((btn) => {
        if (Number(btn.dataset.days) === activePlDays) {
          btn.className = "btn btn-orange btn-sm";
        } else {
          btn.className = "btn btn-ghost btn-sm";
        }
      });
      loadPl(days);
    })
  );

  /* ---------- webhooks ---------- */
  async function loadWebhooks() {
    try {
      const d = await api("/api/admin/webhooks?limit=25");
      const body = $("#webhooksBody");
      if (!body) return;
      body.innerHTML = d.webhooks && d.webhooks.length
        ? d.webhooks
            .map(
              (w) => `<tr>
                <td>${new Date(w.created_at).toLocaleString("en-GH")}</td>
                <td>${w.signature_valid ? '<b style="color:var(--green)">✓ valid</b>' : '<b style="color:var(--red)">✗ INVALID</b>'}</td>
                <td>${w.handled ? "✓" : "—"}</td>
                <td>${w.error ? `<span class="err">${w.error}</span>` : "—"}</td>
                <td style="font-size:11px;color:var(--muted);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${JSON.stringify(w.payload).slice(0, 160)}</td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="empty">No webhook events yet — they appear after the first payment.</td></tr>`;
    } catch {
      // Handled by api()
    }
  }
})();
