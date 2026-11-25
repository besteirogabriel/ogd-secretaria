import unittest
from ficha_pdf import SpiritualMap, generate
from signos import signo


class FichaTest(unittest.TestCase):
    def test_datas(self):
        for day,expected in [('1997-11-19','Escorpião'),('2000-02-29','Peixes'),('2000-12-22','Capricórnio'),('2000-03-21','Áries'),('','')]:
            self.assertEqual(signo(day),expected)

    def test_mapa_ocupa_espaco(self):
        self.assertEqual(SpiritualMap([]).wrap(500,600),(420,267))

    def test_pdf_extenso(self):
        person={'nome':'Marília de Sá','nasc':'1997-11-19','map':[{'label':'Cabeça','obs':'Anotação individual. '*900}],'analysis':{'motivo':'Texto comprido. '*110}}
        event=dict(title='Atendimento individual',owner='Secretaria',start='10:00',end='11:00',status='Realizado',day='2026-11-21',note='Relato de acompanhamento. '*180+' FIM DO RELATO.')
        data=generate(person,[event],signo(person['nasc']))
        self.assertTrue(data.startswith(b'%PDF-'))
        self.assertGreater(data.count(b'/Type /Page\n'),2)
        return None
