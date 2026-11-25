import json
import shutil
import sqlite3
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
import iniciar as app


class SecretariaTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        original=(app.ROOT,app.DATA,app.ORIGIN)
        def restore():
            app.ROOT,app.DATA,app.ORIGIN=original
        self.addCleanup(restore)
        app.ROOT=Path(self.temp.name)
        app.DATA=app.ROOT/'dados'
        shutil.copyfile(original[0]/'templo.sqlite3',app.ROOT/'templo.sqlite3')
        with sqlite3.connect(app.ROOT/'templo.sqlite3') as db:
            db.execute('UPDATE gestao SET dados=?',(json.dumps(dict(pessoas=[{'id':'legado','nome':'Teste','map':[],'analysis':{}}],agenda=[],contas=[])),))
        app.initialize()
        app.initialize()
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        self.port=server.server_port
        app.ORIGIN=f'http://127.0.0.1:{self.port}'
        threading.Thread(target=server.serve_forever,daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.cookie=''

    def request(self,path,body=None,status=200,origin=None):
        conn=HTTPConnection('127.0.0.1',self.port)
        headers={'Origin':origin or app.ORIGIN,'Content-Type':'application/json','Cookie':self.cookie}
        conn.request('GET' if body is None else 'POST',path,None if body is None else json.dumps(body),headers)
        res=conn.getresponse()
        result=json.loads(res.read())
        self.assertEqual(res.status,status,result)
        if res.getheader('Set-Cookie'):
            self.cookie=res.getheader('Set-Cookie').split(';')[0]
        conn.close()
        return result

    def test_workflow(self):
        admin=dict(name='Admin',email='admin@example.org',password='teste-local-123')
        self.request('/dados',status=401)
        self.request('/setup',admin,403,'http://externo')
        self.request('/setup',admin)
        self.request('/setup',admin,409)
        self.assertEqual(len(self.request('/dados')['data']['pessoas']),1)
        for role in ('Atendimento','Financeiro'):
            self.request('/usuario',dict(admin,email=role+'@example.org',role=role))
        event=dict(id='e',owner='Responsável',pid='legado',title='Retorno',day='2026-11-25',start='09:00',end='10:00',status='Agendado')
        self.request('/registro',dict(kind='agenda',item=event,previous=None))
        self.request('/registro',dict(kind='agenda',item=dict(event,id='e2'),previous=None),409)
        updated=dict(event,status='Realizado',note='Relato de teste')
        self.request('/registro',dict(kind='agenda',item=updated,previous=event))
        self.request('/registro',dict(kind='agenda',item=event,previous=event),409)
        self.assertTrue(self.request('/atividade'))
        self.request('/logout',{})
        self.request('/login',dict(admin,password='errada'),401)
        self.request('/login',dict(admin,email='Financeiro@example.org'))
        data=self.request('/dados')['data']
        self.assertEqual(data['agenda'],[])
        self.assertEqual(set(data['pessoas'][0]),{'id','nome'})
        self.request('/equipe',status=403)
        self.request('/registro',dict(kind='agenda',item=updated,previous=updated),403)
        bill=dict(id='c',tipo='A receber',cents=1234,descricao='Aula',pid='legado',due='2026-11-25')
        self.request('/registro',dict(kind='contas',item=bill,previous=None))
        self.request('/registro',dict(kind='contas',item=dict(bill,paid='2026-11-25'),previous=bill))
        financial_cookie=self.cookie
        self.request('/login',dict(admin,email='Atendimento@example.org'))
        self.assertEqual(self.request('/dados')['data']['contas'],[])
        self.request('/login',admin)
        staff=self.request('/equipe')
        self.request('/usuario',{'id':next(x['id'] for x in staff if x['role']=='Financeiro'),'active':False})
        self.cookie=financial_cookie
        self.request('/dados',status=401)


if __name__=='__main__':
    unittest.main()
