// Supabase Edge Function: link-preview
// Fetches a web page on the server (browsers cannot, because of CORS) and returns its title, description,
// image and site name. Only signed-in users may call it. It refuses anything that could reach private
// networks (SSRF), follows a few redirects manually (re-checking each hop), and bounds time and size.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MAX_BYTES = 512 * 1024;
// rate limiting lives in the database (public.hit_rate_limit) so every function instance shares one counter
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 6000;

// ---------------------------------------------------------------- SSRF guard
function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function ipv6Private(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return ipv4Private(mapped[1]);
  return false;
}
async function assertPublicHost(hostname: string) {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) throw new Error('That address is not allowed');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) { if (ipv4Private(h)) throw new Error('That address is not allowed'); return; }
  if (h.includes(':')) { if (ipv6Private(h)) throw new Error('That address is not allowed'); return; }
  const ips: string[] = [];
  try { ips.push(...await Deno.resolveDns(h, 'A')); } catch { /* no A record */ }
  try { for (const a of await Deno.resolveDns(h, 'AAAA')) ips.push(a); } catch { /* no AAAA record */ }
  if (!ips.length) throw new Error('Could not find that site');
  if (ips.some((ip) => (ip.includes(':') ? ipv6Private(ip) : ipv4Private(ip)))) throw new Error('That address is not allowed');
}

async function safeFetch(start: string): Promise<{ res: Response; finalUrl: string }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only web links can be previewed');
    if (u.username || u.password) throw new Error('That address is not allowed');
    if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('That address is not allowed');
    await assertPublicHost(u.hostname);
    const res = await fetch(u, {
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LorenoteLinkPreview/1.0)', Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, u).toString(); continue; }
    return { res, finalUrl: u.toString() };
  }
  throw new Error('Too many redirects');
}

// ---------------------------------------------------------------- parsing
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();

function metaMap(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
    const key = (attrs.property || attrs.name || '').toLowerCase(); const val = attrs.content;
    if (key && val && !(key in out)) out[key] = decode(val);
  }
  return out;
}
const abs = (v: string | undefined, base: string) => { if (!v) return undefined; try { const u = new URL(v, base); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined; } catch { return undefined; } };
const clip = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let total = 0;
  while (total < MAX_BYTES) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); total += value.length; }
  try { await reader.cancel(); } catch { /* ignore */ }
  const buf = new Uint8Array(Math.min(total, MAX_BYTES)); let o = 0; for (const c of chunks) { const take = Math.min(c.length, buf.length - o); buf.set(c.subarray(0, take), o); o += take; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

// ---------------------------------------------------------------- handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: 'Sign in to use link previews' }, 401);
    const { data: allowed, error: rlErr } = await sb.rpc('hit_rate_limit', { p_bucket: 'link-preview', p_max: 30, p_window_seconds: 60 });    // 30 previews per user per minute
    if (rlErr) console.warn('rate limit check failed, allowing the request:', rlErr.message);
    else if (allowed === false) return json({ error: 'Too many previews. Try again in a minute.' }, 429);

    const body = await req.json().catch(() => ({}));
    let target = String(body.url ?? '').trim();
    if (!target || target.length > 2000) return json({ error: 'Missing link' }, 400);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) target = 'https://' + target;

    const { res, finalUrl } = await safeFetch(target);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) return json({ url: finalUrl, title: '', error: `The site answered ${res.status}` });
    if (type.startsWith('image/')) return json({ url: finalUrl, title: new URL(finalUrl).pathname.split('/').pop() || new URL(finalUrl).hostname, image: finalUrl, siteName: new URL(finalUrl).hostname.replace(/^www\./, '') });
    if (!/html|xml/i.test(type) && type) return json({ url: finalUrl, title: new URL(finalUrl).hostname.replace(/^www\./, ''), siteName: new URL(finalUrl).hostname.replace(/^www\./, '') });

    const html = await readLimited(res);
    const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : 200000);
    const m = metaMap(head);
    const titleTag = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const host = new URL(finalUrl).hostname.replace(/^www\./, '');
    return json({
      url: finalUrl,
      title: clip(m['og:title'] || m['twitter:title'] || (titleTag ? decode(titleTag) : '') || host, 200),
      description: clip(m['og:description'] || m['twitter:description'] || m['description'], 400),
      image: abs(m['og:image'] || m['og:image:url'] || m['twitter:image'] || m['twitter:image:src'], finalUrl),
      siteName: clip(m['og:site_name'] || host, 80),
    });
  } catch (err) {
    return json({ error: (err as Error).message || 'Could not load that page' }, 200);
  }
});
