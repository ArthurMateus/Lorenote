// Corkboard store: flat element map, patch-based commits, client-side undo/redo,
// IndexedDB persistence (per account), BroadcastChannel multi-tab sync and optional cloud sync.
//
// A patch is { id, before, after } where before/after are whole element snapshots (or null).
// Every mutation is a list of patches, so undo = apply the "before" side, redo = apply "after".

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 14);

const DB_NAME = 'corkboard';
const keyFor = (userKey) => (userKey === 'local' ? 'state-v1' : `state-v1:${userKey}`);

function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch { try { return JSON.parse(localStorage.getItem(key)); } catch { return undefined; } }
}
export async function idbSet(key, val) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ } }
}

export const newRoot = () => ({ id: uid(), type: 'board', parentId: null, section: 'canvas', x: 0, y: 0, z: 0, w: 0, content: { title: 'Home' }, created: Date.now(), modified: Date.now() });

export class Store {
  constructor() {
    this.elements = {};          // id -> element (immutable snapshots; replaced on change)
    this.rootId = null;
    this.prefs = { theme: 'system', grid: true, snap: false };
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.clientId = uid();
    this.saveTimer = null;
    this.userKey = 'local';
    this.pending = new Set();    // ids changed locally that the cloud has not confirmed yet
    this.backend = null;
    this.syncState = 'local';    // local | synced | syncing | offline | error
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('corkboard-sync') : null;
    if (this.channel) this.channel.onmessage = (e) => this.onRemote(e.data, 'tab');
  }

  /** peek at saved data for a user key without loading it into the store */
  static async peek(userKey) { return idbGet(keyFor(userKey)); }

  async load(userKey = 'local') {
    this.userKey = userKey;
    const saved = await idbGet(keyFor(userKey));
    if (saved && saved.elements && saved.rootId) {
      this.elements = saved.elements; this.rootId = saved.rootId;
      this.prefs = { ...this.prefs, ...(saved.prefs || {}) };
      this.pending = new Set(saved.pending || []);
    } else {
      const root = newRoot();
      this.elements = { [root.id]: root }; this.rootId = root.id; this.pending = new Set([root.id]);
      this.save();
    }
  }

  get(id) { return this.elements[id] || null; }
  live(id) { const e = this.elements[id]; return e && !e.trashed ? e : null; }

  /** non-trashed children of a container in one section, ordered */
  children(parentId, section) {
    const out = [];
    for (const e of Object.values(this.elements)) {
      if (e.parentId === parentId && !e.trashed && (!section || e.section === section)) out.push(e);
    }
    return section === 'stack' ? out.sort((a, b) => a.order - b.order) : out.sort((a, b) => a.z - b.z);
  }
  descendants(id, includeTrashed = false) {
    const out = []; const stack = [id];
    while (stack.length) {
      const p = stack.pop();
      for (const e of Object.values(this.elements)) {
        if (e.parentId === p && (includeTrashed || !e.trashed)) { out.push(e); stack.push(e.id); }
      }
    }
    return out;
  }
  isAncestor(anc, id) {
    for (let e = this.get(id); e; e = this.get(e.parentId)) if (e.parentId === anc) return true;
    return false;
  }
  path(id) { const out = []; for (let e = this.get(id); e; e = this.get(e.parentId)) out.unshift(e); return out; }
  maxZ(parentId) { return this.children(parentId, 'canvas').reduce((m, e) => Math.max(m, e.z), 0); }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(info) { for (const fn of this.listeners) fn(info); }

  _apply(patches, side) {
    for (const p of patches) {
      const v = p[side];
      if (v) this.elements[p.id] = v; else delete this.elements[p.id];
    }
  }

  /** commit a list of {id, after}; before is read from current state. opts.merge: key to coalesce rapid edits */
  commit(changes, opts = {}) {
    const patches = [];
    for (const c of changes) {
      const before = this.elements[c.id] || null;
      const after = c.after ? { ...c.after, modified: Date.now() } : null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      patches.push({ id: c.id, before, after });
    }
    if (!patches.length) return;
    this._apply(patches, 'after');
    const top = this.undoStack[this.undoStack.length - 1];
    if (opts.merge && top && top.merge === opts.merge && Date.now() - top.t < 2500) {
      for (const p of patches) {
        const ex = top.patches.find((q) => q.id === p.id);
        if (ex) ex.after = p.after; else top.patches.push(p);
      }
      top.t = Date.now();
    } else {
      this.undoStack.push({ patches, label: opts.label || 'Edit', merge: opts.merge, t: Date.now() });
      if (this.undoStack.length > 200) this.undoStack.shift();
    }
    this.redoStack = [];
    this.afterChange(patches, true);
  }

  undo() {
    const e = this.undoStack.pop(); if (!e) return false;
    this._apply(e.patches, 'before'); this.redoStack.push(e);
    this.afterChange(e.patches.map((p) => ({ id: p.id, before: p.after, after: p.before })), true);
    return true;
  }
  redo() {
    const e = this.redoStack.pop(); if (!e) return false;
    this._apply(e.patches, 'after'); this.undoStack.push(e);
    this.afterChange(e.patches, true);
    return true;
  }

  afterChange(patches, local) {
    this.emit({ patches, local });
    if (local) {
      if (this.channel) {
        try { this.channel.postMessage({ from: this.clientId, user: this.userKey, patches: patches.map((p) => ({ id: p.id, after: p.after })) }); } catch { /* clone error */ }
      }
      for (const p of patches) this.pending.add(p.id);
      this.save(); this.scheduleFlush();
    }
  }

  /** last-writer-wins by modified time; remote changes never enter the local undo stack */
  onRemote(msg, via = 'cloud') {
    if (!msg || msg.from === this.clientId) return;
    if (via === 'tab' && msg.user !== this.userKey) return;      // another account's tab
    const applied = [];
    for (const p of msg.patches) {
      const cur = this.elements[p.id] || null;
      if (p.after && cur && cur.modified >= p.after.modified) continue;
      if (!p.after && !cur) continue;
      if (!p.after && p.modified && cur && cur.modified > p.modified) continue;      // local edit is newer than the delete
      if (p.after) this.elements[p.id] = p.after; else delete this.elements[p.id];
      if (via === 'cloud') this.pending.delete(p.id);
      applied.push({ id: p.id, before: cur, after: p.after });
    }
    if (applied.length) { this.emit({ patches: applied, local: false }); if (via === 'cloud') this.save(); }
  }

  setPref(k, v) { this.prefs[k] = v; this.save(); this.emit({ patches: [], local: true, pref: k }); this.backend?.saveProfile({ prefs: this.prefs }).catch(() => {}); }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => idbSet(keyFor(this.userKey), { elements: this.elements, rootId: this.rootId, prefs: this.prefs, pending: [...this.pending] }), 250);
  }

  // ------------------------------------------------------------------ cloud sync
  setSync(state) { if (this.syncState !== state) { this.syncState = state; this.emit({ patches: [], local: false, sync: state }); } }

  /**
   * Attach a cloud backend: merge what the account already has with what is cached locally
   * (newest `modified` wins per element), then push whatever the cloud is missing.
   */
  async connect(backend, { adoptLocal = null, confirmAdopt = null } = {}) {
    this.backend = backend; this.setSync('syncing');
    const profile = await backend.getProfile();
    const remote = await backend.loadAll();
    const remoteIds = new Set(Object.keys(remote));
    if (profile?.root_id && profile.root_id !== this.rootId) {
      // The account already has a home board. Drop the empty one that was auto-created for this device.
      const fresh = this.get(this.rootId);
      if (fresh && !this.descendants(fresh.id, true).length && !remoteIds.has(fresh.id)) { delete this.elements[fresh.id]; this.pending.delete(fresh.id); }
      this.rootId = profile.root_id;
    }
    if (adoptLocal && !profile?.root_id && Object.keys(remote).length === 0 && (!confirmAdopt || await confirmAdopt())) {   // first sign-in: bring over boards made without an account
      this.elements = adoptLocal.elements; this.rootId = adoptLocal.rootId;
      for (const id of Object.keys(this.elements)) this.pending.add(id);
    }
    for (const [id, el] of Object.entries(remote)) {
      const cur = this.elements[id];
      if (el.deleted) {                                  // tombstone: removed on another device
        if (cur && cur.modified > el.modified) this.pending.add(id);       // but edited here since, so keep it
        else { delete this.elements[id]; this.pending.delete(id); }
      } else if (!cur || el.modified > cur.modified) { this.elements[id] = el; this.pending.delete(id); }
      else if (cur.modified > el.modified) this.pending.add(id);
    }
    for (const id of Object.keys(this.elements)) if (!remoteIds.has(id)) this.pending.add(id);
    backend.purgeTombstones?.().catch(() => {});
    if (!this.elements[this.rootId]) { const r = newRoot(); this.elements[r.id] = r; this.rootId = r.id; this.pending.add(r.id); }
    if (profile?.prefs && Object.keys(profile.prefs).length) this.prefs = { ...this.prefs, ...profile.prefs };
    await backend.saveProfile({ root_id: this.rootId, prefs: this.prefs });
    this.emit({ patches: [], local: false, reset: true });
    this.save();
    backend.subscribe((msg) => this.onRemote({ from: 'cloud', patches: msg }, 'cloud'), (status) => { if (status === 'SUBSCRIBED') this.flush(); });
    window.addEventListener('online', () => this.flush());
    window.addEventListener('offline', () => this.setSync('offline'));
    await this.flush();
  }

  scheduleFlush() { if (!this.backend) return; this.setSync(navigator.onLine ? 'syncing' : 'offline'); clearTimeout(this.flushTimer); this.flushTimer = setTimeout(() => this.flush(), 500); }

  async flush() {
    if (!this.backend) return;
    if (this.flushing) { this.again = true; return; }
    if (!this.pending.size) { this.setSync(navigator.onLine ? 'synced' : 'offline'); return; }
    this.flushing = true;
    try {
      this.setSync('syncing');
      do {
        this.again = false;
        const ids = [...this.pending];
        const snap = ids.map((id) => [id, this.elements[id] || null]);
        await this.backend.push(snap.map(([id, el]) => ({ id, after: el })));
        for (const [id, el] of snap) if ((this.elements[id] || null) === el) this.pending.delete(id);
        this.save();
      } while (this.again || this.pending.size);
      this.setSync('synced');
    } catch (err) {
      console.warn('cloud sync failed', err);
      this.setSync(navigator.onLine ? 'error' : 'offline');
      clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.flush(), 8000);
    } finally { this.flushing = false; }
  }

  exportJSON() { return JSON.stringify({ app: 'corkboard', version: 1, rootId: this.rootId, elements: this.elements }, null, 1); }
  importJSON(text) {
    const d = JSON.parse(text);
    if (d.app !== 'corkboard' || !d.elements || !d.rootId) throw new Error('Not a Corkboard export');
    for (const id of Object.keys(this.elements)) this.pending.add(id);        // so removals reach the cloud
    this.elements = d.elements; this.rootId = d.rootId; this.undoStack = []; this.redoStack = [];
    for (const id of Object.keys(this.elements)) this.pending.add(id);
    this.emit({ patches: [], local: true, reset: true }); this.save(); this.scheduleFlush();
  }
}
