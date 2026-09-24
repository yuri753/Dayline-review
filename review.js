(() => {
  'use strict';
  const $ = s => document.querySelector(s), board = $('#board'), world = $('#world');
  const labels = {note:'Nota',comment:'Comentário',image:'Referência',print:'Print do vídeo',link:'Link',color:'Cor'};
  let items=[], paths=[], selected=null, tool='select', camera={x:0,y:0,z:1}, drag=null, space=false, connection=null;
  // FIX: dados de imagem (dataURLs / URLs) ficam fora do que é versionado pelo undo.
  // Antes, cada snapshot do histórico serializava o `src` inteiro de cada imagem/print,
  // duplicando potencialmente centenas de KB por estado (até 60 estados no histórico).
  // Agora os itens guardam só `assetId`, e o conteúdo real vive em `assets`.
  let assets = {};
  function gcAssets(){
    const used=new Set();
    const scan=json=>{try{for(const i of JSON.parse(json).items)if(i.assetId)used.add(i.assetId);}catch{}};
    for(const i of items)if(i.assetId)used.add(i.assetId);
    past.forEach(scan);future.forEach(scan);
    for(const id in assets)if(!used.has(id))delete assets[id];
  }
  // Per-field typography follows the same approach as Dayline's image title/annotation styles.
  let textField='text';
  const defaultTextStyle={fontFamily:'',size:14,color:'#edf0e8',bold:false,italic:false,underline:false,align:'left'};
  function fieldOptions(item){return ['image','print'].includes(item.kind)?[['imageTitle','Título'],['annotation','Anotação']]:[['text',item.kind==='link'?'Título do link':'Texto']];}
  function cssFontFamily(raw){
    // FIX: antes usava JSON.stringify(raw) direto, o que embrulhava a stack inteira
    // (ex.: "Georgia, serif") numa única string entre aspas — o CSS interpretava
    // isso como UM nome de fonte literal, quebrando o fallback. Agora cada nome
    // da lista é tratado (e citado) separadamente.
    return raw.split(',').map(f=>f.trim()).filter(Boolean).map(f=>/[\s'"]/.test(f)?JSON.stringify(f):f).join(', ');
  }
  function applyTextStyle(node,style={}){const s={...defaultTextStyle,...style};Object.assign(node.style,{fontFamily:s.fontFamily?cssFontFamily(s.fontFamily):'inherit',fontSize:s.size+'px',color:s.color,fontWeight:s.bold?'700':'400',fontStyle:s.italic?'italic':'normal',textDecoration:s.underline?'underline':'none',textAlign:s.align});}
  function styleCard(card,item){if(item.background)card.style.backgroundColor=item.background;card.querySelectorAll('[data-text-field]').forEach(node=>applyTextStyle(node,item[node.dataset.textField+'Style']));}
  function syncTextTools(){
    const item=items.find(i=>i.id===selected),tools=$('#text-tools');
    tools.hidden=!item||item.kind==='color'||tool!=='select';if(tools.hidden)return;
    const options=fieldOptions(item);if(!options.some(([field])=>field===textField))textField=options[0][0];
    const target=$('#text-target');target.replaceChildren();for(const [value,label]of options){const option=document.createElement('option');option.value=value;option.textContent=label;target.append(option);}target.value=textField;
    const style={...defaultTextStyle,...item[textField+'Style']};
    $('#text-font').value=style.fontFamily;$('#text-size').value=style.size;$('#text-align').value=style.align;$('#text-color').value=style.color;$('#card-color').value=item.background||'#252d23';
    for(const name of ['bold','italic','underline'])$('#text-'+name).setAttribute('aria-pressed',String(style[name]));
  }
  function changeTextStyle(change){
    const item=items.find(i=>i.id===selected);if(!item)return;const before=snapshot();
    item[textField+'Style']={...item[textField+'Style'],...change};commit(before);
    const card=$('#cards').querySelector('[data-id="'+item.id+'"]');if(card)styleCard(card,item);syncTextTools();
  }
  function textEditor(item,field,placeholder,tag='textarea'){
    const node=document.createElement(tag);if(tag==='input')node.type='text';node.value=item[field]||'';node.placeholder=placeholder;node.dataset.textField=field;node.setAttribute('aria-label',placeholder);
    let before;node.addEventListener('focus',()=>{before=snapshot();textField=field;select(item.id);});
    node.addEventListener('input',()=>{item[field]=node.value;$('#undo').disabled=false;});
    node.addEventListener('blur',()=>{if(before){commit(before);before=null;}});
    return node;
  }
  function formatTime(seconds){
    // FIX: antes só produzia mm:ss, quebrando a exibição em vídeos de referência com mais de 1h.
    const total=Math.max(0,Math.floor(seconds));
    const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
    const mm=String(m).padStart(2,'0'),ss=String(s).padStart(2,'0');
    return h>0?`${h}:${mm}:${ss}`:`${mm}:${ss}`;
  }
  function mediaContent(card,item){
    const media=document.createElement('div');media.className='media-content';
    const img=document.createElement('img');img.src=assets[item.assetId]||'';img.alt=item.imageTitle||item.text||'Referência';media.append(img);
    if(item.kind==='print'){
      const stamp=document.createElement('button');stamp.className='frame-time';stamp.textContent='▶ '+formatTime(item.videoTime);stamp.title='Voltar a este momento do vídeo';stamp.onclick=()=>{if(tool!=='select')return;const video=document.querySelector('video');if(video.readyState<1){notice('Aguarde o vídeo carregar.');return;}video.pause();video.currentTime=item.videoTime;};media.append(stamp);
    }
    card.append(textEditor(item,'imageTitle','Título da referência','input'),media,textEditor(item,'annotation','Descreva o ajuste neste print ou imagem…'));
  }
  $('#text-target').onchange=()=>{textField=$('#text-target').value;syncTextTools();};
  $('#text-font').onchange=()=>{const family=$('#text-font').value.trim();if(family.length>100||/[{};<>]/.test(family)){notice('Informe um nome de fonte válido.');return;}changeTextStyle({fontFamily:family});};
  $('#text-size').onchange=()=>{const size=Number($('#text-size').value);if(Number.isFinite(size)&&size>=8&&size<=72)changeTextStyle({size});else syncTextTools();};
  $('#text-align').onchange=()=>changeTextStyle({align:$('#text-align').value});
  $('#text-color').onchange=()=>changeTextStyle({color:$('#text-color').value});
  let backgroundEdit=null;
  function previewBackground(){
    const item=items.find(i=>i.id===selected);if(!item)return;
    if(!backgroundEdit)backgroundEdit={id:item.id,before:snapshot()};
    if(backgroundEdit.id!==item.id)return;
    item.background=$('#card-color').value;
    const card=$('#cards').querySelector('[data-id="'+item.id+'"]');if(card)styleCard(card,item);
  }
  function finishBackground(){if(backgroundEdit){commit(backgroundEdit.before);backgroundEdit=null;}}
  $('#card-color').oninput=previewBackground;
  $('#card-color').onchange=()=>{previewBackground();finishBackground();};
  $('#card-color').onblur=finishBackground;
  for(const key of ['bold','italic','underline'])$('#text-'+key).onclick=()=>{const item=items.find(i=>i.id===selected);if(item)changeTextStyle({[key]:!item[textField+'Style']?.[key]});};
  let captureInProgress=false;
  async function captureMoment(){
    if(captureInProgress)return;
    const video=document.querySelector('video');
    if(video.readyState<2||!video.videoWidth||!video.videoHeight||video.seeking){notice('Aguarde o vídeo carregar este momento antes de capturar.');return;}
    captureInProgress=true;$('#timestamp').disabled=true;video.pause();
    try{
      // Pausing preserves the current displayed frame. No reload or seek before drawing.
      const time=video.currentTime;
      const scale=Math.min(1,1600/video.videoWidth,1600/video.videoHeight);
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas');ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const src=canvas.toDataURL('image/jpeg',.88);
      const assetId=crypto.randomUUID();assets[assetId]=src;
      add('print',{assetId,videoTime:time,imageTitle:'Ajuste em '+formatTime(time),annotation:'',text:'Print em '+formatTime(time),w:360,h:Math.max(300,Math.min(540,360*canvas.height/canvas.width+150))});
      notice('Print de '+formatTime(time)+' adicionado. Escreva o pedido no cartão.');
    }catch(error){notice(error.name==='SecurityError'?'O servidor do vídeo não permite capturar a imagem. É necessário liberar CORS para este site.':'Não foi possível capturar este momento. Tente novamente após o vídeo carregar.');}
    finally{captureInProgress=false;$('#timestamp').disabled=false;}
  }

  const past=[], future=[];
  const snapshot=()=>JSON.stringify({items,paths});
  function commit(before){if(before===snapshot())return;past.push(before);if(past.length>60)past.shift();future.length=0;historyButtons();}
  function remember(){const before=snapshot();if(past.at(-1)!==before)past.push(before);if(past.length>60)past.shift();future.length=0;historyButtons();}
  function restore(before){({items,paths}=JSON.parse(before));render();}
  function focusBoard(){board.focus({preventScroll:true});}
  function select(id){selected=id;document.querySelectorAll('.card').forEach(c=>c.classList.toggle('selected',c.dataset.id===id));drawPaths();syncTextTools();}
  function endDrag(cancel=false){if(!drag)return;const d=drag;drag=null;if(cancel){if(d.before)restore(d.before);else if(d.kind==='pan'){camera.x=d.cx;camera.y=d.cy;view();}}else if(d.before)commit(d.before);board.classList.remove('is-dragging');if(board.hasPointerCapture?.(d.pointerId))board.releasePointerCapture(d.pointerId);
    // Garante que as linhas fiquem sempre consistentes ao final do drag,
    // mesmo quando foram puladas durante o movimento (ver otimização abaixo).
    drawPaths();
  }
  function editingTarget(target){return target.closest('textarea,input,select,a,button');}
  function historyButtons(){$('#undo').disabled=!past.length;$('#redo').disabled=!future.length;}
  function undo(redo=false){endDrag(true);const from=redo?future:past,to=redo?past:future;if(!from.length)return;to.push(snapshot());({items,paths}=JSON.parse(from.pop()));selected=null;connection=null;render();}
  function notice(text){$('#notice').textContent=text;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('#notice').textContent='',4000);}
  function point(e){const r=board.getBoundingClientRect();return{x:(e.clientX-r.left-camera.x)/camera.z,y:(e.clientY-r.top-camera.y)/camera.z};}
  function view(){world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;board.style.backgroundSize=`${24*camera.z}px ${24*camera.z}px`;board.style.backgroundPosition=`${camera.x}px ${camera.y}px`;$('#zoom-reset').textContent=Math.round(camera.z*100)+'%';}
  function zoom(z,x=board.clientWidth/2,y=board.clientHeight/2){const next=Math.max(.2,Math.min(3,z));camera.x=x-(x-camera.x)*next/camera.z;camera.y=y-(y-camera.y)*next/camera.z;camera.z=next;view();}
  function setTool(value){endDrag(true);document.activeElement?.blur();tool=value;connection=null;board.dataset.tool=value;document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===value));syncTextTools();$('#hint').textContent=value==='line'?'Clique em dois cartões para conectá-los':value==='draw'?'Arraste no quadro para desenhar':'Arraste o fundo para navegar · Role para zoom · Espaço para mover';}
  function add(kind,extra={}){endDrag(true);document.activeElement?.blur();const before=snapshot();const id=crypto.randomUUID(),w=extra.w||240,h=extra.h||180;let x=(board.clientWidth/2-camera.x)/camera.z-w/2,y=(board.clientHeight/2-camera.y)/camera.z-h/2;let offset=0;while(offset<8&&items.some(i=>Math.abs(i.x-x)<20&&Math.abs(i.y-y)<20)){x+=28;y+=28;offset++;}items.push({id,kind,x,y,w,h,text:'',color:'#b9d69b',...extra});selected=id;setTool('select');commit(before);render();focusBoard();}
  function remove(id){endDrag(true);document.activeElement?.blur();if(!items.some(i=>i.id===id)&&!paths.some(p=>p.id===id))return;remember();items=items.filter(i=>i.id!==id);paths=paths.filter(p=>p.id!==id&&p.from!==id&&p.to!==id);selected=null;render();gcAssets();}
  function drawPaths(){const svg=$('#lines');svg.replaceChildren();for(const p of paths){let d;if(p.from){const a=items.find(i=>i.id===p.from),b=items.find(i=>i.id===p.to);if(!a||!b)continue;const ac={x:a.x+a.w/2,y:a.y+a.h/2},bc={x:b.x+b.w/2,y:b.y+b.h/2},dx=bc.x-ac.x,dy=bc.y-ac.y;const edge=(c,i,direction)=>{const t=1/Math.max(Math.abs(dx)/(i.w/2),Math.abs(dy)/(i.h/2),1e-8);return{x:c.x+direction*dx*t,y:c.y+direction*dy*t};};const p1=edge(ac,a,1),p2=edge(bc,b,-1);d=`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;}else d=p.points.map((v,i)=>`${i?'L':'M'} ${v.x} ${v.y}`).join(' ');const node=document.createElementNS('http://www.w3.org/2000/svg','path');node.setAttribute('d',d);node.setAttribute('stroke',p.color);node.setAttribute('stroke-width',p.width);node.dataset.path=p.id;if(selected===p.id)node.classList.add('selected');const hit=node.cloneNode();hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width',Math.max(16/camera.z,p.width));hit.classList.remove('selected');node.style.pointerEvents='none';svg.append(hit,node);}}
  function render(){const container=$('#cards');container.replaceChildren();for(const item of items){const card=document.createElement('article');card.className=`card ${item.kind}${selected===item.id?' selected':''}`;card.dataset.id=item.id;Object.assign(card.style,{left:item.x+'px',top:item.y+'px',width:item.w+'px',height:item.h+'px'});const head=document.createElement('div');head.className='card-head';const label=document.createElement('span');label.textContent=labels[item.kind];const close=document.createElement('button');close.textContent='×';close.title='Excluir elemento';close.setAttribute('aria-label','Excluir '+labels[item.kind]);close.onclick=e=>{if(tool!=='select'||space){e.preventDefault();return;}remove(item.id);focusBoard();};head.append(label,close);card.append(head);
    if(['note','comment'].includes(item.kind))card.append(textEditor(item,'text',item.kind==='note'?'Descreva o ajuste…':'Deixe seu comentário…'));
    if(['image','print'].includes(item.kind))mediaContent(card,item);
    if(item.kind==='link'){card.append(textEditor(item,'text','Título do link','input'));const a=document.createElement('a');a.href=item.url;a.textContent=item.url;a.target='_blank';a.rel='noopener noreferrer';a.onclick=e=>{if(tool!=='select'||space)e.preventDefault();};card.append(a);}
    if(item.kind==='color'){const input=document.createElement('input');input.type='color';input.className='swatch';input.value=item.color;input.setAttribute('aria-label','Cor de referência');let colorBefore;input.addEventListener('focus',()=>{colorBefore=snapshot();select(item.id);});input.addEventListener('change',()=>{if(colorBefore){commit(colorBefore);colorBefore=snapshot();}});const code=document.createElement('span');code.className='color-code';code.textContent=item.color;input.oninput=()=>{item.color=input.value;code.textContent=input.value;};card.append(input,code);}
    const resize=document.createElement('button');resize.className='resize';resize.setAttribute('aria-label','Redimensionar '+labels[item.kind]);card.append(resize);styleCard(card,item);container.append(card);
  }drawPaths();$('#empty').hidden=!!(items.length||paths.length);historyButtons();view();syncTextTools();}
  document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(tool===b.dataset.tool?'select':b.dataset.tool));
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>b.dataset.add==='link'?$('#link-dialog').showModal():add(b.dataset.add));
  $('#link-form').onsubmit=e=>{e.preventDefault();try{const url=new URL($('#link-url').value);if(!['http:','https:'].includes(url.protocol))throw Error();add('link',{url:url.href});$('#link-dialog').close();$('#link-form').reset();}catch{notice('Use um endereço HTTP ou HTTPS válido.');}};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  $('#image-add').onclick=()=>$('#image-file').click();
  function insertImage(src,name='Imagem colada'){
    return new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        // Fit the image area to its native ratio; reserve space for the card fields and borders.
        const scale=Math.max(168/img.naturalWidth,50/img.naturalHeight,Math.min(360/img.naturalWidth,420/img.naturalHeight));
        const w=img.naturalWidth*scale+2,h=img.naturalHeight*scale+38+38+85+2;
        const assetId=crypto.randomUUID();assets[assetId]=src;
        add('image',{assetId,text:name,w,h});resolve(true);
      };
      img.onerror=()=>{notice('Não foi possível abrir a imagem. Tente copiar a imagem novamente ou salvar e adicionar o arquivo.');resolve(false);};
      img.src=src;
    });
  }
  async function importImage(file){
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>10*1024*1024){notice('Escolha uma imagem PNG, JPG, WebP ou GIF de até 10 MB.');return;}
    try{
      const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      await insertImage(src,file.name||'Imagem colada');
    }catch{notice('Não foi possível abrir a imagem.');}
  }
  $('#image-file').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)void importImage(file);};
  document.addEventListener('paste',async e=>{
    if(document.querySelector('dialog[open]')||!e.clipboardData)return;
    const clipboard=e.clipboardData;
    const editing=e.target.closest?.('input,textarea,select,[contenteditable]');
    if(editing&&!board.contains(e.target))return;
    const fileItems=Array.from(clipboard.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
    const files=fileItems.length?fileItems:Array.from(clipboard.files||[]).filter(file=>file.type.startsWith('image/'));
    // Keep ordinary text paste in editors, but allow image-only paste in card fields.
    if(editing&&clipboard.getData('text/plain'))return;
    if(files.length){e.preventDefault();for(const file of files)await importImage(file);return;}
    if(editing)return;
    // Some sites copy an HTML image instead of placing image bytes on the clipboard.
    const html=clipboard.getData('text/html');
    const doc=html?new DOMParser().parseFromString(html,'text/html'):null;
    const copiedImage=doc?.querySelector('img');
    const src=copiedImage?.getAttribute('src')||clipboard.getData('text/uri-list').split(/\r?\n/).find(line=>line.trim()&&!line.startsWith('#'))||clipboard.getData('text/plain').trim();
    if(!src)return;
    let url;try{url=new URL(src);}catch{return;}
    if(!['https:','http:'].includes(url.protocol)&&!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src))return;
    e.preventDefault();
    if(src.startsWith('data:')&&src.length>14*1024*1024){notice('Escolha uma imagem de até 10 MB.');return;}
    await insertImage(src);
  });
  board.addEventListener('pointerdown',e=>{
    if(drag||e.isPrimary===false||(e.button!==0&&e.button!==1))return;
    const card=e.target.closest('.card'),id=card?.dataset.id;
    if(id&&!space&&e.button===0&&['draw','pan'].includes(tool))setTool('select');
    const pan=space||tool==='pan'||e.button===1;
    if(e.target.closest('#empty button'))return;
    if(!pan&&tool==='line'){
      e.preventDefault();focusBoard();
      if(!id){connection=null;select(null);return;}
      if(!connection){connection=id;select(id);notice('Clique no segundo cartão. Esc cancela.');}
      else if(connection!==id){const before=snapshot();if(!paths.some(p=>(p.from===connection&&p.to===id)||(p.from===id&&p.to===connection)))paths.push({id:crypto.randomUUID(),from:connection,to:id,color:$('#ink').value,width:Number($('#stroke').value)});connection=null;commit(before);setTool('select');select(id);}
      return;
    }
    if(!pan&&tool==='select'&&editingTarget(e.target)&&!e.target.closest('.resize')){if(id)select(id);return;}
    const p=point(e);
    if(pan)drag={kind:'pan',x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};
    else if(tool==='draw'){
      document.activeElement?.blur();const before=snapshot();const path={id:crypto.randomUUID(),points:[p,{x:p.x+.01,y:p.y+.01}],color:$('#ink').value,width:Number($('#stroke').value)};
      paths.push(path);drag={kind:'draw',path,before};$('#empty').hidden=true;select(path.id);
    }else if(id){
      document.activeElement?.blur();select(id);const item=items.find(i=>i.id===id);
      // FIX: pré-calcula se este item participa de alguma conexão, para saber
      // se precisamos redesenhar as linhas durante o próprio movimento
      // (drawPaths() reconstrói TODOS os nós SVG do zero — caro em boards com
      // muitas conexões, e desnecessário para cartões isolados).
      const connected=paths.some(p=>p.from===id||p.to===id);
      drag={kind:e.target.closest('.resize')?'resize':'move',item,x:p.x,y:p.y,ix:item.x,iy:item.y,w:item.w,h:item.h,before:snapshot(),connected};
    }else if(e.target.dataset.path){e.preventDefault();select(e.target.dataset.path);focusBoard();return;}
    else{select(null);drag={kind:'pan',x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};}
    e.preventDefault();focusBoard();drag.pointerId=e.pointerId;board.setPointerCapture?.(e.pointerId);board.classList.add('is-dragging');
  });
  board.addEventListener('pointermove',e=>{
    if(!drag||drag.pointerId!==e.pointerId)return;
    const p=point(e),d=drag;
    if(d.kind==='pan'){camera.x=d.cx+e.clientX-d.x;camera.y=d.cy+e.clientY-d.y;view();}
    else if(d.kind==='draw'){const last=d.path.points.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)*camera.z>=2){d.path.points.push(p);drawPaths();}}
    else{if(d.kind==='move'){d.item.x=d.ix+p.x-d.x;d.item.y=d.iy+p.y-d.y;}else{d.item.w=Math.max(170,d.w+p.x-d.x);d.item.h=Math.max(['image','print'].includes(d.item.kind)?260:120,d.h+p.y-d.y);}
      const node=$('#cards').querySelector('[data-id="'+d.item.id+'"]');Object.assign(node.style,{left:d.item.x+'px',top:d.item.y+'px',width:d.item.w+'px',height:d.item.h+'px'});
      // FIX: só refaz as linhas a cada frame se o cartão arrastado tiver conexões;
      // cartões soltos deixam de custar um rebuild inteiro do SVG por pointermove.
      if(d.connected)drawPaths();
    }
  });
  board.addEventListener('pointerup',e=>{if(drag?.pointerId===e.pointerId)endDrag();});
  board.addEventListener('pointercancel',e=>{if(drag?.pointerId===e.pointerId)endDrag(true);});
  board.addEventListener('lostpointercapture',()=>endDrag(true));
  board.addEventListener('wheel',e=>{
    if(e.target.closest('textarea'))return;e.preventDefault();if(drag)return;
    const r=board.getBoundingClientRect();zoom(camera.z*Math.exp(-e.deltaY*(e.deltaMode===1?16:1)*.0015),e.clientX-r.left,e.clientY-r.top);
  },{passive:false});
  $('#undo').onclick=()=>{document.activeElement?.blur();undo();focusBoard();};$('#redo').onclick=()=>{document.activeElement?.blur();undo(true);focusBoard();};$('#zoom-in').onclick=()=>zoom(camera.z*1.2);$('#zoom-out').onclick=()=>zoom(camera.z/1.2);$('#zoom-reset').onclick=()=>{
    endDrag(true);const points=paths.flatMap(p=>p.points||[]);for(const i of items)points.push({x:i.x,y:i.y},{x:i.x+i.w,y:i.y+i.h});
    if(points.length){let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const p of points){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
      camera.z=Math.max(.05,Math.min(1,(board.clientWidth-70)/Math.max(1,right-left),(board.clientHeight-70)/Math.max(1,bottom-top)));camera.x=board.clientWidth/2-(left+right)/2*camera.z;camera.y=board.clientHeight/2-(top+bottom)/2*camera.z;
    }else camera={x:0,y:0,z:1};view();focusBoard();
  };
  document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;if(e.code==='Space'&&board.contains(document.activeElement)){e.preventDefault();space=true;}if(e.key==='Escape'){endDrag(true);connection=null;setTool('select');focusBoard();}if(!board.contains(document.activeElement))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);}if(e.key==='Delete'&&selected){e.preventDefault();remove(selected);}if(e.key.toLowerCase()==='v')setTool('select');if(e.key.toLowerCase()==='h')setTool('pan');});
  document.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});window.addEventListener('blur',()=>{space=false;endDrag(true);});
  $('#send').onclick=()=>{
    document.activeElement?.blur();endDrag(true);
    if(!items.length&&!paths.length){notice('Adicione pelo menos um pedido ao quadro.');return;}
    // FIX: como os itens agora só guardam `assetId`, o conteúdo real das imagens
    // precisa ir junto no envio — senão quem recebe o evento fica sem os bytes da imagem.
    const usedAssets={};for(const item of items)if(item.assetId&&assets[item.assetId])usedAssets[item.assetId]=assets[item.assetId];
    const detail={version:2,items:structuredClone(items),paths:structuredClone(paths),assets:usedAssets,videoTime:document.querySelector('video').currentTime};
    const event=new CustomEvent('dayline:submit-adjustments',{detail,cancelable:true});document.dispatchEvent(event);
    if(!event.defaultPrevented){$('#send-message').textContent='O envio ainda não está disponível nesta página. Seus pedidos continuam no quadro; mantenha esta página aberta.';$('#send-dialog').showModal();}
  };
  $('#timestamp').onclick=captureMoment;
  $('#delete-selected').onclick=()=>{if(selected)remove(selected);focusBoard();};
  const video=document.querySelector('video');video.addEventListener('error',()=>{$('#video-status').textContent='A prévia ainda não foi carregada.';});video.addEventListener('loadedmetadata',()=>{$('#video-status').textContent='Pause no trecho que deseja comentar.';});
  board.addEventListener('dragstart',e=>e.preventDefault());
  // API mínima para o seletor de integrantes: impede perder um rascunho sem aviso
  // e limpa somente o quadro local ao trocar de prévia. Nada é persistido no site.
  window.daylineReviewBoard={
    hasDraft:()=>items.length>0||paths.length>0,
    clear:()=>{
      endDrag(true);items=[];paths=[];assets={};selected=null;connection=null;past.length=0;future.length=0;
      camera={x:0,y:0,z:1};textField='text';setTool('select');render();historyButtons();
    }
  };
  render();
})();