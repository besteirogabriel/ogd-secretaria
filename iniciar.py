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
from datetime import date, datetime, time as clock
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import operacoes
import reservas
from signos import signo
from urllib.parse import parse_qs, urlsplit, unquote

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('OGD_DATA', ROOT / 'dados')).resolve()
LEGACY_KINDS = ('pessoas', 'agenda', 'contas')
ACADEMIC = ('cursos', 'turmas', 'matriculas')
KINDS = LEGACY_KINDS + ACADEMIC + ('produtos', 'movimentos')
ROLES = {'Administrador': KINDS, 'Atendimento': ('pessoas', 'agenda') + ACADEMIC, 'Financeiro': ('contas',)}
FILES = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'),
         '/interface.css': ('interface.css', 'text/css'), '/mapa.png': ('mapa.png', 'image/png'),
         '/marca.svg': ('Grenze_vermelho/Assinatura_horizontal.svg', 'image/svg+xml'),
         '/alegreya.ttf': ('Grenze_vermelho/Fontes/Alegreya.ttf', 'font/ttf')}
FILES['/operacoes.js'] = ('operacoes.js', 'text/javascript')
ORIGIN = 'http://127.0.0.1:8765'
PUBLIC = os.environ.get('OGD_PUBLIC_ORIGIN','').rstrip('/')
if PUBLIC and (urlsplit(PUBLIC).scheme!='https' or not urlsplit(PUBLIC).hostname or urlsplit(PUBLIC).path or urlsplit(PUBLIC).query or urlsplit(PUBLIC).fragment or urlsplit(PUBLIC).username):
    raise ValueError('OGD_PUBLIC_ORIGIN deve ser uma origem HTTPS sem caminho.')
FILES.update({'/agendar':('portal.html','text/html; charset=utf-8'),'/portal.js':('portal.js','text/javascript'),'/portal.css':('portal.css','text/css'),'/publicacao.js':('publicacao.js','text/javascript')})


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
            'CREATE TABLE IF NOT EXISTS portal_people (uid INTEGER PRIMARY KEY, pid TEXT UNIQUE NOT NULL)',
            'CREATE TABLE IF NOT EXISTS throttle (key TEXT, ts INTEGER)',
            'CREATE INDEX IF NOT EXISTS throttle_key ON throttle(key,ts)',
            'CREATE TABLE IF NOT EXISTS book_rules (id TEXT PRIMARY KEY, body TEXT NOT NULL)',
            '''CREATE UNIQUE INDEX IF NOT EXISTS bills_by_origin ON records(
                   json_extract(body,'$.origin_kind'), json_extract(body,'$.origin_id')
               ) WHERE kind='contas' AND json_extract(body,'$.origin_id') IS NOT NULL''',
            'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
        ):
            con.execute(sql)
        if not con.execute("SELECT 1 FROM settings WHERE key='migration'").fetchone():
            legacy = ROOT / 'templo.sqlite3'
            if legacy.exists():
                with closing(sqlite3.connect(legacy.as_uri()+'?mode=ro', uri=True)) as old:
                    row = old.execute('SELECT dados FROM gestao WHERE id=1').fetchone()
                    data = json.loads(row[0])
                    for kind in LEGACY_KINDS:
                        for item in data[kind]:
                            con.execute('INSERT INTO records VALUES (?,?,?)', (kind,item['id'],json.dumps(item)))
            con.execute("INSERT INTO settings VALUES ('migration','1')")


def throttle(con, key, limit, window):
    now=int(time.time())
    con.execute('DELETE FROM throttle WHERE ts<?',(now-3600,))
    count=con.execute('SELECT count(*) FROM throttle WHERE key=? AND ts>?',(key,now-window)).fetchone()[0]
    require(count<limit,'Muitas tentativas. Aguarde alguns minutos.',429)
    con.execute('INSERT INTO throttle VALUES (?,?)',(key,now))


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
        minimum=0 if item.get('billing_state') in ('draft','void') else 1
        require(item.get('tipo') in ('A pagar','A receber') and type(item.get('cents')) is int and minimum<=item['cents']<=9007199254740991,'Lançamento inválido.')
        gross,discount=item.get('gross'),item.get('discount',0)
        if gross is not None:
            require(type(gross) is int and type(discount) is int and 0<=discount<=gross
                    and gross-discount==item['cents'],'Confira o valor original e o desconto.')
        operacoes.validate_bill_edit(item,previous,require)
        return
    fee=item.get('fee')
    if fee is not None:
        operacoes.number(item,'fee',0,10**10,require)
    if 'due_days' in item:
        operacoes.number(item,'due_days',0,365,require)
    if item.get('class_id'):
        klass=operacoes.existing(con,'turmas',item['class_id'],require)
        require(not pid and klass['start']<=item.get('day','')<=klass['end'],'A aula precisa ficar dentro do período da turma.')
    if previous:
        require(item.get('class_id')==previous.get('class_id'),'A turma da aula não pode mudar.')
        require(item.get('attendance')==previous.get('attendance'),'Use a chamada para alterar presenças.')
        linked=operacoes.linked_bill(con,'agenda',item['id'])
        require(not linked or pid==previous.get('pid'),'O participante está vinculado a uma cobrança.')
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
    if item.get('arrived_at'):
        datetime.fromisoformat(item['arrived_at'].replace('Z','+00:00'))
    room=str(item.get('room') or '').strip().casefold()
    if item['status']!='Cancelado':
        for row in con.execute("SELECT body FROM records WHERE kind='agenda' AND id<>?", (item['id'],)):
            other=json.loads(row[0])
            if other['day']!=day or other['status']=='Cancelado':
                continue
            if clock.fromisoformat(other['start'])>=end or clock.fromisoformat(other['end'])<=start:
                continue
            conflict = (
                ('responsável' if other['owner'].strip().casefold()==owner else '') or
                ('participante' if pid and other['pid']==pid else '') or
                ('sala' if room and str(other.get('room') or '').strip().casefold()==room else '')
            )
            require(not conflict,'Conflito de horário para: '+conflict+'.',409)


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
            host=self.headers.get('Host')
            public_request=bool(PUBLIC and host==urlsplit(PUBLIC).netloc)
            expected=PUBLIC if public_request else ORIGIN
            require(host==urlsplit(expected).netloc,'Host inválido.',403)
            path=urlsplit(self.path).path
            if public_request and path=='/setup':
                raise Problem(403,'Inicialize o administrador no servidor local.')
            if not post and path in FILES:
                file,mime=FILES[path]
                return self.respond(200,(ROOT/file).read_bytes(),mime)
            body={}
            if post:
                require(self.headers.get('Origin')==expected,'Origem inválida.',403)
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
                    require('pessoas' in ROLES.get(user['role'],()),'Acesso restrito.',403)
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
                if not post and path.startswith('/documentos/'):
                    return self.respond(200,self.document(con,user,path),'application/pdf')
                result,cookie=self.route(con,path,post,body,user,key)
            self.respond(200,result,cookie=cookie+'; Secure' if public_request and cookie else cookie)
        except Problem as exc:
            self.respond(exc.status,{'error':str(exc)})
        except sqlite3.IntegrityError:
            self.respond(409,{'error':'Registro já existente.'})
        except (KeyError,ValueError,TypeError,AttributeError):
            self.respond(400,{'error':'Dados inválidos.'})

    def document(self, con, user, path):
        require(user,'Entre para acessar este documento.',401)
        _,_,kind,record_id,*extra=path.split('/')
        role=ROLES.get(user['role'],())
        require((kind=='recibo' and 'contas' in role) or
                (kind=='conclusao' and 'matriculas' in role),'Acesso restrito.',403)
        try:
            import documentos_operacionais as pdf
        except ModuleNotFoundError:
            raise Problem(503,'Instale as dependências do PDF conforme o README.')
        if kind=='recibo':
            bill=operacoes.existing(con,'contas',record_id,require)
            require(len(extra)==1,'Informe a baixa.')
            payment=next((p for p in bill.get('payments',[]) if p['id']==extra[0] and not p.get('reversed')),None)
            require(payment,'Baixa não encontrada ou estornada.',404)
            return pdf.receipt(bill,payment,operacoes.find(con,'pessoas',bill.get('pid')))
        require(not extra,'Documento inválido.',404)
        enrollment=operacoes.existing(con,'matriculas',record_id,require)
        require(enrollment['status']=='Concluída' and enrollment.get('completion'),'Matrícula sem conclusão.',404)
        return pdf.declaration(enrollment,operacoes.existing(con,'pessoas',enrollment['pid'],require),
                               operacoes.existing(con,'turmas',enrollment['class_id'],require))

    def route(self,con,path,post,b,user,key):
        now=int(time.time())
        exists=con.execute('SELECT 1 FROM users LIMIT 1').fetchone()
        if path=='/session' and not post:
            return {'setup':not exists,'user':dict(user) if user else None},None
        if path=='/horarios' and not post:
            link=con.execute('SELECT pid FROM portal_people WHERE uid=?',(user['id'],)).fetchone() if user else None
            pid=link[0] if link else None
            requested=parse_qs(urlsplit(self.path).query).get('reserva',[''])[0]
            allowed=reservas.reschedulable(con,requested,pid) if pid and requested else None
            slots=reservas.slots(con,pid=pid,ignore_id=allowed['id'] if allowed else None)
            if allowed:
                slots=[dict(slot,fee=allowed.get('fee'),free=allowed.get('free',False))
                       for slot in slots if slot['rule']==allowed.get('rule')]
            return {'slots':slots},None
        if post and path in ('/setup','/login','/inscricao'):
            if path=='/inscricao':
                require(exists,'A secretaria ainda não abriu os cadastros.',409)
                throttle(con,'signup:'+self.client_address[0],30,3600)
                name,email,pwd=account(b)
                person=reservas.new_person(name,email,b,require)
                uid=con.execute("INSERT INTO users(name,email,password,role) VALUES (?,?,?,'Participante')",(name,email,pwd)).lastrowid
                con.execute('INSERT INTO portal_people VALUES (?,?)',(uid,person['id']))
                con.execute("INSERT INTO records VALUES ('pessoas',?,?)",(person['id'],json.dumps(person)))
            elif path=='/setup':
                require(not exists,'A instalação já possui administrador.',409)
                name,email,pwd=account(b)
                uid=con.execute("INSERT INTO users(name,email,password,role) VALUES (?,?,?,'Administrador')",(name,email,pwd)).lastrowid
            else:
                email_key='login:'+str(b.get('email','')).strip().lower()[:254]
                throttle(con,email_key,10,300)
                row=con.execute('SELECT * FROM users WHERE email=? AND active=1',(str(b.get('email','')).strip().lower(),)).fetchone()
                if not row or not check_password(b.get('password'),row['password']):
                    con.commit()
                    raise Problem(401,'E-mail ou senha inválidos.')
                uid=row['id']
                con.execute('DELETE FROM throttle WHERE key=?',(email_key,))
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
        if path in ('/minhas-reservas','/reservar','/minhas-cobrancas'):
            require(role=='Participante','Use uma conta de aluno ou cliente.',403)
            pid=con.execute('SELECT pid FROM portal_people WHERE uid=?',(uid,)).fetchone()[0]
            if path=='/minhas-cobrancas' and not post:
                return [{
                    'id':bill['id'],'descricao':bill['descricao'],'due':bill['due'],
                    'cents':bill['cents'],'received':operacoes.received(bill),'state':operacoes.bill_state(bill)
                } for bill in operacoes.records(con,'contas')
                    if bill.get('pid')==pid and bill.get('origin_id') and not bill.get('review')
                    and operacoes.bill_state(bill) not in ('draft','void')],None
            if path=='/minhas-reservas' and not post:
                return reservas.own(con,pid),None
            require(path=='/reservar' and post,'Operação inválida.')
            event=reservas.book(con,pid,b,require,validate)
            operacoes.sync_visit(con,event)
            item={k:event[k] for k in ('id','title','day','start','end','status')}
            con.execute('INSERT INTO audit(ts,uid,action,target) VALUES (?,?,?,?)',(now,uid,'Reserva · '+item['status'],item['id']))
            return item,None
        require(role in ROLES,'Acesso exclusivo da secretaria.',403)
        if path=='/publicacao':
            require(role in ('Administrador','Atendimento'),'Acesso restrito.',403)
            if post:
                rule=reservas.configure(con,b,require)
                con.execute('INSERT INTO audit(ts,uid,action,target) VALUES (?,?,?,?)',
                            (now,uid,'Disponibilidade · '+('Publicada' if rule['active'] else 'Pausada'),rule['id']))
            return {'rules':reservas.rules(con),'url':(PUBLIC or ORIGIN)+'/agendar','external':bool(PUBLIC)},None
        if path=='/dados' and not post:
            data={k:[] for k in KINDS}
            for row in con.execute('SELECT kind,body FROM records ORDER BY rowid'):
                if row['kind'] in ROLES[role]:
                    data[row['kind']].append(json.loads(row['body']))
                elif role=='Financeiro' and row['kind']=='pessoas':
                    p=json.loads(row['body'])
                    data['pessoas'].append({'id':p['id'],'nome':p['nome']})
            if role=='Atendimento':
                data['cobrancas_agenda']=[{'origin_id':b['origin_id'],'state':operacoes.bill_state(b)}
                    for b in operacoes.records(con,'contas') if b.get('origin_kind')=='agenda']
            return {'data':data},None
        if path=='/operacao' and post:
            operation=b.get('op')
            handlers={
                'produto':('produtos',operacoes.save_product),
                'estoque':('produtos',lambda c,v,r:operacoes.move_stock(c,v,r,user['name'])),
                'curso':('cursos',operacoes.save_course),
                'turma':('turmas',operacoes.save_class),
                'matricula':('matriculas',operacoes.enroll),
                'transferir':('matriculas',operacoes.transfer),
                'aulas':('turmas',lambda c,v,r:operacoes.schedule_lessons(c,v,r,validate)),
                'chamada':('turmas',operacoes.take_attendance),
                'vincular':('contas',operacoes.link_visit),
            }
            if operation in ('approve','void','reopen','pay','reverse'):
                handler=('contas',lambda c,v,r:operacoes.finance(c,operation,v,r))
            else:
                handler=handlers.get(operation)
            require(handler and handler[0] in ROLES[role],'Acesso restrito.',403)
            item=handler[1](con,b,require)
            con.execute('INSERT INTO audit(ts,uid,action,target) VALUES (?,?,?,?)',
                        (now,uid,'Operação · '+operation,item['id']))
            return {'id':item['id']},None
        if path=='/registro' and post:
            kind,item=b['kind'],b['item']
            require(kind in LEGACY_KINDS and kind in ROLES[role],'Acesso restrito.',403)
            require(isinstance(item,dict) and isinstance(item.get('id'),str) and 0<len(item['id'])<=128,'Identificador inválido.')
            row=con.execute('SELECT body FROM records WHERE kind=? AND id=?',(kind,item['id'])).fetchone()
            previous=json.loads(row[0]) if row else None
            require(previous==b['previous'],'Registro alterado por outra pessoa. Reabra a ficha.',409)
            validate(con,kind,item,previous)
            operacoes.store(con,kind,item)
            if kind=='agenda' and (not previous or 'fee' in item or
                    operacoes.linked_bill(con,'agenda',item['id'])):
                operacoes.sync_visit(con,item)
            target=item['id']
            action=('Alteração' if row else 'Inclusão')+' · '+kind
        elif path in ('/equipe','/atividade','/usuario'):
            require(role=='Administrador','Acesso restrito.',403)
            if path=='/equipe' and not post:
                return [dict(r) for r in con.execute("SELECT id,name,email,role,active FROM users WHERE role<>'Participante' ORDER BY name")],None
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
