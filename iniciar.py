"""Secretaria OGD. Servidor local, autenticação e persistência SQLite."""
import argparse
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import webbrowser
from contextlib import closing
from datetime import date, time as clock
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from signos import signo
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('OGD_DATA', ROOT / 'dados')).resolve()
KINDS = ('pessoas', 'agenda', 'contas')
ROLES = {'Administrador': KINDS, 'Atendimento': ('pessoas', 'agenda'), 'Financeiro': ('contas',)}
FILES = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'),
         '/interface.css': ('interface.css', 'text/css'), '/mapa.png': ('mapa.png', 'image/png'),
         '/marca.svg': ('Grenze_vermelho/Assinatura_horizontal.svg', 'image/svg+xml'),
         '/alegreya.ttf': ('Grenze_vermelho/Fontes/Alegreya.ttf', 'font/ttf')}
ORIGIN = 'http://127.0.0.1:8765'


class Problem(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def require(condition, message, status=400):
    if not condition:
        raise Problem(status, message)


def connection():
    con = sqlite3.connect(DATA / 'secretaria.sqlite3', timeout=10)
    con.row_factory = sqlite3.Row
    return con


def initialize():
    DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    with closing(connection()) as con, con:
        con.execute('BEGIN IMMEDIATE')
        for sql in (
            'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT, active INTEGER DEFAULT 1)',
            'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, uid INTEGER, expires INTEGER)',
            'CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))',
            'CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, ts INTEGER, uid INTEGER, action TEXT, target TEXT)',
            'CREATE TABLE IF NOT EXISTS attempts (ts INTEGER)',
            'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
        ):
            con.execute(sql)
        if not con.execute("SELECT 1 FROM settings WHERE key='migration'").fetchone():
            legacy = ROOT / 'templo.sqlite3'
            if legacy.exists():
                with closing(sqlite3.connect(legacy.as_uri()+'?mode=ro', uri=True)) as old:
                    row = old.execute('SELECT dados FROM gestao WHERE id=1').fetchone()
                    data = json.loads(row[0])
                    for kind in KINDS:
                        for item in data[kind]:
                            con.execute('INSERT INTO records VALUES (?,?,?)', (kind,item['id'],json.dumps(item)))
            con.execute("INSERT INTO settings VALUES ('migration','1')")


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**15, r=8, p=1, maxmem=64*1024**2)
    return salt + ':' + digest.hex()


def check_password(pwd, stored):
    return isinstance(pwd,str) and len(pwd)<=256 and hmac.compare_digest(hash_password(pwd,stored.split(':')[0]),stored)


def account(body):
    name = str(body.get('name','')).strip()
    email = str(body.get('email','')).strip().lower()
    password = body.get('password','')
    require(1<=len(name)<=120 and re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email) and len(email)<=254,'Informe nome e e-mail válidos.')
    require(isinstance(password,str) and 12<=len(password)<=256,'Use uma senha de 12 a 256 caracteres.')
    return name,email,hash_password(password)


def validate(con,kind,item,previous):
    def need(key):
        v=item.get(key)
        require(isinstance(v,str) and v.strip(), 'Campo obrigatório: '+key)
        return v
    if kind=='pessoas':
        need('nome')
        require(item.get('tipo') in ('Aluno','Cliente','Aluno e cliente'),'Vínculo inválido.')
        require(isinstance(item.get('analysis'),dict) and isinstance(item.get('map'),list) and len(item['map'])>=13,'Ficha incompleta.')
        for slot in item['map']:
            require(isinstance(slot,dict) and isinstance(slot.get('label'),str) and slot['label'].strip(),'Posição inválida.')
        return
    pid=item.get('pid','')
    if pid:
        require(con.execute("SELECT 1 FROM records WHERE kind='pessoas' AND id=?", (pid,)).fetchone(),'Cadastro não encontrado.')
    if kind=='contas':
        need('descricao')
        date.fromisoformat(need('due'))
        if item.get('paid'):
            date.fromisoformat(item['paid'])
        require(item.get('tipo') in ('A pagar','A receber') and type(item.get('cents')) is int and 0<item['cents']<=9007199254740991,'Lançamento inválido.')
        return
    need('title')
    owner=need('owner').strip().casefold()
    day=need('day')
    date.fromisoformat(day)
    start,end=clock.fromisoformat(need('start')),clock.fromisoformat(need('end'))
    require(start<end,'O término deve ser posterior ao início.')
    require(item.get('status') in ('Agendado','Confirmado','Realizado','Faltou','Cancelado'),'Situação inválida.')
    if previous and previous.get('note'):
        require(pid==previous.get('pid'),'O atendimento já possui relato vinculado.')
    if item.get('note'):
        require(pid,'Selecione a pessoa para registrar o relato.')
    if item['status']!='Cancelado':
        for row in con.execute("SELECT body FROM records WHERE kind='agenda' AND id<>?", (item['id'],)):
            other=json.loads(row[0])
            if other['day']==day and other['status']!='Cancelado' and (other['owner'].strip().casefold()==owner or pid and other['pid']==pid):
                require(not (clock.fromisoformat(other['start'])<end and clock.fromisoformat(other['end'])>start),'Conflito de horário.',409)


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, data, mime='application/json', cookie=None):
        if not isinstance(data,bytes):
            data=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        for k,v in {'Content-Type':mime,'Content-Length':str(len(data)),'Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
                    'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"} .items():
            self.send_header(k,v)
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.end_headers()
        self.wfile.write(data)

    def dispatch(self,post=False):
        try:
            require(self.headers.get('Host')==ORIGIN.split('//')[1],'Host inválido.',403)
            path=urlsplit(self.path).path
            if not post and path in FILES:
                file,mime=FILES[path]
                return self.respond(200,(ROOT/file).read_bytes(),mime)
            body={}
            if post:
                require(self.headers.get('Origin')==ORIGIN,'Origem inválida.',403)
                require(self.headers.get_content_type()=='application/json','Formato inválido.',415)
                length=int(self.headers.get('Content-Length',0))
                require(0<length<=512000,'Requisição inválida.',413)
                body=json.loads(self.rfile.read(length))
                require(isinstance(body,dict),'Formato inválido.')
            with closing(connection()) as con, con:
                con.execute('BEGIN IMMEDIATE' if post else 'BEGIN')
                cookies=SimpleCookie(self.headers.get('Cookie',''))
                token=cookies['ogd'].value if 'ogd' in cookies else ''
                key=hashlib.sha256(token.encode()).hexdigest()
                user=con.execute('SELECT u.id,name,email,role FROM users u JOIN sessions s ON uid=u.id WHERE token=? AND expires>? AND active=1',(key,int(time.time()))).fetchone()
                if path.startswith('/ficha-pdf/') and not post:
                    require(user,'Entre para acessar a ficha.',401)
                    require('pessoas' in ROLES[user['role']],'Acesso restrito.',403)
                    pid=unquote(path[len('/ficha-pdf/'):])
                    row=con.execute("SELECT body FROM records WHERE kind='pessoas' AND id=?",(pid,)).fetchone()
                    require(row,'Ficha inexistente.',404)
                    person=json.loads(row[0])
                    events=[json.loads(r[0]) for r in con.execute("SELECT body FROM records WHERE kind='agenda' AND json_extract(body,'$.pid')=?",(pid,))]
                    try:
                        from ficha_pdf import generate
                    except ModuleNotFoundError:
                        raise Problem(503,'Instale as dependências do PDF conforme o README.')
                    return self.respond(200,generate(person,events,signo(person.get('nasc'))),'application/pdf')
                result,cookie=self.route(con,path,post,body,user,key)
            self.respond(200,result,cookie=cookie)
        except Problem as exc:
            self.respond(exc.status,{'error':str(exc)})
        except sqlite3.IntegrityError:
            self.respond(409,{'error':'Registro já existente.'})
        except (KeyError,ValueError,TypeError,AttributeError):
            self.respond(400,{'error':'Dados inválidos.'})

    def route(self,con,path,post,b,user,key):
        now=int(time.time())
        exists=con.execute('SELECT 1 FROM users LIMIT 1').fetchone()
        if path=='/session' and not post:
            return {'setup':not exists,'user':dict(user) if user else None},None
        if post and path in ('/setup','/login'):
            if path=='/setup':
                require(not exists,'A instalação já possui administrador.',409)
                name,email,pwd=account(b)
                uid=con.execute("INSERT INTO users(name,email,password,role) VALUES (?,?,?,'Administrador')",(name,email,pwd)).lastrowid
            else:
                con.execute('DELETE FROM attempts WHERE ts<?',(now-300,))
                require(con.execute('SELECT count(*) FROM attempts').fetchone()[0]<10,'Aguarde cinco minutos antes de tentar novamente.',429)
                row=con.execute('SELECT * FROM users WHERE email=? AND active=1',(str(b.get('email','')).strip().lower(),)).fetchone()
                if not row or not check_password(b.get('password'),row['password']):
                    con.execute('INSERT INTO attempts VALUES (?)',(now,))
                    con.commit()
                    raise Problem(401,'E-mail ou senha inválidos.')
                uid=row['id']
            token=secrets.token_urlsafe(32)
            con.execute('DELETE FROM sessions WHERE expires<=?',(now,))
            con.execute('INSERT INTO sessions VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),uid,now+28800))
            con.execute('INSERT INTO audit(ts,uid,action,target) VALUES (?,?,?,?)',(now,uid,'Entrada no sistema',''))
            return {},'ogd='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800'
        require(user,'Entre para acessar a secretaria.',401)
        uid,role=user['id'],user['role']
        if path=='/senha' and post:
            stored=con.execute('SELECT password FROM users WHERE id=?',(uid,)).fetchone()[0]
            require(check_password(b.get('atual'),stored),'Senha atual incorreta.',400)
            password=b.get('nova','')
            require(isinstance(password,str) and 12<=len(password)<=256,'Use de 12 a 256 caracteres.')
            con.execute('UPDATE users SET password=? WHERE id=?',(hash_password(password),uid))
            con.execute('DELETE FROM sessions WHERE uid=? AND token<>?',(uid,key))
            con.execute('INSERT INTO audit(ts,uid,action,target) VALUES (?,?,?,?)',(now,uid,'Alteração de senha',''))
            return {},None
        if path=='/logout' and post:
            con.execute('DELETE FROM sessions WHERE token=?',(key,))
            return {},'ogd=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
        if path=='/dados' and not post:
            data={k:[] for k in KINDS}
            for row in con.execute('SELECT kind,body FROM records ORDER BY rowid'):
                if row['kind'] in ROLES[role]:
                    data[row['kind']].append(json.loads(row['body']))
                elif role=='Financeiro' and row['kind']=='pessoas':
                    p=json.loads(row['body'])
                    data['pessoas'].append({'id':p['id'],'nome':p['nome']})
            return {'data':data},None
        if path=='/registro' and post:
            kind,item=b['kind'],b['item']
            require(kind in ROLES[role],'Acesso restrito.',403)
            require(isinstance(item,dict) and isinstance(item.get('id'),str) and 0<len(item['id'])<=128,'Identificador inválido.')
            row=con.execute('SELECT body FROM records WHERE kind=? AND id=?',(kind,item['id'])).fetchone()
            previous=json.loads(row[0]) if row else None
            require(previous==b['previous'],'Registro alterado por outra pessoa. Reabra a ficha.',409)
            validate(con,kind,item,previous)
            con.execute('INSERT OR REPLACE INTO records VALUES (?,?,?)',(kind,item['id'],json.dumps(item,ensure_ascii=False)))
            target=item['id']
            action=('Alteração' if row else 'Inclusão')+' · '+kind
        elif path in ('/equipe','/atividade','/usuario'):
            require(role=='Administrador','Acesso restrito.',403)
            if path=='/equipe' and not post:
                return [dict(r) for r in con.execute('SELECT id,name,email,role,active FROM users ORDER BY name')],None
            if path=='/atividade' and not post:
                return [dict(r) for r in con.execute('SELECT ts,name,action,target FROM audit JOIN users ON users.id=uid ORDER BY audit.id DESC LIMIT 100')],None
            require(path=='/usuario' and post,'Recurso inexistente.',404)
            if 'id' in b:
                require(b['id']!=uid,'Sua própria conta deve permanecer ativa.')
                require(type(b.get('active')) is bool,'Estado inválido.')
                require(con.execute('UPDATE users SET active=? WHERE id=?',(b['active'],b['id'])).rowcount,'Usuário inexistente.',404)
                con.execute('DELETE FROM sessions WHERE uid=?',(b['id'],))
                target=str(b['id'])
                action='Conta ativada' if b['active'] else 'Conta desativada'
            else:
                name,email,pwd=account(b)
                require(b['role'] in ROLES,'Perfil inválido.')
                target=str(con.execute('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)',(name,email,pwd,b['role'])).lastrowid)
                action='Criação de conta'
        else:
            raise Problem(404,'Recurso inexistente.')
        con.execute('INSERT INTO audit(ts,uid,action,target) VALUES (?,?,?,?)',(now,uid,action,target))
        return {},None

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch(True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--redefinir-senha',metavar='EMAIL')
    parser.add_argument('--sem-navegador',action='store_true')
    args=parser.parse_args()
    initialize()
    if args.redefinir_senha:
        password=getpass.getpass('Nova senha (mínimo 12 caracteres): ')
        if len(password)<12 or len(password)>256:
            parser.error('Senha inválida.')
        with closing(connection()) as con, con:
            row=con.execute('SELECT id FROM users WHERE email=?',(args.redefinir_senha.strip().lower(),)).fetchone()
            if not row:
                parser.error('Usuário inexistente.')
            con.execute('UPDATE users SET password=? WHERE id=?',(hash_password(password),row['id']))
            con.execute('DELETE FROM sessions WHERE uid=?',(row['id'],))
    else:
        server=ThreadingHTTPServer(('127.0.0.1',8765),Handler)
        print('Secretaria do templo: '+ORIGIN,flush=True)
        if not args.sem_navegador:
            threading.Timer(.5,lambda:webbrowser.open(ORIGIN)).start()
        server.serve_forever()
