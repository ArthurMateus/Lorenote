// Settings dialog: a sidebar of sections (account, appearance, canvas, language, data, help) with cards, switches and
// segmented controls. Preferences live in store.prefs, so they sync with the account like the theme already did.
import { t, getLang, setLang, LANGS } from './i18n.js';
import { applyTheme } from './theme.js';

export const ACCENTS = ['#5b5bd6', '#2f7de1', '#0e9f8e', '#3ea34a', '#d99a1c', '#e4572e', '#d6409f', '#7a5af5'];

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};

/** a custom accent colour: derive the soft and hover shades from it; null restores the theme's own palette */
export function applyAccent(color) {
  const s = document.documentElement.style;
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) { for (const k of ['--accent', '--accent-2', '--accent-ink', '--accent-soft', '--sel']) s.removeProperty(k); return; }
  s.setProperty('--accent', color); s.setProperty('--accent-2', `color-mix(in srgb, ${color} 70%, white)`); s.setProperty('--accent-ink', '#ffffff');
  s.setProperty('--accent-soft', `color-mix(in srgb, ${color} 16%, var(--panel))`); s.setProperty('--sel', `color-mix(in srgb, ${color} 85%, white)`);
}

export function setupSettings(ctx) {
  const { store } = ctx;
  applyAccent(store.prefs.accent);
  store.subscribe((i) => { if (i.pref === 'accent' || i.reset) applyAccent(store.prefs.accent); });

  let dlg = null, section = 'appearance';

  const row = (title, desc, control) => h('div', { class: 'st-row' }, h('div', { class: 'st-txt' }, h('div', { class: 'st-t' }, title), desc ? h('div', { class: 'st-d' }, desc) : null), h('div', { class: 'st-ctl' }, control));
  const group = (title, ...rows) => h('section', { class: 'st-group' }, title ? h('h4', {}, title) : null, h('div', { class: 'st-card' }, ...rows));
  const toggle = (on, onChange, label) => {
    const b = h('button', { type: 'button', role: 'switch', class: 'st-switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label });
    b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange(v); });
    return b;
  };
  const segmented = (items, value, onChange) => h('div', { class: 'st-seg', role: 'radiogroup' }, ...items.map(([k, label]) => h('button', { type: 'button', role: 'radio', class: k === value ? 'on' : '', 'aria-checked': k === value ? 'true' : 'false', onclick: () => onChange(k) }, label)));
  const action = (label, fn, danger) => h('button', { type: 'button', class: 'btn ghost st-btn' + (danger ? ' danger' : ''), onclick: fn }, label);

  const pref = (k, v) => { store.setPref(k, v); };
  const closeThen = (fn) => () => { dlg.close(); setTimeout(fn, 30); };

  const SECTIONS = {
    account() {
      const email = ctx.user?.email;
      const card = h('div', { class: 'st-profile' }, h('div', { class: 'st-avatar' }, (email || 'G')[0].toUpperCase()),
        h('div', {}, h('div', { class: 'st-t' }, email || t('set.guest')), h('div', { class: 'st-d' }, ctx.user ? t('set.accountSync') : t('set.accountGuest'))));
      const acts = [];
      if (ctx.user) acts.push(action(t('menu.signOut'), ctx.signOut, true)); else if (ctx.canSignIn) acts.push(action(t('menu.signIn'), ctx.signIn));
      if (ctx.user && ctx.localCount > 0) acts.push(action(t('menu.importLocal', { n: ctx.localCount }), closeThen(ctx.importLocal)));
      return [h('section', { class: 'st-group' }, h('div', { class: 'st-card st-pad' }, card, h('div', { class: 'st-actions' }, ...acts)))];
    },
    appearance() {
      const cur = store.prefs.theme || 'system';
      const themeCards = h('div', { class: 'st-themes' }, ...[['light', t('set.theme.light')], ['dark', t('set.theme.dark')], ['system', t('set.theme.system')]].map(([k, label]) =>
        h('button', { type: 'button', class: 'st-theme' + (cur === k ? ' on' : ''), 'aria-pressed': cur === k ? 'true' : 'false', onclick: () => { pref('theme', k); applyTheme(k); render(); } },
          h('span', { class: 'st-prev st-prev-' + k }, h('i'), h('b'), h('b')), h('span', { class: 'st-tl' }, label))));
      const sw = h('div', { class: 'st-swatches' }, ...ACCENTS.map((c) => h('button', { type: 'button', class: 'st-sw' + ((store.prefs.accent || ACCENTS[0]) === c ? ' on' : ''), style: `background:${c}`, 'aria-label': c, onclick: () => { pref('accent', c === ACCENTS[0] ? null : c); render(); } })));
      return [group(t('set.theme'), h('div', { class: 'st-pad' }, h('div', { class: 'st-d', style: 'margin-bottom:10px' }, t('set.theme.d')), themeCards)),
        group(t('set.accent'), row(t('set.accent'), t('set.accent.d'), sw)),
        group('', row(t('set.grid'), t('set.grid.d'), toggle(store.prefs.grid !== false, (v) => pref('grid', v), t('set.grid'))))];
    },
    canvas() {
      return [group('', row(t('set.speed'), t('set.speed.d'), segmented([['low', t('speed.low')], ['normal', t('speed.normal')], ['high', t('speed.high')]], store.prefs.sensitivity || 'normal', (k) => { pref('sensitivity', k); render(); })),
        row(t('set.snap'), t('set.snap.d'), toggle(!!store.prefs.snap, (v) => pref('snap', v), t('set.snap'))),
        row(t('set.guides'), t('set.guides.d'), toggle(store.prefs.guides !== false, (v) => pref('guides', v), t('set.guides'))),
        row(t('set.minimap'), t('set.minimap.d'), toggle(store.prefs.minimap !== false, (v) => { pref('minimap', v); ctx.mm?.schedule(); }, t('set.minimap'))),
        row(t('set.sidebar'), t('set.sidebar.d'), toggle(!ctx.tree.drawerHidden(), (v) => (v ? ctx.tree.show() : ctx.tree.hide()), t('set.sidebar'))))];
    },
    language() {
      return [h('p', { class: 'st-d st-lead' }, t('set.lang.d')), h('div', { class: 'st-langs' }, ...LANGS.map((l) => h('button', { type: 'button', class: 'st-lang' + (l.code === getLang() ? ' on' : ''), 'aria-pressed': l.code === getLang() ? 'true' : 'false', onclick: () => setLang(l.code) }, h('span', {}, l.name), l.code === getLang() ? h('span', { class: 'st-check' }, '✓') : null)))];
    },
    data() {
      const rows = [
        row(t('set.export'), t('set.export.d'), action(t('set.run'), ctx.exportJson)),
        row(t('set.import'), t('set.import.d'), action(t('set.run'), closeThen(ctx.importJson))),
        row(t('set.trash'), t('set.trash.d'), action(t('set.open'), closeThen(() => document.querySelector('#btn-trash').click()))),
        row(t('set.templates'), t('set.templates.d'), action(t('set.open'), closeThen(() => ctx.tpl.open()))),
      ];
      const inst = ctx.installItem?.()[0]; if (inst) rows.push(row(t('set.install'), t('set.install.d'), action(t('set.run'), closeThen(inst[1]))));
      return [group('', ...rows)];
    },
    about() {
      return [group('', row(t('set.shortcuts'), t('set.shortcuts.d'), action(t('set.open'), closeThen(() => document.querySelector('#dlg-help').showModal())))),
        h('section', { class: 'st-group' }, h('div', { class: 'st-card st-pad st-about' }, h('span', { class: 'logo' }), h('div', {}, h('div', { class: 'st-t' }, t('set.about')), h('div', { class: 'st-d' }, t('set.about.d')))))];
    },
  };
  const ORDER = ['account', 'appearance', 'canvas', 'language', 'data', 'about'];

  function render() {
    if (!dlg) return;
    const nav = dlg.querySelector('.st-nav'), body = dlg.querySelector('.st-body');
    nav.replaceChildren(...ORDER.map((k) => h('button', { type: 'button', class: 'st-navbtn' + (k === section ? ' on' : ''), 'aria-current': k === section ? 'page' : null, onclick: () => { section = k; render(); } }, t('set.nav.' + k))));
    body.replaceChildren(h('h3', {}, t('set.nav.' + section)), ...SECTIONS[section]());
  }

  function open(start) {
    if (start && SECTIONS[start]) section = start;
    dlg?.remove();
    dlg = h('dialog', { class: 'st-dlg', 'aria-label': t('set.title') }, h('aside', { class: 'st-side' }, h('div', { class: 'st-title' }, t('set.title')), h('nav', { class: 'st-nav' })),
      h('div', { class: 'st-main' }, h('button', { type: 'button', class: 'ib st-x', 'aria-label': t('common.close'), onclick: () => dlg.close() }, '×'), h('div', { class: 'st-body' })));
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); dlg = null; });
    render(); dlg.showModal();
  }
  window.addEventListener('lang-change', () => { if (dlg?.open) { dlg.setAttribute('aria-label', t('set.title')); dlg.querySelector('.st-title').textContent = t('set.title'); render(); } });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); open(); } });
  return { open };
}
