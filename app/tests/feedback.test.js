import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCanvas} from '../src/feedback/contract.js';
import {createFeedbackClient} from '../src/feedback/transport.js';

const key='12345678-1234-1234-1234-123456789abc';
const canvas=()=>({version:2,items:[{id:'note-1',kind:'note',x:-300,y:50,w:240,h:180,text:'Corrigir a cor',textStyle:{bold:true}}],paths:[],assets:{},videoTime:5});
const config={url:'https://example.supabase.co',key:'public-key',accessKey:key};
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});

test('accepts the full canvas, including images, prints, styling, colors and drawings',()=>{
  const data=canvas();
  data.items.push({id:'print-1',kind:'print',x:5,y:8,w:360,h:300,assetId:'asset-1',videoTime:34,annotation:'Mudar este detalhe',imageTitle:'Referência',annotationStyle:{color:'#aabbcc',size:18}});
  data.assets['asset-1']='data:image/png;base64,aGVsbG8=';
  data.paths.push({id:'line-1',from:'note-1',to:'print-1',color:'#ffffff',width:4},{id:'draw-1',points:[{x:1,y:2},{x:3,y:4}],color:'#000000',width:2});
  assert.equal(validateCanvas(data),data);
});
test('rejects executable URLs, SVG images, missing assets, invalid connections and oversized payloads',()=>{
  const data=canvas();
  data.items[0]={...data.items[0],kind:'link',url:'javascript:alert(1)'};
  assert.throws(()=>validateCanvas(data));
  const image=canvas();image.items.push({id:'image',kind:'image',x:0,y:0,w:200,h:200,assetId:'missing'});
  assert.throws(()=>validateCanvas(image),/imagem/);
  image.assets.missing='data:image/svg+xml;base64,aGVsbG8=';assert.throws(()=>validateCanvas(image));
  const link=canvas();link.paths.push({id:'link',from:'note-1',to:'absent',color:'#ffffff',width:2});assert.throws(()=>validateCanvas(link),/conexão/);
  const large=canvas();large.assets.a='data:image/png;base64,'+'A'.repeat(3000000);large.assets.b=large.assets.a;assert.throws(()=>validateCanvas(large),/5 MB/);
});
test('metadata checks use the commission capability and never download the canvas',async()=>{
  const calls=[];const client=createFeedbackClient({...config,fetchImpl:async(...args)=>{calls.push(args);return response([{id:'submission'}]);}});
  await client.latest('commission & other');
  assert.equal(calls[0][1].headers['x-preview-key'],key);
  assert.match(calls[0][0],/id_comissao=eq.commission%20%26%20other/);
  assert.doesNotMatch(calls[0][0],/quadro/);
});
test('retry verifies existing submission when duplicate insert is ignored',async()=>{
  const calls=[];const client=createFeedbackClient({...config,fetchImpl:async(...args)=>{calls.push(args);return response(calls.length===1?[]:[{id:key}]);}});
  assert.deepEqual(await client.submit('commission',canvas(),key),{id:key});
  assert.equal(JSON.parse(calls[0][1].body).id,key);
  assert.match(calls[1][0],/id=eq/);
});
test('does not report success for server failure or missing preview capability',async()=>{
  assert.throws(()=>createFeedbackClient({...config,accessKey:''}),/link/);
  const client=createFeedbackClient({...config,fetchImpl:async()=>response({},403)});
  await assert.rejects(client.submit('commission',canvas(),key),/403/);
});
test('round trip keeps all original coordinates and annotations',async()=>{
  let stored;
  const client=createFeedbackClient({...config,fetchImpl:async(_url,options)=>{
    if(options.method==='POST'){stored=JSON.parse(options.body);return response([{...stored,criado_em:'2026-09-13T12:00:00Z'}]);}
    return response([stored]);
  }});
  const source=canvas();await client.submit('commission',source,key);
  assert.deepEqual((await client.latest('commission',true)).quadro,source);
});
