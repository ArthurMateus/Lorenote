// Board view: incremental DOM rendering of elements, connector lines, selection and the context bar.
import { icon } from './icons.js';
import { t, getLang } from './i18n.js';
import * as layout from './layout.js';
import { applyTheme } from './theme.js';
import { buildPreview } from './database.js';
import { attachSlash } from './slash.js';
import { noteWords } from './writer.js';
import { COLORS, BOARD_COLORS, BOARD_ICONS, TYPE_LABEL, isContainer, makeElement, sanitizeHtml, hostOf, normalizeUrl, safeWebUrl } from './model.js';

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const svgNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

const RESIZABLE = new Set(['note', 'link', 'todo', 'column', 'comment', 'table', 'database', 'image', 'file', 'sketch']);
const SKETCH_VW = 300;

export class View {
  constructor(store, dom) {
    this.store = store; this.dom = dom; this.layout = layout;
    this.boardId = store.rootId;
    this.selection = new Set();
    this.nodes = new Map();           // id -> rec {node, body, update, el}
    this.tx = 40; this.ty = 40; this.scale = 1;
    this.drawing = null;              // sketch id in draw mode
    this.pen = { color: '#1f2430', w: 3 };
    this.dragging = false;
    this.pending = false;
    store.subscribe((info) => { if (!this.dragging) this.schedule(); else this.dirty = true; if (info.reset) { this.boardId = store.rootId; this.selection.clear(); } });
  }

  schedule() { if (this.pending) return; this.pending = true; requestAnimationFrame(() => { this.pending = false; this.render(); }); }

  get board() { return this.store.live(this.boardId) || this.store.get(this.store.rootId); }

  setBoard(id) {
    if (!this.store.live(id)) id = this.store.rootId;
    if (this.boardId !== id) { this.boardId = id; this.selection.clear(); this.drawing = null; this.tx = 40; this.ty = 40; this.scale = 1; }
    this.render();
  }

  applyTransform() {
    const { world, viewport } = this.dom;
    world.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    const g = 24 * this.scale;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${this.tx}px ${this.ty}px`;
    this.updateLines(); this.updateContextBar(); this.onViewChange?.();
  }

  /** screen -> world coordinates */
  toWorld(cx, cy) { const r = this.dom.viewport.getBoundingClientRect(); return { x: (cx - r.left - this.tx) / this.scale, y: (cy - r.top - this.ty) / this.scale }; }
  /** world rect of an element's node */
  worldRect(id) {
    const rec = this.nodes.get(id); if (!rec) return null;
    const r = rec.node.getBoundingClientRect();
    const a = this.toWorld(r.left, r.top), b = this.toWorld(r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }


  // ---------------------------------------------------------------- camera
  /** smoothly move the camera to {tx, ty, scale} */
  animateTo(t, ms = 450) {
    cancelAnimationFrame(this._anim); const from = { tx: this.tx, ty: this.ty, scale: this.scale }; const t0 = performance.now();
    if (!ms || matchMedia('(prefers-reduced-motion: reduce)').matches) { Object.assign(this, { tx: t.tx, ty: t.ty, scale: t.scale }); this.applyTransform(); this.onZoom?.(); return; }
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms), k = ease(p);
      this.tx = from.tx + (t.tx - from.tx) * k; this.ty = from.ty + (t.ty - from.ty) * k; this.scale = from.scale + (t.scale - from.scale) * k; this.applyTransform();
      if (p < 1) this._anim = requestAnimationFrame(step); else this.onZoom?.();
    };
    this._anim = requestAnimationFrame(step);
  }
  stopAnimation() { cancelAnimationFrame(this._anim); }
  /** fit a world rect {x,y,w,h} into the viewport */
  fitRect(r, { pad = 60, maxScale = 1.5, animate = false } = {}) {
    const vp = this.dom.viewport.getBoundingClientRect(); const s = Math.max(0.1, Math.min(maxScale, (vp.width - pad * 2) / Math.max(1, r.w), (vp.height - pad * 2) / Math.max(1, r.h)));
    const t = { scale: s, tx: vp.width / 2 - (r.x + r.w / 2) * s, ty: vp.height / 2 - (r.y + r.h / 2) * s };
    if (animate) this.animateTo(t); else { Object.assign(this, t); this.applyTransform(); this.onZoom?.(); }
  }
  /** fit everything on the board */
  fitAll(opts = {}) {
    const rects = [];
    for (const e of this.store.children(this.boardId, 'canvas')) {
      if (e.type === 'line') { const b = this.lineBounds(e); const a = this.toWorld(b.left, b.top), z = this.toWorld(b.right, b.bottom); rects.push({ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }); } else { const r = this.worldRect(e.id); if (r) rects.push(r); }
    }
    if (!rects.length) return this.animateTo({ tx: 40, ty: 40, scale: 1 }, opts.animate ? 350 : 0);
    const x1 = Math.min(...rects.map((r) => r.x)), y1 = Math.min(...rects.map((r) => r.y)), x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.h));
    this.fitRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, { pad: 90, maxScale: 1.25, ...opts });
  }

  // ---------------------------------------------------------------- render
  render() {
    const store = this.store; const board = this.board;
    if (!board) return;
    if (board.id !== this.boardId) this.boardId = board.id;
    if (document.documentElement.dataset.theme !== store.prefs.theme) applyTheme(store.prefs.theme);
    this.dom.viewport.classList.toggle('grid', store.prefs.grid);
    const seen = new Set();
    const place = (parentId, host, section) => {
      let i = 0;
      for (const e of store.children(parentId, section)) {
        if (e.type === 'line') continue;
        const rec = this.ensure(e); if (!rec) continue; seen.add(e.id);
        if (host.children[i] !== rec.node) host.insertBefore(rec.node, host.children[i] || null);
        i++;
        if (isContainer(e.type) && rec.body) { place(e.id, rec.body, 'stack'); rec.count?.(); }
      }
    };
    place(board.id, this.dom.canvas, 'canvas');
    for (const [id, rec] of this.nodes) {
      if (!seen.has(id)) { if (!this.dom.dragLayer.contains(rec.node)) rec.node.remove(); this.nodes.delete(id); }
    }
    for (const id of [...this.selection]) if (!store.live(id)) this.selection.delete(id);
    this.updateSelectionClasses();
    try { this.updateLines(); } catch (err) { console.warn('Skipped connectors that could not be drawn', err); }
    this.updateContextBar();
    this.dom.empty.hidden = store.children(board.id, 'canvas').length > 0;
    this.onRendered?.();
  }

  ensure(e) {
    try {
      let rec = this.nodes.get(e.id);
      if (!rec) { rec = this.build(e); this.nodes.set(e.id, rec); }
      if (rec.el !== e) { this.frame(rec, e); rec.update(e); rec.el = e; }
      return rec;
    } catch (err) {
      // data from an import, an older version or another device can be malformed: skip that card, keep the board usable
      this.nodes.delete(e.id); if (!this.warned) this.warned = new Set();
      if (!this.warned.has(e.id)) { this.warned.add(e.id); console.warn('Skipped a card that could not be drawn:', e.type, err); }
      return null;
    }
  }

  frame(rec, e) {
    const n = rec.node;
    n.style.width = e.w ? e.w + 'px' : '';
    if (e.section === 'canvas') { n.style.left = e.x + 'px'; n.style.top = e.y + 'px'; n.style.zIndex = String(e.z || 0); n.classList.remove('stacked'); }
    else { n.style.left = n.style.top = n.style.zIndex = ''; n.classList.add('stacked'); n.style.width = ''; }
    n.style.setProperty('--card-bg', e.color || ''); n.classList.toggle('locked', !!e.locked);
    n.classList.toggle('tinted', !!e.color);
  }

  build(e) {
    const node = h('div', { class: `card t-${e.type}`, 'data-id': e.id });
    const rec = { node, el: null, body: null, update() {} };
    const builder = BUILDERS[e.type];
    builder(rec, e, this);
    if (RESIZABLE.has(e.type)) node.append(h('div', { class: 'rz', 'data-nodrag': '', title: t('card.resize') }));
    return rec;
  }

  // ---------------------------------------------------------------- selection
  select(ids, add = false) {
    if (!add) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.updateSelectionClasses(); this.updateLines(); this.updateContextBar();
    this.onSelection?.();
  }
  toggle(id) { if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); this.updateSelectionClasses(); this.updateLines(); this.updateContextBar(); this.onSelection?.(); }
  clearSelection() { if (!this.selection.size && !this.drawing) return; this.selection.clear(); this.drawing = null; this.updateSelectionClasses(); this.updateLines(); this.updateContextBar(); this.onSelection?.(); }
  updateSelectionClasses() {
    for (const [id, rec] of this.nodes) { rec.node.classList.toggle('sel', this.selection.has(id)); rec.node.classList.toggle('drawing', this.drawing === id); }
  }

  /** focus the first editable field of an element */
  focusEdit(id) {
    const rec = this.nodes.get(id); if (!rec) return;
    const t = rec.node.querySelector('[data-edit]');
    if (!t) return;
    if (t.isContentEditable !== undefined && t.hasAttribute('data-edit') && t.tagName !== 'INPUT') t.setAttribute('contenteditable', t.dataset.edit || 'true');
    t.focus();
    if (t.tagName !== 'INPUT') { const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } else t.select?.();
  }

  // ---------------------------------------------------------------- lines
  linePoint(line, end) {
    const c = line.content; const own = end === 'a' ? c.a : c.b; const otherPt = end === 'a' ? c.b : c.a;
    const id = end === 'a' ? c.aId : c.bId; const otherId = end === 'a' ? c.bId : c.aId;
    const rect = id && this.worldRect(id);
    if (!rect) return own;
    const orect = otherId && this.worldRect(otherId);
    const toward = orect ? { x: orect.x + orect.w / 2, y: orect.y + orect.h / 2 } : otherPt;
    return edgePoint(rect, toward);
  }

  updateLines() {
    const svg = this.dom.svg; svg.replaceChildren();
    const store = this.store;
    const marker = s('defs'); svg.append(marker);
    for (const stored of store.children(this.boardId, 'canvas').filter((e) => e.type === 'line')) {
      const ov = this.lineDrag?.get(stored.id); const line = ov ? { ...stored, content: ov } : stored;
      const a = this.linePoint(line, 'a'), b = this.linePoint(line, 'b');
      const c = line.content; const sel = this.selection.has(line.id);
      const col = line.color || 'var(--ink)';
      const g = s('g', { class: 'line' + (sel ? ' sel' : ''), 'data-id': line.id });
      g.append(s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hit' }));
      g.append(s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: col, 'stroke-width': c.weight, 'stroke-dasharray': c.dashed ? '8 6' : 'none', 'stroke-linecap': 'round', class: 'vis' }));
      if (c.arrow) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 8 + c.weight * 2;
        const p1 = { x: b.x - L * Math.cos(ang - 0.45), y: b.y - L * Math.sin(ang - 0.45) };
        const p2 = { x: b.x - L * Math.cos(ang + 0.45), y: b.y - L * Math.sin(ang + 0.45) };
        g.append(s('polygon', { points: `${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`, fill: col, class: 'vis' }));
      }
      if (sel) for (const [end, p] of [['a', a], ['b', b]]) g.append(s('circle', { cx: p.x, cy: p.y, r: 6, class: 'handle', 'data-end': end, 'data-line': line.id }));
      svg.append(g);
    }
  }

  // ---------------------------------------------------------------- context bar
  updateContextBar() {
    const bar = this.dom.contextBar;
    const els = [...this.selection].map((id) => this.store.live(id)).filter(Boolean);
    if (!els.length || this.dragging) { bar.hidden = true; return; }
    const rects = els.map((e) => (e.type === 'line' ? this.lineBounds(e) : this.nodes.get(e.id)?.node.getBoundingClientRect())).filter(Boolean);
    if (!rects.length) { bar.hidden = true; return; }
    const vr = this.dom.viewport.getBoundingClientRect();
    const top = Math.min(...rects.map((r) => r.top)), left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right));
    const sig = els.map((e) => e.id + e.type + (this.drawing === e.id)).join();
    if (bar.dataset.sig !== sig || bar.dataset.penSig !== JSON.stringify(this.pen) + JSON.stringify(els.map((e) => [e.color, !!e.locked]))) {
      bar.dataset.sig = sig; bar.dataset.penSig = JSON.stringify(this.pen) + JSON.stringify(els.map((e) => [e.color, !!e.locked]));
      bar.replaceChildren(...this.contextButtons(els));
    }
    bar.hidden = false; bar.style.left = '0px';
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = (left + right) / 2 - bw / 2 - vr.left, y = top - vr.top - bh - 10;
    if (y < 4) y = rects.reduce((m, r) => Math.max(m, r.bottom), 0) - vr.top + 10;
    if (matchMedia('(max-width: 760px)').matches) {          // phones: dock the bar to the bottom edge of the canvas
      bar.classList.add('docked'); bar.style.left = '6px'; bar.style.top = Math.max(4, vr.height - bar.offsetHeight - 8) + 'px';
    } else {
      bar.classList.remove('docked');
      bar.style.left = Math.max(4, Math.min(x, vr.width - bw - 4)) + 'px';
      bar.style.top = Math.max(4, y) + 'px';
    }
  }
  lineBounds(e) {
    const a = this.linePoint(e, 'a'), b = this.linePoint(e, 'b');
    const r = this.dom.viewport.getBoundingClientRect();
    const sx = (p) => r.left + this.tx + p.x * this.scale, sy = (p) => r.top + this.ty + p.y * this.scale;
    return { left: Math.min(sx(a), sx(b)), right: Math.max(sx(a), sx(b)), top: Math.min(sy(a), sy(b)), bottom: Math.max(sy(a), sy(b)) };
  }

  contextButtons(els) {
    const store = this.store; const out = [];
    const btn = (label, title, fn, cls = '') => h('button', { class: 'cb ' + cls, title, 'aria-label': title, 'data-nodrag': '', onmousedown: (ev) => ev.preventDefault(), onclick: fn }, label);
    const ibtn = (name, title, fn, cls = '') => { const b = btn('', title, fn, 'icon ' + cls); b.innerHTML = icon(name, 18); return b; };
    const sep = () => h('span', { class: 'cb-sep' });
    const one = els.length === 1 ? els[0] : null;
    const edit = (fn, label = 'Edit') => store.commit(els.map((e) => ({ id: e.id, after: fn(e) })), { label });

    if (one && this.drawing === one.id) {
      for (const c of ['#1f2430', '#e5484d', '#2f7de1', '#2f9e6a', '#f2a900']) out.push(h('button', { class: 'swatch' + (this.pen.color === c ? ' on' : ''), style: `background:${c}`, title: t('ctx.penColor'), onclick: () => { this.pen.color = c; this.updateContextBar(); } }));
      for (const w of [2, 4, 8]) out.push(btn('●', t('ctx.pen', { n: w }), () => { this.pen.w = w; this.updateContextBar(); }, this.pen.w === w ? 'on' : ''));
      out.push(sep(), btn(t('ctx.undoStroke'), t('ctx.undoStrokeTip'), () => edit((e) => ({ ...e, content: { ...e.content, strokes: e.content.strokes.slice(0, -1) } }), 'Undo stroke')),
        btn(t('ctx.clear'), t('ctx.clearTip'), () => edit((e) => ({ ...e, content: { ...e.content, strokes: [] } }), 'Clear sketch')),
        btn(t('ctx.done'), t('ctx.doneTip'), () => { this.drawing = null; this.updateSelectionClasses(); this.updateContextBar(); }, 'primary'));
      return out;
    }

    // ---- arrange several cards: align / distribute
    const free = els.filter((e) => e.type !== 'line' && e.section === 'canvas');
    if (free.length >= 2) {
      const L = this.layout;
      for (const [name, mode, tip] of [['align-left', 'left', t('ctx.alignLeft')], ['align-center', 'center', t('ctx.alignCenter')], ['align-right', 'right', t('ctx.alignRight')], ['align-top', 'top', t('ctx.alignTop')], ['align-middle', 'middle', t('ctx.alignMiddle')], ['align-bottom', 'bottom', t('ctx.alignBottom')]]) out.push(ibtn(name, tip, () => L.align(store, this, mode)));
      if (free.length >= 3) out.push(ibtn('dist-h', t('ctx.distH'), () => L.distribute(store, this, 'h')), ibtn('dist-v', t('ctx.distV'), () => L.distribute(store, this, 'v')));
      out.push(sep());
    }

    if (one?.type === 'note') {
      for (const [lbl, cmd, tip] of [['B', 'bold', t('ctx.bold')], ['I', 'italic', t('ctx.italic')], ['U', 'underline', t('ctx.underline')], ['S', 'strikeThrough', t('ctx.strike')], ['•', 'insertUnorderedList', t('ctx.bullets')], ['1.', 'insertOrderedList', t('ctx.numbers')]]) {
        out.push(btn(lbl, tip, () => { this.focusEdit(one.id); document.execCommand(cmd); }, 'fmt'));
      }
      out.push(btn(t('wr.write'), t('wr.writeTip'), () => this.onFocusNote?.(one.id), 'primary'), sep());
    }
    if (one?.type === 'table') {
      const mut = (fn, label) => edit((e) => { const rows = e.content.rows.map((r) => [...r]); fn(rows); return { ...e, content: { ...e.content, rows } }; }, label);
      out.push(btn(t('ctx.addRow'), t('ctx.addRowTip'), () => mut((r) => r.push(r[0].map(() => '')), 'Add row')), btn(t('ctx.delRow'), t('ctx.delRowTip'), () => mut((r) => { if (r.length > 1) r.pop(); }, 'Remove row')),
        btn(t('ctx.addCol'), t('ctx.addColTip'), () => mut((r) => r.forEach((x) => x.push('')), 'Add column')), btn(t('ctx.delCol'), t('ctx.delColTip'), () => mut((r) => { if (r[0].length > 1) r.forEach((x) => x.pop()); }, 'Remove column')),
        btn(one.content.header ? t('ctx.headerOn') : t('ctx.headerOff'), t('ctx.headerTip'), () => edit((e) => ({ ...e, content: { ...e.content, header: !e.content.header } }), 'Toggle header')), sep());
    }
    if (one?.type === 'todo') out.push(btn(one.content.showTitle ? t('ctx.hideTitle') : t('ctx.addTitle'), t('ctx.titleTip'), () => edit((e) => ({ ...e, content: { ...e.content, showTitle: !e.content.showTitle } }), 'Toggle title')), btn(t('ctx.addTaskShort'), t('ctx.addTaskTip'), () => this.onAddTask?.(one.id)), sep());
    if (one?.type === 'sketch') out.push(btn(t('ctx.draw'), t('ctx.drawTip'), () => { this.drawing = one.id; this.updateSelectionClasses(); this.updateContextBar(); }, 'primary'), sep());
    if (one && (one.type === 'board' || one.type === 'column')) out.push(btn(t('wr.copyText'), t('wr.copyTextTip'), () => this.onCopyText?.(one.id)), btn(t('wr.exportMd'), t('wr.exportMdTip'), () => this.onExportMd?.(one.id)), sep());
    if (one?.type === 'board') {
      out.push(btn(t('ctx.open'), t('ctx.openTip'), () => this.onOpen?.(one.id)), btn(t('ctx.rename'), t('ctx.renameTip'), () => this.focusEdit(one.id)));
      for (const ic of BOARD_ICONS.slice(0, 6)) out.push(btn(ic, t('ctx.icon'), () => edit((e) => ({ ...e, content: { ...e.content, icon: ic } }), 'Board icon')));
      out.push(sep());
      for (const c of BOARD_COLORS) out.push(h('button', { class: 'swatch' + (one.content.tint === c ? ' on' : ''), style: `background:${c}`, title: t('ctx.boardColor'), 'data-nodrag': '', onmousedown: (ev) => ev.preventDefault(), onclick: () => edit((e) => ({ ...e, content: { ...e.content, tint: c } }), 'Board colour') }));
      out.push(sep());
    } else if (els.every((e) => e.type !== 'line' && e.type !== 'task')) {
      for (const c of COLORS) out.push(h('button', { class: 'swatch' + ((one ? one.color : null) === c ? ' on' : ''), style: c ? `background:${c}` : '', title: c ? t('ctx.cardColor') : t('ctx.noColor'), 'data-nodrag': '', onmousedown: (ev) => ev.preventDefault(), onclick: () => edit((e) => ({ ...e, color: c }), 'Card colour') }, c ? '' : '∅'));
      out.push(sep());
    }
    if (one?.type === 'line') {
      out.push(btn(one.content.arrow ? t('ctx.arrowOn') : t('ctx.arrowOff'), t('ctx.arrowTip'), () => edit((e) => ({ ...e, content: { ...e.content, arrow: !e.content.arrow } }), 'Line arrow')),
        btn(one.content.dashed ? t('ctx.dashedOn') : t('ctx.dashedOff'), t('ctx.dashedTip'), () => edit((e) => ({ ...e, content: { ...e.content, dashed: !e.content.dashed } }), 'Line dash')),
        btn(t('ctx.thicker'), t('ctx.thickerTip'), () => edit((e) => ({ ...e, content: { ...e.content, weight: Math.min(8, e.content.weight + 1) } }), 'Line weight')),
        btn(t('ctx.thinner'), t('ctx.thinnerTip'), () => edit((e) => ({ ...e, content: { ...e.content, weight: Math.max(1, e.content.weight - 1) } }), 'Line weight')));
      for (const c of ['#1f2430', '#e5484d', '#2f7de1', '#2f9e6a']) out.push(h('button', { class: 'swatch', style: `background:${c}`, title: t('ctx.lineColor'), 'data-nodrag': '', onclick: () => edit((e) => ({ ...e, color: c }), 'Line colour') }));
      out.push(sep());
    }
    if (one?.type === 'link' && one.content.url) out.push(btn(t('ctx.refresh'), t('ctx.refreshTip'), () => this.onLinkPreview?.(one.id, one.content.url, true)), sep());
    if (one?.type === 'image') out.push(btn(one.content.src || one.content.path ? t('ctx.replace') : t('ctx.chooseImage'), t('ctx.imageTip'), () => this.onReplaceImage?.(one.id)), sep());

    // ---- arrange: stacking order and lock
    const cards = els.filter((e) => e.type !== 'line' && e.type !== 'task');
    if (cards.length) {
      const L = this.layout; const allLocked = cards.every((e) => e.locked);
      if (cards.some((e) => e.section === 'canvas')) out.push(ibtn('front', t('ctx.front'), () => L.stack(store, this, 'front')), ibtn('back', t('ctx.back'), () => L.stack(store, this, 'back')));
      out.push(ibtn(allLocked ? 'unlock' : 'lock', allLocked ? t('ctx.unlock') : t('ctx.lock'), () => L.toggleLock(store, this), allLocked ? 'on' : ''), sep());
    }
    out.push(ibtn('duplicate', t('ctx.duplicate'), () => this.onDuplicate?.()), ibtn('trash', t('ctx.trash'), () => this.onDelete?.(), 'danger'));
    return out;
  }
}

// -------------------------------------------------------------------- geometry
function edgePoint(r, to) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2; const dx = to.x - cx, dy = to.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const k = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k };
}

// -------------------------------------------------------------------- builders
function editable(attrs = {}) { return h('div', { 'data-edit': 'true', spellcheck: 'false', ...attrs }); }

/** commit helper bound to a rec: reads current element so edits never clobber newer state */
const patchContent = (view, id, patch, label, merge) => {
  const cur = view.store.live(id); if (!cur) return;
  view.store.commit([{ id, after: { ...cur, content: { ...cur.content, ...patch } } }], { label, merge });
};

const BUILDERS = {
  note(rec, e, view) {
    const ed = h('div', { class: 'note-text', 'data-edit': 'true', 'data-placeholder': t('card.notePlaceholder'), spellcheck: 'false' });
    ed.addEventListener('dblclick', () => { ed.contentEditable = 'true'; ed.focus(); });
    ed.addEventListener('blur', () => {
      ed.contentEditable = 'false';
      const html = sanitizeHtml(ed.innerHTML);
      if (ed.innerHTML !== html) ed.innerHTML = html;      // drop anything the editor accepted that the sanitiser would remove (drops, odd paste sources)
      const cur = view.store.live(e.id); if (cur && cur.content.html !== html) patchContent(view, e.id, { html }, 'Edit note');
    });
    ed.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') ed.blur(); ev.stopPropagation(); });
    ed.addEventListener('drop', (ev) => { if (!ed.isContentEditable) return; ev.preventDefault(); const tx = ev.dataTransfer?.getData('text/plain'); if (tx) document.execCommand('insertText', false, tx); });
    ed.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); });
    attachSlash(ed);
    const wc = h('div', { class: 'note-wc', 'aria-hidden': 'true' });
    const paintWc = (html) => { const n = view.store.prefs.wordCounts === false ? 0 : noteWords(html); wc.textContent = n > 0 ? t('wr.words', { n }) : ''; wc.hidden = !n; };
    ed.addEventListener('input', () => paintWc(ed.innerHTML));
    rec.node.append(ed, wc);
    rec.update = (el) => { paintWc(el.content.html || ''); if (document.activeElement === ed) return; const clean = sanitizeHtml(el.content.html || ''); if (ed.innerHTML !== clean) ed.innerHTML = clean; };      // sanitised again on every render: stored data is never trusted
  },

  task(rec, e, view) {
    const cb = h('input', { type: 'checkbox', class: 'task-cb', 'data-nodrag': '' });
    const text = h('div', { class: 'task-text', contenteditable: 'plaintext-only', 'data-edit': 'plaintext-only', 'data-placeholder': t('card.taskPlaceholder'), spellcheck: 'false' });
    const grip = h('span', { class: 'grip', title: t('card.reorder') }, '⋮⋮');
    cb.addEventListener('change', () => patchContent(view, e.id, { done: cb.checked }, 'Toggle task'));
    text.addEventListener('blur', () => { const cur = view.store.live(e.id); if (cur && cur.content.text !== text.textContent) patchContent(view, e.id, { text: text.textContent }, 'Edit task'); });
    text.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); text.blur(); view.onAddTask?.(view.store.get(e.id).parentId, e.id); }
      if (ev.key === 'Backspace' && !text.textContent) { ev.preventDefault(); view.onDeleteIds?.([e.id]); }
    });
    rec.node.append(grip, cb, text);
    rec.update = (el) => { cb.checked = el.content.done; rec.node.classList.toggle('done', el.content.done); if (document.activeElement !== text) text.textContent = el.content.text; };
  },

  todo(rec, e, view) {
    const title = h('input', { class: 'list-title', placeholder: t('card.listTitle'), 'data-edit': 'true', 'data-nodrag': '' });
    title.addEventListener('change', () => patchContent(view, e.id, { title: title.value }, 'Rename list'));
    title.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') title.blur(); });
    const body = h('div', { class: 'tasks', 'data-drop': e.id });
    const add = h('button', { class: 'add-task', 'data-nodrag': '', onclick: () => view.onAddTask?.(e.id) }, t('card.addTask'));
    const progress = h('div', { class: 'progress' }, h('i'));
    rec.node.append(title, progress, body, add); rec.body = body;
    rec.update = (el) => { title.hidden = !el.content.showTitle; if (document.activeElement !== title) title.value = el.content.title; };
    rec.count = () => { const t = view.store.children(e.id, 'stack'); const d = t.filter((x) => x.content.done).length; progress.firstChild.style.width = t.length ? (d / t.length) * 100 + '%' : '0'; progress.hidden = !t.length; };
  },

  column(rec, e, view) {
    const title = h('input', { class: 'col-title', placeholder: t('card.columnTitle'), 'data-edit': 'true', 'data-nodrag': '' });
    title.addEventListener('change', () => patchContent(view, e.id, { title: title.value }, 'Rename column'));
    title.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') title.blur(); });
    const count = h('div', { class: 'col-count' });
    const body = h('div', { class: 'col-body', 'data-drop': e.id });
    rec.node.append(h('div', { class: 'col-head' }, title, count), body); rec.body = body;
    rec.update = (el) => { if (document.activeElement !== title) title.value = el.content.title; };
    rec.count = () => { const n = view.store.children(e.id, 'stack').length; count.textContent = t('card.count', { n }); };
  },

  board(rec, e, view) {
    const icon = h('div', { class: 'board-icon' });
    const label = h('div', { class: 'board-title', 'data-edit': 'plaintext-only', spellcheck: 'false' });
    const count = h('div', { class: 'board-count' });
    label.addEventListener('blur', () => { label.contentEditable = 'false'; const title = label.textContent.trim() || t('common.untitled'); const cur = view.store.live(e.id); if (cur && cur.content.title !== title) patchContent(view, e.id, { title }, 'Rename board'); });
    label.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); label.blur(); } });
    rec.node.append(icon, label, count); rec.node.dataset.drop = e.id;
    rec.update = (el) => { icon.textContent = el.content.icon; icon.style.background = (el.content.tint || '#7aa2f7') + '33'; icon.style.borderColor = el.content.tint || '#7aa2f7'; if (document.activeElement !== label) label.textContent = el.content.title; };
    rec.count = () => { const n = view.store.descendants(e.id).filter((x) => x.type !== 'line' && x.type !== 'task').length; count.textContent = t('card.count', { n }); };
    rec.count();
  },

  link(rec, e, view) {
    const input = h('input', { class: 'link-input', placeholder: t('card.linkPlaceholder'), 'data-edit': 'true', 'data-nodrag': '' });
    const img = h('img', { class: 'link-img', alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', draggable: 'false', hidden: true });
    img.addEventListener('error', () => { img.hidden = true; });
    const title = h('div', { class: 'link-title', 'data-edit': 'plaintext-only', spellcheck: 'false' });
    const desc = h('div', { class: 'link-desc' });
    const host = h('div', { class: 'link-host' });
    const open = h('a', { class: 'link-open', target: '_blank', rel: 'noopener noreferrer', 'data-nodrag': '' }, t('card.linkOpen'));
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { const url = normalizeUrl(input.value); if (url) { patchContent(view, e.id, { url, title: hostOf(url), description: '', image: '' }, 'Add link'); view.onLinkPreview?.(e.id, url); } }
    });
    title.addEventListener('dblclick', () => { title.contentEditable = 'plaintext-only'; title.focus(); });
    title.addEventListener('blur', () => { title.contentEditable = 'false'; const cur = view.store.live(e.id); if (cur && cur.content.title !== title.textContent) patchContent(view, e.id, { title: title.textContent, titleEdited: true }, 'Edit link title'); });
    title.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); title.blur(); } });
    const view_ = h('div', { class: 'link-view' }, img, h('div', { class: 'link-body' }, h('div', { class: 'link-site' }, h('span', { class: 'link-ico' }, '🔗'), host), title, desc, open));
    rec.node.append(input, view_);
    rec.update = (el) => {
      const c = el.content; const has = !!c.url; input.hidden = has; view_.hidden = !has;
      if (has) {
        host.textContent = c.siteName || hostOf(c.url); if (document.activeElement !== title) title.textContent = c.title; const safe = safeWebUrl(c.url); if (safe) { open.href = safe; open.hidden = false; } else { open.removeAttribute('href'); open.hidden = true; }
        desc.textContent = c.description || ''; desc.hidden = !c.description;
        const imgUrl = safeWebUrl(c.image); if (imgUrl) { if (img.getAttribute('src') !== imgUrl) { img.hidden = false; img.src = imgUrl; } } else { img.hidden = true; img.removeAttribute('src'); }
      }
    };
  },

  comment(rec, e, view) {
    const list = h('div', { class: 'cm-list' });
    const input = h('input', { class: 'cm-input', placeholder: t('card.commentPlaceholder'), 'data-edit': 'true', 'data-nodrag': '' });
    const send = h('button', { class: 'cm-send', 'data-nodrag': '', onclick: () => submit() }, t('card.send'));
    const submit = () => {
      const text = input.value.trim(); if (!text) return;
      const cur = view.store.live(e.id); input.value = '';
      patchContent(view, e.id, { thread: [...cur.content.thread, { id: crypto.randomUUID().slice(0, 8), author: t('comment.you'), text, time: Date.now() }] }, 'Add comment');
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') submit(); });
    rec.node.append(list, h('div', { class: 'cm-row' }, input, send));
    rec.update = (el) => {
      list.replaceChildren(...el.content.thread.map((m) => h('div', { class: 'cm' }, h('div', { class: 'cm-meta' }, m.author, ' · ', new Date(m.time).toLocaleString(getLang(), { dateStyle: 'short', timeStyle: 'short' })), h('div', { class: 'cm-text' }, m.text))));
      list.hidden = !el.content.thread.length;
    };
  },

  database(rec, e, view) { buildPreview(rec, e, view); },

  table(rec, e, view) {
    const table = h('table', { class: 'tbl' });
    const commitCells = () => {
      const rows = [...table.rows].map((tr) => [...tr.cells].map((td) => td.textContent));
      const cur = view.store.live(e.id); if (cur && JSON.stringify(cur.content.rows) !== JSON.stringify(rows)) patchContent(view, e.id, { rows }, 'Edit table', 'tbl' + e.id);
    };
    table.addEventListener('focusout', commitCells);
    table.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Tab') {
        ev.preventDefault(); const cells = [...table.querySelectorAll('td,th')]; const i = cells.indexOf(ev.target);
        const next = cells[i + (ev.shiftKey ? -1 : 1)]; if (next) { next.focus(); const r = document.createRange(); r.selectNodeContents(next); getSelection().removeAllRanges(); getSelection().addRange(r); }
      }
    });
    rec.node.append(h('div', { class: 'tbl-wrap' }, table));
    rec.update = (el) => {
      if (table.contains(document.activeElement)) return;
      table.replaceChildren(...el.content.rows.map((row, r) => h('tr', {}, ...row.map((txt) => {
        const cell = h(el.content.header && r === 0 ? 'th' : 'td', { contenteditable: 'plaintext-only', 'data-nodrag': '', spellcheck: 'false' }); cell.textContent = txt; return cell;
      }))));
      table.querySelector('th,td')?.setAttribute('data-edit', 'plaintext-only');
    };
  },

  image(rec, e, view) {
    const img = h('img', { draggable: 'false', alt: '' });
    const phLabel = h('span', {}, t('card.imageAdd'));
    const ph = h('div', { class: 'img-ph', 'data-nodrag': '', title: t('card.imagePick'), ondblclick: () => view.onReplaceImage?.(e.id) }, h('span', { class: 'img-ph-ico' }, '🖼'), phLabel);
    rec.node.append(img, ph); let shownPath = null;
    rec.update = (el) => {
      const c = el.content;
      if (c.path && view.files) {
        img.hidden = true; ph.hidden = false; phLabel.textContent = t('card.imageLoading');
        if (shownPath !== c.path) {
          shownPath = c.path; const want = c.path;
          view.files.objectUrl(want).then((u) => { if (shownPath === want) { img.src = u; img.hidden = false; ph.hidden = true; } }).catch(() => { if (shownPath === want) phLabel.textContent = t('card.imageUnavailable'); });
        } else if (img.getAttribute('src')) { img.hidden = false; ph.hidden = true; }
      } else if (c.src) {
        shownPath = null; img.hidden = false; ph.hidden = true; if (img.getAttribute('src') !== c.src) img.src = c.src;
      } else { shownPath = null; img.hidden = true; ph.hidden = false; phLabel.textContent = t('card.imageAdd'); img.removeAttribute('src'); }
      img.alt = c.name || ''; ph.style.paddingBottom = (c.ratio || 0.7) * 100 + '%';
    };
  },

  file(rec, e, view) {
    const name = h('div', { class: 'file-name' }); const meta = h('div', { class: 'file-meta' });
    const dl = h('a', { class: 'file-dl', 'data-nodrag': '', href: '#' }, t('card.download'));
    dl.addEventListener('click', async (ev) => {
      const c = view.store.live(e.id)?.content; if (!c?.path || !view.files) return;      // inline files use the plain href
      ev.preventDefault(); dl.textContent = t('card.preparing');
      try { const u = await view.files.objectUrl(c.path); const a = h('a', { href: u, download: c.name || 'file' }); document.body.append(a); a.click(); a.remove(); } catch { view.onNotify?.(t('card.downloadFail')); }
      dl.textContent = t('card.download');
    });
    rec.node.append(h('div', { class: 'file-ico' }, '📄'), h('div', { class: 'file-info' }, name, meta, dl));
    rec.update = (el) => { const c = el.content; name.textContent = c.name; meta.textContent = fmtSize(c.size); if (c.path) dl.removeAttribute('download'); else { dl.href = /^(data:|blob:)/i.test(c.src || '') ? c.src : '#'; dl.download = c.name; } };
  },

  sketch(rec, e, view) {
    const svg = s('svg', { class: 'sketch-svg', viewBox: `0 0 ${SKETCH_VW} 200`, preserveAspectRatio: 'xMidYMid meet' });
    rec.node.append(svg); rec.svg = svg;
    rec.update = (el) => {
      svg.setAttribute('viewBox', `0 0 ${SKETCH_VW} ${el.content.h}`);
      svg.replaceChildren(...el.content.strokes.map((st) => s('polyline', { points: st.pts.map((p) => p.join(',')).join(' '), stroke: st.color, 'stroke-width': st.w, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
    };
  },
};

export const SKETCH_W = SKETCH_VW;
export function fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
export { makeElement, TYPE_LABEL };
