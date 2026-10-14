"""Dev server for the app folder. Caching is disabled and the security headers from ../vercel.json are applied,
so the strict Content-Security-Policy is exercised locally exactly as it will be in production.
usage: python tools/serve.py [port]        (set NO_HEADERS=1 to serve without them)"""
import http.server, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HEADERS = []
if not os.environ.get('NO_HEADERS'):
    try:
        cfg = json.load(open(os.path.join(ROOT, 'vercel.json'), encoding='utf-8'))
        for rule in cfg.get('headers', []):
            if rule.get('source') == '/(.*)':
                HEADERS = [(h['key'], h['value']) for h in rule['headers']]
    except Exception as e:  # pragma: no cover
        print('could not read vercel.json headers:', e)

# production sends HSTS over https only; skip it on plain-http localhost
SKIP_LOCAL = {'strict-transport-security'}

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        for k, v in HEADERS:
            if k.lower() not in SKIP_LOCAL:
                self.send_header(k, v)
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
os.chdir(os.path.join(ROOT, 'app'))
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
