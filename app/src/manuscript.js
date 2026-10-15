// Manuscript view: the current board read as a book. Columns are chapters, the notes inside them are scenes, boards are
// parts. Shows word counts and targets per chapter, lets you reorder chapters and scenes, and previews the compiled text.
import { t } from './i18n.js';
import { noteWords, compileMarkdown, readingMinutes, wordCount, mdToHtml } from './writer.js';

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const order = (els) => [...els].sort((a, b) => (Math.round(a.y / 120) - Math.round(b.y / 120)) || (a.x - b.x));
const firstLine = (html) => { const d = document.createElement('div'); d.innerHTML = String(html || '').replace(/<br\s*\/?>|<\/(div|p|li|h2|h3)>/gi, '\n'); return (d.textContent || '').split('\n').map((s) => s.trim()).find(Boolean) || ''; };

export function setupManuscript(ctx) {
  const { store, view } = ctx;
  let dlg = null, boardId = null, plain = false;
  const STAT = ['', 'draft', 'revise', 'done'];
  const compile = () => { const md = compileMarkdown(store, boardId); return plain ? md.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*(?!\*)(.+?)\*/g, '$1$2').replace(/^#{1,6} /gm, '') : md; };

  const patch = (id, content, label) => { const cur = store.live(id); if (cur) store.commit([{ id, after: { ...cur, content: { ...cur.content, ...content }, modified: Date.now() } }], { label }); };
  const sceneWords = (e) => (e.type === 'note' ? noteWords(e.content.html) : e.type === 'board' ? partWords(e.id) : 0);
  const partWords = (id) => store.descendants(id).filter((e) => e.type === 'note').reduce((n, e) => n + noteWords(e.content.html), 0);

  function structure(id) {
    const items = order(store.children(id, 'canvas').filter((e) => e.type !== 'line'));
    const out = [];
    for (const e of items) {
      if (e.type === 'column') out.push({ kind: 'chapter', e, scenes: store.children(e.id, 'stack').filter((k) => k.type === 'note' || k.type === 'board'), words: store.children(e.id, 'stack').reduce((n, k) => n + sceneWords(k), 0) });
      else if (e.type === 'board') out.push({ kind: 'part', e, words: partWords(e.id) });
      else if (e.type === 'note') out.push({ kind: 'loose', e, words: noteWords(e.content.html) });
    }
    return out;
  }

  // reorder: swap the canvas positions of two chapters, or renumber the scenes of a column
  const swapPos = (a, b) => store.commit([{ id: a.id, after: { ...a, x: b.x, y: b.y } }, { id: b.id, after: { ...b, x: a.x, y: a.y } }], { label: 'Reorder chapters' });
  const moveScene = (col, k, dir) => {
    const kids = store.children(col.id, 'stack'); const i = kids.findIndex((x) => x.id === k.id); const j = i + dir; if (i < 0 || j < 0 || j >= kids.length) return;
    const arr = kids.slice(); [arr[i], arr[j]] = [arr[j], arr[i]];
    store.commit(arr.map((x, n) => ({ id: x.id, after: { ...x, order: n } })), { label: 'Reorder scenes' });
  };
  const reveal = (e) => { dlg?.close(); ctx.reveal?.(e); };

  function render() {
    if (!dlg) return;
    const board = store.live(boardId) || store.get(boardId); if (!board) return dlg.close();
    const st = structure(boardId); const total = st.reduce((n, s) => n + s.words, 0);
    const goal = Number(board.content.target) || 0; const pct = goal ? Math.min(100, Math.round((total / goal) * 100)) : 0;
    const left = dlg.querySelector('.ms-list'), right = dlg.querySelector('.ms-prev'), top = dlg.querySelector('.ms-top');
    const name = board.parentId == null ? t('common.home') : board.content.title || t('common.untitled');
    const target = h('input', { type: 'number', min: 0, step: 1000, class: 'st-num', value: goal || '', placeholder: '0', 'aria-label': t('ms.target') });
    target.addEventListener('change', () => patch(boardId, { target: Math.max(0, Math.round(Number(target.value) || 0)) || null }, 'Set target'));
    top.replaceChildren(h('div', {}, h('h3', {}, t('ms.title', { name })), h('div', { class: 'muted ms-sub' }, t('ms.total', { n: total, m: readingMinutes(total) }))),
      h('div', { class: 'ms-goal' }, h('label', {}, t('ms.target'), target), goal ? h('div', { class: 'ms-bar' }, h('span', { style: `width:${pct}%` })) : null, goal ? h('span', { class: 'muted' }, `${pct}%`) : null));

    const chapters = st.filter((s) => s.kind === 'chapter');
    left.replaceChildren(...(st.length ? st.map((s) => {
      const e = s.e; const title = e.content.title || firstLine(e.content.html) || t('common.untitled');
      const idx = chapters.indexOf(s);
      const card = h('div', { class: 'ms-ch ms-' + s.kind });
      const tgt = s.kind === 'chapter' ? Number(e.content.target) || 0 : 0;
      const head = h('div', { class: 'ms-chh' },
        h('button', { type: 'button', class: 'ms-name', onclick: () => reveal(e) }, (s.kind === 'part' ? '📁 ' : '') + title),
        h('span', { class: 'ms-w' }, t('wr.words', { n: s.words })));
      if (s.kind === 'chapter') {
        const ti = h('input', { type: 'number', min: 0, step: 100, class: 'st-num ms-tgt', value: tgt || '', placeholder: t('ms.chTarget'), 'aria-label': t('ms.chTarget') });
        ti.addEventListener('change', () => patch(e.id, { target: Math.max(0, Math.round(Number(ti.value) || 0)) || null }, 'Set chapter target'));
        head.append(ti, h('button', { type: 'button', class: 'ib', disabled: idx <= 0, 'aria-label': t('ms.up'), title: t('ms.up'), onclick: () => swapPos(e, chapters[idx - 1].e) }, '↑'),
          h('button', { type: 'button', class: 'ib', disabled: idx >= chapters.length - 1, 'aria-label': t('ms.down'), title: t('ms.down'), onclick: () => swapPos(e, chapters[idx + 1].e) }, '↓'));
      }
      card.append(head);
      if (tgt) card.append(h('div', { class: 'ms-bar' + (s.words >= tgt ? ' hit' : '') }, h('span', { style: `width:${Math.min(100, Math.round((s.words / tgt) * 100))}%` })));
      if (s.kind === 'chapter') card.append(h('ol', { class: 'ms-scenes' }, ...s.scenes.map((k) => h('li', {},
        h('button', { type: 'button', class: 'ms-scene', onclick: () => reveal(k) }, k.type === 'board' ? '📁 ' + (k.content.title || '') : firstLine(k.content.html) || t('ms.emptyScene')),
        k.type === 'note' ? h('button', { type: 'button', class: 'ms-stat', 'data-s': k.content.status || '', title: t('st.tip'), onclick: () => patch(k.id, { status: STAT[(STAT.indexOf(k.content.status || '') + 1) % STAT.length] }, 'Note status') }, t('st.' + (k.content.status || 'none'))) : null,
        h('span', { class: 'ms-w' }, String(sceneWords(k))),
        h('button', { type: 'button', class: 'ib', 'aria-label': t('ms.up'), onclick: () => moveScene(e, k, -1) }, '↑'), h('button', { type: 'button', class: 'ib', 'aria-label': t('ms.down'), onclick: () => moveScene(e, k, 1) }, '↓')))));
      return card;
    }) : [h('p', { class: 'muted' }, t('ms.empty'))]));
    right.textContent = compile();
  }

  function printIt() {
    let doc = document.querySelector('.ms-printdoc'); if (!doc) { doc = h('div', { class: 'ms-printdoc' }); document.body.append(doc); }
    doc.innerHTML = mdToHtml(compile()); document.body.classList.add('ms-printing');
    const done = () => { document.body.classList.remove('ms-printing'); doc.remove(); removeEventListener('afterprint', done); }; addEventListener('afterprint', done); setTimeout(() => print(), 50);
  }

  function open(id) {
    boardId = id || view.boardId; dlg?.remove();
    dlg = h('dialog', { class: 'ms-dlg', 'aria-label': t('ms.heading') },
      h('header', { class: 'ms-head' }, h('div', { class: 'ms-top' }), h('div', { class: 'ms-acts' },
        h('label', { class: 'ms-opt' }, h('input', { type: 'checkbox', onchange: (e) => { plain = e.target.checked; render(); } }), t('ms.plain')),
        h('button', { type: 'button', class: 'tb', onclick: () => ctx.writer.copyText(boardId) }, t('wr.copyText')), h('button', { type: 'button', class: 'tb', onclick: () => ctx.writer.downloadMd(boardId) }, t('wr.exportMd')),
        h('button', { type: 'button', class: 'tb', onclick: printIt }, t('ms.print')),
        h('button', { type: 'button', class: 'ib', 'aria-label': t('common.close'), onclick: () => dlg.close() }, '×'))),
      h('div', { class: 'ms-cols' }, h('div', { class: 'ms-list' }), h('div', { class: 'ms-pwrap' }, h('div', { class: 'ms-ptitle muted' }, t('ms.preview')), h('pre', { class: 'ms-prev' }))));
    document.body.append(dlg);
    const unsub = store.subscribe((info) => { if (dlg?.open && (info.local || !document.activeElement?.closest?.('.ms-dlg input'))) render(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { unsub(); dlg.remove(); dlg = null; });
    render(); dlg.showModal(); document.activeElement?.blur?.();
  }
  window.addEventListener('lang-change', () => { if (dlg?.open) render(); });
  return { open, wordCount };
}
