// Minimap: a small overview of the current board with the visible area outlined. Click or drag to move around.
const FILL = { note: '#f2c94c', todo: '#6fcf97', column: '#9aa5b8', board: '#7aa2f7', table: '#bb9af7', database: '#bb9af7', image: '#f2994a', link: '#56ccf2', comment: '#eb5757', file: '#a0a6b5', sketch: '#c4a484', task: '#6fcf97' };

export function setupMinimap(view, store) {
  const cv = document.querySelector('#minimap'); const ctx = cv.getContext('2d'); let raf = 0, geo = null;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

  function worldBounds() {
    const rects = [];
    for (const e of store.children(view.boardId, 'canvas')) { if (e.type === 'line') continue; const r = view.worldRect(e.id); if (r) rects.push({ r, type: e.type }); }
    return rects;
  }
  function draw() {
    raf = 0;
    const show = store.prefs.minimap !== false && !document.body.classList.contains('presenting') && !matchMedia('(max-width: 760px)').matches;
    const items = show ? worldBounds() : [];
    cv.hidden = !show || !items.length; if (cv.hidden) return;
    const W = cv.width, H = cv.height; const vp = view.dom.viewport.getBoundingClientRect();
    const vw = view.toWorld(vp.left, vp.top), ve = view.toWorld(vp.right, vp.bottom); const view_ = { x: vw.x, y: vw.y, w: ve.x - vw.x, h: ve.y - vw.y };
    let x1 = Math.min(view_.x, ...items.map((i) => i.r.x)), y1 = Math.min(view_.y, ...items.map((i) => i.r.y));
    let x2 = Math.max(view_.x + view_.w, ...items.map((i) => i.r.x + i.r.w)), y2 = Math.max(view_.y + view_.h, ...items.map((i) => i.r.y + i.r.h));
    const pad = 30; x1 -= pad; y1 -= pad; x2 += pad; y2 += pad;
    const k = Math.min(W / (x2 - x1), H / (y2 - y1)); const ox = (W - (x2 - x1) * k) / 2 - x1 * k, oy = (H - (y2 - y1) * k) / 2 - y1 * k;
    geo = { k, ox, oy };
    ctx.clearRect(0, 0, W, H);
    for (const { r, type } of items) { ctx.fillStyle = FILL[type] || '#999'; ctx.globalAlpha = 0.85; const x = r.x * k + ox, y = r.y * k + oy; ctx.beginPath(); ctx.roundRect(x, y, Math.max(3, r.w * k), Math.max(3, r.h * k), 3); ctx.fill(); }
    ctx.globalAlpha = 1; const acc = css('--accent');
    ctx.fillStyle = acc + '22'; ctx.strokeStyle = acc; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(view_.x * k + ox, view_.y * k + oy, view_.w * k, view_.h * k, 4); ctx.fill(); ctx.stroke();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  view.onViewChange = schedule; const prev = view.onRendered; view.onRendered = () => { prev?.(); schedule(); };
  addEventListener('resize', schedule);

  function pan(ev) {
    if (!geo) return; const r = cv.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * cv.width, py = ((ev.clientY - r.top) / r.height) * cv.height;
    const wx = (px - geo.ox) / geo.k, wy = (py - geo.oy) / geo.k; const vp = view.dom.viewport.getBoundingClientRect();
    view.tx = vp.width / 2 - wx * view.scale; view.ty = vp.height / 2 - wy * view.scale; view.applyTransform();
  }
  cv.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); try { cv.setPointerCapture(ev.pointerId); } catch { /* synthetic or already released */ } pan(ev); const move = (e) => pan(e); const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); }; cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); });
  schedule(); return { schedule };
}
