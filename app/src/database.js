// Databases: a card that holds typed rows and can be shown as a table, a board (grouped by a select/status property)
// or a gallery. The canvas card is a small preview; "Open" shows the full editor in a dialog.
import { uid } from './store.js';

export const PROP_TYPES = [['text', 'Text'], ['select', 'Select'], ['status', 'Status'], ['date', 'Date'], ['checkbox', 'Checkbox'], ['number', 'Number'], ['url', 'Link']];
export const VIEWS = [['table', 'Table'], ['board', 'Board'], ['gallery', 'Gallery']];
const OPT_COLORS = ['#9aa5b8', '#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7', '#7dcfff', '#ff9e64'];

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
export function defaultDatabaseContent() {
  const status = { id: uid(), name: 'Status', type: 'status', options: ['To do', 'Doing', 'Done'].map(opt) };
  const date = { id: uid(), name: 'Due', type: 'date', options: [] };
  const tag = { id: uid(), name: 'Tag', type: 'select', options: ['Idea', 'Research'].map((l, i) => opt(l, i + 3)) };
  const row = (title, st, tg) => ({ id: uid(), title, cells: { [status.id]: status.options[st].id, [tag.id]: tg == null ? '' : tag.options[tg].id } });
  return { title: 'Untitled database', view: 'table', groupBy: status.id, sort: null, props: [status, date, tag], rows: [row('First item', 0, 0), row('Second item', 1, null), row('Third item', 2, 1)] };
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
  const open = h('button', { class: 'db-open', type: 'button', 'data-nodrag': '', title: 'Open this database' }, 'Open');
  open.addEventListener('click', (ev) => { ev.stopPropagation(); view.onOpenDatabase?.(e.id); });
  const body = h('div', { class: 'db-prev' });
  rec.node.append(h('div', { class: 'db-head' }, title, badge, open), body);
  rec.node.addEventListener('dblclick', (ev) => { if (ev.target.closest('[data-nodrag]')) return; view.onOpenDatabase?.(e.id); });
  rec.update = (el) => {
    const c = el.content; title.textContent = c.title || 'Untitled database';
    badge.textContent = `${(c.rows || []).length} · ${VIEWS.find((v) => v[0] === c.view)?.[1] || 'Table'}`;
    const status = c.props.find((p) => p.id === c.groupBy) || c.props.find((p) => p.type === 'status' || p.type === 'select');
    body.replaceChildren(...(c.rows || []).slice(0, 6).map((r) => {
      const t = status ? cellText(status, r.cells[status.id]) : '';
      const o = status ? optOf(status, r.cells[status.id]) : null;
      return h('div', { class: 'db-prev-row' }, h('span', { class: 'db-prev-t' }, r.title || 'Untitled'), t ? h('span', { class: 'db-chip', style: `--c:${o?.color || '#9aa5b8'}` }, t) : null);
    }), (c.rows || []).length > 6 ? h('div', { class: 'db-more' }, `+${c.rows.length - 6} more`) : null);
  };
}

/** full editor dialog; re-renders whenever the element changes (including remote edits and undo) */
export function openDatabase(store, id) {
  const dlg = h('dialog', { class: 'db-dlg' });
  document.body.append(dlg);
  const get = () => store.live(id);
  const set = (fn, label, merge) => {
    const cur = get(); if (!cur) return;
    store.commit([{ id, after: { ...cur, content: fn(structuredClone(cur.content)) } }], { label, merge });
    render();
  };
  let filter = '', menuFor = null;

  const head = h('header', { class: 'db-bar' });
  const tools = h('div', { class: 'db-tools' });
  const body = h('div', { class: 'db-body' });
  dlg.append(head, tools, body);

  const unsub = store.subscribe((info) => { if (info.local) return; if (dlg.open && !dlg.contains(document.activeElement)) render(); else if (dlg.open) deferred = true; });
  let deferred = false;
  dlg.addEventListener('focusout', () => setTimeout(() => { if (deferred && dlg.open && !dlg.contains(document.activeElement)) { deferred = false; render(); } }));
  dlg.addEventListener('close', () => { unsub(); dlg.remove(); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });

  const input = (value, onCommit, attrs = {}) => {
    const i = h('input', { value, autocomplete: 'off', spellcheck: 'false', ...attrs });
    i.addEventListener('change', () => onCommit(i.value));
    i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') i.blur(); ev.stopPropagation(); });
    return i;
  };

  function cellEditor(c, row, prop) {
    const v = row.cells[prop.id];
    const put = (val) => set((n) => { const r = n.rows.find((x) => x.id === row.id); if (r) r.cells[prop.id] = val; return n; }, 'Edit database', 'db' + id + row.id + prop.id);
    if (prop.type === 'checkbox') { const i = h('input', { type: 'checkbox' }); i.checked = !!v; i.addEventListener('change', () => put(i.checked)); return i; }
    if (prop.type === 'select' || prop.type === 'status') {
      const s = h('select', { class: 'db-sel' }, h('option', { value: '' }, '—'), ...prop.options.map((o) => h('option', { value: o.id }, o.label)));
      s.value = v || ''; s.style.setProperty('--c', optOf(prop, v)?.color || 'transparent'); s.addEventListener('change', () => put(s.value)); return s;
    }
    if (prop.type === 'date') { const i = h('input', { type: 'date', value: v || '' }); i.addEventListener('change', () => put(i.value)); return i; }
    if (prop.type === 'number') return input(v ?? '', (x) => put(x === '' ? '' : Number(x)), { type: 'number', step: 'any' });
    return input(v ?? '', put, { type: prop.type === 'url' ? 'url' : 'text', placeholder: prop.type === 'url' ? 'https://…' : '' });
  }

  function rowsOf(c) {
    let rows = c.rows.slice();
    const q = filter.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.title + ' ' + c.props.map((p) => cellText(p, r.cells[p.id])).join(' ')).toLowerCase().includes(q));
    if (c.sort) {
      const p = c.props.find((x) => x.id === c.sort.prop);
      const key = (r) => (p ? (p.type === 'select' || p.type === 'status' ? p.options.findIndex((o) => o.id === r.cells[p.id]) : r.cells[p.id] ?? '') : r.title);
      rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (c.sort.dir === 'desc' ? -1 : 1); });
    }
    return rows;
  }

  const addRow = (extra = {}) => set((n) => { n.rows.push({ id: uid(), title: '', cells: { ...extra } }); return n; }, 'Add row');
  const delRow = (rid) => set((n) => { n.rows = n.rows.filter((r) => r.id !== rid); return n; }, 'Delete row');

  function propMenu(c, prop, anchor) {
    const m = h('div', { class: 'db-pmenu' });
    const name = input(prop.name, (v) => set((n) => { n.props.find((p) => p.id === prop.id).name = v.trim() || 'Property'; return n; }, 'Rename property'));
    const type = h('select', {}, ...PROP_TYPES.map(([k, l]) => h('option', { value: k }, l))); type.value = prop.type;
    type.addEventListener('change', () => set((n) => { const p = n.props.find((x) => x.id === prop.id); p.type = type.value; if ((type.value === 'select' || type.value === 'status') && !p.options.length) p.options = ['One', 'Two', 'Three'].map(opt); return n; }, 'Change property type'));
    m.append(h('label', {}, 'Name', name), h('label', {}, 'Type', type));
    if (prop.type === 'select' || prop.type === 'status') {
      const opts = input(prop.options.map((o) => o.label).join(', '), (v) => set((n) => {
        const p = n.props.find((x) => x.id === prop.id); const labels = v.split(',').map((s) => s.trim()).filter(Boolean);
        p.options = labels.map((l, i) => p.options.find((o) => o.label === l) || opt(l, i)); return n;
      }, 'Edit options'));
      m.append(h('label', {}, 'Options (comma separated)', opts));
    }
    m.append(h('button', { type: 'button', class: 'tb danger', onclick: () => { menuFor = null; set((n) => { n.props = n.props.filter((p) => p.id !== prop.id); if (n.groupBy === prop.id) n.groupBy = null; return n; }, 'Delete property'); } }, 'Delete property'));
    return m;
  }

  function tableView(c) {
    const t = h('table', { class: 'db-tbl' });
    const trh = h('tr', {}, h('th', { class: 'db-th-title' }, 'Name'), ...c.props.map((p) => {
      const th = h('th', {}, h('button', { type: 'button', class: 'db-th', title: 'Edit property', onclick: () => { menuFor = menuFor === p.id ? null : p.id; render(); } }, p.name, h('span', { class: 'db-ty' }, p.type)));
      if (menuFor === p.id) th.append(propMenu(c, p));
      return th;
    }), h('th', { class: 'db-th-add' }, h('button', { type: 'button', class: 'db-th', title: 'Add a property', onclick: () => set((n) => { n.props.push({ id: uid(), name: 'Property ' + (n.props.length + 1), type: 'text', options: [] }); return n; }, 'Add property') }, '+')));
    t.append(h('thead', {}, trh));
    t.append(h('tbody', {}, ...rowsOf(c).map((r) => h('tr', {},
      h('td', { class: 'db-td-title' }, input(r.title, (v) => set((n) => { n.rows.find((x) => x.id === r.id).title = v; return n; }, 'Edit row', 'dbt' + id + r.id), { placeholder: 'Untitled' })),
      ...c.props.map((p) => h('td', {}, cellEditor(c, r, p))),
      h('td', { class: 'db-td-x' }, h('button', { type: 'button', class: 'ib', 'aria-label': 'Delete row', title: 'Delete row', onclick: () => delRow(r.id) }, '×'))))));
    return h('div', { class: 'db-scroll' }, t, h('button', { type: 'button', class: 'tb db-add', onclick: () => addRow() }, '+ New row'));
  }

  function cardBits(c, r, skip) {
    return c.props.filter((p) => p.id !== skip).map((p) => { const tx = cellText(p, r.cells[p.id]); if (!tx) return null; const o = optOf(p, r.cells[p.id]); return h('span', { class: 'db-chip', style: `--c:${o?.color || '#9aa5b8'}`, title: p.name }, tx); });
  }

  function boardView(c) {
    const gp = c.props.find((p) => p.id === c.groupBy && (p.type === 'select' || p.type === 'status')) || c.props.find((p) => p.type === 'status' || p.type === 'select');
    if (!gp) return h('div', { class: 'db-empty' }, 'Add a Select or Status property to group cards into columns.');
    const rows = rowsOf(c);
    const cols = [...gp.options.map((o) => ({ key: o.id, label: o.label, color: o.color })), { key: '', label: 'No value', color: '#9aa5b8' }];
    return h('div', { class: 'db-board' }, ...cols.map((col) => {
      const list = h('div', { class: 'db-col-list' }, ...rows.filter((r) => (r.cells[gp.id] || '') === col.key).map((r) => {
        const card = h('div', { class: 'db-card', draggable: 'true' }, input(r.title, (v) => set((n) => { n.rows.find((x) => x.id === r.id).title = v; return n; }, 'Edit row', 'dbt' + id + r.id), { placeholder: 'Untitled' }), h('div', { class: 'db-chips' }, cardBits(c, r, gp.id)), h('button', { type: 'button', class: 'db-x', 'aria-label': 'Delete card', onclick: () => delRow(r.id) }, '×'));
        card.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', r.id); ev.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        return card;
      }));
      const colEl = h('div', { class: 'db-col' }, h('div', { class: 'db-col-head' }, h('span', { class: 'db-dot', style: `background:${col.color}` }), col.label, h('span', { class: 'db-count' }, String(list.children.length))), list,
        h('button', { type: 'button', class: 'tb db-add', onclick: () => addRow(col.key ? { [gp.id]: col.key } : {}) }, '+ New'));
      colEl.addEventListener('dragover', (ev) => { ev.preventDefault(); colEl.classList.add('over'); });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('over'));
      colEl.addEventListener('drop', (ev) => { ev.preventDefault(); colEl.classList.remove('over'); const rid = ev.dataTransfer.getData('text/plain'); if (rid) set((n) => { const r = n.rows.find((x) => x.id === rid); if (r) r.cells[gp.id] = col.key; return n; }, 'Move card'); });
      return colEl;
    }));
  }

  function galleryView(c) {
    return h('div', { class: 'db-gallery' }, ...rowsOf(c).map((r) => h('div', { class: 'db-gcard' }, input(r.title, (v) => set((n) => { n.rows.find((x) => x.id === r.id).title = v; return n; }, 'Edit row', 'dbt' + id + r.id), { placeholder: 'Untitled' }), h('div', { class: 'db-chips' }, cardBits(c, r)), h('button', { type: 'button', class: 'db-x', 'aria-label': 'Delete card', onclick: () => delRow(r.id) }, '×'))),
      h('button', { type: 'button', class: 'db-gcard db-gadd', onclick: () => addRow() }, '+ New'));
  }

  function render() {
    const cur = get();
    if (!cur) { dlg.close(); return; }
    const c = cur.content;
    head.replaceChildren(
      input(c.title, (v) => set((n) => { n.title = v.trim() || 'Untitled database'; return n; }, 'Rename database'), { class: 'db-name', 'aria-label': 'Database name' }),
      h('div', { class: 'db-tabs', role: 'tablist' }, ...VIEWS.map(([k, l]) => h('button', { type: 'button', role: 'tab', class: 'db-tab' + (c.view === k ? ' on' : ''), 'aria-selected': c.view === k ? 'true' : 'false', onclick: () => set((n) => { n.view = k; return n; }, 'Change view') }, l))),
      h('button', { type: 'button', class: 'ib', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'));
    const f = h('input', { type: 'search', placeholder: 'Filter rows…', value: filter, class: 'db-filter' });
    f.addEventListener('input', () => { filter = f.value; const pos = f.selectionStart; render(); const nf = tools.querySelector('.db-filter'); nf.focus(); nf.setSelectionRange(pos, pos); });
    f.addEventListener('keydown', (ev) => ev.stopPropagation());
    const sortSel = h('select', { class: 'db-sort', 'aria-label': 'Sort by' }, h('option', { value: '' }, 'Sort: none'), ...c.props.map((p) => h('option', { value: p.id }, 'Sort: ' + p.name)));
    sortSel.value = c.sort?.prop || '';
    sortSel.addEventListener('change', () => set((n) => { n.sort = sortSel.value ? { prop: sortSel.value, dir: n.sort?.dir || 'asc' } : null; return n; }, 'Sort'));
    const dir = h('button', { type: 'button', class: 'tb', title: 'Reverse the sort order', disabled: !c.sort, onclick: () => set((n) => { if (n.sort) n.sort.dir = n.sort.dir === 'asc' ? 'desc' : 'asc'; return n; }, 'Sort') }, c.sort?.dir === 'desc' ? '↓' : '↑');
    const out = [f, sortSel, dir];
    if (c.view === 'board') {
      const g = h('select', { class: 'db-sort', 'aria-label': 'Group by' }, ...c.props.filter((p) => p.type === 'select' || p.type === 'status').map((p) => h('option', { value: p.id }, 'Group: ' + p.name)));
      g.value = c.groupBy || ''; g.addEventListener('change', () => set((n) => { n.groupBy = g.value; return n; }, 'Group by')); out.push(g);
    }
    tools.replaceChildren(...out);
    body.replaceChildren(c.view === 'board' ? boardView(c) : c.view === 'gallery' ? galleryView(c) : tableView(c));
  }

  render(); dlg.showModal();
  return dlg;
}
