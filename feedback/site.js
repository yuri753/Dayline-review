import {createFeedbackClient} from './transport.js';

const send = document.querySelector('#send');
const message = document.querySelector('#send-message');
const dialog = document.querySelector('#send-dialog');
let client, commissionId, sending = false, lastPayload, submissionId;
function show(text) {message.textContent = text; if (!dialog.open) dialog.showModal();}
async function connect() {
  const response = await fetch(new URL('../review-config.json',import.meta.url),{cache:'no-store'});
  if (!response.ok) throw new Error('A conexão de feedback ainda não foi configurada.');
  const config = await response.json();
  const accessKey = new URLSearchParams(location.search).get('key') || location.pathname.match(/\/feedback\/([0-9a-f-]+)\/?$/i)?.[1];
  client = createFeedbackClient({...config,accessKey});
  commissionId = await client.resolveCommission();
  try {
    const url = await client.video(commissionId);
    if (url && new URL(url).protocol === 'https:') document.querySelector('video').src = url;
  } catch {document.querySelector('#video-status').textContent = 'Não foi possível carregar a prévia. Você ainda pode enviar notas e referências.';}
}
let connection = connect().then(() => null, error => error);
document.addEventListener('dayline:submit-adjustments', async event => {
  event.preventDefault();
  if (sending) return;
  sending = true; send.disabled = true;
  show('Enviando seus pedidos…');
  try {
    let error = await connection;
    if (error) {connection = connect().then(() => null, error => error); error = await connection;}
    if (error) throw error;
    const payload = JSON.stringify(event.detail);
    if (payload !== lastPayload) {lastPayload = payload; submissionId = crypto.randomUUID();}
    await client.submit(commissionId,JSON.parse(payload),submissionId);
    show('Pedidos enviados! O responsável pela comissão poderá abrir seu canvas no Dayline.');
  } catch (error) {show(`${error.message || 'Não foi possível enviar.'} Seus pedidos continuam neste quadro.`);}
  finally {sending = false; send.disabled = false;}
});
