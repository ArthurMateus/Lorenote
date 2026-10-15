import { Store } from './store.js';
import { View } from './view.js';
import { setupInteractions } from './interact.js';
import { elementText, TYPE_LABEL, boardName, normalizeUrl } from './model.js';
import { setupTemplates } from './template-ui.js';
import { FileService, dataUrlToBlob, MAX_CLOUD_BYTES } from './files.js';
import { hydrateIcons } from './icons.js';
import { applyTheme, bindThemeToggles } from './theme.js';
import { setupMinimap } from './minimap.js';
import { setupPresent } from './present.js';
import { setupTree } from './tree.js';
import { t, getLang, setLang, langName, LANGS } from './i18n.js';
import { openDatabase } from './database.js';
import { setupSettings } from './settings.js';
import { setupWriter } from './writer.js';

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
  hydrateIcons(); applyTheme(store.prefs.theme); bindThemeToggles(() => store.prefs.theme, (v) => store.setPref('theme', v));

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, undo, label = t('toast.undo'), ms = 4500) {
    const t = $('#toast'); t.replaceChildren(msg);
    if (undo) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { undo(); t.hidden = true; }; t.append(' ', b); }
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  view.files = backend ? new FileService(backend) : null;      // cloud storage for images/files (signed in only)
  view.onNotify = toast;
  const inter = setupInteractions(view, toast);
  view.onOpenDatabase = (id) => openDatabase(store, id);

  // ---------------------------------------------------------------- link previews (server-side, via the link-preview Edge Function)
  view.onLinkPreview = async (id, url, force = false) => {
    if (!backend) { if (force) toast(t('toast.previewSignIn')); return; }
    try {
      const p = await backend.linkPreview(url);
      const cur = store.live(id); if (!cur || cur.content.url !== url) return;
      if (p.error && !p.title) { if (force) toast(t('toast.previewNone', { err: p.error })); return; }
      const c = { ...cur.content, description: p.description || '', image: p.image || '', siteName: p.siteName || '' };
      if (p.title && !cur.content.titleEdited) c.title = p.title;
      store.silentCommit([{ id, after: { ...cur, content: c } }]);
      if (force) toast(t('toast.previewUpdated'));
    } catch (err) { if (force) toast(t('toast.previewFail', { err: err.message || err })); }
  };

  // ---------------------------------------------------------------- files: move inline data to cloud storage, tidy orphans
  let migrating = false;
  async function migrateInlineFiles() {
    if (!view.files || migrating || !navigator.onLine) return; migrating = true;
    try {
      const todo = Object.values(store.elements).filter((e) => (e.type === 'image' || e.type === 'file') && !e.content.path && typeof e.content.src === 'string' && e.content.src.startsWith('data:'));
      if (!todo.length) return;
      toast(t('toast.moving', { n: todo.length }), null, '', 8000);
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
      if (ok) toast(t('toast.moved', { n: ok }));
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
  const idFromHash = () => {
    let id = ''; try { id = decodeURIComponent(location.hash.replace(/^#\/?/, '')); } catch { /* malformed escape: fall back to Home */ }
    const e = id && store.get(id); return e && e.type === 'board' && store.reachable(e) ? id : store.rootId;
  };
  view.onOpen = (id) => { location.hash = '#/' + id; };
  addEventListener('hashchange', () => { view.setBoard(idFromHash()); renderCrumbs(); });

  function renderCrumbs() {
    const nav = $('#crumbs'); nav.replaceChildren();
    const boards = store.path(view.boardId).filter((e) => e.type === 'board');
    boards.forEach((b, i) => {
      if (i) nav.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '/' }));
      const a = document.createElement(i === boards.length - 1 ? 'strong' : 'button'); a.textContent = boardName(b);
      if (i < boards.length - 1) a.onclick = () => view.onOpen(b.id);
      nav.append(a);
    });
    document.title = `${boards.at(-1) ? boardName(boards.at(-1)) : 'Lorenote'} · Lorenote`;
  }

  // ---------------------------------------------------------------- header
  function syncChrome() {
    $('#btn-undo').disabled = !store.undoStack.length; $('#btn-redo').disabled = !store.redoStack.length;
    $('#zoom-label').textContent = Math.round(view.scale * 100) + '%';
    renderCrumbs();
  }
  store.subscribe(syncChrome); view.onZoom = syncChrome;
  const syncEl = $('#sync');
  const paintSync = () => { syncEl.hidden = false; syncEl.dataset.state = store.syncState; syncEl.textContent = t('sync.' + (backend ? store.syncState : 'local')); syncEl.title = backend ? t('sync.tipCloud') : t('sync.tipLocal'); };
  store.subscribe((i) => { if (i.sync || i.reset) paintSync(); }); paintSync();
  $('#btn-undo').onclick = () => store.undo(); $('#btn-redo').onclick = () => store.redo();
  $('#zoom-in').onclick = () => view.zoomBy(1.2); $('#zoom-out').onclick = () => view.zoomBy(1 / 1.2); $('#zoom-label').onclick = () => view.zoomReset();
  $('#home').onclick = () => view.onOpen(store.rootId);

  function popMenu(el, anchor, items) {
    el.replaceChildren(...items.map(([label, fn]) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { el.hidden = true; fn(); }; return b; }));
    const r = anchor.getBoundingClientRect(); el.style.top = r.bottom + 6 + 'px'; el.style.right = Math.max(8, innerWidth - r.right) + 'px'; el.hidden = false;
  }
  document.addEventListener('pointerdown', (e) => { for (const m of document.querySelectorAll('.popmenu')) if (!m.hidden && !m.contains(e.target) && !e.target.closest('#btn-menu,#btn-templates')) m.hidden = true; }, true);

  const onOff = (on) => t(on ? 'common.on' : 'common.off');
  const langMenu = () => popMenu($('#menu'), $('#btn-menu'), LANGS.map((l) => [(l.code === getLang() ? '✓ ' : '\u2003') + l.name, () => setLang(l.code)]));
  $('#btn-menu').onclick = () => popMenu($('#menu'), $('#btn-menu'), [
    [t('menu.settings'), () => settings.open()],
    [t('menu.templates'), () => tpl.open()],
    [t('menu.saveTemplate'), () => tpl.saveCurrent()],
    [t('menu.trash'), () => $('#btn-trash').click()],
    [t('menu.present'), () => present.start()],
    [t('menu.help'), () => $('#dlg-help').showModal()],
    ...(user ? [[t('menu.signOut'), signOut]] : (window.corkboardAuth ? [[t('menu.signIn'), signIn]] : [])),
  ]);
  const signOut = async () => { await backend.signOut(); localStorage.removeItem('corkboard.guest'); location.reload(); };
  const signIn = () => { localStorage.removeItem('corkboard.guest'); location.reload(); };

  const tpl = setupTemplates({ store, view, backend, user, toast });
  const tree = setupTree(view, store);
  const mm = setupMinimap(view, store);
  const present = setupPresent(view, store, toast);
  const writer = setupWriter({ store, view, toast, openSettings: (s) => settings.open(s) });
  view.onFocusNote = (id) => writer.focus(id); view.onCopyText = (id) => writer.copyText(id); view.onExportMd = (id) => writer.downloadMd(id);
  $('#btn-capture').onclick = () => writer.openCapture();
  const settings = setupSettings({ writer, view,  store, user, tpl, tree, mm, toast, exportJson, importJson, importLocal, localCount, installItem, signOut, signIn, canSignIn: !!window.corkboardAuth });
  view.onPresent = () => present.start();
  view.onPresenting = (on) => { if (on) tree.hide(); };
  $('#btn-present').onclick = () => present.start();
  $('#btn-fit').onclick = () => view.fitAll({ animate: true });
  $('#btn-templates').onclick = () => tpl.open();
  $('#empty-templates').onclick = () => tpl.open();

  function exportJson() {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' })), download: `lorenote-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importJson() {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
    i.onchange = async () => {
      try { if (!confirm(t('toast.importConfirm'))) return; store.importJSON(await i.files[0].text()); location.hash = '#/' + store.rootId; toast(t('toast.importDone')); }
      catch (e) { toast(t('toast.importFail', { err: e.message })); }
    };
    i.click();
  }

  // ---------------------------------------------------------------- install / update / share target
  window.addEventListener('corkboard:updated', () => toast(t('toast.updateReady'), () => location.reload(), t('toast.reload'), 20000));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  function installItem() {
    if (standalone) return [];
    if (window.corkboardInstall) return [[t('menu.install'), async () => { const p = window.corkboardInstall; p.prompt(); await p.userChoice; window.corkboardInstall = null; }]];
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return [[t('menu.installIos'), () => toast(t('toast.iosInstall'), null, '', 8000)]];
    return [];
  }
  // opened from the OS share sheet (?title=&text=&url=) or the “New note” shortcut (?new=note)
  {
    const q = new URLSearchParams(location.search); const url = normalizeUrl(q.get('url') || (q.get('text') || '').match(/https?:\/\/\S+/)?.[0] || ''); const text = (q.get('text') || '').trim().slice(0, 5000); const title = (q.get('title') || '').slice(0, 200);
    if (url || text || q.get('new')) {
      history.replaceState(null, '', location.pathname + location.hash);
      const at = { parentId: store.rootId, section: 'canvas' };
      setTimeout(() => {
        if (url) { const el = inter.create('link', at, { url, title: title || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] }); view.onLinkPreview(el.id, url); }
        else if (text) inter.create('note', at, { html: text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>') });
        else inter.create('note', at);
        toast(t('toast.addedHome'));
      }, 400);
    }
  }

  // ---------------------------------------------------------------- import boards made before signing in
  async function importLocal() {
    const snap = await Store.peek('local'); if (!snap || !snap.elements) return toast(t('toast.noLocal'));
    const root = snap.elements[snap.rootId]; const rest = Object.values(snap.elements).filter((e) => e.id !== snap.rootId);
    if (!rest.length) return toast(t('toast.noLocal'));
    const ids = new Set(rest.map((e) => e.id)); let z = store.maxZ(store.rootId);
    const ch = [{ id: root.id, after: { ...root, parentId: store.rootId, section: 'canvas', x: 80, y: 80, z: ++z, w: 96, content: { title: t('toast.importedTitle'), icon: '📥', tint: '#7aa2f7' } } }];
    for (const e of rest) if (!store.get(e.id)) ch.push({ id: e.id, after: e });
    store.commit(ch, { label: 'Import local boards' });
    localStorage.setItem('corkboard.imported:' + user.id, '1');
    toast(t('toast.imported', { n: rest.length, title: t('toast.importedTitle') }), () => store.undo());
  }
  if (user && localCount > 0 && !localStorage.getItem('corkboard.imported:' + user.id)) {
    localStorage.setItem('corkboard.imported:' + user.id, 'asked');
    setTimeout(() => toast(t('toast.localFound', { n: localCount }), importLocal, t('toast.importThem'), 15000), 800);
  }

  // ---------------------------------------------------------------- trash
  const trashDlg = $('#dlg-trash');
  function trashItems() { return Object.values(store.elements).filter((e) => e.trashed && !store.get(e.parentId)?.trashed).sort((a, b) => b.trashedAt - a.trashedAt); }
  function renderTrash() {
    const list = $('#trash-list'); list.replaceChildren();
    const items = trashItems();
    if (!items.length) list.textContent = t('trash.isEmpty');
    for (const e of items) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<span class="tag"></span><span class="txt"></span>';
      row.querySelector('.tag').textContent = TYPE_LABEL[e.type]; row.querySelector('.txt').textContent = elementText(e).slice(0, 80) || t('trash.emptyItem');
      const restore = Object.assign(document.createElement('button'), { className: 'tb', textContent: t('trash.restore'), type: 'button' });
      restore.onclick = () => {
        const parent = store.live(e.parentId); const after = { ...e, trashed: false, trashedAt: undefined };
        if (!parent) Object.assign(after, { parentId: view.boardId, section: 'canvas', x: 80, y: 80, z: store.maxZ(view.boardId) + 1, w: e.w || 240 });
        store.commit([{ id: e.id, after }], { label: 'Restore' }); renderTrash();
      };
      const del = Object.assign(document.createElement('button'), { className: 'tb danger', textContent: t('trash.deleteForever'), type: 'button' });
      del.onclick = () => { store.commit([e, ...store.descendants(e.id, true)].map((x) => ({ id: x.id, after: null })), { label: 'Delete forever' }); renderTrash(); };
      row.append(restore, del); list.append(row);
    }
  }
  $('#btn-trash').onclick = () => { renderTrash(); trashDlg.showModal(); };
  $('#trash-empty').onclick = () => {
    const items = trashItems(); if (!items.length || !confirm(t('trash.confirmEmpty', { n: items.length }))) return;
    store.commit(items.flatMap((e) => [e, ...store.descendants(e.id, true)]).map((x) => ({ id: x.id, after: null })), { label: 'Empty trash' }); renderTrash();
  };

  // ---------------------------------------------------------------- search
  const searchDlg = $('#dlg-search'), sIn = $('#search-input');
  function boardOf(e) { for (let p = store.get(e.parentId); p; p = store.get(p.parentId)) if (p.type === 'board') return p; return store.get(store.rootId); }
  function runSearch() {
    const q = sIn.value.trim().toLowerCase(); const list = $('#search-list'); list.replaceChildren();
    const here = () => { const r = dom.viewport.getBoundingClientRect(); const p = view.toWorld(r.left + r.width / 2, r.top + r.height / 2); return { parentId: view.boardId, section: 'canvas', x: p.x - 110, y: p.y - 60 }; };
    const make = (type) => () => { const el = inter.create(type, here()); view.render(); if (el) view.select([el.id]); };
    const COMMANDS = [
      [t('cmd.note'), make('note')], [t('cmd.todo'), make('todo')], [t('cmd.capture'), () => writer.openCapture()], [t('cmd.focus'), () => { const sel = [...view.selection].map((id) => store.live(id)).find((e) => e?.type === 'note'); writer.focus(sel?.id); }], [t('cmd.copyBoard'), () => writer.copyText(view.boardId)], [t('cmd.exportBoard'), () => writer.downloadMd(view.boardId)], [t('cmd.database'), make('database')], [t('cmd.table'), make('table')], [t('cmd.column'), make('column')], [t('cmd.board'), make('board')],
      [t('cmd.theme'), () => $('#btn-theme').click()], [t('cmd.present'), () => $('#btn-present').click()], [t('cmd.fit'), () => $('#btn-fit').click()],
      [t('cmd.templates'), () => $('#btn-templates').click()], [t('cmd.boards'), () => $('#btn-tree').click()], [t('cmd.trash'), () => $('#btn-trash').click()], [t('cmd.help'), () => $('#dlg-help').showModal()],
    ].filter(([name]) => !q || name.toLowerCase().includes(q));
    for (const [name, run] of COMMANDS.slice(0, q ? 5 : 20)) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'row cmd';
      row.innerHTML = '<span class="tag"></span><span class="txt"></span><span class="where"></span>'; row.querySelector('.tag').textContent = t('search.do'); row.querySelector('.where').textContent = t('search.cmd'); row.querySelector('.txt').textContent = name;
      row.onclick = () => { searchDlg.close(); run(); }; list.append(row);
    }
    if (!q) return;
    const hits = Object.values(store.elements).filter((e) => !e.trashed && e.id !== store.rootId && e.type !== 'line' && store.reachable(e) && elementText(e).toLowerCase().includes(q)).slice(0, 60);
    if (!hits.length && !COMMANDS.length) list.textContent = t('search.none');
    for (const e of hits) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'row';
      row.innerHTML = '<span class="tag"></span><span class="txt"></span><span class="where"></span>';
      row.querySelector('.tag').textContent = TYPE_LABEL[e.type]; row.querySelector('.txt').textContent = elementText(e).replace(/\s+/g, ' ').slice(0, 90);
      row.querySelector('.where').textContent = boardName(boardOf(e));
      row.onclick = () => { searchDlg.close(); if (e.type === 'board') { view.setBoard(e.id); renderCrumbs(); } else reveal(e); };
      list.append(row);
    }
  }
  sIn.addEventListener('input', runSearch);
  sIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('#search-list .row')?.click(); } });
  $('#btn-search').onclick = () => { searchDlg.showModal(); sIn.select(); runSearch(); };
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
  window.addEventListener('lang-change', () => {
    for (const rec of view.nodes.values()) rec.node.remove();                 // cards bake placeholders and labels in when built: rebuild them
    view.nodes.clear(); dom.contextBar.dataset.sig = '';
    view.render(); syncChrome(); paintSync(); tree.render();
    if (trashDlg.open) renderTrash();
    if (searchDlg.open) runSearch();
  });
  window.lorenote = window.corkboard = { store, view, inter, tree, present, mm, files: { migrate: migrateInlineFiles, cleanOrphans: cleanOrphanFiles } }; // handy for debugging in devtools

}
