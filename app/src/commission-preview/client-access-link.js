import {accessKeyStore} from "./access-key-store.js";
import {REVIEW_SITE_URL} from './review-site.js';
const FEEDBACK_BASE_URL = REVIEW_SITE_URL;

function configuredClient(config) {
  const url = String(config?.url || "").replace(/\/$/, "");
  const key = String(config?.key || "");
  if (!url || !key) throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para gerar links.");
  return {url, key};
}

function headers(key, accessKey, extra = {}) {
  return {apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "x-preview-key": accessKey, ...extra};
}

async function readKey(commissionId, config, fetchImpl, accessKey) {
  const response = await fetchImpl(`${config.url}/rest/v1/chaves_acesso?select=chave&id_comissao=eq.${encodeURIComponent(commissionId)}&limit=1`, {headers: headers(config.key, accessKey)});
  if (!response.ok) throw new Error(`Não foi possível consultar o link (${response.status}).`);
  const rows = await response.json();
  return rows[0]?.chave || null;
}

export function feedbackUrl(key, baseUrl = FEEDBACK_BASE_URL) {
  if (!baseUrl) throw new Error('Cole o endereço do site publicado em src/commission-preview/review-site.js.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Use um endereço HTTPS para o site publicado.');
  url.searchParams.set("key", key);
  return url.href;
}

export async function getClientAccessKey(commissionId, {config, fetchImpl = globalThis.fetch, keyStore = accessKeyStore} = {}) {
  if (!commissionId) throw new Error("A comissão atual não possui identificador.");
  if (typeof fetchImpl !== "function") throw new Error("O navegador não oferece acesso à rede.");
  const client = configuredClient(config);
  const key = keyStore.get(client.url, commissionId);
  return key ? readKey(commissionId, client, fetchImpl, key) : null;
}

export async function getOrCreateClientAccessKey(commissionId, {config, fetchImpl = globalThis.fetch, keyStore = accessKeyStore} = {}) {
  if (!commissionId) throw new Error("A comissão atual não possui identificador.");
  const client = configuredClient(config);
  let key = keyStore.get(client.url, commissionId);
  if (!key) {
    key = crypto.randomUUID();
    // Persist before the request so retries never lose a successfully inserted key.
    keyStore.set(client.url, commissionId, key);
  }
  const existing = await readKey(commissionId, client, fetchImpl, key);
  if (existing) return {key: existing, created: false};
  const response = await fetchImpl(`${client.url}/rest/v1/chaves_acesso`, {
    method: "POST",
    headers: headers(client.key, key, {Prefer: "return=minimal"}),
    body: JSON.stringify({chave: key, id_comissao: commissionId}),
  });
  if (!response.ok && response.status !== 409) throw new Error(`Não foi possível salvar o link (${response.status}).`);
  const savedKey = response.ok ? key : await readKey(commissionId, client, fetchImpl, key);
  if (!savedKey) throw new Error("Esta comissão já possui uma chave que não está salva neste dispositivo. Recupere a chave original; não é permitido consultar chaves de outras prévias.");
  return {key: savedKey, created: response.ok};
}

export async function getOrCreateClientAccessLink(commissionId, options = {}) {
  configuredClient(options.config);
  const baseUrl = options.config?.feedbackBaseUrl ?? FEEDBACK_BASE_URL;
  feedbackUrl('', baseUrl); // Validate before creating or storing a key.
  const result = await getOrCreateClientAccessKey(commissionId, options);
  return {...result, url: feedbackUrl(result.key, baseUrl)};
}

export {FEEDBACK_BASE_URL};
