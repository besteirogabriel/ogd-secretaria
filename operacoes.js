'use strict';

const monetaryField=(key,label)=>({...field(key,label,'number'),min:0,step:'.01'});
const integerField=(key,label,min=1,max)=>({...req(key,label,'number'),min,step:1,max});
const cents=value=>Math.round(Number(value||0)*100);
const decimal=amount=>((amount||0)/100).toFixed(2);
const quantity=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(value/1000);
const quantityField=(key,label,min=0)=>({...req(key,label,'number'),min,step:'.001'});
const menusFinance=['Em aberto','Rascunhos','Vencidos','Baixados','Em revisão','Cancelados','Todos'];
const paymentMethods=['Pix','Dinheiro','Cartão','Transferência','Outro'];
const enrollmentStates=['Matriculada','Em espera','Cancelada','Concluída'];
const byId=(kind,id)=>db[kind]?.find(item=>item.id===id);
const byName=(a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:'base'});
const findBill=(kind,id)=>db.contas.find(item=>item.origin_kind===kind&&item.origin_id===id);
const canFinance=()=>['Administrador','Financeiro'].includes(me.role);
const canSchedule=()=>me.role!=='Financeiro';
const statusChip=(label,tone='neutral')=>'<span class="status-tag '+tone+'">'+esc(label)+'</span>';
const closedBill=(entry)=>billStatus(entry)==='void';
const sortedByName=(items,key)=>items.slice().sort((a,b)=>byName(a[key],b[key]));
let invoiceId='', financePerson='', financeMode='Lançamentos', financeMonth='';
let stockId='', stockFilter='Ativos', stockQuery='';
let academicView='Turmas', classId='', courseFilter='';

function table(headers,rows,empty){
  return rows.length?'<div class="tablewrap"><table><thead><tr>'+
    headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>':'<div class="empty-panel">'+esc(empty)+'</div>';
}
function row(values){return '<tr>'+values.map(value=>'<td>'+value+'</td>').join('')+'</tr>'}
function tabs(values,selected,onChange){
  return '<div class="tabs ops-tabs">'+values.map(value=>btn(value,()=>onChange(value),value===selected?'active':'')).join('')+'</div>';
}
function kv(label,value){
  return '<div><dt>'+esc(label)+'</dt><dd>'+esc(value||'—')+'</dd></div>';
}
function csv(name,columns,rows){
  const cell=value=>{
    let text=String(value??'');
    if(/^[=+\-@\t\r\n]/.test(text)&&!/^-?\d+(?:[,.]\d+)?$/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const contents=[columns,...rows].map(line=>line.map(cell).join(';')).join('\r\n');
  saveFile(new Blob(['\ufeff',contents,'\r\n'],{type:'text/csv;charset=utf-8'}),name+'.csv');
}
function panel(title,body){
  form.innerHTML='<div class="detail-head"><h2>'+esc(title)+'</h2>'+btn('Fechar',()=>dlg.close(),'subtle')+'</div>'+
    '<p class="error" data-form-error role="alert"></p>'+body;
  form.onsubmit=event=>event.preventDefault();
  dlg.classList.add('drawer');
  if(!dlg.open)dlg.showModal();
}
async function runOperation(op,values,after,success='Registro atualizado.'){
  if(busy)return;
  busy=true;
  const submit=form.querySelector('button[type="submit"], button.primary');
  if(submit)submit.disabled=true;
  try{
    const result=await api('/operacao',{...values,op});
    db=(await api('/dados')).data;
    dlg.close();
    after?.(result);
    render();
    notify(success);
  }catch(error){formError(error.message)}
  finally{busy=false;if(submit)submit.disabled=false}
}
async function downloadDocument(path,name){
  try{
    const response=await fetch('/documentos/'+path);
    if(!response.ok)throw new Error((await response.json()).error);
    saveFile(await response.blob(),name+'.pdf');
  }catch(error){formError(error.message)}
}

function payments(entry){
  return entry.payments||(entry.paid?[{id:'legado',amount:entry.cents,date:entry.paid,method:'Legado'}]:[]);
}
function totalPaid(entry){
  return payments(entry).filter(payment=>!payment.reversed).reduce((sum,payment)=>sum+payment.amount,0);
}
function billStatus(entry){
  if(['draft','void'].includes(entry.billing_state))return entry.billing_state;
  const paid=totalPaid(entry);
  return paid>=entry.cents?'paid':paid?'partial':'open';
}
const financeStatus={
  draft:['Rascunho','neutral'],open:['Em aberto','amber'],partial:['Parcial','blue'],
  paid:['Baixada','green'],void:['Cancelada','neutral']
};
const outstanding=entry=>entry.cents-totalPaid(entry);
const unsettled=entry=>!entry.review&&['open','partial'].includes(billStatus(entry));
function originName(entry){
  if(entry.origin_kind==='agenda')return 'Atendimento';
  if(entry.origin_kind==='matricula')return 'Matrícula';
  return 'Manual';
}
function openFinance(pid='',id=''){
  dlg.close();
  personId='';
  invoiceId=id;
  financePerson=pid;
  financeMode='Lançamentos';
  financeFilter=id||pid?'Todos':'Em aberto';
  tab='Financeiro';
  render();
}
function billCard(event){
  if(!event.pid||event.class_id)return '';
  const charge=findBill('agenda',event.id);
  const summary=db.cobrancas_agenda?.find(item=>item.origin_id===event.id);
  if(!charge&&!summary&&event.free)return '<div class="ops-inline"><strong>Financeiro</strong><span>Atendimento gratuito</span></div>';
  const state=charge?billStatus(charge):summary?.state;
  const label=state?financeStatus[state][0]:'Sem cobrança vinculada';
  const buttons=canFinance()?(charge?btn('Abrir cobrança',()=>openFinance('',charge.id)):
    event.status!=='Cancelado'?btn('Vincular cobrança',()=>linkLegacyBill(event)):''):'';
  return '<div class="ops-inline"><div><strong>Financeiro</strong><p>'+esc(label)+(charge?' · '+money(charge.cents):'')+'</p></div>'+buttons+'</div>';
}
function linkLegacyBill(event){
  const candidates=db.contas.filter(b=>b.pid===event.pid&&b.tipo==='A receber'&&!b.origin_id&&!closedBill(b));
  const options=[['','Gerar novo rascunho'],...candidates.map(b=>[b.id,b.descricao+' · '+money(b.cents)+' · '+br(b.due)])];
  modal('Vincular cobrança',[field('bill','Conta a receber','select',options)],{},values=>
    runOperation('vincular',{event:event.id,...values},result=>openFinance('',result.id)));
}
function bill(entry){
  const linked=entry?.origin_id;
  const editable=!entry||!closedBill(entry);
  if(!editable)return;
  const fields=[req('descricao','Descrição')];
  if(!linked){
    fields.unshift(field('tipo','Tipo','select',['A receber','A pagar']));
    fields.push(field('pid','Vínculo','select',[['','Geral'],...sortedByName(db.pessoas,'nome').map(p=>[p.id,p.nome])]));
  }
  fields.push(monetaryField('valor','Valor original (R$)'),monetaryField('abatimento','Desconto (R$)'),req('due','Vencimento','date'));
  modal(entry?'Ajustar lançamento':'Novo lançamento',fields,
    entry?{...entry,valor:decimal(entry.gross??entry.cents),abatimento:decimal(entry.discount)}:{due:today()},
    values=>{
      const gross=cents(values.valor),discount=cents(values.abatimento),amount=gross-discount;
      if(!Number.isSafeInteger(amount)||amount<0||(!amount&&entry?.billing_state!=='draft')){
        formError('Confira o valor e o desconto. Para dispensar a cobrança, use Cancelar.');return;
      }
      const {valor,abatimento,...rest}=values;
      const item={...entry,...rest,id:entry?.id||uid(),cents:amount,gross,discount};
      save(data=>{
        if(entry)data.contas[data.contas.findIndex(record=>record.id===entry.id)]=item;
        else data.contas.push(item);
      },()=>{invoiceId=item.id});
    });
}
function payBill(entry){
  const remaining=outstanding(entry);
  const amount={...monetaryField('amount','Valor da baixa (R$)'),required:true,min:'.01',max:decimal(remaining)};
  modal(entry.tipo==='A receber'?'Registrar recebimento':'Registrar pagamento',[
    amount,req('date','Data da baixa','date'),field('method','Meio de pagamento','select',paymentMethods),
    field('reference','Referência ou observação')
  ],{amount:decimal(remaining),date:today()},values=>runOperation('pay',{
    ...values,amount:cents(values.amount),id:entry.id,previous:entry
  }));
}
function reasonedFinance(entry,op,payment){
  modal(op==='void'?'Cancelar cobrança':'Estornar baixa',[req('reason','Motivo','area')],{},values=>
    runOperation(op,{...values,id:entry.id,previous:entry,payment:payment?.id}));
}
function financeFilters(items){
  return items.filter(entry=>{
    const state=billStatus(entry);
    if(financeFilter==='Todos')return true;
    if(financeFilter==='Em revisão')return !!entry.review;
    if(financeFilter==='Rascunhos')return state==='draft';
    if(financeFilter==='Cancelados')return state==='void';
    if(financeFilter==='Baixados')return state==='paid';
    return unsettled(entry)&&(financeFilter!=='Vencidos'||entry.due<today());
  });
}
function invoice(entry){
  const state=billStatus(entry),personName=person(entry.pid)?.nome;
  const source=entry.origin_kind==='agenda'?byId('agenda',entry.origin_id):byId('matriculas',entry.origin_id);
  const methods=payments(entry).map(payment=>row([
    esc(br(payment.date)),money(payment.amount),esc(payment.method),
    esc(payment.reversed?'Estornada · '+payment.reversal_note:payment.reference||'—'),
    payment.reversed?'':(payment.id!=='legado'?btn('Recibo PDF',()=>downloadDocument('recibo/'+entry.id+'/'+payment.id,'Recibo-'+br(payment.date).replaceAll('/','-'))):'')+
      btn('Estornar',()=>reasonedFinance(entry,'reverse',payment),'danger')
  ]));
  const commands=(state!=='void'?btn('Ajustar',()=>bill(entry)):'')+
    (state==='draft'&&entry.cents>0?btn('Confirmar cobrança',()=>runOperation('approve',{id:entry.id,previous:entry}),'primary'):'')+
    (unsettled(entry)?btn('Registrar baixa',()=>payBill(entry),'primary'):'')+
    (state!=='void'&&!totalPaid(entry)?btn('Cancelar cobrança',()=>reasonedFinance(entry,'void'),'danger'):'')+
    (state==='void'&&entry.void_reason==='manual'?btn('Reabrir cobrança',()=>runOperation('reopen',{id:entry.id,previous:entry})):'');
  return '<div class="ops-breadcrumb">'+btn('Voltar ao financeiro',()=>{invoiceId='';render()},'text-link')+'</div>'+
    '<div class="page-title"><div><h1>'+esc(entry.descricao)+'</h1><p class="muted">'+esc(entry.tipo+' · '+(personName||'Geral'))+'</p></div><div class="row">'+commands+'</div></div>'+
    '<div class="metrics">'+metric('Valor líquido',money(entry.cents))+metric('Baixado',money(totalPaid(entry)))+
    metric('Saldo',money(state==='void'?0:outstanding(entry)))+'</div>'+
    '<section><div class="row"><h2>Lançamento</h2>'+statusChip(...financeStatus[state])+'</div>'+
    '<dl class="detail-grid">'+kv('Vencimento',br(entry.due))+kv('Origem',originName(entry))+
    kv('Valor original',money(entry.gross??entry.cents))+kv('Desconto',money(entry.discount||0))+'</dl>'+
    (entry.review||entry.cancel_note?'<p class="ops-callout">'+esc(entry.review||entry.cancel_note)+'</p>':'')+
    (source&&entry.origin_kind==='agenda'&&canSchedule()?btn('Abrir atendimento',()=>detail(source)):'')+
    (source&&entry.origin_kind==='matricula'&&canSchedule()?btn('Abrir turma',()=>openClass(source.class_id)):'')+'</section>'+
    '<section><h2>Histórico de baixas</h2>'+table(['Data','Valor','Meio','Referência / situação','Ações'],methods,'Nenhuma baixa registrada.')+'</section>';
}
function cashReport(items){
  const month=financeMonth||today().slice(0,7);
  const entries=items.flatMap(entry=>payments(entry).flatMap(payment=>[
    {entry,payment,date:payment.date,amount:payment.amount,reversal:false},
    ...(payment.reversed?[{entry,payment,date:payment.reversed,amount:-payment.amount,reversal:true}]:[])
  ])).filter(line=>line.date.startsWith(month)).sort((a,b)=>a.date.localeCompare(b.date));
  const sum=type=>entries.filter(({entry})=>entry.tipo===type).reduce((value,line)=>value+line.amount,0);
  const inTotal=sum('A receber'),outTotal=sum('A pagar');
  const csvRows=entries.map(({entry,payment,date,amount,reversal})=>[br(date),entry.tipo,entry.descricao,person(entry.pid)?.nome,payment.method,reversal?'Estorno':'Baixa',decimal(amount)]);
  return '<div class="row ops-controls"><label>Mês da baixa<input type="month" id="finance-month" value="'+esc(month)+'"></label>'+
    btn('Exportar extrato CSV',()=>csv('Extrato-'+month,['Data','Tipo','Lançamento','Pessoa','Meio','Movimento','Valor'],csvRows))+'</div>'+
    '<div class="metrics">'+metric('Recebido',money(inTotal))+metric('Pago',money(outTotal))+metric('Resultado do mês',money(inTotal-outTotal))+'</div>'+
    table(['Data','Tipo','Lançamento','Pessoa','Meio','Movimento','Valor'],entries.map(({entry,payment,date,amount,reversal})=>row([
      esc(br(date)),esc(entry.tipo),btn(entry.descricao,()=>{invoiceId=entry.id;render()},'text-link'),
      esc(person(entry.pid)?.nome||'—'),esc(payment.method),reversal?statusChip('Estorno','amber'):'Baixa',money(amount)
    ])),'Nenhuma baixa neste mês.');
}
function agingReport(items){
  const buckets=[['A vencer',-Infinity,-1],['Vence hoje',0,0],['1–30 dias',1,30],['31–60 dias',31,60],['61 dias ou mais',61,Infinity]];
  const range=(entry)=>Math.round((Date.parse(today())-Date.parse(entry.due))/86400000);
  const unpaid=items.filter(entry=>entry.tipo==='A receber'&&unsettled(entry));
  const rows=buckets.map(([label,min,max])=>{
    const group=unpaid.filter(entry=>range(entry)>=min&&range(entry)<=max);
    return [label,group.length,money(group.reduce((sum,entry)=>sum+outstanding(entry),0))];
  });
  return table(['Faixa de vencimento','Cobranças','Saldo a receber'],rows.map(values=>row(values.map(esc))),'');
}
function finance(){
  const current=byId('contas',invoiceId);
  if(current)return invoice(current);
  const all=db.contas.filter(entry=>!financePerson||entry.pid===financePerson)
    .sort((a,b)=>a.due.localeCompare(b.due));
  const rows=financeFilters(all);
  const sum=type=>all.filter(entry=>entry.tipo===type&&unsettled(entry)).reduce((total,entry)=>total+outstanding(entry),0);
  const body=financeMode==='Caixa mensal'?cashReport(all):financeMode==='Recebíveis por atraso'?agingReport(all):
    '<div class="metrics">'+metric('A receber',money(sum('A receber')))+metric('A pagar',money(sum('A pagar')))+
    metric('Rascunhos a revisar',all.filter(entry=>billStatus(entry)==='draft').length)+'</div>'+
    '<section class="ops-table">'+tabs(menusFinance,financeFilter,value=>{financeFilter=value;render()})+
    table(['Lançamento','Origem','Vencimento','Valor','Saldo','Situação'],rows.map(entry=>row([
      '<div>'+btn(entry.descricao,()=>{invoiceId=entry.id;render()},'text-link')+'<small>'+esc(person(entry.pid)?.nome||entry.tipo)+'</small></div>',
      esc(originName(entry)),esc(br(entry.due)),money(entry.cents),money(closedBill(entry)?0:outstanding(entry)),(entry.review?statusChip('Revisar','amber'):statusChip(...financeStatus[billStatus(entry)]))
    ])),'Nenhum lançamento neste filtro.')+'</section>';
  return '<div class="page-title"><div><h1>Financeiro</h1>'+(financePerson?'<p class="muted">Movimentações de '+esc(person(financePerson)?.nome)+'</p>':'')+
    '</div><div class="row">'+(financePerson?btn('Limpar filtro de pessoa',()=>{financePerson='';render()}):'')+btn('Novo lançamento',()=>bill(),'primary')+'</div></div>'+
    tabs(['Lançamentos','Caixa mensal','Recebíveis por atraso'],financeMode,value=>{financeMode=value;render()})+body;
}
function personFinance(personRecord){
  if(!canFinance())return '';
  const entries=db.contas.filter(entry=>entry.pid===personRecord.id);
  return btn('Financeiro da pessoa ('+entries.length+')',()=>openFinance(personRecord.id));
}

const movementLabel={entrada:'Entrada',saida:'Saída',contagem:'Contagem',estorno:'Estorno'};
function productForm(item){
  modal(item?'Editar produto':'Novo produto',[
    req('name','Produto'),req('sku','Código / SKU'),field('category','Categoria'),
    req('unit','Unidade de medida'),field('location','Localização / prateleira'),
    quantityField('minimum','Estoque mínimo'),monetaryField('cost','Custo por unidade (R$)'),
    field('status','Situação','select',['Ativo','Arquivado'])
  ],item?{...item,minimum:item.minimum/1000,cost:decimal(item.cost),status:item.active?'Ativo':'Arquivado'}:{unit:'un',minimum:0},
  values=>runOperation('produto',{
    ...values,minimum:Math.round(Number(values.minimum)*1000),cost:cents(values.cost),active:values.status==='Ativo',id:item?.id,previous:item
  },result=>{stockId=result.id}));
}
function movementForm(product,movement,original,eventId=''){
  const operationId=uid();
  const fields=[req('reason','Motivo / referência','area')];
  if(!original)fields.unshift(quantityField('value',movement==='contagem'?'Saldo físico contado':'Quantidade',movement==='contagem'?0:'.001'));
  if(movement==='saida'&&!eventId){
    const entries=db.agenda.filter(event=>event.status!=='Cancelado').slice().sort((a,b)=>b.day.localeCompare(a.day));
    fields.push(field('event','Vincular a um compromisso','select',[['','Sem compromisso'],...entries.map(e=>[e.id,br(e.day)+' · '+e.title])]));
  }
  modal(movementLabel[movement]+' · '+product.name,fields,
    movement==='contagem'?{value:product.balance/1000}:{},values=>runOperation('estoque',{
      product:product.id,movement,operation_id:operationId,reason:values.reason,event:eventId||values.event||'',
      quantity:Math.round(Number(values.value)*1000),expected_balance:product.balance,reverse:original?.id
    }));
}
function stockHistory(product){
  const moves=db.movimentos.filter(move=>move.product===product.id).slice().reverse();
  const value=move=>[move.created_at.replace('T',' '),movementLabel[move.movement],quantity(move.delta),
    quantity(move.balance),move.unit||product.unit,move.reason,move.actor,byId('agenda',move.event)?.title,move.reversed_by?'Estornado':''];
  const rows=moves.map(move=>{
    const values=value(move);
    return row([...values.map(v=>esc(v||'—')),product.active&&move.movement!=='estorno'&&!move.reversed_by?
      btn('Estornar',()=>movementForm(product,'estorno',move),'danger'):'']);
  });
  const headers=['Data','Movimento','Variação','Saldo após','Unidade','Motivo','Operador','Compromisso','Situação'];
  return '<section class="ops-table"><div class="row ops-heading"><h2>Histórico de movimentação</h2>'+
    btn('Exportar CSV',()=>csv('Movimentos-'+product.sku,headers,moves.map(value)))+'</div>'+
    table([...headers,'Ação'],rows,'Nenhuma movimentação registrada.')+'</section>';
}
function stock(){
  const product=byId('produtos',stockId);
  if(product)return '<div class="ops-breadcrumb">'+btn('Voltar ao estoque',()=>{stockId='';render()},'text-link')+'</div>'+
    '<div class="page-title"><div><h1>'+esc(product.name)+'</h1><p class="muted">'+esc([product.sku,product.category,product.location].filter(Boolean).join(' · '))+'</p></div><div class="row">'+
    btn('Editar produto',()=>productForm(product))+
    (product.active?btn('Registrar entrada',()=>movementForm(product,'entrada'),'primary')+btn('Registrar saída',()=>movementForm(product,'saida'))+
     btn('Contagem física',()=>movementForm(product,'contagem')):'')+'</div></div>'+
    '<div class="metrics">'+metric('Saldo',quantity(product.balance)+' '+product.unit)+metric('Estoque mínimo',quantity(product.minimum)+' '+product.unit)+
    metric('Valor estimado',money(Math.round(product.balance*product.cost/1000)))+'</div>'+stockHistory(product);
  const products=sortedByName(db.produtos,'name');
  const active=products.filter(p=>p.active);
  const low=active.filter(p=>p.balance<=p.minimum);
  return '<div class="page-title"><h1>Estoque</h1>'+btn('Novo produto',()=>productForm(),'primary')+'</div>'+
    '<div class="metrics">'+metric('Produtos ativos',active.length)+metric('Para reposição',low.length)+
    metric('Valor estimado',money(active.reduce((sum,p)=>sum+Math.round(p.balance*p.cost/1000),0)))+'</div>'+
    '<section class="ops-table">'+tabs(['Ativos','Reposição','Arquivados'],stockFilter,value=>{stockFilter=value;render()})+
    '<div class="row ops-controls"><label>Buscar produto<input id="stock-search" type="search" value="'+esc(stockQuery)+'" placeholder="Nome, código ou categoria"></label>'+
    btn('Exportar reposição',()=>csv('Reposicao',['Código','Produto','Localização','Saldo','Mínimo','Unidade'],
      low.map(p=>[p.sku,p.name,p.location,quantity(p.balance),quantity(p.minimum),p.unit])))+'</div>'+
    '<div id="stock-rows">'+stockRows(products)+'</div></section>';
}
function stockRows(products){
  const filtered=products.filter(p=>(stockFilter==='Arquivados'?!p.active:p.active&&(stockFilter!=='Reposição'||p.balance<=p.minimum))&&
    normalize([p.name,p.sku,p.category,p.location].join(' ')).includes(normalize(stockQuery.trim())));
  return table(['Produto','Categoria','Localização','Saldo','Mínimo','Situação'],filtered.map(p=>row([
    btn(p.name,()=>{stockId=p.id;render()},'text-link')+'<small>'+esc(p.sku)+'</small>',esc(p.category||'—'),
    esc(p.location||'—'),esc(quantity(p.balance)+' '+p.unit),esc(quantity(p.minimum)),
    !p.active?statusChip('Arquivado'):p.balance<=p.minimum?statusChip('Repor','amber'):statusChip('Em estoque','green')
  ])),'Nenhum produto neste filtro.');
}
function stockForEvent(event){
  if(me.role!=='Administrador')return '';
  const linked=db.movimentos.filter(m=>m.event===event.id&&m.movement==='saida'&&!m.reversed_by);
  const products=sortedByName(db.produtos.filter(p=>p.active&&p.balance>0),'name');
  if(!linked.length&&!products.length)return '';
  const action=()=>modal('Material utilizado',[field('product','Produto','select',products.map(p=>[p.id,p.name+' · '+quantity(p.balance)+' '+p.unit]))],{},values=>
    movementForm(byId('produtos',values.product),'saida',null,event.id));
  return '<div class="ops-inline"><div><strong>Materiais utilizados</strong>'+
    linked.map(m=>'<p>'+esc((byId('produtos',m.product)?.name||'Produto')+' · '+quantity(-m.delta))+'</p>').join('')+'</div>'+
    (products.length&&event.status!=='Cancelado'?btn('Registrar consumo',action):'')+'</div>';
}

function courseForm(course){
  modal(course?'Editar curso':'Novo curso',[
    req('title','Nome do curso'),field('syllabus','Ementa','area'),integerField('hours','Carga horária (h)',1,5000),
    integerField('minimum','Frequência mínima (%)',0,100),
    field('status','Situação','select',['Ativo','Arquivado'])
  ],course?{...course,status:course.active?'Ativo':'Arquivado'}:{hours:12,minimum:75},
  values=>runOperation('curso',{
    ...values,hours:Number(values.hours),minimum:Number(values.minimum),id:course?.id,previous:course,active:values.status==='Ativo'
  }));
}
function classForm(klass,courseId=''){
  const courses=sortedByName(db.cursos.filter(c=>c.active||c.id===klass?.course_id),'title');
  if(!courses.length){courseForm();return}
  const fields=[
    field('course_id','Curso','select',courses.map(c=>[c.id,c.title])),req('title','Nome da turma'),
    req('teacher','Instrutor'),field('room','Sala ou local'),req('start','Início do período','date'),
    req('end','Fim do período','date'),integerField('capacity','Vagas',1,10000),
    monetaryField('fee','Taxa de matrícula (R$)'),field('status','Situação','select',['Aberta','Em andamento','Encerrada'])
  ];
  modal(klass?'Editar turma':'Nova turma',fields,klass?{...klass,fee:decimal(klass.fee)}:{
    course_id:courseId,teacher:me.name,start:today(),end:offsetDate(today(),90),capacity:20
  },values=>runOperation('turma',{...values,capacity:Number(values.capacity),fee:cents(values.fee),id:klass?.id,previous:klass},
    result=>{classId=result.id;academicView='Turmas'}));
}
function openClass(id){
  dlg.close();
  classId=id;
  personId='';
  academicView='Turmas';
  tab='Ensino';
  render();
}
function enrollmentForm(klass,previous=null,pid=''){
  const roster=db.matriculas.filter(m=>m.class_id===klass.id);
  const students=sortedByName(db.pessoas.filter(p=>['Aluno','Aluno e cliente'].includes(p.tipo)&&
    !roster.some(m=>m.pid===p.id)),'nome');
  if(!previous&&!students.length){notify('Todos os alunos cadastrados já têm matrícula nesta turma.');return}
  const statusOptions=previous?[...enrollmentStates]:enrollmentStates.slice(0,2);
  if(klass.status==='Encerrada'&&previous){
    statusOptions.splice(0,2);
    if(!statusOptions.includes(previous.status))statusOptions.unshift(previous.status);
  }
  const fields=[field('status','Situação','select',statusOptions)];
  if(!previous)fields.unshift(field('pid','Aluno','select',students.map(p=>[p.id,p.nome])));
  modal(previous?'Gerenciar matrícula · '+person(previous.pid).nome:'Matricular aluno',fields,
    previous||{pid,status:enrolledCount(roster)>=klass.capacity?'Em espera':'Matriculada'},
    values=>runOperation('matricula',{...values,pid:previous?.pid||values.pid,class_id:klass.id,previous}));
}
function transferForm(klass,entry){
  const options=db.turmas.filter(other=>other.id!==klass.id&&other.course_id===klass.course_id&&other.status!=='Encerrada')
    .map(other=>[other.id,other.title]);
  if(!options.length){notify('Crie outra turma aberta do mesmo curso.');return}
  modal('Transferir '+person(entry.pid).nome,[field('target','Turma de destino','select',options)],{},
    values=>runOperation('transferir',{...values,id:entry.id,previous:entry}));
}
function lessonForm(klass){
  modal('Agendar aulas · '+klass.title,[
    req('title','Assunto da aula'),req('day','Data da primeira aula','date'),req('start','Início','time'),
    req('end_time','Término','time'),integerField('count','Número de aulas semanais',1,40)
  ],{day:klass.start,start:'19:00',end_time:'20:30',count:1},values=>runOperation('aulas',{
    ...values,class_id:klass.id,count:Number(values.count),operation_id:uid()
  },null,'Aulas gravadas na agenda.'));
}
function attendanceForm(event){
  const enrollment=db.matriculas.filter(m=>m.class_id===event.class_id&&['Matriculada','Concluída'].includes(m.status));
  const students=enrollment.map(m=>person(m.pid)).filter(Boolean).sort((a,b)=>byName(a.nome,b.nome));
  const fields=students.map(p=>field(p.id,p.nome,'select',[['','Selecione'], 'Presente','Falta','Justificada'],true));
  const initial=Object.fromEntries(students.map(p=>[p.id,event.attendance?.[p.id]||'']));
  modal('Chamada · '+event.title,fields,initial,values=>runOperation('chamada',{
    id:event.id,previous:event,attendance:values
  },null,'Chamada registrada.'));
  if(!students.length)form.querySelector('.form-layout').innerHTML='<p class="muted">A turma ainda está sem alunos matriculados.</p>';
}
function enrolledCount(roster){return roster.filter(m=>['Matriculada','Concluída'].includes(m.status)).length}
function frequency(meetings,entry){
  if(entry.completion){
    const {present,total}=entry.completion;
    return {present,total};
  }
  const held=meetings.filter(event=>event.status==='Realizado');
  return {present:held.filter(event=>event.attendance?.[entry.pid]==='Presente').length,total:held.length};
}
function classRoster(klass,roster,meetings){
  const ordered=roster.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const wait=ordered.filter(m=>m.status==='Em espera');
  const rows=ordered.map(entry=>{
    const p=person(entry.pid);
    const {present,total}=frequency(meetings,entry);
    const charge=findBill('matricula',entry.id);
    const label=entry.status==='Em espera'?'Espera · '+(wait.indexOf(entry)+1)+'º':entry.status;
    return row([
      btn(p.nome,()=>openPerson(p),'text-link'),statusChip(label,entry.status==='Concluída'?'green':entry.status==='Em espera'?'amber':'neutral'),
      esc(total?present+'/'+total+' · '+Math.round(present*100/total)+'%':'—'),esc(br(entry.date)),
      btn('Gerenciar',()=>enrollmentForm(klass,entry))+
      (entry.status==='Matriculada'?btn('Transferir',()=>transferForm(klass,entry)):'')+
      (entry.status==='Concluída'?btn('Declaração PDF',()=>downloadDocument('conclusao/'+entry.id,'Declaracao-'+p.nome)):'')+
      (charge&&canFinance()?btn('Cobrança',()=>openFinance('',charge.id)):'')
    ]);
  });
  const exportRows=()=>csv('Turma-'+klass.title,['Aluno','Situação','Matrícula','Presenças','Aulas realizadas','Frequência (%)'],ordered.map(entry=>{
    const {present,total}=frequency(meetings,entry);
    return [person(entry.pid)?.nome,entry.status,br(entry.date),present,total,total?Math.round(present*100/total):''];
  }));
  return '<section class="ops-table"><div class="row ops-heading"><h2>Matrículas e frequência</h2>'+
    btn('Exportar lista CSV',exportRows)+(klass.status!=='Encerrada'?btn('Matricular aluno',()=>enrollmentForm(klass),'primary'):'')+'</div>'+
    table(['Aluno','Situação','Frequência','Data','Ações'],rows,'Nenhuma matrícula nesta turma.')+'</section>';
}
function lessons(klass,meetings){
  const ordered=meetings.slice().sort((a,b)=>(a.day+a.start).localeCompare(b.day+b.start));
  const rows=ordered.map(event=>row([
    esc(br(event.day)+' · '+event.start+'–'+event.end),
    btn(event.title,()=>detail(event),'text-link'),esc(event.owner),statusChip(event.status,statusTone(event.status)),
    event.status!=='Cancelado'&&event.day<=today()?btn('Chamada',()=>attendanceForm(event)):''
  ]));
  return '<section class="ops-table"><div class="row ops-heading"><h2>Aulas na agenda</h2>'+
    (klass.status!=='Encerrada'?btn('Agendar aulas',()=>lessonForm(klass),'primary'):'')+'</div>'+
    table(['Data e horário','Aula','Instrutor','Situação','Ações'],rows,'Nenhuma aula agendada.')+'</section>';
}
function classPage(klass){
  const course=byId('cursos',klass.course_id);
  const roster=db.matriculas.filter(m=>m.class_id===klass.id);
  const meetings=db.agenda.filter(event=>event.class_id===klass.id);
  return '<div class="ops-breadcrumb">'+btn('Voltar às turmas',()=>{classId='';render()},'text-link')+'</div>'+
    '<div class="page-title"><div><h1>'+esc(klass.title)+'</h1><p class="muted">'+esc(course.title)+'</p></div>'+btn('Editar turma',()=>classForm(klass))+'</div>'+
    '<div class="metrics">'+metric('Vagas ocupadas',enrolledCount(roster)+' / '+klass.capacity)+
    metric('Em espera',roster.filter(entry=>entry.status==='Em espera').length)+
    metric('Aulas realizadas',meetings.filter(event=>event.status==='Realizado').length)+'</div>'+
    '<section><div class="row"><h2>Dados da turma</h2>'+statusChip(klass.status)+'</div><dl class="detail-grid">'+
    kv('Instrutor',klass.teacher)+kv('Local',klass.room)+kv('Período',br(klass.start)+' a '+br(klass.end))+
    kv('Taxa de matrícula',klass.fee?money(klass.fee):'Gratuita')+kv('Carga horária',course.hours+' h')+
    kv('Frequência mínima',course.minimum+'%')+'</dl>'+(course.syllabus?'<details class="ops-details"><summary>Ementa</summary><p>'+esc(course.syllabus)+'</p></details>':'')+'</section>'+
    classRoster(klass,roster,meetings)+lessons(klass,meetings);
}
function academic(){
  const klass=byId('turmas',classId);
  if(klass)return classPage(klass);
  const classes=sortedByName(db.turmas,'title'), courses=sortedByName(db.cursos,'title');
  const catalog=academicView==='Cursos';
  const current=byId('cursos',courseFilter);
  const catalogRows=courses.map(course=>row([
    btn(course.title,()=>courseForm(course),'text-link')+'<small>'+course.hours+' h · '+course.minimum+'% de frequência</small>',
    statusChip(course.active?'Ativo':'Arquivado',course.active?'green':'neutral'),
    String(classes.filter(k=>k.course_id===course.id).length),
    btn('Ver turmas',()=>{courseFilter=course.id;academicView='Turmas';render()})+
      (course.active?btn('Criar turma',()=>classForm(null,course.id)):'')
  ]));
  const classRows=classes.filter(k=>!current||k.course_id===current.id).map(klass=>{
    const roster=db.matriculas.filter(m=>m.class_id===klass.id);
    return row([
      btn(klass.title,()=>openClass(klass.id),'text-link')+'<small>'+esc(byId('cursos',klass.course_id)?.title)+'</small>',
      esc(klass.teacher)+(klass.room?'<small>'+esc(klass.room)+'</small>':''),
      esc(br(klass.start)+' a '+br(klass.end)),esc(enrolledCount(roster)+' / '+klass.capacity),
      statusChip(klass.status,klass.status==='Encerrada'?'neutral':'green')
    ]);
  });
  return '<div class="page-title"><h1>Ensino</h1><div class="row">'+btn('Novo curso',()=>courseForm(),catalog?'primary':'')+
    btn('Nova turma',()=>classForm(null,courseFilter),catalog?'':'primary')+'</div></div>'+
    tabs(['Turmas','Cursos'],academicView,value=>{academicView=value;courseFilter='';render()})+
    '<section class="ops-table"><div class="row ops-heading"><h2>'+esc(catalog?'Cursos':current?'Turmas de '+current.title:'Turmas')+'</h2>'+
    (!catalog&&current?btn('Ver todas',()=>{courseFilter='';render()}):'')+'</div>'+
    (catalog?table(['Curso','Situação','Turmas','Ações'],catalogRows,'Nenhum curso cadastrado.'):
      table(['Turma / curso','Instrutor / local','Período','Vagas ocupadas','Situação'],classRows,'Nenhuma turma encontrada.'))+'</section>';
}
function personAcademic(p){
  const roster=db.matriculas.filter(m=>m.pid===p.id);
  if(!['Aluno','Aluno e cliente'].includes(p.tipo)&&!roster.length)return '';
  const options=db.turmas.filter(k=>k.status!=='Encerrada'&&!roster.some(m=>m.class_id===k.id));
  const add=()=>modal('Vincular turma',[field('class_id','Turma','select',options.map(k=>[k.id,k.title]))],{},values=>
    enrollmentForm(byId('turmas',values.class_id),null,p.id));
  const rows=roster.map(entry=>{
    const klass=byId('turmas',entry.class_id);
    return row([btn(klass.title,()=>openClass(klass.id),'text-link'),esc(byId('cursos',klass.course_id)?.title),statusChip(entry.status)]);
  });
  return '<article class="casebook"><div class="row"><h2>Turmas do aluno</h2>'+
    (options.length?btn('Vincular turma',add):'')+'</div>'+table(['Turma','Curso','Matrícula'],rows,'Nenhuma turma vinculada.')+'</article>';
}
function classEventActions(event){
  if(!event.class_id)return '';
  return '<div class="ops-inline"><div><strong>Aula da turma</strong><p>'+esc(byId('turmas',event.class_id)?.title)+'</p></div><div class="row">'+
    btn('Abrir turma',()=>openClass(event.class_id))+
    (event.status!=='Cancelado'&&event.day<=today()?btn('Fazer chamada',()=>attendanceForm(event),'primary'):'')+'</div></div>';
}
function operationsQueue(){
  if(me.role!=='Administrador')return '';
  const drafts=db.contas.filter(entry=>billStatus(entry)==='draft').length;
  const review=db.contas.filter(entry=>entry.review).length;
  const low=db.produtos.filter(item=>item.active&&item.balance<=item.minimum).length;
  function openQueue(filter){openFinance();financeFilter=filter;render()}
  const entry=(label,count,handler)=>count?'<div class="row ops-queue-item">'+btn(label,handler,'text-link')+statusChip(String(count),'amber')+'</div>':'';
  if(!drafts&&!review&&!low)return '';
  return '<div class="queue"><h3>Financeiro e estoque</h3>'+
    entry('Cobranças para ajustar',drafts,()=>openQueue('Rascunhos'))+
    entry('Cancelamentos com baixa',review,()=>openQueue('Em revisão'))+
    entry('Produtos para repor',low,()=>{stockId='';stockFilter='Reposição';tab='Estoque';render()})+'</div>';
}
function wireOperations(){
  const search=$('stock-search');
  if(stockId&&!byId('produtos',stockId))stockId='';
  if(search)search.oninput=()=>{
    stockQuery=search.value;
    $('stock-rows').innerHTML=stockRows(sortedByName(db.produtos,'name'));
  };
  const month=$('finance-month');
  if(month)month.onchange=()=>{financeMonth=month.value;render()};
}
