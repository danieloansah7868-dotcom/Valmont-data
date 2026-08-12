/* ============================================================================
   Valmont Data — PWA bootstrap (self-contained, loaded on every page).
   ----------------------------------------------------------------------------
   • registers the service worker (app shell + offline, see /sw.js)
   • surfaces the browser "install app" prompt as an in-house install card
   • notifies when a new app version is ready and offers one-tap refresh
   • shows a connection pill when the user goes offline (and a toast on return)
   Uses the house .toast-wrap/.toast styles from assets/css/style.css only.
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* tiny toast — same DOM contract as storefront.js's toast()          */
  /* ------------------------------------------------------------------ */
  function toast(html, isErr, ms) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.innerHTML = html;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), ms || 4500);
  }

  /* ------------------------------------------------------------------ */
  /* install prompt (beforeinstallprompt → in-house install card)       */
  /* ------------------------------------------------------------------ */
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true; // iOS Safari

  let deferredPrompt = null;
  let installDismissedAt = 0;
  try { installDismissedAt = Number(localStorage.getItem('vd-install-dismissed')) || 0; } catch (e) { /* private mode */ }

  function showInstallCard() {
    const hidden = isStandalone() || document.querySelector('.pwa-install');
    const dismissed = Date.now() - installDismissedAt < 7 * 24 * 3600 * 1000; // re-ask weekly
    const onAdmin = /admin\.html$/.test(location.pathname);
    if (hidden || dismissed || onAdmin || !deferredPrompt) return;

    const card = document.createElement('div');
    card.className = 'pwa-install';
    card.innerHTML =
      '<div class="pi-text"><b>Install Valmont Data</b>' +
      'One-tap access, home-screen icon, and instant offline load.</div>' +
      '<button class="btn btn-orange btn-sm" type="button" data-pi-install>Install</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-pi-later aria-label="Not now">Later</button>';
    document.body.appendChild(card);

    card.querySelector('[data-pi-install]').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      deferredPrompt = null;
      card.remove();
      if (choice.outcome === 'accepted') toast('Valmont Data installed 🎉 Check your home screen.');
    });
    card.querySelector('[data-pi-later]').addEventListener('click', () => {
      try { localStorage.setItem('vd-install-dismissed', String(Date.now())); } catch (e) { /* private mode */ }
      card.remove();
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we drive the prompt from the install card
    deferredPrompt = e;
    showInstallCard();
  });
  window.addEventListener('appinstalled', () => {
    document.querySelectorAll('.pwa-install').forEach((n) => n.remove());
    toast('Valmont Data installed 🎉 Check your home screen.');
  });

  /* ------------------------------------------------------------------ */
  /* service worker registration + update flow                          */
  /* ------------------------------------------------------------------ */
  function offerRefresh() {
    if (document.querySelector('.pwa-update')) return;
    const bar = document.createElement('div');
    bar.className = 'pwa-update';
    bar.innerHTML =
      '<b>A new version is ready.</b><span style="flex:1"></span>' +
      '<button class="btn btn-orange btn-sm" type="button" data-pu-go>Update</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-pu-x aria-label="Dismiss">×</button>';
    document.body.appendChild(bar);

    bar.querySelector('[data-pu-go]').addEventListener('click', () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        const w = reg && (reg.waiting || reg.installing);
        if (w) w.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
      });
    });
    bar.querySelector('[data-pu-x]').addEventListener('click', () => bar.remove());
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // A worker was already waiting (e.g. from a previous session) → offer refresh.
        if (reg.waiting) offerRefresh();

        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offerRefresh();
            if (w.state === 'activated' && navigator.serviceWorker.controller) {
              toast('App updated to the latest version ✅');
            }
          });
        });

        // Reload once the new worker (activated after SKIP_WAITING) takes control.
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          location.reload();
        });
      })
      .catch((err) => console.warn('[pwa] service worker registration failed', err));
  }

  /* ------------------------------------------------------------------ */
  /* online / offline awareness                                         */
  /* ------------------------------------------------------------------ */
  let pill = null;
  function setOffline(offline) {
    if (offline) {
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'conn-pill';
        pill.innerHTML = '📡 You\'re offline — reconnect to buy data';
        document.body.appendChild(pill);
      }
    } else if (pill) {
      pill.remove();
      pill = null;
      toast('Back online ✅');
    }
  }
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => setOffline(false));
  setOffline(!navigator.onLine);

  /* ------------------------------------------------------------------ */
  registerSW();
  // Install card may arrive after load on some browsers — re-check once.
  window.addEventListener('load', showInstallCard);
})();
