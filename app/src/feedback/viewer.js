import {validateCanvas} from './contract.js';

export function mountFeedbackViewer(container, documentData) {
  const data = validateCanvas(documentData);
  const doc = container.ownerDocument;
  const node = (tag, cls, text) => {const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const toolbar = node('div','feedback-view-controls');
  const viewport = node('div','feedback-viewport'); viewport.tabIndex=0;viewport.setAttribute('aria-label','Canvas do cliente. Arraste para navegar e use a roda para zoom.');
  const world = node('div','feedback-world');viewport.append(world);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('feedback-lines');world.append(svg);
  const bounds=[];
  const labels={note:'Nota',comment:'Comentário',image:'Imagem',print:'Print do vídeo',link:'Link',color:'Cor'};
  function text(value, style = {}, tag = 'div') {
    const el=node(tag,'feedback-text',value || '');
    Object.assign(el.style,{fontFamily:style.fontFamily||'inherit',fontSize:(style.size||14)+'px',color:style.color||'#edf0e8',fontWeight:style.bold?'700':'400',fontStyle:style.italic?'italic':'normal',textDecoration:style.underline?'underline':'none',textAlign:style.align||'left'});
    return el;
  }
  for (const item of data.items) {
    bounds.push({x:item.x,y:item.y},{x:item.x+item.w,y:item.y+item.h});
    const card=node('article','feedback-card');
    Object.assign(card.style,{left:item.x+'px',top:item.y+'px',width:item.w+'px',height:item.h+'px',backgroundColor:item.background||'#253129'});
    card.append(node('div','feedback-card-label',labels[item.kind]));
    if (['image','print'].includes(item.kind)) {
      card.classList.add('feedback-media-card');
      card.append(text(item.imageTitle,item.imageTitleStyle));
      const media=node('div','feedback-media'); const img=node('img','');img.src=data.assets[item.assetId];img.alt=item.imageTitle||'Referência do cliente';media.append(img);
      if (item.kind==='print') {const seconds=Math.floor(item.videoTime);media.append(node('span','feedback-timestamp',`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`));}
      card.append(media,text(item.annotation,item.annotationStyle));
    } else if (item.kind === 'color') {
      const swatch=node('div','feedback-swatch');swatch.style.backgroundColor=item.color||'#b9d69b';card.append(swatch,text(item.color));
    } else {
      card.append(text(item.text,item.textStyle));
      if (item.kind==='link') {const link=text(item.url,{},'a');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
    }
    world.append(card);
  }
  const byId=new Map(data.items.map(i=>[i.id,i]));
  for (const path of data.paths) {
    let points=path.points;
    if (path.from) {
      const a=byId.get(path.from),b=byId.get(path.to),ac={x:a.x+a.w/2,y:a.y+a.h/2},bc={x:b.x+b.w/2,y:b.y+b.h/2},dx=bc.x-ac.x,dy=bc.y-ac.y;
      const edge=(c,i,sign)=>{const t=1/Math.max(Math.abs(dx)/(i.w/2),Math.abs(dy)/(i.h/2),1e-8);return{x:c.x+sign*dx*t,y:c.y+sign*dy*t};};
      points=[edge(ac,a,1),edge(bc,b,-1)];
    }
    for(const point of points)bounds.push(point);
    const el=doc.createElementNS(svg.namespaceURI,'path');el.setAttribute('d',points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '));el.setAttribute('stroke',path.color);el.setAttribute('stroke-width',path.width);svg.append(el);
  }
  let camera={x:0,y:0,z:1},drag;
  const controller=new doc.defaultView.AbortController(),options={signal:controller.signal};
  const apply=()=>{world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;};
  function fit() {
    let minX=0,minY=0,maxX=0,maxY=0;
    if(bounds.length){minX=minY=Infinity;maxX=maxY=-Infinity;for(const p of bounds){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}}
    camera.z=Math.min(1,Math.max(.001,Math.min((viewport.clientWidth-60)/Math.max(1,maxX-minX),(viewport.clientHeight-60)/Math.max(1,maxY-minY))));
    camera.x=viewport.clientWidth/2-(minX+maxX)*camera.z/2;camera.y=viewport.clientHeight/2-(minY+maxY)*camera.z/2;apply();
  }
  function zoom(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2){const z=Math.min(4,Math.max(.001,camera.z*factor)),ratio=z/camera.z;camera.x=x-(x-camera.x)*ratio;camera.y=y-(y-camera.y)*ratio;camera.z=z;apply();}
  for(const [label,action] of [['−',()=>zoom(1/1.3)],['Enquadrar',fit],['+',()=>zoom(1.3)]]){const button=node('button','',label);button.type='button';button.setAttribute('aria-label',label==='−'?'Diminuir zoom':label==='+'?'Aumentar zoom':'Enquadrar canvas');button.addEventListener('click',action,options);toolbar.append(button);}
  toolbar.append(node('span','','Arraste o fundo para navegar · Role para zoom'));
  viewport.addEventListener('wheel',event=>{event.preventDefault();const rect=viewport.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.001),event.clientX-rect.left,event.clientY-rect.top);},{...options,passive:false});
  viewport.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('a'))return;drag={x:event.clientX,y:event.clientY,cx:camera.x,cy:camera.y,id:event.pointerId};viewport.setPointerCapture(event.pointerId);},options);
  viewport.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;camera.x=drag.cx+event.clientX-drag.x;camera.y=drag.cy+event.clientY-drag.y;apply();},options);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(name,()=>{drag=null;},options);
  container.replaceChildren(toolbar,viewport);
  fit();
  return {destroy(){controller.abort();container.replaceChildren();}};
}
