// Menus for note text: type "/" to turn the current line into a heading, list, quote, scene break and more, or "@" to link
// to another card (a character, place, chapter or note). Links are stored as <a href="#ref-ID"> and survive renames.
import { t } from './i18n.js';

const ITEMS = [
  { k: 'h', label: 'Heading', hint: 'Big section title', words: 'heading title h2', run: () => block('h2') },
  { k: 'h3', label: 'Subheading', hint: 'Smaller title', words: 'subheading h3 title', run: () => block('h3') },
  { k: 'ul', label: 'Bullet list', hint: 'A simple list', words: 'bullet list ul', run: () => document.execCommand('insertUnorderedList') },
  { k: 'ol', label: 'Numbered list', hint: 'A list with numbers', words: 'numbered list ol', run: () => document.execCommand('insertOrderedList') },
  { k: 'q', label: 'Quote', hint: 'Highlight a quote', words: 'quote blockquote', run: () => block('blockquote') },
  { k: 'code', label: 'Code block', hint: 'Monospaced text', words: 'code pre', run: () => block('pre') },
  { k: 'hr', label: 'Divider', hint: 'A horizontal line', words: 'divider hr line separator', run: () => document.execCommand('insertHorizontalRule') },
  { k: 'b', label: 'Bold text', hint: 'Make the line bold', words: 'bold strong', run: () => { document.execCommand('selectAll'); document.execCommand('bold'); collapseEnd(); } },
  { k: 'date', label: "Today's date", hint: 'Insert the current date', words: 'date today', run: () => document.execCommand('insertText', false, new Date().toLocaleDateString(undefined, { dateStyle: 'long' })) },
  { k: 'scene', label: 'Scene break', hint: 'A * * * line between scenes', words: 'scene break section divider asterisks', run: () => { document.execCommand('insertParagraph'); document.execCommand('insertText', false, '* * *'); document.execCommand('insertParagraph'); } },
  { k: 'chapter', label: 'Chapter heading', hint: 'A big heading for a new chapter', words: 'chapter heading title part', run: () => { document.execCommand('insertHTML', false, `<h2>${t('slash.chapterWord')}</h2>`); getSelection().modify?.('extend', 'backward', 'line'); } },      // the placeholder is selected, so typing replaces it
  { k: 'tk', label: 'To come (TK)', hint: 'Mark a gap to fill in later', words: 'tk todo placeholder gap later', run: () => document.execCommand('insertText', false, '[TK] ') },
  { k: 'dialogue', label: 'Dialogue line', hint: 'Start a line of speech', words: 'dialogue speech quote line', run: () => document.execCommand('insertText', false, '“') },
  { k: 'text', label: 'Plain text', hint: 'Back to a normal paragraph', words: 'text paragraph plain normal', run: () => block('div') },
];

function block(tag) {
  document.execCommand('formatBlock', false, tag);
  const sel = getSelection(); const el = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode);
  if (!el?.closest?.(tag) && tag !== 'div') document.execCommand('insertHTML', false, `<${tag}><br></${tag}>`);      // an empty note has no block to convert yet
}
function collapseEnd() { const s = getSelection(); if (s.rangeCount) s.collapseToEnd(); }

/** the app supplies the cards a mention can point at: (query) => [{ id, label, hint }] */
let mentionSource = () => [];
export const setMentionSource = (fn) => { mentionSource = fn; };

let menu = null;
const close = () => { menu?.remove(); menu = null; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** text of the caret's text node before the caret, if it ends with "/query" or "@query" at a word start */
function triggerContext(ed) {
  const sel = getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return null;
  const n = sel.anchorNode; if (!n || n.nodeType !== 3 || !ed.contains(n)) return null;
  const before = n.data.slice(0, sel.anchorOffset);
  const m = /(^|\s)([/@])([\p{L}\d _-]{0,24})$/u.exec(before); if (!m) return null;
  if (m[2] === '/' && /\s/.test(m[3])) return null;
  return { node: n, start: sel.anchorOffset - m[3].length - 1, end: sel.anchorOffset, query: m[3].toLowerCase(), kind: m[2] === '@' ? 'mention' : 'slash' };
}

export function attachSlash(ed) {
  let ctx = null, index = 0, shown = [];
  const draw = () => {
    if (ctx.kind === 'mention') shown = mentionSource(ctx.query).slice(0, 8).map((m) => ({ ...m, mention: true }));
    else shown = ITEMS.filter((it) => !ctx.query || (t('slash.' + it.k) + ' ' + it.label + ' ' + it.words).toLowerCase().includes(ctx.query)).map((it) => ({ ...it, title: t('slash.' + it.k), sub: t('slash.' + it.k + '.hint') }));
    if (!shown.length) { close(); return; }
    index = Math.min(index, shown.length - 1);
    if (!menu) { menu = document.createElement('div'); menu.className = 'slash-menu'; menu.setAttribute('role', 'listbox'); menu.addEventListener('mousedown', (e) => e.preventDefault()); (ed.closest('dialog') || document.body).append(menu); }
    menu.replaceChildren(...shown.map((it, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'option'); b.className = i === index ? 'on' : '';
      const tt = document.createElement('b'); tt.textContent = it.mention ? it.label : it.title; const s = document.createElement('span'); s.textContent = it.mention ? it.hint : it.sub; b.append(tt, s);
      b.addEventListener('click', () => choose(it)); return b;
    }));
    const r = getSelection().getRangeAt(0).cloneRange(); r.collapse(true);
    const rect = (r.getClientRects()[0]) || ed.getBoundingClientRect();
    const mh = menu.offsetHeight || 280;
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 270)) + 'px';
    menu.style.top = (rect.bottom + mh + 12 > innerHeight ? Math.max(8, rect.top - mh - 6) : rect.bottom + 6) + 'px';
  };
  const choose = (it) => {
    const c = triggerContext(ed) || ctx; if (!c) return close();
    const r = document.createRange(); r.setStart(c.node, c.start); r.setEnd(c.node, c.end);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('delete');      // the editor's own delete keeps the caret in the right block even when the line becomes empty
    close();
    if (it.mention) document.execCommand('insertHTML', false, `<a href="#ref-${esc(it.id)}">${esc(it.label)}</a>&nbsp;`); else it.run();
    ed.dispatchEvent(new Event('input'));
  };
  ed.addEventListener('input', () => { ctx = triggerContext(ed); if (!ctx) { close(); return; } index = 0; draw(); });
  ed.addEventListener('keydown', (ev) => {
    if (!menu && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {      // after a heading the next line is a normal paragraph, never another heading
      const sel = getSelection(); const blk = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode).closest?.('h2,h3');
      if (blk && ed.contains(blk) && sel.isCollapsed) { const r = sel.getRangeAt(0).cloneRange(); r.selectNodeContents(blk); r.setStart(sel.anchorNode, sel.anchorOffset); if (!r.toString().length) { ev.preventDefault(); const d = document.createElement('div'); d.innerHTML = '<br>'; blk.after(d); const nr = document.createRange(); nr.setStart(d, 0); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); ed.dispatchEvent(new Event('input')); return; } }
    }
    if (!menu) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); index = (index + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; draw(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); choose(shown[index]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
  }, true);
  ed.addEventListener('blur', () => setTimeout(close, 120));
}
