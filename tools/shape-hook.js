// Injected into the test tab: logs value-free shapes of REST + Socket.IO traffic into window.__rea.
(() => {
  if (window.__rea) return 'already';
  const log = (window.__rea = []);
  const LIT = new Set(['type', 'elementType', 'rootType', 'operation', 'requestMode', 'navigationSource', 'actionType', 'mode', 'kind', 'status', 'platform', 'applicationType', 'role', 'state', 'direction', 'origin', 'attachType', 'section', 'creationSource', 'platform', 'lineType', 'shape', 'style', 'colorName', 'fillType', 'sortType', 'tool', 'viewType', 'displayMode', 'align', 'permissionName', 'resourceType', 'source']);
  const shape = (v, d = 0) => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return d > 5 ? 'array' : v.length ? ['[' + v.length + ']', shape(v[0], d + 1)] : '[]';
    switch (typeof v) {
      case 'string': return /^[0-9A-Za-z_-]{12,16}$/.test(v) ? 'id' : 'str(' + v.length + ')';
      case 'number': return Number.isInteger(v) ? 'int' : 'num';
      case 'boolean': return 'bool';
      case 'object': if (d > 5) return 'object'; return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, LIT.has(k) && typeof x === 'string' && x.length < 48 && !/\s/.test(x) ? x : shape(x, d + 1)]));
      default: return typeof v;
    }
  };
  const idnorm = (u) => u.replace(/\/[0-9A-Za-z_-]{12,16}(?=\/|\?|$)/g, '/:id').replace(/=[0-9A-Za-z_-]{12,16}/g, '=:id').replace(/(userId=)[^&]+/, '$1:uid');
  const parse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  const sio = (dir, data) => {
    if (typeof data !== 'string') return log.push({ t: Date.now(), k: 'ws', dir, bin: data.byteLength || data.size });
    const m = data.match(/^(\d)(\d*)(?:\/[^,]*,)?(\d*)(.*)$/s);
    const eio = data[0];
    if (eio !== '4') return log.push({ t: Date.now(), k: 'ws', dir, eio, len: data.length, body: eio === '0' ? shape(parse(data.slice(1))) : undefined });
    const type = data[1]; const rest = data.slice(2).replace(/^\d*(?=[\[{])/, '').replace(/^\/[^,]*,/, '');
    const j = parse(rest);
    const entry = { t: Date.now(), k: 'ws', dir, sio: type, len: data.length };
    if (Array.isArray(j)) { entry.event = typeof j[0] === 'string' && type !== '3' ? j[0] : undefined; entry.args = j.slice(entry.event ? 1 : 0).map((x) => shape(x)); }
    else if (j !== undefined) entry.body = shape(j);
    log.push(entry);
  };
  const WS = window.WebSocket;
  window.WebSocket = function (url, p) {
    const s = p ? new WS(url, p) : new WS(url);
    log.push({ t: Date.now(), k: 'ws-open', url: idnorm(String(url)) });
    s.addEventListener('message', (e) => sio('in', e.data));
    const send = s.send.bind(s); s.send = (d) => { sio('out', d); return send(d); };
    s.addEventListener('close', (e) => log.push({ t: Date.now(), k: 'ws-close', code: e.code }));
    return s;
  };
  window.WebSocket.prototype = WS.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const f = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url; const method = (init && init.method) || (input.method) || 'GET';
    const body = init && typeof init.body === 'string' ? shape(parse(init.body)) : init && init.body ? 'non-json' : undefined;
    const r = await f(input, init);
    try { const c = r.clone(); const txt = await c.text(); log.push({ t: Date.now(), k: 'fetch', method, url: idnorm(url), status: r.status, req: body, res: shape(parse(txt)) }); } catch {}
    return r;
  };
  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    const req = typeof b === 'string' ? shape(parse(b)) : b ? 'non-json' : undefined;
    this.addEventListener('loadend', () => { let res; try { res = shape(parse(this.responseText)); } catch {} log.push({ t: Date.now(), k: 'xhr', method: this.__m, url: idnorm(String(this.__u)), status: this.status, req, res }); });
    return xs.apply(this, arguments);
  };
  return 'installed';
})()
