// Corkboard service worker: offline app shell.
// Same-origin files use network-first (always fresh when online, cached copy when offline).
// Pinned CDN modules (supabase-js) are immutable, so they are cache-first. API calls are never touched.
const SHELL_CACHE = 'corkboard-shell-v2';
const CDN_CACHE = 'corkboard-cdn-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'src/main.js', 'src/app.js', 'src/store.js', 'src/model.js', 'src/view.js', 'src/interact.js', 'src/landing.js', 'src/backend.js', 'src/templates.js', 'src/template-ui.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL_CACHE && k !== CDN_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.hostname === 'cdn.jsdelivr.net') e.respondWith(cacheFirst(req));      // everything else (Supabase API, Google) passes straight through
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && !new URL(req.url).search.includes('code=')) cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null) || Response.error();
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req); if (hit) return hit;
  const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res;
}

self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });
