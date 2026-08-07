/* ==========================================================================
   VALMONT DATA — APP ENGINE (Prototype)
   Simulated auth, wallet, MoMo checkout, orders & tracking, store builder.
   In the full-stack build, each of these calls becomes a real API route
   (see README.md blueprint).
   ========================================================================== */

(function () {
  "use strict";

  const D = window.VD_DATA;
  const LS = {
    user: "vd_user",
    orders: "vd_orders",
    stores: "vd_stores",
    txs: "vd_txs"
  };

  /* ---------------- helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => "GH₵" + Number(n).toFixed(2);
  const uid = () => "VD-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const now = () => new Date().toLocaleString("en-GH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

  /* ---------------- auth ---------------- */
  const Auth = {
    user: () => read(LS.user, null),
    save(u) { write(LS.user, u); renderAuth(); },
    clear() { localStorage.removeItem(LS.user); renderAuth(); },
    isIn: () => !!Auth.user(),
    signup({ name, email, phone, password }) {
      if (!name || !email || !phone || !password) return { ok: false, msg: "Please fill in every field." };
      const all = read("vd_users", []);
      if (all.some((u) => u.email === email)) return { ok: false, msg: "An account with this email already exists." };
      const u = { name, email, phone, password, wallet: 0, tier: "member", joined: new Date().toISOString(), reseller: false };
      all.push(u); write("vd_users", all);
      Auth.save(u);
      return { ok: true };
    },
    signin({ email, password }) {
      const all = read("vd_users", []);
      const u = all.find((x) => x.email === email);
      if (!u || u.password !== password) return { ok: false, msg: "Wrong email or password." };
      delete u.password; Auth.save(u);
      return { ok: true };
    },
    otp(phone) {
      const all = read("vd_users", []);
      const u = all.find((x) => x.phone === phone);
      if (!u) return { ok: false, msg: "No account found for that number. Sign up first." };
      delete u.password; Auth.save(u);
      return { ok: true };
    },
    google() {
      const all = read("vd_users", []);
      let u = all.find((x) => x.email === "demo@valmontdata.com");
      if (!u) { u = { name: "Ama Demo", email: "demo@valmontdata.com", phone: "0240000000", wallet: 25, tier: "reseller", joined: new Date().toISOString(), reseller: true }; all.push(u); write("vd_users", all); }
      Auth.save(u);
      return u;
    }
  };

  /* ---------------- wallet & transactions ---------------- */
  const Wallet = {
    balance() { const u = Auth.user(); return u ? Number(u.wallet) || 0 : 0; },
    credit(amount, note) {
      const u = Auth.user(); if (!u) return false;
      u.wallet = (Number(u.wallet) || 0) + Number(amount);
      Auth.save(u); Tx.add({ type: "credit", amount: Number(amount), note, date: now() });
      return true;
    },
    debit(amount, note) {
      const u = Auth.user(); if (!u) return false;
      if ((Number(u.wallet) || 0) < amount) return false;
      u.wallet = Number(u.wallet) - Number(amount);
      Auth.save(u); Tx.add({ type: "debit", amount: Number(amount), note, date: now() });
      return true;
    }
  };
  const Tx = {
    all: () => read(LS.txs, []),
    add(t) { const l = Tx.all(); l.unshift(t); write(LS.txs, l.slice(0, 60)); }
  };

  /* ---------------- orders ---------------- */
  const Orders = {
    all: () => read(LS.orders, []),
    find(id) { return Orders.all().find((o) => o.id === id.toUpperCase()); },
    add(o) { const l = Orders.all(); l.unshift(o); write(LS.orders, l); },
    mine() {
      const u = Auth.user();
      return Orders.all().filter((o) => u && (o.email === u.email || o.phone === u.phone));
    },
    place({ net, gb, price, phone, method }) {
      const o = {
        id: uid(), net, gb, price, phone, method,
        placedAt: now(), eta: D.delivery.demoMinutes,
        status: "processing", events: [
          { t: now(), s: "Order placed — payment received" },
          { t: null, s: "Queued on the fast lane · " + D.delivery.fastLane },
          { t: null, s: "Data delivered to " + phone + " on " + D.networks[net].name }
        ]
      };
      Orders.add(o);
      // Demo fast-forward: advance the order in real time
      setTimeout(() => { Orders.advance(o.id); }, 25 * 1000);
      setTimeout(() => { Orders.advance(o.id); }, 65 * 1000);
      return o;
    },
    advance(id) {
      const l = Orders.all(); const o = l.find((x) => x.id === id);
      if (!o || o.status !== "processing") return;
      const done = o.events.findIndex((e) => e.t === null);
      if (done === -1) return;
      o.events[done].t = now();
      if (done === o.events.length - 1) { o.status = "delivered"; o.deliveredAt = now(); }
      write(LS.orders, l);
      if (o.email === (Auth.user() || {}).email) renderDashboardOrders();
      const view = document.querySelector(`[data-track-view="${id}"]`);
      if (view) renderTrack(view, o);
    },
    statusPill(s) { return `<span class="pill ${s}">${s.toUpperCase()}</span>`; }
  };

  /* ---------------- pricing ---------------- */
  const Pricing = {
    list(net) { return Auth.isIn() ? D.bundles[net] : D.guest[net]; },
    price(net, gb) {
      const g = Number(gb);
      const l = Pricing.list(net);
      const b = l.find((x) => x.gb === g) || D.bundles[net].find((x) => x.gb === g);
      return b ? b.price : 0;
    }
  };

  /* ---------------- render: bundle grid ---------------- */
  function renderBundleGrid(rootSel, net, opts = {}) {
    const root = typeof rootSel === "string" ? $(rootSel) : rootSel;
    if (!root) return;
    const list = opts.guestOnly ? D.guest[net] : Pricing.list(net);
    root.innerHTML = list.map((b) => {
      const netCfg = D.networks[net];
      const out = opts.outOfStock ? "out" : "";
      const sold = opts.outOfStock ? '<span class="soldout">OUT OF STOCK</span>' : "";
      const member = !opts.guestOnly && Auth.isIn() ? '<span class="member-badge">MEMBER PRICE</span>' : "";
      return `<div class="bundle ${out}" data-buy="${net}|${b.gb}" role="button" tabindex="0" aria-label="Buy ${b.gb}GB on ${netCfg.name}">
        ${sold}${member}
        <div class="net ${net}">${netCfg.name}</div>
        <div class="gb">${b.gb} GB</div>
        <div class="price">${fmt(b.price)} <small>${netCfg.badge}</small></div>
        <div class="meta"><span>⚡ Auto delivery</span><span>MoMo accepted</span></div>
      </div>`;
    }).join("");
    $$(".bundle[data-buy]", root).forEach((el) => {
      el.addEventListener("click", () => openBuyModal(el.dataset.buy));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBuyModal(el.dataset.buy); } });
    });
  }

  /* ---------------- buy modal ---------------- */
  function openBuyModal(key, netOverride) {
    const [net, gb] = key.split("|");
    const price = Pricing.price(net, gb);
    const u = Auth.user();
    const m = $("#buyModal"); if (!m) return;
    m.dataset.net = net; m.dataset.gb = gb;
    m.innerHTML = `<div class="modal">
      <button class="m-close" data-close aria-label="Close">×</button>
      <h3>Buy ${gb}GB — ${D.networks[net].name}</h3>
      <div class="m-sub">${D.networks[net].badge} · auto delivery</div>
      <div class="order-summary">
        <div class="row"><span>Bundle</span><b>${gb}GB ${D.networks[net].name} Data</b></div>
        <div class="row"><span>Price</span><b>${fmt(price)}</b></div>
        ${u ? '<div class="row"><span>Wallet</span><b>' + fmt(Wallet.balance()) + '</b></div>' : ""}
        <div class="row total"><span>Total</span><b>${fmt(price)}</b></div>
      </div>
      <div class="field">
        <label for="bm-phone">Recipient phone number</label>
        <input class="inp" id="bm-phone" inputmode="tel" placeholder="e.g. 024 000 0000" value="${u ? esc(u.phone) : ""}">
        <div class="hint">⚠️ Verify carefully — no refunds for wrong numbers.</div>
      </div>
      <div class="field">
        <label>Pay with</label>
        <div class="pay-opts">
          <button class="pay-opt on" data-method="momo"><b>Mobile Money</b><small>MTN MoMo · Telecel Cash · AT Money</small></button>
          ${u ? `<button class="pay-opt" data-method="wallet"><b>Wallet</b><small>Balance ${fmt(Wallet.balance())}</small></button>` : ""}
        </div>
      </div>
      <button class="btn btn-green btn-block" data-place>Continue to Payment →</button>
      <div class="demo-note">Prototype: payment is simulated. In production this opens Paystack/Hubtel MoMo checkout.</div>
    </div>`;
    m.classList.add("open");
    const back = $(".modal-back"); if (back) back.classList.add("open");

    $$(".pay-opt", m).forEach((b) => b.addEventListener("click", () => {
      $$(".pay-opt", m).forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    }));

    $("[data-close]", m).addEventListener("click", closeModal);
    $("[data-place]", m).addEventListener("click", () => {
      const phone = $("#bm-phone").value.trim().replace(/\s+/g, "");
      if (!/^0\d{9}$/.test(phone) && !/^\+233\d{9}$/.test(phone)) return toast("Enter a valid Ghana number, e.g. 024 000 0000", true);
      const method = $(".pay-opt.on", m).dataset.method;
      if (method === "wallet") {
        if (Wallet.balance() < price) return toast("Insufficient wallet balance — deposit first", true);
        Wallet.debit(price, `${gb}GB ${D.networks[net].name} data for ${phone}`);
        placeOrder({ net, gb, price, phone, method: "wallet" });
      } else {
        showMoMoPrompt(m, { net, gb, price, phone }, () => placeOrder({ net, gb, price, phone, method: "momo" }));
      }
    });
  }

  function showMoMoPrompt(m, { net, gb, price, phone }, onDone) {
    m.innerHTML = `<div class="modal">
      <button class="m-close" data-close aria-label="Close">×</button>
      <div class="momo-prompt">
        <div class="spin"></div>
        <h4>Approve payment on your phone</h4>
        <p>We sent a Mobile Money prompt to <b style="color:#fff">${esc(phone)}</b></p>
        <div class="money">${fmt(price)}</div>
        <span class="network-chip">${D.networks[net].name} MoMo · Dial *170# or approve in the MoMo app</span>
        <p style="margin-top:14px">Waiting for approval…</p>
        <div class="demo-note">Prototype: approval is auto-simulated after ~3 seconds.</div>
      </div>
    </div>`;
    $("[data-close]", m).addEventListener("click", closeModal);
    setTimeout(() => {
      if (!$("#buyModal").classList.contains("open")) return;
      onDone();
    }, 3000);
  }

  function placeOrder({ net, gb, price, phone, method }) {
    const u = Auth.user();
    const o = Orders.place({ net, gb, price, phone, method, email: u ? u.email : "guest" });
    const m = $("#buyModal");
    m.innerHTML = `<div class="modal">
      <button class="m-close" data-close aria-label="Close">×</button>
      <div style="text-align:center;padding:6px 0 4px">
        <div style="font-size:44px;margin-bottom:10px">✅</div>
        <h3>Order placed!</h3>
        <div class="m-sub">Payment received via ${method === "wallet" ? "Wallet" : "Mobile Money"}</div>
        <div class="track-card" style="text-align:left">
          <div class="oid">${o.id}<small>${o.gb}GB ${D.networks[net].name} → ${esc(phone)} · ${fmt(price)}</small></div>
          <div data-track-view="${o.id}">${trackTimeline(o)}</div>
        </div>
        <a class="btn btn-ghost btn-block" style="margin-top:14px" href="track.html?id=${o.id}">Track this order →</a>
        <a class="btn btn-green btn-block" style="margin-top:10px" href="buy.html">Continue Shopping</a>
      </div>
    </div>`;
    $("[data-close]", m).addEventListener("click", closeModal);
    toast(`Order <b>${o.id}</b> placed — tracking started.`);
  }

  function trackTimeline(o) {
    const labels = ["Order placed — payment received", "Fast lane queue · " + D.delivery.fastLane, `Data delivered to ${esc(o.phone)} on ${D.networks[o.net].name}`];
    return `<div class="timeline">` + o.events.map((e, i) => {
      const cls = e.t ? "done" : (o.status === "processing" ? "active" : "");
      return `<div class="tl-item ${cls}"><b>${labels[i]}</b><span>${e.t || "In progress…"}</span></div>`;
    }).join("") + `</div>`;
  }

  function renderTrack(root, o) {
    root.innerHTML = trackTimeline(o);
  }

  function closeModal() {
    const m = $("#buyModal");
    m.classList.remove("open");
    const back = $(".modal-back"); if (back) back.classList.remove("open");
  }

  /* ---------------- toast ---------------- */
  function toast(html, isErr) {
    let w = $(".toast-wrap");
    if (!w) { w = document.createElement("div"); w.className = "toast-wrap"; document.body.appendChild(w); }
    const t = document.createElement("div");
    t.className = "toast";
    if (isErr) t.style.borderLeftColor = "var(--at-red)";
    t.innerHTML = html;
    w.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  /* ---------------- deposit flow ---------------- */
  function bindDeposit() {
    const form = $("#depositForm"); if (!form) return;
    const req = $("#depRequiresLogin");
    const paint = () => { const in_ = Auth.isIn(); if (form) form.style.display = in_ ? "block" : "none"; if (req) req.style.display = in_ ? "none" : "block"; };
    paint();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const amount = parseFloat($("#depAmount").value);
      const phone = $("#depPhone").value.trim().replace(/\s+/g, "");
      if (!amount || amount < 1) return toast("Enter a valid amount (min GH₵1)", true);
      if (!/^0\d{9}$/.test(phone) && !/^\+233\d{9}$/.test(phone)) return toast("Enter a valid MoMo number", true);
      const net = $("#depNet").value;
      const box = $("#depositModal"); box.classList.add("open");
      box.innerHTML = `<div class="modal">
        <button class="m-close" data-close aria-label="Close">×</button>
        <div class="momo-prompt">
          <div class="spin"></div>
          <h4>Approve deposit on your phone</h4>
          <p>Prompt sent to <b style="color:#fff">${esc(phone)}</b></p>
          <div class="money">${fmt(amount)}</div>
          <span class="network-chip">${net.replace(/-/g, " ")} · approve to credit your Valmont Data wallet</span>
          <p style="margin-top:14px">Waiting for approval…</p>
          <div class="demo-note">Prototype: deposit is auto-credited after ~3 seconds.</div>
        </div>
      </div>`;
      $("[data-close]", box).addEventListener("click", () => box.classList.remove("open"));
      setTimeout(() => {
        box.classList.remove("open");
        Wallet.credit(amount, "Wallet deposit via " + net);
        $("#depAmount").value = ""; $("#depPhone").value = "";
        toast(`<b>${fmt(amount)}</b> added to your wallet.`);
        if (window.VD_UPDATE_WALLET) window.VD_UPDATE_WALLET();
      }, 3000);
    });
  }

  /* ---------------- store builder ---------------- */
  function bindStoreBuilder() {
    const form = $("#storeForm"); if (!form) return;
    const nameInp = $("#stName"), tagInp = $("#stTag"), range = $("#stMarkup"), out = $("#stMarkupOut");
    const pvName = $("#pvName"), pvTag = $("#pvTag"), pvPrices = $("#pvPrices");
    const update = () => {
      if (pvName) pvName.textContent = nameInp.value.trim() || "Your Store Name";
      if (pvTag) pvTag.textContent = tagInp.value.trim() || "Cheap data bundles, delivered fast";
      if (out) out.textContent = (range.value / 100).toFixed(0) + "%";
      if (pvPrices) {
        const net = "mtn";
        pvPrices.innerHTML = D.bundles[net].slice(0, 5).map((b) => {
          const p = b.price * (1 + Number(range.value) / 100);
          return `<div class="sp-bundle"><span>${b.gb}GB MTN · no expiry</span><b style="color:var(--green)">${fmt(p)}</b></div>`;
        }).join("");
      }
    };
    nameInp.addEventListener("input", update);
    tagInp.addEventListener("input", update);
    range.addEventListener("input", update);
    update();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!Auth.isIn()) { toast("Create a free account first to open a store", true); setTimeout(() => location.href = "signup.html?next=store.html", 900); return; }
      const slug = (nameInp.value.trim() || "mystore").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mystore";
      const stores = read(LS.stores, []);
      stores.unshift({ name: nameInp.value.trim(), tag: tagInp.value.trim(), markup: Number(range.value), slug, owner: Auth.user().email, created: now() });
      write(LS.stores, stores);
      toast(`Store <b>${esc(nameInp.value.trim())}</b> opened! Share link: <b>valmontdata.com/store/${esc(slug)}</b>`);
    });
  }

  /* ---------------- track page ---------------- */
  function bindTrackPage() {
    const form = $("#trackForm"); if (!form) return;
    const view = $("#trackResult");
    const show = (id) => {
      const o = Orders.find(id);
      if (!o) { view.innerHTML = `<div class="notice">No order found for <b>${esc(id)}</b>. Check the ID in your confirmation SMS/email.</div>`; return; }
      view.innerHTML = `<div class="track-card">
        <div class="oid">${o.id} ${Orders.statusPill(o.status)}<small>${o.gb}GB ${D.networks[o.net].name} → ${esc(o.phone)} · ${fmt(o.price)} · paid via ${o.method === "wallet" ? "Wallet" : "MoMo"}</small></div>
        <div data-track-view="${o.id}">${trackTimeline(o)}</div>
        <div class="demo-note">Prototype fast-forward: processing orders deliver after ~90 seconds so you can watch the timeline complete. In production this is a real provider-queue webhook.</div>
      </div>`;
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); show($("#trackId").value); });
    const q = new URLSearchParams(location.search).get("id");
    if (q) { $("#trackId").value = q; show(q); }
  }

  /* ---------------- auth pages ---------------- */
  function bindAuthPages() {
    const su = $("#signupForm");
    if (su) su.addEventListener("submit", (e) => {
      e.preventDefault();
      const r = Auth.signup({ name: $("#suName").value, email: $("#suEmail").value, phone: $("#suPhone").value, password: $("#suPass").value });
      if (!r.ok) return toast(r.msg, true);
      toast(`Welcome to Valmont Data, <b>${esc(Auth.user().name)}</b>! 🎉`);
      redirectAfterAuth();
    });
    const si = $("#signinForm");
    if (si) si.addEventListener("submit", (e) => {
      e.preventDefault();
      const r = Auth.signin({ email: $("#siEmail").value, password: $("#siPass").value });
      if (!r.ok) return toast(r.msg, true);
      toast(`Welcome back, <b>${esc(Auth.user().name)}</b>!`);
      redirectAfterAuth();
    });
    const otp = $("#otpForm");
    if (otp) otp.addEventListener("submit", (e) => {
      e.preventDefault();
      const r = Auth.otp($("#otpPhone").value.trim());
      if (!r.ok) return toast(r.msg, true);
      toast(`Signed in as <b>${esc(Auth.user().name)}</b> — OTP simulated.`);
      redirectAfterAuth();
    });
    $$("[data-google]").forEach((b) => b.addEventListener("click", () => {
      const u = Auth.google();
      toast(`Signed in with Google (demo) — <b>${esc(u.name)}</b>`);
      redirectAfterAuth();
    }));
  }
  function redirectAfterAuth() {
    const q = new URLSearchParams(location.search).get("next");
    setTimeout(() => { location.href = q || "dashboard.html"; }, 600);
  }

  /* ---------------- airtime page (login wall) ---------------- */
  function bindAirtime() {
    const wall = $("#airtimeWall"), shop = $("#airtimeShop");
    if (!wall || !shop) return;
    const paint = () => {
      if (Auth.isIn()) { wall.style.display = "none"; shop.style.display = "block"; }
      else { wall.style.display = "block"; shop.style.display = "none"; }
    };
    paint();
    window.VD_UPDATE_AIRTIME = paint;
    const grid = $("#airtimeGrid");
    grid.innerHTML = D.airtime.map((a) => `<div class="bundle" data-air="${a.val}" role="button" tabindex="0">
      <div class="net mtn">Airtime</div>
      <div class="gb">GH₵ ${a.val}</div>
      <div class="price">${fmt(a.price)} <small>member price</small></div>
      <div class="meta"><span>All networks</span><span>Instant</span></div>
    </div>`).join("");
    $$("[data-air]", grid).forEach((el) => el.addEventListener("click", () => {
      const val = el.dataset.air;
      const item = D.airtime.find((a) => a.val === Number(val));
      const m = $("#buyModal"); m.classList.add("open");
      m.innerHTML = `<div class="modal">
        <button class="m-close" data-close aria-label="Close">×</button>
        <h3>Buy GH₵${val} Airtime</h3>
        <div class="m-sub">Top-up for any Ghanaian network</div>
        <div class="order-summary">
          <div class="row"><span>Credit</span><b>GH₵ ${val}</b></div>
          <div class="row total"><span>Total</span><b>${fmt(item.price)}</b></div>
        </div>
        <div class="field"><label>Recipient phone number</label><input class="inp" id="bm-phone" placeholder="e.g. 024 000 0000" value="${esc(Auth.user().phone)}"></div>
        <button class="btn btn-green btn-block" data-air-go>Pay with Wallet →</button>
        <div class="demo-note">Prototype: airtime is simulated — no real credit is sent.</div>
      </div>`;
      $("[data-close]", m).addEventListener("click", closeModal);
      $("[data-air-go]", m).addEventListener("click", () => {
        const phone = $("#bm-phone").value.trim();
        if (Wallet.balance() < item.price) return toast("Insufficient wallet balance — deposit first", true);
        Wallet.debit(item.price, `GH₵${val} airtime for ${phone}`);
        m.classList.remove("open"); $(".modal-back").classList.remove("open");
        toast(`<b>GH₵${val}</b> airtime delivered to ${esc(phone)} (simulated).`);
      });
    }));
  }

  /* ---------------- dashboard ---------------- */
  function renderDashboardOrders() {
    const tbl = $("#ordersTableBody"); if (!tbl) return;
    const mine = Orders.mine();
    if (!mine.length) { tbl.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:26px">No orders yet — <a href="buy.html">buy your first bundle</a>.</td></tr>`; return; }
    tbl.innerHTML = mine.map((o) => `<tr>
      <td><b style="color:#fff">${o.id}</b></td>
      <td>${o.gb}GB ${D.networks[o.net].name}</td>
      <td>${esc(o.phone)}</td>
      <td>${fmt(o.price)}</td>
      <td>${Orders.statusPill(o.status)}</td>
    </tr>`).join("");
  }
  function bindDashboard() {
    const wrap = $("#dashGreeting"); if (!wrap) return;
    const u = Auth.user();
    if (!u) { location.href = "signin.html?next=dashboard.html"; return; }
    wrap.innerHTML = `Hello, <b style="color:#fff">${esc(u.name.split(" ")[0])}</b> 👋`;
    $("#dashWallet").textContent = fmt(Wallet.balance());
    $("#dashTier").textContent = u.tier === "reseller" ? "Reseller" : "Member";
    $("#dashTierNote").textContent = u.tier === "reseller"
      ? "Wholesale pricing active on all bundles."
      : "Sign up as a reseller to unlock wholesale pricing + your own store.";
    renderDashboardOrders();
    const txs = $("#txTableBody");
    if (txs) {
      const l = Tx.all().filter((t) => true);
      if (!l.length) txs.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:22px">No transactions yet.</td></tr>`;
      else txs.innerHTML = l.map((t) => `<tr>
        <td>${esc(t.note)}</td>
        <td>${t.date}</td>
        <td style="color:${t.type === "credit" ? "var(--green-2)" : "var(--at-red)"}">${t.type === "credit" ? "+" : "−"}${fmt(t.amount)}</td>
      </tr>`).join("");
    }
  }

  /* ---------------- layout (nav + footer) ---------------- */
  const NAV_LINKS = [
    { href: "buy.html", label: "Buy Data" },
    { href: "topup.html", label: "Top Up" },
    { href: "deposit.html", label: "Deposit" },
    { href: "store.html", label: "Open a Store" },
    { href: "api-doc.html", label: "API" },
    { href: "blog.html", label: "Blog" }
  ];
  function renderAuth() {
    const box = $("#navAuth"); if (!box) return;
    const u = Auth.user();
    if (u) {
      box.innerHTML = `<div class="nav-user">
        <div class="avatar">${esc(u.name.trim().charAt(0).toUpperCase())}</div>
        <div class="who"><b>${esc(u.name.split(" ")[0])}</b><small>Wallet ${fmt(Wallet.balance())}</small></div>
        <button class="btn btn-ghost btn-sm" data-out>Sign out</button>
      </div>`;
      const out = $("[data-out]", box);
      if (out) out.addEventListener("click", () => { Auth.clear(); toast("Signed out. See you soon!"); location.reload(); });
    } else {
      box.innerHTML = `<a class="btn btn-ghost btn-sm" href="signin.html">Sign In</a>
        <a class="btn btn-green btn-sm nav-cta" href="signup.html">Sign Up Free</a>`;
    }
    const bal = $("#navWallet"); if (bal) { bal.textContent = u ? fmt(Wallet.balance()) : "—"; }
  }
  function injectLayout() {
    const page = document.body.dataset.page || "";
    const navHost = $("[data-nav]");
    if (navHost) {
      navHost.innerHTML = `
        <header class="nav">
          <div class="wrap nav-inner">
            <a class="brand" href="index.html">
              <span class="logo">◈</span>
              <span>VALMONT<b style="color:var(--green)">DATA</b><small>by Valmont Group · Accra</small></span>
            </a>
            <nav class="nav-links" id="navLinks">
              ${NAV_LINKS.map((l) => `<a href="${l.href}" class="${page === l.href ? "active" : ""}">${l.label}</a>`).join("")}
            </nav>
            <div id="navAuth"></div>
            <button class="nav-burger" id="navBurger" aria-label="Menu">☰</button>
          </div>
        </header>`;
      $("#navBurger").addEventListener("click", () => $("#navLinks").classList.toggle("open"));
    }
    const footHost = $("[data-footer]");
    if (footHost) {
      footHost.innerHTML = `
        <footer class="footer">
          <div class="wrap">
            <div class="footer-grid">
              <div>
                <a class="brand" href="index.html"><span class="logo">◈</span><span>VALMONT<b style="color:var(--green)">DATA</b></span></a>
                <p class="about-txt">Ghana's cheapest data bundles on MTN, Telecel & AirtelTigo — with wallet payments, reseller stores and a developer API. A subsidiary of Valmont Group of Companies, Accra.</p>
                <a class="btn btn-ghost btn-sm" href="https://wa.me/233542451578" target="_blank" rel="noopener">💬 WhatsApp Support</a>
              </div>
              <div>
                <h4>Platform</h4>
                <ul>
                  <li><a href="buy.html">Buy Data</a></li>
                  <li><a href="topup.html">Airtime Top-Up</a></li>
                  <li><a href="deposit.html">Deposit / Wallet</a></li>
                  <li><a href="mtn.html">MTN Bundles</a></li>
                  <li><a href="telecel.html">Telecel Bundles</a></li>
                  <li><a href="airteltigo.html">AirtelTigo Bundles</a></li>
                </ul>
              </div>
              <div>
                <h4>Resellers</h4>
                <ul>
                  <li><a href="store.html">Open a Store</a></li>
                  <li><a href="api-doc.html">Developer API</a></li>
                  <li><a href="tutorials.html">Tutorials</a></li>
                  <li><a href="faq.html">FAQ</a></li>
                  <li><a href="dashboard.html">My Dashboard</a></li>
                </ul>
              </div>
              <div>
                <h4>Company</h4>
                <ul>
                  <li><a href="about.html">About Us</a></li>
                  <li><a href="blog.html">Blog</a></li>
                  <li><a href="contact.html">Contact</a></li>
                  <li><a href="terms.html">Terms</a></li>
                  <li><a href="privacy.html">Privacy</a></li>
                  <li><a href="../index.html" target="_blank">Valmont Group →</a></li>
                </ul>
              </div>
            </div>
            <div class="bottom">
              <span>© 2026 Valmont Data (Valmont Group of Companies). All rights reserved.</span>
              <span>Prototype — payments & delivery are simulated. Made in Ghana 🇬🇭</span>
            </div>
          </div>
        </footer>`;
    }
    renderAuth();
  }

  /* ---------------- network tabs (buy + index) ---------------- */
  function bindNetTabs() {
    $$("[data-nettabs]").forEach((host) => {
      const tabs = $$(".net-tab", host);
      tabs.forEach((t) => t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("on"));
        t.classList.add("on");
        const net = t.dataset.net;
        if (host.dataset.mode === "mini") {
          const grid = $(".mini-bundles", host);
          grid.innerHTML = Pricing.list(net).slice(0, 6).map((b) => `
            <button class="mini-bundle" data-jump="${net}|${b.gb}">
              <span class="gb">${b.gb}GB</span>
              <span class="pr">${fmt(b.price)}</span>
              <span class="noexp">${D.networks[net].badge}</span>
            </button>`).join("");
          $$(".mini-bundle", host).forEach((b) => b.addEventListener("click", () => { location.href = "buy.html?net=" + net; }));
        } else {
          renderBundleGrid("[data-bundlegrid]", net, { guestOnly: host.dataset.guest === "1" });
        }
      }));
      tabs[0].click();
    });
  }

  /* ---------------- FAQ ---------------- */
  function bindFaq() {
    $$(".faq-q").forEach((q) => q.addEventListener("click", () => {
      const item = q.parentElement;
      const a = $(".faq-a", item);
      const open = item.classList.contains("open");
      $$(".faq-item").forEach((i) => { i.classList.remove("open"); $(".faq-a", i).style.maxHeight = null; });
      if (!open) { item.classList.add("open"); a.style.maxHeight = a.scrollHeight + "px"; }
    }));
  }

  /* ---------------- init ---------------- */
  function init() {
    injectLayout();
    bindNetTabs();
    bindAuthPages();
    bindDeposit();
    bindStoreBuilder();
    bindTrackPage();
    bindAirtime();
    bindDashboard();
    bindFaq();

    // deep link ?net=mtn|telecel|airteltigo (e.g. from the landing price panel)
    const q = new URLSearchParams(location.search).get("net");
    if (q && [ "mtn", "telecel", "airteltigo" ].includes(q)) {
      const t = $(".net-tab[data-net='" + q + "']");
      if (t) t.click();
    }

    // static bundle grids (network pages) — net comes from data-net
    $$("[data-bundlegrid][data-net]").forEach((g) => renderBundleGrid(g, g.dataset.net, { guestOnly: g.dataset.guest === "1" }));

    // stats strip
    const strip = $("#statsStrip");
    if (strip) {
      strip.innerHTML = Object.entries(D.stats).map(([k, v]) =>
        `<div class="stat"><b>${v}</b><span>${k === "orders" ? "orders delivered" : k === "resellers" ? "resellers & members" : k === "uptime" ? "uptime" : "networks supported"}</span></div>`).join("");
    }

    // live stats ticker (demo)
    const lastOrder = $("#lastOrderTime");
    if (lastOrder) {
      const t = new Date(Date.now() - 7 * 60 * 1000);
      lastOrder.textContent = "placed " + t.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }) + " → delivered " + new Date(Date.now() - 9 * 60 * 1000).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true });
    }

    window.VD = { Auth, Wallet, Orders, openBuyModal, toast, fmt };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
