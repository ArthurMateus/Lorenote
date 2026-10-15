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
export function totalWords(store) { let n = 0; for (const e of Object.values(store.elements)) if (e.type === 'note' && !e.trashed && store.reachable(e)) n += noteWords(e.content.html); return n; }

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

export function compileMarkdown(store, boardId, depth = 1, seen = new Set(), opts = {}) {
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
      case 'board': return compileMarkdown(store, e.id, d + 1, seen, opts);
      default: return null;
    }
  };
  const top = readingOrder(store.children(boardId, 'canvas').filter((e) => e.type !== 'line' && !e.trashed));
  const hasStructure = top.some((e) => e.type === 'column' || e.type === 'board');
  for (const e of top) { if (opts.skipLoose && hasStructure && (e.type === 'note' || e.type === 'table' || e.type === 'link' || e.type === 'database')) continue; const s = emit(e, depth); if (s) parts.push(s); }
  return parts.join('\n\n') + '\n';
}

/** minimal Markdown to HTML for printing a manuscript; everything is escaped first, so it cannot inject markup */
export function mdToHtml(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\*)(.+?)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let para = [], list = false;
  const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } if (list) { out.push('</ul>'); list = false; } };
  for (const line of String(md).split('\n')) {
    const h1 = /^(#{1,6}) (.*)$/.exec(line);
    if (h1) { flush(); out.push(`<h${h1[1].length}>${inline(h1[2])}</h${h1[1].length}>`); }
    else if (/^---+$/.test(line)) { flush(); out.push('<hr>'); }
    else if (/^[-*] /.test(line)) { if (!list) { flush(); out.push('<ul>'); list = true; } out.push('<li>' + inline(line.slice(2)) + '</li>'); }
    else if (!line.trim()) flush();
    else para.push(line);
  }
  flush(); return out.join('\n');
}

const mentionsIn = (store, id) => Object.values(store.elements).filter((e) => e.type === 'note' && !e.trashed && store.reachable(e) && String(e.content.html || '').includes('#ref-' + id));
const tagsOf = (text) => [...new Set((String(text).match(/(^|\s)#[\p{L}\d_-]{2,30}/gu) || []).map((s) => s.trim().toLowerCase()))];

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
    const live = document.querySelector(`[data-id="${nid}"] .note-text`);      // text typed in the card but not committed yet (the editor has not lost focus)
    if (live) { const h0 = sanitizeHtml(live.innerHTML); if (store.live(nid) && store.live(nid).content.html !== h0) { patch(nid, { html: h0 }, 'Edit note'); note = store.live(nid); } }
    const FXK = 'lorenote.fx'; let fx = { size: 21, tw: false }; try { fx = { ...fx, ...JSON.parse(localStorage.getItem(FXK) || '{}') }; } catch { /* private mode */ }
    const saveFx = () => { try { localStorage.setItem(FXK, JSON.stringify(fx)); } catch { /* private mode */ } };
    const dlg = h('dialog', { class: 'fx-dlg', 'aria-label': t('wr.focus') });
    const ed = h('div', { class: 'fx-ed', contenteditable: 'true', 'data-placeholder': t('wr.placeholder'), spellcheck: 'true' });
    const stat = h('span', { class: 'fx-stat' });
    ed.style.fontSize = fx.size + 'px';
    const snaps = () => (store.live(nid)?.content.snapshots || []);
    const pushSnap = (html) => { if (!html || !noteWords(html)) return false; const list = snaps(); if (list.length && list[list.length - 1].html === html) return false; patch(nid, { snapshots: [...list, { t: Date.now(), html, w: noteWords(html) }].slice(-15) }, 'Snapshot'); return true; };
    const histBtn = h('button', { type: 'button', class: 'tb', title: t('wr.historyTip'), onclick: () => showHistory() }, t('wr.history'));
    let pop = null;
    const showHistory = () => {
      if (pop) { pop.remove(); pop = null; return; }
      pop = h('div', { class: 'fx-pop' }, h('div', { class: 'muted', style: 'font-size:12px;padding:4px 8px' }, t('wr.historyHint')),
        ...(snaps().length ? snaps().slice().reverse().map((s) => h('div', { class: 'fx-snap' }, h('span', { title: htmlText(s.html).trim().slice(0, 300) }, new Date(s.t).toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' + t('wr.words', { n: s.w }), h('small', { class: 'fx-prev' }, htmlText(s.html).replace(/\s+/g, ' ').trim().slice(0, 90) + '…')),
          h('button', { type: 'button', class: 'tb', onclick: () => { save(); pushSnap(sanitizeHtml(ed.innerHTML)); ed.innerHTML = sanitizeHtml(s.html); save(); count(); pop.remove(); pop = null; } }, t('wr.restore')))) : [h('div', { class: 'muted', style: 'padding:8px' }, t('wr.noSnaps'))]));
      dlg.querySelector('.fx-bar').after(pop);
    };
    const count = () => { const w = noteWords(ed.innerHTML); stat.textContent = t('wr.stat', { n: w, m: readingMinutes(w) }); };
    const save = () => { clearTimeout(timer); const html = sanitizeHtml(ed.innerHTML); const cur = store.live(nid); if (cur && cur.content.html !== html) patch(nid, { html }, 'Edit note', 'fx' + nid); };
    ed.innerHTML = sanitizeHtml(note.content.html || ''); attachSlash(ed);
    ed.addEventListener('input', () => { count(); clearTimeout(timer); timer = setTimeout(save, 500); });
    ed.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); });
    ed.addEventListener('keydown', (ev) => { ev.stopPropagation(); });
    const sizeBtn = (d, label) => h('button', { type: 'button', class: 'ib', title: t('wr.size'), 'aria-label': t('wr.size'), onclick: () => { fx.size = Math.max(15, Math.min(34, fx.size + d)); ed.style.fontSize = fx.size + 'px'; saveFx(); } }, label);
    const twBtn = h('button', { type: 'button', class: 'tb' + (fx.tw ? ' on' : ''), 'aria-pressed': String(fx.tw), title: t('wr.typewriterTip'), onclick: () => { fx.tw = !fx.tw; twBtn.classList.toggle('on', fx.tw); twBtn.setAttribute('aria-pressed', String(fx.tw)); saveFx(); } }, t('wr.typewriter'));
    const wrap = h('div', { class: 'fx-wrap' }, ed);
    dlg.addEventListener('mousedown', (ev) => { if (ev.target.closest('.fx-bar button:not(.primary), .fx-pop button')) ev.preventDefault(); });      // toolbar clicks must not steal the cursor from the text
    const centre = () => { if (!fx.tw) return; const s = getSelection(); if (!s.rangeCount) return; const r = s.getRangeAt(0).getBoundingClientRect(); if (!r.height && !r.top) return; const wr = wrap.getBoundingClientRect(); wrap.scrollTop += r.top - (wr.top + wr.height / 2); };
    ed.addEventListener('input', centre); ed.addEventListener('keyup', (ev) => { if (ev.key.startsWith('Arrow') || ev.key === 'Enter') centre(); });
    dlg.append(h('header', { class: 'fx-bar' }, h('span', { class: 'fx-hint' }, t('wr.esc')), stat, sizeBtn(-1, 'A−'), sizeBtn(1, 'A+'), twBtn,
      h('button', { type: 'button', class: 'tb', title: t('wr.snapshotTip'), onclick: (ev) => { save(); const ok = pushSnap(sanitizeHtml(ed.innerHTML)); ev.target.textContent = ok ? t('wr.snapshotted') : t('wr.snapshot'); setTimeout(() => { ev.target.textContent = t('wr.snapshot'); }, 1500); } }, t('wr.snapshot')), histBtn,
      h('button', { type: 'button', class: 'btn primary', onclick: () => dlg.close() }, t('wr.done'))), wrap);
    dlg.addEventListener('close', () => { save(); dlg.remove(); view.render(); });
    dlg.addEventListener('cancel', () => save());
    { const last = snaps().at(-1); const cur = sanitizeHtml(note.content.html || ''); if (cur && (!last || (last.html !== cur && Date.now() - last.t > 30 * 60e3))) pushSnap(cur); }      // automatic safety copy of the draft as it was when you opened it
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
  const chip = document.querySelector('#wc-chip'); let base = null, baseDay = null;
  const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function baseline(total) {
    try { const s = JSON.parse(localStorage.getItem('lorenote.wc.day') || 'null'); if (s && s.date === dayKey()) return s.start; localStorage.setItem('lorenote.wc.day', JSON.stringify({ date: dayKey(), start: total })); } catch { /* private mode */ }
    return total;
  }
  let tick = null;
  function readToday() { try { const s = JSON.parse(localStorage.getItem('lorenote.wc.today') || 'null'); if (s && s.date === dayKey()) return s.n; } catch { /* private mode */ } return 0; }
  function addToday(n) {
    try {
      localStorage.setItem('lorenote.wc.today', JSON.stringify({ date: dayKey(), n: readToday() + n }));
      const hist = JSON.parse(localStorage.getItem('lorenote.wc.hist') || '{}'); hist[dayKey()] = readToday(); const keys = Object.keys(hist).sort().slice(-400); localStorage.setItem('lorenote.wc.hist', JSON.stringify(Object.fromEntries(keys.map((k) => [k, hist[k]]))));
    } catch { /* private mode */ }
  }
  function streak(goal) {
    try {
      const hist = JSON.parse(localStorage.getItem('lorenote.wc.hist') || '{}'); let n = 0; const d = new Date();
      const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      if ((hist[key(d)] || 0) < goal) d.setDate(d.getDate() - 1);      // today still in progress: count from yesterday
      while ((hist[key(d)] || 0) >= goal && n < 400) { n++; d.setDate(d.getDate() - 1); }
      return n;
    } catch { return 0; }
  }
  function paintChip() {
    if (!chip) return; const goal = Number(store.prefs.wordGoal) || 0;
    if (!goal) { chip.hidden = true; return; }
    const total = totalWords(store);
    const done = readToday(); const pct = Math.min(100, Math.round((done / goal) * 100));
    chip.hidden = false; chip.style.setProperty('--p', pct + '%'); chip.classList.toggle('hit', done >= goal);
    chip.textContent = matchMedia('(max-width: 1100px)').matches ? `${done}/${goal}` : t('wr.goalChip', { done, goal }); chip.title = t('wr.goalTip', { n: total }) + (streak(goal) ? ' ' + t('wr.streak', { n: streak(goal) }) : '');
  }
  const schedule = () => { clearTimeout(tick); tick = setTimeout(paintChip, 900); };
  store.subscribe((i) => {
    if (i.local && !i.reset) for (const p of i.patches || []) {
      if (p.before?.type !== 'note' || p.after?.type !== 'note') continue;      // templates, captures and imports create cards; only typing in existing notes counts
      const d = noteWords(p.after.content.html) - noteWords(p.before.content.html); if (d > 0 && d < 3000) addToday(d);
    }
    if (i.patches?.length || i.pref === 'wordGoal' || i.reset) schedule();
  });
  chip?.addEventListener('click', () => ctx.openSettings?.('writing'));
  setTimeout(paintChip, 600);
  window.addEventListener('lang-change', paintChip);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); openCapture(); }
  });
  // ---- tags: every #tag in your notes, with counts and the notes behind each
  function openTags() {
    const notes = Object.values(store.elements).filter((e) => e.type === 'note' && !e.trashed && store.reachable(e));
    const map = new Map(); for (const n of notes) for (const tg of tagsOf(htmlText(n.content.html))) { if (!map.has(tg)) map.set(tg, []); map.get(tg).push(n); }
    const dlg = h('dialog', { class: 'tag-dlg', 'aria-label': t('wr.tags') }); let cur = null;
    const list = h('div', { class: 'tag-list' }), hits = h('div', { class: 'tag-hits' });
    const showHits = () => hits.replaceChildren(...(cur ? map.get(cur).map((n) => h('button', { type: 'button', class: 'row', onclick: () => { dlg.close(); ctx.reveal?.(n); } }, h('span', { class: 'txt' }, (htmlText(n.content.html).replace(/\s+/g, ' ').trim()).slice(0, 110))))
      : [h('p', { class: 'muted' }, map.size ? t('wr.tagsPick') : t('wr.tagsNone'))]));
    const tagsSorted = [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    list.replaceChildren(...tagsSorted.map(([tg, ns]) => h('button', { type: 'button', class: 'tag-chip', onclick: () => { cur = tg; for (const b of list.children) b.classList.toggle('on', b.dataset.t === tg); showHits(); } }, `${tg} · ${ns.length}`)));
    for (const b of list.children) b.dataset.t = b.textContent.split(' · ')[0];
    dlg.append(h('header', { class: 'tag-head' }, h('h3', {}, t('wr.tags')), h('button', { type: 'button', class: 'ib', 'aria-label': t('common.close'), onclick: () => dlg.close() }, '×')), list, hits);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); dlg.addEventListener('close', () => dlg.remove());
    showHits(); document.body.append(dlg); dlg.showModal();
  }
  // ---- mentions: notes that link to a card with @
  function showMentions(id) {
    const target = store.get(id); const ns = mentionsIn(store, id);
    const dlg = h('dialog', { class: 'tag-dlg', 'aria-label': t('wr.mentionsTitle') });
    dlg.append(h('header', { class: 'tag-head' }, h('h3', {}, t('wr.mentionsOf', { name: (target?.content.title || htmlText(target?.content.html).trim().slice(0, 40) || t('common.untitled')) })), h('button', { type: 'button', class: 'ib', 'aria-label': t('common.close'), onclick: () => dlg.close() }, '×')),
      h('div', { class: 'tag-hits' }, ...(ns.length ? ns.map((n) => h('button', { type: 'button', class: 'row', onclick: () => { dlg.close(); ctx.reveal?.(n); } }, h('span', { class: 'txt' }, htmlText(n.content.html).replace(/\s+/g, ' ').trim().slice(0, 120)))) : [h('p', { class: 'muted' }, t('wr.mentionsNone'))])));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }
  return { focus, openCapture, capture, copyText, downloadMd, paintChip, openTags, showMentions, mentionCount: (id) => mentionsIn(store, id).length, compileMarkdown: (id) => compileFor(id) };
}
