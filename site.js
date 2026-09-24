import {createFeedbackClient,createSharedFeedbackClient} from './transport.js?v=0.6.6.3';

const send=document.querySelector('#send');
const message=document.querySelector('#send-message');
const dialog=document.querySelector('#send-dialog');
const video=document.querySelector('video');
const videoStatus=document.querySelector('#video-status');
const members=document.querySelector('#preview-members');
const memberTitle=document.querySelector('#preview-member-title');
const memberMeta=document.querySelector('#preview-member-meta');
let mode='loading',legacyClient,sharedClient,commissionId,sharedRows=[],selectedPreview=null,sending=false;
const submissionState=new Map();

function show(text){message.textContent=text;if(!dialog.open)dialog.showModal();}
function safeAvatar(value){return /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value||'')||/^https:\/\//i.test(value||'')?value:'';}
function initials(name){return String(name||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase()||'?';}
function formatDate(value){if(!value)return'';const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(date);}
function setVideo(url){
  video.pause();video.removeAttribute('src');
  if(url&&/^https:\/\//i.test(url)){video.src=url;video.load();videoStatus.textContent='Carregando a prévia…';}
  else{video.load();videoStatus.textContent='Nenhum vídeo foi enviado para esta prévia.';}
}
function boardHasDraft(){return Boolean(window.daylineReviewBoard?.hasDraft?.());}
function clearBoard(){window.daylineReviewBoard?.clear?.();}
function setSending(value){
  sending=value;send.disabled=value;
  members.setAttribute('aria-busy',String(value));
  for(const button of members.querySelectorAll('button'))button.disabled=value;
}

function renderMembers(){
  if(mode!=='shared'){members.hidden=true;memberTitle.textContent='';memberMeta.textContent='';return;}
  members.hidden=false;members.replaceChildren();
  if(!sharedRows.length){
    const empty=document.createElement('p');empty.className='preview-members-empty';empty.textContent='Nenhum integrante enviou uma prévia ainda.';members.append(empty);memberTitle.textContent='';memberMeta.textContent='';return;
  }
  for(const row of sharedRows){
    const button=document.createElement('button');button.type='button';button.className='preview-member';button.dataset.previewId=row.preview_id;button.setAttribute('aria-pressed',String(selectedPreview?.preview_id===row.preview_id));
    button.disabled=sending;
    button.setAttribute('aria-label',`${row.display_name}, revisão ${row.revision}${row.awaiting_client_feedback?', aguardando feedback':''}`);
    const avatar=safeAvatar(row.avatar_data);
    if(avatar){const img=document.createElement('img');img.src=avatar;img.alt='';button.append(img);}else{const fallback=document.createElement('span');fallback.className='preview-member-avatar';fallback.textContent=initials(row.display_name);button.append(fallback);}
    const name=document.createElement('span');name.className='preview-member-name';name.textContent=row.display_name;button.append(name);
    if(row.awaiting_client_feedback){const dot=document.createElement('span');dot.className='preview-member-dot';dot.title='Nova prévia aguardando feedback';dot.setAttribute('aria-label','Nova prévia aguardando feedback');button.append(dot);}
    button.addEventListener('click',()=>selectPreview(row));members.append(button);
  }
  if(selectedPreview){
    memberTitle.textContent=`Prévia de ${selectedPreview.display_name}`;
    const sent=formatDate(selectedPreview.created_at);memberMeta.textContent=`Revisão ${selectedPreview.revision}${sent?` · enviada em ${sent}`:''}`;
  }
}

function selectPreview(row,{initial=false}={}){
  if(sending&&!initial)return;
  if(selectedPreview?.preview_id===row.preview_id)return;
  if(!initial&&boardHasDraft()&&!confirm('Você tem ajustes ainda não enviados. Trocar de integrante vai limpar este quadro. Deseja continuar?'))return;
  clearBoard();
  selectedPreview=row;setVideo(row.video_url);renderMembers();
  if(!row.video_url&&!row.awaiting_client_feedback)videoStatus.textContent='Vídeo retirado da prévia. Os feedbacks enviados foram preservados.';
}

async function connect(){
  // Resolve from the page so source and flat publication use the same configuration.
  const response=await fetch(new URL('./review-config.json',document.baseURI),{cache:'no-store'});
  if(!response.ok)throw new Error('A conexão de feedback ainda não foi configurada.');
  const config=await response.json();
  const accessKey=new URLSearchParams(location.search).get('key')||location.pathname.match(/\/feedback\/([0-9a-f-]+)\/?$/i)?.[1];
  sharedClient=createSharedFeedbackClient({...config,accessKey});
  let sharedProject=null;
  try{sharedRows=await sharedClient.previews();}catch(error){
    // A RPC nova ausente significa que este servidor ainda está no modo legado.
    if(!/function|schema cache|404|recebimento/i.test(String(error?.message||'')))throw error;
  }
  if(sharedRows.length)sharedProject={title:''};
  else{
    try{sharedProject=await sharedClient.project();}catch{sharedProject=false;}
  }
  if(sharedProject){
    mode='shared';
    if(sharedRows.length)selectPreview(sharedRows[0],{initial:true});else{setVideo('');renderMembers();}
    return;
  }
  legacyClient=createFeedbackClient({...config,accessKey});
  commissionId=await legacyClient.resolveCommission();mode='legacy';renderMembers();
  try{const url=await legacyClient.video(commissionId);setVideo(url);}catch{videoStatus.textContent='Não foi possível carregar a prévia. Você ainda pode enviar notas e referências.';}
}

function connectWithStatus(){
  return connect().then(()=>null,error=>{
    videoStatus.textContent=error.message||'Não foi possível carregar a prévia. Tente novamente.';
    return error;
  });
}
let connection=connectWithStatus();
document.addEventListener('dayline:submit-adjustments',async event=>{
  event.preventDefault();if(sending)return;
  setSending(true);show('Enviando seus pedidos…');
  try{
    let error=await connection;
    if(error){connection=connectWithStatus();error=await connection;}
    if(error)throw error;
    const payload=JSON.stringify(event.detail);
    if(mode==='shared'){
      if(!selectedPreview)throw new Error('Nenhuma prévia da equipe está disponível para receber feedback.');
      const targetPreview=selectedPreview;
      const previous=submissionState.get(targetPreview.preview_id)||{};
      const submissionId=previous.payload===payload?previous.id:crypto.randomUUID();
      submissionState.set(targetPreview.preview_id,{payload,id:submissionId});
      await sharedClient.submit(targetPreview.preview_id,JSON.parse(payload),submissionId);
      targetPreview.awaiting_client_feedback=false;targetPreview.video_url='';setVideo('');renderMembers();
      videoStatus.textContent='Feedback salvo. A remoção do vídeo da nuvem foi agendada.';
      show(`Pedidos enviados para ${targetPreview.display_name}! O feedback ficou vinculado somente a esta prévia.`);
    }else{
      const key=`legacy:${commissionId}`;const previous=submissionState.get(key)||{};
      const submissionId=previous.payload===payload?previous.id:crypto.randomUUID();submissionState.set(key,{payload,id:submissionId});
      await legacyClient.submit(commissionId,JSON.parse(payload),submissionId);
      setVideo('');videoStatus.textContent='Feedback salvo. A remoção do vídeo da nuvem foi agendada.';
      show('Pedidos enviados! O responsável pela comissão poderá abrir seu canvas no Dayline.');
    }
  }catch(error){show(`${error.message||'Não foi possível enviar.'} Seus pedidos continuam neste quadro.`);}
  finally{setSending(false);}
});
