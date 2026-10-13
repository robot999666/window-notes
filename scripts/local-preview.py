"""Local-only preview of the static build plus the loopback publishing API."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.client import HTTPConnection
from pathlib import Path
from urllib.parse import urlsplit
import re

ROOT = Path(__file__).resolve().parents[1] / 'dist'

class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def is_api(self):
        path = urlsplit(self.path).path
        return path.startswith('/api/') or bool(re.fullmatch(r'/notes/[^/]+/?', path)) or path in ('/rss.xml', '/search.json', '/sitemap.xml')

    def proxy(self):
        size = int(self.headers.get('Content-Length', 0))
        if size > 160 * 1024:
            self.send_error(413)
            return
        body = self.rfile.read(size) if size else None
        headers = dict(self.headers)
        headers.update({'X-Forwarded-Proto': 'http', 'X-Forwarded-For': '127.0.0.1'})
        connection = HTTPConnection('127.0.0.1', 18088, timeout=30)
        try:
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ('connection', 'transfer-encoding', 'server', 'date'):
                    self.send_header(key, value)
            self.end_headers()
            self.wfile.write(response.read())
        except OSError:
            self.send_error(502, 'Local publishing API is unavailable')
        finally:
            connection.close()

    def do_GET(self):
        if self.is_api():
            self.proxy()
        else:
            super().do_GET()
    def do_HEAD(self):
        if self.is_api():
            self.proxy()
        else:
            super().do_HEAD()
    def do_POST(self): self.proxy()
    def do_PUT(self): self.proxy()
    def do_DELETE(self): self.proxy()
    def log_message(self, *args): pass

print('Local integrated preview at http://127.0.0.1:4321/', flush=True)
ThreadingHTTPServer(('127.0.0.1', 4321), Preview).serve_forever()
