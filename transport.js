import {validateCanvas} from './contract.js';

function validateBase(url,key,accessKey){
  if(!url||!key)throw new Error('A conexão de feedback ainda não foi configurada.');
  const base=new URL(url);
  if(base.protocol!=='https:'||base.username||base.password)throw new Error('Endereço de feedback inválido.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accessKey||''))throw new Error('Abra o link de prévia fornecido pelo responsável pela comissão.');
  return base;
}

async function responseError(response,fallback){
  let body;
  try{body=await response.json();}catch{}
  const message=body?.message||body?.error_description||body?.error;
  if(message)return new Error(message);
  return new Error(fallback||`Não foi possível acessar o feedback (${response.status}). Tente novamente.`);
}

export function createFeedbackClient({url,key,accessKey,fetchImpl=globalThis.fetch}){
  const base=validateBase(url,key,accessKey);
  const previewKeys=new Map();
  const headers={apikey:key,Authorization:`Bearer ${key}`,'x-preview-key':accessKey,'Content-Type':'application/json'};
  async function request(path,options={}){
    const response=await fetchImpl(`${base.href.replace(/\/$/,'')}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(20000)});
    if(!response.ok){
      if(response.status===404)throw new Error('O recebimento de feedback ainda não foi ativado no servidor.');
      throw await responseError(response);
    }
    return response.status===204?null:response.json();
  }
  const filter=commissionId=>`id_comissao=eq.${encodeURIComponent(commissionId)}`;
  return{
    async resolveCommission(){
      const rows=await request(`chaves_acesso?select=id_comissao&chave=eq.${encodeURIComponent(accessKey)}&limit=1`);
      if(!rows[0]?.id_comissao)throw new Error('Este link de prévia é inválido ou não está mais disponível.');
      return rows[0].id_comissao;
    },
    async video(commissionId){
      const row=(await request(`comissao_videos?select=url,object_key&${filter(commissionId)}&limit=1`))[0];
      previewKeys.set(commissionId,row?.object_key||null);
      return row?.url||null;
    },
    async latest(commissionId,includeCanvas=false){return(await request(`feedback_envios?select=id,criado_em${includeCanvas?',quadro':''}&${filter(commissionId)}&order=criado_em.desc,id.desc&limit=1`))[0]||null;},
    async submit(commissionId,canvas,submissionId){
      validateCanvas(canvas);
      const rows=await request('feedback_envios?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id:submissionId,id_comissao:commissionId,quadro:canvas,preview_object_key:previewKeys.get(commissionId)||null})});
      if(rows?.[0]?.id===submissionId)return rows[0];
      const saved=await request(`feedback_envios?select=id&${filter(commissionId)}&id=eq.${encodeURIComponent(submissionId)}&limit=1`);
      if(saved[0]?.id!==submissionId)throw new Error('O servidor não confirmou o envio. Tente novamente.');
      return saved[0];
    },
  };
}

export function createSharedFeedbackClient({url,key,accessKey,fetchImpl=globalThis.fetch}){
  const base=validateBase(url,key,accessKey);
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  async function rpc(name,body,{missingOk=false}={}){
    const response=await fetchImpl(`${base.href.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    if(!response.ok){
      if(missingOk&&response.status===404)return null;
      throw await responseError(response,`Não foi possível acessar a prévia compartilhada (${response.status}).`);
    }
    if(response.status===204)return null;
    return response.json();
  }
  const normalizeRow=row=>({
    display_name:String(row?.display_name||'Integrante'),
    avatar_data:typeof row?.avatar_data==='string'?row.avatar_data:'',
    preview_id:String(row?.preview_id||''),
    revision:Number(row?.revision)||1,
    created_at:row?.created_at||null,
    awaiting_client_feedback:Boolean(row?.awaiting_client_feedback),
    video_url:String(row?.video_url||''),
    file_name:String(row?.file_name||''),
  });
  return{
    async project(){
      const rows=await rpc('dayline_collab_preview_public_project',{p_public_token:accessKey},{missingOk:true});
      if(rows===null)return null;
      return Array.isArray(rows)&&rows[0]?.title?{title:String(rows[0].title)}:false;
    },
    async previews(){
      const rows=await rpc('dayline_collab_preview_public',{p_public_token:accessKey});
      return(Array.isArray(rows)?rows:[]).map(normalizeRow).filter(row=>/^[0-9a-f-]{36}$/i.test(row.preview_id));
    },
    async submit(previewId,canvas,submissionId){
      validateCanvas(canvas);
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(previewId||''))throw new Error('Selecione uma prévia válida antes de enviar.');
      const changesCount=canvas.items.length+canvas.paths.length;
      const id=await rpc('dayline_collab_preview_submit_feedback',{
        p_public_token:accessKey,p_preview_id:previewId,p_feedback_id:submissionId,p_quadro:canvas,p_changes_count:changesCount,
      });
      if(id!==submissionId)throw new Error('O servidor não confirmou o envio. Tente novamente.');
      return{id};
    },
  };
}
