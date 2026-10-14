// Entry point: decide between the landing/auth page and the board app.
import baseConfig from '../config.js';
import { createBackend } from './backend.js';
import { showLanding, showNewPassword } from './landing.js';
import { hydrateIcons } from './icons.js';
import { applyTheme, bindThemeToggles, savedTheme } from './theme.js';

// optional private overrides (git-ignored), e.g. the Supabase URL + anon key
const localConfig = await import('../config.local.js').then((m) => m.default).catch(() => ({}));
const config = { ...baseConfig, ...localConfig };

let backend = null;
try { backend = await createBackend(config); } catch (err) { console.error('Cloud backend unavailable, running local-only', err); }

const user = backend ? await backend.getUser().catch(() => null) : null;
const guest = localStorage.getItem('corkboard.guest') === '1';
window.corkboardAuth = !!backend;

if (backend) backend.onAuthChange((u, event) => { if (event === 'PASSWORD_RECOVERY') showNewPassword(backend); else location.reload(); });

if (backend && !user && !guest) {
  hydrateIcons(); applyTheme(savedTheme()); bindThemeToggles(savedTheme, applyTheme);
  showLanding({ backend, onGuest: () => { localStorage.setItem('corkboard.guest', '1'); location.reload(); } });
} else {
  const { startApp } = await import('./app.js');
  await startApp({ backend: user ? backend : null, user });
}

// ---------------------------------------------------------------- installable app + offline shell
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker not registered', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) window.dispatchEvent(new Event('corkboard:updated')); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.corkboardInstall = e; window.dispatchEvent(new Event('corkboard:installable')); });
window.addEventListener('appinstalled', () => { window.corkboardInstall = null; });
