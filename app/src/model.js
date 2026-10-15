// Element factories, defaults and helpers (no DOM rendering here).
import { uid } from './store.js';
import { t } from './i18n.js';

export const COLORS = [null, '#fff7c2', '#ffd9d2', '#d6ecff', '#d9f5dc', '#e8dcff', '#ffe6bf', '#e9e9ee'];
export const BOARD_COLORS = ['#7aa2f7', '#f7768e', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff', '#ff9e64', '#a0a6b5'];
export const BOARD_ICONS = ['📁', '💡', '🎨', '📅', '🎯', '📚', '🚀', '🌱', '🎬', '🏠', '🧪', '✈️'];

/** localised label per element type (a Proxy so TYPE_LABEL[type] always follows the active language) */
export const TYPE_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? t('type.' + k) : undefined) });

/** display name of a board: the root board is stored as "Home" and shown in the active language */
export const boardName = (b) => (b.parentId == null && (!b.content.title || b.content.title === 'Home') ? t('common.home') : (b.content.title || t('common.untitled')));

/** which element types a container accepts */
export const ACCEPTS = {
  column: new Set(['note', 'link', 'todo', 'table', 'image', 'file', 'sketch', 'board', 'comment']),
  todo: new Set(['task']),
  board: new Set(['note', 'link', 'todo', 'table', 'image', 'file', 'sketch', 'board', 'comment', 'column']),
};
export const isContainer = (type) => type in ACCEPTS;

const DEFAULT_W = { note: 240, link: 260, todo: 260, column: 280, board: 96, comment: 260, table: 340, image: 260, file: 240, sketch: 300 };

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
    case 'column': return { title: t('default.column') };
    case 'board': return { title: t('default.board'), icon: '📁', tint: BOARD_COLORS[(Math.random() * BOARD_COLORS.length) | 0] };
    case 'link': return { url: '', title: '' };
    case 'comment': return { thread: [] };
    case 'table': return { rows: [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']], header: true };
    case 'image': return { src: '', name: '', ratio: 0.66 };
    case 'file': return { name: '', size: 0, mime: '', src: '' };
    case 'sketch': return { strokes: [], h: 200 };
    case 'line': return { a: { x: 100, y: 100 }, b: { x: 260, y: 160 }, aId: null, bId: null, arrow: true, dashed: false, weight: 2 };
    default: return {};
  }
}

const ALLOWED_TAGS = new Set(['B', 'I', 'U', 'S', 'STRIKE', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'A', 'CODE', 'H2']);
/** whitelist-based HTML sanitiser for note bodies */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1 || !ALLOWED_TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      for (const a of [...child.attributes]) {
        const keep = child.tagName === 'A' && a.name === 'href' && /^https?:\/\//i.test(a.value);
        if (!keep) child.removeAttribute(a.name);
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
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
    case 'image': case 'file': return c.name || '';
    default: return '';
  }
}

export function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
export function normalizeUrl(u) { const t = u.trim(); if (!t) return ''; return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : 'https://' + t; }

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
