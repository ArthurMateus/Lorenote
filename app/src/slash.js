// Slash menu for notes: type "/" to turn the current line into a heading, list, quote, code block, divider and more.
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
  { k: 'scene', label: 'Scene break', hint: 'A * * * line between scenes', words: 'scene break section divider asterisks', run: () => document.execCommand('insertHTML', false, '<div>* * *</div><div><br></div>') },
  { k: 'chapter', label: 'Chapter heading', hint: 'A big heading for a new chapter', words: 'chapter heading title part', run: () => { document.execCommand('insertText', false, t('slash.chapterWord') + ' '); block('h2'); } },
  { k: 'tk', label: 'To come (TK)', hint: 'Mark a gap to fill in later', words: 'tk todo placeholder gap later', run: () => document.execCommand('insertText', false, '[TK] ') },
  { k: 'dialogue', label: 'Dialogue line', hint: 'Start a line of speech', words: 'dialogue speech quote line', run: () => document.execCommand('insertText', false, '“') },
  { k: 'text', label: 'Plain text', hint: 'Back to a normal paragraph', words: 'text paragraph plain normal', run: () => block('div') },
];

function block(tag) { document.execCommand('formatBlock', false, tag); }
function collapseEnd() { const s = getSelection(); if (s.rangeCount) s.collapseToEnd(); }

let menu = null;
const close = () => { menu?.remove(); menu = null; };

/** text of the caret's text node before the caret, if it ends with "/query" at a word start */
function slashContext(ed) {
  const sel = getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return null;
  const n = sel.anchorNode; if (!n || n.nodeType !== 3 || !ed.contains(n)) return null;
  const before = n.data.slice(0, sel.anchorOffset);
  const m = /(^|\s)\/([\p{L}\d]{0,16})$/u.exec(before); if (!m) return null;
  return { node: n, start: sel.anchorOffset - m[2].length - 1, end: sel.anchorOffset, query: m[2].toLowerCase() };
}

export function attachSlash(ed) {
  let ctx = null, index = 0, shown = [];
  const draw = () => {
    shown = ITEMS.filter((it) => !ctx.query || (t('slash.' + it.k) + ' ' + it.label + ' ' + it.words).toLowerCase().includes(ctx.query));
    if (!shown.length) { close(); return; }
    index = Math.min(index, shown.length - 1);
    if (!menu) { menu = document.createElement('div'); menu.className = 'slash-menu'; menu.setAttribute('role', 'listbox'); menu.addEventListener('mousedown', (e) => e.preventDefault()); document.body.append(menu); }
    menu.replaceChildren(...shown.map((it, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'option'); b.className = i === index ? 'on' : '';
      const tt = document.createElement('b'); tt.textContent = t('slash.' + it.k); const s = document.createElement('span'); s.textContent = t('slash.' + it.k + '.hint'); b.append(tt, s);
      b.addEventListener('click', () => choose(it)); return b;
    }));
    const r = getSelection().getRangeAt(0).cloneRange(); r.collapse(true);
    const rect = (r.getClientRects()[0]) || ed.getBoundingClientRect();
    const mh = menu.offsetHeight || 280;
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 270)) + 'px';
    menu.style.top = (rect.bottom + mh + 12 > innerHeight ? Math.max(8, rect.top - mh - 6) : rect.bottom + 6) + 'px';
  };
  const choose = (it) => {
    const c = slashContext(ed) || ctx; if (!c) return close();
    const r = document.createRange(); r.setStart(c.node, c.start); r.setEnd(c.node, c.end); r.deleteContents();
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    close(); it.run(); ed.dispatchEvent(new Event('input'));
  };
  ed.addEventListener('input', () => { ctx = slashContext(ed); if (!ctx) { close(); return; } index = 0; draw(); });
  ed.addEventListener('keydown', (ev) => {
    if (!menu) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); index = (index + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; draw(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); choose(shown[index]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
  }, true);
  ed.addEventListener('blur', () => setTimeout(close, 120));
}
