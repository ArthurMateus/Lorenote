// Template engine + built-in library.
//
// A template is a list of "nodes" (a small tree: type, position, content, kids). The same node format is used for
//   - the built-in library below (authored here),
//   - boards a user saves as their own template (converted from the flat element map),
// so one instantiate() and one thumbnail renderer cover both.
import { makeElement, defaultContent, COLORS } from './model.js';
import { uid } from './store.js';

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
export function freeSpot(store, boardId) {
  const kids = store.children(boardId, 'canvas').filter((e) => e.type !== 'line');
  if (!kids.length) return { dx: 0, dy: 0 };
  let right = -Infinity, top = Infinity;
  for (const e of kids) { right = Math.max(right, e.x + (e.w || DEFAULT_W[e.type] || 200)); top = Math.min(top, e.y); }
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
    const { nd } = it; const x = ox + it.x * k, y = oy + it.y * k, rw = it.w * k, rh = it.h * k; const fill = nd.color || TYPE_FILL[nd.type] || '#fff';
    if (nd.type === 'board') { out.push(rect(x + rw * .1, y, rw * .8, rh * .8, (nd.content?.tint || '#7aa2f7') + '55', 4, nd.content?.tint || '#7aa2f7')); continue; }
    out.push(rect(x, y, rw, rh, fill, 2.5, '#00000022'));
    if (nd.type === 'column') {
      let cy = y + 70 * k;
      for (const kid of nd.kids || []) { const ks = estSize({ ...kid, w: it.w - 36 }); out.push(rect(x + 8 * k, cy, rw - 16 * k, ks.h * k, kid.type === 'image' ? '#cfd3dc' : (kid.color || '#fff'), 1.5)); cy += (ks.h + 8) * k; }
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
  note: (x, y, html, o = {}) => ({ type: 'note', x, y, w: o.w || 220, color: o.color || null, id: o.id, content: { html } }),
  col: (x, y, title, kids = [], o = {}) => ({ type: 'column', x, y, w: o.w || 260, color: o.color || null, id: o.id, content: { title }, kids }),
  todo: (x, y, title, tasks, o = {}) => ({ type: 'todo', x, y, w: o.w || 260, id: o.id, content: { title: title || '', showTitle: !!title }, kids: tasks.map((t) => ({ type: 'task', content: { text: t, done: false } })) }),
  table: (x, y, rows, o = {}) => ({ type: 'table', x, y, w: o.w || 440, id: o.id, content: { rows, header: o.header !== false } }),
  board: (x, y, title, icon, tint, kids = [], o = {}) => ({ type: 'board', x, y, w: 96, id: o.id, content: { title, icon, tint }, kids }),
  link: (x, y, o = {}) => ({ type: 'link', x, y, w: o.w || 260, id: o.id, content: { url: '', title: '' } }),
  image: (x, y, w = 200, ratio = 0.7, o = {}) => ({ type: 'image', x, y, w, id: o.id, content: { src: '', name: '', ratio } }),
  sketch: (x, y, o = {}) => ({ type: 'sketch', x, y, w: o.w || 280, id: o.id, content: { strokes: [], h: o.h || 180 } }),
  line: (from, to, o = {}) => ({ type: 'line', from, to, arrow: o.arrow !== false, dashed: !!o.dashed, content: {} }),
};
const cn = (t) => `<b>${t}</b>`;                               // heading line inside a note
const nt = (head, body = '') => `<b>${head}</b>${body ? '<br>' + body : ''}`;
/** n equally spaced columns */
const columns = (titles, kidsByCol = [], o = {}) => titles.map((t, i) => T.col((o.x0 ?? 60) + i * (o.gap ?? 290), o.y ?? 60, t, kidsByCol[i] || [], { w: o.w ?? 260, color: o.colors?.[i] }));
const stackNotes = (items, color) => items.map((h) => ({ type: 'note', color: color || null, content: { html: h } }));
const empty = (n) => Array.from({ length: n }, () => ['', '', '']);

/** a brief: titled prompt notes in a 2-column grid, plus optional extras */
const brief = (sections, extras = []) => [
  ...sections.map(([head, prompt], i) => T.note(60 + (i % 2) * 300, 60 + Math.floor(i / 2) * 150, nt(head, prompt), { w: 270, color: [Y, B, G, P, O, R][i % 6] })),
  ...extras,
];

// ------------------------------------------------------------------ built-in library
export const CATEGORIES = ['Planning', 'Briefs', 'Moodboards', 'Storyboards', 'Brainstorming', 'Writing', 'Product & UX', 'Marketing', 'Education', 'Personal'];

const L = [];
const add = (id, name, category, description, nodes) => L.push({ id, name, category, description, nodes: typeof nodes === 'function' ? nodes() : nodes });

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
const tiles = (x0, y0, nx, ny, w = 180, gap = 14, ratios = [0.75, 1, 0.66]) => Array.from({ length: nx * ny }, (_, i) => T.image(x0 + (i % nx) * (w + gap), y0 + Math.floor(i / nx) * (w * 0.9 + gap), w, ratios[i % ratios.length]));
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
const panel = (x, y, i, w = 230) => T.col(x, y, `Shot ${i}`, [T.image(0, 0, w - 36, 0.56), { type: 'note', content: { html: nt('Action', 'What happens?') } }], { w });
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
  br.forEach(([t, x, y], i) => { n.push(T.note(x, y, nt('Branch ' + t), { w: 160, color: [Y, B, G, P, O, R][i], id: 'b' + i }), T.line('m', 'b' + i)); });
  return n;
});
add('flow-chart', 'Flow chart', 'Brainstorming', 'Steps and decisions joined with arrows.', () => [
  T.note(60, 160, nt('Start'), { w: 130, color: G, id: 'a' }), T.note(260, 160, nt('Step', 'Do the thing'), { w: 170, color: Y, id: 'b' }), T.note(500, 160, nt('Decision?', 'Yes or no'), { w: 170, color: B, id: 'c' }),
  T.note(740, 60, nt('Yes', 'Continue'), { w: 150, color: Y, id: 'd' }), T.note(740, 270, nt('No', 'Go back'), { w: 150, color: R, id: 'e' }), T.note(960, 60, nt('End'), { w: 120, color: G, id: 'f' }),
  T.line('a', 'b'), T.line('b', 'c'), T.line('c', 'd'), T.line('c', 'e'), T.line('d', 'f'), T.line('e', 'b', { dashed: true })]);
add('five-whys', '5 Whys', 'Brainstorming', 'Ask why five times to find the root cause.', () => [
  T.note(40, 150, nt('Problem', 'What went wrong?'), { w: 160, color: R, id: 'p' }), ...[1, 2, 3, 4, 5].map((i) => T.note(40 + i * 190, 150, nt(`Why ${i}?`, 'Because…'), { w: 160, color: i === 5 ? P : Y, id: 'w' + i })),
  T.note(40 + 6 * 190, 150, nt('Root cause', 'What will we change?'), { w: 170, color: G, id: 'r' }), T.line('p', 'w1'), T.line('w1', 'w2'), T.line('w2', 'w3'), T.line('w3', 'w4'), T.line('w4', 'w5'), T.line('w5', 'r')]);
add('concept-map', 'Concept map', 'Brainstorming', 'Connect ideas and label how they relate.', () => [
  T.note(300, 40, nt('Big idea'), { w: 170, color: P, id: 'a' }), T.note(60, 230, nt('Concept'), { w: 150, color: Y, id: 'b' }), T.note(300, 260, nt('Concept'), { w: 150, color: B, id: 'c' }), T.note(540, 230, nt('Concept'), { w: 150, color: G, id: 'd' }),
  T.line('a', 'b'), T.line('a', 'c'), T.line('a', 'd'), T.line('b', 'c', { dashed: true }), T.line('c', 'd', { dashed: true })]);
add('inspiration-library', 'Inspiration library', 'Brainstorming', 'A shelf of themed boards to collect references.', () => [
  T.board(60, 60, 'Colour', '🎨', '#f7768e'), T.board(200, 60, 'Type', '🔤', '#7aa2f7'), T.board(340, 60, 'Layout', '📐', '#9ece6a'), T.board(480, 60, 'Photos', '📷', '#e0af68'), T.board(620, 60, 'Words', '✍️', '#bb9af7'),
  T.note(60, 200, nt('How to use', 'Drop anything that catches your eye into the right board.'), { w: 320, color: Y })]);

// ---- Writing
add('novel-outline', 'Novel outline', 'Writing', 'Three acts, a cast and a world.', () => [
  ...columns(['Act I · Setup', 'Act II · Confrontation', 'Act III · Resolution'], [stackNotes(['Opening image', 'Inciting incident'], Y), stackNotes(['Midpoint', 'All is lost'], B), stackNotes(['Climax', 'Closing image'], G)]),
  T.board(900, 60, 'Characters', '👥', '#bb9af7'), T.board(1020, 60, 'World', '🗺️', '#7aa2f7'), T.board(900, 190, 'Research', '📚', '#e0af68')]);
add('character-profile', 'Character profile', 'Writing', 'Facts, wants and fears in one place.', () => [
  T.image(60, 60, 200, 1.1), T.table(290, 60, [['Name', ''], ['Age', ''], ['Occupation', ''], ['Home', '']], { w: 320 }),
  T.note(290, 220, nt('Wants', 'What drives them?'), { w: 150, color: G }), T.note(460, 220, nt('Fears', 'What do they avoid?'), { w: 150, color: R }), T.note(60, 330, nt('Arc', 'Who are they at the start, and at the end?'), { w: 550, color: Y })]);
add('story-beats', 'Story beats', 'Writing', 'Plot points in four columns.', () => columns(['Setup', 'Conflict', 'Climax', 'Resolution'], [stackNotes(['Who and where']), stackNotes(['What goes wrong']), stackNotes(['The turn']), stackNotes(['How it ends'])]));

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
  T.table(60, 60, [['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'], ['Week 1', '', '', '', '', ''], ['Week 2', '', '', '', '', ''], ['Week 3', '', '', '', '', ''], ['Week 4', '', '', '', '', '']], { w: 640 }), T.col(740, 60, 'Ideas', stackNotes(['Post idea'], Y), { w: 240 })]);

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

export const BUILTIN_TEMPLATES = L;
