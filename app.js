'use strict';
const $=id=>document.getElementById(id), main=$('main'), dlg=$('dlg'), form=$('form');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID(), date=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'), today=()=>date(new Date()), br=s=>s?s.split('-').reverse().join('/'):'', money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const positions=[['Cabeça',228,326],['Corpo',228,383],['Caminhos',148,324],['Adjuntó',312,323],['Caboclo',99,172],['Preto Velho',350,175],['Marinheiro',177,195],['Sereia',274,201],['Criança',69,292],['1º Exu',126,410],['2º Exu',366,416],['Ciganos',185,442],['Egun',268,442]];
let db,version,tab='Agenda',personId='',selected=today(), actions=[],busy=false;
function action(fn){return actions.push(fn)-1}
function btn(label,fn,cls=''){return '<button type="button" class="'+cls+'" data-action="'+action(fn)+'">'+esc(label)+'</button>'}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!busy)actions[+b.dataset.action]?.()});
let me=null, team=[], audit=[], financeFilter='Em aberto', agendaMode='Semana';
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
   db=next;dlg.close();after?.();render();notify('Registro salvo.');
 }catch(error){if(error.status===409){dlg.close();await load()}alert(error.message)}
 finally{busy=false}
}
function field(name,label,type='text',options='',required=false){return {name,label,type,options,required}}
function modal(title,fields,values,submit){form.innerHTML='<h2>'+esc(title)+'</h2>'+fields.map(f=>{const v=values[f.name]??'',a=' name="'+f.name+'" '+(f.required?'required':'');let el;if(f.type==='select')el='<select'+a+'>'+f.options.map(o=>{const [id,label]=Array.isArray(o)?o:[o,o];return '<option value="'+esc(id)+'" '+(v===id?'selected':'')+'>'+esc(label)+'</option>'}).join('')+'</select>';else if(f.type==='area')el='<textarea'+a+'>'+esc(v)+'</textarea>';else el='<input type="'+f.type+'"'+a+' value="'+esc(v)+'" '+(f.type==='number'?'min=".01" step=".01"':'')+'>';return '<label>'+esc(f.label)+el+'</label>'}).join('')+'<div class="row"><button class="primary">Salvar</button>'+btn('Cancelar',()=>dlg.close())+'</div>';form.onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(form));for(const k in values)values[k]=values[k].trim();if(fields.some(f=>f.required&&!values[f.name]))return alert('Preencha os campos obrigatórios.');submit(values)};if(!dlg.open)dlg.showModal()}
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
return btn('Voltar aos cadastros',()=>{personId='';render()})+'<div class="row"><h1>'+esc(p.nome)+'</h1>'+btn('Editar cadastro',()=>editPerson(p))+btn('Baixar ficha PDF',()=>downloadFicha(p),'primary')+'</div><p>'+[p.tipo,p.tel,p.email,br(p.nasc),signoSolar(p.nasc),p.end].filter(Boolean).map(esc).join(' · ')+'</p>'+caseNotes(p)+'<section><div class="row"><h2>Análise inicial</h2>'+btn('Editar análise',()=>analysis(p))+'</div><small>'+br(a.data)+' · '+esc(a.status)+'</small>'+entry('Responsável',a.autor)+entry('Motivo da procura',a.motivo)+entry('Histórico',a.historico)+entry('Expectativas',a.objetivos)+entry('Observações',a.obs)+entry('Acompanhamento',a.plano)+'</section><section><div class="row"><h2>Configuração espiritual</h2>'+btn('Editar descrição',()=>modal('Descrição da configuração',[field('intro','Texto','area')],p,v=>save(d=>person(p.id,d).intro=v.intro)))+'</div><p>'+esc(p.intro)+'</p><div class="split"><div class="map"><img src="/mapa.png" alt="Diagrama de referência da configuração espiritual">'+positions.map(([label,x,y],i)=>'<button title="'+esc(p.map[i].label)+'" aria-label="'+esc(p.map[i].label)+'" style="left:'+x/454*100+'%;top:'+(y-130)/401*100+'%" data-action="'+action(()=>slot(p,i))+'">'+(p.map[i].nome||p.map[i].label!==label?'<span>'+esc(p.map[i].label)+'<br><b>'+esc(p.map[i].nome)+'</b></span>':'')+'</button>').join('')+'</div><div class="positions">'+p.map.map((s,i)=>'<div class="item"><div class="row"><strong>'+esc(s.label)+'</strong>'+btn('Editar',()=>slot(p,i))+'</div>'+[s.nome,s.obs].filter(Boolean).map(x=>'<p>'+esc(x)+'</p>').join('')+'</div>').join('')+btn('Adicionar posição',()=>slot(p,p.map.length))+'</div></div></section><section><div class="row"><h2>Histórico de atendimentos</h2>'+btn('Agendar',()=>eventForm(null,p.id))+'</div>'+events(db.agenda.filter(e=>e.pid===p.id).sort((a,b)=>b.day.localeCompare(a.day)||b.start.localeCompare(a.start)))+'</section>'}
function events(list){return list.length?list.map(e=>'<div class="item"><div class="row"><strong>'+esc(e.start)+' – '+esc(e.end)+' · '+esc(e.title)+'</strong>'+btn('Editar',()=>eventForm(e))+(e.pid?btn(e.note?'Editar relato':'Registrar relato',()=>note(e)):'')+'</div><small>'+br(e.day)+' · '+esc(person(e.pid)?.nome||'Atividade do templo')+' · '+esc(e.status)+' · '+esc(e.owner)+'</small>'+(e.note?'<p>'+esc(e.note)+'</p>':'')+'</div>').join(''):'<p class="muted">Nenhum atendimento neste período.</p>'}
function note(e){modal('Relato do atendimento',[req('owner','Responsável'),req('note','Relato, orientações e acompanhamento','area')],e,v=>save(d=>Object.assign(d.agenda.find(x=>x.id===e.id),v,{status:'Realizado'})))}
function eventForm(e,pid='',defaults={}){modal(e?'Editar compromisso':'Novo compromisso',[req('title','Atividade ou atendimento'),field('pid','Aluno ou cliente','select',[['','Atividade geral do templo'],...db.pessoas.map(p=>[p.id,p.nome])]),req('day','Data','date'),req('start','Início','time'),req('end','Término','time'),req('owner','Responsável'),field('room','Sala ou local'),field('status','Situação','select',['Agendado','Confirmado','Realizado','Faltou','Cancelado'])],e||{day:selected,start:'09:00',end:'10:00',owner:me.name,pid,...defaults},v=>{if(v.start>=v.end)return alert('O término deve ser posterior ao início.');if(e?.note&&v.pid!==e.pid)return alert('O relato já está vinculado a esta pessoa.');if(v.status!=='Cancelado'&&db.agenda.some(x=>x.id!==e?.id&&x.status!=='Cancelado'&&x.day===v.day&&x.end>v.start&&x.start<v.end&&(x.owner.toLowerCase()===v.owner.toLowerCase()||v.pid&&v.pid===x.pid)))return alert('Já existe compromisso nesse horário para a pessoa ou o responsável.');save(d=>e?Object.assign(d.agenda.find(x=>x.id===e.id),v):d.agenda.push({...v,id:uid()}),()=>selected=v.day)})}
const calendarFilters={owner:'',status:'',query:''};
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
 const q=calendarFilters.query.trim().toLocaleLowerCase();
 return db.agenda.filter(e=>(!calendarFilters.owner||e.owner===calendarFilters.owner)&&(!calendarFilters.status||e.status===calendarFilters.status)&&
 (!q||[e.title,e.room,person(e.pid)?.nome,e.owner].some(s=>s?.toLocaleLowerCase().includes(q)))).sort((a,b)=>(a.day+a.start).localeCompare(b.day+b.start));
}
function detail(e){
 form.innerHTML='<h2>'+esc(e.title)+'</h2><p>'+[br(e.day),e.start+' – '+e.end,e.status,e.owner,e.room,person(e.pid)?.nome].filter(Boolean).map(esc).join(' · ')+'</p>'+(e.note?'<p>'+esc(e.note)+'</p>':'')+
 '<div class="row">'+btn('Editar / reagendar',()=>eventForm(e),'primary')+
 (e.pid?btn('Abrir ficha',()=>{dlg.close();openPerson(person(e.pid))})+btn(e.note?'Editar relato':'Registrar relato',()=>note(e)):'')+
 btn('Agendar retorno',()=>eventForm(null,e.pid,{...Object.fromEntries(['title','owner','room','start','end'].map(k=>[k,e[k]||''])),day:offsetDate(e.day,7),status:'Agendado'}))+
 (e.status==='Agendado'?btn('Confirmar presença',()=>save(d=>d.agenda.find(x=>x.id===e.id).status='Confirmado')):'')+
 btn('Exportar calendário (.ics)',()=>exportICS(e))+btn('Fechar',()=>dlg.close())+'</div>';
 form.onsubmit=ev=>ev.preventDefault();if(!dlg.open)dlg.showModal();
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
    blocks.push('<button class="booking '+(e.status==='Cancelado'?'cancelled':e.status==='Realizado'?'done':'')+'" title="'+esc(title)+'" style="top:'+((minutes(e.start)-lo*60)/60*68)+'px;height:'+Math.max(15,(minutes(e.end)-minutes(e.start))/60*68-2)+'px;left:'+lane/ends.length*100+'%;width:calc('+100/ends.length+'% - 2px)" data-action="'+action(()=>detail(e))+'"><time>'+esc(e.start)+'</time><b>'+esc(e.title)+'</b><small>'+esc(person(e.pid)?.nome||e.owner)+'</small></button>');
   }group=[];
  }
  for(const e of daily){if(minutes(e.start)>=groupEnd){draw();groupEnd=-1}group.push(e);groupEnd=Math.max(groupEnd,minutes(e.end))}draw();
  return '<div class="daycolumn"><div class="columnhead">'+esc(new Date(day+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}))+'</div><div class="hourplane">'+slots+blocks.join('')+'</div></div>';
 }).join('');
 return '<div class="planner-scroll"><div class="planner '+(count===7?'week':'')+'" style="--days:'+count+'"><div><div class="columnhead">Hora</div><div class="axis">'+axis+'</div></div>'+columns+'</div></div>';
}
function agenda(){
 const shift=n=>{const d=new Date(selected+'T12:00:00');selected=agendaMode==='Mês'?date(new Date(d.getFullYear(),d.getMonth()+n,1)):offsetDate(selected,n*(agendaMode==='Semana'?7:1));render()};
 const select=(key,label,options)=>'<label>'+label+'<select id="filter-'+key+'"><option value="">Todos</option>'+options.map(v=>'<option '+(v===calendarFilters[key]?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
 return '<div class="row"><h1>Agenda</h1>'+btn('Novo compromisso',()=>eventForm(),'primary')+'</div><div class="agenda-tools"><div class="row">'+btn('Anterior',()=>shift(-1))+btn('Hoje',()=>{selected=today();render()})+btn('Próximo',()=>shift(1))+'<label>Ir para data<input type="date" id="jump-day" value="'+selected+'"></label></div><div class="tabs">'+['Dia','Semana','Mês'].map(t=>btn(t,()=>{agendaMode=t;render()},t===agendaMode?'active':'')).join('')+'</div></div><div class="agenda-filters"><label>Buscar compromisso<input id="filter-query" type="search" value="'+esc(calendarFilters.query)+'" placeholder="Nome, atividade ou sala"></label>'+select('owner','Responsável',[...new Set(db.agenda.map(e=>e.owner))].sort())+select('status','Situação',['Agendado','Confirmado','Realizado','Faltou','Cancelado'])+'</div><div id="planner-body">'+calendarBody()+'</div>';
}
function wireAgenda(){
 const refresh=()=>{$('planner-body').innerHTML=calendarBody()};
 for(const key of ['owner','status','query'])$('filter-'+key).oninput=e=>{calendarFilters[key]=e.target.value;refresh()};
 $('jump-day').onchange=e=>{if(e.target.value){selected=e.target.value;render()}};
}

function listPeople(){
 const people=db.pessoas.slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
 const rows=people.map(p=>'<tr class="ficha"><td><strong>'+esc(p.nome)+'</strong></td><td>'+esc(p.tipo)+'</td><td>'+esc(p.tel||p.email||'—')+'</td><td>'+btn('Abrir ficha',()=>{personId=p.id;fichaPane=0;render()})+'</td></tr>').join('');
 return '<div class="row"><h1>Alunos e clientes</h1>'+btn('Novo cadastro',()=>editPerson(),'primary')+'</div><section><label>Buscar por nome<input id="busca" type="search"></label><div class="tablewrap"><table><thead><tr><th>Nome</th><th>Vínculo</th><th>Contato</th><th>Ficha</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(!rows?'<p class="muted">Nenhuma pessoa cadastrada.</p>':'')+'</section>';
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
function bill(b){modal('Lançamento financeiro',[field('tipo','Tipo','select',['A receber','A pagar']),req('descricao','Descrição'),field('pid','Vínculo','select',[['','Geral'],...db.pessoas.map(p=>[p.id,p.nome])]),req('valor','Valor (R$)','number'),req('due','Vencimento','date'),field('paid','Data da baixa','date')],b?{...b,valor:(b.cents/100).toFixed(2)}:{due:today()},v=>{const cents=Math.round(Number(v.valor)*100);if(!Number.isSafeInteger(cents)||cents<1)return alert('Valor inválido.');delete v.valor;save(d=>b?Object.assign(d.contas.find(x=>x.id===b.id),v,{cents}):d.contas.push({...v,id:uid(),cents}))})}
function totals(items,type){return items.filter(b=>b.tipo===type&&!b.paid).reduce((sum,b)=>sum+b.cents,0)}
function finance(){
 const items=db.contas.slice().sort((a,b)=>a.due.localeCompare(b.due));
 const filters=['Em aberto','Vencidos','Baixados','Todos'];
 const ledger=items.filter(b=>financeFilter==='Todos'||(financeFilter==='Baixados'?!!b.paid:!b.paid&&(financeFilter!=='Vencidos'||b.due<today())));
 const rows=ledger.map(b=>'<tr><td><strong>'+esc(b.descricao)+'</strong><small>'+esc(person(b.pid)?.nome||'Geral')+'</small></td><td>'+esc(b.tipo)+'</td><td>'+br(b.due)+'</td><td class="amount">'+money(b.cents)+'</td><td>'+esc(b.paid?'Baixa em '+br(b.paid):b.due<today()?'Vencido':'Em aberto')+'</td><td>'+btn('Editar',()=>bill(b))+(!b.paid?btn('Dar baixa',()=>modal('Registrar baixa',[req('paid','Data da baixa','date')],{paid:today()},v=>save(d=>Object.assign(d.contas.find(x=>x.id===b.id),v)))):'')+'</td></tr>').join('');
 return '<div class="row"><h1>Financeiro</h1>'+btn('Novo lançamento',()=>bill(),'primary')+'</div><div class="metrics">'+metric('A receber',money(totals(items,'A receber')))+metric('A pagar',money(totals(items,'A pagar')))+metric('Contas vencidas',items.filter(b=>!b.paid&&b.due<today()).length)+'</div><section><div class="tabs">'+filters.map(f=>btn(f,()=>{financeFilter=f;render()},financeFilter===f?'active':'')).join('')+'</div><div class="tablewrap"><table><thead><tr><th>Lançamento</th><th>Tipo</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(!rows?'<p class="muted">Nenhum lançamento neste filtro.</p>':'')+'</section>';
}
function metric(label,value){return '<div><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>'}
function notify(message){const el=$('notice');el.textContent=message;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),2300)}
function openPerson(p,pane=0){personId=p.id;fichaPane=pane;tab='Cadastros';render()}
function home(){
 const scheduled=db.agenda.filter(e=>e.day===today()).sort((a,b)=>a.start.localeCompare(b.start));
 const drafts=db.pessoas.filter(p=>p.analysis?.status!=='Concluída');
 const pending=db.agenda.filter(e=>e.pid&&e.status==='Realizado'&&!e.note).sort((a,b)=>b.day.localeCompare(a.day));
 return '<div class="row"><h1>Recepção</h1>'+btn('Agendar atendimento',()=>eventForm(),'primary')+'</div><div class="metrics">'+metric('Compromissos de hoje',scheduled.filter(e=>e.status!=='Cancelado').length)+metric('Análises em rascunho',drafts.length)+metric('Atendimentos sem relato',pending.length)+'</div><div class="workgrid"><section><div class="row"><h2>Agenda de hoje</h2>'+btn('Abrir agenda',()=>go('Agenda'))+'</div>'+events(scheduled)+'</section><section><div class="row"><h2>Acompanhamento</h2></div><h3>Análises a concluir</h3>'+drafts.slice(0,8).map(p=>'<div class="row item"><strong>'+esc(p.nome)+'</strong>'+btn('Abrir análise',()=>openPerson(p))+'</div>').join('')+(!drafts.length?'<p class="muted">Nenhuma análise pendente.</p>':'')+'<h3>Relatos pendentes</h3>'+pending.slice(0,8).map(e=>'<div class="row item"><strong>'+esc(person(e.pid)?.nome)+'</strong>'+btn('Registrar relato',()=>note(e))+'</div>').join('')+(!pending.length?'<p class="muted">Nenhum relato pendente.</p>':'')+'</section></div>';
}
function clearSession(){
 me=null;db=null;team=[];audit=[];actions=[];personId='';form.replaceChildren();dlg.close();main.replaceChildren();$('workspace').hidden=true;$('identity').replaceChildren();$('notice').classList.remove('show');
}
function accessScreen(setup){
 const container=$('access');container.hidden=false;
 container.innerHTML='<div class="access-brand"><img src="/marca.svg" alt="Templo Espírita Ogum Quebra Demanda"><div>Secretaria do templo</div></div><div class="access-form"><form><h1>'+(setup?'Primeiro acesso':'Entrar na secretaria')+'</h1><p class="muted">'+(setup?'Crie a conta de administração do templo.':'Use sua conta de acesso ao templo.')+'</p>'+(setup?'<label>Nome completo<input name="name" autocomplete="name" maxlength="120" required></label>':'')+'<label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" '+(setup?'minlength="12" placeholder="Ao menos 12 caracteres"':'')+' required></label><p role="alert" class="error"></p><button class="primary">'+(setup?'Criar conta administrativa':'Entrar')+'</button></form></div>';
 const f=container.querySelector('form');f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('button');button.disabled=true;try{await api(setup?'/setup':'/login',Object.fromEntries(new FormData(f)));await boot()}catch(err){f.querySelector('.error').textContent=err.message}finally{button.disabled=false}};
}
async function boot(){
 const session=await api('/session');
 if(!session.user){accessScreen(session.setup);return}
 me=session.user;tab=me.role==='Financeiro'?'Financeiro':'Recepção';$('access').replaceChildren();$('access').hidden=true;$('workspace').hidden=false;
 $('currentDate').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
 await load();
}
async function go(next){
 try{if(next==='Equipe'){[team,audit]=await Promise.all([api('/equipe'),api('/atividade')])}
 tab=next;personId='';render()}catch(err){alert(err.message)}
}
async function userAction(body){
 try{await api('/usuario',body);dlg.close();await go('Equipe');notify('Equipe atualizada.')}catch(e){alert(e.message)}
}
function staff(){
 const fields=[req('name','Nome completo'),req('email','E-mail','email'),req('password','Senha inicial (12 caracteres ou mais)','password'),field('role','Perfil','select',['Atendimento','Financeiro','Administrador'])];
 return '<div class="row"><h1>Equipe e acessos</h1>'+btn('Nova conta',()=>modal('Criar conta',fields,{},userAction),'primary')+'</div><section><h2>Contas de acesso</h2><div class="tablewrap"><table><thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação</th><th>Ação</th></tr></thead><tbody>'+team.map(u=>'<tr><td><strong>'+esc(u.name)+'</strong><small>'+esc(u.email)+'</small></td><td>'+esc(u.role)+'</td><td>'+(u.active?'Ativa':'Desativada')+'</td><td>'+(u.id===me.id?'Sua conta':btn(u.active?'Desativar':'Reativar',()=>{if(confirm('Alterar acesso de '+u.name+'?'))userAction({id:u.id,active:!u.active})}))+'</td></tr>').join('')+'</tbody></table></div></section><section><h2>Atividade recente</h2>'+audit.map(a=>'<div class="logline"><time>'+esc(new Date(a.ts*1000).toLocaleString('pt-BR'))+'</time><strong>'+esc(a.name)+'</strong><span>'+esc(a.action)+'</span></div>').join('')+'</section>';
}
function render(){
 if(!me||!db)return;
 actions=[];const menus=me.role==='Financeiro'?['Financeiro']:['Recepção','Agenda','Cadastros',...(me.role==='Administrador'?['Financeiro','Equipe']:[])];
 $('nav').innerHTML=menus.map(t=>btn(t,()=>go(t),t===tab?'active':'')).join('');
 $('identity').innerHTML='<strong>'+esc(me.name)+'</strong><small>'+esc(me.role)+'</small>'+btn('Alterar senha',()=>modal('Alterar senha',[req('atual','Senha atual','password'),req('nova','Nova senha (mínimo 12 caracteres)','password')],{},async values=>{try{await api('/senha',values);dlg.close();notify('Senha atualizada.')}catch(err){alert(err.message)}}))+btn('Sair',async()=>{try{await api('/logout',{});clearSession();await boot()}catch(e){alert(e.message)}});
 main.innerHTML=tab==='Recepção'?home():tab==='Agenda'?agenda():tab==='Financeiro'?finance():tab==='Equipe'?staff():personId?profile(person(personId)):listPeople();
 if(tab==='Cadastros'&&personId)installProfileTabs();
 if(tab==='Agenda')wireAgenda();
 if($('busca'))$('busca').oninput=e=>document.querySelectorAll('.ficha').forEach(el=>el.hidden=!el.querySelector('strong').textContent.toLocaleLowerCase().includes(e.target.value.toLocaleLowerCase()));
}
boot().catch(err=>{$('access').textContent='Não foi possível abrir a secretaria. '+err.message});
