'use strict';
const $=id=>document.getElementById(id), main=$('main'), dlg=$('dlg'), form=$('form');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brazilDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const uid=()=>crypto.randomUUID(), date=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'), today=()=>brazilDate.format(new Date()), br=s=>s?s.split('-').reverse().join('/'):'', money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const positions=[['Cabeça',228,326],['Corpo',228,383],['Caminhos',148,324],['Adjuntó',312,323],['Caboclo',99,172],['Preto Velho',350,175],['Marinheiro',177,195],['Sereia',274,201],['Criança',69,292],['1º Exu',126,410],['2º Exu',366,416],['Ciganos',185,442],['Egun',268,442]];
let db,version,tab='Agenda',personId='',selected=today(), actions=[],busy=false;
function action(fn){return actions.push(fn)-1}
function btn(label,fn,cls=''){return '<button type="button" class="'+cls+'" data-action="'+action(fn)+'">'+esc(label)+'</button>'}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!busy)actions[+b.dataset.action]?.()});
let me=null, team=[], audit=[], financeFilter='Em aberto', agendaMode=matchMedia('(max-width: 760px)').matches?'Lista':'Semana';
const labels={pessoas:'Cadastros',agenda:'Agenda',contas:'Financeiro'};
async function api(path,body){
 const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
 const response=await fetch(path,options),result=await response.json();
 if(!response.ok){
   if(response.status===401&&me){clearSession();await boot()}
   const error=new Error(result.error||'Falha ao comunicar com o servidor.');error.status=response.status;throw error;
 }
 return result;
}
async function load(){db=(await api('/dados')).data;render()}
async function save(change,after){
 if(busy)return;busy=true;
 try{
   const next=structuredClone(db);change(next);
   for(const kind of Object.keys(labels)){
     const existing=new Map(db[kind].map(item=>[item.id,item]));
     for(const item of next[kind]){
       const previous=existing.get(item.id)||null;
       if(JSON.stringify(previous)!==JSON.stringify(item)){
         await api('/registro',{kind,item,previous});
       }
     }
   }
   db=(await api('/dados')).data;dlg.close();after?.();render();notify('Registro salvo.');
 }catch(error){if(error.status===409&&error.message.startsWith('Registro alterado')){dlg.close();await load();notify(error.message)}else formError(error.message)}
 finally{busy=false}
}
function field(name,label,type='text',options='',required=false){return {name,label,type,options,required}}
function formError(message){
 const error=form.querySelector('[data-form-error]');
 if(error)error.textContent=message;
 else alert(message);
}
function modal(title,fields,values,submit){
 const controls=fields.map(f=>{
   const value=values[f.name]??'',attr=' name="'+f.name+'" '+(f.required?'required':'');
   let tag;
   if(f.type==='select'){
     tag='<select'+attr+'>'+f.options.map(option=>{
       const [id,label]=Array.isArray(option)?option:[option,option];
       return '<option value="'+esc(id)+'" '+(value===id?'selected':'')+'>'+esc(label)+'</option>';
     }).join('')+'</select>';
   }else if(f.type==='area')tag='<textarea'+attr+'>'+esc(value)+'</textarea>';
   else tag='<input type="'+f.type+'"'+attr+' value="'+esc(value)+'" '+(f.type==='number'?'min="'+esc(f.min??'.01')+'" step="'+esc(f.step??'.01')+'" '+(f.max!==undefined?'max="'+esc(f.max)+'"':''):'')+'>';
   return '<label class="form-field '+(['date','time'].includes(f.type)?'compact':'')+'">'+esc(f.label)+tag+'</label>';
 }).join('');
 form.innerHTML='<div class="detail-head"><h2>'+esc(title)+'</h2>'+btn('Fechar',()=>dlg.close(),'subtle')+'</div><div class="form-layout">'+controls+'</div><p class="error" data-form-error role="alert"></p><div class="row detail-actions"><button class="primary">Salvar</button>'+btn('Cancelar',()=>dlg.close())+'</div>';
 form.onsubmit=e=>{
   e.preventDefault();
   formError('');
   const values=Object.fromEntries(new FormData(form));
   for(const k in values)values[k]=fields.find(f=>f.name===k)?.type==='password'?values[k]:values[k].trim();
   if(fields.some(f=>f.required&&!values[f.name]))return formError('Preencha os campos obrigatórios.');
   submit(values);
 };
 if(!dlg.open)dlg.showModal();
}
dlg.addEventListener('close',()=>dlg.classList.remove('drawer'));
const person=(id,data=db)=>data.pessoas.find(p=>p.id===id);
const req=(k,l,t='text')=>field(k,l,t,'',true);
function editPerson(p){modal(p?'Editar cadastro':'Novo cadastro',[req('nome','Nome completo'),field('tipo','Vínculo','select',['Aluno','Cliente','Aluno e cliente']),field('nasc','Nascimento','date'),field('tel','Telefone','tel'),field('email','E-mail','email'),field('end','Endereço')],p||{},v=>{const id=p?.id||uid();save(d=>{if(p)Object.assign(person(id,d),v);else d.pessoas.push({...v,id,analysis:{data:today(),status:'Rascunho'},intro:'Durante as aulas práticas e teóricas, esta foi a configuração espiritual observada.',map:positions.map(([label])=>({label,nome:'',obs:''}))})},()=>{tab='Cadastros';personId=id;fichaPane=0})})
 const birth=form.elements.nasc;
 const hint=document.createElement('small');
 birth.after(hint);
 function refreshSign(){hint.textContent='Signo solar: '+(signoSolar(birth.value)||'informe a data de nascimento')}
 birth.oninput=refreshSign;refreshSign();
}
function analysis(p){modal('Análise inicial',[req('data','Data','date'),field('autor','Responsável'),field('motivo','Motivo da procura','area'),field('historico','Histórico e vivências espirituais','area'),field('objetivos','Expectativas da pessoa','area'),field('obs','Observações do acolhimento','area'),field('plano','Acompanhamento combinado','area'),field('status','Situação','select',['Rascunho','Concluída'])],p.analysis,v=>{if(v.status==='Concluída'&&(!v.autor||!v.motivo))return alert('Informe o responsável e o motivo da procura para concluir.');save(d=>person(p.id,d).analysis=v)})}
function slot(p,i){modal('Posição da configuração',[req('label','Posição'),field('nome','Nome ou identificação observada'),field('obs','Observações','area')],p.map[i]||{},v=>save(d=>person(p.id,d).map[i]=v))}
let fichaPane=0;
function profile(p){const a=p.analysis;const entry=(label,value)=>value?'<p><b>'+label+'</b><br>'+esc(value)+'</p>':'';
return btn('Voltar aos cadastros',()=>{personId='';render()})+'<div class="row"><h1>'+esc(p.nome)+'</h1>'+btn('Editar cadastro',()=>editPerson(p))+personFinance(p)+btn('Baixar ficha PDF',()=>downloadFicha(p),'primary')+'</div><p>'+[p.tipo,p.tel,p.email,br(p.nasc),signoSolar(p.nasc),p.end].filter(Boolean).map(esc).join(' · ')+'</p>'+caseNotes(p) +personAcademic(p)+'<section><div class="row"><h2>Análise inicial</h2>'+btn('Editar análise',()=>analysis(p))+'</div><small>'+br(a.data)+' · '+esc(a.status)+'</small>'+entry('Responsável',a.autor)+entry('Motivo da procura',a.motivo)+entry('Histórico',a.historico)+entry('Expectativas',a.objetivos)+entry('Observações',a.obs)+entry('Acompanhamento',a.plano)+'</section><section><div class="row"><h2>Configuração espiritual</h2>'+btn('Editar descrição',()=>modal('Descrição da configuração',[field('intro','Texto','area')],p,v=>save(d=>person(p.id,d).intro=v.intro)))+'</div><p>'+esc(p.intro)+'</p><div class="split"><div class="map"><img src="/mapa.png" alt="Diagrama de referência da configuração espiritual">'+positions.map(([label,x,y],i)=>'<button title="'+esc(p.map[i].label)+'" aria-label="'+esc(p.map[i].label)+'" style="left:'+x/454*100+'%;top:'+(y-130)/401*100+'%" data-action="'+action(()=>slot(p,i))+'">'+(p.map[i].nome||p.map[i].label!==label?'<span>'+esc(p.map[i].label)+'<br><b>'+esc(p.map[i].nome)+'</b></span>':'')+'</button>').join('')+'</div><div class="positions">'+p.map.map((s,i)=>'<div class="item"><div class="row"><strong>'+esc(s.label)+'</strong>'+btn('Editar',()=>slot(p,i))+'</div>'+[s.nome,s.obs].filter(Boolean).map(x=>'<p>'+esc(x)+'</p>').join('')+'</div>').join('')+btn('Adicionar posição',()=>slot(p,p.map.length))+'</div></div></section><section><div class="row"><h2>Histórico de atendimentos</h2>'+btn('Agendar',()=>eventForm(null,p.id))+'</div>'+events(db.agenda.filter(e=>e.pid===p.id).sort((a,b)=>b.day.localeCompare(a.day)||b.start.localeCompare(a.start)))+'</section>'}
function events(list){return list.length?list.map(e=>'<div class="item"><div class="row"><strong>'+esc(e.start)+' – '+esc(e.end)+' · '+esc(e.title)+'</strong>'+btn('Editar',()=>eventForm(e))+(e.pid?btn(e.note?'Editar relato':'Registrar relato',()=>note(e)):'')+'</div><small>'+br(e.day)+' · '+esc(person(e.pid)?.nome||'Atividade do templo')+' · '+esc(e.status)+' · '+esc(e.owner)+'</small>'+(e.note?'<p>'+esc(e.note)+'</p>':'')+'</div>').join(''):'<p class="muted">Nenhum atendimento neste período.</p>'}
function note(e){modal('Relato do atendimento',[req('owner','Responsável'),req('note','Relato, orientações e acompanhamento','area')],e,v=>save(d=>Object.assign(d.agenda.find(x=>x.id===e.id),v,{status:'Realizado'})))}
function eventForm(event,pid='',defaults={}){
 const people=db.pessoas.slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
 const initial=event?{...event,...defaults}:{day:selected,start:'09:00',end:'10:00',owner:me.name,pid,...defaults};
 const linked=!!(event&&(findBill('agenda',event.id)||db.cobrancas_agenda?.some(b=>b.origin_id===event.id)));
 const billingFields=event?.class_id||linked?[]:[
   field('billing_mode','Cobrança do atendimento','select',[['draft','Gerar rascunho'],['free','Gratuito']]),
   monetaryField('billing_amount','Valor previsto (R$)'),
   integerField('billing_days','Vencimento em dias após o atendimento',0,365)
 ];
 modal(event?'Editar compromisso':'Novo compromisso',[
   req('title','Atendimento ou atividade'),
   ...(!event?.class_id&&!linked?[field('pid','Participante','select',[['','Atividade interna'],...people.map(p=>[p.id,p.nome])])]:[]),
   req('day','Data','date'),req('start','Início','time'),req('end','Término','time'),
   req('owner','Responsável'),field('room','Sala ou local'),
   field('status','Situação','select',calendarStatuses),...billingFields
 ],{...initial,billing_mode:initial.free?'free':'draft',billing_amount:initial.fee==null?'':decimal(initial.fee),billing_days:initial.due_days||0},values=>{
   if(values.start>=values.end){formError('O horário de término precisa ser posterior ao início.');return}
   if(event?.note&&values.pid!==undefined&&values.pid!==event.pid){formError('O participante está vinculado ao relato deste atendimento.');return}
   const {billing_mode,billing_amount,billing_days,...visit}=values;
   const item={...event,...visit,id:event?.id||uid()};
   if(billing_mode){
     item.free=billing_mode==='free';
     item.fee=item.free||!billing_amount?null:cents(billing_amount);
     item.due_days=Number(billing_days);
   }
   if(event&&(item.day!==event.day||item.start!==event.start))delete item.arrived_at;
   save(data=>{
     if(event)data.agenda[data.agenda.findIndex(entry=>entry.id===event.id)]=item;
     else data.agenda.push(item);
   },()=>{selected=values.day;lastCalendarId=item.id});
 });
 if(billingFields.length){
   const refreshBilling=()=>{
     const assigned=!!form.elements.pid.value;
     form.elements.billing_mode.closest('label').hidden=!assigned;
     const billable=assigned&&form.elements.billing_mode.value!=='free';
     for(const name of ['billing_amount','billing_days']){
       form.elements[name].closest('label').hidden=!billable;
     }
   };
   form.elements.pid.onchange=refreshBilling;
   form.elements.billing_mode.onchange=refreshBilling;
   refreshBilling();
 }
 const startInput=form.elements.start,endInput=form.elements.end;
 let duration=minutes(initial.end)-minutes(initial.start);
 endInput.addEventListener('change',()=>{duration=minutes(endInput.value)-minutes(startInput.value)});
 startInput.addEventListener('change',()=>{
   const end=minutes(startInput.value)+duration;
   if(duration>0&&end<1440)endInput.value=clockText(end);
 });
}
const calendarStatuses=['Agendado','Confirmado','Realizado','Faltou','Cancelado'];
const calendarFilters={owner:'',room:'',status:'',source:'',query:''};
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const statusTone=status=>({Confirmado:'green',Realizado:'blue',Faltou:'amber',Cancelado:'neutral'}[status]||'red');
function statusTag(status){return '<span class="status-tag '+statusTone(status)+'">'+esc(status)+'</span>'}
function eventOrigin(event){return event.class_id?'Turma':event.source==='Portal'?'Portal':'Secretaria'}
function dateLabel(day,options){return new Date(day+'T12:00:00').toLocaleDateString('pt-BR',options)}

function signoSolar(value){
 if(!value)return '';
 const [,m,d]=value.split('-').map(Number);
 const boundaries=[20,19,21,20,21,21,23,23,23,23,22,22];
 return ['Capricórnio','Aquário','Peixes','Áries','Touro','Gêmeos','Câncer','Leão','Virgem','Libra','Escorpião','Sagitário'][(m-1+Number(d>=boundaries[m-1]))%12]||'';
}
function saveFile(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function downloadFicha(p){
 try{
  const response=await fetch('/ficha-pdf/'+encodeURIComponent(p.id));
  if(!response.ok)throw Error((await response.json()).error);
  saveFile(await response.blob(),'Ficha - '+p.nome+'.pdf');
 }catch(err){alert(err.message)}
}
function attendanceHistory(pid){
 return db.agenda.filter(e=>e.pid===pid).sort((a,b)=>(b.day+b.start).localeCompare(a.day+a.start));
}
function caseNotes(p){
 const entries=attendanceHistory(p.id), notes=entries.filter(e=>e.note?.trim());
 const pending=entries.filter(e=>e.status==='Realizado'&&!e.note);
 return '<article class="casebook"><div class="row"><h2>Relatos de atendimento</h2>'+btn('Registrar atendimento',()=>recordVisit(p))+'</div>'+
 notes.map(e=>'<div class="record"><div><time>'+br(e.day)+' · '+esc(e.start)+'</time><strong>'+esc(e.owner)+'</strong></div><div><h3>'+esc(e.title)+'</h3><p>'+esc(e.note)+'</p>'+btn('Editar relato',()=>note(e))+'</div></div>').join('')+
 (!notes.length?'<p class="muted">Nenhum relato registrado para esta pessoa.</p>':'')+
 pending.map(e=>'<div class="row item"><strong>'+br(e.day)+' · '+esc(e.title)+'</strong>'+btn('Completar relato',()=>note(e))+'</div>').join('')+'</article>';
}
function recordVisit(p){
 modal('Registrar atendimento de '+p.nome,[req('title','Atendimento'),req('day','Data','date'),req('start','Início','time'),req('end','Término','time'),req('owner','Responsável'),req('note','Relato do atendimento','area')],{day:today(),owner:me.name},v=>{
  if(v.end<=v.start)return alert('Confira o horário de término.');
  save(d=>d.agenda.push({...v,id:uid(),pid:p.id,status:'Realizado'}));
 });
}
const clockText=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
function offsetDate(key,n){const d=new Date(key+'T12:00:00');d.setDate(d.getDate()+n);return date(d)}
function matchingEvents(){
 const q=normalize(calendarFilters.query.trim());
 return db.agenda.filter(e=>
   (!calendarFilters.owner||e.owner===calendarFilters.owner)&&
   (!calendarFilters.room||e.room===calendarFilters.room)&&
   (calendarFilters.status?e.status===calendarFilters.status:e.status!=='Cancelado')&&
   (!calendarFilters.source||eventOrigin(e)===calendarFilters.source)&&
   (!q||[e.title,e.room,person(e.pid)?.nome,e.owner].some(value=>normalize(value).includes(q)))
 ).sort((a,b)=>(a.day+a.start).localeCompare(b.day+b.start));
}
let lastCalendarId='';
function detail(e){
 const active=['Agendado','Confirmado'].includes(e.status);
 const p=person(e.pid);
 const details=(label,value)=>'<div><dt>'+label+'</dt><dd>'+esc(value||'—')+'</dd></div>';
 const statusUpdate=status=>save(d=>{d.agenda.find(item=>item.id===e.id).status=status});
 const primary=!e.class_id&&active&&!e.arrived_at&&e.day<=today()?btn('Registrar chegada',()=>save(d=>{
   d.agenda.find(item=>item.id===e.id).arrived_at=new Date().toISOString();
 }),'primary'):(p&&active?btn('Registrar atendimento',()=>note(e),'primary'):'');
 form.innerHTML='<div class="detail-head"><div>'+statusTag(e.status)+' <span class="muted">'+esc(eventOrigin(e))+'</span><h2>'+esc(e.title)+'</h2><p>'+esc(dateLabel(e.day,{weekday:'long',day:'numeric',month:'long'}))+' · '+esc(e.start)+'–'+esc(e.end)+'</p></div>'+btn('Fechar',()=>dlg.close(),'subtle')+'</div><p class="error" data-form-error role="alert"></p>'+
 '<dl class="detail-grid">'+details('Participante',p?.nome||'Atividade interna')+details('Responsável',e.owner)+details('Sala ou local',e.room)+details('Chegada',e.arrived_at?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(e.arrived_at)):'')+'</dl>'+
 billCard(e)+classEventActions(e)+stockForEvent(e)+
 (e.note?'<div class="detail-note"><h3>Relato do atendimento</h3><p>'+esc(e.note)+'</p></div>':'')+
 '<div class="row detail-actions">'+primary+
 btn(active?'Editar ou reagendar':'Editar compromisso',()=>eventForm(e))+
 (p?btn('Abrir ficha',()=>{dlg.close();openPerson(p)}):'')+
 (p&&(e.note||e.status==='Realizado')?btn(e.note?'Editar relato':'Adicionar relato',()=>note(e)):'')+
 (active&&e.status==='Agendado'?btn('Confirmar agendamento',()=>statusUpdate('Confirmado')):'')+
 (!e.class_id?btn('Agendar retorno',()=>eventForm(null,e.pid,{...Object.fromEntries(['title','owner','room','start','end'].map(key=>[key,e[key]||''])),day:offsetDate(e.day,7),fee:e.fee,free:e.free,due_days:e.due_days})):'')+
 btn('Exportar .ics',()=>exportICS(e))+
 (active&&!e.class_id&&e.day<=today()?btn('Marcar falta',()=>{if(confirm('Registrar falta neste atendimento?'))statusUpdate('Faltou')}):'')+
 (active?btn('Cancelar compromisso',()=>{if(confirm('Cancelar o compromisso e liberar o horário?'))statusUpdate('Cancelado')},'danger'):'')+'</div>';
 form.onsubmit=event=>event.preventDefault();
 dlg.classList.add('drawer');if(!dlg.open)dlg.showModal();
}
function exportICS(e){
 const escapeCal=s=>String(s||'').replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
 const stamp=t=>e.day.replaceAll('-','')+'T'+t.replace(':','')+'00';
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OGD//Secretaria//PT-BR','BEGIN:VEVENT','UID:'+escapeCal(e.id)+'@ogd','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z'),'DTSTART:'+stamp(e.start),'DTEND:'+stamp(e.end),'SUMMARY:'+escapeCal(e.title),'LOCATION:'+escapeCal(e.room),'END:VEVENT','END:VCALENDAR'];
 saveFile(new Blob([lines.join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'}),'Atendimento-'+e.day+'.ics');
}
function calendarBody(){
 const entries=matchingEvents(),d=new Date(selected+'T12:00:00');
 if(agendaMode==='Mês'){
  const first=date(new Date(d.getFullYear(),d.getMonth(),1)),start=offsetDate(first,-((new Date(first+'T12:00:00').getDay()+6)%7));
  let cells=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(x=>'<strong>'+x+'</strong>').join('');
  for(let i=0;i<42;i++){
   const day=offsetDate(start,i),daily=entries.filter(e=>e.day===day);
   cells+='<div class="monthday '+(day.slice(0,7)!==first.slice(0,7)?'outside':'')+'">'+btn(String(+day.slice(-2)),()=>{selected=day;agendaMode='Dia';render()},day===today()?'active':'')+daily.slice(0,3).map(e=>btn(e.start+' '+e.title,()=>detail(e),'mini-event')).join('')+(daily.length>3?btn('Mais '+(daily.length-3),()=>{selected=day;agendaMode='Dia';render()}):'')+'</div>';
  }
  return '<div class="monthboard">'+cells+'</div>';
 }
 if(agendaMode==='Lista')return listAgenda(entries);
 const count=agendaMode==='Semana'?7:1,start=count===7?offsetDate(selected,-((d.getDay()+6)%7)):selected;
 const days=Array.from({length:count},(_,i)=>offsetDate(start,i));
 const visible=entries.filter(e=>days.includes(e.day));
 const lo=Math.min(8,...visible.map(e=>Math.floor(minutes(e.start)/60))),hi=Math.max(19,...visible.map(e=>Math.ceil(minutes(e.end)/60)));
 const axis=Array.from({length:hi-lo},(_,i)=>'<div>'+clockText((lo+i)*60)+'</div>').join('');
 const columns=days.map(day=>{
  const daily=visible.filter(e=>e.day===day);
  const slots=Array.from({length:hi-lo},(_,i)=>{const t=(lo+i)*60;return btn('Agendar '+br(day)+' às '+clockText(t),()=>eventForm(null,'',{day,start:clockText(t),end:clockText(Math.min(t+60,1439))}),'hour-slot')}).join('');
  const blocks=[];let group=[],groupEnd=-1;
  function draw(){
   const ends=[],placed=group.map(e=>{let lane=ends.findIndex(end=>end<=minutes(e.start));if(lane<0)lane=ends.length;ends[lane]=minutes(e.end);return {e,lane}});
   for(const {e,lane} of placed){
    const title=[e.start+' – '+e.end,e.title,person(e.pid)?.nome,e.owner,e.status].filter(Boolean).join(' · ');
    blocks.push('<button draggable="'+(['Agendado','Confirmado'].includes(e.status))+'" data-booking-id="'+esc(e.id)+'" class="booking '+statusTone(e.status)+(e.id===lastCalendarId?' booking-selected':'')+'" aria-label="'+esc(title)+'" title="'+esc(title)+'" style="top:'+((minutes(e.start)-lo*60)/60*68)+'px;height:'+Math.max(15,(minutes(e.end)-minutes(e.start))/60*68-2)+'px;left:'+lane/ends.length*100+'%;width:calc('+100/ends.length+'% - 2px)" data-action="'+action(()=>detail(e))+'"><time>'+esc(e.start)+'</time><b>'+esc(person(e.pid)?.nome||e.title)+'</b><small>'+esc(person(e.pid)?e.title:e.owner)+'</small></button>');
   }group=[];
  }
  for(const e of daily){if(minutes(e.start)>=groupEnd){draw();groupEnd=-1}group.push(e);groupEnd=Math.max(groupEnd,minutes(e.end))}draw();
  return '<div class="daycolumn '+(day===today()?'column-today':'')+'"><div class="columnhead">'+esc(dateLabel(day,{weekday:'short'}))+'<b>'+day.slice(-2)+'</b>'+'</div><div class="hourplane" data-day="'+day+'">'+slots+blocks.join('')+'</div></div>';
 }).join('');
 return '<div class="planner-scroll"><div class="planner '+(count===7?'week':'')+'" style="--days:'+count+'"><div><div class="columnhead">BRT</div><div class="axis">'+axis+'</div></div>'+columns+'</div></div>';
}
function listAgenda(entries){
 const dates=Array.from({length:7},(_,i)=>offsetDate(selected,i));
 const sections=dates.map(day=>{
   const items=entries.filter(entry=>entry.day===day);
   if(!items.length)return '';
   return '<section class="list-day"><h3>'+esc(dateLabel(day,{weekday:'long',day:'numeric',month:'long'}))+'</h3>'+receptionTimeline(items)+'</section>';
 }).join('');
 return sections||'<div class="empty-panel"><h3>Nenhum compromisso no período</h3><p>Escolha outra data ou ajuste os filtros.</p></div>';
}
function agenda(){
 const period=agendaMode==='Mês'?dateLabel(selected,{month:'long',year:'numeric'}):agendaMode==='Dia'?dateLabel(selected,{weekday:'long',day:'numeric',month:'long'}):(()=>{
   const d=new Date(selected+'T12:00:00'),first=agendaMode==='Lista'?selected:offsetDate(selected,-((d.getDay()+6)%7));
   return br(first)+' a '+br(offsetDate(first,6));
 })();
 const shift=n=>{
   const d=new Date(selected+'T12:00:00');
   selected=agendaMode==='Mês'?date(new Date(d.getFullYear(),d.getMonth()+n,1)):offsetDate(selected,n*(agendaMode==='Dia'?1:7));
   render();
 };
 const select=(key,label,options)=>'<label>'+label+'<select id="filter-'+key+'"><option value="">Todos</option>'+options.map(v=>'<option '+(v===calendarFilters[key]?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
 const unique=k=>[...new Set(db.agenda.map(e=>e[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const modes=['Dia','Semana','Mês','Lista'].map(t=>btn(t,()=>{agendaMode=t;render()},t===agendaMode?'active':'')).join('');
 return '<div class="page-title"><h1>Agenda</h1><div class="row">'+btn('Autoagendamento',publishPanel)+btn('+ Novo compromisso',()=>eventForm(),'primary')+'</div></div>'+
 '<div class="calendar-shell"><div class="agenda-tools"><div class="period-nav">'+btn('‹',()=>shift(-1),'arrow')+btn('›',()=>shift(1),'arrow')+btn('Hoje',()=>{selected=today();render()})+'<h2>'+esc(period)+'</h2></div><div class="segmented">'+modes+'</div></div>'+
 '<div class="agenda-filters"><label>Buscar<input id="filter-query" type="search" value="'+esc(calendarFilters.query)+'" placeholder="Pessoa ou atendimento"></label>'+
 select('owner','Responsável',unique('owner'))+select('room','Sala',unique('room'))+select('source','Origem',['Portal','Secretaria','Turma'])+select('status','Situação',calendarStatuses)+
 '<label>Ir para data<input type="date" id="jump-day" value="'+selected+'"></label>'+btn('Limpar',()=>{Object.keys(calendarFilters).forEach(k=>calendarFilters[k]='');render()},'subtle')+'</div>'+
 '<div id="planner-body">'+calendarBody()+'</div></div>';
}
function wireAgenda(){
 const planner=$('planner-body');
 for(const key of Object.keys(calendarFilters)){
   $('filter-'+key).oninput=e=>{calendarFilters[key]=e.target.value;planner.innerHTML=calendarBody()};
 }
 $('jump-day').onchange=e=>{if(e.target.value){selected=e.target.value;render()}};
 let dragging;
 planner.ondragstart=event=>{
   dragging=event.target.closest('[draggable="true"]')?.dataset.bookingId;
   if(dragging){event.dataTransfer.setData('text/plain',dragging);event.dataTransfer.effectAllowed='move'}
 };
 planner.ondragend=()=>{dragging=null;planner.querySelector('.drop-target')?.classList.remove('drop-target')};
 planner.ondragover=event=>{
   const slot=event.target.closest('.hour-slot');
   if(!dragging||!slot)return;
   event.preventDefault();event.dataTransfer.dropEffect='move';
   planner.querySelector('.drop-target')?.classList.remove('drop-target');slot.classList.add('drop-target');
 };
 planner.ondrop=event=>{
   const target=event.target.closest('.hour-slot');
   const entry=db.agenda.find(x=>x.id===dragging);
   if(!target||!entry)return;
   event.preventDefault();
   const day=target.parentElement.dataset.day;
   const start=target.textContent.slice(-5);
   const end=minutes(start)+minutes(entry.end)-minutes(entry.start);
   if(end>=1440){notify('Selecione um horário que termine no mesmo dia.');return}
   eventForm(entry,entry.pid,{day,start,end:clockText(end)});
 };
}

function listPeople(){
 const people=db.pessoas.slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
 const rows=people.map(p=>'<tr class="ficha" data-person-search="'+esc(normalize([p.nome,p.email,p.tel].filter(Boolean).join(' ')))+'" data-type="'+esc(p.tipo)+'"><td><div class="person-cell"><span class="initials">'+esc(initials(p.nome))+'</span><div>'+btn(p.nome,()=>openPerson(p),'text-link')+'<small>'+esc(p.email||'')+'</small></div></div></td><td>'+esc(p.tipo)+'</td><td>'+esc(p.tel||'—')+'</td><td>'+statusTag(p.analysis?.status==='Concluída'?'Concluída':'Em rascunho')+'</td><td>'+btn('Abrir ficha',()=>openPerson(p))+'</td></tr>').join('');
 return '<div class="page-title"><h1>Alunos e clientes</h1>'+btn('+ Novo cadastro',()=>editPerson(),'primary')+'</div><section class="directory"><div class="row table-controls"><label>Buscar cadastro<input id="busca" type="search" placeholder="Nome, e-mail ou telefone"></label><label>Vínculo<select id="tipo-ficha"><option value="">Todos</option><option>Aluno</option><option>Cliente</option><option>Aluno e cliente</option></select></label><span id="people-count" class="muted">'+people.length+' cadastros</span></div><div class="tablewrap"><table><thead><tr><th>Pessoa</th><th>Vínculo</th><th>Telefone</th><th>Análise inicial</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="muted" id="people-empty" '+(rows?'hidden':'')+'>Nenhum cadastro encontrado.</p></section>';
}
function initials(name){return String(name||'').trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toLocaleUpperCase()}
function wirePeople(){
 const search=$('busca'),type=$('tipo-ficha'),rows=[...main.querySelectorAll('.ficha')];
 const filter=()=>{
  const term=normalize(search.value.trim());
  for(const row of rows)row.hidden=!(row.dataset.personSearch.includes(term)&&(!type.value||row.dataset.type===type.value));
  const count=rows.filter(row=>!row.hidden).length;
  $('people-count').textContent=count+' '+(count===1?'cadastro':'cadastros');
  $('people-empty').hidden=count>0;
 };
 search.oninput=filter;type.onchange=filter;
}
function installProfileTabs(){
 const sections=Array.from(main.querySelectorAll(':scope > section'));
 const titles=['Análise inicial','Configuração espiritual','Atendimentos'];
 const tabs=document.createElement('div');tabs.className='tabs';
 sections.forEach((section,index)=>{
   section.classList.toggle('hidden-pane',index!==fichaPane);
   tabs.insertAdjacentHTML('beforeend',btn(titles[index],()=>{fichaPane=index;render()},index===fichaPane?'active':''));
 });
 sections[0].before(tabs);
}
function metric(label,value){return '<div><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>'}
function notify(message){const el=$('notice');el.textContent=message;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),2300)}
function openPerson(p,pane=0){personId=p.id;fichaPane=pane;tab='Cadastros';render()}
function home(){
 const scheduled=db.agenda.filter(e=>e.day===today()&&e.status!=='Cancelado').sort((a,b)=>a.start.localeCompare(b.start));
 const waiting=scheduled.filter(e=>e.arrived_at&&['Agendado','Confirmado'].includes(e.status));
 const drafts=db.pessoas.filter(p=>p.analysis?.status!=='Concluída');
 const pending=db.agenda.filter(e=>e.pid&&e.status==='Realizado'&&!e.note).sort((a,b)=>b.day.localeCompare(a.day));
 const todayLabel=dateLabel(today(),{weekday:'long',day:'numeric',month:'long'});
 return '<div class="page-title"><div><h1>Recepção</h1><p class="muted date-text">'+esc(todayLabel)+'</p></div><div class="row">'+btn('Novo cadastro',()=>editPerson())+btn('+ Agendar atendimento',()=>eventForm(null,'',{day:today()}),'primary')+'</div></div>'+
 '<div class="metrics">'+metric('Compromissos hoje',scheduled.length)+metric('Aguardando atendimento',waiting.length)+metric('Relatos a registrar',pending.length)+'</div>'+
 '<div class="workgrid"><section><div class="row"><h2>Agenda de hoje</h2>'+btn('Abrir agenda',()=>{selected=today();go('Agenda')})+'</div>'+receptionTimeline(scheduled)+'</section>'+
 '<section><h2>Pendências</h2><div class="queue"><div class="row"><h3>Chegadas registradas</h3><span class="status-tag green">'+waiting.length+'</span></div>'+
 (waiting.length?receptionTimeline(waiting):'<p class="muted">Ninguém aguardando.</p>')+
 '</div><div class="queue"><div class="row"><h3>Relatos a registrar</h3><span class="status-tag amber">'+pending.length+'</span></div>'+
 pending.slice(0,5).map(e=>'<div class="row item"><strong>'+esc(person(e.pid)?.nome)+'</strong>'+btn('Registrar',()=>note(e))+'</div>').join('')+
 (!pending.length?'<p class="muted">Nenhum relato pendente.</p>':'')+
 '</div>'+operationsQueue()+'<div class="queue"><div class="row"><h3>Análises em rascunho</h3><span class="status-tag neutral">'+drafts.length+'</span></div>'+
 drafts.slice(0,5).map(p=>'<div class="row item"><strong>'+esc(p.nome)+'</strong>'+btn('Abrir ficha',()=>openPerson(p))+'</div>').join('')+
 (!drafts.length?'<p class="muted">Nenhuma análise pendente.</p>':'')+'</div></section></div>';
}
function receptionTimeline(entries){
 if(!entries.length)return '<div class="reception-empty"><h3>Dia sem compromissos</h3><p>Os atendimentos agendados e as reservas do portal aparecem aqui.</p>'+btn('Consultar disponibilidade',publishPanel)+'</div>';
 return entries.map(e=>'<div class="visit-row"><div class="visit-time">'+esc(e.start)+'<small>'+esc(e.end)+'</small></div><div class="visit-content"><strong>'+esc(person(e.pid)?.nome||e.title)+'</strong><small>'+esc([e.pid?e.title:'',e.owner,e.room].filter(Boolean).join(' · '))+'</small><span class="visit-status">'+esc(e.arrived_at&&['Agendado','Confirmado'].includes(e.status)?'Aguardando atendimento':e.status)+(e.source==='Portal'?' · Portal':'')+'</span></div>'+btn('Abrir',()=>detail(e))+'</div>').join('');
}
const navShapes={
 'Recepção':'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
 'Agenda':'M3 6h18v15H3zM7 3v6m10-6v6M3 11h18m-14 4h4',
 'Cadastros':'M4 4h16v16H4zM8 9h8m-8 5h5',
 'Financeiro':'M3 6h18v13H3zM3 10h18m-7 5h4',
 'Ensino':'M2 9l10-5 10 5-10 5-10-5zm5 3v5l5 3 5-3v-5',
 'Estoque':'M3 6h18v4H3zm2 4v10h14V10m-9 4h4',
 'Equipe':'M4 20v-2a4 4 0 0 1 8 0v2m1-13a3 3 0 1 1 6 0a3 3 0 1 1-6 0M5 8a3 3 0 1 1 6 0a3 3 0 1 1-6 0m11 6a4 4 0 0 1 5 4v2'
};
function navItem(t){
 return '<button data-action="'+action(()=>go(t))+'" class="'+(tab===t?'active':'')+'" '+(tab===t?'aria-current="page"':'')+'><svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="'+navShapes[t]+'"/></svg>'+esc(t)+'</button>';
}
function clearSession(){
 me=null;db=null;team=[];audit=[];actions=[];personId='';form.replaceChildren();dlg.close();main.replaceChildren();$('workspace').hidden=true;$('identity').replaceChildren();$('notice').classList.remove('show');
}
function accessScreen(setup){
 const container=$('access');container.hidden=false;
 container.innerHTML='<div class="access-brand"><img src="/marca.svg" alt="Templo Espírita Ogum Quebra Demanda"><div>Secretaria do templo</div></div><div class="access-form"><form><h1>'+(setup?'Primeiro acesso':'Entrar na secretaria')+'</h1><p class="muted">'+(setup?'Crie a conta de administração do templo.':'Use sua conta de acesso ao templo.')+'</p>'+(setup?'<label>Nome completo<input name="name" autocomplete="name" maxlength="120" required></label>':'')+'<label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" '+(setup?'minlength="12" placeholder="Ao menos 12 caracteres"':'')+' required></label><p role="alert" class="error"></p><button class="primary">'+(setup?'Criar conta administrativa':'Entrar')+'</button></form></div>';
 if(!setup)container.querySelector('form').insertAdjacentHTML('beforeend','<a href="/agendar" class="portal-link">Área do aluno · Cadastro e agendamentos</a>');
 const f=container.querySelector('form');f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('button');button.disabled=true;try{await api(setup?'/setup':'/login',Object.fromEntries(new FormData(f)));await boot()}catch(err){f.querySelector('.error').textContent=err.message}finally{button.disabled=false}};
}
async function boot(){
 const session=await api('/session');
 if(!session.user){accessScreen(session.setup);return}
 if(session.user.role==='Participante'){location.replace('/agendar');return}
 me=session.user;tab=me.role==='Financeiro'?'Financeiro':'Recepção';$('access').replaceChildren();$('access').hidden=true;$('workspace').hidden=false;
 $('currentDate').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
 await load();
}
async function go(next){
 try{if(['Agenda','Recepção','Financeiro','Ensino','Estoque'].includes(next)){db=(await api('/dados')).data}
 if(next==='Ensino')classId='';
 if(next==='Estoque')stockId='';
 if(next==='Financeiro'){invoiceId='';financePerson=''}
 if(next==='Equipe'){[team,audit]=await Promise.all([api('/equipe'),api('/atividade')])}
 tab=next;personId='';render()}catch(err){alert(err.message)}
}
async function userAction(body){
 try{await api('/usuario',body);dlg.close();await go('Equipe');notify('Equipe atualizada.')}catch(e){alert(e.message)}
}
function staff(){
 const fields=[req('name','Nome completo'),req('email','E-mail','email'),req('password','Senha inicial (12 caracteres ou mais)','password'),field('role','Perfil','select',['Atendimento','Financeiro','Administrador'])];
 return '<div class="row"><h1>Equipe e acessos</h1>'+btn('Nova conta',()=>modal('Criar conta',fields,{},userAction),'primary')+'</div><section><h2>Contas de acesso</h2><div class="tablewrap"><table><thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação</th><th>Ação</th></tr></thead><tbody>'+team.map(u=>'<tr><td><strong>'+esc(u.name)+'</strong><small>'+esc(u.email)+'</small></td><td>'+esc(u.role)+'</td><td>'+(u.active?'Ativa':'Desativada')+'</td><td>'+(u.id===me.id?'Sua conta':btn(u.active?'Desativar':'Reativar',()=>{if(confirm('Alterar acesso de '+u.name+'?'))userAction({id:u.id,active:!u.active})}))+'</td></tr>').join('')+'</tbody></table></div></section><section><h2>Atividade recente</h2>'+audit.map(a=>'<div class="logline"><time>'+esc(new Date(a.ts*1000).toLocaleString('pt-BR'))+'</time><strong>'+esc(a.name)+'</strong><span>'+esc(a.action)+'</span></div>').join('')+'</section>';
}
function quickFind(){
 form.innerHTML='<div class="detail-head"><h2>Buscar pessoa</h2>'+btn('Fechar',()=>dlg.close(),'subtle')+'</div><label>Nome, e-mail ou telefone<input id="quick-query" type="search" autocomplete="off" autofocus></label><div id="quick-results"></div>';
 const input=$('quick-query'),results=$('quick-results');
 function update(){
   const term=normalize(input.value.trim());
   const matches=db.pessoas.filter(p=>normalize([p.nome,p.email,p.tel].filter(Boolean).join(' ')).includes(term)).slice(0,8);
   results.innerHTML=matches.map(p=>'<div class="row item"><strong>'+esc(p.nome)+'</strong>'+btn('Abrir ficha',()=>{dlg.close();openPerson(p)})+'</div>').join('')||'<p class="muted">Nenhuma pessoa encontrada.</p>';
   return matches;
 }
 form.onsubmit=event=>{
   event.preventDefault();
   const first=update()[0];
   if(first){dlg.close();openPerson(first)}
 };
 input.oninput=update;
 update();
 dlg.showModal();input.focus();
}
document.addEventListener('keydown',event=>{
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&me?.role!=='Financeiro'&&db&&!dlg.open){
   event.preventDefault();quickFind();
 }
});
function render(){
 if(!me||!db)return;
 actions=[];const menus=me.role==='Financeiro'?['Financeiro']:['Recepção','Agenda','Cadastros','Ensino',...(me.role==='Administrador'?['Financeiro','Estoque','Equipe']:[])];
 $('nav').innerHTML=menus.map(navItem).join('');
 $('section-label').textContent='Secretaria / '+tab;
 $('top-tools').innerHTML=me.role==='Financeiro'?'':btn('Buscar pessoa',quickFind,'subtle');
 $('identity').innerHTML='<strong>'+esc(me.name)+'</strong><small>'+esc(me.role)+'</small>'+btn('Alterar senha',()=>modal('Alterar senha',[req('atual','Senha atual','password'),req('nova','Nova senha (mínimo 12 caracteres)','password')],{},async values=>{try{await api('/senha',values);dlg.close();notify('Senha atualizada.')}catch(err){alert(err.message)}}))+btn('Sair',async()=>{try{await api('/logout',{});clearSession();await boot()}catch(e){alert(e.message)}});
 main.innerHTML=tab==='Recepção'?home():tab==='Agenda'?agenda():tab==='Financeiro'?finance():tab==='Ensino'?academic():tab==='Estoque'?stock():tab==='Equipe'?staff():personId?profile(person(personId)):listPeople();
 if(tab==='Cadastros'&&personId)installProfileTabs();
 if(tab==='Agenda')wireAgenda();
 if($('busca'))wirePeople();
 wireOperations();
}
boot().catch(err=>{$('access').textContent='Não foi possível abrir a secretaria. '+err.message});

// Reservations made in the portal appear without interrupting an open form or a filter.
let syncing=false;
setInterval(async()=>{
 if(syncing||!me||!db||busy||dlg.open||document.hidden||!['Agenda','Recepção'].includes(tab)||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
 syncing=true;
 try{
  const before=db,screen=tab, fresh=(await api('/dados')).data;
  if(me&&before===db&&tab===screen&&!busy&&!dlg.open&&JSON.stringify(db)!==JSON.stringify(fresh)){db=fresh;render()}
 }catch{ /* Keep the current view during a transient connection failure. */ }
 finally{syncing=false}
},30000);
