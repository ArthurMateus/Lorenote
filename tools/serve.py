"""Dev server for the app folder: static files with caching disabled.  usage: python tools/serve.py [port]"""
import http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
