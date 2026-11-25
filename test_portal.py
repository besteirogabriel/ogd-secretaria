from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from http.client import HTTPConnection
import json
from unittest import TestCase
import iniciar as app
import test_secretaria


class PortalTest(TestCase):
    def setUp(self):
        self.h=test_secretaria.SecretariaTest('test_workflow')
        self.h.setUp()
        self.addCleanup(self.h.doCleanups)

    def test_reservas(self):
        h=self.h
        h.request('/inscricao',{},409)
        h.request('/setup',dict(name='Direção',email='direcao@example.org',password='senha-testes-123'))
        admin=h.cookie
        rule=dict(title='Acolhimento',owner='Responsável',room='Sala 1',duration=30,horizon=4,notice=0,
                  start='09:00',end='12:00',days=list(range(7)),blocked=[],active=True)
        h.request('/publicacao',rule)
        slots=h.request('/horarios')['slots']
        self.assertTrue(slots)
        cookies=[]
        for i in range(2):
            h.cookie=''
            h.request('/inscricao',dict(name='Aluno '+str(i),email=f'aluno{i}@example.org',password='senha-testes-123',tel='54999999999'))
            cookies.append(h.cookie)
            h.request('/dados',status=403)
            h.request('/ficha-pdf/legado',status=403)
            h.request('/publicacao',rule,403)
        def reserve(cookie):
            c=HTTPConnection('127.0.0.1',h.port)
            c.request('POST','/reservar',json.dumps(slots[0]),{'Cookie':cookie,'Origin':app.ORIGIN,'Content-Type':'application/json'})
            r=c.getresponse();code=r.status;body=json.loads(r.read());c.close()
            return code,body
        with ThreadPoolExecutor(2) as pool:
            result=list(pool.map(reserve,cookies))
        self.assertEqual(sorted(x[0] for x in result),[200,409])
        winner=next(i for i,x in enumerate(result) if x[0]==200)
        event=result[winner][1]
        h.cookie=cookies[1-winner]
        h.request('/reservar',dict(id=event['id'],cancel=True),404)
        self.assertEqual(h.request('/minhas-reservas'),[])
        self.assertNotIn(slots[0],h.request('/horarios?reserva='+event['id'])['slots'])
        h.cookie=cookies[winner]
        self.assertIn(slots[0],h.request('/horarios?reserva='+event['id'])['slots'])
        self.assertEqual(h.request('/minhas-reservas')[0]['id'],event['id'])
        self.assertNotIn('note',h.request('/minhas-reservas')[0])
        new=h.request('/horarios')['slots'][0]
        h.request('/reservar',{**new,'id':event['id']})
        h.cookie=admin
        occupied=next(e for e in h.request('/dados')['data']['agenda'] if e['id']==event['id'])
        collision=dict(occupied,id='manual',pid='',owner='Outra profissional',source='Secretaria')
        response=h.request('/registro',dict(kind='agenda',item=collision,previous=None),409)
        self.assertIn('sala',response['error'])
        h.cookie=cookies[winner]
        h.request('/reservar',dict(id=event['id'],cancel=True))
        self.assertIn(new,h.request('/horarios')['slots'])
        h.cookie=admin
        config=h.request('/publicacao')['rules'][0]
        h.request('/publicacao',{**config,'previous':config,'blocked':[new['day']]})
        self.assertFalse(any(s['day']==new['day'] for s in h.request('/horarios')['slots']))
        people=h.request('/dados')['data']['pessoas']
        self.assertEqual(len(next(p for p in people if p.get('email')=='aluno0@example.org')['map']),13)

    def test_origem_publica(self):
        h=self.h
        old=app.PUBLIC
        app.PUBLIC='https://agenda.example.org'
        self.addCleanup(setattr,app,'PUBLIC',old)
        credentials=dict(name='Direção',email='teste@example.org',password='senha-testes-123')
        def post(path,origin):
            con=HTTPConnection('127.0.0.1',h.port)
            con.request('POST',path,json.dumps(credentials),{'Host':'agenda.example.org','Origin':origin,'Content-Type':'application/json'})
            response=con.getresponse()
            result=response.status,response.getheader('Set-Cookie')
            response.read()
            con.close()
            return result
        self.assertEqual(post('/setup',app.PUBLIC)[0],403)
        h.request('/setup',credentials)
        self.assertEqual(h.request('/publicacao')['url'],app.PUBLIC+'/agendar')
        self.assertEqual(post('/login','https://outro.example.org')[0],403)
        status,cookie=post('/login',app.PUBLIC)
        self.assertEqual(status,200)
        self.assertIn('Secure',cookie)
