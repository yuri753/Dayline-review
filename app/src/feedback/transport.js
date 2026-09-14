import {validateCanvas} from './contract.js';

export function createFeedbackClient({url, key, accessKey, fetchImpl = globalThis.fetch}) {
  if (!url || !key) throw new Error('A conexão de feedback ainda não foi configurada.');
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Endereço de feedback inválido.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accessKey || '')) throw new Error('Abra o link de prévia fornecido pelo responsável pela comissão.');
  const headers = {apikey:key,Authorization:`Bearer ${key}`,'x-preview-key':accessKey,'Content-Type':'application/json'};
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base.href.replace(/\/$/,'')}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(20000)});
    if (!response.ok) {
      if (response.status === 404) throw new Error('O recebimento de feedback ainda não foi ativado no servidor.');
      throw new Error(`Não foi possível acessar o feedback (${response.status}). Tente novamente.`);
    }
    return response.status === 204 ? null : response.json();
  }
  const filter = commissionId => `id_comissao=eq.${encodeURIComponent(commissionId)}`;
  return {
    async resolveCommission() {
      const rows = await request(`chaves_acesso?select=id_comissao&chave=eq.${encodeURIComponent(accessKey)}&limit=1`);
      if (!rows[0]?.id_comissao) throw new Error('Este link de prévia é inválido ou não está mais disponível.');
      return rows[0].id_comissao;
    },
    async video(commissionId) {return (await request(`comissao_videos?select=url&${filter(commissionId)}&limit=1`))[0]?.url || null;},
    async latest(commissionId, includeCanvas = false) {
      return (await request(`feedback_envios?select=id,criado_em${includeCanvas?',quadro':''}&${filter(commissionId)}&order=criado_em.desc,id.desc&limit=1`))[0] || null;
    },
    async submit(commissionId, canvas, submissionId) {
      validateCanvas(canvas);
      const rows = await request('feedback_envios?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id:submissionId,id_comissao:commissionId,quadro:canvas})});
      if (rows?.[0]?.id === submissionId) return rows[0];
      const saved = await request(`feedback_envios?select=id&${filter(commissionId)}&id=eq.${encodeURIComponent(submissionId)}&limit=1`);
      if (saved[0]?.id !== submissionId) throw new Error('O servidor não confirmou o envio. Tente novamente.');
      return saved[0];
    },
  };
}
