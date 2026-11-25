from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3, json, threading, webbrowser
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'templo.sqlite3'
with sqlite3.connect(DB) as conn:
    conn.execute("CREATE TABLE IF NOT EXISTS gestao (id INTEGER PRIMARY KEY, versao INTEGER, dados TEXT)")
    conn.execute("INSERT OR IGNORE INTO gestao VALUES (1,0,?)", (json.dumps(dict(pessoas=[], agenda=[], contas=[])),))

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data, mime):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Frame-Options', 'DENY')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get('Host') != '127.0.0.1:8765':
            return self.send_error(403)
        path = urlsplit(self.path).path
        if path == '/dados':
            with sqlite3.connect(DB) as con:
                version, data = con.execute('SELECT versao,dados FROM gestao WHERE id=1').fetchone()
            return self.reply(200,json.dumps(dict(version=version,data=json.loads(data))).encode(),'application/json')
        files = {'/': ('index.html','text/html; charset=utf-8'), '/app.js':('app.js','text/javascript'), '/mapa.png':('mapa.png','image/png')}
        files.update({
            '/marca.svg': ('Grenze_vermelho/Assinatura_horizontal.svg','image/svg+xml'),
            '/alegreya.ttf': ('Grenze_vermelho/Fontes/Alegreya.ttf','font/ttf'),
            '/interface.css': ('interface.css','text/css'),
        })
        if path not in files:
            return self.send_error(404)
        name,mime = files[path]
        self.reply(200,(ROOT/name).read_bytes(),mime)

    def do_POST(self):
        if self.path != '/dados' or self.headers.get('Origin') != 'http://127.0.0.1:8765' or self.headers.get('Host') != '127.0.0.1:8765':
            return self.send_error(403)
        try:
            size = int(self.headers['Content-Length'])
            if not 0 < size <= 16000000:
                return self.send_error(413)
            payload = json.loads(self.rfile.read(size))
            data = payload['data']
            if not all(isinstance(data[k],list) for k in ('pessoas','agenda','contas')):
                return self.send_error(400)
            with sqlite3.connect(DB) as con:
                changed = con.execute('UPDATE gestao SET dados=?,versao=versao+1 WHERE id=1 AND versao=?',(json.dumps(data,ensure_ascii=False),payload['version'])).rowcount
            self.reply(200 if changed else 409,b'{}','application/json')
        except (ValueError, KeyError, TypeError):
            self.send_error(400)

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1',8765),Handler)
    print('Gestão do templo: http://127.0.0.1:8765',flush=True)
    threading.Timer(.5,lambda:webbrowser.open('http://127.0.0.1:8765')).start()
    server.serve_forever()
