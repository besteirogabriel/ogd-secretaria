"""Disponibilidades e reservas individuais do portal."""
import json
import secrets
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    ZONE = ZoneInfo('America/Sao_Paulo')
except (ImportError, KeyError):
    ZONE = timezone(timedelta(hours=-3))

POSITIONS = ('Cabeça','Corpo','Caminhos','Adjuntó','Caboclo','Preto Velho','Marinheiro','Sereia','Criança','1º Exu','2º Exu','Ciganos','Egun')


def current():
    return datetime.now(ZONE).replace(tzinfo=None)


def schedules(con):
    return [json.loads(r[0]) for r in con.execute("SELECT body FROM records WHERE kind='agenda'")]


def rules(con):
    return [json.loads(r[0]) for r in con.execute('SELECT body FROM book_rules ORDER BY rowid')]


def slots(con, now=None, pid=None, ignore_id=None):
    now=now or current()
    events_by_day={}
    for event in schedules(con):
        if event['status']!='Cancelado' and event['id']!=ignore_id:
            events_by_day.setdefault(event['day'],[]).append(event)
    available=[]
    for rule in rules(con):
        if not rule['active']:
            continue
        for offset in range(rule['horizon']+1):
            day=now.date()+timedelta(days=offset)
            if day.weekday() not in rule['days'] or day.isoformat() in rule['blocked']:
                continue
            start=datetime.fromisoformat(day.isoformat()+'T'+rule['start'])
            stop=datetime.fromisoformat(day.isoformat()+'T'+rule['end'])
            length=timedelta(minutes=rule['duration'])
            while start+length<=stop:
                end=start+length
                daykey=day.isoformat()
                a,b=start.strftime('%H:%M'),end.strftime('%H:%M')
                busy=any(e['day']==daykey and e['status']!='Cancelado' and e['start']<b and a<e['end'] and
                         (e['owner'].strip().casefold()==rule['owner'].casefold() or
                          (rule['room'] and str(e.get('room') or '').strip().casefold()==rule['room'].casefold()) or
                          (pid and e.get('pid')==pid)) for e in events_by_day.get(daykey,()))
                if start>now and start>=now+timedelta(hours=rule['notice']) and not busy:
                    available.append(dict(rule=rule['id'],title=rule['title'],owner=rule['owner'],room=rule['room'],day=daykey,start=a,end=b,fee=rule.get('fee'),free=rule.get('free',False),due_days=rule.get('due_days',0)))
                start=end
    return sorted(available,key=lambda s:(s['day'],s['start'],s['title']))


def new_person(name,email,b,require):
    phone=str(b.get('tel','')).strip()
    require(7<=len(phone)<=32,'Informe um telefone com DDD.')
    kind=b.get('tipo','Aluno')
    require(kind in ('Aluno','Cliente'),'Vínculo inválido.')
    return dict(id=secrets.token_hex(16),nome=name,email=email,tel=phone,tipo=kind,
                analysis={'data':current().date().isoformat(),'status':'Rascunho'},
                intro='Durante as aulas práticas e teóricas, esta foi a configuração espiritual observada.',
                map=[dict(label=s,nome='',obs='') for s in POSITIONS])


def configure(con,b,require):
    rule={}
    for k in ('title','owner','room'):
        rule[k]=str(b.get(k,'')).strip()
        require(len(rule[k])<=120 and (k=='room' or rule[k]),'Informe o serviço e o responsável.')
    for k,lo,hi in [('duration',10,240),('horizon',1,60),('notice',0,168)]:
        rule[k]=int(b[k])
        require(lo<=rule[k]<=hi,'Confira a duração, antecedência e período de reservas.')
    raw_fee=str(b.get('fee_cents','')).strip()
    rule['fee']=int(raw_fee) if raw_fee else None
    rule['free']=b.get('free') is True
    rule['due_days']=int(b.get('due_days',0))
    require((rule['fee'] is None or 0<=rule['fee']<=10**10) and 0<=rule['due_days']<=365,
            'Confira o valor do serviço e o prazo de vencimento.')
    rule['days']=sorted(set(int(n) for n in b['days']))
    require(rule['days'] and all(0<=n<=6 for n in rule['days']),'Selecione os dias de atendimento.')
    for k in ('start','end'):
        rule[k]=datetime.strptime(b[k],'%H:%M').strftime('%H:%M')
    t=lambda k:datetime.strptime(rule[k],'%H:%M')
    require(t('end')-t('start')>=timedelta(minutes=rule['duration']),'A janela precisa comportar pelo menos um atendimento.')
    rule['blocked']=sorted(set(datetime.strptime(v,'%Y-%m-%d').date().isoformat() for v in b.get('blocked',[])))
    rule['active']=b.get('active') is True
    rule['id']=b.get('id') or secrets.token_hex(12)
    if b.get('id'):
        row=con.execute('SELECT body FROM book_rules WHERE id=?',(rule['id'],)).fetchone()
        require(row and json.loads(row[0])==b.get('previous'),'Disponibilidade alterada. Reabra a configuração.',409)
    con.execute('INSERT OR REPLACE INTO book_rules VALUES (?,?)',(rule['id'],json.dumps(rule)))
    return rule


def own(con,pid):
    return [{k:e.get(k,'') for k in ('id','title','owner','day','start','end','status','room','source','arrived_at')}
            for e in schedules(con) if e.get('pid')==pid]


def reschedulable(con, event_id, pid):
    row=con.execute("SELECT body FROM records WHERE kind='agenda' AND id=?", (event_id,)).fetchone()
    event=json.loads(row[0]) if row else {}
    if event.get('pid')!=pid or event.get('source')!='Portal':
        return None
    if event['status'] not in ('Agendado','Confirmado') or event.get('arrived_at'):
        return None
    if datetime.fromisoformat(event['day']+'T'+event['start'])<=current():
        return None
    return event


def book(con,pid,b,require,validate):
    previous=None
    if b.get('id'):
        previous=reschedulable(con,b['id'],pid)
        require(previous,'Reserva indisponível para alteração.',404)
    if b.get('cancel'):
        require(previous,'Selecione a reserva.')
        item=dict(previous,status='Cancelado')
    else:
        slot=next((s for s in slots(con,pid=pid,ignore_id=previous['id'] if previous else None) if all(s[k]==b.get(k) for k in ('rule','day','start'))),None)
        require(slot,'O horário não está mais disponível. Selecione outro.',409)
        if previous:
            require(slot['rule']==previous['rule'],'Escolha outro horário do mesmo serviço.')
            slot.update(fee=previous.get('fee'), free=previous.get('free',False),
                        due_days=previous.get('due_days',0))
        item=dict(previous or {},**slot)
        item.pop('arrived_at',None)
        item.update(id=previous['id'] if previous else secrets.token_hex(16),pid=pid,status='Confirmado',source='Portal')
        validate(con,'agenda',item,previous)
    con.execute("INSERT OR REPLACE INTO records VALUES ('agenda',?,?)",(item['id'],json.dumps(item)))
    return item
