// Minimal CDP driver for the Brave test tab (loopback only).
// usage: node cdp.mjs <cmd> [args...]   (PORT env defaults to 9223)
//   shot <file.png> | eval <js> | click x y | dblclick x y | rclick x y
//   drag x1 y1 x2 y2 | type <text> | key <Key> [modifiers: ctrl,shift,alt] | wait ms
import fs from 'node:fs';
const PORT = process.env.PORT || 9223;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://app.milanote.com'));
if (!page) { console.error('no milanote page'); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
const [cmd, ...a] = process.argv.slice(2);
const n = (v) => Number(v);
const mods = (s) => (s || '').split(',').reduce((m, k) => m | ({ alt: 1, ctrl: 2, meta: 4, shift: 8 }[k] || 0), 0);
if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(a[0], Buffer.from(r.result.data, 'base64')); console.log('saved', a[0]);
} else if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: a[0], returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.result.value ?? r.result.exceptionDetails ?? r.result.result, null, 1));
} else if (cmd === 'evalfile') {
  const r = await send('Runtime.evaluate', { expression: fs.readFileSync(a[0], 'utf8'), returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.result.value ?? r.result.exceptionDetails ?? r.result.result));
} else if (cmd === 'reloadhook') { // install a script before page scripts run, then reload (hook lives for that page load)
  await send('Page.enable');
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(a[0], 'utf8') });
  await send('Page.reload', { ignoreCache: false });
  await sleep(n(a[1] || 10000));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: r.result.identifier });
} else if (cmd === 'click' || cmd === 'dblclick' || cmd === 'rclick') {
  const b = cmd === 'rclick' ? 'right' : 'left'; const cc = cmd === 'dblclick' ? 2 : 1;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: n(a[0]), y: n(a[1]) });
  for (let c = 1; c <= cc; c++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: n(a[0]), y: n(a[1]), button: b, clickCount: c });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: n(a[0]), y: n(a[1]), button: b, clickCount: c });
  }
} else if (cmd === 'drag') {
  const [x1, y1, x2, y2] = a.map(n);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
  await mouse('mousePressed', x1, y1);
  for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12); await sleep(30); }
  await mouse('mouseReleased', x2, y2);
} else if (cmd === 'type') {
  for (const ch of a[0]) { await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(15); }
} else if (cmd === 'insert') {
  await send('Input.insertText', { text: a[0] });
} else if (cmd === 'key') {
  const key = a[0]; const m = mods(a[1]);
  const code = key.length === 1 ? 'Key' + key.toUpperCase() : key;
  const vk = { Enter: 13, Escape: 27, Backspace: 8, Delete: 46, Tab: 9 }[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: m });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: m });
} else if (cmd === 'blip') { // drop network for a:ms so the page reconnects its socket
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(n(a[0] || 1500));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(500);
} else if (cmd === 'wait') { await sleep(n(a[0])); }
ws.close(); process.exit(0);
