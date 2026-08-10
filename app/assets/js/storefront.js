/* ============================================================================
   Valmont Data storefront — bundle grid, customer accounts (email & password,
   time-based greeting with first name, saved numbers, recent numbers, order history),
   Ghana phone validation, confirm-before-pay flow, Valmont-Pay checkout handoff.
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

  let state = {
    bundles: [],
    networks: [],
    floats: {},
    lowFloat: {},
    currentNet: "mtn",
    selected: null,
    customerToken: localStorage.getItem("vd_customer_token") || null,
    customerInfo: JSON.parse(localStorage.getItem("vd_customer_info") || "null"),
    accountData: null,
    pendingBundle: null,
  };

  /* ---------- time-of-day greeting attached to first name ---------- */
  function getGreeting(name, email) {
    const hour = new Date().getHours();
    let prefix = "Good morning";
    let icon = "☀️";
    if (hour >= 12 && hour < 17) {
      prefix = "Good afternoon";
      icon = "🌤️";
    } else if (hour >= 17 || hour < 5) {
      prefix = "Good evening";
      icon = "🌙";
    }

    let firstName = "Kofi";
    if (name && name.trim()) {
      firstName = name.trim().split(/\s+/)[0];
    } else if (email && email.includes("@")) {
      const part = email.split("@")[0].replace(/[._-]/g, " ");
      firstName = part.charAt(0).toUpperCase() + part.slice(1).split(/\s+/)[0];
    } else if (state.customerInfo?.first_name) {
      firstName = state.customerInfo.first_name;
    }
    return { text: `${prefix}, ${firstName}`, prefix, firstName, icon };
  }

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
    renderNavAuth();
    if (state.customerToken) {
      loadAccount().catch(() => {});
    }
  }

  async function loadAccount() {
    if (!state.customerToken) return;
    try {
      const res = await fetch("/api/account", {
        headers: { Authorization: `Bearer ${state.customerToken}` },
      });
      if (res.status === 401) {
        logout();
        return;
      }
      const data = await res.json();
      state.accountData = data;
      if (data.customer) {
        state.customerInfo = data.customer;
        localStorage.setItem("vd_customer_info", JSON.stringify(data.customer));
      }
      renderNavAuth();
    } catch {
      // offline or network error
    }
  }

  /* ---------- render ---------- */
  function renderNavAuth() {
    const host = $("#navAuthArea");
    if (!host) return;
    if (state.customerToken && state.customerInfo) {
      const g = getGreeting(state.customerInfo.name, state.customerInfo.email);
      host.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="greeting-chip" id="btnOpenAccount" title="Open account">${g.icon} ${g.text}</button>
          <button id="btnHamburger" class="btn-hamburger" title="Menu">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>
          </button>
        </div>
      `;
      $("#btnOpenAccount")?.addEventListener("click", openAccountModal);
      $("#btnHamburger")?.addEventListener("click", openHamburgerMenu);
    } else {
      host.innerHTML = `
        <a class="btn btn-ghost btn-sm" href="signin.html">Sign in</a>
        <a class="btn btn-orange btn-sm" href="signup.html" style="margin-left:4px">Sign Up</a>
      `;
    }
  }

  function openHamburgerMenu() {
    let m = $("#hamburgerModal");
    if (!m) {
      m = document.createElement("div");
      m.id = "hamburgerModal";
      m.className = "modal-back";
      document.body.appendChild(m);
    }
    m.innerHTML = `
      <div class="side-drawer" onclick="event.stopPropagation()">
        <button class="m-close" data-close aria-label="Close" style="top:16px; right:16px;">×</button>
        <div class="drawer-head">Menu</div>
        <div class="drawer-menu">
          <button class="menu-item" id="hmTransactions">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Transaction History
          </button>
          <div style="flex:1"></div>
          <button class="menu-item" id="hmSignOut" style="color: var(--red);">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Sign Out
          </button>
        </div>
      </div>
    `;
    m.classList.add("open");

    m.addEventListener("click", () => m.classList.remove("open"));
    $("[data-close]", m).addEventListener("click", () => m.classList.remove("open"));
    
    $("#hmTransactions", m).addEventListener("click", () => {
      m.classList.remove("open");
      openAccountModal(); 
    });
    
    $("#hmSignOut", m).addEventListener("click", () => {
      m.classList.remove("open");
      logout();
    });
  }

  function renderTabs() {
    const host = $("#netTabs");
    if (!host) return;
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
    if (!grid) return;
    // Datamart-style guarantee banner above grid
    const buySection = grid.closest("section") || grid.parentElement;
    if (buySection && !buySection.querySelector(".delivery-guarantee-banner")) {
      const banner = document.createElement("div");
      banner.className = "delivery-guarantee-banner";
      banner.innerHTML = "\u26A1 <b>Guaranteed 30-Second Instant Delivery</b> — Auto-credited to your line";
      const tabs = buySection.querySelector("#netTabs");
      if (tabs && tabs.parentElement) tabs.parentElement.insertBefore(banner, tabs.nextSibling);
      else buySection.insertBefore(banner, grid);
    }

    const list = state.bundles.filter((b) => b.network === state.currentNet);
    if (!list.length) {
      grid.innerHTML = '<p style="color:var(--muted);padding:20px">No bundles for this network yet.</p>';
      return;
    }
    grid.innerHTML = list
      .map((b) => {
        const disabled = !b.available ? "disabled" : "";
        const tag = b.available ? "" : '<span class="soldout soft">Back soon</span>';
        const sizeLabel = `${(b.size_mb / 1024)}${b.size_mb >= 1024 ? " GB" : " MB"}`;
        const durationLabel = b.validity_days ? `${b.validity_days} Days` : "No Expiry";
        return `<button class="bundle ${b.network} ${disabled}" data-bundle="${b.id}" ${disabled ? "disabled" : ""}>
          ${tag}
          <div class="bundle-top">
            <div class="bundle-size">${sizeLabel}</div>
            <span class="bundle-network-badge">${NETWORK_NAMES[b.network]}</span>
          </div>
          <div class="bundle-delivery-badge">\u26A1 Delivers in 30 seconds</div>
          <div class="bundle-details-grid">
            <div class="detail"><span class="label">PRICE</span><b class="value price-val">${fmt(b.price)}</b></div>
            <div class="detail"><span class="label">ROLLOVER</span><b class="value">Yes</b></div>
            <div class="detail"><span class="label">DURATION</span><b class="value">${durationLabel}</b></div>
          </div>
          ${b.available ? "" : '<div class="restock-note">Restocking — check back shortly</div>'}
        </button>`;
      })
      .join("");
    $$("[data-bundle]", grid).forEach((el) =>
      el.addEventListener("click", () => openBuy(el.dataset.bundle))
    );
  }

  function renderHeroPrices() {
    const host = $("#heroPrices");
    if (!host) return;
    const rows = state.bundles
      .filter((b) => [1024, 10240, 20480].includes(b.size_mb))
      .map((b) => `<div class="row ${b.network}"><span class="net">${NETWORK_NAMES[b.network]} ${b.size_mb / 1024}GB</span><b>${fmt(b.price)}</b></div>`)
      .join("");
    host.innerHTML = rows || "<p style='color:var(--muted);font-size:13px'>—</p>";
  }

  function renderFloatNotice() {
    const host = $("#floatNotice");
    if (!host) return;
    const low = Object.entries(state.lowFloat).filter(([, v]) => v);
    if (!low.length) { host.innerHTML = ""; return; }
    host.innerHTML = `<div class="notice warn"><b>Heads up:</b> ${low.map(([n]) => NETWORK_NAMES[n]).join(", ")} is running low on stock — some bundles are paused while we restock. Other networks are unaffected.</div>`;
  }

  /* ---------- auth modal (Email & Password, with time-based greeting) ---------- */
  function openAuthModal(onSuccess) {
    const m = $("#authModal");
    let activeTab = "signin";

    function renderAuth() {
      m.innerHTML = `
        <div class="modal">
          <button class="m-close" data-close aria-label="Close">×</button>
          <div class="auth-tabs">
            <button class="auth-tab ${activeTab === "signin" ? "active" : ""}" id="tabSignIn">Sign In</button>
            <button class="auth-tab ${activeTab === "signup" ? "active" : ""}" id="tabSignUp">Create Account</button>
          </div>
          <h3>${activeTab === "signin" ? "Sign in to Valmont Data" : "Create your free account"}</h3>
          <div class="m-sub">${activeTab === "signin" ? "Enter your email & password to continue" : "Save your data numbers and repeat orders in one tap"}</div>

          <form id="authForm">
            ${activeTab === "signup" ? `
              <div class="field">
                <label for="af-name">First Name or Full Name</label>
                <input class="inp" id="af-name" placeholder="e.g. Kofi Mensah" autocomplete="name" required>
              </div>
            ` : ""}
            <div class="field">
              <label for="af-email">Email address</label>
              <input class="inp" type="email" id="af-email" placeholder="e.g. kofi@example.com" autocomplete="email" required>
            </div>
            ${activeTab === "signup" ? `
              <div class="field">
                <label for="af-phone">Ghana Phone Number (optional)</label>
                <input class="inp" id="af-phone" inputmode="tel" placeholder="e.g. 024 111 2222" autocomplete="tel">
              </div>
            ` : ""}
            <div class="field">
              <label for="af-password">Password</label>
              <input class="inp" type="password" id="af-password" placeholder="At least 4 characters" autocomplete="${activeTab === "signup" ? "new-password" : "current-password"}" required minlength="4">
            </div>
            <div id="authErr"></div>
            <button class="btn btn-orange btn-block" type="submit" id="af-submit" style="margin-top:12px">
              ${activeTab === "signin" ? "Sign In →" : "Create Account & Continue →"}
            </button>
          </form>
        </div>`;
      m.classList.add("open");

      $("[data-close]", m)?.addEventListener("click", () => m.classList.remove("open"));
      $("#tabSignIn", m)?.addEventListener("click", () => { activeTab = "signin"; renderAuth(); });
      $("#tabSignUp", m)?.addEventListener("click", () => { activeTab = "signup"; renderAuth(); });

      const form = $("#authForm", m);
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errDiv = $("#authErr", m);
        const submitBtn = $("#af-submit", m);
        errDiv.innerHTML = "";
        submitBtn.disabled = true;
        submitBtn.textContent = "Please wait…";

        const email = $("#af-email", m)?.value.trim();
        const password = $("#af-password", m)?.value;
        const name = $("#af-name", m)?.value.trim() || null;
        const phone = $("#af-phone", m)?.value.trim() || null;

        const payload = activeTab === "signup"
          ? { action: "signup", email, password, name, phone }
          : { action: "login", email, password, identifier: email };

        try {
          const res = await fetch("/api/auth/customer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) {
            errDiv.innerHTML = `<div class="notice" style="margin:10px 0">${data.error || "Authentication failed"}</div>`;
            submitBtn.disabled = false;
            submitBtn.textContent = activeTab === "signin" ? "Sign In →" : "Create Account →";
            return;
          }
          state.customerToken = data.token;
          state.customerInfo = data.customer;
          localStorage.setItem("vd_customer_token", data.token);
          localStorage.setItem("vd_customer_info", JSON.stringify(data.customer));
          m.classList.remove("open");
          renderNavAuth();
          await loadAccount();
          const g = getGreeting(data.customer.name, data.customer.email);
          toast(`Welcome! ${g.text} 👋`);
          if (typeof onSuccess === "function") {
            onSuccess();
          } else if (state.pendingBundle) {
            openBuy(state.pendingBundle.id);
          }
        } catch {
          errDiv.innerHTML = '<div class="notice" style="margin:10px 0">Network error. Try again.</div>';
          submitBtn.disabled = false;
          submitBtn.textContent = activeTab === "signin" ? "Sign In →" : "Create Account →";
        }
      });
    }

    renderAuth();
  }

  function logout() {
    state.customerToken = null;
    state.customerInfo = null;
    state.accountData = null;
    localStorage.removeItem("vd_customer_token");
    localStorage.removeItem("vd_customer_info");
    renderNavAuth();
    $("#accountModal")?.classList.remove("open");
    toast("Signed out successfully");
  }

  /* ---------- account modal / panel ---------- */
  async function openAccountModal() {
    if (!state.customerToken) {
      openAuthModal();
      return;
    }
    const m = $("#accountModal");
    m.innerHTML = `<div class="modal"><button class="m-close" data-close aria-label="Close">×</button><h3>My Account</h3><div class="m-sub">Loading profile…</div></div>`;
    m.classList.add("open");
    $("[data-close]", m)?.addEventListener("click", () => m.classList.remove("open"));

    await loadAccount();
    const acc = state.accountData || {};
    const c = acc.customer || state.customerInfo || {};
    const greeting = acc.time_greeting || getGreeting(c.name, c.email).text;

    const dataLines = acc.data_lines || acc.saved_numbers?.filter((s) => s.kind === "data") || [];
    const momoNumbers = acc.momo_numbers || acc.saved_numbers?.filter((s) => s.kind === "momo") || [];
    const recent = acc.recent_numbers || [];
    const orders = acc.orders || [];

    m.innerHTML = `
      <div class="modal">
        <button class="m-close" data-close aria-label="Close">×</button>
        <div class="profile-greeting-box">
          <h2>${greeting} 👋</h2>
          <p>${c.email || c.phone || "Valmont Data Customer"}</p>
        </div>

        <div class="account-panel" style="margin-top:16px">
          <!-- Saved Data Lines -->
          <div class="account-section">
            <h4>Saved Data Lines <small style="color:var(--muted);font-size:12px">${dataLines.length}/10</small></h4>
            <div class="num-list" id="accDataLines">
              ${dataLines.length ? dataLines.map((s) => `
                <div class="num-item">
                  <span><b>${s.phone}</b> <span class="tag">${s.label || "Data"}</span></span>
                  <button class="del-btn" data-del-saved="${s.id}" title="Remove">✕</button>
                </div>`).join("") : '<p style="color:var(--muted);font-size:13px">No saved data lines yet.</p>'}
            </div>
            <div class="inp-group" style="margin-top:10px">
              <input class="inp" id="new-dataline-phone" placeholder="Add 0240000000" inputmode="tel">
              <input class="inp" id="new-dataline-label" placeholder="Label (e.g. My Line)" style="max-width:140px">
              <button class="btn btn-orange btn-sm" id="btnSaveDataLine">Add</button>
            </div>
          </div>

          <!-- Saved MoMo Numbers -->
          <div class="account-section">
            <h4>Saved MoMo Numbers <small style="color:var(--muted);font-size:12px">${momoNumbers.length}/10</small></h4>
            <div class="num-list" id="accMomoNumbers">
              ${momoNumbers.length ? momoNumbers.map((s) => `
                <div class="num-item">
                  <span><b>${s.phone}</b> <span class="tag">${s.label || "MoMo"}</span></span>
                  <button class="del-btn" data-del-saved="${s.id}" title="Remove">✕</button>
                </div>`).join("") : '<p style="color:var(--muted);font-size:13px">No saved MoMo numbers yet.</p>'}
            </div>
            <div class="inp-group" style="margin-top:10px">
              <input class="inp" id="new-momo-phone" placeholder="Add 0550000000" inputmode="tel">
              <input class="inp" id="new-momo-label" placeholder="Label (e.g. MTN MoMo)" style="max-width:140px">
              <button class="btn btn-orange btn-sm" id="btnSaveMomo">Add</button>
            </div>
          </div>

          <!-- Recent Delivery Numbers -->
          ${recent.length ? `
            <div class="account-section">
              <h4>Recent Delivery Lines</h4>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                ${recent.map((n) => `<span class="num-chip">${n}</span>`).join("")}
              </div>
            </div>
          ` : ""}

          <!-- Recent Orders -->
          <div class="account-section">
            <h4>Recent Orders</h4>
            <div class="order-mini-list">
              ${orders.length ? orders.map((o) => `
                <div class="order-mini-item">
                  <div>
                    <b>${o.reference}</b> · ${o.phone}
                    <div style="color:var(--muted);font-size:11.5px">${o.bundle ? `${(o.bundle.size_mb/1024)}GB` : ""} ${fmt(o.amount)}</div>
                  </div>
                  <div style="text-align:right">
                    <span class="pill ${o.status}">${o.status}</span>
                    <a href="status.html?reference=${o.reference}" style="display:block;font-size:11.5px;margin-top:2px">Track →</a>
                  </div>
                </div>
              `).join("") : '<p style="color:var(--muted);font-size:13px">No orders placed yet.</p>'}
            </div>
          </div>

          <button class="btn btn-ghost btn-block" id="btnModalLogout">Sign Out</button>
        </div>
      </div>
    `;

    $("[data-close]", m)?.addEventListener("click", () => m.classList.remove("open"));
    $("#btnModalLogout", m)?.addEventListener("click", logout);

    // Wire delete buttons
    $$("[data-del-saved]", m).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delSaved;
        btn.disabled = true;
        await fetch(`/api/account/saved?id=${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${state.customerToken}` },
        });
        openAccountModal();
      });
    });

    // Wire add data line
    $("#btnSaveDataLine", m)?.addEventListener("click", async () => {
      const phoneInp = $("#new-dataline-phone", m);
      const labelInp = $("#new-dataline-label", m);
      const phone = phoneInp?.value.trim();
      const label = labelInp?.value.trim() || "Saved Line";
      if (!validatePhone(phone).ok) {
        toast("Please enter a valid 10-digit Ghana phone number", true);
        return;
      }
      const res = await fetch("/api/account/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.customerToken}` },
        body: JSON.stringify({ kind: "data", phone, label }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Failed to save line", true);
      } else {
        toast("Data line saved ✅");
        openAccountModal();
      }
    });

    // Wire add MoMo
    $("#btnSaveMomo", m)?.addEventListener("click", async () => {
      const phoneInp = $("#new-momo-phone", m);
      const labelInp = $("#new-momo-label", m);
      const phone = phoneInp?.value.trim();
      const label = labelInp?.value.trim() || "MoMo";
      if (!validatePhone(phone).ok) {
        toast("Please enter a valid 10-digit Ghana phone number", true);
        return;
      }
      const res = await fetch("/api/account/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.customerToken}` },
        body: JSON.stringify({ kind: "momo", phone, label }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Failed to save MoMo number", true);
      } else {
        toast("MoMo number saved ✅");
        openAccountModal();
      }
    });
  }

  /* ---------- buy flow ---------- */
  function openBuy(bundleId) {
    const bundle = state.bundles.find((b) => b.id === Number(bundleId));
    if (!bundle || !bundle.available) return;
    state.selected = bundle;
    state.pendingBundle = bundle;

    // Compulsory customer account gate: if not signed in, redirect to Sign Up!
    if (!state.customerToken) {
      window.location.href = "signup.html";
      return;
    }

    const m = $("#buyModal");
    const dataLines = state.accountData?.data_lines || state.accountData?.saved_numbers?.filter((s) => s.kind === "data") || [];
    const recent = state.accountData?.recent_numbers || [];

    m.innerHTML = `
      <div class="modal">
        <button class="m-close" data-close aria-label="Close">×</button>
        <h3>Buy ${bundle.size_mb / 1024}GB — ${NETWORK_NAMES[bundle.network]}</h3>
        <div class="m-sub">${validityLabel(bundle.validity_days)} · auto delivery</div>
        <div class="order-summary">
          <div class="row"><span>Bundle</span><b>${bundle.size_mb / 1024}GB <span class="net-chip ${bundle.network}">${NETWORK_NAMES[bundle.network]}</span> Data</b></div>
          <div class="row total"><span>Total</span><b>${fmt(bundle.price)}</b></div>
        </div>

        ${(dataLines.length || recent.length) ? `
          <div class="field" style="margin-bottom:8px">
            <label>Quick Pick Saved Line</label>
            <div class="chip-suggestions">
              ${dataLines.map((s) => `<button type="button" class="num-chip" data-chip="${s.phone}">📱 ${s.label || "Saved"}: ${s.phone}</button>`).join("")}
              ${recent.filter((r) => !dataLines.some((d) => d.phone === r)).map((r) => `<button type="button" class="num-chip" data-chip="${r}">⏱️ ${r}</button>`).join("")}
            </div>
          </div>
        ` : ""}

        <div class="field">
          <label for="bm-phone">Phone number to receive the data</label>
          <input class="inp" id="bm-phone" inputmode="tel" placeholder="e.g. 024 000 0000" autocomplete="tel">
          <div class="hint" id="bm-phone-hint"></div>
        </div>

        <div class="field" style="margin-top:6px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:normal;font-size:13.5px">
            <input type="checkbox" id="bm-save-num" checked> <span>Save this number to my account</span>
          </label>
        </div>

        <button class="btn btn-orange btn-block" id="bm-next" disabled>Continue →</button>
      </div>`;
    m.classList.add("open");

    const phoneInput = $("#bm-phone", m);
    const hint = $("#bm-phone-hint", m);
    const next = $("#bm-next", m);

    // If there's a primary saved line, pre-fill it
    if (dataLines.length && !phoneInput.value) {
      phoneInput.value = dataLines[0].phone;
    }

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

    // Wire chips
    $$("[data-chip]", m).forEach((chip) => {
      chip.addEventListener("click", () => {
        phoneInput.value = chip.dataset.chip;
        revalidate();
      });
    });

    phoneInput.addEventListener("input", revalidate);
    $("[data-close]", m).addEventListener("click", () => m.classList.remove("open"));

    if (phoneInput.value) revalidate();

    next.addEventListener("click", () => {
      const v = validatePhone(phoneInput.value);
      if (!v.ok) return revalidate();
      const shouldSave = $("#bm-save-num", m)?.checked;
      showConfirm(v.n, shouldSave);
    });
  }

  function showConfirm(phone, shouldSave) {
    const b = state.selected;
    const m = $("#buyModal");
    m.innerHTML = `
      <div class="modal">
        <button class="m-close" data-close aria-label="Close">×</button>
        <h3>Confirm your order</h3>
        <div class="m-sub">Check the number twice — misdials are unrecoverable.</div>
        <div class="order-summary">
          <div class="row"><span>Bundle</span><b>${b.size_mb / 1024}GB <span class="net-chip ${b.network}">${NETWORK_NAMES[b.network]}</span></b></div>
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

      // Save number to account if requested
      if (shouldSave && state.customerToken) {
        fetch("/api/account/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.customerToken}` },
          body: JSON.stringify({ kind: "data", phone, label: "My Line" }),
        }).catch(() => {});
      }

      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.customerToken}`,
          },
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

  /* ---------- Refer & Earn modal ---------- */
  function openReferModal() {
    const m = $("#referModal") || (function() {
      const d = document.createElement("div");
      d.id = "referModal";
      d.className = "modal-back";
      document.body.appendChild(d);
      return d;
    })();

    const refCode = state.customerInfo?.phone ? state.customerInfo.phone.slice(-4) : "VD77";
    const shareUrl = `${window.location.origin}/?ref=${encodeURIComponent(refCode)}`;
    const shareText = encodeURIComponent(`Akosua referred and got 2GB free data on Valmont Data! 🎁 You can also buy the cheapest non-expiry MTN, Telecel & AirtelTigo bundles here: ${shareUrl}`);

    m.innerHTML = `
      <div class="modal" style="max-width:500px">
        <button class="m-close" data-close aria-label="Close">×</button>
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:36px;margin-bottom:6px">🎁</div>
          <h3 style="font-size:22px;color:var(--white)">Akosua referred &amp; got 2GB Free!</h3>
          <p class="m-sub" style="margin-bottom:0">Share Valmont Data with friends. When friends buy data using your link, you earn bonus points and free data bundles instantly!</p>
        </div>

        <div class="field" style="margin-top:14px">
          <label>Your Personal Referral Link</label>
          <div class="inp-group">
            <input class="inp" id="refLinkInp" value="${shareUrl}" readonly style="font-size:13.5px;font-family:monospace">
            <button class="btn btn-orange btn-sm" id="btnCopyRefLink">Copy</button>
          </div>
        </div>

        <div style="margin-top:18px">
          <a class="btn btn-block" style="background:#25D366;color:#fff;font-size:15px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px"
             href="https://api.whatsapp.com/send?text=${shareText}" target="_blank" rel="noopener">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.01 2.01c-5.46 0-9.89 4.43-9.89 9.89 0 1.74.45 3.44 1.32 4.94l-1.4 5.12 5.24-1.38c1.45.8 3.1 1.22 4.83 1.22 5.46 0 9.89-4.43 9.89-9.89s-4.43-9.89-9.89-9.89z"/></svg>
            Share on WhatsApp 🚀
          </a>
        </div>

        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:20px;font-size:13px;color:var(--soft)">
          <b style="color:var(--white);display:block;margin-bottom:6px">How it works:</b>
          <ol style="margin-left:18px;line-height:1.6">
            <li>Copy and send your link to friends or post on your WhatsApp Status.</li>
            <li>When friends purchase any bundle, your account automatically accumulates referral credits.</li>
            <li>Redeem accumulated credits for free MTN, Telecel, or AirtelTigo bundles anytime.</li>
          </ol>
        </div>
      </div>
    `;

    m.classList.add("open");
    $("[data-close]", m)?.addEventListener("click", () => m.classList.remove("open"));
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); });

    $("#btnCopyRefLink", m)?.addEventListener("click", () => {
      const inp = $("#refLinkInp", m);
      if (inp) {
        inp.select();
        navigator.clipboard?.writeText(inp.value).catch(() => {});
        toast("Referral link copied to clipboard! 📋");
      }
    });
  }

  // Check for incoming referral code from URL (?ref=XYZ)
  const urlRef = new URLSearchParams(window.location.search).get("ref");
  if (urlRef) {
    localStorage.setItem("vd_referrer", urlRef);
  }

  // Wire quick links
  document.addEventListener("DOMContentLoaded", () => {
    $("#linkReferEarn")?.addEventListener("click", (e) => {
      e.preventDefault();
      openReferModal();
    });
    $("#heroReferBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      openReferModal();
    });
    $$('a[href="#refer"]').forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openReferModal();
      })
    );
    $("#btnLiveChat")?.addEventListener("click", () => {
      window.open("https://wa.me/233542451578", "_blank", "noopener");
    });
  });

  loadBundles().catch((e) => {
    if ($("#bundleGrid")) {
      $("#bundleGrid").innerHTML = `<div class="notice">Failed to load bundles: ${e.message}</div>`;
    }
  });

  if (window.location.pathname.includes("dashboard.html")) {
    if (!state.customerToken) {
      window.location.href = "signin.html";
    }
  }
})();
