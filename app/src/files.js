import { t } from './i18n.js';
// Cloud file storage for image/file cards (Supabase Storage, private bucket, per-user folder).
// Cards store `content.path` (the storage path); blobs are cached in the Cache API so they work offline.
// Guests (no backend) keep small files inline as data URLs in `content.src`, as before.
const CACHE = 'corkboard-files-v1';
export const MAX_CLOUD_BYTES = 25 * 1024 * 1024;

const keyOf = (path) => 'https://files.corkboard.local/' + encodeURI(path);
async function cacheOpen() { try { return await caches.open(CACHE); } catch { return null; } }

export class FileService {
  constructor(backend) { this.backend = backend; this.urls = new Map(); this.loading = new Map(); }

  /** upload a blob for an element; returns the storage path */
  async upload(elementId, blob, name = 'file') {
    if (blob.size > MAX_CLOUD_BYTES) throw Object.assign(new Error(t('file.tooLarge', { name, n: MAX_CLOUD_BYTES / 1048576 })), { code: 'too-large' });
    const ext = (name.match(/\.([A-Za-z0-9]{1,8})$/) || [, 'bin'])[1].toLowerCase();
    const rel = `${elementId}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const path = await this.backend.uploadFile(rel, blob);
    const c = await cacheOpen(); if (c) { try { await c.put(keyOf(path), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } })); } catch { /* quota */ } }
    return path;
  }

  /** a blob: object URL for a stored file (cache first, then a signed URL) */
  objectUrl(path) {
    if (this.urls.has(path)) return Promise.resolve(this.urls.get(path));
    if (this.loading.has(path)) return this.loading.get(path);
    const p = (async () => {
      const c = await cacheOpen(); let blob = null;
      const hit = c && await c.match(keyOf(path)); if (hit) blob = await hit.blob();
      if (!blob) {
        const url = await this.backend.fileUrl(path); const res = await fetch(url); if (!res.ok) throw new Error('download failed (' + res.status + ')');
        blob = await res.blob(); if (c) { try { await c.put(keyOf(path), new Response(blob.slice(), { headers: { 'Content-Type': blob.type } })); } catch { /* quota */ } }
      }
      const u = URL.createObjectURL(blob); this.urls.set(path, u); return u;
    })().finally(() => this.loading.delete(path));
    this.loading.set(path, p); return p;
  }

  async forget(path) { const c = await cacheOpen(); try { await c?.delete(keyOf(path)); } catch { /* ignore */ } const u = this.urls.get(path); if (u) { URL.revokeObjectURL(u); this.urls.delete(path); } }
}

/** data: URL -> Blob */
export async function dataUrlToBlob(dataUrl) { return (await fetch(dataUrl)).blob(); }
