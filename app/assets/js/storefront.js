/* ============================================================================
   Valmont Data storefront — bundle grid, Ghana phone validation,
   confirm-before-pay flow, Valmont-Pay checkout handoff.
   ============================================================================ */

(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const fmt = (n) => "GH₵" + Number(n).toFixed(2);

  const VALID_PREFIXES = ["20","23","24","25","26","27","28","50","53","54","55","56","57","59"];
  const NETWORK_PREFIXES = {
    mtn: ["24","25","26","27","54","55","56","57","59"],
    telecel: ["20","23","50","53"],
    airteltigo: ["26","27","28"],
  };
  const NETWORK_NAMES = { mtn: "MTN", telecel: "Telecel", airteltigo: "AirtelTigo" };

  let state = { bundles: [], networks: [], floats: {}, lowFloat: {}, currentNet: "mtn", selected: null };

  /* ---------- phone validation (mirror of lib/phones.js) ---------- */
  function normalizePhone(p) { return String(p || "").replace(/[\s-]/g, ""); }
  function validatePhone(p) {
    const n = normalizePhone(p);
    if (!/^0\d{9}$/.test(n)) return { ok: false, n, msg: "Must be 10 digits starting with 0" };
    const prefix = n.slice(1, 3);
    if (!VALID_PREFIXES.includes(prefix)) return { ok: false, n, msg: "0" + prefix + " is not a valid Ghana prefix" };
    return { ok: true, n };
  }
  function detectNetwork(p) {
    const n = normalizePhone(p);
    if (!/^0\d{9}$/.test(n)) return null;
    const prefix = n.slice(1, 3);
    for (const [net, list] of Object.entries(NETWORK_PREFIXES)) if (list.includes(prefix)) return net;
    return null;
  }

  /* ---------- data ---------- */
  async function loadBundles() {
    const res = await fetch("/api/bundles");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load");
    state.bundles = data.bundles;
    state.networks = data.networks;
    state.floats = data.floats;
    state.lowFloat = data.low_float;
    renderTabs();
    renderGrid();
    renderHeroPrices();
    renderFloatNotice();
  }

  /* ---------- render ---------- */
  function renderTabs() {
    const host = $("#netTabs");
    host.innerHTML = state.networks
      .map((n) => `<button class="net-tab" data-net="${n.code}">${n.name}</button>`)
      .join("");
    $$(".net-tab", host).forEach((b) =>
      b.addEventListener("click", () => {
        state.currentNet = b.dataset.net;
        $$(".net-tab", host).forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        renderGrid();
      })
    );
    $(".net-tab[data-net='" + state.currentNet + "']", host)?.classList.add("on");
  }

  function validityLabel(v) {
    return v ? v + "-day rollover" : "No Expiry";
  }

  function renderGrid() {
    const grid = $("#bundleGrid");
    const list = state.bundles.filter((b) => b.network === state.currentNet);
    if (!list.length) {
      grid.innerHTML = '<p style="color:var(--muted)">No bundles for this network yet.</p>';
      return;
    }
    grid.innerHTML = list
      .map((b) => {
        const disabled = !b.available ? "disabled" : "";
        const tag = b.available ? "" : '<span class="soldout">RESTOCKING</span>';
        return `<button class="bundle ${disabled}" data-bundle="${b.id}" ${disabled ? "disabled" : ""}>
          ${tag}
          <div class="net ${b.network}">${NETWORK_NAMES[b.network]}</div>
          <div class="gb">${(b.size_mb / 1024)}${b.size_mb >= 1024 ? "GB" : "MB"}</div>
          <div class="price">${fmt(b.price)} <small>${validityLabel(b.validity_days)}</small></div>
          <div class="meta"><span>⚡ Auto delivery</span><span>MoMo / card</span></div>
        </button>`;
      })
      .join("");
    $$("[data-bundle]", grid).forEach((el) =>
      el.addEventListener("click", () => openBuy(el.dataset.bundle))
    );
  }

  function renderHeroPrices() {
    const rows = state.bundles
      .filter((b) => [1024, 10240, 20480].includes(b.size_mb))
      .map((b) => `<div class="row ${b.network}"><span class="net">${NETWORK_NAMES[b.network]} ${b.size_mb / 1024}GB</span><b>${fmt(b.price)}</b></div>`)
      .join("");
    $("#heroPrices").innerHTML = rows || "<p style='color:var(--muted);font-size:13px'>—</p>";
  }

  function renderFloatNotice() {
    const host = $("#floatNotice");
    const low = Object.entries(state.lowFloat).filter(([, v]) => v);
    if (!low.length) { host.innerHTML = ""; return; }
    host.innerHTML = `<div class="notice warn"><b>Heads up:</b> ${low.map(([n]) => NETWORK_NAMES[n]).join(", ")} is running low on stock — some bundles are paused while we restock. Other networks are unaffected.</div>`;
  }

  /* ---------- buy flow ---------- */
  function openBuy(bundleId) {
    const bundle = state.bundles.find((b) => b.id === Number(bundleId));
    if (!bundle || !bundle.available) return;
    state.selected = bundle;
    const m = $("#buyModal");
    m.innerHTML = `
      <div class="modal">
        <button class="m-close" data-close aria-label="Close">×</button>
        <h3>Buy ${bundle.size_mb / 1024}GB — ${NETWORK_NAMES[bundle.network]}</h3>
        <div class="m-sub">${validityLabel(bundle.validity_days)} · auto delivery</div>
        <div class="order-summary">
          <div class="row"><span>Bundle</span><b>${bundle.size_mb / 1024}GB ${NETWORK_NAMES[bundle.network]} Data</b></div>
          <div class="row total"><span>Total</span><b>${fmt(bundle.price)}</b></div>
        </div>
        <div class="field">
          <label for="bm-phone">Phone number to receive the data</label>
          <input class="inp" id="bm-phone" inputmode="tel" placeholder="e.g. 024 000 0000" autocomplete="tel">
          <div class="hint" id="bm-phone-hint"></div>
        </div>
        <button class="btn btn-orange btn-block" id="bm-next" disabled>Continue →</button>
      </div>`;
    m.classList.add("open");

    const phoneInput = $("#bm-phone", m);
    const hint = $("#bm-phone-hint", m);
    const next = $("#bm-next", m);

    function revalidate() {
      const v = validatePhone(phoneInput.value);
      phoneInput.classList.toggle("ok", v.ok);
      phoneInput.classList.toggle("bad", phoneInput.value.length > 0 && !v.ok);
      if (!v.ok && phoneInput.value.length > 0) {
        hint.textContent = "⚠️ " + v.msg;
        next.disabled = true;
        return;
      }
      const detected = detectNetwork(phoneInput.value);
      if (detected && detected !== bundle.network) {
        hint.innerHTML = `⚠️ This number looks like a <b>${NETWORK_NAMES[detected]}</b> number — a ${NETWORK_NAMES[bundle.network]} bundle may not deliver. Check before paying.`;
        next.disabled = false;
        return;
      }
      hint.textContent = phoneInput.value.length ? "✓ Looks good" : "";
      next.disabled = !v.ok;
    }
    phoneInput.addEventListener("input", revalidate);
    $("[data-close]", m).addEventListener("click", () => m.classList.remove("open"));

    next.addEventListener("click", () => {
      const v = validatePhone(phoneInput.value);
      if (!v.ok) return revalidate();
      showConfirm(v.n);
    });
  }

  function showConfirm(phone) {
    const b = state.selected;
    const m = $("#buyModal");
    m.innerHTML = `
      <div class="modal">
        <button class="m-close" data-close aria-label="Close">×</button>
        <h3>Confirm your order</h3>
        <div class="m-sub">Check the number twice — misdials are unrecoverable.</div>
        <div class="order-summary">
          <div class="row"><span>Bundle</span><b>${b.size_mb / 1024}GB ${NETWORK_NAMES[b.network]}</b></div>
          <div class="row"><span>Validity</span><b>${validityLabel(b.validity_days)}</b></div>
          <div class="row total"><span>Total</span><b>${fmt(b.price)}</b></div>
        </div>
        <div class="big-number">${phone}</div>
        <div class="notice" style="margin-top:12px"><b>Data goes to this number the moment payment confirms.</b> Wrong numbers are not refundable.</div>
        <button class="btn btn-orange btn-block" id="bm-pay" style="margin-top:14px">Confirm &amp; Pay →</button>
        <button class="btn btn-ghost btn-block" id="bm-back" style="margin-top:10px">← Edit number</button>
      </div>`;
    $("[data-close]", m).addEventListener("click", () => m.classList.remove("open"));
    $("#bm-back", m).addEventListener("click", () => openBuy(b.id));
    $("#bm-pay", m).addEventListener("click", async () => {
      const btn = $("#bm-pay", m);
      btn.disabled = true;
      btn.textContent = "Creating order…";
      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundle_id: b.id, phone }),
        });
        const data = await res.json();
        if (!res.ok) {
          m.innerHTML = `<div class="modal"><h3>Could not place order</h3><div class="m-sub">${data.error || "Try again"}</div><button class="btn btn-ghost btn-block" data-close>Close</button></div>`;
          $("[data-close]", m).addEventListener("click", () => m.classList.remove("open"));
          return;
        }
        if (data.checkout_url) {
          m.innerHTML = `<div class="modal"><h3>Order created ✅</h3><div class="m-sub">Reference <b>${data.reference}</b> — redirecting to secure checkout…</div></div>`;
          window.location.href = data.checkout_url;
        } else {
          // dev mode (no Valmont-Pay configured)
          m.innerHTML = `<div class="modal">
            <h3>Order created ✅</h3>
            <div class="m-sub">Reference <b>${data.reference}</b></div>
            <div class="demo-note">Dev mode: no Valmont-Pay configured. Simulate the payment webhook:
            <br><code style="color:var(--orange)">node scripts/sim-webhook.js --ref ${data.reference}</code></div>
            <a class="btn btn-orange btn-block" style="margin-top:14px" href="status.html?reference=${data.reference}">Track this order →</a>
          </div>`;
        }
      } catch {
        m.innerHTML = `<div class="modal"><h3>Network error</h3><div class="m-sub">Try again in a moment.</div><button class="btn btn-ghost btn-block" data-close>Close</button></div>`;
        $("[data-close]", m).addEventListener("click", () => m.classList.remove("open"));
      }
    });
  }

  function toast(html, isErr) {
    let w = $(".toast-wrap");
    if (!w) { w = document.createElement("div"); w.className = "toast-wrap"; document.body.appendChild(w); }
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.innerHTML = html;
    w.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  loadBundles().catch((e) => {
    $("#bundleGrid").innerHTML = `<div class="notice">Failed to load bundles: ${e.message}</div>`;
  });
})();
