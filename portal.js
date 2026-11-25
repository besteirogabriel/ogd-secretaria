'use strict';

const root=document.getElementById('portal');
const account=document.getElementById('account');
const cancelDialog=document.getElementById('cancel-dialog');
const feedback=document.getElementById('feedback');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=(day,options)=>new Date(day+'T12:00:00').toLocaleDateString('pt-BR',options);
const dayName=day=>when(day,{weekday:'long',day:'numeric',month:'long'});
const inBrazil=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const button=(label,action,value='',cls='')=>'<button type="button" class="'+cls+'" data-action="'+action+'" data-value="'+esc(value)+'">'+esc(label)+'</button>';
const attendee=()=>user?.role==='Participante';
const preview=()=>user&&!attendee();
const reservationDate=entry=>entry.day+'T'+entry.start;
const pending=entry=>['Agendado','Confirmado'].includes(entry.status);
const tone=status=>({Confirmado:'green',Realizado:'blue',Faltou:'amber',Cancelado:'neutral'}[status]||'red');

let user,slots=[],mine=[],view='schedule',step=1,service='',day='',choice=null;
let changeId='',authMode='login',authValues={},confirmation=null,busy=false;
let historyOpen=false, bills=[];
const currency=amount=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(amount/100);
function bookingPrice(slot){
  if(slot.free)return 'Gratuito';
  return slot.fee>0?currency(slot.fee):'A confirmar pela secretaria';
}

async function request(path,body){
  const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  const response=await fetch(path,options);
  const data=await response.json();
  if(!response.ok){
    const error=Error(data.error||'Falha na conexão.');
    error.status=response.status;
    throw error;
  }
  return data;
}
async function reload(){
  user=(await request('/session')).user;
  [slots,mine,bills]=await Promise.all([
    request('/horarios'+(changeId?'?reserva='+encodeURIComponent(changeId):'')).then(data=>data.slots),
    attendee()?request('/minhas-reservas'):Promise.resolve([]),
    attendee()?request('/minhas-cobrancas'):Promise.resolve([])
  ]);
}
function reset(){
  view='schedule';
  step=1;
  service='';
  day='';
  choice=null;
  changeId='';
  authValues={};
}
function summary(){
  const s=choice||slots.find(slot=>slot.rule===service);
  if(!s)return '';
  const current=mine.find(entry=>entry.id===changeId);
  const dateTime=choice?dayName(choice.day)+' · '+choice.start+'–'+choice.end:'Escolha um horário';
  return '<aside class="ticket"><h2 class="ticket-title">Resumo da reserva</h2><dl><dt>Atendimento</dt><dd>'+esc(s.title)+'</dd><dt>Responsável</dt><dd>'+esc(s.owner)+'</dd><dt>Local</dt><dd>'+esc(s.room||'Templo')+'</dd><dt>'+ (current?'Novo horário':'Data e horário')+'</dt><dd>'+esc(dateTime)+'</dd>'+
   '<dt>Valor previsto</dt><dd>'+esc(bookingPrice(s))+'</dd>'+
   (current?'<dt>Horário atual</dt><dd>'+esc(dayName(current.day)+' · '+current.start)+'</dd>':'')+'</dl><small>Horários de Brasília</small></aside>';
}
function stages(){
  return '<ol class="stages" aria-label="Etapas do agendamento">'+['Atendimento','Horário','Confirmação'].map((name,i)=>{
    const stage=i+1;
    return '<li '+(step===stage?'aria-current="step" ':'')+'class="'+(step===stage?'current':step>stage?'past':'')+'"><span>'+stage+'</span>'+
     (step>stage?button(name,stage===1?'back1':'back2'):name)+'</li>';
  }).join('')+'</ol>';
}
function services(){
  const firstByService=new Map();
  for(const slot of slots)if(!firstByService.has(slot.rule))firstByService.set(slot.rule,slot);
  if(!firstByService.size)return '<h2>Sem horários disponíveis</h2><p class="muted">A secretaria ainda não abriu novas vagas.</p>'+button('Atualizar horários','refresh');
  return '<h2>Escolha o atendimento</h2>'+[...firstByService.values()].map(s=>{
    const [startH,startM]=s.start.split(':').map(Number),[endH,endM]=s.end.split(':').map(Number);
    const duration=(endH-startH)*60+endM-startM;
    return '<button class="service-card" data-action="service" data-value="'+esc(s.rule)+'"><span><strong>'+esc(s.title)+'</strong><small>'+esc(s.owner)+' · '+esc(s.room||'Templo')+' · '+duration+' min</small><small>'+esc(bookingPrice(s))+'</small><small class="availability">Próxima vaga em '+esc(when(s.day,{day:'2-digit',month:'short'}))+' às '+esc(s.start)+'</small></span><span>Escolher ›</span></button>';
  }).join('');
}
function times(){
  const current=mine.find(entry=>entry.id===changeId);
  const choices=slots.filter(slot=>slot.rule===service&&(!current||reservationDate(slot)!==reservationDate(current)));
  const dates=[...new Set(choices.map(slot=>slot.day))];
  if(!dates.includes(day))day=dates[0]||'';
  if(!day)return '<h2>Horários preenchidos</h2><p>Escolha outro atendimento ou atualize as vagas.</p>'+button('Ver atendimentos','back1');
  return '<div class="row"><h2>Escolha a data e o horário</h2>'+button('Atualizar horários','refresh','','subtle')+'</div>'+
   '<div class="date-strip" aria-label="Datas disponíveis">'+dates.map(d=>'<button data-action="day" data-value="'+d+'" aria-pressed="'+(d===day)+'" aria-label="'+esc(dayName(d))+'" class="'+(d===day?'selected':'')+'"><span>'+esc(when(d,{weekday:'short'}))+'</span><strong>'+d.slice(-2)+'</strong><span>'+esc(when(d,{month:'short'}))+'</span></button>').join('')+'</div>'+
   '<h3>'+esc(dayName(day))+'</h3><div class="times">'+choices.filter(s=>s.day===day).map(s=>button(s.start+' – '+s.end,'time',s.start)).join('')+'</div>';
}
function credentials(){
  const signup=authMode==='signup';
  const value=name=>esc(authValues[name]||'');
  return '<div class="tabs">'+button('Entrar','login','',signup?'':'active')+button('Criar conta','signup','',signup?'active':'')+'</div>'+
   '<form id="credentials">'+(signup?'<label>Nome completo<input name="name" value="'+value('name')+'" autocomplete="name" required maxlength="120"></label><div class="form-pair"><label>Telefone com DDD<input name="tel" value="'+value('tel')+'" type="tel" autocomplete="tel" required minlength="7" maxlength="32"></label><label>Vínculo<select name="tipo"><option>Aluno</option><option '+(authValues.tipo==='Cliente'?'selected':'')+'>Cliente</option></select></label></div>':'')+
   '<label>E-mail<input name="email" value="'+value('email')+'" type="email" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="'+(signup?'new-password':'current-password')+'" '+(signup?'minlength="12" placeholder="Mínimo de 12 caracteres"':'')+' required maxlength="256"></label><div role="alert" id="form-error"></div><button class="primary">'+(signup?'Criar minha conta':'Entrar na minha conta')+'</button></form>';
}
function confirmStep(){
  if(preview())return '<h2>Confirmação do participante</h2><p>Entre com uma conta de aluno ou cliente para concluir a reserva.</p>';
  if(!attendee())return '<h2>Entre para reservar</h2>'+credentials();
  const pair=(label,value)=>'<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>';
  return '<h2>Confira o agendamento</h2><dl class="review">'+pair('Participante',user.name)+pair('Atendimento',choice.title)+pair('Data',dayName(choice.day))+pair('Horário',choice.start+' – '+choice.end)+pair('Responsável',choice.owner)+pair('Local',choice.room||'Templo')+pair('Valor previsto',bookingPrice(choice))+'</dl>'+
   '<div class="row">'+button(changeId?'Confirmar remarcação':'Confirmar reserva','book','','primary')+button('Alterar horário','back2')+'</div>';
}
function myBookings(){
  const sorted=mine.slice().sort((a,b)=>reservationDate(a).localeCompare(reservationDate(b)));
  const localNow=inBrazil.format(new Date()).replace(' ','T');
  const upcoming=entry=>pending(entry)&&reservationDate(entry)>localNow;
  const rows=(entries)=>entries.map(e=>{
    const editable=e.source==='Portal'&&upcoming(e)&&!e.arrived_at;
    const date=' <time datetime="'+esc(e.day)+'">'+esc(dayName(e.day))+'</time>';
    return '<article class="reservation"><div class="date-tile" aria-hidden="true"><strong>'+e.day.slice(-2)+'</strong><small>'+esc(when(e.day,{month:'short'}))+'</small></div><div>'+ '<span class="status-tag '+tone(e.status)+'">'+esc(e.status)+'</span><h3>'+esc(e.title)+'</h3><p>'+date+' · '+esc(e.start)+'–'+esc(e.end)+' · '+esc(e.owner)+' · '+esc(e.room||'Templo')+'</p>'+
     (upcoming(e)?button('Adicionar ao calendário','ics',e.id):'')+
     (editable?button('Remarcar','change',e.id)+button('Cancelar reserva','cancel',e.id,'danger'):'')+'</div></article>';
  }).join('');
  const past=sorted.filter(e=>!upcoming(e)).reverse();
  return '<div class="page-heading"><h1>Meus agendamentos</h1>'+button('Agendar atendimento','new','','primary')+'</div><section><h2>Próximos atendimentos</h2>'+ (rows(sorted.filter(upcoming))||'<p class="muted">Nenhum atendimento agendado.</p>')+'</section>'+
   (past.length?'<section><div class="row"><h2>Histórico</h2>'+button(historyOpen?'Ocultar histórico':'Mostrar histórico ('+past.length+')','history')+'</div>'+(historyOpen?rows(past):'')+'</section>':'');
}
function myBills(){
  const labels={open:'Em aberto',partial:'Pagamento parcial',paid:'Baixada'};
  const items=bills.slice().sort((a,b)=>a.due.localeCompare(b.due));
  return '<div class="page-heading"><h1>Minhas cobranças</h1></div><section>'+
    (items.length?items.map(bill=>'<article class="reservation"><div class="date-tile"><strong>'+bill.due.slice(-2)+'</strong><small>'+esc(when(bill.due,{month:'short'}))+'</small></div>'+
      '<div><span class="status-tag '+(bill.state==='paid'?'green':'amber')+'">'+esc(labels[bill.state])+'</span><h3>'+esc(bill.descricao)+'</h3>'+
      '<p>Vencimento: '+esc(when(bill.due))+' · Valor: '+esc(currency(bill.cents))+' · Saldo: '+esc(currency(bill.cents-bill.received))+'</p></div></article>').join(''):
      '<p class="muted">Nenhuma cobrança confirmada pela secretaria.</p>')+'</section>';
}
function render(){
  account.innerHTML=attendee()?button('Meus agendamentos','mine')+button('Minhas cobranças','bills')+button('Sair','out'):
   preview()?'<a class="portal-link" href="/">Voltar à secretaria</a>':button('Minha conta','auth');
  let content;
  if(view==='mine'&&attendee())content=myBookings();
  else if(view==='bills'&&attendee())content=myBills();
  else if(view==='auth')content='<div class="login-panel"><h1>Minha conta</h1>'+credentials()+button('Voltar aos horários','new')+'</div>';
  else{
    content='<div class="page-heading"><h1>'+(changeId?'Remarcar atendimento':'Agendar atendimento')+'</h1></div>'+stages()+
     '<div class="booking-layout '+(!service?'no-summary':'')+'"><section class="booking-panel">'+(step===1?services():step===2?times():confirmStep())+'</section>'+summary()+'</div>';
  }
  root.innerHTML=(preview()?'<p class="preview-banner">Prévia da secretaria. Use uma janela privativa para testar como participante.</p>':'')+
   (confirmation?'<div class="result" role="status"><strong>'+esc(confirmation.message)+'</strong>'+(confirmation.entry?esc(confirmation.entry.title)+' · '+esc(dayName(confirmation.entry.day))+' às '+esc(confirmation.entry.start):'')+'</div>':'')+content;
  const selectedDay=root.querySelector('.date-strip .selected');
  if(selectedDay)selectedDay.parentElement.scrollLeft=Math.max(0,selectedDay.offsetLeft-selectedDay.parentElement.offsetLeft-20);
}
function rememberFields(){
  const form=root.querySelector('#credentials');
  if(!form)return;
  const fields=Object.fromEntries(new FormData(form));
  delete fields.password;
  authValues={...authValues,...fields};
}
function downloadCalendar(entry){
  const clean=value=>String(value||'').replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(',','\\,').replaceAll(';','\\;');
  const stamp=time=>entry.day.replaceAll('-','')+'T'+time.replace(':','')+'00';
  const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OGD//Portal//PT-BR','BEGIN:VEVENT','UID:'+entry.id+'@ogd','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z'),
    'DTSTART;TZID=America/Sao_Paulo:'+stamp(entry.start),'DTEND;TZID=America/Sao_Paulo:'+stamp(entry.end),'SUMMARY:'+clean(entry.title),'LOCATION:'+clean(entry.room),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='Atendimento-'+entry.day+'.ics';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
async function handle(action,value){
  if(action==='cancel'){
    const entry=mine.find(e=>e.id===value);
    if(!entry)return;
    document.getElementById('cancel-summary').textContent=entry.title+' · '+dayName(entry.day)+' às '+entry.start;
    cancelDialog.returnValue='keep';
    cancelDialog.showModal();
    await new Promise(resolve=>cancelDialog.addEventListener('close',resolve,{once:true}));
    if(cancelDialog.returnValue!=='cancel')return;
    await request('/reservar',{id:value,cancel:true});
    confirmation={message:'Reserva cancelada.'};
    await reload();
    render();
    return;
  }
  confirmation=null;
  if(action==='new'){reset();await reload()}
  if(action==='auth'){view='auth';authMode='login'}
  if(action==='mine'){reset();await reload();view=attendee()?'mine':'auth'}
  if(action==='bills'){reset();await reload();view=attendee()?'bills':'auth'}
  if(action==='history')historyOpen=!historyOpen;
  if(action==='signup'||action==='login'){rememberFields();authMode=action}
  if(action==='out'){await request('/logout',{});reset();await reload()}
  if(action==='service'){service=value;day='';choice=null;step=2}
  if(action==='day')day=value;
  if(action==='time'){choice=slots.find(s=>s.rule===service&&s.day===day&&s.start===value);if(choice)step=3}
  if(action==='back1'){step=1;service='';day='';choice=null}
  if(action==='back2'){step=2;choice=null}
  if(action==='refresh')await reload();
  if(action==='change'){
    reset();changeId=value;await reload();
    if(slots.length){service=slots[0].rule;step=2}
  }
  if(action==='ics'){const entry=mine.find(e=>e.id===value);if(entry)downloadCalendar(entry)}
  if(action==='book'){
    const entry=await request('/reservar',{rule:choice.rule,day:choice.day,start:choice.start,id:changeId});
    confirmation={entry,message:changeId?'Remarcação confirmada.':'Reserva confirmada.'};
    reset();
    view='mine';
    await reload();
  }
  render();
}

document.addEventListener('click',async event=>{
  const trigger=event.target.closest('[data-action]');
  if(!trigger||busy)return;
  busy=true;
  trigger.disabled=true;
  feedback.textContent='';
  try{
    await handle(trigger.dataset.action,trigger.dataset.value);
  }catch(error){
    if(error.status===409&&trigger.dataset.action==='book'){
      try{await reload();step=2;choice=null;render()}catch{}
    }
    if(error.status===401){user=null;render()}
    feedback.textContent=error.message;
  }finally{
    busy=false;
    trigger.disabled=false;
  }
});
root.addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy)return;
  busy=true;
  const form=event.target,submit=form.querySelector('button');
  submit.disabled=true;
  feedback.textContent='';
  try{
    await request(authMode==='signup'?'/inscricao':'/login',Object.fromEntries(new FormData(form)));
    authValues={};
    await reload();
    if(view==='auth')view='mine';
    render();
  }catch(error){form.querySelector('#form-error').textContent=error.message}
  finally{busy=false;submit.disabled=false}
});
reload().then(render).catch(error=>{
  root.innerHTML='<section><h1>Horários indisponíveis</h1><p>'+esc(error.message)+'</p>'+button('Tentar novamente','refresh')+'</section>';
});
