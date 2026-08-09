/* Admin console — float, orders, P&L, webhook audit. */

(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const TOKEN_KEY = "vd_admin_token";
  const fmt = (n) => "GH₵" + Number(n).toFixed(2);
  const NET_NAMES = { mtn: "MTN", telecel: "Telecel", airteltigo: "AirtelTigo" };

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
  $("#loginForm").addEventListener("submit", async (e) => {
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
    $("#loginView").style.display = "none";
    $("#dashView").style.display = "block";
    loadFloat();
    loadOrders();
    loadPl(7);
    loadWebhooks();
  }
  if (token()) enter();

  $("#logoutBtn").addEventListener("click", () => {
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
      ["float", "orders", "pl", "webhooks"].forEach((k) => {
        $("#tab-" + k).style.display = k === t.dataset.tab ? "block" : "none";
      });
    })
  );

  /* ---------- float ---------- */
  async function loadFloat() {
    const d = await api("/api/admin/float");
    $("#floatCards").innerHTML = d.balances
      .map(
        (b) => `<div class="stat-card">
          <div class="label">${NET_NAMES[b.code] || b.code} float</div>
          <div class="value ${b.low ? "low" : "ok"}">${fmt(b.balance)}</div>
          <div class="sub">${b.low ? "⚠ LOW — below " + fmt(b.threshold) : "healthy"}</div>
        </div>`
      )
      .join("");
    $("#ledgerBody").innerHTML = d.ledger.length
      ? d.ledger
          .map(
            (l) => `<tr>
              <td>${new Date(l.created_at).toLocaleString("en-GH")}</td>
              <td>${NET_NAMES[l.network] || l.network}</td>
              <td>${l.direction}</td>
              <td>${l.direction === "debit" ? "−" : "+"}${fmt(l.amount)}</td>
              <td><b style="color:#fff">${fmt(l.balance_after)}</b></td>
              <td>${l.note || ""}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="6" class="empty">No ledger entries yet — top up float to start.</td></tr>`;
  }

  $("#topupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const d = await api("/api/admin/float/topup", {
        method: "POST",
        body: JSON.stringify({ network: $("#topupNet").value, amount: Number($("#topupAmount").value) }),
      });
      $("#topupAmount").value = "";
      loadFloat();
    } catch (err) {
      alert(err.message);
    }
  });

  /* ---------- orders ---------- */
  async function loadOrders() {
    const status = $("#fStatus").value;
    const network = $("#fNetwork").value;
    const d = await api(`/api/admin/orders?status=${status}&network=${network}&limit=60`);
    $("#ordersBody").innerHTML = d.orders.length
      ? d.orders
          .map(
            (o) => `<tr>
              <td><b style="color:#fff">${o.reference}</b></td>
              <td>${o.phone}</td>
              <td>${o.bundle} ${NET_NAMES[o.network] || ""}</td>
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
      : `<tr><td colspan="10" class="empty">No orders match.</td></tr>`;

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
  }
  $("#orderFilters").addEventListener("submit", (e) => {
    e.preventDefault();
    loadOrders();
  });

  /* ---------- P&L ---------- */
  async function loadPl(days) {
    const d = await api(`/api/admin/pl?days=${days}`);
    let total = { orders: 0, revenue: 0, cost: 0, margin: 0 };
    $("#plBody").innerHTML = d.rows.length
      ? d.rows
          .map((r) => {
            total.orders += Number(r.orders);
            total.revenue += Number(r.revenue);
            total.cost += Number(r.cost);
            total.margin += Number(r.margin);
            return `<tr>
              <td>${r.day}</td>
              <td>${NET_NAMES[r.network] || r.network}</td>
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
      : `<tr><td colspan="6" class="empty">No paid orders in this window.</td></tr>`;
  }
  $$("[data-days]").forEach((b) =>
    b.addEventListener("click", () => loadPl(Number(b.dataset.days)))
  );

  /* ---------- webhooks ---------- */
  async function loadWebhooks() {
    const d = await api("/api/admin/webhooks?limit=25");
    $("#webhooksBody").innerHTML = d.webhooks.length
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
      : `<tr><td colspan="5" class="empty">No webhook calls yet.</td></tr>`;
  }
})();
