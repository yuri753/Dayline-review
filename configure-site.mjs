import {loadEnv} from 'file:///G:/Dayline/node_modules/vite/dist/node/index.js';
import {writeFile} from 'node:fs/promises';
const env=loadEnv('production','G:/Dayline','VITE_SUPABASE_');
// Only the two public Supabase settings belong in the static site.
const config={url:env.VITE_SUPABASE_URL||'',key:env.VITE_SUPABASE_ANON_KEY||''};
if(config.key.startsWith('sb_secret_'))throw new Error('A configuração deve usar a chave pública do Supabase.');
if(config.key.split('.').length===3){const payload=JSON.parse(Buffer.from(config.key.split('.')[1],'base64url'));if(payload.role!=='anon')throw new Error('A configuração deve usar a chave anon pública.');}
await writeFile(new URL('../review-config.json',import.meta.url),JSON.stringify(config,null,2)+'\n');
console.log(config.url&&config.key?'Configuração pública do site preparada.':'Faltam URL/chave pública do Supabase em review-config.json.');
