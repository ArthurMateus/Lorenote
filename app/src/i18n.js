// Internationalisation: dictionaries per language, {placeholder} interpolation, simple plurals, auto-detect + override.
//
// Adding a language:  1) copy src/locales/en.js to src/locales/<code>.js and translate the values (ui) and, optionally,
//                        the built-in template texts (tpl: English text -> translation),
//                     2) import it below and add it to LOCALES. Missing keys fall back to English.
//
//   t('menu.trash')                        -> "Trash"
//   t('toast.imported', { n: 3 })          -> "Imported 3 items ..."          ({name} placeholders)
//   t('card.count', { n: 2 })              -> "2 cards"                       (value is { one, other, zero? } -> Intl.PluralRules)
//   tx('Weekly plan')                      -> translated built-in template text (falls back to the English text)
//
// The chosen language is stored in localStorage ('lorenote.lang'); without it navigator.languages decides.
// setLang() updates <html lang>, re-translates the static markup (data-i18n* attributes) and fires a 'lang-change'
// event on window so dynamic UI can re-render.
import en from './locales/en.js';
import ptBR from './locales/pt-BR.js';
import es from './locales/es.js';
import fr from './locales/fr.js';

export const LOCALES = { en, 'pt-BR': ptBR, es, fr };
export const LANGS = Object.entries(LOCALES).map(([code, l]) => ({ code, name: l.name }));
const DEFAULT = 'en';
const KEY = 'lorenote.lang';

const readStored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const writeStored = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

/** map any BCP-47 tag (pt, pt-PT, es-MX, fr_CA...) to a supported code, or null */
export function matchLang(tag) {
  if (!tag) return null;
  const norm = String(tag).replace('_', '-').toLowerCase();
  const exact = Object.keys(LOCALES).find((c) => c.toLowerCase() === norm);
  if (exact) return exact;
  const base = norm.split('-')[0];
  return Object.keys(LOCALES).find((c) => c.toLowerCase() === base) || Object.keys(LOCALES).find((c) => c.toLowerCase().split('-')[0] === base) || null;
}

export function detectLang() {
  const stored = matchLang(readStored());
  if (stored) return stored;
  for (const tag of (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || []) { const m = matchLang(tag); if (m) return m; }
  return DEFAULT;
}

let lang = detectLang();
let plural = new Intl.PluralRules(lang);
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = () => lang;
export const langName = (code = lang) => LOCALES[code]?.name || code;

const interpolate = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

function lookup(dict, key) { return dict?.ui?.[key]; }

/** translate a key; vars fill {placeholders}; a { one, other } value picks a plural form by vars.n */
export function t(key, vars) {
  let v = lookup(LOCALES[lang], key);
  if (v === undefined) v = lookup(LOCALES[DEFAULT], key);
  if (v === undefined) return key;
  if (typeof v === 'object') {
    const n = vars?.n ?? 0;
    v = (n === 0 && v.zero) || v[plural.select(n)] || v.other || '';
  }
  return interpolate(v, vars);
}
/** does `key` exist in the active language (not just the English fallback)? */
export const hasKey = (key) => lookup(LOCALES[lang], key) !== undefined;

/** translate built-in template text (keyed by its English wording); unknown text is returned unchanged */
export function tx(text) { return (lang !== DEFAULT && LOCALES[lang]?.tpl?.[text]) || text; }

/** translate every [data-i18n*] element under root:  data-i18n (text), -title, -aria-label, -placeholder, -alt */
export function applyI18n(root = document) {
  if (typeof document === 'undefined') return;
  if (root === document) {          // texts shown through CSS ::after content (see styles.css)
    const rs = document.documentElement.style; rs.setProperty('--t-drop', JSON.stringify(t('css.drop'))); rs.setProperty('--t-search', JSON.stringify(t('css.typeToSearch')));
  }
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
    const ds = 'i18n' + attr.replace(/(^|-)(\w)/g, (m, a, c) => c.toUpperCase());        // title -> i18nTitle, aria-label -> i18nAriaLabel
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.dataset[ds]));
  }
}

/** switch language (persisted unless `persist` is false); returns the code actually applied */
export function setLang(code, { persist = true } = {}) {
  const next = matchLang(code) || DEFAULT;
  const changed = next !== lang;
  lang = next; plural = new Intl.PluralRules(lang);
  if (persist) writeStored(lang);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    applyI18n();
    if (changed) window.dispatchEvent(new CustomEvent('lang-change', { detail: { lang } }));
  }
  return lang;
}

/** subscribe to language changes; returns an unsubscribe function */
export function onLangChange(fn) { const h = (e) => fn(e.detail.lang); window.addEventListener('lang-change', h); return () => window.removeEventListener('lang-change', h); }

/** fill a <select> with the available languages and keep it in sync with the current one */
export function bindLangSelect(select) {
  select.replaceChildren(...LANGS.map((l) => Object.assign(document.createElement('option'), { value: l.code, textContent: l.name })));
  select.value = lang;
  select.addEventListener('change', () => setLang(select.value));
  onLangChange((l) => { select.value = l; });
}

if (typeof document !== 'undefined') {
  const boot = () => applyI18n();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}
