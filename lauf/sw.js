/* ============================================================
   Laufbuch — service worker
   Makes the app work offline once it has been opened:
   - app files: network first (always fresh when online), cache as fallback
   - OCR engine, language data and fonts from CDNs: cached after first use
   ============================================================ */

const VERSION = 'v2';
const SHELL = `laufbuch-shell-${VERSION}`;
const RUNTIME = 'laufbuch-runtime-v1';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'parser.js', 'goals.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const CDN = /(^|\.)(jsdelivr\.net|googleapis\.com|gstatic\.com)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('laufbuch-shell-') && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  try {
    // Don't make people wait on a flaky connection
    return await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))]);
  } catch {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? await cache.match('./') : null);
    return hit || network;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (CDN.test(url.hostname)) event.respondWith(cacheFirst(request));
});
