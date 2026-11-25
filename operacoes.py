"""Financeiro de origens vinculadas, movimentações de estoque e gestão de turmas."""
import json
import secrets
from datetime import date, timedelta

import reservas


def records(con, kind):
    return [json.loads(row[0]) for row in con.execute(
        'SELECT body FROM records WHERE kind=? ORDER BY rowid', (kind,)
    )]


def find(con, kind, record_id):
    row = con.execute('SELECT body FROM records WHERE kind=? AND id=?', (kind, record_id)).fetchone()
    return json.loads(row[0]) if row else None


def store(con, kind, item):
    con.execute('''INSERT INTO records(kind,id,body) VALUES (?,?,?)
                   ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body''',
                (kind, item['id'], json.dumps(item, ensure_ascii=False)))
    return item


def identifier():
    return secrets.token_hex(16)


def today():
    return reservas.current().date().isoformat()


def day(value):
    return date.fromisoformat(value).isoformat()


def text(body, key, require, *, label=None, limit=160, required=False):
    value = body.get(key, '')
    require(isinstance(value, str) and len(value.strip()) <= limit
            and (not required or value.strip()), 'Confira o campo '+(label or key)+'.')
    return value.strip()


def number(body, key, low, high, require):
    value = body.get(key)
    require(type(value) is int and low <= value <= high, 'Valor inválido para '+key+'.')
    return value


def existing(con, kind, record_id, require):
    item = find(con, kind, record_id)
    require(item, 'Registro não encontrado.', 404)
    return item


def current_version(con, kind, body, require):
    if not body.get('id'):
        return None
    old = existing(con, kind, body['id'], require)
    require(old == body.get('previous'), 'Registro alterado. Abra novamente e confira os dados.', 409)
    return old


def linked_bill(con, kind, source_id):
    row = con.execute('''SELECT body FROM records WHERE kind='contas'
                         AND json_extract(body,'$.origin_kind')=?
                         AND json_extract(body,'$.origin_id')=?''', (kind, source_id)).fetchone()
    return json.loads(row[0]) if row else None


def received(bill):
    if 'payments' in bill:
        return sum(payment['amount'] for payment in bill['payments'] if not payment.get('reversed'))
    return bill['cents'] if bill.get('paid') else 0


def bill_state(bill):
    if bill.get('billing_state') in ('draft', 'void'):
        return bill['billing_state']
    paid = received(bill)
    return 'paid' if paid >= bill['cents'] else 'partial' if paid else 'open'


def validate_bill_edit(item, old, require):
    for key in ('origin_kind', 'origin_id', 'payments', 'billing_state', 'auto_due', 'review',
                'resume_state', 'void_reason', 'cancel_note'):
        require(item.get(key) == (old or {}).get(key), 'Use as ações do financeiro para alterar este lançamento.')
    if old and old.get('origin_id'):
        require(item.get('pid') == old.get('pid') and item['tipo'] == old['tipo'],
                'O vínculo vem do registro de origem.')
    if old and ('payments' in old or old.get('origin_id')):
        require(item.get('paid') == old.get('paid'), 'Use a ação Registrar pagamento.')
        require(item['cents'] >= received(old), 'O valor não pode ficar abaixo do total recebido.')
    if old and old.get('paid') and 'payments' not in old:
        require(old['cents']==item['cents'] and old['paid']==item.get('paid'),
                'Estorne a baixa histórica antes de alterar o valor.')
    if old and item['due'] != old['due'] and old.get('auto_due'):
        item['auto_due'] = False


def sync_charge(con, kind, source, label, *, free=False, inactive=False, cents=None, due=None):
    """Mantém a cobrança no mesmo commit do atendimento ou da matrícula."""
    draft = linked_bill(con, kind, source['id'])
    if free or inactive:
        if draft:
            if received(draft):
                draft['review'] = 'Origem cancelada ou gratuita, com baixa registrada.'
            elif draft.get('billing_state') != 'void':
                draft['resume_state'] = draft.get('billing_state', 'open')
                draft['billing_state'] = 'void'
                draft['void_reason'] = 'origin'
            store(con, 'contas', draft)
        return draft

    if not draft:
        return store(con, 'contas', dict(
            id=identifier(), tipo='A receber', descricao=label, pid=source['pid'],
            cents=cents or 0, due=due, origin_kind=kind, origin_id=source['id'],
            billing_state='draft', auto_due=True,
        ))

    if draft.get('void_reason') == 'origin':
        draft['billing_state'] = draft.pop('resume_state', 'draft')
        draft.pop('void_reason')
    draft.pop('review', None)
    if draft.get('auto_due') and due and not received(draft):
        draft['due'] = due
    return store(con, 'contas', draft)


def sync_visit(con, event):
    if not event.get('pid') or event.get('class_id'):
        return None
    due_date = date.fromisoformat(event['day']) + timedelta(days=event.get('due_days', 0))
    return sync_charge(con, 'agenda', event, event['title'],
                       free=event.get('free') is True, inactive=event['status'] == 'Cancelado',
                       cents=event.get('fee'), due=due_date.isoformat())


def finance(con, operation, body, require):
    bill = existing(con, 'contas', body['id'], require)
    require(bill == body.get('previous'), 'Lançamento alterado. Abra novamente e confira o saldo.', 409)
    state = bill_state(bill)
    if operation == 'approve':
        require(state == 'draft' and bill['cents'] > 0, 'Defina um valor para publicar a cobrança.')
        bill['billing_state'] = 'open'
    elif operation == 'void':
        require(state != 'void' and not received(bill), 'Estorne as baixas antes de cancelar.')
        bill['resume_state'] = bill.get('billing_state', 'open')
        bill['billing_state'] = 'void'
        bill['void_reason'] = 'manual'
        bill['cancel_note'] = text(body, 'reason', require, label='motivo', required=True)
    elif operation == 'reopen':
        require(state == 'void' and bill.get('void_reason') == 'manual', 'A cobrança depende da situação de origem.')
        source_kind={'agenda':'agenda','matricula':'matriculas'}.get(bill.get('origin_kind'))
        if source_kind:
            source=existing(con,source_kind,bill['origin_id'],require)
            valid=(source['status']!='Cancelado' and not source.get('free')) if source_kind=='agenda' else source['status'] in ('Matriculada','Concluída')
            require(valid,'Regularize a situação de origem antes de reabrir.')
        bill['billing_state'] = bill.pop('resume_state', 'draft')
        bill.pop('void_reason', None)
        bill.pop('cancel_note', None)
    elif operation == 'pay':
        require(state in ('open', 'partial') and not bill.get('review'),
                'A cobrança precisa estar aberta e sem pendência de revisão.')
        amount = number(body, 'amount', 1, bill['cents']-received(bill), require)
        method = text(body, 'method', require, required=True)
        require(method in ('Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'), 'Meio de pagamento inválido.')
        paid_date = day(body['date'])
        require(paid_date <= today(), 'A baixa deve ter data de hoje ou anterior.')
        bill.setdefault('payments', []).append(dict(
            id=identifier(), amount=amount, date=paid_date, method=method,
            reference=text(body, 'reference', require)
        ))
        bill['paid'] = paid_date if received(bill) == bill['cents'] else ''
    elif operation == 'reverse':
        if 'payments' not in bill and bill.get('paid'):
            bill['payments'] = [dict(id='legado', amount=bill['cents'], date=bill['paid'], method='Legado')]
        payments = bill.get('payments', [])
        payment = next((p for p in payments if p['id'] == body.get('payment')), None)
        require(payment and not payment.get('reversed'), 'Baixa não encontrada ou já estornada.', 409)
        payment['reversal_note'] = text(body, 'reason', require, label='motivo', required=True)
        payment['reversed'] = today()
        bill['paid'] = ''
        if bill.get('review') and not received(bill):
            bill['billing_state'] = 'void'
            bill['resume_state'] = 'open'
            bill['void_reason'] = 'origin'
            bill.pop('review', None)
    return store(con, 'contas', bill)


def link_visit(con, body, require):
    visit = existing(con, 'agenda', body['event'], require)
    require(visit.get('pid') and not visit.get('class_id') and visit['status'] != 'Cancelado'
            and not visit.get('free'), 'Selecione um atendimento individual cobrável.')
    if not body.get('bill'):
        return sync_visit(con, visit)
    bill = existing(con, 'contas', body['bill'], require)
    require(not linked_bill(con, 'agenda', visit['id']), 'O atendimento já possui cobrança.', 409)
    require(bill.get('pid') == visit['pid'] and bill['tipo'] == 'A receber'
            and not bill.get('origin_id') and bill_state(bill) != 'void',
            'Escolha uma conta a receber da mesma pessoa e sem outro vínculo.')
    return store(con, 'contas', dict(bill, origin_kind='agenda', origin_id=visit['id']))


def save_product(con, body, require):
    old = current_version(con, 'produtos', body, require)
    item = dict(old or {}, id=old['id'] if old else identifier())
    item.update(
        name=text(body, 'name', require, label='nome', required=True),
        sku=text(body, 'sku', require, label='código', required=True, limit=32).upper(),
        category=text(body, 'category', require, label='categoria'),
        unit=text(body, 'unit', require, label='unidade', required=True, limit=24),
        location=text(body, 'location', require, label='localização'),
        minimum=number(body, 'minimum', 0, 10**9, require),
        cost=number(body, 'cost', 0, 10**10, require),
        active=body.get('active') is True,
    )
    require(not any(p['sku'] == item['sku'] and p['id'] != item['id'] for p in records(con, 'produtos')),
            'Já existe um produto com esse código.', 409)
    require(item['active'] or not item.get('balance'), 'Zere o saldo antes de arquivar um produto.')
    if old and old['unit']!=item['unit']:
        require(not any(m['product']==old['id'] for m in records(con,'movimentos')),
                'A unidade fica fixa após a primeira movimentação.')
    item.setdefault('balance', 0)
    return store(con, 'produtos', item)


def move_stock(con, body, require, actor):
    product = existing(con, 'produtos', body['product'], require)
    operation = body.get('movement')
    movement_id = text(body, 'operation_id', require, required=True)
    require(not find(con, 'movimentos', movement_id), 'Movimento já registrado.', 409)
    require(product['active'], 'Produto arquivado.')
    require(operation in ('entrada', 'saida', 'contagem', 'estorno'), 'Movimento inválido.')
    reason = text(body, 'reason', require, label='motivo', required=True)
    origin = text(body, 'event', require, label='atendimento')
    if origin:
        event=existing(con, 'agenda', origin, require)
        require(event['status']!='Cancelado','O compromisso está cancelado.')
        require(operation == 'saida', 'Vincule somente saídas a um atendimento.')
    original = None
    delta = 0
    if operation == 'estorno':
        original = existing(con, 'movimentos', body['reverse'], require)
        require(original['product'] == product['id'] and original['movement'] != 'estorno'
                and not original.get('reversed_by'), 'Movimento já estornado ou inválido.', 409)
        delta = -original['delta']
        origin = original.get('event', '')
    else:
        value = number(body, 'quantity', 0 if operation == 'contagem' else 1, 10**9, require)
        if operation == 'contagem':
            require(product['balance'] == body.get('expected_balance'), 'O saldo mudou. Refaça a conferência.', 409)
            delta = value - product['balance']
        else:
            delta = value if operation == 'entrada' else -value
    new_balance = product['balance'] + delta
    require(0 <= new_balance <= 10**9, 'Saldo insuficiente ou acima do limite.', 409)
    item = dict(id=movement_id, product=product['id'], movement=operation, delta=delta,
                balance=new_balance, unit=original.get('unit',product['unit']) if original else product['unit'],
                reason=reason, actor=actor, event=origin, created_at=reservas.current().isoformat(timespec='seconds'))
    store(con, 'produtos', dict(product, balance=new_balance))
    if original:
        item['reverse'] = original['id']
        store(con, 'movimentos', dict(original, reversed_by=item['id']))
    return store(con, 'movimentos', item)


def save_course(con, body, require):
    old = current_version(con, 'cursos', body, require)
    item = dict(
        id=old['id'] if old else identifier(),
        title=text(body, 'title', require, label='curso', required=True),
        syllabus=text(body, 'syllabus', require, label='ementa', limit=8000),
        hours=number(body, 'hours', 1, 5000, require),
        minimum=number(body, 'minimum', 0, 100, require),
        active=body.get('active') is True,
    )
    return store(con, 'cursos', item)


def registrations(con, class_id):
    return [m for m in records(con, 'matriculas') if m['class_id'] == class_id]


def seats(enrollments):
    return sum(m['status'] in ('Matriculada', 'Concluída') for m in enrollments)


def save_class(con, body, require):
    old = current_version(con, 'turmas', body, require)
    course = existing(con, 'cursos', body['course_id'], require)
    require(course['active'] or (old and old['course_id'] == course['id']), 'O curso está arquivado.')
    item = dict(
        id=old['id'] if old else identifier(), course_id=course['id'],
        title=text(body, 'title', require, label='turma', required=True),
        teacher=text(body, 'teacher', require, label='instrutor', required=True),
        room=text(body, 'room', require, label='local'),
        start=day(body['start']), end=day(body['end']),
        capacity=number(body, 'capacity', 1, 10000, require),
        fee=number(body, 'fee', 0, 10**10, require),
        status=body.get('status'),
    )
    require(item['status'] in ('Aberta', 'Em andamento', 'Encerrada'), 'Situação da turma inválida.')
    require(item['start'] <= item['end'], 'A data final deve ser igual ou posterior ao início.')
    if old:
        require(item['course_id'] == old['course_id'] or not (registrations(con, old['id']) or class_events(con, old['id'])),
                'Uma turma com matrículas ou aulas deve permanecer no mesmo curso.')
        require(item['capacity'] >= seats(registrations(con, old['id'])),
                'A capacidade é menor que o número de matrículas.')
        require(all(item['start'] <= event['day'] <= item['end'] for event in class_events(con, old['id'])),
                'As datas devem incluir as aulas já lançadas.')
    return store(con, 'turmas', item)


def class_events(con, class_id):
    return [e for e in reservas.schedules(con) if e.get('class_id') == class_id]


def attendance_result(con, class_id, pid):
    meetings = [e for e in class_events(con, class_id) if e['status'] == 'Realizado']
    present = sum(e.get('attendance', {}).get(pid) == 'Presente' for e in meetings)
    return present, len(meetings)


def enroll(con, body, require):
    klass = existing(con, 'turmas', body['class_id'], require)
    person = existing(con, 'pessoas', body['pid'], require)
    require(person.get('tipo') in ('Aluno', 'Aluno e cliente'), 'Selecione um cadastro com vínculo de aluno.')
    roster = registrations(con, klass['id'])
    old = next((m for m in roster if m['pid'] == person['id']), None)
    require(old == body.get('previous'), 'Matrícula alterada. Abra novamente.', 409)
    status = body.get('status')
    require(old or status in ('Matriculada','Em espera'), 'Selecione matrícula ou lista de espera.')
    require(status in ('Matriculada', 'Em espera', 'Cancelada', 'Concluída'), 'Situação de matrícula inválida.')
    if status in ('Matriculada', 'Em espera'):
        require(klass['status'] != 'Encerrada', 'As matrículas desta turma estão encerradas.')
    if status == 'Matriculada' and (not old or old['status'] not in ('Matriculada', 'Concluída')):
        require(seats(roster) < klass['capacity'], 'Turma lotada. Use a lista de espera.', 409)
    if status == 'Concluída':
        require(old and old['status'] == 'Matriculada', 'Conclua uma matrícula ativa.')
        present, total = attendance_result(con, klass['id'], person['id'])
        course = existing(con, 'cursos', klass['course_id'], require)
        require(total and present*100 >= total*course['minimum'], 'Frequência insuficiente ou nenhuma aula realizada.')
    item = dict(old or {}, id=old['id'] if old else identifier(), class_id=klass['id'],
                pid=person['id'], status=status, date=old['date'] if old else today())
    if status == 'Concluída':
        item['completed'] = today()
        item['completion'] = dict(title=course['title'], hours=course['hours'], present=present, total=total)
    elif item.get('completed'):
        item.pop('completed')
        item.pop('completion', None)
    store(con, 'matriculas', item)
    charge = linked_bill(con, 'matricula', item['id'])
    if charge or klass['fee']:
        sync_charge(con, 'matricula', item, 'Matrícula · '+klass['title'],
                    inactive=status not in ('Matriculada', 'Concluída'), cents=klass['fee'],
                    due=charge['due'] if charge else today())
    return item


def schedule_lessons(con, body, require, validate):
    klass = existing(con, 'turmas', body['class_id'], require)
    require(klass['status'] != 'Encerrada', 'A turma está encerrada.')
    title = text(body, 'title', require, label='aula', required=True)
    first = date.fromisoformat(body['day'])
    count = number(body, 'count', 1, 40, require)
    series = text(body, 'operation_id', require, required=True)
    for n in range(count):
        meeting_day = (first+timedelta(days=7*n)).isoformat()
        require(klass['start'] <= meeting_day <= klass['end'], 'As aulas precisam caber no período da turma.')
        meeting = dict(id=series+'-'+str(n), class_id=klass['id'], title=title, owner=klass['teacher'],
                       room=klass['room'], day=meeting_day, start=body['start'], end=body['end_time'],
                       pid='', status='Agendado', source='Turma')
        require(not find(con, 'agenda', meeting['id']), 'Série já cadastrada.', 409)
        validate(con, 'agenda', meeting, None)
        store(con, 'agenda', meeting)
    return {'id': series}


def take_attendance(con, body, require):
    previous = existing(con, 'agenda', body['id'], require)
    require(previous == body.get('previous'), 'A aula mudou. Reabra a chamada.', 409)
    require(previous.get('class_id') and previous['status'] != 'Cancelado'
            and previous['day'] <= today(), 'A chamada fica disponível no dia da aula.')
    roster = registrations(con, previous['class_id'])
    eligible = {m['pid'] for m in roster if m['status'] in ('Matriculada', 'Concluída')}
    marks = body.get('attendance')
    require(isinstance(marks, dict) and set(marks) == eligible
            and all(value in ('Presente', 'Falta', 'Justificada') for value in marks.values()),
            'A lista de alunos mudou ou a chamada está incompleta.', 409)
    history = previous.get('attendance', {})
    return store(con, 'agenda', dict(previous, status='Realizado', attendance={**history, **marks}))


def transfer(con, body, require):
    old=existing(con,'matriculas',body['id'],require)
    require(old==body.get('previous') and old['status']=='Matriculada',
            'Selecione uma matrícula ativa e atualizada.',409)
    source=existing(con,'turmas',old['class_id'],require)
    target=existing(con,'turmas',body['target'],require)
    require(source['id']!=target['id'] and source['course_id']==target['course_id'],
            'Selecione outra turma do mesmo curso.')
    prior=next((m for m in registrations(con,target['id']) if m['pid']==old['pid']),None)
    require(not prior or prior['status'] in ('Cancelada','Em espera'),'O aluno já está vinculado à turma.')
    dest=enroll(con,dict(class_id=target['id'],pid=old['pid'],status='Matriculada',previous=prior),require)
    enroll(con,dict(class_id=source['id'],pid=old['pid'],status='Cancelada',previous=old),require)
    return dest
