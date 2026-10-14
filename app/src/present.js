// Presentation mode: hides the interface and flies the camera across the board, one card at a time.
// Step 0 is the whole board; then cards in reading order (rows top to bottom, each left to right).
export function setupPresent(view, store, toast) {
  const hud = document.querySelector('#present-hud'), count = document.querySelector('#present-count');
  let steps = [], i = 0, saved = null, active = false;

  function plan() {
    const cards = store.children(view.boardId, 'canvas').filter((e) => e.type !== 'line' && view.worldRect(e.id)).map((e) => ({ e, r: view.worldRect(e.id) }));
    cards.sort((a, b) => a.r.y - b.r.y);
    const rows = []; for (const c of cards) { const row = rows.find((r) => Math.abs(r.y - c.r.y) < Math.max(60, c.r.h * 0.6)); if (row) row.items.push(c); else rows.push({ y: c.r.y, items: [c] }); }
    rows.sort((a, b) => a.y - b.y); for (const r of rows) r.items.sort((a, b) => a.r.x - b.r.x);
    return rows.flatMap((r) => r.items);
  }
  function go(n) {
    i = Math.max(0, Math.min(steps.length, n));
    if (i === 0) view.fitAll({ animate: true, pad: 70 }); else { const s = steps[i - 1]; view.select([s.e.id]); view.fitRect(view.worldRect(s.e.id) || s.r, { animate: true, pad: 110, maxScale: 1.6 }); }
    count.textContent = `${i} / ${steps.length}`; if (i === 0) view.clearSelection();
  }
  const next = () => { if (i < steps.length) go(i + 1); }, prev = () => { if (i > 0) go(i - 1); };

  function start() {
    steps = plan(); if (!steps.length) return toast('Nothing to present yet. Add some cards first.');
    saved = { tx: view.tx, ty: view.ty, scale: view.scale }; active = true; view.clearSelection();
    document.body.classList.add('presenting'); hud.hidden = false; view.drawing = null;
    try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch { /* not allowed */ }
    requestAnimationFrame(() => { view.applyTransform(); go(0); }); view.onPresenting?.(true);
  }
  function stop() {
    if (!active) return; active = false; document.body.classList.remove('presenting'); hud.hidden = true; view.clearSelection();
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* ignore */ }
    view.animateTo(saved, 350); view.onPresenting?.(false);
  }

  // capture-phase so nothing else reacts while presenting
  document.addEventListener('keydown', (ev) => {
    if (!active) return;
    const k = ev.key; const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'], prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
    if (k === 'Escape') stop(); else if (nextKeys.includes(k)) next(); else if (prevKeys.includes(k)) prev(); else if (k === 'Home') go(0); else if (k === 'End') go(steps.length); else return;
    ev.preventDefault(); ev.stopImmediatePropagation();
  }, true);
  view.dom.viewport.addEventListener('click', (ev) => { if (!active || ev.target.closest('#present-hud')) return; const r = view.dom.viewport.getBoundingClientRect(); if (ev.clientX < r.left + r.width * 0.25) prev(); else next(); });
  document.querySelector('#present-next').onclick = next; document.querySelector('#present-prev').onclick = prev; document.querySelector('#present-exit').onclick = stop;
  document.addEventListener('fullscreenchange', () => { if (active && !document.fullscreenElement && matchMedia('(display-mode: browser)').matches === false) { /* installed app: leave as is */ } });
  return { start, stop, isActive: () => active };
}
