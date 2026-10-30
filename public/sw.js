// Keeps Market Kasa opening without a network. The page registers this file with its version
// (sw.js?v=2.0.0), so each release installs a new worker with its own cache and drops the last.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `mk2-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.json', './logo.svg'];
// The built files the page names: the first visit loads them before this worker is in charge.
const ASSET_REFERENCE = /(?:src|href)="(\.?\/?assets\/[^"]+)"/g;

/** Keeps the page, its icon and every built file the page names. */
async function cacheShell() {
  const cache = await caches.open(CACHE);
  const page = await fetch('./index.html', { cache: 'no-store' });
  const html = await page.clone().text();
  const assets = [...html.matchAll(ASSET_REFERENCE)].map((match) => match[1]);
  await cache.addAll([...SHELL.filter((path) => path !== './index.html'), ...assets]);
  await cache.put('./index.html', page);
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('mk2-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === 'navigate') {
    // The page first from the network, so a new release is seen; the kept copy when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || Response.error())),
    );
    return;
  }
  if (url.pathname.includes('/assets/')) {
    // Built files carry a hash in their name: a kept copy is always the right one.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
