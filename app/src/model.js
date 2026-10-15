// Element factories, defaults and helpers (no DOM rendering here).
import { uid } from './store.js';
import { defaultDatabaseContent, databaseText } from './database.js';

export const COLORS = [null, '#fff7c2', '#ffd9d2', '#d6ecff', '#d9f5dc', '#e8dcff', '#ffe6bf', '#e9e9ee'];
export const BOARD_COLORS = ['#7aa2f7', '#f7768e', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff', '#ff9e64', '#a0a6b5'];
export const BOARD_ICONS = ['📁', '💡', '🎨', '📅', '🎯', '📚', '🚀', '🌱', '🎬', '🏠', '🧪', '✈️'];

export const TYPE_LABEL = {
  note: 'Note', link: 'Link', todo: 'To-do list', task: 'Task', column: 'Column', board: 'Board',
  comment: 'Comment', table: 'Table', database: 'Database', image: 'Image', file: 'File', sketch: 'Sketch', line: 'Line',
};

/** which element types a container accepts */
export const ACCEPTS = {
  column: new Set(['note', 'link', 'todo', 'table', 'database', 'image', 'file', 'sketch', 'board', 'comment']),
  todo: new Set(['task']),
  board: new Set(['note', 'link', 'todo', 'table', 'image', 'file', 'sketch', 'board', 'comment', 'column', 'database']),
};
export const isContainer = (type) => type in ACCEPTS;

const DEFAULT_W = { note: 240, link: 260, todo: 260, column: 280, board: 96, comment: 260, table: 340, database: 340, image: 260, file: 240, sketch: 300 };

export function makeElement(type, parentId, over = {}) {
  const now = Date.now();
  const base = {
    id: uid(), type, parentId, section: 'canvas', x: 80, y: 80, z: 0, order: 0,
    w: DEFAULT_W[type] || 240, color: null, content: defaultContent(type), created: now, modified: now,
  };
  return { ...base, ...over };
}

export function defaultContent(type) {
  switch (type) {
    case 'note': return { html: '' };
    case 'task': return { text: '', done: false };
    case 'todo': return { title: '', showTitle: false };
    case 'column': return { title: 'New column' };
    case 'board': return { title: 'New board', icon: '📁', tint: BOARD_COLORS[(Math.random() * BOARD_COLORS.length) | 0] };
    case 'link': return { url: '', title: '' };
    case 'comment': return { thread: [] };
    case 'database': return defaultDatabaseContent();
    case 'table': return { rows: [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']], header: true };
    case 'image': return { src: '', name: '', ratio: 0.66 };
    case 'file': return { name: '', size: 0, mime: '', src: '' };
    case 'sketch': return { strokes: [], h: 200 };
    case 'line': return { a: { x: 100, y: 100 }, b: { x: 260, y: 160 }, aId: null, bId: null, arrow: true, dashed: false, weight: 2 };
    default: return {};
  }
}

const ALLOWED_TAGS = new Set(['b', 'i', 'u', 's', 'strike', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'div', 'p', 'a', 'code', 'h2', 'h3', 'blockquote', 'pre', 'hr']);
/** elements whose whole subtree is discarded (not unwrapped): scripts, styles, embeds, foreign-namespace content */
const DROP_TAGS = new Set(['script', 'style', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed', 'xmp', 'plaintext', 'title', 'head', 'meta', 'link', 'base', 'svg', 'math', 'textarea', 'select', 'option', 'audio', 'video', 'canvas']);
const XHTML = 'http://www.w3.org/1999/xhtml';

/**
 * Allow-list HTML sanitiser for note bodies. It does NOT clean the parsed tree in place: it builds a brand-new tree
 * containing only allowed elements, text and (http/https) links, so nothing unexpected can ride along.
 * Disallowed wrappers are unwrapped (their safe text and allowed children are kept); dangerous ones are dropped whole.
 */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${String(html ?? '')}</body>`, 'text/html');   // inert document: nothing loads or runs
  const out = doc.createElement('div');
  const copy = (src, dst, depth) => {
    if (depth > 40) return;                                      // absurdly deep nesting: drop the rest
    for (const n of src.childNodes) {
      if (n.nodeType === 3) { dst.append(doc.createTextNode(n.data)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName.toLowerCase();
      if (n.namespaceURI !== XHTML || DROP_TAGS.has(tag)) continue;
      if (!ALLOWED_TAGS.has(tag)) { copy(n, dst, depth + 1); continue; }       // unwrap, but still sanitise the children
      const el = doc.createElement(tag);
      if (tag === 'a') {
        const href = n.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href.trim())) { el.setAttribute('href', href.trim()); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      }
      copy(n, el, depth + 1); dst.append(el);
    }
  };
  copy(doc.body, out, 0);
  return out.innerHTML;
}

export const stripHtml = (html) => { const d = document.createElement('div'); d.innerHTML = sanitizeHtml(html || ''); return d.textContent || ''; };

export function elementText(e) {
  const c = e.content;
  switch (e.type) {
    case 'note': return stripHtml(c.html);
    case 'task': return c.text;
    case 'todo': case 'column': case 'board': return c.title || '';
    case 'link': return `${c.title} ${c.url}`;
    case 'comment': return c.thread.map((m) => m.text).join(' ');
    case 'table': return c.rows.flat().join(' ');
    case 'database': return databaseText(c);
    case 'image': case 'file': return c.name || '';
    default: return '';
  }
}

export function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
/** only http(s) URLs are ever used as links, images or previews (blocks javascript:, data:, file: and friends) */
export function safeWebUrl(u) { try { const x = new URL(String(u || '')); return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : ''; } catch { return ''; } }
/** turn what a person typed into a safe http(s) URL, or '' */
export function normalizeUrl(u) {
  const t = String(u || '').trim(); if (!t) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z0-9.-]+:\d+(\/|$)/i.test(t);      // "localhost:3000" is a host, not a scheme
  return safeWebUrl(hasScheme ? t : 'https://' + t);
}
/** accept only plain CSS colours (hex, name, rgb/hsl, var) so stored data can never inject markup into SVG or styles */
export const safeColor = (c, fallback = '') => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([\d\s.,%/]+\)|var\(--[a-z0-9-]+\))$/i.test(c.trim()) ? c.trim() : fallback);

/** Starter layouts. Each returns a list of element specs built relative to a parent board. */
export const TEMPLATES = {
  'Project plan': (pid) => {
    const cols = ['To do', 'Doing', 'Done'].map((t, i) => makeElement('column', pid, { x: 80 + i * 320, y: 80, z: i + 1, content: { title: t } }));
    const notes = [
      makeElement('note', cols[0].id, { section: 'stack', order: 1, content: { html: 'Define scope' } }),
      makeElement('note', cols[0].id, { section: 'stack', order: 2, content: { html: 'List deliverables' } }),
      makeElement('note', cols[1].id, { section: 'stack', order: 1, content: { html: 'Draft first version' } }),
    ];
    return [...cols, ...notes];
  },
  'Weekly plan': (pid) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((t, i) => makeElement('column', pid, { x: 60 + i * 300, y: 80, z: i + 1, w: 270, content: { title: t } })),
  'Inspiration board': (pid) => [
    makeElement('note', pid, { x: 100, y: 100, z: 1, color: COLORS[1], content: { html: 'Mood &amp; keywords' } }),
    makeElement('link', pid, { x: 400, y: 100, z: 2 }),
    makeElement('sketch', pid, { x: 100, y: 260, z: 3 }),
  ],
  'Creative brief': (pid) => {
    const t = makeElement('todo', pid, { x: 80, y: 80, z: 1, content: { title: 'Checklist', showTitle: true } });
    const tasks = ['Audience', 'Goal', 'Tone', 'Deadline'].map((s, i) => makeElement('task', t.id, { section: 'stack', order: i + 1, content: { text: s, done: false } }));
    return [t, ...tasks, makeElement('note', pid, { x: 380, y: 80, z: 2, content: { html: '<b>Brief</b><br>Describe the project in a few sentences.' } })];
  },
};
