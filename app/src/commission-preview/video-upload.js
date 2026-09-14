import {S3Client, DeleteObjectCommand} from "@aws-sdk/client-s3";
import {Upload} from "@aws-sdk/lib-storage";

import {videoConfig} from "./config.js";
import {getOrCreateClientAccessKey} from "./client-access-link.js";

function configured(config) {
  const missing = ["keyId", "applicationKey", "endpoint", "bucket", "supabaseUrl", "supabaseKey"].filter(key => !config?.[key]);
  if (missing.length) throw new Error(`Configure as variáveis de vídeo: ${missing.join(", ")}.`);
  return {...config, endpoint: String(config.endpoint).replace(/\/$/, "")};
}

function supabaseHeaders(config, extra = {}) {
  return {apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, "Content-Type": "application/json", "x-preview-key": config.accessKey, ...extra};
}

function objectUrl(config, objectKey) {
  const base = String(config.publicBaseUrl || `${config.endpoint}/${config.bucket}`).replace(/\/$/, "");
  return `${base}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function existingVideo(commissionId, config, fetchImpl) {
  const response = await fetchImpl(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/comissao_videos?select=id_comissao,object_key,url,nome_arquivo&id_comissao=eq.${encodeURIComponent(commissionId)}&limit=1`, {headers: supabaseHeaders(config)});
  if (!response.ok) throw new Error(`Não foi possível consultar o vídeo salvo (${response.status}).`);
  return (await response.json())[0] || null;
}

async function saveVideo(commissionId, video, config, fetchImpl) {
  const response = await fetchImpl(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/comissao_videos?on_conflict=id_comissao`, {
    method: "POST",
    headers: supabaseHeaders(config, {Prefer: "resolution=merge-duplicates,return=minimal"}),
    body: JSON.stringify({id_comissao: commissionId, object_key: video.objectKey, url: video.url, nome_arquivo: video.fileName}),
  });
  if (!response.ok) throw new Error(`Não foi possível salvar o vídeo no Supabase (${response.status}).`);
}

async function deleteObject(objectKey, config, client) {
  if (!objectKey) return;
  await client.send(new DeleteObjectCommand({Bucket: config.bucket, Key: objectKey}));
}

export async function uploadCommissionVideo(commissionId, file, {config = videoConfig(), fetchImpl = globalThis.fetch, onProgress = () => {}} = {}) {
  if (!commissionId || !file) throw new Error("Selecione um vídeo para enviar.");
  const settings = configured(config);
  const access = await getOrCreateClientAccessKey(commissionId, {config: {url: settings.supabaseUrl, key: settings.supabaseKey}, fetchImpl});
  settings.accessKey = access.key;
  const previous = await existingVideo(commissionId, settings, fetchImpl);
  const objectKey = `${commissionId}/${String(file.name || "video").replace(/[\\/]/g, "_")}`;
  const client = new S3Client({region: "us-east-1", endpoint: settings.endpoint, credentials: {accessKeyId: settings.keyId, secretAccessKey: settings.applicationKey}});
  let uploaded = false;
  try {
    const upload = new Upload({client, params: {Bucket: settings.bucket, Key: objectKey, Body: file, ContentType: file.type || "application/octet-stream"}, queueSize: 3, partSize: 10 * 1024 * 1024, leavePartsOnError: false});
    upload.on("httpUploadProgress", progress => onProgress(progress.loaded || 0, progress.total || file.size || 0));
    await upload.done();
    uploaded = true;
    const video = {objectKey, url: objectUrl(settings, objectKey), fileName: file.name || "video"};
    try {
      await saveVideo(commissionId, video, settings, fetchImpl);
    } catch (error) {
      await deleteObject(objectKey, settings, client).catch(() => {});
      throw error;
    }
    if (previous?.object_key && previous.object_key !== objectKey) await deleteObject(previous.object_key, settings, client);
    onProgress(file.size || 1, file.size || 1);
    return video;
  } catch (error) {
    if (!uploaded) throw new Error(`O upload do vídeo falhou. O vídeo anterior foi preservado. ${error.message || "Tente novamente."}`);
    throw error;
  }
}
