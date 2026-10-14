import { Store } from './store.js';
import { View } from './view.js';
import { setupInteractions } from './interact.js';
import { elementText, TYPE_LABEL } from './model.js';
import { setupTemplates } from './template-ui.js';
import { FileService, dataUrlToBlob, MAX_CLOUD_BYTES } from './files.js';

export async function startApp({ backend = null, user = null } = {}) {
  const $ = (s) => document.querySelector(s);
  const store = new Store();
  await store.load(user ? user.id : 'local');
  if (backend) {
    try { await store.connect(backend); } catch (err) { console.error(err); store.setSync('error'); }
  }
  const localSnap = user ? await Store.peek('local') : null;
  const localCount = localSnap ? Object.keys(localSnap.elements || {}).length - 1 : 0;   // minus its root board

  const dom = {
    viewport: $('#viewport'), world: $('#world'), canvas: $('#canvas'), svg: $('#lines'), dragLayer: $('#drag-layer'),
    marquee: $('#marquee'), contextBar: $('#context-bar'), empty: $('#empty'), toolbar: $('#toolbar'),
  };
  const view = new View(store, dom);

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, undo, label = 'Undo', ms = 4500) {
    const t = $('#toast'); t.replaceChildren(msg);
    if (undo) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { undo(); t.hidden = true; }; t.append(' ', b); }
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  view.files = backend ? new FileService(backend) : null;      // cloud storage for images/files (signed in only)
  view.onNotify = toast;
  const inter = setupInteractions(view, toast);

  // ---------------------------------------------------------------- link previews (server-side, via the link-preview Edge Function)
  view.onLinkPreview = async (id, url, force = false) => {
    if (!backend) { if (force) toast('Sign in to fetch link previews'); return; }
    try {
      const p = await backend.linkPreview(url);
      const cur = store.live(id); if (!cur || cur.content.url !== url) return;
      if (p.error && !p.title) { if (force) toast('No preview available: ' + p.error); return; }
      const c = { ...cur.content, description: p.description || '', image: p.image || '', siteName: p.siteName || '' };
      if (p.title && !cur.content.titleEdited) c.title = p.title;
      store.silentCommit([{ id, after: { ...cur, content: c } }]);
      if (force) toast('Preview updated');
    } catch (err) { if (force) toast('Could not fetch a preview: ' + (err.message || err)); }
  };

  // ---------------------------------------------------------------- files: move inline data to cloud storage, tidy orphans
  let migrating = false;
  async function migrateInlineFiles() {
    if (!view.files || migrating || !navigator.onLine) return; migrating = true;
    try {
      const todo = Object.values(store.elements).filter((e) => (e.type === 'image' || e.type === 'file') && !e.content.path && typeof e.content.src === 'string' && e.content.src.startsWith('data:'));
      if (!todo.length) return;
      toast(`Moving ${todo.length} file${todo.length > 1 ? 's' : ''} to cloud storage…`, null, '', 8000);
      let ok = 0;
      for (const e of todo) {
        try {
          const blob = await dataUrlToBlob(e.content.src); if (blob.size > MAX_CLOUD_BYTES) continue;
          const path = await view.files.upload(e.id, blob, e.content.name || 'file');
          const cur = store.get(e.id); if (!cur || cur.content.src !== e.content.src) continue;
          const { src, ...rest } = cur.content;
          store.silentCommit([{ id: e.id, after: { ...cur, content: { ...rest, path, size: blob.size, mime: blob.type || rest.mime } } }]); ok++;
        } catch (err) { console.warn('could not move file', e.id, err); }
      }
      if (ok) toast(`Moved ${ok} file${ok > 1 ? 's' : ''} to cloud storage`);
    } finally { migrating = false; }
  }
  async function cleanOrphanFiles() {
    if (!backend || !user || store.pending.size || store.syncState !== 'synced') return;
    try {
      const files = await backend.listFiles(); if (!files.length) return;
      const used = new Set(); for (const e of Object.values(store.elements)) if (e.content?.path) used.add(e.content.path);
      const tpls = await backend.listTemplates(); for (const t of tpls) for (const e of Object.values(t.elements || {})) if (e.content?.path) used.add(e.content.path);
      const cutoff = Date.now() - 24 * 3600 * 1000;      // keep anything newer than a day (undo window, slow syncs)
      const orphans = files.filter((f) => !used.has(f.path) && new Date(f.created).getTime() < cutoff).map((f) => f.path);
      if (orphans.length) { await backend.removeFiles(orphans); orphans.forEach((p) => view.files.forget(p)); }
    } catch (err) { console.warn('file cleanup skipped', err); }
  }
  if (view.files) { window.addEventListener('online', migrateInlineFiles); setTimeout(migrateInlineFiles, 2500); setTimeout(cleanOrphanFiles, 25000); }


  // ---------------------------------------------------------------- routing
  const idFromHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')) || store.rootId;
  view.onOpen = (id) => { location.hash = '#/' + id; };
  addEventListener('hashchange', () => { view.setBoard(idFromHash()); renderCrumbs(); });

  function renderCrumbs() {
    const nav = $('#crumbs'); nav.replaceChildren();
    const boards = store.path(view.boardId).filter((e) => e.type === 'board');
    boards.forEach((b, i) => {
      if (i) nav.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '/' }));
      const a = document.createElement(i === boards.length - 1 ? 'strong' : 'button'); a.textContent = b.content.title || 'Untitled';
      if (i < boards.length - 1) a.onclick = () => view.onOpen(b.id);
      nav.append(a);
    });
    document.title = `${boards.at(-1)?.content.title || 'Corkboard'} · Corkboard`;
  }

  // ---------------------------------------------------------------- header
  function syncChrome() {
    $('#btn-undo').disabled = !store.undoStack.length; $('#btn-redo').disabled = !store.redoStack.length;
    $('#zoom-label').textContent = Math.round(view.scale * 100) + '%';
    renderCrumbs();
  }
  store.subscribe(syncChrome); view.onZoom = syncChrome;
  const syncLabels = { local: 'Local only', synced: 'Saved', syncing: 'Saving…', offline: 'Offline · saved on this device', error: 'Sync problem · retrying' };
  const syncEl = $('#sync');
  const paintSync = () => { syncEl.hidden = false; syncEl.dataset.state = store.syncState; syncEl.textContent = backend ? syncLabels[store.syncState] : syncLabels.local; syncEl.title = backend ? 'Cloud sync status' : 'Not signed in: data stays in this browser'; };
  store.subscribe((i) => { if (i.sync || i.reset) paintSync(); }); paintSync();
  $('#btn-undo').onclick = () => store.undo(); $('#btn-redo').onclick = () => store.redo();
  $('#zoom-in').onclick = () => view.zoomBy(1.2); $('#zoom-out').onclick = () => view.zoomBy(1 / 1.2); $('#zoom-label').onclick = () => view.zoomReset();
  $('#home').onclick = () => view.onOpen(store.rootId);

  function popMenu(el, anchor, items) {
    el.replaceChildren(...items.map(([label, fn]) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { el.hidden = true; fn(); }; return b; }));
    const r = anchor.getBoundingClientRect(); el.style.top = r.bottom + 6 + 'px'; el.style.right = Math.max(8, innerWidth - r.right) + 'px'; el.hidden = false;
  }
  document.addEventListener('pointerdown', (e) => { for (const m of document.querySelectorAll('.popmenu')) if (!m.hidden && !m.contains(e.target) && !e.target.closest('#btn-menu,#btn-templates')) m.hidden = true; }, true);

  $('#btn-menu').onclick = () => popMenu($('#menu'), $('#btn-menu'), [
    ...(user ? [[`Signed in as ${user.email}`, () => {}], ['Sign out', async () => { await backend.signOut(); localStorage.removeItem('corkboard.guest'); location.reload(); }]] : (window.corkboardAuth ? [['Sign in / create account', () => { localStorage.removeItem('corkboard.guest'); location.reload(); }]] : [])),
    ...(user && localCount > 0 ? [[`Import ${localCount} items from this device`, importLocal]] : []),
    ['Trash', () => $('#btn-trash').click()],
    ['Templates…', () => tpl.open()],
    ['Save this board as template…', () => tpl.saveCurrent()],
    ...installItem(),
    [`Theme: ${store.prefs.theme}`, () => { const o = ['system', 'light', 'dark']; store.setPref('theme', o[(o.indexOf(store.prefs.theme) + 1) % 3]); }],
    [`Grid: ${store.prefs.grid ? 'on' : 'off'}`, () => store.setPref('grid', !store.prefs.grid)],
    [`Snap to grid: ${store.prefs.snap ? 'on' : 'off'}`, () => store.setPref('snap', !store.prefs.snap)],
    ['Export all data (JSON)', exportJson], ['Import data (JSON)…', importJson], ['Shortcuts & help', () => $('#dlg-help').showModal()],
  ]);

  const tpl = setupTemplates({ store, view, backend, user, toast });
  $('#btn-templates').onclick = () => tpl.open();
  $('#empty-templates').onclick = () => tpl.open();

  function exportJson() {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' })), download: `corkboard-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importJson() {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
    i.onchange = async () => {
      try { if (!confirm('Importing replaces everything currently stored in this browser. Continue?')) return; store.importJSON(await i.files[0].text()); location.hash = '#/' + store.rootId; toast('Import complete'); }
      catch (e) { toast('Import failed: ' + e.message); }
    };
    i.click();
  }

  // ---------------------------------------------------------------- install / update / share target
  window.addEventListener('corkboard:updated', () => toast('A new version of Corkboard is ready.', () => location.reload(), 'Reload', 20000));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  function installItem() {
    if (standalone) return [];
    if (window.corkboardInstall) return [['Install app', async () => { const p = window.corkboardInstall; p.prompt(); await p.userChoice; window.corkboardInstall = null; }]];
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return [['Install: Share → Add to Home Screen', () => toast('In Safari tap the Share button, then “Add to Home Screen”.', null, '', 8000)]];
    return [];
  }
  // opened from the OS share sheet (?title=&text=&url=) or the “New note” shortcut (?new=note)
  {
    const q = new URLSearchParams(location.search); const url = q.get('url') || (q.get('text') || '').match(/https?:\/\/\S+/)?.[0]; const text = (q.get('text') || '').trim(); const title = q.get('title');
    if (url || text || q.get('new')) {
      history.replaceState(null, '', location.pathname + location.hash);
      const at = { parentId: store.rootId, section: 'canvas' };
      setTimeout(() => {
        if (url) { const el = inter.create('link', at, { url, title: title || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] }); view.onLinkPreview(el.id, url); }
        else if (text) inter.create('note', at, { html: text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>') });
        else inter.create('note', at);
        toast('Added to Home');
      }, 400);
    }
  }

  // ---------------------------------------------------------------- import boards made before signing in
  async function importLocal() {
    const snap = await Store.peek('local'); if (!snap || !snap.elements) return toast('No local boards found on this device');
    const root = snap.elements[snap.rootId]; const rest = Object.values(snap.elements).filter((e) => e.id !== snap.rootId);
    if (!rest.length) return toast('No local boards found on this device');
    const ids = new Set(rest.map((e) => e.id)); let z = store.maxZ(store.rootId);
    const ch = [{ id: root.id, after: { ...root, parentId: store.rootId, section: 'canvas', x: 80, y: 80, z: ++z, w: 96, content: { title: 'Imported from this device', icon: '📥', tint: '#7aa2f7' } } }];
    for (const e of rest) if (!store.get(e.id)) ch.push({ id: e.id, after: e });
    store.commit(ch, { label: 'Import local boards' });
    localStorage.setItem('corkboard.imported:' + user.id, '1');
    toast(`Imported ${rest.length} items into a board called “Imported from this device”`, () => store.undo());
  }
  if (user && localCount > 0 && !localStorage.getItem('corkboard.imported:' + user.id)) {
    localStorage.setItem('corkboard.imported:' + user.id, 'asked');
    setTimeout(() => toast(`You have ${localCount} items saved on this device from before you signed in.`, importLocal, 'Import them', 15000), 800);
  }

  // ---------------------------------------------------------------- trash
  const trashDlg = $('#dlg-trash');
  function trashItems() { return Object.values(store.elements).filter((e) => e.trashed && !store.get(e.parentId)?.trashed).sort((a, b) => b.trashedAt - a.trashedAt); }
  function renderTrash() {
    const list = $('#trash-list'); list.replaceChildren();
    const items = trashItems();
    if (!items.length) list.textContent = 'Trash is empty.';
    for (const e of items) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<span class="tag"></span><span class="txt"></span>';
      row.querySelector('.tag').textContent = TYPE_LABEL[e.type]; row.querySelector('.txt').textContent = elementText(e).slice(0, 80) || '(empty)';
      const restore = Object.assign(document.createElement('button'), { className: 'tb', textContent: 'Restore', type: 'button' });
      restore.onclick = () => {
        const parent = store.live(e.parentId); const after = { ...e, trashed: false, trashedAt: undefined };
        if (!parent) Object.assign(after, { parentId: view.boardId, section: 'canvas', x: 80, y: 80, z: store.maxZ(view.boardId) + 1, w: e.w || 240 });
        store.commit([{ id: e.id, after }], { label: 'Restore' }); renderTrash();
      };
      const del = Object.assign(document.createElement('button'), { className: 'tb danger', textContent: 'Delete forever', type: 'button' });
      del.onclick = () => { store.commit([e, ...store.descendants(e.id, true)].map((x) => ({ id: x.id, after: null })), { label: 'Delete forever' }); renderTrash(); };
      row.append(restore, del); list.append(row);
    }
  }
  $('#btn-trash').onclick = () => { renderTrash(); trashDlg.showModal(); };
  $('#trash-empty').onclick = () => {
    const items = trashItems(); if (!items.length || !confirm(`Permanently delete ${items.length} item(s)?`)) return;
    store.commit(items.flatMap((e) => [e, ...store.descendants(e.id, true)]).map((x) => ({ id: x.id, after: null })), { label: 'Empty trash' }); renderTrash();
  };

  // ---------------------------------------------------------------- search
  const searchDlg = $('#dlg-search'), sIn = $('#search-input');
  function boardOf(e) { for (let p = store.get(e.parentId); p; p = store.get(p.parentId)) if (p.type === 'board') return p; return store.get(store.rootId); }
  function runSearch() {
    const q = sIn.value.trim().toLowerCase(); const list = $('#search-list'); list.replaceChildren();
    if (!q) return;
    const hits = Object.values(store.elements).filter((e) => !e.trashed && e.id !== store.rootId && e.type !== 'line' && elementText(e).toLowerCase().includes(q)).slice(0, 60);
    if (!hits.length) list.textContent = 'No matches.';
    for (const e of hits) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'row';
      row.innerHTML = '<span class="tag"></span><span class="txt"></span><span class="where"></span>';
      row.querySelector('.tag').textContent = TYPE_LABEL[e.type]; row.querySelector('.txt').textContent = elementText(e).replace(/\s+/g, ' ').slice(0, 90);
      row.querySelector('.where').textContent = boardOf(e).content.title;
      row.onclick = () => { searchDlg.close(); reveal(e); };
      list.append(row);
    }
  }
  sIn.addEventListener('input', runSearch);
  $('#btn-search').onclick = () => { searchDlg.showModal(); sIn.select(); };
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#btn-search').click(); } });
  function reveal(e) {
    const target = e.type === 'board' && false ? e : boardOf(e);
    const go = () => { view.setBoard(target.id); renderCrumbs(); requestAnimationFrame(() => { view.render(); view.select([e.id]); const r = view.worldRect(e.id); if (r) { const vp = dom.viewport.getBoundingClientRect(); view.tx = vp.width / 2 - (r.x + r.w / 2) * view.scale; view.ty = vp.height / 2 - (r.y + r.h / 2) * view.scale; view.applyTransform(); } }); };
    if (target.id !== view.boardId) { history.replaceState(null, '', '#/' + target.id); go(); } else go();
  }

  // ---------------------------------------------------------------- start
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  view.onSelection = () => {};
  view.applyTransform();
  view.setBoard(idFromHash());
  syncChrome();
  view.render();
  window.corkboard = { store, view, inter, files: { migrate: migrateInlineFiles, cleanOrphans: cleanOrphanFiles } }; // handy for debugging in devtools

}
