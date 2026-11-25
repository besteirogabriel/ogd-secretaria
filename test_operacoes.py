"""Fluxos transacionais entre agenda, financeiro, estoque e ensino."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from http.client import HTTPConnection
import json
from unittest import TestCase

import iniciar
import operacoes
import reservas
import test_secretaria


class OperacoesTest(TestCase):
    def setUp(self):
        self.api = test_secretaria.SecretariaTest('test_workflow')
        self.api.setUp()
        self.addCleanup(self.api.doCleanups)
        self.admin = dict(name='Secretaria de teste',email='admin@example.org',password='senha-teste-12345')
        self.api.request('/setup', self.admin)
        self.admin_cookie = self.api.cookie
        self.now = reservas.current().date()
        for key in ('ana','bia','caio'):
            self.write('pessoas',dict(id=key,nome=key.title(),tipo='Aluno',analysis={},map=[
                {'label':label} for label in reservas.POSITIONS
            ]))

    def operations(self, op, http_status=200, **body):
        return self.api.request('/operacao',dict(body,op=op),http_status)

    def data(self, kind):
        return self.api.request('/dados')['data'][kind]

    def write(self, kind, item, previous=None, status=200):
        return self.api.request('/registro',dict(kind=kind,item=item,previous=previous),status)

    def linked(self, kind, identifier):
        return next(x for x in self.data('contas') if x.get('origin_kind')==kind and x['origin_id']==identifier)

    def get_pdf(self, path, status=200):
        conn=HTTPConnection('127.0.0.1',self.api.port)
        conn.request('GET',path,headers={'Cookie':self.api.cookie})
        response=conn.getresponse()
        data=response.read()
        self.assertEqual(response.status,status,data[:500])
        if status==200:
            self.assertEqual(response.getheader('Content-Type'),'application/pdf')
            self.assertTrue(data.startswith(b'%PDF-'))
        conn.close()

    def test_atendimento_ajuste_pagamento_e_cancelamento(self):
        event=dict(id='consulta',pid='ana',title='Atendimento',owner='Responsável',room='Sala',
                   day=self.now.isoformat(),start='10:00',end='11:00',status='Agendado',fee=10000,due_days=2)
        self.write('agenda',event)
        self.write('agenda',event,status=409)
        bill=self.linked('agenda',event['id'])
        self.assertEqual(bill['cents'],10000)
        self.assertEqual(bill['billing_state'],'draft')
        self.assertEqual(bill['due'],(self.now+timedelta(days=2)).isoformat())
        # A remarcação atualiza a data automática. Uma data editada no financeiro é preservada.
        rescheduled=dict(event,day=(self.now+timedelta(days=4)).isoformat())
        self.write('agenda',rescheduled,event)
        after=self.linked('agenda',event['id'])
        self.assertEqual(after['id'],bill['id'])
        self.assertEqual(after['due'],(self.now+timedelta(days=6)).isoformat())
        due=(self.now+timedelta(days=9)).isoformat()
        edited=dict(after, gross=10000,discount=1000,cents=9000,due=due)
        self.write('contas',edited,after)
        self.assertFalse(self.linked('agenda',event['id'])['auto_due'])
        new=dict(rescheduled,day=(self.now+timedelta(days=5)).isoformat())
        self.write('agenda',new,rescheduled)
        edited=self.linked('agenda',event['id'])
        self.assertEqual(edited['due'],due)
        self.operations('approve',id=edited['id'],previous=edited)
        edited=self.linked('agenda',event['id'])
        self.operations('pay',id=edited['id'],previous=edited,amount=3000,date=self.now.isoformat(),method='Pix',reference='Teste')
        partial=self.linked('agenda',event['id'])
        self.assertEqual(operacoes.bill_state(partial),'partial')
        self.operations('pay',400,id=partial['id'],previous=partial,amount=6001,date=self.now.isoformat(),method='Pix')
        payment=partial['payments'][0]
        path=f"/documentos/recibo/{partial['id']}/{payment['id']}"
        self.get_pdf(path)
        self.write('agenda',dict(new,status='Cancelado'),new)
        reviewed=self.linked('agenda',event['id'])
        self.assertTrue(reviewed['review'])
        self.assertEqual(operacoes.received(reviewed),3000)
        self.operations('reverse',id=reviewed['id'],previous=reviewed,payment=payment['id'],reason='Cancelado')
        self.assertEqual(operacoes.bill_state(self.linked('agenda',event['id'])),'void')
        self.get_pdf(path,404)
        self.assertEqual(len(self.data('contas')),1)
        # Gratuito, atividade interna, e vínculo a uma cobrança existente.
        self.write('agenda',dict(event,id='gratuito',free=True,start='11:00',end='12:00'))
        self.write('agenda',dict(event,id='interno',pid='',start='12:00',end='13:00'))
        invoice=dict(id='manual',tipo='A receber',descricao='Histórico',pid='bia',cents=5000,due=due)
        self.write('contas',invoice)
        old=dict(event,id='antigo',pid='bia',start='13:00',end='14:00')
        with iniciar.connection() as con:
            operacoes.store(con,'agenda',old)
        self.operations('vincular',event=old['id'],bill=invoice['id'])
        self.assertEqual(self.linked('agenda',old['id'])['id'],'manual')
        self.assertEqual(len(self.data('contas')),2)

    def test_portal_cria_cobranca_sem_expor_rascunho_ou_outro_aluno(self):
        self.api.request('/publicacao',dict(title='Escuta',owner='Direção',room='Sala',
            days=list(range(7)),horizon=3,notice=0,duration=30,start='08:00',end='12:00',
            fee_cents=8500,due_days=3,active=True))
        invited=self.api.request('/horarios')['slots'][0]
        self.api.cookie=''
        self.api.request('/inscricao',dict(name='Participante',email='aluno@example.org',tel='54999999999',
                                             password='senha-aluno-12345'))
        token=self.api.cookie
        result=self.api.request('/reservar',dict(invited,fee=15))
        self.assertEqual(self.api.request('/minhas-cobrancas'),[])
        self.api.cookie=self.admin_cookie
        bill=self.linked('agenda',result['id'])
        self.assertEqual(bill['cents'],8500)
        self.assertEqual(bill['due'],(date.fromisoformat(invited['day'])+timedelta(days=3)).isoformat())
        self.operations('approve',id=bill['id'],previous=bill)
        self.api.cookie=token
        bills=self.api.request('/minhas-cobrancas')
        self.assertEqual([bill['id']],[item['id'] for item in bills])
        self.assertNotIn('payments',bills[0])
        self.get_pdf('/documentos/recibo/'+bill['id']+'/unauthorized',403)
        self.api.request('/reservar',dict(id=result['id'],cancel=True))
        self.assertEqual(self.api.request('/minhas-cobrancas'),[])

    def test_estoque_concorrente_contagem_e_estorno(self):
        obj=self.operations('produto',name='Material',sku='MT-01',unit='un',category='Aula',
                            minimum=2000,cost=500,location='Prateleira 1',active=True)
        item=obj['id']
        self.operations('produto',409,name='Duplicado',sku='MT-01',unit='un',minimum=0,cost=0,active=True)
        self.operations('estoque',product=item,movement='entrada',operation_id='entrada1',quantity=6000,reason='Compra')
        self.operations('estoque',409,product=item,movement='entrada',operation_id='entrada1',quantity=6000,reason='Repetição')
        self.write('agenda',dict(id='sessao',pid='',title='Aula',owner='Secretaria',day=self.now.isoformat(),
                                 start='12:00',end='13:00',status='Realizado'))

        def withdraw(n):
            conn=HTTPConnection('127.0.0.1',self.api.port)
            headers={'Origin':iniciar.ORIGIN,'Content-Type':'application/json','Cookie':self.admin_cookie}
            conn.request('POST','/operacao',json.dumps(dict(op='estoque',product=item,movement='saida',
                operation_id='saida'+str(n),quantity=4000,event='sessao',reason='Uso em aula')),headers)
            res=conn.getresponse()
            res.read()
            conn.close()
            return res.status

        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(withdraw,(1,2))),[200,409])
        self.assertEqual(self.data('produtos')[0]['balance'],2000)
        self.operations('estoque',409,product=item,movement='contagem',operation_id='cont1',quantity=1000,
                        expected_balance=6000,reason='Inventário')
        self.operations('estoque',product=item,movement='contagem',operation_id='cont1',quantity=1000,
                        expected_balance=2000,reason='Inventário confirmado')
        self.operations('estoque',product=item,movement='estorno',operation_id='est1',reverse='cont1',reason='Recontagem')
        self.operations('estoque',409,product=item,movement='estorno',operation_id='est2',reverse='cont1',reason='Repetido')
        self.assertEqual(self.data('produtos')[0]['balance'],2000)
        self.assertEqual(next(m for m in self.data('movimentos') if m['id']=='cont1')['reversed_by'],'est1')

    def test_turmas_matricula_espera_transferencia_serie_chamada_pdf(self):
        course=self.operations('curso',title='Curso de formação',hours=20,minimum=75,syllabus='Prática e teoria',active=True)['id']
        class_defaults=dict(course_id=course,teacher='Instrutor',room='Sala',start=(self.now-timedelta(days=7)).isoformat(),
                            end=(self.now+timedelta(days=35)).isoformat(),capacity=1,fee=15000,status='Aberta')
        first=self.operations('turma',**class_defaults,title='Turma A')['id']
        second=self.operations('turma',**class_defaults,title='Turma B')['id']
        a=self.operations('matricula',class_id=first,pid='ana',status='Matriculada')['id']
        self.operations('matricula',409,class_id=first,pid='bia',status='Matriculada')
        self.operations('matricula',class_id=first,pid='bia',status='Em espera')
        original=next(m for m in self.data('matriculas') if m['id']==a)
        dest=self.operations('transferir',id=a,previous=original,target=second)['id']
        self.assertEqual(self.linked('matricula',a)['billing_state'],'void')
        self.assertEqual(self.linked('matricula',dest)['cents'],15000)
        wait=next(m for m in self.data('matriculas') if m['pid']=='bia')
        self.operations('matricula',class_id=first,pid='bia',status='Matriculada',previous=wait)
        # A primeira aula da série é válida, mas a segunda conflita. Nenhuma é gravada.
        clash=dict(id='ocupada',title='Conflito de teste',pid='',owner='Outro',room='Sala',day=self.now.isoformat(),
                   start='19:00',end='20:00',status='Agendado')
        self.write('agenda',clash)
        lesson=dict(class_id=first,title='Módulo',day=class_defaults['start'],
                    start='19:00',end_time='20:00',count=2,operation_id='serie')
        self.operations('aulas',409,**lesson)
        self.assertEqual(len(self.data('agenda')),1)
        self.write('agenda',dict(clash,status='Cancelado'),clash)
        self.operations('aulas',**lesson)
        events=[e for e in self.data('agenda') if e.get('class_id')==first]
        self.assertEqual(len(events),2)
        for event in events:
            self.operations('chamada',id=event['id'],previous=event,attendance={'bia':'Presente'})
        entry=next(m for m in self.data('matriculas') if m['pid']=='bia')
        self.operations('matricula',class_id=first,pid='bia',status='Concluída',previous=entry)
        self.get_pdf('/documentos/conclusao/'+entry['id'])
        self.assertFalse(any(c.get('origin_kind')=='agenda' for c in self.data('contas')))
        staff=dict(self.admin,email='atendimento@example.org',role='Atendimento')
        self.api.request('/usuario',staff)
        self.api.request('/login',staff)
        self.assertEqual(self.data('contas'),[])
        self.assertEqual(len(self.data('turmas')),2)
        self.operations('produto',403,name='Sem acesso',sku='403')
