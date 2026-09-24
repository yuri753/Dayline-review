import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedFeedbackClient,createFeedbackClient} from './feedback/transport.js';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const token='11111111-1111-4111-8111-111111111111';
const preview='22222222-2222-4222-8222-222222222222';
const submission='33333333-3333-4333-8333-333333333333';
const canvas={version:2,items:[{id:'note_1',kind:'note',x:0,y:0,w:200,h:150,text:'Ajustar cor'}],paths:[],assets:{},videoTime:0};
const settings={url:'https://example.supabase.co',key:'public-key',accessKey:token};

test('shared feedback uses only the project token and selected preview revision',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,options});
    if(url.endsWith('/dayline_collab_preview_public'))return {ok:true,status:200,json:async()=>[{preview_id:preview,revision:2,display_name:'Ana',video_url:'https://files.example/video.mp4'}]};
    if(url.endsWith('/dayline_collab_preview_submit_feedback'))return {ok:true,status:200,json:async()=>submission};
    throw new Error('Unexpected URL');
  };
  const client=createSharedFeedbackClient({...settings,fetchImpl});
  assert.equal((await client.previews())[0].revision,2);
  assert.equal((await client.submit(preview,canvas,submission)).id,submission);
  assert.deepEqual(JSON.parse(requests[1].options.body),{
    p_public_token:token,p_preview_id:preview,p_feedback_id:submission,p_quadro:canvas,p_changes_count:1,
  });
  assert.equal(requests[1].options.headers['x-preview-key'],undefined);
});

test('failed shared submission cannot be shown as confirmed',async()=>{
  const client=createSharedFeedbackClient({...settings,fetchImpl:async()=>({ok:false,status:403,json:async()=>({message:'Prévia indisponível'})})});
  await assert.rejects(client.submit(preview,canvas,submission),/Prévia indisponível/);
});

test('individual links keep the existing commission lookup',async()=>{
  const client=createFeedbackClient({...settings,fetchImpl:async()=>({ok:true,status:200,json:async()=>[{id_comissao:'local-commission'}]})});
  assert.equal(await client.resolveCommission(),'local-commission');
});

test('site switches members without sending another member draft and submits the selected revision',async()=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:`https://review.example/?key=${token}`});
  const {window}=dom;
  globalThis.window=window;globalThis.document=window.document;globalThis.location=window.location;globalThis.CustomEvent=window.CustomEvent;
  window.HTMLMediaElement.prototype.pause=()=>{};
  window.HTMLMediaElement.prototype.load=()=>{};
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  let dirty=false,clears=0,allowSwitch=false,submitted;
  window.daylineReviewBoard={hasDraft:()=>dirty,clear:()=>{clears++;dirty=false;}};
  globalThis.confirm=()=>allowSwitch;
  const second='44444444-4444-4444-8444-444444444444';
  const rows=[
    {preview_id:preview,revision:1,display_name:'Ana',video_url:'https://files.example/ana.mp4',created_at:'2026-09-23T00:00:00Z',awaiting_client_feedback:true},
    {preview_id:second,revision:2,display_name:'João',video_url:'https://files.example/joao.mp4',created_at:'2026-09-23T00:00:00Z',awaiting_client_feedback:true},
  ];
  globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith('review-config.json'))return {ok:true,json:async()=>({url:settings.url,key:settings.key})};
    if(String(url).endsWith('/dayline_collab_preview_public'))return {ok:true,status:200,json:async()=>rows};
    if(String(url).endsWith('/dayline_collab_preview_submit_feedback')){submitted=JSON.parse(options.body);return {ok:true,status:200,json:async()=>submitted.p_feedback_id};}
    throw new Error(`Unexpected URL: ${url}`);
  };
  await import('./feedback/site.js?ui-test');
  await new Promise(resolve=>setTimeout(resolve,20));
  const buttons=[...document.querySelectorAll('[data-preview-id]')];
  assert.equal(buttons.length,2);
  assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
  dirty=true;buttons[1].click();assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
  allowSwitch=true;buttons[1].click();assert.equal(buttons[1].getAttribute('aria-pressed'),'true');
  assert.equal(clears,2);
  document.dispatchEvent(new CustomEvent('dayline:submit-adjustments',{detail:canvas,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(submitted.p_preview_id,second);
  assert.equal(submitted.p_changes_count,1);
  assert.match(document.querySelector('#send-message').textContent,/João/);
  dom.window.close();
});
