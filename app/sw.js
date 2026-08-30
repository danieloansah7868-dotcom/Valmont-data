/* ============================================================================
   Valmont Data — service worker (PWA app shell + offline support)
   ----------------------------------------------------------------------------
   Zero-dependency, no build step. Kept deliberately simple:

     install  → precache the static app shell (pages, css, js, icons, manifest)
     fetch    → navigations:   network-first → cached page → /offline.html
                static assets: cache-first + background refresh (stale-while-revalidate)
                /api/*:        NOT intercepted — live data only; the storefront
                               renders its own offline/error states when the
                               network is unavailable (never serve stale stock
                               or float data).
                other same-origin GETs: network-first → cache fallback

   Bump CACHE_NAME whenever the app shell changes so install() re-precaches;
   activate() deletes every older cache (cache versioning).
   ============================================================================ */

const CACHE_NAME = 'valmontdata-v4';
const OFFLINE_URL = '/offline.html';

/* The static app shell — precached on install so first open after install is
   instant and the whole shell works offline (data still needs a connection). */
const APP_SHELL = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/status.html',
  '/signin.html',
  '/signup.html',
  '/dashboard.html',
  '/assets/css/style.css',
  '/assets/css/valmontai.css',
  '/assets/js/pwa.js',
  '/assets/js/storefront.js',
  '/assets/js/status.js',
  '/assets/js/admin.js',
  '/assets/js/valmontai.js',
  '/assets/img/valmont-data-logo.png',
  '/assets/img/valmont-data-favicon.png',
  '/assets/img/google.svg',
];

const CACHEABLE_EXT = /\.(css|js|png|svg|ico|webp|jpg|jpeg|gif|woff2?)(\?|#|$)/;

/* ---------------- install: precache the shell ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

/* ---------------- activate: drop old caches, take control ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------------- message: allow the page to force an update ---------------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------------- fetch: the strategies above ---------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live API data is never served from cache — see header comment.
  if (url.pathname.startsWith('/api/')) return;

  // Page navigations: network first, then any cached page, then the offline shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // Static assets: cache-first, refreshed in the background (SWR).
  if (CACHEABLE_EXT.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
    return;
  }

  // Anything else same-origin: network-first with cache fallback.
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
