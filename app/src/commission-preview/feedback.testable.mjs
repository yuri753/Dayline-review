import {supabaseConfig} from './config.js';
import {accessKeyStore} from './access-key-store.js';
import {createFeedbackClient} from '../feedback/transport.js';
import {mountFeedbackViewer} from '../feedback/viewer.js';

export function createFeedbackActions({getCommission, getCommissions, getConfig=supabaseConfig, onNewFeedback=()=>{}}) {
  const records=new Map(), errors=new Map(), seen=new Map(), announced=new Map();
  let dialog,view,status,heading,refresh,viewer,activeId,requestVersion=0,polling=false,timer;
  function connection(id) {
    const config=getConfig();
    if(!config.url||!config.key)throw new Error('Configure a conexão Supabase do app para receber feedback.');
    const key=accessKeyStore.get(config.url.replace(/\/$/,''),id);
    if(!key)throw new Error('Gere e compartilhe o link de prévia desta comissão primeiro.');
    return createFeedbackClient({...config,accessKey:key});
  }
  const readKey=id=>`dayline.feedback-read:${getConfig().url}:${id}`;
  function remember(id,record){const previous=records.get(id);if(!previous||(record&&`${record.criado_em}:${record.id}`>=`${previous.criado_em}:${previous.id}`))records.set(id,record);}
  function lastRead(id){if(seen.has(id))return seen.get(id);try{return localStorage.getItem(readKey(id));}catch{return null;}}
  function updateButtons(){
    for(const button of document.querySelectorAll('[data-action="client-feedback"]')){
      const id=button.dataset.id,record=records.get(id),unread=!!record&&lastRead(id)!==record.id;
      button.dataset.unread=String(unread);
      button.textContent=unread?'Feedback do cliente · Novo':'Feedback do cliente';
      button.title=errors.get(id)||'Abrir o canvas enviado pelo cliente';
    }
  }
  async function check(id){
    try{
      const result=await connection(id).latest(id);remember(id,result);errors.delete(id);
      const record=records.get(id), key=`dayline.feedback-announced:${getConfig().url}:${id}`;
      let previous=announced.get(id);try{previous=previous||localStorage.getItem(key);}catch{}
      if(record&&lastRead(id)!==record.id&&previous!==record.id){
        onNewFeedback(getCommission(id));
        announced.set(id,record.id);try{localStorage.setItem(key,record.id);}catch{}
      }
    }
    catch(error){errors.set(id,error.message);}
  }
  async function poll(){
    if(polling||document.hidden)return;
    polling=true;
    try{
      // Sequential small metadata requests: never download images in the background.
      for(const item of getCommissions()){
        if(document.hidden)break;
        const config=getConfig();
        if(!config.url||!config.key)break;
        try{if(!accessKeyStore.get(config.url.replace(/\/$/,''),item.id))continue;}catch{continue;}
        await check(item.id);
      }
      updateButtons();
    }finally{polling=false;}
  }
  function ensureDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.className='feedback-dialog';dialog.setAttribute('aria-label','Feedback do cliente');
    const header=document.createElement('div');header.className='feedback-dialog-header';
    heading=document.createElement('h2');refresh=document.createElement('button');refresh.type='button';refresh.textContent='Atualizar';
    const close=document.createElement('button');close.type='button';close.textContent='Fechar';close.onclick=()=>dialog.close();
    header.append(heading,refresh,close);status=document.createElement('p');status.className='feedback-dialog-status';status.setAttribute('role','status');
    view=document.createElement('div');view.className='feedback-view';dialog.append(header,status,view);document.body.append(dialog);
    refresh.onclick=()=>load(activeId);
    dialog.addEventListener('close',()=>{requestVersion++;viewer?.destroy();viewer=null;activeId=null;});
  }
  async function load(id){
    const version=++requestVersion;refresh.disabled=true;status.textContent='Buscando pedidos do cliente…';
    viewer?.destroy();viewer=null;
    try{
      const record=await connection(id).latest(id,true);
      if(version!==requestVersion||!dialog.open)return;
      remember(id,record);errors.delete(id);
      if(!record){status.textContent='Nenhum canvas enviado pelo cliente ainda.';updateButtons();return;}
      viewer=mountFeedbackViewer(view,record.quadro);
      status.textContent=`Recebido em ${new Date(record.criado_em).toLocaleString('pt-BR')}. Visualização do envio mais recente.`;
      seen.set(id,record.id);try{localStorage.setItem(readKey(id),record.id);}catch{status.textContent+=' O aviso de leitura não pôde ser salvo neste dispositivo.';}
      updateButtons();
    }catch(error){if(version===requestVersion)status.textContent=error.message||'Não foi possível carregar o canvas. Tente atualizar.';}
    finally{if(version===requestVersion)refresh.disabled=false;}
  }
  function open(button){const item=getCommission(button.dataset.id);if(!item)return;ensureDialog();activeId=item.id;heading.textContent=`Feedback · ${item.name}`;if(!dialog.open)dialog.showModal();load(item.id);}
  function start(){if(timer)return;poll();timer=setInterval(poll,60000);}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  window.addEventListener('focus',poll);
  window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;});
  return {actions:{'client-feedback':open},updateButtons,start};
}
