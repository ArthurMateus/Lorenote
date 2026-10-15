// Template engine + built-in library.
//
// A template is a list of "nodes" (a small tree: type, position, content, kids). The same node format is used for
//   - the built-in library below (authored here),
//   - boards a user saves as their own template (converted from the flat element map),
// so one instantiate() and one thumbnail renderer cover both.
import { makeElement, defaultContent, COLORS, safeColor } from './model.js';
import { uid } from './store.js';
import { t as tr, tx, getLang } from './i18n.js';

// ------------------------------------------------------------------ sizes (estimates, for layout + thumbnails)
const DEFAULT_W = { note: 220, link: 260, todo: 260, column: 260, board: 96, comment: 260, table: 420, image: 200, file: 240, sketch: 280 };
export function estSize(nd) {
  const w = nd.w || DEFAULT_W[nd.type] || 200; const kids = nd.kids || [];
  switch (nd.type) {
    case 'note': { const lines = String(nd.content?.html || '').split(/<br>|<\/li>|<\/p>/).length; return { w, h: 34 + lines * 18 }; }
    case 'todo': return { w, h: 42 + Math.max(1, kids.length) * 28 + 28 };
    case 'column': return { w, h: 70 + kids.reduce((s, k) => s + estSize({ ...k, w: w - 36 }).h + 8, 0) + 20 };
    case 'board': return { w: 96, h: 96 };
    case 'table': return { w, h: (nd.content?.rows?.length || 4) * 31 };
    case 'image': return { w, h: Math.round(w * (nd.content?.ratio || 0.7)) };
    case 'sketch': return { w, h: Math.round(w * (nd.content?.h || 180) / 300) };
    case 'link': return { w, h: 92 };
    case 'comment': return { w, h: 84 };
    case 'task': return { w: w || 200, h: 28 };
    default: return { w, h: 60 };
  }
}

// ------------------------------------------------------------------ instantiate
/**
 * Create elements for `nodes` inside `parentId`. Returns the list of store changes.
 * dx/dy shift every top-level node. Connector nodes may reference other nodes by `id`.
 */
export function instantiate(store, nodes, parentId, { dx = 0, dy = 0 } = {}) {
  const changes = []; const idMap = new Map(); const made = []; let z = store.maxZ(parentId);
  const walk = (list, pid, section) => {
    list.forEach((nd, i) => {
      if (nd.type === 'line') { made.push({ nd, pid, section }); return; }
      const over = section === 'canvas'
        ? { section, x: Math.round(nd.x + (pid === parentId ? dx : 0)), y: Math.round(nd.y + (pid === parentId ? dy : 0)), z: ++z, w: nd.w || DEFAULT_W[nd.type] }
        : { section, order: i + 1, w: 0 };
      if (nd.color) over.color = nd.color;
      const el = makeElement(nd.type, pid, over);
      el.content = { ...defaultContent(nd.type), ...structuredClone(nd.content || {}) };
      if (nd.id) idMap.set(nd.id, el.id);
      changes.push({ id: el.id, after: el });
      if (nd.kids?.length) walk(nd.kids, el.id, nd.type === 'board' ? 'canvas' : 'stack');
    });
  };
  walk(nodes, parentId, 'canvas');
  // connectors last, so both ends exist
  const byRef = new Map(); for (const nd of nodes) if (nd.id) byRef.set(nd.id, nd);
  for (const { nd, pid } of made) {
    const top = pid === parentId;
    const c = { ...defaultContent('line'), ...structuredClone(nd.content || {}) };
    const fromNode = byRef.get(nd.from), toNode = byRef.get(nd.to);
    const center = (n) => { const s = estSize(n); return { x: n.x + dx + s.w / 2, y: n.y + dy + s.h / 2 }; };
    const shift = (p) => ({ x: p.x + dx, y: p.y + dy });
    if (nd.from) { c.aId = idMap.get(nd.from) || null; if (fromNode) c.a = center(fromNode); } else if (top) c.a = shift(c.a);
    if (nd.to) { c.bId = idMap.get(nd.to) || null; if (toNode) c.b = center(toNode); } else if (top) c.b = shift(c.b);
    if (nd.arrow !== undefined) c.arrow = nd.arrow; if (nd.dashed !== undefined) c.dashed = nd.dashed;
    const el = makeElement('line', pid, { section: 'canvas', x: 0, y: 0, z: ++z, w: 0 }); el.content = c;
    changes.push({ id: el.id, after: el });
  }
  return changes;
}

/** bounding box of what is already on a board, to drop a template beside it instead of on top */
export function freeSpot(store, boardId, view) {
  const kids = store.children(boardId, 'canvas').filter((e) => e.type !== 'line');
  if (!kids.length) return { dx: 0, dy: 0 };
  let right = -Infinity, top = Infinity;
  for (const e of kids) { const r = view?.worldRect?.(e.id); right = Math.max(right, r ? r.x + r.w : e.x + (e.w || DEFAULT_W[e.type] || 200)); top = Math.min(top, e.y); }
  return { dx: Math.round(right + 80), dy: Math.round(top) };
}

// ------------------------------------------------------------------ saved boards <-> nodes
/** the elements that make up a board, ready to be stored as a user template */
export function boardToFlat(store, boardId) {
  const flat = { [boardId]: store.get(boardId) };
  for (const e of store.descendants(boardId)) flat[e.id] = e;
  return flat;
}
/** flat {id: element} + root id -> nodes (children of the root), keeping connector bindings as from/to */
export function flatToNodes(flat, rootId) {
  const kids = (pid, section) => Object.values(flat).filter((e) => e.parentId === pid && !e.trashed && e.section === section).sort((a, b) => (section === 'stack' ? a.order - b.order : a.z - b.z));
  const conv = (e) => {
    const nd = { type: e.type, id: e.id, x: e.x, y: e.y, w: e.w || undefined, color: e.color || null, content: structuredClone(e.content) };
    if (e.type === 'line') { nd.from = e.content.aId || undefined; nd.to = e.content.bId || undefined; return nd; }
    if (e.type === 'column' || e.type === 'todo') nd.kids = kids(e.id, 'stack').map(conv);
    if (e.type === 'board') nd.kids = kids(e.id, 'canvas').map(conv);
    return nd;
  };
  return kids(rootId, 'canvas').map(conv);
}

// ------------------------------------------------------------------ thumbnails
const TYPE_FILL = { note: '#fff', link: '#fff', todo: '#fff', column: '#e6e3dc', comment: '#e3eefc', table: '#fff', image: '#cfd3dc', file: '#fff', sketch: '#fffdf7' };
export function thumbSVG(nodes, { w = 220, h = 130 } = {}) {
  const items = [];
  const place = (list, ox, oy, depth, parentW) => {
    list.forEach((nd, i) => {
      if (nd.type === 'line') return;
      const s = estSize(nd);
      items.push({ nd, x: ox + (nd.x || 0), y: oy + (nd.y || 0), w: s.w, h: s.h, depth });
    });
  };
  place(nodes, 0, 0, 0);
  if (!items.length) return '';
  const minX = Math.min(...items.map((i) => i.x)), minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.w)), maxY = Math.max(...items.map((i) => i.y + i.h));
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY); const k = Math.min((w - 16) / bw, (h - 16) / bh);
  const ox = (w - bw * k) / 2 - minX * k, oy = (h - bh * k) / 2 - minY * k;
  const out = [];
  const byId = new Map(items.map((i) => [i.nd.id, i]).filter(([id]) => id));
  for (const nd of nodes) {
    if (nd.type !== 'line') continue;
    const a = byId.get(nd.from), b = byId.get(nd.to);
    if (a && b) out.push(`<line x1="${ox + (a.x + a.w / 2) * k}" y1="${oy + (a.y + a.h / 2) * k}" x2="${ox + (b.x + b.w / 2) * k}" y2="${oy + (b.y + b.h / 2) * k}" stroke="#8a8f9c" stroke-width="1.2"/>`);
  }
  const rect = (x, y, rw, rh, fill, r = 2, stroke) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1.5, rw).toFixed(1)}" height="${Math.max(1.5, rh).toFixed(1)}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width=".8"` : ''}/>`;
  for (const it of items) {
    const { nd } = it; const x = ox + it.x * k, y = oy + it.y * k, rw = it.w * k, rh = it.h * k; const fill = safeColor(nd.color) || TYPE_FILL[nd.type] || '#fff';
    if (nd.type === 'board') { const tint = safeColor(nd.content?.tint, '#7aa2f7'); out.push(`<rect x="${(x + rw * .1).toFixed(1)}" y="${y.toFixed(1)}" width="${(rw * .8).toFixed(1)}" height="${(rh * .8).toFixed(1)}" rx="4" fill="${tint}" fill-opacity=".33" stroke="${tint}" stroke-width=".8"/>`); continue; }
    out.push(rect(x, y, rw, rh, fill, 2.5, '#00000022'));
    if (nd.type === 'column') {
      let cy = y + 70 * k;
      for (const kid of nd.kids || []) { const ks = estSize({ ...kid, w: it.w - 36 }); out.push(rect(x + 8 * k, cy, rw - 16 * k, ks.h * k, kid.type === 'image' ? '#cfd3dc' : (safeColor(kid.color) || '#fff'), 1.5)); cy += (ks.h + 8) * k; }
    } else if (nd.type === 'todo') {
      (nd.kids || []).slice(0, 6).forEach((t, n) => { const cy = y + (30 + n * 28) * k; out.push(rect(x + 8 * k, cy, 7 * k, 7 * k, '#fff', 1, '#9aa'), rect(x + 20 * k, cy + 2 * k, rw * .5, 3 * k, '#c9ccd4', 1)); });
    } else if (nd.type === 'table') {
      const rows = nd.content?.rows || [[]]; const n = rows.length; const cols = rows[0]?.length || 3;
      out.push(rect(x, y, rw, rh / n, '#cfd3dc', 2));
      for (let r = 1; r < n; r++) out.push(`<line x1="${x}" x2="${x + rw}" y1="${y + (rh / n) * r}" y2="${y + (rh / n) * r}" stroke="#00000022" stroke-width=".7"/>`);
      for (let c = 1; c < cols; c++) out.push(`<line y1="${y}" y2="${y + rh}" x1="${x + (rw / cols) * c}" x2="${x + (rw / cols) * c}" stroke="#00000022" stroke-width=".7"/>`);
    } else if (nd.type === 'note') {
      out.push(rect(x + 5 * k, y + 8 * k, rw - 10 * k, 3 * k, '#00000030', 1), rect(x + 5 * k, y + 18 * k, (rw - 10 * k) * .7, 3 * k, '#00000020', 1));
    } else if (nd.type === 'image') {
      out.push(`<path d="M${x + rw * .15} ${y + rh * .8} L${x + rw * .4} ${y + rh * .4} L${x + rw * .6} ${y + rh * .65} L${x + rw * .75} ${y + rh * .5} L${x + rw * .9} ${y + rh * .8} Z" fill="#aeb4c0"/>`);
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${out.join('')}</svg>`;
}

// ------------------------------------------------------------------ authoring helpers for the built-in library
const [, Y, R, B, G, P, O, S] = COLORS;      // yellow, rose, blue, green, purple, orange, grey
const T = {
  note: (x, y, html, o = {}) => ({ type: 'note', x, y, w: o.w || 220, color: o.color || null, id: o.id, content: { html: tx(html) } }),
  col: (x, y, title, kids = [], o = {}) => ({ type: 'column', x, y, w: o.w || 260, color: o.color || null, id: o.id, content: { title: tx(title) }, kids }),
  todo: (x, y, title, tasks, o = {}) => ({ type: 'todo', x, y, w: o.w || 260, id: o.id, content: { title: tx(title || ''), showTitle: !!title }, kids: tasks.map((t) => ({ type: 'task', content: { text: tx(t), done: false } })) }),
  table: (x, y, rows, o = {}) => ({ type: 'table', x, y, w: o.w || 440, id: o.id, content: { rows: rows.map((r) => r.map(tx)), header: o.header !== false } }),
  board: (x, y, title, icon, tint, kids = [], o = {}) => ({ type: 'board', x, y, w: 96, id: o.id, content: { title: tx(title), icon, tint }, kids }),
  link: (x, y, o = {}) => ({ type: 'link', x, y, w: o.w || 260, id: o.id, content: { url: '', title: '' } }),
  image: (x, y, w = 200, ratio = 0.7, o = {}) => ({ type: 'image', x, y, w, id: o.id, content: { src: '', name: '', ratio } }),
  sketch: (x, y, o = {}) => ({ type: 'sketch', x, y, w: o.w || 280, id: o.id, content: { strokes: [], h: o.h || 180 } }),
  line: (from, to, o = {}) => ({ type: 'line', from, to, arrow: o.arrow !== false, dashed: !!o.dashed, content: {} }),
};
const cn = (t) => `<b>${tx(t)}</b>`;                           // heading line inside a note
const nt = (head, body = '') => `<b>${tx(head)}</b>${body ? '<br>' + tx(body) : ''}`;
/** n equally spaced columns */
const columns = (titles, kidsByCol = [], o = {}) => titles.map((t, i) => T.col((o.x0 ?? 60) + i * (o.gap ?? 290), o.y ?? 60, t, kidsByCol[i] || [], { w: o.w ?? 260, color: o.colors?.[i] }));
const stackNotes = (items, color) => items.map((h) => ({ type: 'note', color: color || null, content: { html: tx(h) } }));
const empty = (n) => Array.from({ length: n }, () => ['', '', '']);

/** a brief: titled prompt notes in a 2-column grid, plus optional extras */
const brief = (sections, extras = []) => [
  ...sections.map(([head, prompt], i) => T.note(60 + (i % 2) * 300, 60 + Math.floor(i / 2) * 150, nt(head, prompt), { w: 270, color: [Y, B, G, P, O, R][i % 6] })),
  ...extras,
];

// ------------------------------------------------------------------ built-in library
export const CATEGORIES = ['Fiction', 'Nonfiction', 'Writing life', 'Planning', 'Briefs', 'Moodboards', 'Storyboards', 'Brainstorming', 'Product & UX', 'Marketing', 'Education', 'Personal', 'Design', 'Business', 'Media', 'Making & Dev'];

const L = [];
const add = (id, name, category, description, nodes) => {
  const cache = new Map();                                      // language -> built nodes (template text is translated while building)
  L.push({ id, category, get name() { return tx(name); }, get description() { return tx(description); },
    get nodes() { const lg = getLang(); if (!cache.has(lg)) cache.set(lg, typeof nodes === 'function' ? nodes() : nodes); return cache.get(lg); } });
};

// ---- Planning
add('weekly-plan', 'Weekly plan', 'Planning', 'One column per day, plus a parking lot for things that float.', () => [
  ...columns(['Mon', 'Tue', 'Wed', 'Thu'], [], { x0: 60, gap: 290, y: 60, w: 260 }),
  T.col(60, 330, 'Fri', [], { w: 260 }), T.todo(350, 330, 'Weekend', ['Rest', 'Something fun'], { w: 260 }), T.col(640, 330, 'Someday', [], { w: 260, color: S }),
]);
add('kanban', 'Kanban board', 'Planning', 'Cards flow left to right from idea to done.', () => columns(['To do', 'In progress', 'In review', 'Done'], [
  stackNotes(['Write the first draft', 'Collect feedback'], Y), stackNotes(['Build the prototype']), [], stackNotes(['Kick-off meeting'], G)]));
add('eisenhower', 'Priority matrix', 'Planning', 'Sort tasks by urgency and importance.', () => [
  T.col(60, 60, 'Do first · urgent + important', stackNotes(['Deadline this week'], R), { w: 320 }), T.col(410, 60, 'Schedule · important', stackNotes(['Long-term project'], B), { w: 320 }),
  T.col(60, 330, 'Delegate · urgent', stackNotes(['Quick requests'], O), { w: 320 }), T.col(410, 330, 'Drop · neither', stackNotes(['Busywork'], S), { w: 320 })]);
add('team-planner', 'Team planner', 'Planning', 'Who is doing what this week.', () => [
  T.table(60, 60, [['Person', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'], ['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', '']], { w: 640 }),
  T.note(60, 300, nt('Notes', 'Holidays, hand-offs, blockers.'), { w: 280, color: Y })]);
add('project-plan', 'Project plan', 'Planning', 'Goal, milestones, tasks and risks on a single board.', () => [
  T.note(60, 60, nt('Goal', 'What does done look like, in one sentence?'), { w: 300, color: Y }),
  T.todo(60, 210, 'Milestones', ['Kick-off', 'First draft', 'Review', 'Launch'], { w: 300 }),
  T.table(400, 60, [['Phase', 'Owner', 'Start', 'End'], ['Discover', '', '', ''], ['Make', '', '', ''], ['Launch', '', '', '']], { w: 460 }),
  T.col(400, 260, 'To do', stackNotes(['First task']), { w: 220 }), T.col(640, 260, 'Doing', [], { w: 220 }), T.col(880, 260, 'Done', [], { w: 220 }),
  T.note(900, 60, nt('Risks', 'What could slow this down?'), { w: 220, color: R })]);
add('okr', 'Goals & key results', 'Planning', 'Objectives with measurable results underneath.', () => [
  T.note(60, 60, nt('Objective', 'An inspiring, qualitative goal.'), { w: 320, color: P }),
  T.todo(60, 200, 'Key results', ['Result 1: number + date', 'Result 2: number + date', 'Result 3: number + date'], { w: 320 }),
  T.table(420, 60, [['Initiative', 'Owner', 'Status'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 420 })]);
add('event-plan', 'Event plan', 'Planning', 'Checklists, schedule and budget for a gathering.', () => [
  T.todo(60, 60, 'Before', ['Pick a date', 'Book the venue', 'Send invites'], { w: 260 }), T.todo(60, 280, 'On the day', ['Set up', 'Welcome guests', 'Clean up'], { w: 260 }),
  T.table(360, 60, [['Time', 'What', 'Who'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 420 }), T.table(360, 250, [['Cost', 'Estimate', 'Actual'], ['Venue', '', ''], ['Food', '', ''], ['Total', '', '']], { w: 420 })]);

// ---- Briefs
add('creative-brief', 'Creative brief', 'Briefs', 'The questions every project should answer first.', () => brief([
  ['Background', 'Why are we doing this now?'], ['Objective', 'What should change when it works?'], ['Audience', 'Who is it for? What do they care about?'],
  ['Key message', 'The one thing to remember.'], ['Tone', 'Three words for how it should feel.'], ['Constraints', 'Budget, format, things to avoid.']],
  [T.todo(660, 60, 'Deliverables', ['Item one', 'Item two'], { w: 240 }), T.table(660, 260, [['Milestone', 'Date'], ['Concepts', ''], ['Final', '']], { w: 300 })]));
add('design-brief', 'Design brief', 'Briefs', 'Aims, audience and style references for a design job.', () => brief([
  ['Project', 'Name it and describe it in two lines.'], ['Goals', 'What must the design achieve?'], ['Audience', 'Who will see it?'], ['Must include', 'Logos, copy, legal lines.'], ['Style', 'Colour, type, mood. See references.']],
  [T.image(660, 60, 200, 0.7), T.image(880, 60, 200, 0.7), T.image(660, 220, 200, 0.7), T.todo(880, 220, 'Formats', ['Print', 'Web', 'Social'], { w: 220 })]));
add('marketing-brief', 'Marketing brief', 'Briefs', 'Goal, audience, channels and the numbers you will judge it by.', () => brief([
  ['Goal', 'What are we trying to move?'], ['Audience', 'Describe one real person.'], ['Offer', 'What do we say, and why believe it?'], ['Timing', 'Start, end, key dates.']],
  [T.todo(660, 60, 'Channels', ['Email', 'Social', 'Search', 'Events'], { w: 240 }), T.table(60, 380, [['KPI', 'Target', 'Result'], ['', '', ''], ['', '', '']], { w: 420 })]));
add('video-brief', 'Video brief', 'Briefs', 'Concept, format and shot list for a video.', () => [
  T.note(60, 60, nt('Concept', 'Describe the video in two sentences.'), { w: 280, color: Y }), T.note(60, 210, nt('Tone & style', 'Pace, music, colour, references.'), { w: 280, color: B }),
  T.table(380, 60, [['Spec', 'Value'], ['Length', ''], ['Aspect ratio', ''], ['Delivery date', ''], ['Platforms', '']], { w: 360 }), T.todo(380, 260, 'Shot list', ['Opening', 'Main scene', 'Close-up', 'Ending'], { w: 260 })]);
add('website-brief', 'Website brief', 'Briefs', 'Pages, purpose and content for a new site.', () => [
  T.note(60, 60, nt('Purpose', 'What should a visitor do on this site?'), { w: 300, color: Y }), T.note(60, 190, nt('Audience', 'Who visits and what are they looking for?'), { w: 300, color: B }),
  T.board(420, 60, 'Home', '🏠', '#7aa2f7'), T.board(540, 60, 'About', '🙂', '#9ece6a'), T.board(660, 60, 'Services', '🧰', '#e0af68'), T.board(780, 60, 'Contact', '✉️', '#bb9af7'),
  T.table(420, 210, [['Page', 'Content needed', 'Owner'], ['', '', ''], ['', '', '']], { w: 480 })]);

// ---- Moodboards
const tiles = (x0, y0, nx, ny, w = 180, gap = 14, ratios = [0.75, 1, 0.66]) => Array.from({ length: nx * ny }, (_, i) => T.image(x0 + (i % nx) * (w + gap), y0 + Math.floor(i / nx) * (w * 1.05 + gap), w, ratios[i % ratios.length]));
add('moodboard', 'Moodboard', 'Moodboards', 'A wall of images with a palette and a few keywords.', () => [
  ...tiles(60, 60, 3, 2), T.note(680, 60, nt('Keywords', 'Warm · quiet · handmade'), { w: 200, color: Y }), T.note(680, 170, '', { w: 60, color: R }), T.note(750, 170, '', { w: 60, color: B }), T.note(820, 170, '', { w: 60, color: G })]);
add('brand-board', 'Brand board', 'Moodboards', 'Logo, palette, type and voice in one view.', () => [
  T.image(60, 60, 220, 0.6), ...[Y, R, B, G, P].map((c, i) => T.note(60 + i * 46, 210, '', { w: 40, color: c })), T.note(320, 60, nt('Typography', 'Headings · body · accents'), { w: 260, color: S }),
  T.note(320, 170, nt('Voice', 'Three words that sound like us.'), { w: 260, color: Y }), T.image(60, 300, 170, 0.8), T.image(250, 300, 170, 0.8), T.image(440, 300, 170, 0.8)]);
add('vision-board', 'Vision board', 'Moodboards', 'Pictures and intentions for the year ahead.', () => [
  ...tiles(60, 60, 3, 2, 170), T.note(640, 60, nt('This year I want…', 'Three sentences.'), { w: 240, color: Y }), T.todo(640, 190, 'First steps', ['Step one', 'Step two', 'Step three'], { w: 240 })]);
add('character-board', 'Character design board', 'Moodboards', 'Look, personality and sketches for a character.', () => [
  T.image(60, 60, 240, 1.2), T.sketch(320, 60, { w: 260 }), T.note(320, 220, nt('Personality', 'Habits, quirks, how they move.'), { w: 260, color: Y }),
  T.table(620, 60, [['Trait', 'Notes'], ['Age', ''], ['Role', ''], ['Silhouette', '']], { w: 320 })]);

// ---- Storyboards
const panel = (x, y, i, w = 230) => T.col(x, y, tr('tplx.shot', { n: i }), [T.image(0, 0, w - 36, 0.56), { type: 'note', content: { html: nt('Action', 'What happens?') } }], { w });
add('film-storyboard', 'Film storyboard', 'Storyboards', 'Six shots with frames and action notes.', () => [...Array.from({ length: 6 }, (_, i) => panel(60 + (i % 3) * 260, 60 + Math.floor(i / 3) * 360, i + 1))]);
add('video-storyboard', 'Video storyboard', 'Storyboards', 'A single row of panels for short videos.', () => Array.from({ length: 4 }, (_, i) => panel(60 + i * 260, 60, i + 1)));
add('app-storyboard', 'App flow', 'Storyboards', 'Screens connected in the order a person sees them.', () => {
  const s = ['Open', 'Sign in', 'Browse', 'Pick', 'Done'].map((t, i) => T.col(60 + i * 270, 80, t, [T.image(0, 0, 190, 1.4)], { w: 230, id: 's' + i }));
  return [...s, ...[0, 1, 2, 3].map((i) => T.line('s' + i, 's' + (i + 1)))];
});

// ---- Brainstorming
const hub = (center, leaves, colors = [Y, B, G, P, O, R]) => {
  const cx = 420, cy = 280, nodes = [T.note(cx, cy, nt(center, ''), { w: 170, color: S, id: 'c' })];
  leaves.forEach((t, i) => { const a = (i / leaves.length) * Math.PI * 2 - Math.PI / 2; nodes.push(T.note(Math.round(cx + Math.cos(a) * 330), Math.round(cy + Math.sin(a) * 210), t, { w: 170, color: colors[i % colors.length], id: 'n' + i }), T.line('c', 'n' + i)); });
  return nodes;
};
add('brainstorm', 'Brainstorm', 'Brainstorming', 'A topic in the middle and ideas orbiting around it.', () => hub('Topic', ['Idea', 'Idea', 'Idea', 'Idea', 'Idea', 'Idea']));
add('mind-map', 'Mind map', 'Brainstorming', 'Branches and sub-branches from one central thought.', () => {
  const n = [T.note(380, 250, nt('Main idea'), { w: 170, color: S, id: 'm' })];
  const br = [['A', 40, 60], ['B', 40, 250], ['C', 40, 440], ['D', 760, 60], ['E', 760, 250], ['F', 760, 440]];
  br.forEach(([t, x, y], i) => { n.push(T.note(x, y, nt(tr('tplx.branch', { letter: t })), { w: 160, color: [Y, B, G, P, O, R][i], id: 'b' + i }), T.line('m', 'b' + i)); });
  return n;
});
add('flow-chart', 'Flow chart', 'Brainstorming', 'Steps and decisions joined with arrows.', () => [
  T.note(60, 160, nt('Start'), { w: 130, color: G, id: 'a' }), T.note(260, 160, nt('Step', 'Do the thing'), { w: 170, color: Y, id: 'b' }), T.note(500, 160, nt('Decision?', 'Yes or no'), { w: 170, color: B, id: 'c' }),
  T.note(740, 60, nt('Yes', 'Continue'), { w: 150, color: Y, id: 'd' }), T.note(740, 270, nt('No', 'Go back'), { w: 150, color: R, id: 'e' }), T.note(960, 60, nt('End'), { w: 120, color: G, id: 'f' }),
  T.line('a', 'b'), T.line('b', 'c'), T.line('c', 'd'), T.line('c', 'e'), T.line('d', 'f'), T.line('e', 'b', { dashed: true })]);
add('five-whys', '5 Whys', 'Brainstorming', 'Ask why five times to find the root cause.', () => [
  T.note(40, 150, nt('Problem', 'What went wrong?'), { w: 160, color: R, id: 'p' }), ...[1, 2, 3, 4, 5].map((i) => T.note(40 + i * 190, 150, nt(tr('tplx.why', { n: i }), 'Because…'), { w: 160, color: i === 5 ? P : Y, id: 'w' + i })),
  T.note(40 + 6 * 190, 150, nt('Root cause', 'What will we change?'), { w: 170, color: G, id: 'r' }), T.line('p', 'w1'), T.line('w1', 'w2'), T.line('w2', 'w3'), T.line('w3', 'w4'), T.line('w4', 'w5'), T.line('w5', 'r')]);
add('concept-map', 'Concept map', 'Brainstorming', 'Connect ideas and label how they relate.', () => [
  T.note(300, 40, nt('Big idea'), { w: 170, color: P, id: 'a' }), T.note(60, 230, nt('Concept'), { w: 150, color: Y, id: 'b' }), T.note(300, 260, nt('Concept'), { w: 150, color: B, id: 'c' }), T.note(540, 230, nt('Concept'), { w: 150, color: G, id: 'd' }),
  T.line('a', 'b'), T.line('a', 'c'), T.line('a', 'd'), T.line('b', 'c', { dashed: true }), T.line('c', 'd', { dashed: true })]);
add('inspiration-library', 'Inspiration library', 'Brainstorming', 'A shelf of themed boards to collect references.', () => [
  T.board(60, 60, 'Colour', '🎨', '#f7768e'), T.board(200, 60, 'Type', '🔤', '#7aa2f7'), T.board(340, 60, 'Layout', '📐', '#9ece6a'), T.board(480, 60, 'Photos', '📷', '#e0af68'), T.board(620, 60, 'Words', '✍️', '#bb9af7'),
  T.note(60, 200, nt('How to use', 'Drop anything that catches your eye into the right board.'), { w: 320, color: Y })]);

// ---- Writing
add('novel-outline', 'Novel outline', 'Writing life', 'Three acts, a cast and a world.', () => [
  ...columns(['Act I · Setup', 'Act II · Confrontation', 'Act III · Resolution'], [stackNotes(['Opening image', 'Inciting incident'], Y), stackNotes(['Midpoint', 'All is lost'], B), stackNotes(['Climax', 'Closing image'], G)]),
  T.board(900, 60, 'Characters', '👥', '#bb9af7'), T.board(1020, 60, 'World', '🗺️', '#7aa2f7'), T.board(900, 190, 'Research', '📚', '#e0af68')]);
add('character-profile', 'Character profile', 'Writing life', 'Facts, wants and fears in one place.', () => [
  T.image(60, 60, 200, 1.1), T.table(290, 60, [['Name', ''], ['Age', ''], ['Occupation', ''], ['Home', '']], { w: 320 }),
  T.note(290, 220, nt('Wants', 'What drives them?'), { w: 150, color: G }), T.note(460, 220, nt('Fears', 'What do they avoid?'), { w: 150, color: R }), T.note(60, 330, nt('Arc', 'Who are they at the start, and at the end?'), { w: 550, color: Y })]);
add('story-beats', 'Story beats', 'Writing life', 'Plot points in four columns.', () => columns(['Setup', 'Conflict', 'Climax', 'Resolution'], [stackNotes(['Who and where']), stackNotes(['What goes wrong']), stackNotes(['The turn']), stackNotes(['How it ends'])]));

// ---- Product & UX
add('product-roadmap', 'Product roadmap', 'Product & UX', 'What is happening now, next and later.', () => columns(['Now', 'Next', 'Later'], [stackNotes(['Fix onboarding'], G), stackNotes(['Search'], B), stackNotes(['Integrations'], P)], { w: 300, gap: 330 }));
add('sprint-board', 'Sprint board', 'Product & UX', 'Backlog to done for a two-week sprint.', () => [
  T.note(60, 60, nt('Sprint goal', 'One sentence.'), { w: 520, color: Y }), ...columns(['Backlog', 'This sprint', 'Doing', 'Done'], [], { y: 170, gap: 280, w: 250 })]);
add('user-persona', 'User persona', 'Product & UX', 'A person worth designing for.', () => [
  T.image(60, 60, 180, 1), T.table(260, 60, [['Name', ''], ['Role', ''], ['Context', '']], { w: 340 }), T.todo(60, 270, 'Goals', ['Goal'], { w: 270 }), T.todo(350, 270, 'Frustrations', ['Pain point'], { w: 250 }), T.note(260, 190, nt('Quote', '“In their own words.”'), { w: 340, color: Y })]);
add('ux-research-plan', 'UX research plan', 'Product & UX', 'Questions, participants and schedule.', () => [
  T.note(60, 60, nt('Research goal', 'What decision will this inform?'), { w: 300, color: Y }), T.todo(60, 200, 'Questions', ['Question one', 'Question two', 'Question three'], { w: 300 }),
  T.table(400, 60, [['Participant', 'Date', 'Notes'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 460 }), T.col(400, 250, 'Findings', [], { w: 220, color: G }), T.col(640, 250, 'Next steps', [], { w: 220 })]);
add('swot', 'SWOT analysis', 'Product & UX', 'Strengths, weaknesses, opportunities and threats.', () => [
  T.col(60, 60, 'Strengths', stackNotes(['…'], G), { w: 320 }), T.col(410, 60, 'Weaknesses', stackNotes(['…'], R), { w: 320 }), T.col(60, 300, 'Opportunities', stackNotes(['…'], B), { w: 320 }), T.col(410, 300, 'Threats', stackNotes(['…'], O), { w: 320 })]);

// ---- Marketing
add('campaign-plan', 'Campaign plan', 'Marketing', 'Objective, audience, channels and a calendar.', () => [
  T.note(60, 60, nt('Objective', 'One measurable goal.'), { w: 280, color: Y }), T.note(60, 190, nt('Audience', 'Who exactly?'), { w: 280, color: B }), T.todo(60, 320, 'Channels', ['Email', 'Social', 'Ads'], { w: 280 }),
  T.table(380, 60, [['Week', 'Message', 'Channel', 'Owner'], ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', ''], ['4', '', '', '']], { w: 520 }), T.table(380, 280, [['Budget', 'Plan', 'Spent'], ['', '', ''], ['', '', '']], { w: 380 })]);
add('content-calendar', 'Content calendar', 'Marketing', 'A month of posts, plus an ideas pile.', () => [
  T.table(60, 60, [['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'], [tr('tplx.week', { n: 1 }), '', '', '', '', ''], [tr('tplx.week', { n: 2 }), '', '', '', '', ''], [tr('tplx.week', { n: 3 }), '', '', '', '', ''], [tr('tplx.week', { n: 4 }), '', '', '', '', '']], { w: 640 }), T.col(740, 60, 'Ideas', stackNotes(['Post idea'], Y), { w: 240 })]);

// ---- Education
add('lesson-plan', 'Lesson plan', 'Education', 'Outcomes, activities and materials for one class.', () => [
  T.note(60, 60, nt('Learning outcomes', 'By the end, students can…'), { w: 300, color: Y }), T.table(400, 60, [['Time', 'Activity', 'Notes'], ['10 min', 'Warm-up', ''], ['25 min', 'Main task', ''], ['10 min', 'Review', '']], { w: 460 }),
  T.todo(60, 210, 'Materials', ['Slides', 'Handouts'], { w: 300 }), T.note(400, 260, nt('Assessment', 'How will you know it worked?'), { w: 300, color: B })]);
add('study-planner', 'Study planner', 'Education', 'Subjects, deadlines and a weekly rhythm.', () => [
  ...columns(['This week', 'Exams', 'Reading list'], [[], [], []], { w: 280, gap: 310 }), T.table(960, 60, [['Subject', 'Due', 'Done'], ['', '', ''], ['', '', '']], { w: 360 })]);

// ---- Personal
add('travel-plan', 'Travel plan', 'Personal', 'Itinerary, bookings and a packing list.', () => [
  T.table(60, 60, [['Day', 'Where', 'Plan'], ['1', '', ''], ['2', '', ''], ['3', '', '']], { w: 480 }), T.todo(60, 240, 'Book', ['Flights', 'Stay', 'Transport'], { w: 240 }), T.todo(320, 240, 'Pack', ['Passport', 'Charger'], { w: 220 }),
  T.board(580, 60, 'Places', '📍', '#f7768e'), T.board(580, 190, 'Docs', '📄', '#7aa2f7')]);
add('home-renovation', 'Home renovation', 'Personal', 'Rooms, budget and a to-do list.', () => [
  T.board(60, 60, 'Kitchen', '🍳', '#e0af68'), T.board(180, 60, 'Bath', '🛁', '#7dcfff'), T.board(300, 60, 'Living', '🛋️', '#9ece6a'), T.table(60, 200, [['Item', 'Budget', 'Paid'], ['', '', ''], ['', '', ''], ['Total', '', '']], { w: 420 }), T.todo(520, 60, 'To do', ['Measure', 'Get quotes'], { w: 260 })]);
add('meal-plan', 'Meal plan', 'Personal', 'A week of meals and the shopping list.', () => [
  T.table(60, 60, [['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ['Breakfast', '', '', '', '', '', '', ''], ['Lunch', '', '', '', '', '', '', ''], ['Dinner', '', '', '', '', '', '', '']], { w: 720 }), T.todo(60, 250, 'Shopping', ['Vegetables', 'Staples'], { w: 260 })]);
add('budget', 'Monthly budget', 'Personal', 'Income, spending and what is left.', () => [
  T.table(60, 60, [['Income', 'Amount'], ['', ''], ['', ''], ['Total', '']], { w: 320 }), T.table(420, 60, [['Spending', 'Planned', 'Actual'], ['Rent', '', ''], ['Food', '', ''], ['Transport', '', ''], ['Total', '', '']], { w: 440 }), T.note(60, 230, nt('Left over', 'What do you want to do with it?'), { w: 320, color: G })]);

// ---- Design
add('logo-process', 'Logo process', 'Design', 'From first words to a short-list of marks.', () => [
  T.note(60, 60, nt('Who is it for?', 'Name, what they do, who they serve.'), { w: 260, color: Y }), T.note(60, 190, nt('Keywords', 'Five words the mark should feel like.'), { w: 260, color: B }),
  T.sketch(350, 60, { w: 280, h: 200 }), T.sketch(650, 60, { w: 280, h: 200 }), T.image(350, 290, 200, 0.8), T.image(570, 290, 200, 0.8), T.image(790, 290, 200, 0.8),
  T.todo(60, 330, 'Checks', ['Works in one colour', 'Readable when tiny', 'Looks good on dark'], { w: 260 })]);
add('website-design', 'Website design board', 'Design', 'Sitemap, inspiration and a to-do list for a new site.', () => [
  T.board(60, 60, 'Home', '🏠', '#7aa2f7'), T.board(180, 60, 'About', '🙂', '#9ece6a'), T.board(300, 60, 'Work', '🖼️', '#e0af68'), T.board(420, 60, 'Contact', '✉️', '#bb9af7'),
  T.image(60, 200, 200, 0.62), T.image(280, 200, 200, 0.62), T.image(500, 200, 200, 0.62), T.note(60, 360, nt('Look & feel', 'Type, colour, spacing, motion.'), { w: 260, color: Y }),
  T.todo(340, 360, 'Build', ['Wireframes', 'Visual design', 'Content in place', 'Test on phone'], { w: 260 })]);
add('ux-research', 'Research study plan', 'Design', 'Questions, participants and what you learned.', () => [
  T.note(60, 60, nt('Research questions', 'What do we need to find out?'), { w: 280, color: Y }), T.table(60, 210, [['Participant', 'Date', 'Notes'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 420 }),
  ...columns(['Observations', 'Patterns', 'Opportunities'], [stackNotes(['One thing you saw'], Y), [], []], { x0: 520, y: 60, gap: 250, w: 220 })]);
add('user-journey', 'User journey', 'Design', 'Stages, feelings and the chance to improve each step.', () => [
  ...['Discover', 'Try', 'Buy', 'Use', 'Recommend'].map((s, i) => T.col(60 + i * 220, 60, s, [{ type: 'note', content: { html: nt('Doing', 'What happens?') } }, { type: 'note', color: Y, content: { html: nt('Feeling', 'High or low?') } }, { type: 'note', color: G, content: { html: nt('Idea', 'How to improve it?') } }], { w: 200 }))]);
add('interior-design', 'Interior design board', 'Design', 'Room by room: style, materials and furniture to buy.', () => [
  ...tiles(60, 60, 3, 2, 170), T.table(640, 60, [['Item', 'Where', 'Price'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 380 }), T.note(640, 230, nt('Materials & colours', 'Wood, metal, fabric, paint codes.'), { w: 260, color: Y }),
  T.todo(60, 400, 'Measure', ['Room size', 'Windows', 'Doors'], { w: 240 })]);
add('architecture', 'Architecture project', 'Design', 'Site, concept and drawings for a building.', () => [
  T.note(60, 60, nt('Site', 'Place, climate, rules, neighbours.'), { w: 260, color: Y }), T.note(60, 200, nt('Concept', 'The idea in one paragraph.'), { w: 260, color: B }),
  T.sketch(350, 60, { w: 300, h: 220 }), T.image(670, 60, 220, 0.75), T.image(670, 240, 220, 0.75), T.table(350, 310, [['Drawing', 'Status'], ['Plan', ''], ['Section', ''], ['Elevation', '']], { w: 300 })]);
add('fashion', 'Fashion collection', 'Design', 'Inspiration, sketches and a look list.', () => [
  ...tiles(60, 60, 3, 1, 180), T.sketch(60, 260, { w: 240 }), T.sketch(320, 260, { w: 240 }), T.table(700, 60, [['Look', 'Fabric', 'Colour'], ['1', '', ''], ['2', '', ''], ['3', '', '']], { w: 380 }), T.todo(700, 250, 'Make', ['Patterns', 'Samples', 'Fittings'], { w: 260 })]);
add('game-design', 'Game design doc', 'Design', 'Pitch, mechanics, levels and what to build next.', () => [
  T.note(60, 60, nt('Pitch', 'The game in two sentences.'), { w: 280, color: Y }), T.note(60, 190, nt('Core loop', 'What does the player do again and again?'), { w: 280, color: B }),
  T.table(380, 60, [['Level', 'Idea', 'Status'], ['1', '', ''], ['2', '', ''], ['3', '', '']], { w: 400 }), ...columns(['Backlog', 'Building', 'Playtest'], [stackNotes(['First mechanic'], Y), [], []], { x0: 60, y: 340, gap: 250, w: 220 })]);
add('motion-design', 'Motion design plan', 'Design', 'Style frames, timing and an animation checklist.', () => [
  T.image(60, 60, 220, 0.56), T.image(300, 60, 220, 0.56), T.image(540, 60, 220, 0.56), T.note(60, 200, nt('Feel', 'Snappy, floaty, bouncy? Pick one.'), { w: 260, color: Y }),
  T.table(340, 200, [['Scene', 'Seconds', 'Notes'], ['Intro', '', ''], ['Middle', '', ''], ['Outro', '', '']], { w: 420 }), T.todo(60, 340, 'Produce', ['Storyboard', 'Animatic', 'Final render'], { w: 260 })]);

// ---- Business
add('startup-plan', 'Startup one-pager', 'Business', 'Problem, solution, market and what you need next.', () => brief([
  ['Problem', 'Who hurts, and how much?'], ['Solution', 'What do you offer instead?'], ['Market', 'How many people could use it?'], ['How you earn', 'Price and who pays.'], ['Edge', 'Why you, why now?'], ['Next 90 days', 'Three things that prove it works.']],
  [T.table(660, 60, [['Metric', 'Today', 'Goal'], ['Users', '', ''], ['Revenue', '', ''], ['Runway', '', '']], { w: 320 })]));
add('product-roadmap-2', 'Product roadmap', 'Business', 'Now, next and later, with the reasons behind each bet.', () => columns(['Now', 'Next', 'Later'], [stackNotes(['Fix onboarding'], G), stackNotes(['New feature idea'], Y), stackNotes(['Big experiment'], B)], { w: 300, gap: 330 }));
add('market-research', 'Market research', 'Business', 'Competitors, customers and what you will do about it.', () => [
  T.table(60, 60, [['Competitor', 'Strength', 'Weakness', 'Price'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']], { w: 560 }), T.note(60, 260, nt('Customers', 'Who they are, what they do today.'), { w: 270, color: Y }),
  T.note(350, 260, nt('Gaps', 'What nobody does well yet.'), { w: 270, color: G }), T.link(660, 60), T.link(660, 170), T.todo(660, 280, 'Next', ['Talk to five customers', 'Summarise findings'], { w: 260 })]);
add('swot-2', 'SWOT analysis', 'Business', 'Strengths, weaknesses, opportunities and threats.', () => [
  T.col(60, 60, 'Strengths', stackNotes(['What we do well'], G), { w: 320 }), T.col(410, 60, 'Weaknesses', stackNotes(['What holds us back'], R), { w: 320 }),
  T.col(60, 320, 'Opportunities', stackNotes(['What could help us'], B), { w: 320 }), T.col(410, 320, 'Threats', stackNotes(['What could hurt us'], O), { w: 320 })]);
add('brand-workshop', 'Brand workshop', 'Business', 'Exercises to agree what a brand stands for.', () => [
  T.note(60, 60, nt('Why we exist', 'Beyond making money.'), { w: 260, color: Y }), T.note(340, 60, nt('Values', 'Three, and what each looks like in practice.'), { w: 260, color: B }),
  T.note(620, 60, nt('If we were a person', 'How would we talk and dress?'), { w: 260, color: P }), T.col(60, 230, 'We are', stackNotes(['Warm', 'Direct'], G), { w: 260 }), T.col(340, 230, 'We are not', stackNotes(['Stuffy', 'Vague'], R), { w: 260 }), T.image(620, 230, 260, 0.7)]);
add('agency-client', 'Client project board', 'Business', 'Brief, deliverables, feedback and approvals in one place.', () => [
  T.note(60, 60, nt('Client', 'Contact, goals, rules of the house.'), { w: 260, color: Y }), T.table(340, 60, [['Deliverable', 'Due', 'Status'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 460 }),
  ...columns(['Feedback', 'Doing', 'Approved'], [stackNotes(['Comment from client'], R), [], stackNotes(['Signed off'], G)], { x0: 60, y: 260, gap: 260, w: 240 })]);
add('event-marketing', 'Event run sheet', 'Business', 'Run of show, roles and supplies for a live event.', () => [
  T.table(60, 60, [['Time', 'What happens', 'Lead'], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']], { w: 520 }), T.todo(620, 60, 'Supplies', ['Signage', 'Badges', 'Power strips', 'First-aid kit'], { w: 260 }),
  T.note(60, 300, nt('Contacts', 'Venue, suppliers, speakers.'), { w: 260, color: Y }), T.note(340, 300, nt('If it goes wrong', 'Plan B for the top three risks.'), { w: 260, color: R })]);
add('meeting-notes', 'Meeting notes', 'Business', 'Agenda, decisions and who does what next.', () => [
  T.note(60, 60, nt('Agenda', 'Topics in order.'), { w: 260, color: Y }), T.note(340, 60, nt('Decisions', 'What did we agree?'), { w: 260, color: G }), T.todo(620, 60, 'Actions', ['Owner · task · date'], { w: 260 }),
  T.note(60, 200, nt('Notes', 'Anything worth keeping.'), { w: 540 })]);
add('sprint-board-2', 'Sprint board', 'Business', 'A two-week sprint from backlog to shipped.', () => [
  T.note(60, 60, nt('Sprint goal', 'One sentence the whole team can repeat.'), { w: 400, color: P }), ...columns(['Backlog', 'In progress', 'Review', 'Shipped'], [stackNotes(['Story'], Y), [], [], []], { x0: 60, y: 200, gap: 270, w: 250 })]);

// ---- Media
add('podcast', 'Podcast planner', 'Media', 'Episode ideas, an outline and a publishing checklist.', () => [
  T.col(60, 60, 'Ideas', stackNotes(['Topic or guest'], Y), { w: 250 }), T.note(330, 60, nt('Episode outline', 'Hook · story · takeaway · call to action.'), { w: 280, color: B }),
  T.todo(330, 220, 'Publish', ['Record', 'Edit', 'Show notes', 'Cover art', 'Upload'], { w: 280 }), T.table(640, 60, [['Ep', 'Title', 'Date'], ['1', '', ''], ['2', '', ''], ['3', '', '']], { w: 320 })]);
add('photo-shoot', 'Photo shoot plan', 'Media', 'Look references, shot list and the day schedule.', () => [
  ...tiles(60, 60, 3, 1, 180), T.todo(60, 250, 'Shot list', ['Wide', 'Detail', 'Portrait', 'Action'], { w: 260 }), T.table(350, 250, [['Time', 'Where', 'Notes'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 400 }), T.note(60, 520, nt('Gear', 'Camera, lenses, lights, spare batteries.'), { w: 260, color: Y })]);
add('content-calendar-2', 'Content calendar', 'Media', 'Plan posts across the month and track what is ready.', () => [
  ...['Week 1', 'Week 2', 'Week 3', 'Week 4'].map((w, i) => T.col(60 + i * 250, 60, w, stackNotes(['Post idea'], i === 0 ? Y : null), { w: 230 })), T.todo(60, 420, 'Every week', ['Plan', 'Create', 'Schedule', 'Review numbers'], { w: 260 })]);
add('filmmaking', 'Film production', 'Media', 'Script, cast, locations and the shoot schedule.', () => [
  T.note(60, 60, nt('Logline', 'The film in one sentence.'), { w: 280, color: Y }), T.table(60, 200, [['Scene', 'Place', 'Cast', 'Day'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']], { w: 480 }), T.col(580, 60, 'Locations', [T.image(0, 0, 200, 0.6)], { w: 240 }), T.todo(60, 400, 'Before the shoot', ['Permits', 'Rehearsal', 'Equipment check'], { w: 260 })]);
add('video-channel', 'Video channel plan', 'Media', 'Ideas, scripts and a publishing rhythm.', () => [
  T.col(60, 60, 'Ideas', stackNotes(['Video idea'], Y), { w: 230 }), T.col(310, 60, 'Scripting', [], { w: 230 }), T.col(560, 60, 'Filming', [], { w: 230 }), T.col(810, 60, 'Editing', [], { w: 230 }), T.col(1060, 60, 'Live', [], { w: 230, color: G })]);

// ---- Making & Dev
add('home-renovation-2', 'Home renovation', 'Making & Dev', 'Rooms, budget and the order of work.', () => [
  T.board(60, 60, 'Kitchen', '🍳', '#e0af68'), T.board(180, 60, 'Bathroom', '🛁', '#7dcfff'), T.board(300, 60, 'Living room', '🛋️', '#9ece6a'), T.table(60, 200, [['Job', 'Who', 'Cost', 'Done?'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']], { w: 500 }),
  T.todo(600, 60, 'Order of work', ['Plan & permits', 'Demolition', 'Wiring & plumbing', 'Finishes'], { w: 260 }), T.note(600, 280, nt('Budget', 'Total, buffer, what you will not cut.'), { w: 260, color: Y })]);
add('craft-project', 'Craft project', 'Making & Dev', 'Materials, steps and progress photos.', () => [
  T.image(60, 60, 220, 0.8), T.todo(300, 60, 'Materials', ['Item one', 'Item two', 'Item three'], { w: 240 }), T.todo(560, 60, 'Steps', ['Cut', 'Assemble', 'Finish'], { w: 240 }), T.sketch(60, 300, { w: 260 }), T.note(340, 300, nt('Notes to self', 'What worked, what to change next time.'), { w: 260, color: Y })]);
add('garden-plan', 'Garden plan', 'Making & Dev', 'A bed map, planting calendar and shopping list.', () => [
  T.sketch(60, 60, { w: 320, h: 240 }), T.table(400, 60, [['Plant', 'Sow', 'Harvest'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 380 }), T.todo(400, 250, 'Buy', ['Seeds', 'Compost', 'Stakes'], { w: 240 })]);
add('software-spec', 'Feature spec', 'Making & Dev', 'Problem, approach and a checklist before shipping.', () => brief([
  ['Problem', 'What is broken or missing, and for whom?'], ['Approach', 'How will we solve it? Sketch the main flow.'], ['Out of scope', 'What we are deliberately not doing.'], ['Risks', 'What could go wrong?']],
  [T.todo(660, 60, 'Before shipping', ['Tests pass', 'Docs updated', 'Rollout plan', 'Metrics in place'], { w: 260 })]));
add('bug-triage', 'Bug triage', 'Making & Dev', 'Sort reports by severity and decide what to fix first.', () => columns(['New', 'Critical', 'Next release', 'Later', 'Fixed'], [stackNotes(['Report title'], Y), [], [], [], []], { w: 220, gap: 245, colors: [null, R, O, S, G] }));
add('api-map', 'System map', 'Making & Dev', 'Boxes and arrows for how parts of a system talk.', () => [
  T.note(60, 160, nt('App', 'What the user sees'), { w: 180, color: B, id: 'a' }), T.note(320, 160, nt('API', 'Rules and checks'), { w: 180, color: Y, id: 'b' }), T.note(580, 60, nt('Database', 'Where data lives'), { w: 180, color: G, id: 'c' }), T.note(580, 260, nt('Queue', 'Slow jobs'), { w: 180, color: P, id: 'd' }),
  T.line('a', 'b'), T.line('b', 'c'), T.line('b', 'd')]);

// ---- Fiction
add('novel-outline-2', 'Novel outline', 'Fiction', 'Six story turns, each with room for the scenes that carry it.', () => [
  T.note(60, 40, nt('Premise', 'Who wants what, and what stands in the way? One or two sentences.'), { w: 560, color: Y }),
  ...[['1 · Setup', 'Show the ordinary world and what is missing from it.'], ['2 · Disturbance', 'Something arrives that cannot be ignored.'], ['3 · Rising trouble', 'Every attempt to fix it makes things worse.'], ['4 · Midpoint turn', 'A discovery or loss that changes the goal.'], ['5 · Crisis & climax', 'The hardest choice, then the confrontation.'], ['6 · Aftermath', 'What changed, and what it cost.']]
    .map(([title, hint], i) => T.col(60 + (i % 3) * 290, 150 + Math.floor(i / 3) * 330, title, [{ type: 'note', color: [Y, B, G, P, O, R][i], content: { html: nt('Beat', hint) } }, { type: 'note', content: { html: nt('Scenes', 'List the scenes that do this job.') } }], { w: 262 }))]);
add('beat-sheet', 'Beat sheet', 'Fiction', 'Ten beats in a row to check that your story keeps moving.', () => [
  ...['Opening image', 'Want', 'Break in', 'Fun & games', 'Midpoint', 'Pressure', 'Low point', 'Turn', 'Finale', 'Closing image'].map((b, i) => T.col(60 + (i % 5) * 230, 60 + Math.floor(i / 5) * 280, b, [{ type: 'note', color: i % 2 ? Y : B, content: { html: nt('What happens', '') } }], { w: 210 }))]);
add('character-profile-2', 'Character profile', 'Fiction', 'Who they are, what they want and what they hide.', () => [
  T.image(60, 60, 200, 1.1), T.note(280, 60, nt('Name & role', 'Age, job, where they live.'), { w: 260, color: Y }), T.note(280, 170, nt('Want / need', 'What they chase vs. what they actually need.'), { w: 260, color: B }),
  T.note(280, 290, nt('Flaw & fear', 'What gets in their own way?'), { w: 260, color: R }), T.note(60, 330, nt('Voice', 'How they talk: rhythm, favourite words, what they never say.'), { w: 200, color: P }),
  T.table(570, 60, [['Trait', 'Detail'], ['Habit', ''], ['Secret', ''], ['Strength', ''], ['Contradiction', '']], { w: 320 }), T.todo(570, 260, 'Show on the page', ['A small kindness', 'A bad decision', 'A moment of humour'], { w: 320 })]);
add('character-web', 'Character web', 'Fiction', 'See who is tied to whom, and why it matters.', () => [
  T.note(360, 240, nt('Protagonist', 'Name'), { w: 160, color: Y, id: 'p' }), T.note(80, 60, nt('Ally', 'What they give'), { w: 150, color: G, id: 'a' }), T.note(640, 60, nt('Rival', 'What they want'), { w: 150, color: R, id: 'r' }),
  T.note(80, 420, nt('Mentor', 'What they teach'), { w: 150, color: B, id: 'm' }), T.note(640, 420, nt('Wildcard', 'What they disrupt'), { w: 150, color: P, id: 'w' }),
  T.line('p', 'a'), T.line('p', 'r'), T.line('p', 'm'), T.line('p', 'w'), T.line('a', 'r', { dashed: true })]);
add('world-bible', 'World bible', 'Fiction', 'One home for everything the reader must believe about your world.', () => [
  T.note(60, 40, nt('The world in a line', 'What makes it different from ours?'), { w: 540, color: Y }),
  T.board(60, 160, 'Places', '🗺️', '#7aa2f7'), T.board(180, 160, 'People', '🧑', '#f7768e'), T.board(300, 160, 'History', '📜', '#e0af68'), T.board(420, 160, 'Rules', '⚖️', '#bb9af7'), T.board(540, 160, 'Culture', '🎭', '#9ece6a'),
  T.table(60, 300, [['Term', 'Meaning', 'Where used'], ['', '', ''], ['', '', ''], ['', '', '']], { w: 540 }), T.todo(640, 160, 'Still to decide', ['Names of the main places', 'Who holds power', 'What is forbidden'], { w: 260 })]);
add('scene-cards', 'Scene cards by chapter', 'Fiction', 'Every scene is a card: purpose, conflict and how it ends.', () => [
  ...['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4'].map((c, i) => T.col(60 + i * 290, 60, c, [{ type: 'note', color: i === 0 ? Y : null, content: { html: nt('Scene · place · time', 'Goal: <br>Conflict: <br>Outcome: ') } }], { w: 262 }))]);
add('plot-timeline', 'Story timeline', 'Fiction', 'Keep dates, events and who knows what in order.', () => [
  T.table(60, 60, [['When', 'What happens', 'Who is there', 'Who knows'], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']], { w: 700 }), T.note(60, 330, nt('Continuity watch', 'Ages, seasons, travel time, injuries, objects that move.'), { w: 340, color: R })]);
add('short-story', 'Short story planner', 'Fiction', 'Small enough to hold in one head: person, problem, turn, ending.', () => [
  T.note(60, 60, nt('Person', 'Who? What do they want right now?'), { w: 260, color: Y }), T.note(340, 60, nt('Problem', 'What gets in the way?'), { w: 260, color: R }), T.note(620, 60, nt('Turn', 'The moment things cannot go back.'), { w: 260, color: P }),
  T.note(60, 200, nt('Ending', 'What changes? End on an image, not a lesson.'), { w: 260, color: G }), T.todo(340, 200, 'Drafts', ['First pass, ugly and fast', 'Cut the first paragraph', 'Read aloud'], { w: 260 }), T.note(620, 200, nt('Opening lines to try', ''), { w: 260 })]);
add('screenplay-outline', 'Screenplay outline', 'Fiction', 'Logline, three acts and a list of sequences.', () => [
  T.note(60, 40, nt('Logline', 'A [hero] must [goal] before [stakes].'), { w: 540, color: Y }), ...['Act I', 'Act II', 'Act III'].map((a, i) => T.col(60 + i * 290, 150, a, stackNotes(['Sequence: what the audience learns', 'Sequence: what goes wrong'], [B, G, P][i]), { w: 262 })),
  T.table(60, 480, [['Scene', 'INT/EXT', 'Place', 'Pages'], ['', '', '', ''], ['', '', '', '']], { w: 540 })]);
add('series-bible', 'Series bible', 'Fiction', 'The facts that must stay true from book to book.', () => [
  T.note(60, 60, nt('Series promise', 'What does a reader get every time?'), { w: 280, color: Y }), T.note(60, 190, nt('Big arc', 'Where is the whole series heading?'), { w: 280, color: B }),
  T.table(380, 60, [['Book', 'Title', 'Main question', 'Status'], ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', '']], { w: 520 }), T.board(380, 260, 'Characters', '🧑', '#f7768e'), T.board(500, 260, 'Places', '🗺️', '#7aa2f7'), T.board(620, 260, 'Timeline', '⏳', '#e0af68')]);
add('magic-system', 'Rules & magic system', 'Fiction', 'Limits and costs make a power interesting.', () => [
  T.note(60, 60, nt('What it can do', 'The headline power.'), { w: 250, color: G }), T.note(330, 60, nt('What it costs', 'Energy, time, a memory, a favour?'), { w: 250, color: R }), T.note(600, 60, nt('What it cannot do', 'The limits you will never break.'), { w: 250, color: B }),
  T.table(60, 210, [['Who can use it', 'How they learned', 'Weak spot'], ['', '', ''], ['', '', '']], { w: 540 }), T.todo(640, 210, 'Test it', ['Does it solve the plot too easily?', 'Who would abuse it?', 'How do ordinary people cope?'], { w: 260 })]);
add('location-sheet', 'Setting sheet', 'Fiction', 'Make a place feel real with senses, history and secrets.', () => [
  T.image(60, 60, 260, 0.7), T.note(340, 60, nt('Sight · sound · smell', 'Three details only this place has.'), { w: 280, color: Y }), T.note(340, 190, nt('History', 'What happened here before the story?'), { w: 280, color: B }),
  T.note(60, 270, nt('Who comes here', 'And why.'), { w: 260, color: G }), T.note(340, 320, nt('Secret', 'Something hidden that matters.'), { w: 280, color: P })]);
add('mystery-board', 'Mystery clue board', 'Fiction', 'Suspects, clues and what the reader knows when.', () => [
  ...['Suspect A', 'Suspect B', 'Suspect C'].map((s, i) => T.col(60 + i * 270, 60, s, stackNotes(['Motive', 'Alibi', 'Lie they tell'], [Y, B, P][i]), { w: 250 })),
  T.table(60, 380, [['Clue', 'Planted in', 'Revealed in', 'Points to'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']], { w: 600 }), T.note(900, 60, nt('The truth', 'What really happened, in order.'), { w: 240, color: R })]);
add('poem-workshop', 'Poem & lyric workshop', 'Fiction', 'Catch images, try lines and keep every draft.', () => [
  T.note(60, 60, nt('Seed', 'The feeling or image you do not want to lose.'), { w: 260, color: Y }), T.col(340, 60, 'Lines to try', stackNotes(['A line', 'Another line'], B), { w: 260 }), T.col(620, 60, 'Drafts', [], { w: 260 }),
  T.table(60, 200, [['Word', 'Rhymes / echoes'], ['', ''], ['', '']], { w: 260 })]);

// ---- Nonfiction
add('article-planner', 'Article planner', 'Nonfiction', 'Angle, outline and sources before you write a word.', () => [
  T.note(60, 60, nt('Angle', 'Why this, why now, for whom?'), { w: 280, color: Y }), T.note(60, 190, nt('Hook', 'The first thing the reader should feel.'), { w: 280, color: B }),
  T.col(380, 60, 'Outline', stackNotes(['Opening', 'Section one', 'Section two', 'Ending'], null), { w: 250 }), T.table(650, 60, [['Source', 'What it gives me', 'Link'], ['', '', ''], ['', '', '']], { w: 380 }), T.todo(60, 340, 'Before sending', ['Facts checked', 'Quotes approved', 'Headline options', 'Word count'], { w: 280 })]);
add('essay-outline', 'Essay outline', 'Nonfiction', 'A thesis, the reasons behind it and the best objection.', () => [
  T.note(60, 60, nt('Thesis', 'The claim, in one sentence.'), { w: 340, color: Y }), ...['Reason 1', 'Reason 2', 'Reason 3'].map((r, i) => T.col(60 + i * 260, 190, r, stackNotes(['Evidence or example'], [B, G, P][i]), { w: 240 })),
  T.note(60, 450, nt('Strongest objection', 'And your answer to it.'), { w: 340, color: R }), T.note(420, 450, nt('Ending', 'What should the reader do or think next?'), { w: 340, color: G })]);
add('nonfiction-book', 'Nonfiction book plan', 'Nonfiction', 'Promise, readers and a chapter-by-chapter map.', () => [
  T.note(60, 60, nt('Promise', 'After reading, the reader can…'), { w: 280, color: Y }), T.note(60, 190, nt('Reader', 'Who they are and what they already know.'), { w: 280, color: B }),
  T.table(380, 60, [['Ch.', 'Title', 'Big idea', 'Words'], ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', ''], ['4', '', '', '']], { w: 560 }), T.board(60, 340, 'Research', '🔎', '#7dcfff'), T.board(180, 340, 'Interviews', '🎤', '#f7768e'), T.board(300, 340, 'Drafts', '✍️', '#9ece6a')]);
add('research-board', 'Research board', 'Nonfiction', 'Questions, sources and quotes kept together.', () => [
  T.col(60, 60, 'Questions', stackNotes(['What do I need to know?'], Y), { w: 250 }), T.col(330, 60, 'Quotes', stackNotes(['“Quote” — source, page'], B), { w: 250 }), T.col(600, 60, 'Facts to check', [], { w: 250, color: R }),
  T.table(60, 380, [['Source', 'Type', 'Link', 'Trust (1–5)'], ['', '', '', ''], ['', '', '', '']], { w: 540 })]);
add('interview-prep', 'Interview prep', 'Nonfiction', 'Questions, background and notes to capture on the day.', () => [
  T.note(60, 60, nt('Who & why', 'What makes them the right person?'), { w: 260, color: Y }), T.todo(60, 190, 'Questions', ['Open: tell me about…', 'The story only they can tell', 'The hard one', 'What did I not ask?'], { w: 260 }),
  T.note(350, 60, nt('Notes during', 'Moments, quotes and timestamps.'), { w: 320, color: B }), T.todo(350, 260, 'After', ['Transcribe', 'Send thanks', 'Check quotes with them'], { w: 320 })]);
add('newsletter-planner', 'Newsletter planner', 'Nonfiction', 'Ideas to issues: plan, draft and send on a rhythm.', () => [
  T.col(60, 60, 'Ideas', stackNotes(['Topic worth an email'], Y), { w: 240 }), T.col(320, 60, 'Drafting', [], { w: 240 }), T.col(580, 60, 'Scheduled', [], { w: 240 }), T.col(840, 60, 'Sent', [], { w: 240, color: G }),
  T.todo(60, 400, 'Every issue', ['One idea, clearly', 'Subject line options', 'Read it aloud', 'Link check'], { w: 280 })]);
add('memoir-map', 'Memoir memory map', 'Nonfiction', 'Collect the moments first; shape them later.', () => [
  ...['Childhood', 'Teenage years', 'Turning points', 'Now'].map((c, i) => T.col(60 + i * 270, 60, c, stackNotes(['A memory: where, who, what you remember most'], [Y, B, P, G][i]), { w: 250 })),
  T.note(60, 380, nt('The thread', 'What do these moments say together?'), { w: 340, color: R }), T.todo(420, 380, 'Check with others', ['Dates', 'Names', 'Permissions'], { w: 260 })]);

// ---- Writing life
add('idea-inbox', 'Idea inbox', 'Writing life', 'Catch sparks fast, then move the good ones forward.', () => [
  T.col(60, 60, 'Sparks', stackNotes(['A line overheard', 'A what-if', 'An image'], Y), { w: 260 }), T.col(350, 60, 'Developing', [], { w: 260 }), T.col(640, 60, 'Ready to write', [], { w: 260, color: G }), T.col(930, 60, 'Parked', [], { w: 260, color: S }),
  T.note(60, 420, nt('Rule of thumb', 'Write it down in under ten seconds. Sort it later.'), { w: 300, color: B })]);
add('writing-goals', 'Writing goals & habits', 'Writing life', 'Set a rhythm, log your words and see the streak.', () => [
  T.note(60, 60, nt('This season', 'What finished piece do I want at the end?'), { w: 300, color: Y }), T.table(60, 190, [['Day', 'Words', 'Minutes', 'Felt like'], ['Mon', '', '', ''], ['Tue', '', '', ''], ['Wed', '', '', ''], ['Thu', '', '', ''], ['Fri', '', '', '']], { w: 420 }),
  T.todo(520, 60, 'Habits', ['Write before checking messages', 'Stop mid-sentence', 'Weekly review'], { w: 280 }), T.note(520, 260, nt('Wins', 'Anything that went well, however small.'), { w: 280, color: G })]);
add('revision-plan', 'Revision plan', 'Writing life', 'Revise in passes: big picture first, polish last.', () => [
  T.todo(60, 60, 'Pass 1 · Structure', ['Does the story work in one paragraph?', 'Cut or move scenes', 'Check the ending against the start'], { w: 280 }), T.todo(370, 60, 'Pass 2 · Scenes', ['Each scene has a purpose', 'Enter late, leave early', 'Sharpen conflict'], { w: 280 }),
  T.todo(680, 60, 'Pass 3 · Lines', ['Cut filler words', 'Vary sentence length', 'Read aloud'], { w: 280 }), T.todo(60, 320, 'Pass 4 · Proof', ['Spelling and names', 'Dates and facts', 'Formatting'], { w: 280 }), T.note(370, 320, nt('Reader feedback', 'Paste comments here, then sort them into passes.'), { w: 280, color: Y })]);
add('submission-tracker', 'Submission tracker', 'Writing life', 'Where every piece has gone, and what happened next.', () => [
  T.table(60, 60, [['Piece', 'Sent to', 'Date', 'Status', 'Reply'], ['', '', '', 'Sent', ''], ['', '', '', '', ''], ['', '', '', '', '']], { w: 700 }), T.note(60, 280, nt('Query / cover letter', 'Hook · the piece · why you · a line about you.'), { w: 340, color: Y }), T.note(420, 280, nt('Synopsis', 'One page: the whole story, including the ending.'), { w: 340, color: B }),
  T.todo(60, 460, 'Before sending', ['Follow their guidelines exactly', 'Proofread', 'Track it here'], { w: 340 })]);
add('dialogue-bank', 'Dialogue & phrase bank', 'Writing life', 'Keep lines you hear, voices you like and words you love.', () => [
  T.col(60, 60, 'Overheard', stackNotes(['“…”'], Y), { w: 260 }), T.col(350, 60, 'Character voices', stackNotes(['Name: how they talk'], B), { w: 260 }), T.col(640, 60, 'Words I love', stackNotes(['A word and where it fits'], G), { w: 260 })]);
add('prompt-jar', 'Prompt jar', 'Writing life', 'Warm-ups for days when the page looks too white.', () => [
  ...['Write the scene from the other person’s side.', 'Start with the last line.', 'A character finds something that is not theirs.', 'Describe a room using only sound.', 'Two people who cannot say what they mean.', 'What did they leave out of the letter?'].map((p, i) => T.note(60 + (i % 3) * 250, 60 + Math.floor(i / 3) * 150, nt(`Prompt ${i + 1}`, p), { w: 230, color: [Y, B, G, P, O, R][i] })),
  T.todo(60, 380, 'Warm-up rules', ['Ten minutes, timer on', 'No deleting', 'Keep the best sentence'], { w: 260 })]);

export const BUILTIN_TEMPLATES = L;
