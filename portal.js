'use strict';
const root=document.querySelector('#portal'), account=document.querySelector('#account');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=(day,options)=>new Date(day+'T12:00:00').toLocaleDateString('pt-BR',options);
const dayName=d=>when(d,{weekday:'long',day:'numeric',month:'long'});
let user,slots=[],mine=[],view='schedule',step=1,service='',day='',choice=null,changeId='',authMode='login',alertMessage='',busy=false;
async function request(path,body){
 const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok){const error=Error(data.error||'Falha na conexão.');error.status=response.status;throw error}
 return data;
}
async function reload(){
 const session=await request('/session');user=session.user;
 [slots,mine]=await Promise.all([request('/horarios').then(x=>x.slots),user?.role==='Participante'?request('/minhas-reservas'):Promise.resolve([])]);
}
const button=(label,action,value='',cls='')=>'<button type="button" class="'+cls+'" data-action="'+action+'" data-value="'+esc(value)+'">'+esc(label)+'</button>';
function reset(){view='schedule';step=1;service='';day='';choice=null;changeId=''}
function status(msg){document.querySelector('#feedback').textContent=msg}
function summary(){
 const s=choice||slots.find(s=>s.rule===service);
 return '<aside class="ticket"><div class="ticket-title">Resumo da reserva</div><dl><dt>Atendimento</dt><dd>'+esc(s?.title||'A selecionar')+'</dd><dt>Responsável</dt><dd>'+esc(s?.owner||'—')+'</dd><dt>Data e horário</dt><dd>'+esc(choice?dayName(choice.day)+' · '+choice.start+'–'+choice.end:'A selecionar')+'</dd><dt>Local</dt><dd>'+esc(s?.room||'Templo')+'</dd></dl><small>Horários de Brasília</small></aside>';
}
function stages(){
 return '<ol class="stages">'+['Atendimento','Horário','Confirmação'].map((s,i)=>'<li class="'+(step===i+1?'current':step>i+1?'past':'')+'"><span>'+(i+1)+'</span>'+s+'</li>').join('')+'</ol>';
}
function services(){
 const unique=[...new Map(slots.map(s=>[s.rule,s])).keys()];
 return '<h2>Escolha o atendimento</h2>'+(!unique.length?'<p class="empty">A secretaria ainda não disponibilizou horários para reserva.</p>':unique.map(id=>{
  const s=slots.find(v=>v.rule===id);return '<button class="service-card" data-action="service" data-value="'+esc(id)+'"><span><strong>'+esc(s.title)+'</strong><small>'+esc(s.owner)+' · '+esc(s.room||'Templo')+'</small><small>Próxima vaga · '+esc(when(s.day,{day:'2-digit',month:'short'}))+' às '+esc(s.start)+'</small></span><span>Selecionar ›</span></button>';
 }).join(''));
}
function times(){
 const choices=slots.filter(s=>s.rule===service), dates=[...new Set(choices.map(s=>s.day))];
 if(!dates.includes(day))day=dates[0]||'';
 return '<div class="row"><h2>Selecione o horário</h2>'+button('Trocar atendimento','back1')+'</div>'+
 '<div class="date-strip">'+dates.map(d=>button(when(d,{weekday:'short',day:'2-digit',month:'2-digit'}),'day',d,d===day?'selected':'')).join('')+'</div>'+
 (day?'<h3>'+esc(dayName(day))+'</h3>':'<p>Os horários desta agenda já foram preenchidos.</p>')+
 '<div class="times">'+choices.filter(s=>s.day===day).map(s=>button(s.start+' – '+s.end,'time',s.start)).join('')+'</div>';
}
function credentials(){
 const signup=authMode==='signup';
 return '<div class="tabs">'+button('Entrar','login','',signup?'':'active')+button('Criar conta','signup','',signup?'active':'')+'</div><form id="credentials">'+(signup?'<label>Nome completo<input name="name" autocomplete="name" required maxlength="120"></label><div class="form-pair"><label>Telefone com DDD<input name="tel" type="tel" autocomplete="tel" required minlength="7" maxlength="32"></label><label>Vínculo<select name="tipo"><option>Aluno</option><option>Cliente</option></select></label></div>':'')+'<label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="'+(signup?'new-password':'current-password')+'" '+(signup?'minlength="12" placeholder="Mínimo de 12 caracteres"':'')+' required></label><div role="alert" id="form-error"></div><button class="primary">'+(signup?'Criar minha conta':'Entrar na minha conta')+'</button></form>';
}
function confirmStep(){
 if(!user)return '<h2>Identifique-se para reservar</h2>'+credentials();
 return '<h2>Confira seu atendimento</h2><dl class="review"><dt>Participante</dt><dd>'+esc(user.name)+'</dd><dt>Atendimento</dt><dd>'+esc(choice.title)+'</dd><dt>Quando</dt><dd>'+esc(dayName(choice.day))+' · '+esc(choice.start)+' – '+esc(choice.end)+'</dd></dl><div class="row">'+button(changeId?'Confirmar remarcação':'Confirmar reserva','book','','primary')+button('Alterar horário','back2')+'</div>';
}
function myBookings(){
 const sorted=mine.slice().sort((a,b)=>(b.day+b.start).localeCompare(a.day+a.start));
 const localNow=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
 const future=e=>['Agendado','Confirmado'].includes(e.status)&&e.day+'T'+e.start>localNow;
 function row(e){
  const editable=e.source==='Portal'&&future(e);
  return '<article class="reservation"><div class="date-tile"><strong>'+e.day.slice(-2)+'</strong><small>'+esc(when(e.day,{month:'short'}))+'</small></div><div><span class="state">'+esc(e.status)+'</span><h3>'+esc(e.title)+'</h3><p>'+esc(e.start)+'–'+esc(e.end)+' · '+esc(e.owner)+' · '+esc(e.room||'Templo')+'</p>'+(editable?button('Remarcar','change',e.id)+button('Cancelar reserva','cancel',e.id):'')+'</div></article>';
 }
 const upcoming=sorted.filter(future).reverse(),past=sorted.filter(e=>!future(e));
 return '<div class="page-heading"><h1>Meus agendamentos</h1>'+button('Agendar atendimento','new','','primary')+'</div><section><h2>Próximos atendimentos</h2>'+(upcoming.map(row).join('')||'<p class="empty">Nenhum atendimento agendado.</p>')+'</section>'+(past.length?'<section><h2>Histórico</h2>'+past.map(row).join('')+'</section>':'');
}
function render(){
 account.innerHTML=user?.role==='Participante'?button('Meus agendamentos','mine')+button('Sair','out'):!user?button('Acessar minha conta','auth'):'<a href="/">Secretaria</a>';
 if(user&&user.role!=='Participante'){root.innerHTML='<h1>Portal do participante</h1><p>Você está usando uma conta da equipe. Para testar o autoagendamento, abra o link em uma janela privativa.</p><a href="/">Voltar à agenda da secretaria</a>';return}
 let content;
 if(view==='mine'&&user)content=myBookings();
 else if(view==='auth')content='<div class="login-panel"><h1>Minha conta</h1>'+credentials()+button('Voltar aos horários','new')+'</div>';
 else content='<div class="page-heading"><h1>'+(changeId?'Remarcar atendimento':'Agendar atendimento')+'</h1></div>'+stages()+'<div class="booking-layout"><section class="booking-panel">'+(step===1?services():step===2?times():confirmStep())+'</section>'+summary()+'</div>';
 root.innerHTML=(alertMessage?'<p class="result" role="status">'+esc(alertMessage)+'</p>':'')+content;
}
async function handle(action,v){
 alertMessage='';
 if(action==='new')reset();
 if(action==='auth'){view='auth';authMode='login'}
 if(action==='mine'){await reload();view=user?'mine':'auth'}
 if(action==='signup'||action==='login')authMode=action;
 if(action==='out'){await request('/logout',{});reset();await reload()}
 if(action==='service'){service=v;choice=null;step=2}
 if(action==='day')day=v;
 if(action==='time'){choice=slots.find(s=>s.rule===service&&s.day===day&&s.start===v);if(choice)step=3}
 if(action==='back1'){step=1;choice=null}
 if(action==='back2'){step=2;choice=null}
 if(action==='change'){reset();changeId=v;await reload()}
 if(action==='book'){await request('/reservar',{rule:choice.rule,day:choice.day,start:choice.start,id:changeId});alertMessage=changeId?'Remarcação confirmada.':'Reserva confirmada.';reset();view='mine';await reload()}
 if(action==='cancel'){
  if(!confirm('Cancelar este atendimento e liberar o horário?'))return;
  await request('/reservar',{id:v,cancel:true});await reload();alertMessage='Reserva cancelada.';
 }
 render();
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b||busy)return;busy=true;b.disabled=true;status('');
 try{await handle(b.dataset.action,b.dataset.value)}catch(err){status(err.message);if(err.status===409){await reload();step=2;choice=null;render()}if(err.status===401){user=null;view='auth';render()}}finally{busy=false;b.disabled=false}
});
root.addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;busy=true;const form=e.target,submit=form.querySelector('button');submit.disabled=true;
 try{await request(authMode==='signup'?'/inscricao':'/login',Object.fromEntries(new FormData(form)));await reload();if(view==='auth')view='mine';render()}
 catch(err){form.querySelector('#form-error').textContent=err.message}finally{busy=false;submit.disabled=false}
});
reload().then(render).catch(err=>root.textContent=err.message);
