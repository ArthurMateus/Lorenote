// Boards tree: every board you have, nested as deep as you made them. Click to open, chevron to expand.
import { icon } from './icons.js';
import { isContainer, boardName } from './model.js';
import { t } from './i18n.js';

export function setupTree(view, store) {
  const drawer = document.querySelector('#tree-drawer'), list = document.querySelector('#tree-list');
  const KEY = 'corkboard.treeOpen'; let open = new Set(); try { open = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { /* ignore */ }
  const FAV = 'lorenote.favorites'; let favs = []; try { favs = JSON.parse(localStorage.getItem(FAV) || '[]'); } catch { /* ignore */ }
  const saveFavs = () => { try { localStorage.setItem(FAV, JSON.stringify(favs)); } catch { /* ignore */ } };
  const toggleFav = (id) => { favs = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]; saveFavs(); render(); view.onFavChange?.(); };
  const isFav = (id) => favs.includes(id);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify([...open])); } catch { /* ignore */ } };

  /** boards whose nearest board ancestor is `boardId` (looking through columns and lists) */
  function childBoards(boardId) {
    const out = [], stack = [boardId];
    while (stack.length) for (const c of store.children(stack.pop())) { if (c.type === 'board') out.push(c); else if (isContainer(c.type)) stack.push(c.id); }
    return out.sort((a, b) => (a.content.title || '').localeCompare(b.content.title || '', undefined, { sensitivity: 'base' }));
  }
  const cardCount = (id) => store.descendants(id).filter((e) => e.type !== 'line' && e.type !== 'task').length;

  function row(board, depth, currentPath) {
    const kids = childBoards(board.id); const isOpen = open.has(board.id);
    const el = document.createElement('div'); el.className = 'tn' + (board.id === view.boardId ? ' on' : ''); el.style.paddingLeft = 4 + depth * 16 + 'px'; el.setAttribute('role', 'treeitem');
    const tw = document.createElement('button'); tw.type = 'button'; tw.className = 'tw' + (kids.length ? (isOpen ? ' open' : '') : ' none'); tw.innerHTML = icon('chevron'); tw.setAttribute('aria-label', isOpen ? t('tree.collapse') : t('tree.expand'));
    tw.onclick = (e) => { e.stopPropagation(); if (open.has(board.id)) open.delete(board.id); else open.add(board.id); persist(); render(); };
    const ti = document.createElement('span'); ti.className = 'ti'; ti.textContent = board.id === store.rootId ? '🏠' : (board.content.icon || '📁');
    const tt = document.createElement('span'); tt.className = 'tt'; tt.textContent = boardName(board);
    const tc = document.createElement('span'); tc.className = 'tc'; tc.textContent = cardCount(board.id) || '';
    const star = document.createElement('button'); star.type = 'button'; star.className = 'tstar' + (isFav(board.id) ? ' on' : ''); star.textContent = isFav(board.id) ? '★' : '☆'; star.title = t('side.fav'); star.setAttribute('aria-label', t('side.fav')); star.onclick = (e) => { e.stopPropagation(); toggleFav(board.id); };
    el.append(tw, ti, tt, tc, star); el.onclick = () => { view.onOpen?.(board.id); if (matchMedia('(max-width: 760px)').matches) hide(); };
    const frag = [el];
    if (kids.length && isOpen) for (const k of kids) frag.push(...row(k, depth + 1, currentPath));
    return frag;
  }
  function render() {
    if (drawer.hidden) return;
    const path = new Set(store.path(view.boardId).filter((e) => e.type === 'board').map((e) => e.id));
    for (const id of path) if (id !== view.boardId) open.add(id);      // keep the way to the current board visible
    open.add(store.rootId); const root = store.get(store.rootId);
    favs = favs.filter((id) => store.get(id) && !store.get(id).trashed);
    const head = (txt) => { const d = document.createElement('div'); d.className = 'tsec'; d.textContent = txt; return d; };
    const search = document.createElement('button'); search.type = 'button'; search.className = 'tsearch'; search.innerHTML = icon('search') + '<span></span><kbd>Ctrl K</kbd>'; search.querySelector('span').textContent = t('side.search'); search.onclick = () => document.querySelector('#btn-search').click();
    const favRows = favs.map((id) => store.get(id)).filter(Boolean).map((b) => { const el = row(b, 0, path)[0]; return el; });
    list.replaceChildren(search, ...(favRows.length ? [head(t('side.favs')), ...favRows] : []), head(t('side.boards')), ...row(root, 0, path));
    const cur = list.querySelector('.tn.on'); cur?.scrollIntoView?.({ block: 'nearest' });
  }
  const WIDE = matchMedia('(min-width: 1100px)'); const PIN = 'lorenote.sidebar';
  const pinned = () => { try { return localStorage.getItem(PIN) !== '0'; } catch { return true; } };
  const dock = () => document.body.classList.toggle('side-docked', !drawer.hidden && WIDE.matches);
  function show() { drawer.hidden = false; open.add(store.rootId); try { localStorage.setItem(PIN, '1'); } catch { /* ignore */ } dock(); render(); }
  function hide() { drawer.hidden = true; try { localStorage.setItem(PIN, '0'); } catch { /* ignore */ } dock(); }
  WIDE.addEventListener('change', dock);
  if (WIDE.matches && pinned()) setTimeout(show, 0);
  const toggle = () => (drawer.hidden ? show() : hide());
  document.querySelector('#btn-tree').onclick = toggle; document.querySelector('#tree-close').onclick = hide;
  store.subscribe((i) => { if (!drawer.hidden && (i.patches.length || i.reset)) render(); }); window.addEventListener('hashchange', () => setTimeout(render, 0));
  return { drawerHidden: () => drawer.hidden, show, hide, toggle, render, childBoards, isFav, toggleFav };
}
