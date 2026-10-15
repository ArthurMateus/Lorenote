// Tools for writers: word counts, a distraction-free writing view, quick idea capture into an inbox board,
// compiling a board into Markdown, and a daily word goal.
import { t, getLang } from './i18n.js';
import { makeElement, sanitizeHtml } from './model.js';
import { attachSlash } from './slash.js';

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ------------------------------------------------------------------ counting
const htmlText = (html) => { const d = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html'); for (const br of d.querySelectorAll('br,p,div,li,h2,h3,blockquote,pre')) br.after(' '); return d.body.textContent || ''; };
export const wordCount = (text) => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
export const noteWords = (html) => wordCount(htmlText(html));
export const readingMinutes = (words) => Math.max(1, Math.round(words / 230));
export function totalWords(store) { let n = 0; for (const e of Object.values(store.elements)) if (e.type === 'note' && !e.trashed) n += noteWords(e.content.html); return n; }

// ------------------------------------------------------------------ compile a board to Markdown
function htmlToMd(html) {
  const doc = new DOMParser().parseFromString(`<body>${sanitizeHtml(html)}</body>`, 'text/html');
  const walk = (node, ctx = {}) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.data; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName; const inner = () => walk(n, ctx);
      if (tag === 'b' || tag === 'strong') out += `**${inner()}**`;
      else if (tag === 'i' || tag === 'em') out += `*${inner()}*`;
      else if (tag === 's' || tag === 'strike') out += `~~${inner()}~~`;
      else if (tag === 'code') out += '`' + inner() + '`';
      else if (tag === 'a') out += `[${inner()}](${n.getAttribute('href') || ''})`;
      else if (tag === 'br') out += '\n';
      else if (tag === 'h2') out += `\n\n### ${inner().trim()}\n\n`;
      else if (tag === 'h3') out += `\n\n#### ${inner().trim()}\n\n`;
      else if (tag === 'blockquote') out += '\n\n' + inner().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      else if (tag === 'pre') out += '\n\n```\n' + n.textContent.replace(/\n+$/, '') + '\n```\n\n';
      else if (tag === 'hr') out += '\n\n---\n\n';
      else if (tag === 'ul' || tag === 'ol') out += '\n' + [...n.children].map((li, i) => `${tag === 'ol' ? i + 1 + '.' : '-'} ${walk(li, ctx).trim()}`).join('\n') + '\n';
      else if (tag === 'div' || tag === 'p') out += '\n' + inner() + '\n';
      else out += inner();
    }
    return out;
  };
  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
function dbMd(c) {
  const props = c.props || []; if (!c.rows?.length) return '';
  const head = ['Name', ...props.map((p) => p.name)];
  const label = (p, v) => (p.type === 'select' || p.type === 'status' ? p.options.find((o) => o.id === v)?.label || '' : p.type === 'checkbox' ? (v ? '✓' : '') : v ?? '');
  return [`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...c.rows.map((r) => `| ${[r.title, ...props.map((p) => label(p, r.cells[p.id]))].map(cell).join(' | ')} |`)].join('\n');
}
/** reading order: rows of cards top to bottom, left to right inside a row */
const readingOrder = (els) => [...els].sort((a, b) => (Math.round(a.y / 120) - Math.round(b.y / 120)) || (a.x - b.x));

export function compileMarkdown(store, boardId, depth = 1, seen = new Set()) {
  const board = store.get(boardId); if (!board || seen.has(boardId)) return '';
  seen.add(boardId);
  const name = board.parentId == null && (!board.content.title || board.content.title === 'Home') ? t('common.home') : board.content.title || t('common.untitled');
  const parts = [`${'#'.repeat(Math.min(depth, 6))} ${name}`];
  const emit = (e, d) => {
    switch (e.type) {
      case 'note': { const md = htmlToMd(e.content.html); return md || null; }
      case 'task': return `- [${e.content.done ? 'x' : ' '}] ${e.content.text}`;
      case 'todo': { const tasks = store.children(e.id, 'stack').map((k) => emit(k, d)).filter(Boolean).join('\n'); return (e.content.showTitle && e.content.title ? `**${e.content.title}**\n\n` : '') + tasks; }
      case 'column': { const kids = store.children(e.id, 'stack').map((k) => emit(k, d + 1)).filter(Boolean).join('\n\n'); return `${'#'.repeat(Math.min(d + 1, 6))} ${e.content.title || ''}\n\n${kids}`.trim(); }
      case 'table': return (e.content.rows || []).map((r, i, all) => `| ${r.map(cell).join(' | ')} |` + (i === 0 ? `\n| ${r.map(() => '---').join(' | ')} |` : '')).join('\n');
      case 'database': return `**${e.content.title || ''}**\n\n${dbMd(e.content)}`;
      case 'link': return e.content.url ? `[${e.content.title || e.content.url}](${e.content.url})` : null;
      case 'board': return compileMarkdown(store, e.id, d + 1, seen);
      default: return null;
    }
  };
  const top = readingOrder(store.children(boardId, 'canvas').filter((e) => e.type !== 'line' && !e.trashed));
  for (const e of top) { const s = emit(e, depth); if (s) parts.push(s); }
  return parts.join('\n\n') + '\n';
}

// ------------------------------------------------------------------ writer tools
export function setupWriter(ctx) {
  const { store, view, toast } = ctx;
  const patch = (id, content, label, merge) => { const cur = store.live(id); if (!cur) return; store.commit([{ id, after: { ...cur, content: { ...cur.content, ...content }, modified: Date.now() } }], { label, merge }); };

  // ---- distraction-free writing view
  function focus(id) {
    let note = id ? store.live(id) : null;
    if (!note || note.type !== 'note') {
      note = makeElement('note', view.boardId, { x: 80, y: 80, z: store.maxZ(view.boardId) + 1, content: { html: '' } });
      store.commit([{ id: note.id, after: note }], { label: 'New note' });
    }
    const nid = note.id; let timer = null;
    const dlg = h('dialog', { class: 'fx-dlg', 'aria-label': t('wr.focus') });
    const ed = h('div', { class: 'fx-ed', contenteditable: 'true', 'data-placeholder': t('wr.placeholder'), spellcheck: 'true' });
    const stat = h('span', { class: 'fx-stat' });
    const count = () => { const w = noteWords(ed.innerHTML); stat.textContent = t('wr.stat', { n: w, m: readingMinutes(w) }); };
    const save = () => { clearTimeout(timer); const html = sanitizeHtml(ed.innerHTML); const cur = store.live(nid); if (cur && cur.content.html !== html) patch(nid, { html }, 'Edit note', 'fx' + nid); };
    ed.innerHTML = sanitizeHtml(note.content.html || ''); attachSlash(ed);
    ed.addEventListener('input', () => { count(); clearTimeout(timer); timer = setTimeout(save, 500); });
    ed.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); });
    ed.addEventListener('keydown', (ev) => { ev.stopPropagation(); });
    dlg.append(h('header', { class: 'fx-bar' }, h('span', { class: 'fx-hint' }, t('wr.esc')), stat, h('button', { type: 'button', class: 'btn primary', onclick: () => dlg.close() }, t('wr.done'))), h('div', { class: 'fx-wrap' }, ed));
    dlg.addEventListener('close', () => { save(); dlg.remove(); view.render(); });
    dlg.addEventListener('cancel', () => save());
    document.body.append(dlg); dlg.showModal(); count();
    ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  // ---- quick capture into an "Idea inbox" board
  function inboxBoard() {
    const root = store.rootId;
    let b = Object.values(store.elements).find((e) => e.type === 'board' && e.content.inbox && !e.trashed);
    if (!b) {
      b = makeElement('board', root, { x: 80, y: 80, z: store.maxZ(root) + 1, content: { title: t('wr.inbox'), icon: '💡', tint: '#e0af68', inbox: true } });
      const free = store.children(root, 'canvas').filter((e) => e.type !== 'line'); b.x = 60 + (free.length % 6) * 130; b.y = 60 + Math.floor(free.length / 6) * 130;
      store.commit([{ id: b.id, after: b }], { label: 'New board' });
    }
    return b;
  }
  function capture(text) {
    const body = String(text || '').trim(); if (!body) return null;
    const b = inboxBoard(); const n = store.children(b.id, 'canvas').filter((e) => e.type !== 'line').length;
    const html = esc(body).replace(/(^|\s)(#[\p{L}\d_-]+)/gu, '$1<b>$2</b>').replace(/\n/g, '<br>');
    const el = makeElement('note', b.id, { x: 60 + (n % 4) * 260, y: 60 + Math.floor(n / 4) * 170, z: store.maxZ(b.id) + 1, content: { html }, color: '#fff7c2' });
    store.commit([{ id: el.id, after: el }], { label: 'Capture idea' });
    return b;
  }
  function openCapture() {
    const dlg = h('dialog', { class: 'cap-dlg', 'aria-label': t('wr.capture') });
    const ta = h('textarea', { rows: 4, placeholder: t('wr.capturePh'), maxlength: 5000, spellcheck: 'true' });
    const go = () => {
      const b = capture(ta.value); if (!b) { ta.focus(); return; }
      dlg.close(); toast(t('wr.captured', { board: b.content.title }), () => view.onOpen?.(b.id), t('wr.openInbox'), 6000);
    };
    ta.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); go(); } else if (ev.key === 'Escape') dlg.close(); });
    dlg.append(h('div', { class: 'cap-body' }, h('h3', {}, t('wr.capture')), ta, h('div', { class: 'cap-foot' }, h('span', { class: 'muted' }, t('wr.captureHint')), h('button', { type: 'button', class: 'btn primary', onclick: go }, t('wr.save')))));
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); }); dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal(); ta.focus();
  }

  // ---- compile / export
  const nameOf = (id) => { const b = store.get(id); return (b?.content.title || 'board').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60) || 'board'; };
  function compileFor(id) { const e = store.get(id); if (e?.type === 'column') { const tmp = compileColumn(e); return tmp; } return compileMarkdown(store, id || view.boardId); }
  function compileColumn(col) {
    const parts = [`# ${col.content.title || ''}`];
    for (const k of store.children(col.id, 'stack')) { if (k.type === 'note') parts.push(htmlToMd(k.content.html)); else if (k.type === 'task') parts.push(`- [${k.content.done ? 'x' : ' '}] ${k.content.text}`); else if (k.type === 'board') parts.push(compileMarkdown(store, k.id, 2)); }
    return parts.filter(Boolean).join('\n\n') + '\n';
  }
  async function copyText(id) {
    const md = compileFor(id); try { await navigator.clipboard.writeText(md); toast(t('wr.copied', { n: wordCount(md) })); } catch { toast(t('wr.copyFail')); }
  }
  function downloadMd(id) {
    const md = compileFor(id); const a = h('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: nameOf(id || view.boardId) + '.md' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(t('wr.exported', { n: wordCount(md) }));
  }

  // ---- daily word goal chip
  const chip = document.querySelector('#wc-chip'); let base = null;
  const dayKey = () => new Date().toISOString().slice(0, 10);
  function baseline(total) {
    try { const s = JSON.parse(localStorage.getItem('lorenote.wc.day') || 'null'); if (s && s.date === dayKey()) return s.start; localStorage.setItem('lorenote.wc.day', JSON.stringify({ date: dayKey(), start: total })); } catch { /* private mode */ }
    return total;
  }
  let tick = null;
  function paintChip() {
    if (!chip) return; const goal = Number(store.prefs.wordGoal) || 0;
    if (!goal) { chip.hidden = true; return; }
    const total = totalWords(store); if (base == null) base = baseline(total);
    const done = Math.max(0, total - base); const pct = Math.min(100, Math.round((done / goal) * 100));
    chip.hidden = false; chip.style.setProperty('--p', pct + '%'); chip.classList.toggle('hit', done >= goal);
    chip.textContent = t('wr.goalChip', { done, goal }); chip.title = t('wr.goalTip', { n: total });
  }
  const schedule = () => { clearTimeout(tick); tick = setTimeout(paintChip, 900); };
  store.subscribe((i) => { if (i.patches?.length || i.pref === 'wordGoal' || i.reset) schedule(); });
  chip?.addEventListener('click', () => ctx.openSettings?.('writing'));
  setTimeout(paintChip, 600);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); openCapture(); }
  });
  return { focus, openCapture, capture, copyText, downloadMd, paintChip, compileMarkdown: (id) => compileFor(id) };
}
