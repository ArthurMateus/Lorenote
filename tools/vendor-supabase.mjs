// Vendor @supabase/supabase-js as plain ES modules into app/vendor/ so the site has NO third-party script
// dependency at runtime (strict CSP: script-src 'self'; no CDN supply-chain exposure).
// usage: node tools/vendor-supabase.mjs [version]        (default: the version pinned below)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = process.argv[2] || '2.117.3';
const CDN = 'https://cdn.jsdelivr.net';
const OUT = path.join(import.meta.dirname, '..', 'app', 'vendor');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const files = new Map();                        // absolute URL -> local file name
const manifest = [];
const nameFor = (url) => {
  const u = new URL(url); const m = u.pathname.match(/\/npm\/(.+?)\/\+esm$/) || u.pathname.match(/\/npm\/(.+)$/);
  const base = (m ? m[1] : u.pathname).replace(/^@/, '').replace(/[\/@+]+/g, '_').replace(/_esm$/, '') || 'mod';
  return base + '.js';
};
const SPEC = /(\bfrom\s*|\bimport\s*\(?\s*|\bexport\s*\*\s*from\s*)(["'])(\/[^"']+|https?:\/\/[^"']+)\2/g;

async function pull(url) {
  if (files.has(url)) return files.get(url);
  const local = nameFor(url); files.set(url, local);
  const res = await fetch(url); if (!res.ok) throw new Error(`${res.status} ${url}`);
  let text = await res.text(); const deps = new Set();
  for (const m of text.matchAll(SPEC)) { const abs = new URL(m[3], CDN).toString(); if (abs.startsWith(CDN + '/npm/')) deps.add(m[3]); }
  for (const spec of deps) { const abs = new URL(spec, CDN).toString(); const dep = await pull(abs); text = text.split(`"${spec}"`).join(`"./${dep}"`).split(`'${spec}'`).join(`'./${dep}'`); }
  fs.writeFileSync(path.join(OUT, local), text);
  manifest.push({ file: local, source: url, bytes: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') });
  return local;
}

const entry = await pull(`${CDN}/npm/@supabase/supabase-js@${VERSION}/+esm`);
// the app imports one stable name
fs.copyFileSync(path.join(OUT, entry), path.join(OUT, 'supabase-js.js'));
manifest.sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(OUT, 'README.md'),
`# Vendored dependencies

\`@supabase/supabase-js@${VERSION}\` (MIT licence, https://github.com/supabase/supabase-js) as ES modules from the jsDelivr \`+esm\` build,
with import specifiers rewritten to local files. Regenerate with \`node tools/vendor-supabase.mjs <version>\`.
Entry point used by the app: \`supabase-js.js\` (a copy of \`${entry}\`).

| file | source | bytes | sha256 |
|---|---|---|---|
${manifest.map((m) => `| ${m.file} | ${m.source.replace(CDN, '')} | ${m.bytes} | ${m.sha256.slice(0, 16)}… |`).join('\n')}
`);
console.log(`vendored ${manifest.length} modules (${manifest.reduce((s, m) => s + m.bytes, 0)} bytes) -> ${OUT}`);
for (const m of manifest) console.log(' ', m.file, m.bytes);
// any import that still points off-site?
const leftovers = manifest.flatMap((m) => [...fs.readFileSync(path.join(OUT, m.file), 'utf8').matchAll(SPEC)].map((x) => x[3]).filter((s) => /^https?:|^\/npm/.test(s)).map((s) => `${m.file}: ${s}`));
if (leftovers.length) console.log('WARNING remote imports remain:', leftovers); else console.log('no remote imports remain');
