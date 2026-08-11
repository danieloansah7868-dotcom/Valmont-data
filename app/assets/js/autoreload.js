/* ============================================================================
   Auto-reload page + dashboard summary.

     /autoreload.html — the opt-in place: usage tracking per data line,
                        active rules, and the consent form.
     dashboard.html  — compact summary card (renders into #dashAutoreload).

   Depends on storefront.js being loaded first (auth guard + nav/account).
   ============================================================================ */

(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const fmt = (n) => "GH₵" + Number(n).toFixed(2);
  const mbLabel = (mb) => (mb >= 1024 ? `${Math.round(mb / 1024)}GB` : `${mb}MB`);
  const NETWORK_NAMES = { mtn: "MTN", telecel: "Telecel", airteltigo: "AirtelTigo" };

  const token = localStorage.getItem("vd_customer_token");
  const API = { headers: { Authorization: `Bearer ${token}` } };

  // Mirror of lib/phones.js network detection (for form filtering only — the
  // server re-validates and hard-fails on mismatches).
  function detectNet(phone) {
    const pre = String(phone || "").replace(/[\s-]/g, "").slice(1, 3);
    if (["24", "25", "26", "27", "54", "55", "56", "57", "59"].includes(pre)) return "mtn";
    if (["20", "23", "50", "53"].includes(pre)) return "telecel";
    if (["26", "27", "28"].includes(pre)) return "airteltigo";
    return null;
  }

  let data = null;

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $("#arToast");
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.className = "toast show " + (kind || "ok");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 3200);
  }

  /* ---------- helpers ---------- */
  function relTime(iso) {
    if (!iso) return null;
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "now";
    const mins = Math.round(diff / 60000);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function when(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
      " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function barClass(pct) {
    if (pct >= 90) return "low";
    if (pct >= 60) return "mid";
    return "";
  }

  /* ---------- data ---------- */
  async function load() {
    const res = await fetch("/api/autoreload", API);
    if (res.status === 401) {
      window.location.href = "signin.html";
      throw new Error("not signed in");
    }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Failed to load");
    data = body;
    return body;
  }

  /* ---------- render: lines ---------- */
  function renderLines(host) {
    const lines = data.lines || [];
    if (!lines.length) {
      host.innerHTML = `<div class="empty-state"><div class="big">📱</div>
        Save a data line in your account first, then order a bundle for it.<br>
        <a href="/" class="btn btn-ghost btn-sm" style="margin-top:12px;">Order data →</a></div>`;
      return;
    }
    host.innerHTML = lines
      .map((l) => {
        const u = l.usage;
        const relationTag = l.relation === "self"
          ? `<span class="line-label" style="color:var(--green);">✓ your line</span>`
          : `<span class="line-label" style="color:var(--orange-2);">📤 not your line — data goes to ${l.phone}</span>`;
        if (!u) {
          return `<div class="line-card">
            <div class="line-top">
              <div><div class="line-phone">${l.phone}</div><div class="line-label">${l.label || "Data line"}</div></div>
              ${relationTag}
            </div>
            <div class="no-usage">No bundle on this line yet — order one and we'll start tracking it here.</div>
          </div>`;
        }
        const pct = u.percent_used;
        const bar = barClass(pct);
        const ask = l.low && l.should_ask ? `
          <div class="ask-box">
            <div style="font-size:20px;">⚠️</div>
            <div class="txt">Your <b>${mbLabel(u.size_mb)}</b> bundle on <b>${l.phone}</b> is at <b>${pct}% used</b> (${mbLabel(u.remaining_mb)} left).
              It will run out soon — turn on Auto-reload and we'll top it up for you automatically.</div>
            <button class="btn-mini on" data-enable-line="${l.phone}">Enable →</button>
          </div>` : "";
        const ruleNote = l.rule
          ? (l.rule.active
              ? `<div class="no-usage" style="margin-top:10px;color:var(--green);">✓ Auto-reload is ON for this line — the sweep will top it up when it drops below ${l.rule.trigger_percent}%.</div>`
              : `<div class="no-usage" style="margin-top:10px;">Auto-reload rule is <b>paused</b> for this line. <button class="btn-mini" data-resume="${l.rule.id}">Resume</button></div>`)
          : "";
        return `<div class="line-card">
          <div class="line-top">
            <div>
              <div class="line-phone">${l.phone} <span class="line-label">${l.label || "Data line"}</span></div>
            </div>
            <span style="display:flex;gap:8px;align-items:center;">${relationTag}<span class="pill ${u.status}">${u.status}</span></span>
          </div>
          <div class="bar-wrap">
            <div class="bar-meta"><span>${mbLabel(u.size_mb)} bundle</span><b>${pct}% used · ${mbLabel(u.remaining_mb)} left</b></div>
            <div class="bar"><div class="bar-fill ${bar}" style="width:${Math.min(pct, 100)}%"></div></div>
          </div>
          <div class="line-foot">
            <span>${u.expires_at ? "Expires " + when(u.expires_at) : "No expiry"}</span>
          </div>
          ${ask}
          ${ruleNote}
        </div>`;
      })
      .join("");
  }

  /* ---------- render: rules ---------- */
  function renderRules(host) {
    const rules = data.rules || [];
    if (!rules.length) {
      host.innerHTML = `<div class="empty-state"><div class="big">🔕</div>
        No auto-reload rules yet. Opt in on the right and we'll handle the rest.</div>`;
      return;
    }
    host.innerHTML = rules
      .map((r) => {
        const cooldownLeft = relTime(r.cooldown_until);
        const recipientChip = r.is_own_line
          ? `<span class="meta-chip" style="color:var(--green);">✓ Your line</span>`
          : `<span class="meta-chip" style="color:var(--orange-2);">📤 Delivers to ${r.phone} — NOT your line</span>`;
        return `<div class="rule-card ${r.active ? "" : "paused"}">
          <div class="rule-top">
            <div>
              <div class="rule-bundle">${r.bundle_label} <span class="net-chip ${r.network}">${NETWORK_NAMES[r.network] || r.network}</span></div>
              <div class="rule-phone">📱 ${r.phone} · charges ${r.momo_number || "—"}</div>
            </div>
            <span class="status-pill ${r.active ? "on" : "off"}">${r.active ? "ON" : "PAUSED"}</span>
          </div>
          <div class="rule-meta">
            ${recipientChip}
            <span class="meta-chip">Trigger <b>${r.trigger_percent}% left</b></span>
            <span class="meta-chip">Reloads <b>${r.reload_count}</b></span>
            <span class="meta-chip">Last <b>${r.last_reload_at ? when(r.last_reload_at) : "—"}</b></span>
          </div>
          ${!r.active && cooldownLeft ? "" : cooldownLeft ? `<div class="rule-cooldown">⏳ Next reload possible in <b>${cooldownLeft}</b> (cooldown)</div>` : ""}
          <div class="rule-actions">
            <button class="btn-mini ${r.active ? "" : "on"}" data-toggle="${r.id}" data-active="${r.active ? "1" : "0"}">
              ${r.active ? "Pause" : "Resume"}
            </button>
            <button class="btn-mini danger" data-del="${r.id}">Remove rule</button>
          </div>
        </div>`;
      })
      .join("");
  }

  /* ---------- render: opt-in form ---------- */
  function renderForm() {
    const lines = data.lines || [];
    const momoNumbers = data.momo_numbers || [];
    const phoneSel = $("#ar-phone");
    const bundleSel = $("#ar-bundle");
    const momoSel = $("#ar-momo");
    if (!phoneSel) return;

    phoneSel.innerHTML = lines.length
      ? lines.map((l) => `<option value="${l.phone}">${l.phone}${l.label && l.label !== "Data line" ? " — " + l.label : ""}</option>`).join("")
      : `<option value="">No saved data lines</option>`;

    momoSel.innerHTML = momoNumbers.length
      ? momoNumbers.map((m) => `<option value="${m.phone}">${m.phone}${m.label && m.label !== "MoMo" ? " — " + m.label : ""}</option>`).join("")
      : `<option value="">No saved MoMo numbers</option>`;

    if (momoNumbers.length === 0) {
      const hint = $("#ar-momo").nextElementSibling;
      if (hint) hint.innerHTML = "Save a MoMo number in your account first, then come back here.";
    }

    fillBundles();
    phoneSel.addEventListener("change", () => {
      fillBundles();
      updateGiftBox();
    });
  }

  /* THE GIFT RULE — when the selected line is not the customer's own number,
     show the warning + recipient-confirmation checkbox. The server enforces
     this too (confirm_recipient), so a favour can never silently reload
     someone else's line with the customer's money. */
  function updateGiftBox() {
    const box = $("#ar-gift-box");
    const confirmCb = $("#ar-confirm-recipient");
    if (!box) return;
    const phone = $("#ar-phone")?.value || "";
    const ownPhone = data?.customer?.phone || "";
    const isOwn = phone === ownPhone;
    box.style.display = isOwn ? "none" : "";
    if (isOwn && confirmCb) confirmCb.checked = false;
    if (confirmCb) confirmCb.checked = false;
    const p1 = $("#ar-gift-phone");
    const p2 = $("#ar-gift-phone2");
    if (p1) p1.textContent = phone;
    if (p2) p2.textContent = phone;
  }

  function fillBundles() {
    const phoneSel = $("#ar-phone");
    const bundleSel = $("#ar-bundle");
    if (!phoneSel || !bundleSel) return;
    const phone = phoneSel.value;
    const line = (data.lines || []).find((l) => l.phone === phone);
    const net = line && line.rule ? line.rule.network : detectNet(phone);
    const bundles = (data.bundles || []).filter((b) => !net || b.network === net);
    bundleSel.innerHTML = bundles.length
      ? bundles.map((b) => `<option value="${b.id}">${mbLabel(b.size_mb)} ${NETWORK_NAMES[b.network] || b.network} — ${fmt(b.price)}</option>`).join("")
      : `<option value="">No bundles for this line yet</option>`;

    const hint = bundleSel.nextElementSibling;
    if (hint) hint.textContent = net ? `Showing ${NETWORK_NAMES[net] || net} bundles for ${phone}.` : "Only bundles for this line's network are shown.";
  }

  /* ---------- actions ---------- */
  async function optIn(phone, bundleId, triggerPercent, momoNumber, confirmRecipient) {
    const res = await fetch("/api/autoreload", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        phone,
        bundle_id: bundleId,
        trigger_percent: triggerPercent,
        momo_number: momoNumber,
        consent: true,
        confirm_recipient: confirmRecipient || false,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not enable auto-reload");
    return body;
  }

  async function toggleRule(id, active) {
    const res = await fetch("/api/autoreload", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "toggle", id, active }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not update rule");
    return body;
  }

  async function removeRule(id) {
    const res = await fetch(`/api/autoreload?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not remove rule");
    return body;
  }

  async function refresh() {
    try {
      await load();
      renderLines($("#arLines"));
      renderRules($("#arRules"));
      renderForm();
    } catch (e) {
      toast(e.message, "error");
    }
  }

  /* ---------- wire ---------- */
  function wirePage() {
    const form = $("#arForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const phone = $("#ar-phone").value;
      const bundleId = Number($("#ar-bundle").value);
      const triggerPercent = Number($("#ar-trigger").value);
      const momoNumber = $("#ar-momo").value;
      const consent = $("#ar-consent").checked;
      const ownPhone = data?.customer?.phone || "";
      const isOwnLine = phone === ownPhone;
      const confirmRecipient = $("#ar-confirm-recipient")?.checked || false;

      if (!phone || !bundleId) return toast("Pick a data line and a bundle first", "error");
      if (!momoNumber) return toast("Pick a MoMo number to charge (save one in your account first)", "error");
      if (!consent) return toast("Please tick the consent box — we never top up without your authorisation", "error");
      if (!isOwnLine && !confirmRecipient) {
        return toast("This line is not yours — tick the box confirming the data goes to " + phone + ", not to you", "error");
      }

      const btn = $("#ar-submit");
      btn.disabled = true;
      btn.textContent = "Saving your opt-in…";
      try {
        const r = await optIn(phone, bundleId, triggerPercent, momoNumber, !isOwnLine ? confirmRecipient : undefined);
        toast(
          isOwnLine
            ? `✅ Auto-reload is on for ${phone} — we'll top up when only ${triggerPercent}% is left`
            : `✅ Gift auto-reload on: ${phone} gets topped up from your MoMo when it drops below ${triggerPercent}%`
        );
        $("#ar-consent").checked = false;
        if ($("#ar-confirm-recipient")) $("#ar-confirm-recipient").checked = false;
        await refresh();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Turn on Auto-reload →";
      }
    });

    // Delegated clicks: enable-line / resume / toggle / delete
    document.addEventListener("click", async (ev) => {
      const enableBtn = ev.target.closest("[data-enable-line]");
      if (enableBtn) {
        const sel = $("#ar-phone");
        if (sel) {
          sel.value = enableBtn.dataset.enableLine;
          fillBundles();
          sel.scrollIntoView({ behavior: "smooth", block: "center" });
          sel.focus({ preventScroll: true });
        }
        return;
      }
      const resumeBtn = ev.target.closest("[data-resume]");
      if (resumeBtn) {
        try {
          await toggleRule(resumeBtn.dataset.resume, true);
          toast("Auto-reload resumed ✅");
          await refresh();
        } catch (err) { toast(err.message, "error"); }
        return;
      }
      const toggleBtn = ev.target.closest("[data-toggle]");
      if (toggleBtn) {
        const active = toggleBtn.dataset.active === "1";
        try {
          await toggleRule(toggleBtn.dataset.toggle, !active);
          toast(active ? "Rule paused — no more top-ups until you resume" : "Rule resumed ✅");
          await refresh();
        } catch (err) { toast(err.message, "error"); }
        return;
      }
      const delBtn = ev.target.closest("[data-del]");
      if (delBtn) {
        if (!confirm("Remove this auto-reload rule? No more automatic top-ups for this line.")) return;
        try {
          await removeRule(delBtn.dataset.del);
          toast("Rule removed — opt out complete");
          await refresh();
        } catch (err) { toast(err.message, "error"); }
      }
    });
  }

  /* ---------- dashboard summary card ---------- */
  async function renderDashboardSummary() {
    const host = $("#dashAutoreload");
    if (!host) return;
    let body;
    try {
      const res = await fetch("/api/autoreload", API);
      if (res.status === 401) { host.innerHTML = `<div class="sub">Sign in to see your bundles.</div>`; return; }
      body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
    } catch (e) {
      host.innerHTML = `<div class="sub">Could not load bundle usage.</div>`;
      return;
    }
    data = body;
    const lines = body.lines || [];
    const rules = body.rules || [];

    if (!lines.length) {
      host.innerHTML = `<div class="sub">No data lines saved yet — add one in your account, then order a bundle.</div>`;
      return;
    }
    const activeRules = rules.filter((r) => r.active).length;

    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
        <div>
          <div style="font-weight:800;color:var(--white);font-size:15px;">My bundles &amp; auto-reload</div>
          <div class="sub" style="margin:0;">${activeRules} of ${rules.length} rules active · the web tracks your lines below</div>
        </div>
        <a class="btn btn-orange btn-sm" href="autoreload.html">Manage →</a>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${lines.slice(0, 4).map((l) => {
          const u = l.usage;
          const giftTag = l.relation === "other"
            ? `<span style="color:var(--orange-2);font-size:10.5px;font-weight:800;margin-left:6px;">📤 not your line</span>`
            : "";
          if (!u) return `<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--muted);padding:8px 0;border-bottom:1px solid var(--line);">
            <b style="color:var(--soft);">${l.phone}</b><span>No bundle yet</span></div>`;
          const pct = u.percent_used;
          return `<div style="padding:8px 0;border-bottom:1px solid var(--line);">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:6px;">
              <span><b style="color:var(--white);">${l.phone}</b>${giftTag} <span style="color:var(--muted);font-size:11.5px;">${mbLabel(u.size_mb)}</span></span>
              <span style="color:${pct >= 90 ? "var(--red)" : pct >= 60 ? "var(--orange)" : "var(--green)"};font-weight:800;">${pct}% used</span>
            </div>
            <div class="bar" style="height:8px;"><div class="bar-fill ${barClass(pct)}" style="width:${Math.min(pct,100)}%;"></div></div>
          </div>`;
        }).join("")}
      </div>
      ${lines.some((l) => l.should_ask) ? `
        <div class="ask-box" style="margin-top:12px;">
          <div style="font-size:18px;">⚠️</div>
          <div class="txt">One of your bundles is running low with no auto-reload rule. <a href="autoreload.html">Turn it on here →</a></div>
        </div>` : ""}
    `;
  }

  /* ---------- boot ---------- */
  function boot() {
    if (window.location.pathname.includes("autoreload.html")) {
      if (!token) {
        window.location.href = "signin.html";
        return;
      }
      wirePage();
      refresh().catch(() => {});
    } else if (document.getElementById("dashAutoreload")) {
      renderDashboardSummary();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
