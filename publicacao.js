async function publishPanel(){
  try{
    const [config,availability]=await Promise.all([api('/publicacao'),api('/horarios')]);
    const copyLink=async()=>{
      try{
        await navigator.clipboard.writeText(config.url);
        notify('Link copiado.');
      }catch{
        $('share-url').select();
        notify('Copie o endereço selecionado.');
      }
    };
    const services=config.rules.map(rule=>{
      const slots=availability.slots.filter(slot=>slot.rule===rule.id);
      const first=slots[0];
      const availabilityText=first
        ? 'Próxima vaga: '+br(first.day)+' às '+first.start+' · '+slots.length+' horários'
        : 'Nenhum horário disponível';
      return '<div class="rule-row"><strong>'+esc(rule.title)+'</strong><span>'+esc(rule.owner)+' · '+rule.duration+' min · '+(rule.active?'Publicado':'Pausado')+'</span><small>'+esc(availabilityText)+'</small>'+btn('Configurar',()=>ruleEditor(rule))+'</div>';
    }).join('');
    form.innerHTML='<div class="detail-head"><h2>Autoagendamento</h2>'+btn('Fechar',()=>dlg.close(),'subtle')+'</div>'+
      '<label>Link do participante<input id="share-url" readonly></label>'+
      '<div class="row">'+btn('Copiar link',copyLink,'primary')+'<a class="portal-link" href="/agendar" target="_blank" rel="noopener">Visualizar portal</a></div>'+
      (!config.external?'<p class="local-note">Link local. O endereço para envio aos alunos aparece aqui quando a instalação estiver configurada com domínio HTTPS.</p>':'')+
      '<hr><div class="row"><h3>Serviços e horários</h3>'+btn('+ Adicionar serviço',()=>ruleEditor())+'</div>'+
      (services||'<p class="muted">Cadastre o primeiro serviço e defina quando ele pode ser reservado.</p>');
    $('share-url').value=config.url;
    form.onsubmit=event=>event.preventDefault();
    dlg.classList.add('drawer');
    if(!dlg.open)dlg.showModal();
  }catch(error){alert(error.message)}
}
function ruleEditor(existing){
  const rule=existing||{title:'',owner:me.name,room:'',start:'09:00',end:'17:00',duration:60,horizon:30,notice:12,days:[0,1,2,3,4],blocked:[],active:true};
  const input=(name,label,type='text',attrs='')=>'<label>'+label+'<input type="'+type+'" name="'+name+'" value="'+esc(rule[name])+'" '+attrs+'></label>';
  const weekdays=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map((label,index)=>
    '<label><input type="checkbox" name="days" value="'+index+'" '+(rule.days.includes(index)?'checked':'')+'>'+label+'</label>'
  ).join('');
  form.innerHTML='<div class="detail-head"><h2>'+esc(existing?'Editar serviço':'Novo serviço')+'</h2>'+btn('Voltar',publishPanel,'subtle')+'</div>'+
    input('title','Nome exibido no portal','text','required maxlength="120"')+
    '<div class="form-pair">'+input('owner','Responsável','text','required')+input('room','Sala ou local')+'</div>'+
    '<fieldset><legend>Dias de atendimento</legend><div class="weekday-picker">'+weekdays+'</div></fieldset>'+
    '<div class="form-pair">'+input('start','Das','time','required')+input('end','Até','time','required')+'</div>'+
    '<div class="form-three">'+input('duration','Duração (min)','number','min="10" max="240" required')+
    input('notice','Antecedência (h)','number','min="0" max="168" required')+input('horizon','Abrir por (dias)','number','min="1" max="60" required')+'</div>'+
    '<div class="form-pair"><label>Valor previsto (R$)<input name="fee" type="number" min="0" max="100000000" step=".01" value="'+(rule.fee==null?'':decimal(rule.fee))+'"></label>'+
    '<label>Vencimento após atendimento (dias)<input name="due_days" type="number" required min="0" max="365" value="'+(rule.due_days||0)+'"></label></div>'+
    '<label class="checkline"><input name="free" type="checkbox" '+(rule.free?'checked':'')+'>Serviço gratuito</label>'+
    '<label>Datas bloqueadas (AAAA-MM-DD, separadas por vírgula)<input name="blocked" value="'+esc(rule.blocked.join(', '))+'"></label>'+
    '<label class="checkline"><input name="active" type="checkbox" '+(rule.active?'checked':'')+'>Disponível para reservas online</label>'+
    '<p class="error" role="alert"></p><div class="row"><button class="primary">Salvar disponibilidade</button>'+btn('Cancelar',publishPanel)+'</div>';
  form.onsubmit=async event=>{
    event.preventDefault();
    const data=new FormData(form);
    const submit=form.querySelector('button.primary');
    submit.disabled=true;
    try{
      await api('/publicacao',{
        ...Object.fromEntries(data),id:existing?.id,previous:existing,days:data.getAll('days'),
        blocked:data.get('blocked').split(',').map(value=>value.trim()).filter(Boolean),active:data.has('active'),
        fee_cents:data.get('fee')===''?'':cents(data.get('fee')),free:data.has('free')
      });
      await publishPanel();
    }catch(error){form.querySelector('.error').textContent=error.message}
    finally{submit.disabled=false}
  };
}
