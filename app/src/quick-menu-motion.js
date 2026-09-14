// Entrance and hover use separate elements, so their transforms never compete.
export function createQuickMenuMotion(menu, on) {
  const win = menu.ownerDocument.defaultView;
  const slots = [...menu.querySelectorAll('.wb-quick-slot')];
  const running = new Set(), hover = new Map();
  let active = false, settings;
  function animate(element, frames, options) {
    if (typeof element.animate !== 'function') return null;
    const animation = element.animate(frames, options);
    running.add(animation);
    animation.finished.then(() => running.delete(animation), () => running.delete(animation));
    return animation;
  }
  function move(button, x, y) {
    const from = win.getComputedStyle(button).transform;
    hover.get(button)?.cancel();
    // Horizontal mouse movement tilts around Y; vertical movement around X.
    const target = `perspective(${settings.perspective}px) translate(${x * settings.strength}px, ${y * settings.strength}px) rotateX(${-y * settings.tilt}deg) rotateY(${x * settings.tilt}deg)`;
    button.style.transform = target;
    const animation = animate(button, [{transform:from === 'none' ? 'translate(0px, 0px)' : from}, {transform:target}], {duration:settings.follow, easing:'cubic-bezier(.2,.8,.2,1)'});
    if (animation) hover.set(button, animation);
  }
  for (const slot of slots) {
    const button = slot.querySelector('button');
    on(slot, 'pointermove', event => {
      if (!active || event.pointerType === 'touch' || !settings.enabled) return;
      // The slot stays fixed: moving the button never moves its hover reference.
      const rect = slot.getBoundingClientRect();
      const unit = (position, start, size) => Math.max(-1, Math.min(1, (position-start)/Math.max(1,size)*2-1));
      move(button, unit(event.clientX,rect.left,rect.width), unit(event.clientY,rect.top,rect.height));
    });
    on(slot, 'pointerleave', () => {if (active && settings.enabled) move(button,0,0);});
  }
  function close() {
    active = false;
    for (const animation of running) animation.cancel();
    running.clear(); hover.clear();
    for (const slot of slots) slot.querySelector('button').style.transform = '';
  }
  function open(event) {
    close();
    const css = win.getComputedStyle(menu);
    const value = (name, fallback) => {const raw=css.getPropertyValue(name).trim(), n=parseFloat(raw);return Number.isFinite(n) ? Math.max(0,n*(raw.endsWith('s')&&!raw.endsWith('ms')?1000:1)) : fallback;};
    settings = {enabled:value('--quick-motion-enabled',1)>0, duration:value('--quick-enter-duration',480), stagger:value('--quick-enter-stagger',55), scale:Math.min(1,value('--quick-start-scale',.18)), strength:value('--quick-parallax-strength',8), follow:value('--quick-parallax-follow',160)};
    settings.tilt = Math.min(35, value('--quick-tilt-angle', 16));
    settings.perspective = Math.max(100, value('--quick-perspective', 450));
    active = true;
    if (!settings.enabled) return;
    slots.forEach((slot,index) => {
      const rect = slot.getBoundingClientRect();
      const x = event.clientX-rect.left-rect.width/2, y = event.clientY-rect.top-rect.height/2;
      // Explicit restart on every opening, including two opens in the same frame.
      animate(slot, [{opacity:0,transform:`translate(${x}px, ${y}px) scale(${settings.scale})`},{opacity:1,transform:'translate(0px, 0px) scale(1)'}], {duration:settings.duration, delay:index*settings.stagger, easing:'cubic-bezier(.22,.8,.25,1)', fill:'backwards'});
    });
  }
  return {open, close};
}
