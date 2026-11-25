"""Ficha institucional paginada em A4 retrato."""
from datetime import date
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, CondPageBreak, Table, TableStyle, Flowable

ROOT = Path(__file__).resolve().parent
pdfmetrics.registerFont(TTFont('Templo', str(ROOT/'Grenze_vermelho/Fontes/Alegreya.ttf')))
INK = colors.HexColor('#8f2028')
DARK = colors.HexColor('#302a27')


def format_date(value):
    return '.'.join(value.split('-')[::-1]) if value else ''


class SpiritualMap(Flowable):
    """Layout das treze posições do modelo do templo."""
    width,height=420,267
    points=((228,326),(228,383),(148,324),(312,323),(99,172),(350,175),(177,195),
            (274,201),(69,292),(126,410),(366,416),(185,442),(268,442))

    def __init__(self,slots):
        super().__init__()
        self.slots=slots
        self.width,self.height=420,267
        self.hAlign='CENTER'

    def draw(self):
        c=self.canv
        # Coordinates refer to the same 454 × 401 reference used in the editor.
        scale=0.66
        c.drawImage(str(ROOT/'mapa.png'),60,0,width=454*scale,height=401*scale,mask='auto')
        for (x,y),slot in zip(self.points,self.slots):
            if not slot.get('nome'):
                continue
            cx=60+x*scale
            cy=(531-y)*scale
            c.setFillColor(colors.white)
            c.rect(cx-29,cy-10,58,9,fill=1,stroke=0)
            c.setFont('Templo',7)
            c.setFillColor(INK)
            value=slot['nome']
            if pdfmetrics.stringWidth(value,'Templo',7)>56:
                while value and pdfmetrics.stringWidth(value+'…','Templo',7)>56:
                    value=value[:-1]
                value+='…'
            c.drawCentredString(cx,cy-8,value)


def generate(person, events, sign):
    stream = BytesIO()
    doc = SimpleDocTemplate(stream, pagesize=A4, leftMargin=46, rightMargin=46,
                            topMargin=100, bottomMargin=58, title='Ficha individual — '+person['nome'])
    story = []

    def para(value, size=12, color=DARK):
        text = escape(str(value)).replace('\n','<br/>')
        return Paragraph(text, ParagraphStyle('text',fontName='Templo',fontSize=size,
                         leading=size*1.33,textColor=color,alignment=TA_LEFT,splitLongWords=True))

    def heading(value):
        story.extend([CondPageBreak(80),Spacer(1,14),para(value,20,INK),Spacer(1,6)])

    def row(label,value):
        if value:
            story.extend([CondPageBreak(34),para(label,10,INK),para(value),Spacer(1,5)])

    def decorate(canvas, document):
        w,h=A4
        canvas.drawImage(str(ROOT/'marca_pdf.png'),46,h-70,width=190,height=46,mask='auto')
        canvas.setStrokeColor(INK)
        canvas.line(46,h-83,w-46,h-83)
        canvas.setFont('Templo',10)
        canvas.setFillColor(DARK)
        canvas.drawRightString(w-46,h-55,'Secretaria  /  Ficha individual')
        canvas.line(46,43,w-46,43)
        canvas.drawString(46,27,'Emissão '+format_date(date.today().isoformat())+'   ·   Uso interno')
        canvas.drawRightString(w-46,27,'Página '+str(document.page))

    story.extend([para(person['nome'],26),para(person.get('tipo',''),12,INK)])
    heading('Identificação')
    for key,label in [('nasc','Nascimento'),('tel','Telefone'),('email','E-mail'),('end','Endereço')]:
        row(label,format_date(person.get(key)) if key=='nasc' else person.get(key))
    row('Signo solar',sign)
    heading('Análise inicial')
    analysis=person.get('analysis') or {}
    row('Data e situação',' · '.join(filter(None,[format_date(analysis.get('data')),analysis.get('status')])))
    for key,label in [('autor','Responsável'),('motivo','Motivo da procura'),('historico','Vivências espirituais'),
                      ('objetivos','Expectativas'),('obs','Observações'),('plano','Acompanhamento combinado')]:
        row(label,analysis.get(key))
    heading('Configuração espiritual')
    if person.get('intro'):
        story.extend([para(person['intro']),Spacer(1,8)])
    story.append(SpiritualMap(person.get('map',[])))
    table=[[para('Posição',11,INK),para('Identificação e observações',11,INK)]]
    for slot in person.get('map',[]):
        table.append([para(slot.get('label','')),para('\n'.join(filter(None,[slot.get('nome'),slot.get('obs')])) or '—')])
    story.append(Table(table,colWidths=[130,doc.width-142],repeatRows=1,splitInRow=1,
                       style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eedcdd')),
                              ('LINEBELOW',(0,0),(-1,-1),0.3,colors.HexColor('#d7d1c5'))])))
    heading('Histórico de atendimentos')
    if not events:
        story.append(para('Nenhum atendimento registrado.'))
    for e in sorted(events,key=lambda x:(x['day'],x['start']),reverse=True):
        story.extend([CondPageBreak(60),para(format_date(e['day'])+'   ·   '+e['start']+'–'+e['end']+'   ·   '+e['title'],15,INK),
                      para(e['owner']+'   ·   '+e['status'],10),Spacer(1,4),para(e.get('note') or 'Sem relato registrado.'),Spacer(1,8)])
    doc.build(story,onFirstPage=decorate,onLaterPages=decorate)
    return stream.getvalue()
