// Light / dark / system theme. One click on the sun/moon button flips between light and dark;
// "Follow system" stays available in the menu. The choice is mirrored to localStorage so the landing page
// and the very first paint (see the inline script in index.html) use it too.
import { icon } from './icons.js';

const mq = () => matchMedia('(prefers-color-scheme: dark)');
export const effectiveTheme = (pref) => (pref === 'dark' || (pref === 'system' && mq().matches) ? 'dark' : 'light');

export function applyTheme(pref) {
  document.documentElement.dataset.theme = pref; if (document.body) document.body.dataset.theme = pref;
  try { localStorage.setItem('corkboard.theme', pref); } catch { /* private mode */ }
  paintToggles(pref);
  let m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = effectiveTheme(pref) === 'dark' ? '#13141b' : '#f4f2ec';
}

function paintToggles(pref) {
  const dark = effectiveTheme(pref) === 'dark';
  for (const b of document.querySelectorAll('.theme-toggle')) {
    b.innerHTML = icon(dark ? 'sun' : 'moon'); b.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; b.setAttribute('aria-label', b.title); b.dataset.mode = dark ? 'dark' : 'light';
  }
}

/** wire every .theme-toggle; `get`/`set` read and write the preference */
export function bindThemeToggles(get, set) {
  for (const b of document.querySelectorAll('.theme-toggle')) b.onclick = () => set(effectiveTheme(get()) === 'dark' ? 'light' : 'dark');
  mq().addEventListener?.('change', () => { if (get() === 'system') paintToggles('system'); });
  paintToggles(get());
}

export const savedTheme = () => { try { return localStorage.getItem('corkboard.theme') || 'system'; } catch { return 'system'; } };
