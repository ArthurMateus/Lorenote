// Pointer / keyboard interaction: create, select, drag & nest, resize, connectors, pan/zoom, sketching, paste & drop.
import { ACCEPTS, makeElement, TYPE_LABEL, isContainer, hostOf, normalizeUrl } from './model.js';
import { uid } from './store.js';
import { SKETCH_W } from './view.js';
import { snap } from './layout.js';

const isEditing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const NO_DRAG = 'input,textarea,select,button,a,[data-nodrag],[contenteditable="true"],[contenteditable="plaintext-only"]';

export function setupInteractions(view, toast) {
  const { store, dom } = view;
  const vp = dom.viewport;
  let space = false;

  // ------------------------------------------------------------------ gesture tracking (cancellable, for multi-touch)
  let gesture = null;
  function track(move, up, onCancel) {
    gesture?.cancel();
    const g = { cancel() { off(); onCancel?.(); } };
    const off = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', wrappedUp); document.removeEventListener('pointercancel', g.cancel); if (gesture === g) gesture = null; };
    const wrappedUp = (e) => { off(); up(e); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', wrappedUp); document.addEventListener('pointercancel', g.cancel);
    gesture = g;
  }
  const touches = new Map();     // active touch pointers on the canvas
  for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, (e) => touches.delete(e.pointerId), true);
  let lastTap = null, lastSynth = 0;

  // ------------------------------------------------------------------ creation
  function nextFree() {
    const r = vp.getBoundingClientRect(); const c = view.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const n = store.children(view.boardId, 'canvas').length % 6;
    return { x: c.x - 110 + n * 24, y: c.y - 60 + n * 24 };
  }

  function placeAt(type, hit) {
    // hit: {parentId, section, x, y, order}
    return { parentId: hit.parentId, section: hit.section, x: Math.round(hit.x ?? 80), y: Math.round(hit.y ?? 80), order: hit.order ?? 0, z: hit.section === 'canvas' ? store.maxZ(hit.parentId) + 1 : 0 };
  }

  function create(type, hit, content, forceId) {
    hit = hit || { parentId: view.boardId, section: 'canvas', ...nextFree() };
    const base = placeAt(type, hit);
    const el = makeElement(type, base.parentId, base);
    if (forceId) el.id = forceId;
    if (base.section === 'stack') el.w = 0;
    if (content) el.content = { ...el.content, ...content };
    if (type === 'line') { el.section = 'canvas'; el.content = { ...el.content, a: { x: base.x, y: base.y }, b: { x: base.x + 170, y: base.y + 70 } }; }
    const changes = [{ id: el.id, after: el }];
    let focusId = el.id;
    if (type === 'todo') {
      const t = makeElement('task', el.id, { section: 'stack', order: 1, w: 0 });
      changes.push({ id: t.id, after: t }); focusId = t.id;
    }
    store.commit(changes, { label: `Add ${TYPE_LABEL[type].toLowerCase()}` });
    view.select([el.id]);
    view.render(); if (type !== 'image' && type !== 'file') view.focusEdit(focusId);
    return el;
  }

  view.onAddTask = (listId, afterId) => {
    const sibs = store.children(listId, 'stack'); const idx = afterId ? sibs.findIndex((x) => x.id === afterId) : sibs.length - 1;
    const prev = sibs[idx]?.order ?? 0, next = sibs[idx + 1]?.order ?? prev + 2;
    const t = makeElement('task', listId, { section: 'stack', order: (prev + next) / 2, w: 0 });
    store.commit([{ id: t.id, after: t }], { label: 'Add task' });
    view.render(); view.focusEdit(t.id);
  };

  // ------------------------------------------------------------------ images / files
  const picker = document.createElement('input'); picker.type = 'file'; picker.hidden = true; document.body.append(picker);
  let pickCtx = null;
  picker.addEventListener('change', async () => { const files = [...picker.files]; picker.value = ''; if (pickCtx) await addFiles(files, pickCtx.hit, pickCtx.replaceId); pickCtx = null; });
  function pickFile(kind, hit, replaceId) { pickCtx = { hit, replaceId }; picker.accept = kind === 'image' ? 'image/*' : ''; picker.click(); }
  view.onReplaceImage = (id) => pickFile('image', null, id);

  const readDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  async function shrinkImage(src, mime) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const max = 1600; const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (k === 1 && src.length < 800000) return { src, ratio: img.naturalHeight / img.naturalWidth };
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL(mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.85), ratio: c.height / c.width };
  }
  /** blob -> shrunk image blob + ratio (for upload) */
  async function shrinkBlob(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const max = 2000; const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const ratio = img.naturalHeight / img.naturalWidth;
      if (k === 1 && file.size < 1.5 * 1048576) return { blob: file, ratio };
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const png = file.type === 'image/png' && c.width * c.height < 1.2e6;
      const blob = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.88));
      return { blob: blob || file, ratio };
    } finally { URL.revokeObjectURL(url); }
  }
  async function addFiles(files, hit, replaceId) {
    let n = 0; const cloud = !!view.files;
    for (const f of files) {
      const limit = cloud ? 25 : 12;
      if (f.size > limit * 1048576) { toast(`${f.name} is larger than ${limit} MB and was skipped`); continue; }
      try {
        const at = hit ? { ...hit, x: (hit.x ?? 80) + n * 24, y: (hit.y ?? 80) + n * 24 } : undefined;
        const isImage = f.type.startsWith('image/');
        let content = { name: f.name, size: f.size, mime: f.type };
        if (isImage) {
          if (cloud) { const { blob, ratio } = await shrinkBlob(f); content = { ...content, ratio, size: blob.size, mime: blob.type || f.type, blob }; }
          else { const { src, ratio } = await shrinkImage(await readDataURL(f), f.type); content = { ...content, src, ratio }; }
        } else if (!cloud) content.src = await readDataURL(f);
        else content.blob = f;
        const id = replaceId || uid();
        if (content.blob) {          // signed in: upload first; if that fails (offline) keep the data inline and let the migration move it later
          const blob = content.blob; delete content.blob;
          try { toast(`Uploading ${f.name}…`, null, '', 20000); content.path = await view.files.upload(id, blob, f.name); }
          catch (err) { if (/larger than/.test(err.message)) { toast(err.message); continue; } content.src = await readDataURL(blob); toast(`${f.name} saved on this device; it will upload when you are back online`); }
        }
        if (replaceId) { const cur = store.live(replaceId); if (cur) { const old = cur.content.path; store.commit([{ id: replaceId, after: { ...cur, content: { ...cur.content, src: undefined, path: undefined, ...content } } }], { label: 'Replace image' }); if (old) view.files?.forget(old); } }
        else { const el = create(isImage ? 'image' : 'file', at, content, id); void el; }
        n++;
      } catch { toast(`Could not read ${f.name}`); }
    }
  }

  // ------------------------------------------------------------------ toolbar drag / click
  dom.toolbar.addEventListener('pointerdown', (ev) => {
    const tool = ev.target.closest('.tool[data-type]'); if (!tool || ev.button !== 0) return;
    ev.preventDefault(); const type = tool.dataset.type; const sx = ev.clientX, sy = ev.clientY; let ghost = null;
    const move = (e) => {
      if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) > 5) { ghost = tool.cloneNode(true); ghost.classList.add('ghost'); document.body.append(ghost); }
      if (ghost) { ghost.style.left = e.clientX - 24 + 'px'; ghost.style.top = e.clientY - 24 + 'px'; markDrop(e.clientX, e.clientY, [type]); }
    };
    const up = (e) => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); clearDropMark(); ghost?.remove();
      let hit;
      if (ghost) {
        const r = vp.getBoundingClientRect(); if (e.clientX < r.left || e.clientY < r.top) return;
        hit = hitAt(e.clientX, e.clientY, [type], 60, 20);
        if (!hit) return;
      }
      if (type === 'image' || type === 'file') return pickFile(type, hit);
      create(type, hit);
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });

  // ------------------------------------------------------------------ drop target logic
  /** find accepting container under pointer; returns container element or null (=board canvas) */
  function containerAt(cx, cy, types, exclude = new Set()) {
    for (const el of document.elementsFromPoint(cx, cy)) {
      const d = el.closest('[data-drop]'); if (!d) continue;
      const id = d.dataset.drop; if (exclude.has(id)) continue;
      const c = store.live(id); if (!c) continue;
      if (types.every((t) => ACCEPTS[c.type]?.has(t))) return c;
    }
    return null;
  }
  function orderFor(containerId, cy, exclude, count) {
    const sibs = store.children(containerId, 'stack').filter((x) => !exclude.has(x.id));
    let idx = sibs.length;
    for (let i = 0; i < sibs.length; i++) { const r = view.nodes.get(sibs[i].id)?.node.getBoundingClientRect(); if (r && cy < r.top + r.height / 2) { idx = i; break; } }
    const lo = sibs[idx - 1]?.order ?? (sibs[idx]?.order ?? 1) - 1, hi = sibs[idx]?.order ?? lo + 1;
    return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * (i + 1)) / (count + 1));
  }
  /** a drop location for creating a new element of `types` */
  function hitAt(cx, cy, types, offX = 0, offY = 0, exclude) {
    const c = containerAt(cx, cy, types, exclude);
    if (c && c.type !== 'board') return { parentId: c.id, section: 'stack', order: orderFor(c.id, cy, exclude || new Set(), 1)[0] };
    if (c) return { parentId: c.id, section: 'canvas', x: 60, y: 60 };
    if (types.includes('task')) return null;
    const p = view.toWorld(cx, cy); return { parentId: view.boardId, section: 'canvas', x: p.x - offX, y: p.y - offY };
  }
  let marked = null;
  function markDrop(cx, cy, types, exclude) {
    const c = containerAt(cx, cy, types, exclude); const el = c ? document.querySelector(`[data-drop="${c.id}"]`) : null;
    if (el !== marked) { marked?.classList.remove('drop-hover'); marked = el; marked?.classList.add('drop-hover'); }
  }
  function clearDropMark() { marked?.classList.remove('drop-hover'); marked = null; }

  // ------------------------------------------------------------------ drag of existing cards
  function topLevelSelection() {
    const sel = new Set(view.selection);
    return [...sel].map((id) => store.live(id)).filter((e) => e && e.type !== 'line' && ![...sel].some((o) => o !== e.id && store.isAncestor(o, e.id)));
  }

  function startCardDrag(ev, downId) {
    const sx = ev.clientX, sy = ev.clientY; let dragging = false, blocked = false, guided = false; let items = []; let others = []; const dragIds = new Set();
    const lineItems = [...view.selection].map((id) => store.live(id)).filter((e) => e?.type === 'line');
    const begin = () => {
      dragging = true; view.dragging = true; dom.contextBar.hidden = true;
      const els = topLevelSelection().filter((e) => !e.locked);
      for (const e of els) {
        const rec = view.nodes.get(e.id); if (!rec) continue;
        const wr = view.worldRect(e.id); const p = view.toWorld(sx, sy);
        items.push({ e, rec, dx: p.x - wr.x, dy: p.y - wr.y, w: wr.w, h: wr.h });
        dragIds.add(e.id);
      }
      if (!items.length) { dragging = false; blocked = true; view.dragging = false; view.updateContextBar(); return; }     // everything selected is locked
      for (const it of items) { it.rec.node.classList.add('dragging'); it.rec.node.style.width = it.w + 'px'; dom.dragLayer.append(it.rec.node); }
      others = store.children(view.boardId, 'canvas').filter((c) => c.type !== 'line' && !dragIds.has(c.id)).map((c) => view.worldRect(c.id)).filter(Boolean);
    };
    const move = (e) => {
      if (blocked) return;
      if (!dragging) { if (Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return; begin(); if (blocked) return; }
      const p = view.toWorld(e.clientX, e.clientY);
      let ox = 0, oy = 0, guides = [];
      if (store.prefs.guides !== false && !e.altKey && others.length && !containerAt(e.clientX, e.clientY, items.map((i) => i.e.type), dragIds)) {
        const xs = items.map((it) => p.x - it.dx), ys = items.map((it) => p.y - it.dy); const bx = Math.min(...xs), by = Math.min(...ys);
        const box = { x: bx, y: by, w: Math.max(...items.map((it, i) => xs[i] + it.w)) - bx, h: Math.max(...items.map((it, i) => ys[i] + it.h)) - by };
        const r = snap(box, others, 6 / view.scale); ox = r.dx; oy = r.dy; guides = r.guides;
      }
      guided = guides.length > 0; drawGuides(guides);
      items.forEach((it) => { it.pos = { x: p.x - it.dx + ox, y: p.y - it.dy + oy }; it.rec.node.style.left = it.pos.x + 'px'; it.rec.node.style.top = it.pos.y + 'px'; });
      if (lineItems.length) { view.lineDrag = new Map(lineItems.map((l) => [l.id, translateLine(l, (e.clientX - sx) / view.scale, (e.clientY - sy) / view.scale)])); }
      markDrop(e.clientX, e.clientY, items.map((i) => i.e.type), dragIds);
      view.updateLines();
    };
    const up = (e) => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); drawGuides([]);
      if (!dragging) { // plain click on an already-selected card among many collapses selection
        if (!ev.shiftKey && view.selection.size > 1 && !ev.target.closest(NO_DRAG)) view.select([downId]);
        return;
      }
      clearDropMark();
      const types = items.map((i) => i.e.type);
      const c = containerAt(e.clientX, e.clientY, types, dragIds);
      const changes = [];
      const needsList = types.includes('task');
      if (needsList && !(c && c.type === 'todo')) { cancelDrag(items); toast('Tasks can only live inside a to-do list'); return; }
      if (c && c.type !== 'board') {
        const orders = orderFor(c.id, e.clientY, dragIds, items.length);
        items.forEach((it, i) => changes.push({ id: it.e.id, after: { ...it.e, parentId: c.id, section: 'stack', order: orders[i], w: 0 } }));
      } else if (c) {
        items.forEach((it, i) => changes.push({ id: it.e.id, after: { ...it.e, parentId: c.id, section: 'canvas', x: 40 + i * 20, y: 40 + i * 20, z: store.maxZ(c.id) + 1 + i, w: it.e.section === 'canvas' ? it.e.w : Math.round(it.w) } }));
      } else {
        let z = store.maxZ(view.boardId);
        items.forEach((it) => {
          const p = view.toWorld(e.clientX, e.clientY); let x = it.pos ? it.pos.x : p.x - it.dx, y = it.pos ? it.pos.y : p.y - it.dy;
          if (store.prefs.snap && !guided) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
          changes.push({ id: it.e.id, after: { ...it.e, parentId: view.boardId, section: 'canvas', x: Math.round(x), y: Math.round(y), z: ++z, w: it.e.section === 'canvas' ? it.e.w : Math.round(it.w) } });
        });
      }
      if (view.lineDrag) for (const [id, content] of view.lineDrag) { const l = store.get(id); changes.push({ id, after: { ...l, content } }); }
      view.lineDrag = null; view.dragging = false;
      for (const it of items) it.rec.node.classList.remove('dragging');
      store.commit(changes, { label: c ? 'Move into container' : 'Move' });
      view.render();
    };
    track(move, up, () => { drawGuides([]); if (dragging) cancelDrag(items); });
  }
  function drawGuides(gs) {
    const svg = document.querySelector('#guides'); svg.replaceChildren();
    for (const g of gs) { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', g.x1); l.setAttribute('y1', g.y1); l.setAttribute('x2', g.x2); l.setAttribute('y2', g.y2); svg.append(l); }
  }
  function cancelDrag(items) { view.dragging = false; view.lineDrag = null; for (const it of items) it.rec.node.classList.remove('dragging'); view.nodes.forEach((r) => (r.el = null)); view.render(); }

  const translateLine = (l, dx, dy) => {
    const a = view.linePoint(l, 'a'), b = view.linePoint(l, 'b');
    return { ...l.content, a: { x: a.x + dx, y: a.y + dy }, b: { x: b.x + dx, y: b.y + dy }, aId: null, bId: null };
  };

  // ------------------------------------------------------------------ resize
  function startResize(ev, id) {
    const rec = view.nodes.get(id); const el = store.live(id); if (!rec || !el || el.locked) return;
    ev.preventDefault(); ev.stopPropagation();
    const sx = ev.clientX, w0 = rec.node.getBoundingClientRect().width / view.scale; let w = w0;
    const move = (e) => { w = Math.max(el.type === 'board' ? 80 : 140, Math.round(w0 + (e.clientX - sx) / view.scale)); rec.node.style.width = w + 'px'; view.updateLines(); view.updateContextBar(); };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); const cur = store.live(id); if (cur && cur.w !== w) store.commit([{ id, after: { ...cur, w } }], { label: 'Resize' }); };
    track(move, up, () => { rec.node.style.width = el.w ? el.w + 'px' : ''; view.updateLines(); });
  }

  // ------------------------------------------------------------------ connectors
  function startLineEnd(ev, lineId, end) {
    ev.preventDefault(); ev.stopPropagation();
    const line = store.live(lineId); if (!line) return;
    view.dragging = true; const key = end === 'a' ? 'aId' : 'bId';
    let content = { ...line.content };
    const move = (e) => {
      const p = view.toWorld(e.clientX, e.clientY); content = { ...content, [end]: { x: p.x, y: p.y }, [key]: null };
      view.lineDrag = new Map([[lineId, content]]);
      const target = cardAt(e.clientX, e.clientY, lineId);
      if (target) { content = { ...content, [key]: target }; view.lineDrag = new Map([[lineId, content]]); }
      markCard(target);
      view.updateLines();
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      markCard(null); view.dragging = false; view.lineDrag = null;
      const cur = store.live(lineId); if (cur) store.commit([{ id: lineId, after: { ...cur, content } }], { label: 'Edit connector' });
      view.render();
    };
    track(move, up, () => { markCard(null); view.dragging = false; view.lineDrag = null; view.render(); });
  }
  function cardAt(cx, cy, exceptId) {
    for (const el of document.elementsFromPoint(cx, cy)) { const c = el.closest('.card'); if (c && c.dataset.id !== exceptId && !c.classList.contains('t-task')) return c.dataset.id; }
    return null;
  }
  let markedCard = null;
  function markCard(id) { const n = id ? view.nodes.get(id)?.node : null; if (n !== markedCard) { markedCard?.classList.remove('bind-hover'); markedCard = n; markedCard?.classList.add('bind-hover'); } }

  // ------------------------------------------------------------------ sketch drawing
  function startStroke(ev, id) {
    const rec = view.nodes.get(id); const el = store.live(id); if (!rec || !el) return;
    ev.preventDefault();
    const svg = rec.svg; const r = svg.getBoundingClientRect(); const vh = el.content.h;
    const pt = (e) => [Math.round(((e.clientX - r.left) / r.width) * SKETCH_W * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * vh * 10) / 10];
    const stroke = { color: view.pen.color, w: view.pen.w, pts: [pt(ev)] };
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    for (const [k, v] of Object.entries({ stroke: stroke.color, 'stroke-width': stroke.w, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) poly.setAttribute(k, v);
    svg.append(poly);
    const move = (e) => { stroke.pts.push(pt(e)); poly.setAttribute('points', stroke.pts.map((p) => p.join(',')).join(' ')); };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      const cur = store.live(id); if (!cur) return;
      if (stroke.pts.length < 2) stroke.pts.push([stroke.pts[0][0] + 0.1, stroke.pts[0][1]]);
      store.commit([{ id, after: { ...cur, content: { ...cur.content, strokes: [...cur.content.strokes, stroke] } } }], { label: 'Draw stroke' });
    };
    track(move, up, () => poly.remove());
  }

  // ------------------------------------------------------------------ pan, marquee
  function startPan(ev) {
    view.stopAnimation?.();
    const sx = ev.clientX, sy = ev.clientY, tx = view.tx, ty = view.ty; let moved = false; vp.classList.add('panning');
    const move = (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 5) moved = true; view.tx = tx + e.clientX - sx; view.ty = ty + e.clientY - sy; view.applyTransform(); };
    const up = () => { vp.classList.remove('panning'); if (!moved && ev.pointerType === 'touch') view.clearSelection(); };
    track(move, up, () => vp.classList.remove('panning'));
  }
  /** two fingers: zoom around the midpoint and pan together */
  function startPinch() {
    const pts = [...touches.values()]; const r = vp.getBoundingClientRect();
    const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const m0 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; const s0 = view.scale;
    const w = { x: (m0.x - r.left - view.tx) / s0, y: (m0.y - r.top - view.ty) / s0 };
    const move = (e) => {
      if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = [...touches.values()]; if (p.length < 2) return;
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); const m = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      const sc = Math.min(2.5, Math.max(0.2, s0 * d / d0)); view.scale = sc; view.tx = m.x - r.left - w.x * sc; view.ty = m.y - r.top - w.y * sc;
      view.applyTransform(); view.onZoom?.();
    };
    track(move, () => {}, null);
  }
  function startMarquee(ev) {
    const r = vp.getBoundingClientRect(); const sx = ev.clientX, sy = ev.clientY; let moved = false; const base = ev.shiftKey ? new Set(view.selection) : new Set();
    const box = dom.marquee;
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return; moved = true;
      const x1 = Math.min(sx, e.clientX), y1 = Math.min(sy, e.clientY), x2 = Math.max(sx, e.clientX), y2 = Math.max(sy, e.clientY);
      box.hidden = false; Object.assign(box.style, { left: x1 - r.left + 'px', top: y1 - r.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      const hit = new Set(base);
      for (const el of store.children(view.boardId, 'canvas')) {
        let b; if (el.type === 'line') b = view.lineBounds(el); else b = view.nodes.get(el.id)?.node.getBoundingClientRect();
        if (b && b.right >= x1 && b.left <= x2 && b.bottom >= y1 && b.top <= y2) hit.add(el.id);
      }
      view.select([...hit]);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); box.hidden = true; if (!moved && !ev.shiftKey) view.clearSelection(); };
    track(move, up, () => { box.hidden = true; });
  }

  // ------------------------------------------------------------------ viewport pointerdown router
  vp.addEventListener('pointerdown', (ev) => {
    if (document.body.classList.contains('presenting')) return;
    if (ev.target.closest('#context-bar, #minimap')) return;
    if (ev.pointerType === 'touch') {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) { gesture?.cancel(); return startPinch(); }
      if (touches.size > 2) return;
    }
    if (ev.button === 1 || (ev.button === 0 && space)) { ev.preventDefault(); return startPan(ev); }
    if (ev.button !== 0) return;
    const handle = ev.target.closest('.handle'); if (handle) return startLineEnd(ev, handle.dataset.line, handle.dataset.end);
    const g = ev.target.closest('g.line');
    if (g) {
      const id = g.dataset.id; if (ev.shiftKey) view.toggle(id); else if (!view.selection.has(id)) view.select([id]);
      return startCardDrag(ev, id);
    }
    const rz = ev.target.closest('.rz'); if (rz) return startResize(ev, rz.closest('.card').dataset.id);
    const card = ev.target.closest('.card');
    if (!card) { if (document.activeElement && isEditing(document.activeElement)) document.activeElement.blur(); return ev.pointerType === 'touch' ? startPan(ev) : startMarquee(ev); }
    const id = card.dataset.id;
    if (view.drawing === id) return startStroke(ev, id);
    if (view.drawing) { view.drawing = null; }
    if (ev.shiftKey) view.toggle(id); else if (!view.selection.has(id)) view.select([id]);
    if (ev.target.closest(NO_DRAG) && !ev.target.closest('.grip')) return;
    if (card.classList.contains('t-task') && !ev.target.closest('.grip')) return;
    if (document.activeElement && isEditing(document.activeElement) && !card.contains(document.activeElement)) document.activeElement.blur();
    startCardDrag(ev, id);
  });

  // Touch screens: synthesise a double-click from two quick taps (browsers do not reliably fire dblclick on touch).
  const tapStart = new Map();
  vp.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'touch') tapStart.set(ev.pointerId, { t: performance.now(), x: ev.clientX, y: ev.clientY }); }, true);
  vp.addEventListener('pointerup', (ev) => {
    if (ev.pointerType !== 'touch') return;
    const s0 = tapStart.get(ev.pointerId); tapStart.delete(ev.pointerId); if (!s0) return;
    const now = performance.now();
    if (now - s0.t > 300 || Math.hypot(ev.clientX - s0.x, ev.clientY - s0.y) > 12) { lastTap = null; return; }
    if (lastTap && now - lastTap.t < 380 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 36) {
      lastTap = null; lastSynth = Date.now();
      const target = document.elementFromPoint(ev.clientX, ev.clientY) || vp;
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY, detail: 3 }));
    } else lastTap = { t: now, x: ev.clientX, y: ev.clientY };
  }, true);
  document.addEventListener('dblclick', (e) => { if (e.detail !== 3 && Date.now() - lastSynth < 800) e.stopImmediatePropagation(); }, true);
  vp.addEventListener('contextmenu', (e) => { if (matchMedia('(pointer: coarse)').matches && !isEditing(e.target)) e.preventDefault(); });

  vp.addEventListener('dblclick', (ev) => {
    if (document.body.classList.contains('presenting')) return;
    const card = ev.target.closest('.card');
    if (card?.classList.contains('t-board')) return view.onOpen?.(card.dataset.id);
    if (!card && !ev.target.closest('g.line') && !ev.target.closest('#context-bar')) {
      const p = view.toWorld(ev.clientX, ev.clientY); create('note', { parentId: view.boardId, section: 'canvas', x: p.x - 100, y: p.y - 20 });
    }
  });

  vp.addEventListener('wheel', (ev) => {
    ev.preventDefault(); if (document.body.classList.contains('presenting')) return; view.stopAnimation?.();
    if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.01));
    else { view.tx -= ev.deltaX; view.ty -= ev.deltaY; view.applyTransform(); }
  }, { passive: false });

  function zoomAt(cx, cy, k) {
    const r = vp.getBoundingClientRect(); const ns = Math.min(2.5, Math.max(0.2, view.scale * k)); const f = ns / view.scale;
    const px = cx - r.left, py = cy - r.top; view.tx = px - (px - view.tx) * f; view.ty = py - (py - view.ty) * f; view.scale = ns; view.applyTransform();
    view.onZoom?.();
  }
  view.zoomBy = (k) => { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, k); };
  view.zoomReset = () => { view.scale = 1; view.tx = 40; view.ty = 40; view.applyTransform(); view.onZoom?.(); };

  // OS file drop
  vp.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('Files')) ev.preventDefault(); });
  vp.addEventListener('drop', (ev) => {
    if (!ev.dataTransfer?.files?.length) return; ev.preventDefault();
    const hit = hitAt(ev.clientX, ev.clientY, ['image'], 0, 0) || undefined; addFiles([...ev.dataTransfer.files], hit);
  });

  // ------------------------------------------------------------------ delete / duplicate
  view.onDeleteIds = (ids) => {
    const live = ids.map((id) => store.live(id)).filter(Boolean); if (!live.length) return;
    store.commit(live.map((e) => ({ id: e.id, after: { ...e, trashed: true, trashedAt: Date.now() } })), { label: 'Delete' });
    view.selection.clear(); view.onSelection?.(); toast(`${live.length} item${live.length > 1 ? 's' : ''} moved to trash`, () => store.undo());
  };
  view.onDelete = () => view.onDeleteIds([...view.selection]);

  view.onDuplicate = () => {
    const roots = topLevelSelection().concat([...view.selection].map((id) => store.live(id)).filter((e) => e?.type === 'line'));
    if (!roots.length) return;
    const map = new Map(); const changes = [];
    const all = new Set();
    for (const r of roots) { all.add(r); for (const d of store.descendants(r.id)) all.add(d); }
    for (const e of all) map.set(e.id, uid());
    let z = store.maxZ(view.boardId);
    for (const e of all) {
      const isRoot = roots.includes(e);
      const copy = { ...structuredClone(e), id: map.get(e.id), parentId: map.get(e.parentId) || e.parentId, created: Date.now() };
      if (e.type === 'line') copy.content = { ...copy.content, aId: map.get(copy.content.aId) || copy.content.aId, bId: map.get(copy.content.bId) || copy.content.bId };
      if (isRoot) {
        if (e.section === 'canvas') { copy.x = e.x + 28; copy.y = e.y + 28; copy.z = ++z; if (e.type === 'line') copy.content = { ...copy.content, a: { x: copy.content.a.x + 28, y: copy.content.a.y + 28 }, b: { x: copy.content.b.x + 28, y: copy.content.b.y + 28 }, aId: null, bId: null }; }
        else copy.order = e.order + 0.001;
      }
      changes.push({ id: copy.id, after: copy });
    }
    store.commit(changes, { label: 'Duplicate' });
    view.select(roots.map((r) => map.get(r.id)));
  };

  // ------------------------------------------------------------------ keyboard
  document.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space' && !isEditing(ev.target)) { space = true; vp.classList.add('pannable'); ev.preventDefault(); }
    const mod = ev.ctrlKey || ev.metaKey;
    const editing = isEditing(ev.target);
    if (mod && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !editing) { ev.preventDefault(); if (!store.undo()) toast('Nothing to undo'); return; }
    if (mod && (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z')) && !editing) { ev.preventDefault(); if (!store.redo()) toast('Nothing to redo'); return; }
    if (editing || document.body.classList.contains('presenting')) return;
    if (mod && ev.key.toLowerCase() === 'l') { ev.preventDefault(); view.layout.toggleLock(store, view); return; }
    if (ev.key === ']' && view.selection.size) { ev.preventDefault(); view.layout.stack(store, view, 'front'); return; }
    if (ev.key === '[' && view.selection.size) { ev.preventDefault(); view.layout.stack(store, view, 'back'); return; }
    if (ev.shiftKey && ev.code === 'Digit1') { ev.preventDefault(); view.fitAll({ animate: true }); return; }
    if (!mod && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'p') { ev.preventDefault(); view.onPresent?.(); return; }
    if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); view.onDuplicate(); }
    else if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); view.select(store.children(view.boardId, 'canvas').map((e) => e.id)); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { if (view.selection.size) { ev.preventDefault(); view.onDelete(); } }
    else if (ev.key === 'Escape') { if (view.drawing) { view.drawing = null; view.updateSelectionClasses(); view.updateContextBar(); } else view.clearSelection(); }
    else if (ev.key.startsWith('Arrow') && view.selection.size) {
      ev.preventDefault(); const d = ev.shiftKey ? 10 : 1; const dx = ev.key === 'ArrowLeft' ? -d : ev.key === 'ArrowRight' ? d : 0; const dy = ev.key === 'ArrowUp' ? -d : ev.key === 'ArrowDown' ? d : 0;
      const ch = [...view.selection].map((id) => store.live(id)).filter((e) => e && e.section === 'canvas' && !e.locked).map((e) => ({ id: e.id, after: e.type === 'line' ? { ...e, content: { ...e.content, a: { x: e.content.a.x + dx, y: e.content.a.y + dy }, b: { x: e.content.b.x + dx, y: e.content.b.y + dy } } } : { ...e, x: e.x + dx, y: e.y + dy } }));
      store.commit(ch, { label: 'Nudge', merge: 'nudge' });
    }
  });
  document.addEventListener('keyup', (ev) => { if (ev.code === 'Space') { space = false; vp.classList.remove('pannable'); } });

  // ------------------------------------------------------------------ paste
  document.addEventListener('paste', async (ev) => {
    if (isEditing(ev.target)) return;
    const files = [...(ev.clipboardData?.files || [])];
    const p = view.toWorld(vp.getBoundingClientRect().left + vp.clientWidth / 2, vp.getBoundingClientRect().top + vp.clientHeight / 2);
    const hit = { parentId: view.boardId, section: 'canvas', x: p.x - 140, y: p.y - 80 };
    if (files.length) { ev.preventDefault(); return addFiles(files, hit); }
    const text = ev.clipboardData?.getData('text/plain')?.trim(); if (!text) return;
    ev.preventDefault();
    if (/^https?:\/\/\S+$/i.test(text)) { const el = create('link', hit, { url: text, title: hostOf(text) }); view.onLinkPreview?.(el.id, text); }
    else create('note', hit, { html: text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>') });
  });

  return { create, zoomAt };
}
