// Databases: a card that holds typed rows and can be shown through several saved views (table, board, gallery, list,
// calendar, chart), each with its own filters, sort, grouping and visible properties. The canvas card is a small preview;
// "Open" shows the full editor in a dialog. Rows can be imported from / exported to CSV.
import { uid } from './store.js';
import { t, getLang } from './i18n.js';
import { safeColor } from './model.js';

export const PROP_TYPES = [['text', 'Text'], ['select', 'Select'], ['status', 'Status'], ['date', 'Date'], ['checkbox', 'Checkbox'], ['number', 'Number'], ['url', 'Link']];
export const VIEW_TYPES = [['table', 'Table'], ['board', 'Board'], ['gallery', 'Gallery'], ['list', 'List'], ['calendar', 'Calendar'], ['chart', 'Chart']];
const OPT_COLORS = ['#9aa5b8', '#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7', '#7dcfff', '#ff9e64'];
const OPS = {
  text: [['contains', 'contains'], ['is', 'is'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  select: [['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  date: [['is', 'is'], ['lt', 'is before'], ['gt', 'is after'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  number: [['is', '='], ['gt', '>'], ['lt', '<'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  checkbox: [['checked', 'is checked'], ['unchecked', 'is not checked']],
};
const opKind = (t) => (t === 'status' ? 'select' : t === 'url' ? 'text' : t);
const NOVAL = new Set(['empty', 'notempty', 'checked', 'unchecked']);

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};

const opt = (label, i) => ({ id: uid(), label, color: OPT_COLORS[i % OPT_COLORS.length] });
const vtList = () => VIEW_TYPES.map(([k]) => [k, t('db.vt.' + k)]);
const ptList = () => PROP_TYPES.map(([k]) => [k, t('db.pt.' + k)]);
const newView = (type, name, extra = {}) => ({ id: uid(), name: name || t('db.vt.' + type), type, groupBy: null, sort: null, filters: [], hidden: [], ...extra });

export function defaultDatabaseContent() {
  const status = { id: uid(), name: t('db.def.status'), type: 'status', options: [t('db.def.todo'), t('db.def.doing'), t('db.def.done')].map(opt) };
  const date = { id: uid(), name: t('db.def.due'), type: 'date', options: [] };
  const tag = { id: uid(), name: t('db.def.tag'), type: 'select', options: [t('db.def.idea'), t('db.def.research')].map((l, i) => opt(l, i + 3)) };
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const row = (title, st, tg, d) => ({ id: uid(), title, cells: { [status.id]: status.options[st].id, [tag.id]: tg == null ? '' : tag.options[tg].id, [date.id]: d || '' } });
  const table = newView('table', t('db.def.allItems')); const board = newView('board', t('db.def.byStatus'), { groupBy: status.id });
  return { title: t('db.untitled'), locked: false, props: [status, date, tag], rows: [row(t('db.def.first'), 0, 0, day(2)), row(t('db.def.second'), 1, null, day(5)), row(t('db.def.third'), 2, 1, day(9))], views: [table, board], activeView: table.id };
}

/** older databases stored a single view inline; upgrade them to the saved-views shape */
export function normalize(c) {
  if (c.views?.length) { if (!c.views.some((v) => v.id === c.activeView)) c.activeView = c.views[0].id; return c; }
  const v = newView(VIEW_TYPES.some((t) => t[0] === c.view) ? c.view : 'table', 'View', { groupBy: c.groupBy || null, sort: c.sort || null });
  c.views = [v]; c.activeView = v.id; delete c.view; delete c.groupBy; delete c.sort; c.locked = !!c.locked; return c;
}

/** plain text used by search */
export const databaseText = (c) => `${c.title || ''} ${(c.rows || []).map((r) => r.title).join(' ')}`;

const optOf = (prop, id) => prop.options?.find((o) => o.id === id);
const cellText = (prop, v) => {
  if (v == null || v === '') return '';
  if (prop.type === 'select' || prop.type === 'status') return optOf(prop, v)?.label || '';
  if (prop.type === 'checkbox') return v ? '✓' : '';
  return String(v);
};

/** the small, read-only card shown on the canvas */
export function buildPreview(rec, e, view) {
  const title = h('div', { class: 'db-title' });
  const badge = h('span', { class: 'db-badge' });
  const open = h('button', { class: 'db-open', type: 'button', 'data-nodrag': '', title: t('db.openTip') }, t('db.open'));
  open.addEventListener('click', (ev) => { ev.stopPropagation(); view.onOpenDatabase?.(e.id); });
  const body = h('div', { class: 'db-prev' });
  rec.node.append(h('div', { class: 'db-head' }, title, badge, open), body);
  rec.node.addEventListener('dblclick', (ev) => { if (ev.target.closest('[data-nodrag]')) return; view.onOpenDatabase?.(e.id); });
  rec.update = (el) => {
    const c = normalize(structuredClone(el.content)); title.textContent = c.title || t('db.untitled');
    const av = c.views.find((v) => v.id === c.activeView);
    badge.textContent = `${(c.rows || []).length} · ${t('db.vt.' + (av?.type || 'table'))}${c.locked ? ' · 🔒' : ''}`;
    const status = c.props.find((p) => p.id === av?.groupBy) || c.props.find((p) => p.type === 'status' || p.type === 'select');
    const prevRows = (c.rows || []).slice(0, 6).map((r) => {
      const tx = status ? cellText(status, r.cells[status.id]) : '';
      const o = status ? optOf(status, r.cells[status.id]) : null;
      return h('div', { class: 'db-prev-row' }, h('span', { class: 'db-prev-t' }, r.title || t('db.row')), tx ? h('span', { class: 'db-chip', style: `--c:${safeColor(o?.color, '#9aa5b8')}` }, tx) : null);
    });
    if ((c.rows || []).length > 6) prevRows.push(h('div', { class: 'db-more' }, t('db.more', { n: c.rows.length - 6 })));
    body.replaceChildren(...prevRows);
  };
}

// ------------------------------------------------------------------ CSV
export function toCsv(c) {
  const q = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number')) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = [t('db.name'), ...c.props.map((p) => p.name)];
  const body = c.rows.map((r) => [r.title, ...c.props.map((p) => (p.type === 'checkbox' ? (r.cells[p.id] ? 'true' : 'false') : p.type === 'select' || p.type === 'status' ? cellText(p, r.cells[p.id]) : r.cells[p.id] ?? ''))]);
  return [head, ...body].map((l) => l.map(q).join(',')).join('\r\n');
}
export function parseCsv(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || ''; const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}
/** merge parsed CSV rows into a database content object (columns matched by name; new columns become Text, or Select when they have few distinct values) */
export function mergeCsv(c, table) {
  if (table.length < 2) return 0;
  const head = table[0].map((x) => x.trim()); const data = table.slice(1, 5001);
  const titleCol = Math.max(0, head.findIndex((x) => /^(name|nome|nombre|nom|title|t[ií]tulo|titre)$/i.test(x)));
  const colProp = head.map((name, i) => {
    if (i === titleCol) return null;
    let p = c.props.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p) {
      const vals = [...new Set(data.map((r) => (r[i] || '').trim()).filter(Boolean))];
      const asSelect = data.length >= 3 && vals.length > 0 && vals.length <= 8;
      p = { id: uid(), name: name || 'Column ' + (i + 1), type: asSelect ? 'select' : 'text', options: asSelect ? vals.map(opt) : [] }; c.props.push(p);
    }
    return p;
  });
  for (const r of data) {
    const cells = {};
    colProp.forEach((p, i) => {
      if (!p) return; const v = (r[i] || '').trim(); if (v === '') return;
      if (p.type === 'select' || p.type === 'status') { let o = p.options.find((x) => x.label.toLowerCase() === v.toLowerCase()); if (!o) { o = opt(v, p.options.length); p.options.push(o); } cells[p.id] = o.id; }
      else if (p.type === 'checkbox') cells[p.id] = /^(true|yes|1|x|✓)$/i.test(v);
      else if (p.type === 'number') { const n = Number(v); if (Number.isFinite(n)) cells[p.id] = n; }
      else if (p.type === 'date') cells[p.id] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
      else cells[p.id] = v.slice(0, 2000);
    });
    c.rows.push({ id: uid(), title: (r[titleCol] || '').trim().slice(0, 300), cells });
  }
  return data.length;
}

// ------------------------------------------------------------------ filtering
function passes(c, r, f) {
  const p = c.props.find((x) => x.id === f.prop); if (!p) return true;
  const v = r.cells[p.id]; const empty = v == null || v === '' || v === false;
  switch (f.op) {
    case 'empty': return empty; case 'notempty': return !empty;
    case 'checked': return !!v; case 'unchecked': return !v;
    case 'contains': return String(v ?? '').toLowerCase().includes(String(f.val ?? '').toLowerCase());
    case 'is': return p.type === 'number' ? Number(v) === Number(f.val) : String(v ?? '') === String(f.val ?? '');
    case 'isnot': return String(v ?? '') !== String(f.val ?? '');
    case 'gt': return !empty && (p.type === 'number' ? Number(v) > Number(f.val) : String(v) > String(f.val));
    case 'lt': return !empty && (p.type === 'number' ? Number(v) < Number(f.val) : String(v) < String(f.val));
    default: return true;
  }
}

/** full editor dialog; re-renders on local edits and (when you are not typing) on remote ones */
export function openDatabase(store, id) {
  const dlg = h('dialog', { class: 'db-dlg' });
  document.body.append(dlg);
  const get = () => { const e = store.live(id); return e ? normalize(structuredClone(e.content)) : null; };
  let locked = false;
  const set = (fn, label, merge) => {
    const cur = store.live(id); if (!cur) return;
    const c = normalize(structuredClone(cur.content));
    if (c.locked && !/view|lock|calendar/i.test(label || '')) return;      // a locked database can still be browsed (views, filters) but not edited
    store.commit([{ id, after: { ...cur, content: fn(c) || c } }], { label, merge });
    render();
  };
  let filterText = '', menu = null, month = new Date(); month.setDate(1);

  const head = h('header', { class: 'db-bar' });
  const views = h('div', { class: 'db-views' });
  const tools = h('div', { class: 'db-tools' });
  const body = h('div', { class: 'db-body' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
  dlg.append(head, views, tools, body, file);

  let deferred = false;
  const unsub = store.subscribe((info) => { if (info.local) return; if (dlg.open && !dlg.contains(document.activeElement)) render(); else if (dlg.open) deferred = true; });
  dlg.addEventListener('focusout', () => setTimeout(() => { if (deferred && dlg.open && !dlg.contains(document.activeElement)) { deferred = false; render(); } }));
  dlg.addEventListener('close', () => { unsub(); dlg.remove(); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); else if (menu && !ev.target.closest('.db-pop,[data-pop]')) { menu = null; render(); } });

  const input = (value, onCommit, attrs = {}) => {
    const i = h('input', { value, autocomplete: 'off', spellcheck: 'false', ...attrs });
    i.addEventListener('change', () => onCommit(i.value));
    i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') i.blur(); ev.stopPropagation(); });
    return i;
  };
  const sel = (items, value, onChange, attrs = {}) => { const s = h('select', attrs, ...items.map(([k, l]) => h('option', { value: k }, l))); s.value = value ?? ''; s.addEventListener('change', () => onChange(s.value)); return s; };

  const activeOf = (c) => c.views.find((v) => v.id === c.activeView);
  const setView = (fn, label) => set((n) => { const v = activeOf(n); if (v) fn(v, n); return n; }, label || 'Edit view');

  function cellEditor(c, row, prop) {
    const v = row.cells[prop.id];
    const put = (val) => set((n) => { const r = n.rows.find((x) => x.id === row.id); if (r) r.cells[prop.id] = val; return n; }, 'Edit database', 'db' + id + row.id + prop.id);
    const dis = c.locked;
    if (prop.type === 'checkbox') { const i = h('input', { type: 'checkbox', disabled: dis }); i.checked = !!v; i.addEventListener('change', () => put(i.checked)); return i; }
    if (prop.type === 'select' || prop.type === 'status') {
      const s = sel([['', '—'], ...prop.options.map((o) => [o.id, o.label])], v || '', put, { class: 'db-sel', disabled: dis }); s.style.setProperty('--c', safeColor(optOf(prop, v)?.color, 'transparent')); return s;
    }
    if (prop.type === 'date') { const i = h('input', { type: 'date', value: v || '', disabled: dis }); i.addEventListener('change', () => put(i.value)); return i; }
    if (prop.type === 'number') return input(v ?? '', (x) => put(x === '' ? '' : Number(x)), { type: 'number', step: 'any', disabled: dis });
    return input(v ?? '', put, { type: prop.type === 'url' ? 'url' : 'text', placeholder: prop.type === 'url' ? 'https://…' : '', disabled: dis });
  }

  function rowsOf(c, v) {
    let rows = c.rows.slice();
    const q = filterText.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.title + ' ' + c.props.map((p) => cellText(p, r.cells[p.id])).join(' ')).toLowerCase().includes(q));
    for (const f of v.filters || []) rows = rows.filter((r) => passes(c, r, f));
    if (v.sort) {
      const p = c.props.find((x) => x.id === v.sort.prop);
      const key = (r) => (p ? (p.type === 'select' || p.type === 'status' ? p.options.findIndex((o) => o.id === r.cells[p.id]) : r.cells[p.id] ?? '') : r.title);
      rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (v.sort.dir === 'desc' ? -1 : 1); });
    }
    return rows;
  }

  const addRow = (extra = {}) => set((n) => { n.rows.push({ id: uid(), title: '', cells: { ...extra } }); return n; }, 'Add row');
  const delRow = (rid) => set((n) => { n.rows = n.rows.filter((r) => r.id !== rid); return n; }, 'Delete row');
  const titleInput = (c, r) => input(r.title, (val) => set((n) => { n.rows.find((x) => x.id === r.id).title = val; return n; }, 'Edit row', 'dbt' + id + r.id), { placeholder: t('db.row'), disabled: c.locked });

  function propMenu(c, prop) {
    const m = h('div', { class: 'db-pmenu db-pop' });
    const name = input(prop.name, (val) => set((n) => { n.props.find((p) => p.id === prop.id).name = val.trim() || 'Property'; return n; }, 'Rename property'));
    const type = sel(ptList(), prop.type, (ty) => set((n) => { const p = n.props.find((x) => x.id === prop.id); p.type = ty; if ((ty === 'select' || ty === 'status') && !p.options.length) p.options = ['One', 'Two', 'Three'].map(opt); return n; }, 'Change property type'));
    m.append(h('label', {}, t('db.name'), name), h('label', {}, t('db.type'), type));
    if (prop.type === 'select' || prop.type === 'status') {
      m.append(h('label', {}, t('db.options'), input(prop.options.map((o) => o.label).join(', '), (val) => set((n) => {
        const p = n.props.find((x) => x.id === prop.id); const labels = val.split(',').map((s) => s.trim()).filter(Boolean);
        const old = p.options; p.options = labels.map((l, i) => old.find((o) => o.label === l) || (old[i] && !labels.includes(old[i].label) ? { ...old[i], label: l } : opt(l, i))); return n;      // a renamed option keeps its id, so rows keep their value

      }, 'Edit options'))));
    }
    m.append(h('button', { type: 'button', class: 'tb danger', onclick: () => { menu = null; set((n) => { n.props = n.props.filter((p) => p.id !== prop.id); for (const v of n.views) { if (v.groupBy === prop.id) v.groupBy = null; v.filters = v.filters.filter((f) => f.prop !== prop.id); if (v.sort?.prop === prop.id) v.sort = null; } return n; }, 'Delete property'); } }, t('db.deleteProp')));
    return m;
  }

  // ---- views
  function tableView(c, v) {
    const props = c.props.filter((p) => !v.hidden.includes(p.id));
    const tbl = h('table', { class: 'db-tbl' });
    tbl.append(h('thead', {}, h('tr', {}, h('th', { class: 'db-th-title' }, t('db.name')), ...props.map((p) => {
      const th = h('th', {}, h('button', { type: 'button', class: 'db-th', 'data-pop': '', title: t('db.editProp'), disabled: c.locked, onclick: () => { menu = menu === 'p' + p.id ? null : 'p' + p.id; render(); } }, p.name, h('span', { class: 'db-ty' }, p.type)));
      if (menu === 'p' + p.id) th.append(propMenu(c, p)); return th;
    }), h('th', { class: 'db-th-add' }, h('button', { type: 'button', class: 'db-th', disabled: c.locked, title: t('db.addProp'), onclick: () => set((n) => { n.props.push({ id: uid(), name: t('db.props') + ' ' + (n.props.length + 1), type: 'text', options: [] }); return n; }, 'Add property') }, '+')))));
    tbl.append(h('tbody', {}, ...rowsOf(c, v).map((r) => h('tr', {}, h('td', { class: 'db-td-title' }, titleInput(c, r)), ...props.map((p) => h('td', {}, cellEditor(c, r, p))),
      h('td', { class: 'db-td-x' }, h('button', { type: 'button', class: 'ib', 'aria-label': t('db.delRow'), title: t('db.delRow'), disabled: c.locked, onclick: () => delRow(r.id) }, '×'))))));
    return h('div', { class: 'db-scroll' }, tbl, c.locked ? null : h('button', { type: 'button', class: 'tb db-add', onclick: () => addRow() }, t('db.newRow')));
  }
  const chips = (c, v, r, skip) => c.props.filter((p) => p.id !== skip && !v.hidden.includes(p.id)).map((p) => { const tx = cellText(p, r.cells[p.id]); if (!tx) return null; const o = optOf(p, r.cells[p.id]); return h('span', { class: 'db-chip', style: `--c:${safeColor(o?.color, '#9aa5b8')}`, title: p.name }, tx); });
  const groupProp = (c, v) => c.props.find((p) => p.id === v.groupBy && (p.type === 'select' || p.type === 'status')) || c.props.find((p) => p.type === 'status' || p.type === 'select');

  function boardView(c, v) {
    const gp = groupProp(c, v);
    if (!gp) return h('div', { class: 'db-empty' }, t('db.needGroup'));
    const rows = rowsOf(c, v);
    const cols = [...gp.options.map((o) => ({ key: o.id, label: o.label, color: o.color })), { key: '', label: t('db.noValue'), color: '#9aa5b8' }];
    return h('div', { class: 'db-board' }, ...cols.map((col) => {
      const list = h('div', { class: 'db-col-list' }, ...rows.filter((r) => (r.cells[gp.id] || '') === col.key).map((r) => {
        const card = h('div', { class: 'db-card', draggable: c.locked ? null : 'true' }, titleInput(c, r), h('div', { class: 'db-chips' }, chips(c, v, r, gp.id)), c.locked ? null : h('button', { type: 'button', class: 'db-x', 'aria-label': t('db.delRow'), onclick: () => delRow(r.id) }, '×'));
        card.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', r.id); ev.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        return card;
      }));
      const colEl = h('div', { class: 'db-col' }, h('div', { class: 'db-col-head' }, h('span', { class: 'db-dot', style: `background:${safeColor(col.color, '#9aa5b8')}` }), col.label, h('span', { class: 'db-count' }, String(list.children.length))), list,
        c.locked ? null : h('button', { type: 'button', class: 'tb db-add', onclick: () => addRow(col.key ? { [gp.id]: col.key } : {}) }, t('db.new')));
      colEl.addEventListener('dragover', (ev) => { ev.preventDefault(); colEl.classList.add('over'); });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('over'));
      colEl.addEventListener('drop', (ev) => { ev.preventDefault(); colEl.classList.remove('over'); const rid = ev.dataTransfer.getData('text/plain'); if (rid) set((n) => { const r = n.rows.find((x) => x.id === rid); if (r) r.cells[gp.id] = col.key; return n; }, 'Move card'); });
      return colEl;
    }));
  }
  const galleryView = (c, v) => h('div', { class: 'db-gallery' }, ...rowsOf(c, v).map((r) => h('div', { class: 'db-gcard' }, titleInput(c, r), h('div', { class: 'db-chips' }, chips(c, v, r)), c.locked ? null : h('button', { type: 'button', class: 'db-x', 'aria-label': t('db.delRow'), onclick: () => delRow(r.id) }, '×'))),
    c.locked ? null : h('button', { type: 'button', class: 'db-gcard db-gadd', onclick: () => addRow() }, t('db.new')));
  const listView = (c, v) => h('div', { class: 'db-list' }, ...rowsOf(c, v).map((r) => h('div', { class: 'db-lrow' }, titleInput(c, r), h('div', { class: 'db-chips' }, chips(c, v, r)), c.locked ? null : h('button', { type: 'button', class: 'db-x', 'aria-label': 'Delete row', onclick: () => delRow(r.id) }, '×'))),
    c.locked ? null : h('button', { type: 'button', class: 'tb db-add', onclick: () => addRow() }, t('db.new')));

  function calendarView(c, v) {
    const dp = c.props.find((p) => p.id === v.dateProp && p.type === 'date') || c.props.find((p) => p.type === 'date');
    if (!dp) return h('div', { class: 'db-empty' }, t('db.needDate'));
    const y = month.getFullYear(), m = month.getMonth(); const first = new Date(y, m, 1); const lead = (first.getDay() + 6) % 7;      // weeks start on Monday
    const days = new Date(y, m + 1, 0).getDate(); const cells = Math.ceil((lead + days) / 7) * 7;
    const rows = rowsOf(c, v); const iso = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const grid = h('div', { class: 'db-cal' }, ...Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(getLang(), { weekday: 'short' })).map((d) => h('div', { class: 'db-cal-h' }, d)));
    for (let i = 0; i < cells; i++) {
      const d = i - lead + 1; const inMonth = d >= 1 && d <= days;
      const cell = h('div', { class: 'db-cal-c' + (inMonth ? '' : ' off') });
      if (inMonth) {
        cell.append(h('div', { class: 'db-cal-d' }, String(d), c.locked ? null : h('button', { type: 'button', class: 'db-cal-add', title: t('db.addDay'), onclick: () => addRow({ [dp.id]: iso(d) }) }, '+')));
        for (const r of rows.filter((x) => x.cells[dp.id] === iso(d))) cell.append(h('div', { class: 'db-cal-e' }, r.title || t('db.row')));
      }
      grid.append(cell);
    }
    const nav = h('div', { class: 'db-cal-nav' }, h('button', { type: 'button', class: 'tb', onclick: () => { month = new Date(y, m - 1, 1); render(); } }, '‹'), h('strong', {}, first.toLocaleDateString(getLang(), { month: 'long', year: 'numeric' })), h('button', { type: 'button', class: 'tb', onclick: () => { month = new Date(y, m + 1, 1); render(); } }, '›'),
      h('button', { type: 'button', class: 'tb', onclick: () => { month = new Date(); month.setDate(1); render(); } }, t('db.today')), h('span', { class: 'muted' }, t('db.by', { name: dp.name })));
    return h('div', {}, nav, grid);
  }

  function chartView(c, v) {
    const gp = groupProp(c, v);
    if (!gp) return h('div', { class: 'db-empty' }, t('db.needChart'));
    const rows = rowsOf(c, v); const groups = [...gp.options.map((o) => ({ label: o.label, color: o.color, n: rows.filter((r) => r.cells[gp.id] === o.id).length })), { label: t('db.noValue'), color: '#9aa5b8', none: true, n: rows.filter((r) => !r.cells[gp.id]).length }].filter((g) => g.n || !g.none);
    const max = Math.max(1, ...groups.map((g) => g.n));
    return h('div', { class: 'db-chart' }, h('div', { class: 'muted' }, t('db.chartSummary', { n: rows.length, name: gp.name })), ...groups.map((g) => h('div', { class: 'db-bar-row' }, h('span', { class: 'db-bar-l' }, g.label), h('span', { class: 'db-bar-track' }, h('span', { class: 'db-bar-fill', style: `width:${(g.n / max) * 100}%;background:${safeColor(g.color, '#9aa5b8')}` })), h('span', { class: 'db-bar-n' }, String(g.n)))));
  }

  // ---- chrome
  function filterPanel(c, v) {
    const p = h('div', { class: 'db-pop db-fpanel' });
    for (const [i, f] of v.filters.entries()) {
      const prop = c.props.find((x) => x.id === f.prop) || c.props[0];
      const ops = OPS[opKind(prop.type)].map(([k]) => [k, t('db.op.' + k)]);
      const valEl = NOVAL.has(f.op) ? null : prop.type === 'select' || prop.type === 'status' ? sel([['', '—'], ...prop.options.map((o) => [o.id, o.label])], f.val, (x) => setView((vv) => { vv.filters[i].val = x; }, 'Edit view filter')) : input(f.val ?? '', (x) => setView((vv) => { vv.filters[i].val = x; }, 'Edit view filter'), { type: prop.type === 'date' ? 'date' : prop.type === 'number' ? 'number' : 'text', placeholder: t('db.value') });
      p.append(h('div', { class: 'db-frow' },
        sel(c.props.map((x) => [x.id, x.name]), prop.id, (x) => setView((vv, n) => { const np = n.props.find((q) => q.id === x); vv.filters[i] = { prop: x, op: OPS[opKind(np.type)][0][0], val: '' }; }, 'Edit view filter')),
        sel(ops, ops.some((o) => o[0] === f.op) ? f.op : ops[0][0], (x) => setView((vv) => { vv.filters[i].op = x; }, 'Edit view filter')), valEl,
        h('button', { type: 'button', class: 'ib', 'aria-label': t('db.removeFilter'), onclick: () => setView((vv) => { vv.filters.splice(i, 1); }, 'Edit view filter') }, '×')));
    }
    p.append(h('button', { type: 'button', class: 'tb', disabled: !c.props.length, onclick: () => setView((vv, n) => { const pr = n.props[0]; vv.filters.push({ prop: pr.id, op: OPS[opKind(pr.type)][0][0], val: '' }); }, 'Edit view filter') }, t('db.addFilter')));
    return p;
  }
  function propsPanel(c, v) {
    const p = h('div', { class: 'db-pop db-fpanel' }, h('div', { class: 'muted' }, t('db.propsShown')));
    for (const pr of c.props) { const cb = h('input', { type: 'checkbox' }); cb.checked = !v.hidden.includes(pr.id); cb.addEventListener('change', () => setView((vv) => { vv.hidden = cb.checked ? vv.hidden.filter((x) => x !== pr.id) : [...vv.hidden, pr.id]; }, 'Edit view properties')); p.append(h('label', { class: 'db-check' }, cb, pr.name)); }
    return p;
  }
  function viewMenu(c, v) {
    const p = h('div', { class: 'db-pop db-fpanel' });
    p.append(h('label', {}, t('db.viewName'), input(v.name, (x) => setView((vv) => { vv.name = x.trim() || 'View'; }, 'Rename view'))), h('label', {}, t('db.layout'), sel(vtList(), v.type, (x) => setView((vv) => { vv.type = x; }, 'Change view layout'))),
      h('button', { type: 'button', class: 'tb', onclick: () => { menu = null; set((n) => { const nv = { ...structuredClone(activeOf(n)), id: uid() }; nv.name += ' ' + t('db.copy'); n.views.push(nv); n.activeView = nv.id; return n; }, t('db.dupView')); } }, t('db.dupView')),
      h('button', { type: 'button', class: 'tb danger', disabled: c.views.length < 2, onclick: () => { menu = null; set((n) => { n.views = n.views.filter((x) => x.id !== n.activeView); n.activeView = n.views[0].id; return n; }, t('db.delView')); } }, t('db.delView')));
    return p;
  }
  function addViewPanel() {
    const p = h('div', { class: 'db-pop db-fpanel db-addview' });
    for (const [k, l] of vtList()) p.append(h('button', { type: 'button', class: 'tb', onclick: () => { menu = null; set((n) => { const nv = newView(k, l, { groupBy: n.props.find((q) => q.type === 'status' || q.type === 'select')?.id || null }); n.views.push(nv); n.activeView = nv.id; return n; }, 'Add view'); } }, l));
    return p;
  }

  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([type === 'text/csv' ? '\uFEFF' + text : text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f || f.size > 4 * 1024 * 1024) return;
    const table = parseCsv(await f.text()); set((n) => { mergeCsv(n, table); return n; }, t('db.import'));
  });

  function render() {
    const c = get();
    if (!c) { dlg.close(); return; }
    const v = activeOf(c); locked = c.locked;
    head.replaceChildren(
      input(c.title, (val) => set((n) => { n.title = val.trim() || 'Untitled database'; return n; }, 'Rename database'), { class: 'db-name', 'aria-label': 'Database name', disabled: c.locked }),
      h('button', { type: 'button', class: 'tb' + (c.locked ? ' on' : ''), title: c.locked ? t('db.unlockTip') : t('db.lockTip'), onclick: () => set((n) => { n.locked = !n.locked; return n; }, 'Lock database') }, c.locked ? t('db.locked') : t('db.lock')),
      h('button', { type: 'button', class: 'tb', title: t('db.exportTip'), onclick: () => download((c.title || 'database').replace(/[^\w.-]+/g, '_') + '.csv', toCsv(c), 'text/csv') }, t('db.export')),
      h('button', { type: 'button', class: 'tb', title: t('db.importTip'), disabled: c.locked, onclick: () => file.click() }, t('db.import')),
      h('button', { type: 'button', class: 'ib', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'));
    views.replaceChildren(...c.views.map((x) => { const on = x.id === c.activeView; return h('button', { type: 'button', role: 'tab', class: 'db-tab' + (on ? ' on' : ''), 'aria-selected': on ? 'true' : 'false', 'data-pop': '', onclick: () => { if (on) { menu = menu === 'view' ? null : 'view'; render(); } else { menu = null; set((n) => { n.activeView = x.id; return n; }, 'Change view'); } } }, x.name, on ? h('span', { class: 'db-ty' }, ' ▾') : null); }),
      h('button', { type: 'button', class: 'db-tab', 'data-pop': '', title: t('db.addViewTip'), onclick: () => { menu = menu === 'add' ? null : 'add'; render(); } }, t('db.addView')));
    if (menu === 'view') views.append(viewMenu(c, v)); if (menu === 'add') views.append(addViewPanel());
    const f = h('input', { type: 'search', placeholder: t('db.find'), value: filterText, class: 'db-filter' });
    f.addEventListener('input', () => { filterText = f.value; const pos = f.selectionStart; render(); const nf = tools.querySelector('.db-filter'); nf.focus(); nf.setSelectionRange(pos, pos); });
    f.addEventListener('keydown', (ev) => ev.stopPropagation());
    const btn = (label, key, n) => h('button', { type: 'button', class: 'tb db-tbtn' + (n ? ' has' : ''), 'data-pop': '', onclick: () => { menu = menu === key ? null : key; render(); } }, label + (n ? ` · ${n}` : ''));
    const out = [f, btn(t('db.filter'), 'filter', v.filters.length), sel([['', t('db.sortNone')], ...c.props.map((p) => [p.id, t('db.sortBy', { name: p.name })]), ['__title', t('db.sortBy', { name: t('db.name') })]], v.sort?.prop || '', (x) => setView((vv) => { vv.sort = x ? { prop: x, dir: vv.sort?.dir || 'asc' } : null; }, 'Sort view'), { class: 'db-sort', 'aria-label': 'Sort by' }),
      h('button', { type: 'button', class: 'tb', title: t('db.reverse'), disabled: !v.sort, onclick: () => setView((vv) => { if (vv.sort) vv.sort.dir = vv.sort.dir === 'asc' ? 'desc' : 'asc'; }, 'Sort view') }, v.sort?.dir === 'desc' ? '↓' : '↑'), btn(t('db.props'), 'props', v.hidden.length ? `${c.props.length - v.hidden.length}/${c.props.length}` : 0)];
    if (v.type === 'board' || v.type === 'chart') out.push(sel(c.props.filter((p) => p.type === 'select' || p.type === 'status').map((p) => [p.id, t('db.groupBy', { name: p.name })]), v.groupBy || groupProp(c, v)?.id || '', (x) => setView((vv) => { vv.groupBy = x; }, 'Group view'), { class: 'db-sort', 'aria-label': 'Group by' }));
    if (v.type === 'calendar') out.push(sel(c.props.filter((p) => p.type === 'date').map((p) => [p.id, t('db.dateBy', { name: p.name })]), v.dateProp || c.props.find((p) => p.type === 'date')?.id || '', (x) => setView((vv) => { vv.dateProp = x; }, 'Calendar date')));
    tools.replaceChildren(...out);
    if (menu === 'filter') tools.append(filterPanel(c, v)); if (menu === 'props') tools.append(propsPanel(c, v));
    const R = { board: boardView, gallery: galleryView, list: listView, calendar: calendarView, chart: chartView }[v.type] || tableView;
    body.replaceChildren(R(c, v));
  }

  render(); dlg.showModal();
  return dlg;
}
