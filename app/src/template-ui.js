// Template picker (built-in library + "My templates") and "save this board as a template".
// "My templates" belong to the signed-in account (Supabase `templates` table); guests keep them on this device.
import { BUILTIN_TEMPLATES, CATEGORIES, instantiate, freeSpot, boardToFlat, flatToNodes, thumbSVG } from './templates.js';
import { makeElement } from './model.js';
import { uid, idbGet, idbSet } from './store.js';
import { t as tr, onLangChange } from './i18n.js';

const ICONS = { Planning: '📅', Briefs: '📝', Moodboards: '🎨', Storyboards: '🎬', Brainstorming: '💡', Writing: '✍️', 'Product & UX': '🧩', Marketing: '📣', Education: '🎓', Personal: '🏡', Mine: '⭐' };
const TINTS = { Planning: '#7aa2f7', Briefs: '#e0af68', Moodboards: '#f7768e', Storyboards: '#bb9af7', Brainstorming: '#9ece6a', Writing: '#7dcfff', 'Product & UX': '#ff9e64', Marketing: '#f7768e', Education: '#9ece6a', Personal: '#e0af68', Mine: '#e0af68' };
const MAX_BYTES = 4 * 1024 * 1024;

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};

/** account-bound (or device-local) user templates, with an offline cache */
export class MyTemplates {
  constructor(backend, userKey) { this.backend = backend; this.key = 'templates:' + userKey; }
  async cached() { return (await idbGet(this.key)) || []; }
  async list() {
    if (!this.backend) return this.cached();
    try { const rows = await this.backend.listTemplates(); await idbSet(this.key, rows); return rows; } catch { return this.cached(); }
  }
  async save(name, store, boardId) {
    const flat = boardToFlat(store, boardId);
    if (JSON.stringify(flat).length > MAX_BYTES) throw new Error(tr('tpl.tooLarge'));
    const row = { id: uid(), name, root_id: boardId, elements: flat, created_at: new Date().toISOString() };
    if (this.backend) row.id = await this.backend.saveTemplate(name, boardId, flat);
    await idbSet(this.key, [row, ...(await this.cached())]);
    return row;
  }
  async remove(id) {
    if (this.backend) await this.backend.deleteTemplate(id);
    await idbSet(this.key, (await this.cached()).filter((t) => t.id !== id));
  }
}

export function setupTemplates({ store, view, backend, user, toast }) {
  const mine = new MyTemplates(backend, user ? user.id : 'local');
  const dlg = document.querySelector('#dlg-templates'), grid = document.querySelector('#tpl-grid'), cats = document.querySelector('#tpl-cats'),
    search = document.querySelector('#tpl-search'), foot = document.querySelector('#tpl-foot'), title = document.querySelector('#tpl-title');
  const state = { cat: 'All', q: '', selected: null, mine: [] };
  const nodesOf = (t) => (t.nodes ||= flatToNodes(t.elements, t.root_id));
  const thumbs = new Map();
  const thumbOf = (t) => { if (!thumbs.has(t.id)) thumbs.set(t.id, thumbSVG(nodesOf(t))); return thumbs.get(t.id); };

  const catLabel = (c) => (c === 'Mine' ? tr('tpl.mine') : c === 'All' ? tr('tpl.all') : tr('cat.' + c));
  const all = () => [...state.mine.map((t) => ({ ...t, category: 'Mine', description: backend ? tr('tpl.mineAccount') : tr('tpl.mineDevice'), mine: true })), ...BUILTIN_TEMPLATES];
  const visible = () => {
    const q = state.q.trim().toLowerCase();
    return all().filter((t) => (state.cat === 'All' || state.cat === t.category) && (!q || (t.name + ' ' + catLabel(t.category) + ' ' + t.description).toLowerCase().includes(q)));
  };

  function renderCats() {
    const items = [['All', tr('tpl.all')], ['Mine', tr('tpl.mine')], ...CATEGORIES.map((c) => [c, tr('cat.' + c)])];
    cats.replaceChildren(...items.map(([id, label]) => {
      const n = id === 'All' ? all().length : all().filter((t) => t.category === id).length;
      return h('button', { class: 'tpl-cat' + (state.cat === id ? ' on' : ''), type: 'button', onclick: () => { state.cat = id; state.selected = null; render(); } }, h('span', { class: 'ic' }, ICONS[id] || '▦'), h('span', { class: 'lb' }, label), h('span', { class: 'ct' }, String(n)));
    }));
  }
  function renderGrid() {
    const list = visible();
    title.textContent = catLabel(state.cat);
    grid.replaceChildren();
    if (!list.length) {
      grid.append(h('div', { class: 'tpl-empty' }, state.cat === 'Mine' && !state.q
        ? [h('p', {}, tr('tpl.noneSaved')), h('p', { class: 'muted' }, tr('tpl.noneSavedHint') + (backend ? tr('tpl.hintAccount') : tr('tpl.hintDevice')))]
        : h('p', {}, tr('tpl.noMatch'))));
      return;
    }
    for (const t of list) {
      const card = h('div', { class: 'tpl-card' + (state.selected?.id === t.id ? ' on' : ''), tabindex: '0', role: 'button', 'aria-label': t.name, onclick: () => { state.selected = t; renderGrid(); renderFoot(); }, ondblclick: () => addHere(t),
        onkeydown: (e) => { if (e.key === 'Enter') addHere(t); } },
      h('div', { class: 'tpl-thumb' }), h('div', { class: 'tpl-name' }, t.name), h('div', { class: 'tpl-desc' }, t.description));
      card.firstChild.innerHTML = thumbOf(t);
      grid.append(card);
    }
  }
  function renderFoot() {
    const t = state.selected; foot.replaceChildren();
    if (!t) { foot.append(h('span', { class: 'muted' }, tr('tpl.pick'))); return; }
    foot.append(h('div', { class: 'tpl-sel' }, h('strong', {}, t.name), h('span', { class: 'muted' }, t.description)),
      h('div', { class: 'tpl-actions' },
        t.mine ? h('button', { class: 'tb danger', type: 'button', onclick: () => removeMine(t) }, tr('tpl.delete')) : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => asNewBoard(t) }, tr('tpl.asBoard')),
        h('button', { class: 'btn primary', type: 'button', onclick: () => addHere(t) }, tr('tpl.addHere'))));
  }
  function render() { renderCats(); renderGrid(); renderFoot(); }

  // ---------------------------------------------------------------- use a template
  function addHere(t) {
    const spot = freeSpot(store, view.boardId);
    const changes = instantiate(store, nodesOf(t), view.boardId, spot);
    store.commit(changes, { label: `Template: ${t.name}` });
    dlg.close();
    view.tx = 60 - spot.dx * view.scale; view.ty = 60 - spot.dy * view.scale; view.applyTransform(); view.onZoom?.();
    toast(tr('tpl.added', { name: t.name }), () => store.undo());
  }
  function asNewBoard(t) {
    const spot = freeSpot(store, view.boardId);
    const b = makeElement('board', view.boardId, { x: spot.dx, y: spot.dy, z: store.maxZ(view.boardId) + 1, w: 96, content: { title: t.name, icon: ICONS[t.category] || '📁', tint: TINTS[t.category] || '#7aa2f7' } });
    store.commit([{ id: b.id, after: b }, ...instantiate(store, nodesOf(t), b.id, { dx: 0, dy: 0 })], { label: `New board: ${t.name}` });
    dlg.close(); view.onOpen?.(b.id);
  }
  async function removeMine(t) {
    if (!confirm(tr('tpl.confirmDelete', { name: t.name }))) return;
    try { await mine.remove(t.id); state.mine = state.mine.filter((x) => x.id !== t.id); state.selected = null; render(); toast(tr('tpl.deleted')); } catch (e) { toast(tr('tpl.deleteFail', { err: e.message })); }
  }

  async function open(category) {
    state.cat = category || 'All'; state.q = ''; search.value = ''; state.selected = null; render(); if (!dlg.open) dlg.showModal();
    state.mine = await mine.list(); render();
  }
  search.addEventListener('input', () => { state.q = search.value; state.selected = null; renderGrid(); renderFoot(); });
  document.querySelector('#tpl-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  // ---------------------------------------------------------------- save the current board
  const saveDlg = document.querySelector('#dlg-savetpl'), nameIn = document.querySelector('#savetpl-name'), saveMsg = document.querySelector('#savetpl-msg');
  function saveCurrent() {
    const b = store.live(view.boardId); if (!b) return;
    if (!store.children(b.id).length) return toast(tr('tpl.emptyBoard'));
    nameIn.value = b.content.title && b.id !== store.rootId ? b.content.title : ''; saveMsg.hidden = true; saveDlg.showModal(); nameIn.focus(); nameIn.select();
  }
  document.querySelector('#savetpl-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const name = nameIn.value.trim(); if (!name) return;
    const go = document.querySelector('#savetpl-go'); go.disabled = true;
    try {
      const row = await mine.save(name, store, view.boardId); state.mine = [row, ...state.mine]; saveDlg.close();
      toast(backend ? tr('tpl.savedAccount', { name }) : tr('tpl.savedDevice', { name }), () => open('Mine'), tr('tpl.view'), 7000);
    } catch (err) { saveMsg.textContent = err.message || String(err); saveMsg.hidden = false; saveMsg.dataset.kind = 'error'; } finally { go.disabled = false; }
  });
  document.querySelector('#savetpl-cancel').onclick = () => saveDlg.close();

  onLangChange(() => { if (dlg.open) render(); });      // re-label the open picker in the new language
  return { open, saveCurrent };
}
