/* ============================================================================
   ValmontAI — 24/7 Website Assistant for Valmont Data (valmontdata.com)
   ----------------------------------------------------------------------------
   Implements the FINAL ValmontAI prompt: instant answers about bundles,
   delivery and orders; guides visitors to checkout; never invents prices or
   availability.

   • Rule-based intent brain (answerFor) — deterministic, formal English,
     2-3 lines, exactly per the ValmontAI prompt rules.
   • Live stock sync — network availability is read from the public catalogue
     endpoint GET /api/bundles (the same live float data the storefront uses),
     so stock answers reflect the current bundle database. The config-file
     stock notice is only the fallback when live data can't be fetched.
   • Self-injecting widget — add this one <script> to any page and the
     launcher + chat panel appear bottom-right (replaces the old
     "Valmont support is here!" WhatsApp-only widget).
   • Config from /valmontai-data-config.json with hardcoded fallbacks, so the
     assistant still answers even if the config file is missing.
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Business info — defaults from valmontai-data-config.json (fallback) */
  /* ------------------------------------------------------------------ */
  const DEFAULT_CONFIG = {
    businessName: 'Valmont Data',
    website: 'https://www.valmontdata.com',
    whatsapp: '0542451578',
    products: 'Mobile data bundles — MTN, Telecel, AirtelTigo',
    howToBuy: 'Choose network, tap bundle, enter recipient line, confirm, then pay',
    delivery: 'Guaranteed 30-Second Instant Delivery — Auto-credited to your line',
    stockNotice: 'MTN, Telecel, AirtelTigo running low — some bundles paused while restocking',
    warning: 'Wrong numbers are not refundable — double-check before paying',
  };

  const NETWORK_NAMES = { mtn: 'MTN', telecel: 'Telecel', airteltigo: 'AirtelTigo' };
  const NETWORK_ALIASES = [
    { code: 'mtn', keys: ['mtn'] },
    { code: 'telecel', keys: ['telecel', 'vodafone', 'voda'] },
    { code: 'airteltigo', keys: ['airteltigo', 'airtel', 'tigo'] },
  ];
  // Networks the configured stock notice applies to ("other networks" are fine).
  const STOCK_NOTICE_CODES = ['mtn', 'telecel', 'airteltigo'];

  let config = { ...DEFAULT_CONFIG };
  let stock = null; // live catalogue snapshot from /api/bundles
  let stockFetchedAt = 0;

  /* ------------------------------------------------------------------ */
  /* Live stock — fetched from the same API the storefront uses.        */
  /* Never invent availability: if the fetch fails we answer with the    */
  /* configured stock notice instead of claiming anything.              */
  /* ------------------------------------------------------------------ */
  function detectNetwork(text) {
    const t = ' ' + text.toLowerCase() + ' ';
    for (const n of NETWORK_ALIASES) {
      if (n.keys.some((k) => t.includes(k))) return n.code;
    }
    return null;
  }

  function networkSummary(code) {
    if (!stock || !Array.isArray(stock.bundles)) return null;
    const bundles = stock.bundles.filter((b) => b.network === code);
    if (!bundles.length) return null;
    const available = bundles.filter((b) => b.available !== false);
    return {
      code,
      name: (stock.networks && stock.networks.find((n) => n.code === code)?.name) || NETWORK_NAMES[code] || code.toUpperCase(),
      total: bundles.length,
      availableCount: available.length,
      ok: available.length > 0,
    };
  }

  async function loadStock(force) {
    // Cache live data for 60s (the storefront itself refetches on every page view).
    if (!force && stock && Date.now() - stockFetchedAt < 60 * 1000) return stock;
    try {
      const res = await fetch('/api/bundles', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status ' + res.status);
      stock = await res.json();
      stockFetchedAt = Date.now();
    } catch (e) {
      stock = null; // fall back to configured stock notice
    }
    return stock;
  }

  /* ------------------------------------------------------------------ */
  /* The brain — intent matching. Returns { text, actions } or a Promise */
  /* of one. Rules follow the FINAL ValmontAI prompt exactly.           */
  /* ------------------------------------------------------------------ */
  const has = (t, ...words) => words.some((w) => t.includes(w));

  async function answerFor(rawText) {
    const text = ' ' + rawText.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ') + ' ';
    const net = detectNetwork(rawText);
    const wa = 'https://wa.me/233' + String(config.whatsapp).replace(/^0/, '');
    const whatsappAction = [{ label: '💬 WhatsApp ' + config.whatsapp, href: wa, kind: 'wa' }];
    const buyAction = [{ label: 'Buy data →', href: '/#buy' }];
    const trackAction = [{ label: 'Track my order →', href: '/status.html' }];

    /* Intent signals */
    const asksHowTo = has(text, ' how do i', ' how to', ' steps', ' process', ' way to ');
    const asksPrice = has(text, ' price', ' how much', ' cost', ' cedi', ' ghc', ' gh ', ' cheap', ' expensive');
    const asksBuy = has(text, ' buy', ' order', ' purchase', ' get data', ' bundle', ' data plan', ' plan');
    const asksStock = has(text, ' available', ' availability', ' in stock', ' out of stock', ' sold out', ' stock',
      ' working', ' do you have', ' do u have', ' got any', ' have any', ' can i buy', ' can i get',
      ' any bundle', ' any data', ' service down', ' down now', ' networks');

    /* 1 — Greeting / help */
    if (has(text, ' hello', ' hi ', ' hey', ' good morning', ' good afternoon', ' good evening', ' how far', ' akwaaba')
        || /^(help|menu|start)\s*$/.test(text.trim())) {
      return {
        text: 'Hello! Welcome to Valmont Data. How can I help you buy data today?',
        chips: true,
      };
    }

    /* 5 — Wrong number / refund (checked early — dispute intent is explicit) */
    if (has(text, ' wrong number', ' mistyp', ' entered the wrong', ' sent to wrong', ' refund', ' reverse',
      ' return policy', ' cancel my order', ' incorrect number', ' number mistake', ' mistake on the number')) {
      return {
        text: 'Please double-check the recipient number before paying. ' + config.warning +
          '\nFor assistance, please WhatsApp ' + config.whatsapp + '.',
        actions: whatsappAction,
      };
    }

    /* 6 — Track order / missing delivery */
    if (has(text, ' track', ' status of', ' where is my', ' order status', ' my order', ' receipt',
      " haven't received", ' havent received', ' not received', " didn't receive", ' didnt receive')) {
      return {
        text: 'You can track your order via the Track Order menu at the top of the website.',
        actions: trackAction.concat(whatsappAction),
      };
    }

    /* 3 — Stock / availability — answered from LIVE data (rule 9: never invent).
       "How do I buy…" / "…price?" are how-to questions, not stock questions.
       Explicit stock wording ("do you have", "available", "any bundles") wins
       over generic purchase words; a bare network name ("MTN") is also an
       availability question. */
    const bareNetwork = net && !asksStock && !asksHowTo && !asksPrice && !asksBuy &&
      !has(text, ' refund', ' track', ' deliver', ' install', ' pay', ' whatsapp', ' contact');
    if ((asksStock || bareNetwork) && !asksHowTo && !asksPrice && !(asksBuy && !asksStock)) {
      const stockReply = await stockAnswer(net);
      if (stockReply) return stockReply;
    }

    /* 4 — Delivery time */
    if (has(text, ' deliver', ' delivery', ' how fast', ' how long', ' how quickly', ' how soon', ' instant', ' arrive', ' receive', ' credited', ' wait')) {
      return {
        text: config.delivery + ' immediately after payment.',
      };
    }

    /* 7 — Install app / PWA */
    if (has(text, ' install', ' app', ' home screen', ' homescreen', ' pwa', ' download app', ' one tap', ' one-tap', ' offline load')) {
      return {
        text: 'You can install Valmont Data for one-tap access, home-screen icon, and instant offline load. Tap Install when prompted.',
      };
    }

    /* Payment methods */
    if (has(text, ' pay', ' payment', ' momo', ' mobile money', ' mtn money', ' card', ' visa', ' mastercard', ' checkout')) {
      return {
        text: 'You pay directly on the website with Mobile Money or card via secure Valmont-Pay checkout. ' +
          'Choose your network, tap a bundle, enter the recipient line, confirm, then pay.',
        actions: buyAction,
      };
    }

    /* 2 — How to buy / bundle inquiry / prices */
    if (asksBuy || asksHowTo || asksPrice) {
      const pricing = asksPrice;
      return {
        text: 'Choose your network (MTN, Telecel, etc.), tap your preferred bundle, enter the recipient line, confirm, then pay. ' +
          'Delivery is guaranteed within 30 seconds and auto-credited to your line.' +
          (pricing ? '\nBundle prices are shown live in the Buy Data section on the homepage — tap a bundle to see its price.' : ''),
        actions: buyAction,
      };
    }

    /* Contact / human support / hours */
    if (has(text, ' whatsapp', ' contact', ' call', ' phone number', ' speak', ' human', ' agent', ' person', ' customer care', ' support', ' email', ' office', ' location', ' accra', ' open now', ' hours', ' 24/7', ' 24 7')) {
      return {
        text: 'For more information, please WhatsApp ' + config.whatsapp + '. ValmontAI is available 24/7 here on the website.',
        actions: whatsappAction,
      };
    }

    /* Thanks / goodbye */
    if (has(text, ' thank', ' thanks', ' thank you', ' appreciated', ' okay thanks', ' bye', ' good night', ' later')) {
      return {
        text: 'You\'re welcome! Tap Buy Data whenever you need a bundle — delivery is within 30 seconds. Have a great day!',
      };
    }

    /* 8 — Unknown */
    return {
      text: 'For more information, please WhatsApp ' + config.whatsapp + '.',
      actions: whatsappAction,
    };
  }

  /* Stock answer built from LIVE data; falls back to the configured notice. */
  async function stockAnswer(net) {
    await loadStock(false);
    const wa = 'https://wa.me/233' + String(config.whatsapp).replace(/^0/, '');
    const fallback = {
      text: 'Heads up: ' + config.stockNotice + '. Other networks are unaffected.',
    };

    if (!stock || !Array.isArray(stock.bundles)) {
      // Can't read live stock — use the configured notice (never invent).
      return net ? {
        text: 'Heads up: ' + config.stockNotice + '. Other networks are unaffected.\nPlease check the ' +
          (NETWORK_NAMES[net] || net.toUpperCase()) + ' section for available bundles.',
        actions: [{ label: 'Check bundles →', href: '/#buy' }],
      } : fallback;
    }

    if (net) {
      const s = networkSummary(net);
      if (!s) return { ...fallback, text: fallback.text };
      if (s.ok) {
        return {
          text: s.name + ' is available. ' + s.availableCount + ' of ' + s.total +
            ' ' + s.name + ' bundle' + (s.total === 1 ? ' is' : 's are') +
            ' in stock right now — open Buy Data, pick ' + s.name + ', and tap a bundle to order.',
          actions: [{ label: 'Buy ' + s.name + ' data →', href: '/#buy' }],
        };
      }
      return {
        text: 'Heads up: ' + s.name + ' is currently running low on stock — some bundles are paused while we restock. ' +
          'Other networks are unaffected. Please check back shortly.',
        actions: [{ label: 'Other bundles →', href: '/#buy' }].concat([{ label: '💬 WhatsApp ' + config.whatsapp, href: wa, kind: 'wa' }]),
      };
    }

    // General stock question — summarise from live data.
    const summaries = STOCK_NOTICE_CODES.map(networkSummary).filter(Boolean);
    if (!summaries.length) return fallback;
    const down = summaries.filter((s) => !s.ok).map((s) => s.name);
    const up = summaries.filter((s) => s.ok);
    if (down.length) {
      return {
        text: 'Heads up: ' + down.join(', ') +
          ' ' + (down.length === 1 ? 'is' : 'are') + ' running low on stock — some bundles are paused while we restock. ' +
          (up.length ? up.map((s) => s.name).join(' and ') + ' ' + (up.length === 1 ? 'is' : 'are') + ' available. ' : '') +
          'Other networks are unaffected.',
        actions: [{ label: 'Check bundles →', href: '/#buy' }],
      };
    }
    return {
      text: 'All networks are in stock right now — MTN, Telecel and AirtelTigo bundles are available. ' +
        'Open Buy Data, choose your network, and tap a bundle to order. Delivery is within 30 seconds.',
      actions: [{ label: 'Buy data →', href: '/#buy' }],
    };
  }

  /* ------------------------------------------------------------------ */
  /* Widget UI (browser only)                                           */
  /* ------------------------------------------------------------------ */
  const ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  const CHIPS = [
    'How do I buy data?',
    'Is MTN available?',
    'How fast is delivery?',
    'Track my order',
    'Wrong number',
    'Install the app',
  ];

  let panel, msgsEl, inputEl, launcher, tipEl;
  let opened = false;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function scrollDown() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function addMsg(text, who, actions) {
    const el = document.createElement('div');
    el.className = 'vai-msg ' + (who === 'user' ? 'vai-msg-user' : 'vai-msg-bot');
    let html = esc(text);
    if (actions && actions.length) {
      html += '<div class="vai-msg-actions">' + actions.map((a) =>
        '<a class="vai-action ' + (a.kind === 'wa' ? 'vai-action-wa' : '') + '" href="' + esc(a.href) + '"' +
        (/^https?:/.test(a.href) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(a.label) + '</a>'
      ).join('') + '</div>';
    }
    el.innerHTML = html;
    msgsEl.appendChild(el);
    scrollDown();
    return el;
  }

  function showTyping() {
    const t = document.createElement('div');
    t.className = 'vai-typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    msgsEl.appendChild(t);
    scrollDown();
    return t;
  }

  function renderChips() {
    const wrap = panel.querySelector('.vai-chips');
    wrap.innerHTML = '';
    CHIPS.forEach((label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vai-chip';
      b.textContent = label;
      b.addEventListener('click', () => {
        handleUser(label);
      });
      wrap.appendChild(b);
    });
  }

  async function handleUser(text) {
    text = (text || '').trim();
    if (!text) return;
    addMsg(text, 'user');
    inputEl.value = '';
    const typing = showTyping();
    let reply;
    try {
      reply = await answerFor(text);
    } catch (e) {
      reply = { text: 'For more information, please WhatsApp ' + config.whatsapp + '.',
        actions: [{ label: '💬 WhatsApp ' + config.whatsapp, href: 'https://wa.me/233' + String(config.whatsapp).replace(/^0/, ''), kind: 'wa' }] };
    }
    setTimeout(() => {
      typing.remove();
      addMsg(reply.text, 'bot', reply.actions);
    }, 450 + Math.min(text.length * 12, 500));
  }

  function openPanel() {
    panel.classList.add('vai-open');
    launcher.setAttribute('aria-expanded', 'true');
    if (tipEl) tipEl.hidden = true;
    if (!opened) {
      opened = true;
      addMsg('Hello! Welcome to Valmont Data. How can I help you buy data today?', 'bot');
      renderChips();
      loadStock(true); // warm the live stock cache in the background
    }
    setTimeout(() => inputEl && inputEl.focus(), 120);
  }

  function closePanel() {
    panel.classList.remove('vai-open');
    launcher.setAttribute('aria-expanded', 'false');
  }

  function buildWidget() {
    if (document.querySelector('.vai-launcher')) return;

    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'vai-launcher';
    launcher.id = 'vaiLauncher';
    launcher.title = 'Chat with ValmontAI';
    launcher.setAttribute('aria-label', 'Open ValmontAI assistant');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.innerHTML = ICON_CHAT + '<span class="vai-dot" aria-hidden="true"></span>' +
      '<div class="vai-launcher-tip" id="vaiTip" hidden>👋 ValmontAI is here — ask me anything!</div>';

    panel = document.createElement('div');
    panel.className = 'vai-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ValmontAI chat');
    panel.innerHTML =
      '<div class="vai-header">' +
        '<div class="vai-header-avatar">' + ICON_CHAT + '</div>' +
        '<div class="vai-header-text"><b>ValmontAI</b>' +
        '<span><i class="vai-dot"></i> Online · 24/7 assistant</span></div>' +
        '<div class="vai-header-actions">' +
          '<button type="button" class="vai-icon-btn" data-vai-close aria-label="Close chat">' + ICON_CLOSE + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="vai-msgs"></div>' +
      '<div class="vai-chips"></div>' +
      '<form class="vai-input-row">' +
        '<input class="vai-input" type="text" maxlength="300" placeholder="Type your message…" aria-label="Message ValmontAI" autocomplete="off">' +
        '<button type="submit" class="vai-send" aria-label="Send">' + ICON_SEND + '</button>' +
      '</form>' +
      '<div class="vai-foot">Valmont Data · Valmont Group — Accra, Ghana</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    msgsEl = panel.querySelector('.vai-msgs');
    inputEl = panel.querySelector('.vai-input');
    tipEl = launcher.querySelector('#vaiTip');

    launcher.addEventListener('click', () => (panel.classList.contains('vai-open') ? closePanel() : openPanel()));
    panel.querySelector('[data-vai-close]').addEventListener('click', closePanel);
    panel.querySelector('.vai-input-row').addEventListener('submit', (e) => {
      e.preventDefault();
      handleUser(inputEl.value);
    });

    // First-visit tooltip: show after 4s, hide after 12s or once opened.
    setTimeout(() => { if (!opened && tipEl) tipEl.hidden = false; }, 4000);
    setTimeout(() => { if (tipEl) tipEl.hidden = true; }, 16000);
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                          */
  /* ------------------------------------------------------------------ */
  async function init() {
    if (typeof document === 'undefined') return;
    // Admin console is staff-only — no customer assistant there.
    if (/\/admin\.html(\?|#|$)/.test(location.pathname)) return;

    buildWidget();

    try {
      const res = await fetch('/valmontai-data-config.json', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const loaded = await res.json();
        config = { ...DEFAULT_CONFIG, ...loaded };
      }
    } catch (e) { /* defaults stand */ }

    loadStock(false); // warm cache so stock answers are instant
  }

  // Expose the brain for Node tests (scripts/test-valmontai.js).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { answerFor, loadStock, detectNetwork, networkSummary, DEFAULT_CONFIG };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
