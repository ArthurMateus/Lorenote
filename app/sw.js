// Lorenote service worker: offline app shell.
// Same-origin files use network-first (always fresh when online, cached copy when offline).
// The Supabase client is vendored under /vendor, so there is no third-party script. API calls are never touched.
const SHELL_CACHE = 'lorenote-shell-v10';
const CDN_CACHE = 'lorenote-cdn-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'features.css', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'src/main.js', 'src/app.js', 'src/store.js', 'src/model.js', 'src/view.js', 'src/interact.js', 'src/landing.js', 'src/backend.js', 'src/templates.js', 'src/template-ui.js', 'src/files.js', 'src/icons.js', 'src/theme-boot.js', 'src/theme.js', 'src/layout.js', 'src/minimap.js', 'src/present.js', 'src/tree.js', 'src/database.js', 'src/slash.js', 'src/writer.js', 'src/manuscript.js', 'src/settings.js', 'src/i18n.js', 'src/locales/en.js', 'src/locales/pt-BR.js', 'src/locales/pt-BR.tpl.js', 'src/locales/es.js', 'src/locales/es.tpl.js', 'src/locales/fr.js', 'src/locales/fr.tpl.js', 'vendor/supabase-js.js', 'vendor/iceberg-js_0.8.1.js', 'vendor/supabase_auth-js_2.117.3.js', 'vendor/supabase_functions-js_2.117.3.js', 'vendor/supabase_phoenix_0.4.5.js', 'vendor/supabase_postgrest-js_2.117.3.js', 'vendor/supabase_realtime-js_2.117.3.js', 'vendor/supabase_storage-js_2.117.3.js', 'vendor/supabase_supabase-js_2.117.3.js', 'vendor/tslib_2.8.1.js'];

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
  // everything else (Supabase API, Google, preview images) passes straight through
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
