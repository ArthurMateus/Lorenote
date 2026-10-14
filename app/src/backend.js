// Supabase adapter. Returns null when no project is configured, so the app runs fully local.
// The adapter surface is deliberately small so another backend (or a test double) can replace it.
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const CHUNK = 150;

export async function createBackend(config) {
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) return null;
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const redirect = location.origin + location.pathname;
  const fail = (error) => { if (error) throw error; };
  let user = null; let channel = null;

  const api = {
    kind: 'supabase',
    oauth: config.oauthProviders || [],

    // ------------------------------------------------------------ auth
    async getUser() { const { data } = await sb.auth.getSession(); user = data.session?.user || null; return user; },
    onAuthChange(cb) { sb.auth.onAuthStateChange((event, session) => { const u = session?.user || null; if ((u?.id || null) !== (user?.id || null)) { user = u; cb(u, event); } else if (event === 'PASSWORD_RECOVERY') cb(u, event); }); },
    async signUp(email, password) { const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } }); fail(error); return { needsConfirm: !data.session }; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); fail(error); },
    async magicLink(email) { const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } }); fail(error); },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect }); fail(error); },
    async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); fail(error); },
    async oauthSignIn(provider) { const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: redirect } }); fail(error); },
    async signOut() { channel?.unsubscribe(); await sb.auth.signOut(); },

    // ------------------------------------------------------------ profile
    async getProfile() { const { data, error } = await sb.from('profiles').select('root_id, prefs, display_name').eq('id', user.id).maybeSingle(); fail(error); return data; },
    async saveProfile(patch) { const { error } = await sb.from('profiles').upsert({ id: user.id, ...patch }, { onConflict: 'id' }); fail(error); },

    // ------------------------------------------------------------ elements
    async loadAll() {
      const out = {}; const PAGE = 500;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('elements').select('id, data').order('id').range(from, from + PAGE - 1);
        fail(error);
        for (const r of data) out[r.id] = r.data;
        if (data.length < PAGE) break;
      }
      return out;
    },
    /** changes: [{id, after: element|null}]. Deletes are tombstones so realtime (which cannot filter DELETE) still reaches other devices. */
    async push(changes) {
      const now = Date.now();
      const rows = changes.map((c) => (c.after
        ? { id: c.id, data: c.after, modified: c.after.modified }
        : { id: c.id, data: { id: c.id, deleted: true, modified: now }, modified: now }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await sb.from('elements').upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' }); fail(error);
      }
    },
    /** drop tombstones older than 30 days */
    async purgeTombstones() {
      const cutoff = Date.now() - 30 * 86400000;
      const { error } = await sb.from('elements').delete().eq('data->>deleted', 'true').lt('modified', cutoff); fail(error);
    },
    subscribe(onPatches, onStatus) {
      channel?.unsubscribe();
      channel = sb.channel('elements-' + user.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'elements', filter: `owner=eq.${user.id}` }, (p) => {
          if (p.eventType === 'DELETE') return onPatches([{ id: p.old.id, after: null }]);
          const d = p.new.data; onPatches([d.deleted ? { id: p.new.id, after: null, modified: p.new.modified } : { id: p.new.id, after: d }]);
        })
        .subscribe((status) => onStatus?.(status));
    },

    // ------------------------------------------------------------ account templates
    async listTemplates() { const { data, error } = await sb.from('templates').select('id, name, root_id, elements, created_at').order('created_at', { ascending: false }); fail(error); return data; },
    async saveTemplate(name, rootId, elements) { const { data, error } = await sb.from('templates').insert({ name, root_id: rootId, elements }).select('id').single(); fail(error); return data.id; },
    async deleteTemplate(id) { const { error } = await sb.from('templates').delete().eq('id', id); fail(error); },

    // ------------------------------------------------------------ files
    async uploadFile(path, blob) { const { error } = await sb.storage.from('files').upload(`${user.id}/${path}`, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' }); fail(error); return `${user.id}/${path}`; },
    async fileUrl(path) { const { data, error } = await sb.storage.from('files').createSignedUrl(path, 3600); fail(error); return data.signedUrl; },
    async removeFiles(paths) { if (!paths.length) return; const { error } = await sb.storage.from('files').remove(paths); fail(error); },
    async listFiles() {
      const out = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await sb.storage.from('files').list(user.id, { limit: 100, offset, sortBy: { column: 'created_at', order: 'asc' } }); fail(error);
        for (const f of data) if (f.id) out.push({ path: `${user.id}/${f.name}`, created: f.created_at, size: f.metadata?.size || 0 });
        if (data.length < 100) break;
      }
      return out;
    },

    // ------------------------------------------------------------ link previews (Edge Function `link-preview`)
    async linkPreview(url) {
      const { data, error } = await sb.functions.invoke('link-preview', { body: { url } }); fail(error);
      if (data?.error) throw new Error(data.error); return data;
    },
  };
  return api;
}
