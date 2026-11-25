"""Comprovantes de baixa e declarações de conclusão, com a marca do templo."""
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from ficha_pdf import ROOT


def formatted_day(value):
    return '/'.join(value.split('-')[::-1])


def currency(cents):
    return 'R$ '+f'{cents // 100:,}'.replace(',', '.')+f',{cents % 100:02}'


def render(title, fields):
    result = BytesIO()
    doc = SimpleDocTemplate(result, pagesize=A4, leftMargin=52, rightMargin=52,
                            topMargin=126, bottomMargin=64, title=title)
    ink = HexColor('#8f2028')
    gray = HexColor('#403735')
    heading = ParagraphStyle('Heading', fontName='Templo', fontSize=30, leading=35, textColor=ink)
    label = ParagraphStyle('Label', fontName='Templo', fontSize=11, leading=15, textColor=ink)
    value = ParagraphStyle('Value', fontName='Templo', fontSize=17, leading=22, textColor=gray)
    story = [Paragraph(escape(title),heading),Spacer(1,22)]
    for name, content in fields:
        if content:
            story.extend([Paragraph(escape(name),label),Paragraph(escape(str(content)),value),Spacer(1,12)])

    def page(canvas, document):
        width,height=A4
        canvas.drawImage(str(ROOT/'marca_pdf.png'),52,height-98,width=233,height=56,mask='auto')
        canvas.setStrokeColor(ink)
        canvas.line(52,height-109,width-52,height-109)
        canvas.line(52,49,width-52,49)
        canvas.setFillColor(gray)
        canvas.setFont('Templo',11)
        canvas.drawString(52,32,'Templo Espírita Ogum Quebra Demanda')
        canvas.drawRightString(width-52,32,str(document.page))

    doc.build(story,onFirstPage=page,onLaterPages=page)
    return result.getvalue()


def receipt(bill, payment, person):
    incoming=bill['tipo']=='A receber'
    return render('Recibo de '+('recebimento' if incoming else 'pagamento'), [
        ('Referência da baixa',payment['id']),
        ('Pagador' if incoming else 'Favorecido',person['nome'] if person else ''),
        ('Lançamento',bill['descricao']),
        ('Valor da baixa',currency(payment['amount'])),
        ('Data',formatted_day(payment['date'])),
        ('Meio de pagamento',payment['method']),
        ('Referência informada',payment.get('reference')),
    ])


def declaration(enrollment, person, klass):
    snapshot=enrollment['completion']
    return render('Declaração de conclusão', [
        ('Aluno',person['nome']),
        ('Curso',snapshot['title']),
        ('Turma',klass['title']),
        ('Carga horária',str(snapshot['hours'])+' horas'),
        ('Frequência',f"{snapshot['present']} de {snapshot['total']} aulas"),
        ('Conclusão',formatted_day(enrollment['completed'])),
        ('Referência',enrollment['id']),
    ])
