// Layout operations on a selection: align, distribute, stacking order, lock.
// They work on top-level cards placed freely on a board (section "canvas"); cards inside columns/lists are
// positioned by their container, and connector lines follow whatever they are bound to.

/** movable = selected, live, free-placed, not a line, not locked; each with its measured world rect */
export function movable(store, view, { includeLocked = false } = {}) {
  const out = [];
  for (const id of view.selection) {
    const e = store.live(id); if (!e || e.type === 'line' || e.section !== 'canvas' || (e.locked && !includeLocked)) continue;
    const r = view.worldRect(id); if (r) out.push({ e, r });
  }
  return out;
}

const fix = (n) => Math.round(n * 10) / 10;

/** mode: left | center | right | top | middle | bottom (aligns to the selection's bounding box) */
export function align(store, view, mode) {
  const items = movable(store, view); if (items.length < 2) return 0;
  const L = Math.min(...items.map((i) => i.r.x)), R = Math.max(...items.map((i) => i.r.x + i.r.w));
  const T = Math.min(...items.map((i) => i.r.y)), B = Math.max(...items.map((i) => i.r.y + i.r.h));
  const changes = items.map(({ e, r }) => {
    let x = e.x, y = e.y;
    if (mode === 'left') x = L; else if (mode === 'right') x = R - r.w; else if (mode === 'center') x = (L + R) / 2 - r.w / 2;
    else if (mode === 'top') y = T; else if (mode === 'bottom') y = B - r.h; else if (mode === 'middle') y = (T + B) / 2 - r.h / 2;
    return { id: e.id, after: { ...e, x: fix(x), y: fix(y) } };
  });
  store.commit(changes, { label: `Align ${mode}` }); return changes.length;
}

/** axis: 'h' | 'v' — equal gaps between 3+ cards, keeping the outermost two where they are */
export function distribute(store, view, axis) {
  const items = movable(store, view); if (items.length < 3) return 0;
  const horiz = axis === 'h'; const pos = (i) => (horiz ? i.r.x : i.r.y), size = (i) => (horiz ? i.r.w : i.r.h);
  items.sort((a, b) => pos(a) + size(a) / 2 - (pos(b) + size(b) / 2));
  const first = items[0], last = items[items.length - 1];
  const span = pos(last) + size(last) - pos(first); const total = items.reduce((s, i) => s + size(i), 0); const gap = (span - total) / (items.length - 1);
  let cursor = pos(first); const changes = [];
  for (const it of items) {
    changes.push({ id: it.e.id, after: { ...it.e, ...(horiz ? { x: fix(cursor) } : { y: fix(cursor) }) } });
    cursor += size(it) + gap;
  }
  store.commit(changes, { label: horiz ? 'Distribute horizontally' : 'Distribute vertically' }); return changes.length;
}

/** where: 'front' | 'back' — among the free-placed cards of the same board (works on locked cards too) */
export function stack(store, view, where) {
  const sel = movable(store, view, { includeLocked: true }).map((i) => i.e).sort((a, b) => a.z - b.z); if (!sel.length) return 0;
  const parent = sel[0].parentId; const others = store.children(parent, 'canvas').filter((c) => !view.selection.has(c.id));
  const top = others.reduce((m, c) => Math.max(m, c.z), 0), bottom = others.reduce((m, c) => Math.min(m, c.z), 0);
  const changes = sel.map((e, i) => ({ id: e.id, after: { ...e, z: where === 'front' ? top + 1 + i : bottom - sel.length + i } }));
  store.commit(changes, { label: where === 'front' ? 'Bring to front' : 'Send to back' }); return changes.length;
}

/** toggle: if every selected card is locked, unlock them; otherwise lock them all */
export function toggleLock(store, view) {
  const els = [...view.selection].map((id) => store.live(id)).filter((e) => e && e.type !== 'line' && e.type !== 'task'); if (!els.length) return false;
  const lock = !els.every((e) => e.locked);
  store.commit(els.map((e) => ({ id: e.id, after: { ...e, locked: lock || undefined } })), { label: lock ? 'Lock position' : 'Unlock position' });
  return lock;
}

/** snap a group box to nearby edges/centres of other cards; returns the offset and the guide lines to draw */
export function snap(box, targets, threshold) {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w], ys = [box.y, box.y + box.h / 2, box.y + box.h];
  let bestX = null, bestY = null;
  for (const t of targets) {
    const tx = [t.x, t.x + t.w / 2, t.x + t.w], ty = [t.y, t.y + t.h / 2, t.y + t.h];
    for (const a of xs) for (const b of tx) { const d = b - a; if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d) - 0.001)) bestX = { d, at: b }; }
    for (const a of ys) for (const b of ty) { const d = b - a; if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d) - 0.001)) bestY = { d, at: b }; }
  }
  const dx = bestX ? bestX.d : 0, dy = bestY ? bestY.d : 0;
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides = [];
  if (bestX) { const hit = targets.filter((t) => [t.x, t.x + t.w / 2, t.x + t.w].some((v) => Math.abs(v - bestX.at) < 0.5)); const y1 = Math.min(moved.y, ...hit.map((t) => t.y)), y2 = Math.max(moved.y + moved.h, ...hit.map((t) => t.y + t.h)); guides.push({ x1: bestX.at, y1, x2: bestX.at, y2 }); }
  if (bestY) { const hit = targets.filter((t) => [t.y, t.y + t.h / 2, t.y + t.h].some((v) => Math.abs(v - bestY.at) < 0.5)); const x1 = Math.min(moved.x, ...hit.map((t) => t.x)), x2 = Math.max(moved.x + moved.w, ...hit.map((t) => t.x + t.w)); guides.push({ x1, y1: bestY.at, x2, y2: bestY.at }); }
  return { dx, dy, guides };
}
