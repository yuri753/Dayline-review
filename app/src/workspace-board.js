import {createQuickMenuMotion} from "./quick-menu-motion.js";
// Controlador do quadro: estado, renderização, gestos, comandos, histórico e salvamento.
import {renderWorkspaceUI, tools} from "./workspace-board-ui.js";
import {CARD_FONTS, resizeCard} from "./workspace-model.js";
import {getInstalledFonts} from "./installed-fonts.js";
import {updateLinkPreview, stopLinkMedia} from "./link-preview.js";
import {mediaURL, videoThumbnail} from './board-storage.js';
import {isTauri, invoke} from "@tauri-apps/api/core";
import {emptyBoard, validateBoard, createItem, clamp, LIMIT, MIN_ZOOM, MAX_ZOOM, MAX_ITEMS, safeURL, isColor, boundsOf, linePoints, SpatialIndex, zoomAt} from "./workspace-model.js";

export const boardKey = selection => `dayline.workspace.board.v1:${selection.type}:${selection.id}`;
const editable = target => target?.closest("input, textarea, select, [contenteditable]");
const svgNS = "http://www.w3.org/2000/svg";
const svgElement = name => document.createElementNS(svgNS, name);

export function mountWorkspaceBoard(root, selection, {storage = null} = {}) {
  const key = boardKey(selection), abort = new AbortController();
  const on = (target, type, fn, options = {}) => target.addEventListener(type, fn, {...options, signal: abort.signal});
  let board = emptyBoard(), snapshot = null, locked = false, disposed = false, dirty = false;
  let readError = "";
  try {
    snapshot = storage ? JSON.stringify(storage.initialBoard) : localStorage.getItem(key);
    if (snapshot) board = validateBoard(JSON.parse(snapshot));
    else {
      // Preserve the camera and background from the previous, empty canvas.
      const legacyKey = `dayline.workspace.camera.v1:${selection.type}:${selection.id}`;
      const legacy = JSON.parse(localStorage.getItem(legacyKey) || "null");
      if (legacy && Number.isFinite(legacy.x) && Number.isFinite(legacy.y) && Number.isFinite(legacy.zoom)) board.camera = {...legacy, zoom: clamp(legacy.zoom, MIN_ZOOM, MAX_ZOOM)};
      const color = localStorage.getItem(`${legacyKey}:color`);
      if (isColor(color)) board.background = color;
    }
  } catch { locked = true; readError = "Não foi possível ler o quadro. Os dados foram preservados. Baixe uma cópia para recuperação."; }
  const {quickMenu, optionsMenu, fontPopup} = renderWorkspaceUI(root);
  const fontSearch = optionsMenu.querySelector('.wb-font-search'), fontList = fontPopup.querySelector('[role=listbox]');
  let localFamilies = [], fontLoading = false, fontError = '', fontActive = -1, fontQuery = '';
  let menuAnimations = [], pendingImageFocus = null;
  const $ = selector => root.querySelector(selector);
  const viewport = $(".workspace-board"), world = $(".wb-world"), cards = $(".wb-cards"), lines = $(".wb-lines");
  const status = $(".wb-save"), notice = $(".wb-notice"), hint = $(".wb-hint"), marquee = $(".wb-marquee");
  const imageTextTools = document.createElement('div'); imageTextTools.className = 'wb-image-text-tools'; imageTextTools.hidden = true;
  imageTextTools.setAttribute('role', 'group'); imageTextTools.setAttribute('aria-label', 'Formatação do texto');
  imageTextTools.innerHTML = `<span class="wb-text-context"></span><label class="wb-text-size"><span>T</span><input type="number" min="8" max="72" step="1" data-image-style="size" aria-label="Tamanho do texto em pixels"><span>px</span></label>
    ${[['left', 'esquerda', 'M3 4h14M3 9h9M3 14h14'], ['center', 'centro', 'M3 4h14M6 9h8M3 14h14'], ['right', 'direita', 'M3 4h14M8 9h9M3 14h14']].map(([align,label,path]) => `<button type="button" data-image-align="${align}" aria-label="Alinhar texto à ${label}" title="Alinhar: ${label}" aria-pressed="false"><svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="${path}"/></svg></button>`).join('')}
    <button type="button" data-text-bold title="Negrito" aria-label="Negrito neste texto" aria-pressed="false"><b>B</b></button><label class="wb-text-color" title="Cor deste texto"><span>A</span><input type="color" data-image-style="color" aria-label="Cor deste texto"></label>`;
  $('.wb-selection').append(imageTextTools);
  const imageFontSearch = document.createElement('input');
  imageFontSearch.type = 'text'; imageFontSearch.className = 'wb-image-font-search'; imageFontSearch.placeholder = 'Fonte…'; imageFontSearch.autocomplete = 'off';
  imageFontSearch.setAttribute('aria-label', 'Buscar fonte deste texto'); imageFontSearch.setAttribute('role', 'combobox'); imageFontSearch.setAttribute('aria-autocomplete', 'list'); imageFontSearch.setAttribute('aria-expanded', 'false'); imageFontSearch.setAttribute('aria-controls', 'wb-font-list');
  imageTextTools.insertBefore(imageFontSearch, imageTextTools.querySelector('.wb-text-size'));
  let fontInput = fontSearch, fontTarget = null;
  let activeImageText = null;
  const strokeTools = document.createElement('label'); strokeTools.className = 'wb-stroke-tools'; strokeTools.hidden = true;
  strokeTools.innerHTML = '<span>Espessura</span><input type="range" min="0.5" max="32" step="0.5" data-stroke-width aria-label="Ajustar espessura da linha"><input type="number" min="0.5" max="32" step="0.5" data-stroke-width aria-label="Espessura da linha em pixels"><span>px</span>';
  $('.wb-selection').append(strokeTools);
  function textContext(target) {
    const node = target.closest?.('.wb-card');
    if (!node || !target.matches('textarea, input[type=text], input:not([type])')) return null;
    const row = target.closest('[data-task]');
    if (row) return {id: node.dataset.workspaceObject, field: 'task', taskIndex: Number(row.dataset.task)};
    return ['text', 'url', 'annotation', 'imageTitle'].includes(target.dataset.field) ? {id: node.dataset.workspaceObject, field: target.dataset.field} : null;
  }
  const textStyle = (item, target) => target?.taskIndex !== undefined ? item?.tasks?.[target.taskIndex]?.style || {} : item?.[`${target?.field}Style`] || {};
  function styledText(item, target, patch) {
    if (target.taskIndex !== undefined) return {...item, tasks: item.tasks.map((task, i) => i === target.taskIndex ? {...task, style: {...task.style, ...patch}} : task)};
    const key = `${target.field}Style`; return {...item, [key]: {...item[key], ...patch}};
  }
  const defaultTextSize = target => target.field === 'annotation' ? 12 : target.field === 'imageTitle' ? 14 : 13;
  function applyTextStyle(input, item, target) {
    const style = textStyle(item, target);
    if (item.kind !== 'image') {
      if (style.size !== undefined) input.style.fontSize = `${style.size}px`; else input.style.removeProperty('font-size');
    }
    input.style.textAlign = style.align || 'left'; input.style.color = style.color || item.textColor || 'inherit';
    if (style.fontFamily !== undefined) input.style.fontFamily = style.fontFamily ? JSON.stringify(style.fontFamily) : 'var(--font-family, system-ui)'; else input.style.removeProperty('font-family');
    if (style.bold !== undefined) input.style.setProperty('font-weight', style.bold ? '700' : '400', 'important'); else input.style.removeProperty('font-weight');
  }
  let map = new Map(), index = new SpatialIndex(), nodes = new Map(), selected = new Set(), order = new Map();
  let history = [], future = [], editStart = null, mode = "select", lineStart = null, gesture = null, space = false;
  let frame = 0, saveTimer = 0, noticeTimer = 0, width = 1, height = 1, bounds = null, suspended = false;
  let camera = {...board.camera}, imports = 0;
  let quickPoint = null, imagePoint = null;
  const quickMotion = createQuickMenuMotion(quickMenu, on);
  let saveVersion = 0, saving = null;
  let optionsId = null, optionsTrigger = null;
  function closeOptions(restoreFocus = false) {
    if (optionsMenu.hidden) return;
    for (const animation of menuAnimations) animation.cancel(); menuAnimations = [];
    hideFonts();
    finishEdit(); optionsMenu.hidden = true; optionsId = null;
    optionsTrigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) (optionsTrigger?.isConnected ? optionsTrigger : viewport).focus({preventScroll: true});
    optionsTrigger = null;
  }
  function syncOptions() {
    const item = map.get(optionsId);
    if (!item) {closeOptions(); return;}
    if (document.activeElement !== fontSearch && fontPopup.hidden) fontSearch.value = item.fontFamily || (item.font && item.font !== 'default' ? CARD_FONTS[item.font] : '');
    optionsMenu.querySelector('[data-format=textColor]').value = item.textColor || (getComputedStyle(optionsTrigger.closest('.wb-card').querySelector('.wb-card-body')).color.match(/\d+/g)?.slice(0, 3).map(n => Number(n).toString(16).padStart(2, "0")).join("")?.replace(/^/, "#")) || "#303b31";
    optionsMenu.querySelector('[data-format=background]').value = item.background || item.color;
    optionsMenu.querySelector('[data-format-bold]').setAttribute("aria-pressed", String(Boolean(item.bold)));
  }
  function openOptions(trigger) {
    const id = trigger.closest('[data-workspace-object]').dataset.workspaceObject;
    if (locked) return;
    if (optionsId === id) {closeOptions(true); return;}
    closeQuickMenu(); closeOptions(); finishEdit(); select([id]);
    optionsId = id; optionsTrigger = trigger; trigger.setAttribute("aria-expanded", "true"); optionsMenu.hidden = false;
    const item = map.get(id);
    for (const button of optionsMenu.querySelectorAll('[data-image-edit]')) button.hidden = item.kind !== 'image';
    const rows = [...optionsMenu.children].filter(row => !row.hidden);
    rows.forEach((row, i) => {const label = row.querySelector('[data-option-label]'); label.textContent = `${i + 1} · ${label.dataset.optionLabel}`;});
    const r = root.getBoundingClientRect(), t = trigger.getBoundingClientRect(), m = optionsMenu.getBoundingClientRect();
    const left = clamp(t.right - r.left + 10, 8, Math.max(8, r.width - m.width - 8));
    const top = clamp(t.top - r.top, 8, Math.max(8, r.height - m.height - 8));
    optionsMenu.style.left = `${left}px`; optionsMenu.style.top = `${top}px`;
    syncOptions(); optionsMenu.focus({preventScroll: true});
    // Start only after measuring the final layout. CSS global animation rules
    // cannot suppress or leave this explicit, replayable opening paused.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    rows.forEach((row, i) => {
      const x = t.left + t.width / 2 - r.left - left - m.width / 2;
      const y = t.top + t.height / 2 - r.top - top - row.offsetTop - row.offsetHeight / 2;
      if (typeof row.animate === 'function') menuAnimations.push(row.animate(
        reduced ? [{opacity: 0}, {opacity: 1}] : [{opacity: 0, transform: `translate(${x}px, ${y}px) scale(.08)`}, {opacity: 1, transform: 'translate(0, 0) scale(1)'}],
        {duration: reduced ? 180 : 2400, delay: reduced ? 0 : i * 600 / Math.max(1, rows.length - 1), easing: 'cubic-bezier(.25,.5,.25,1)', fill: 'backwards'}
      ));
    });
  }
  function hideFonts() {fontPopup.hidden = true; fontInput.setAttribute('aria-expanded', 'false'); fontInput.removeAttribute('aria-activedescendant'); fontActive = -1; fontTarget = null;}
  function renderFonts() {
    const query = fontQuery.trim().toLocaleLowerCase('pt-BR');
    const matches = localFamilies.filter(name => name.toLocaleLowerCase('pt-BR').includes(query));
    fontList.replaceChildren(); fontActive = -1; fontInput.removeAttribute('aria-activedescendant');
    const item = map.get(fontTarget?.id), style = fontTarget?.field ? textStyle(item, fontTarget) : item;
    for (const [i, family] of ['', ...matches.slice(0, 60)].entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.role = 'option'; button.tabIndex = -1;
      button.id = `wb-font-choice-${i}`; button.dataset.fontFamily = family;
      button.textContent = family || 'Padrão do app'; if (family) button.style.fontFamily = JSON.stringify(family);
      button.setAttribute('aria-selected', String((style?.fontFamily ?? item?.fontFamily ?? '') === family)); fontList.append(button);
    }
    fontPopup.querySelector('.wb-font-status').textContent = fontLoading ? 'Buscando fontes instaladas…' : fontError || (matches.length > 60 ? `${matches.length} fontes encontradas. Digite mais letras para filtrar.` : matches.length ? `${matches.length} fontes instaladas` : 'Nenhuma fonte encontrada.');
  }
  async function showFonts(input = fontSearch) {
    const target = input === imageFontSearch ? activeImageText && {...activeImageText} : optionsId && {id: optionsId};
    if (!target) return;
    hideFonts(); fontInput = input; fontTarget = target;
    fontQuery = ''; fontInput.value = ''; fontPopup.hidden = false; fontInput.setAttribute('aria-expanded', 'true');
    const r = root.getBoundingClientRect(), f = fontInput.getBoundingClientRect();
    const popupHeight = Math.min(220, Math.max(100, r.height - 16));
    fontPopup.style.maxHeight = `${popupHeight}px`;
    fontPopup.style.left = `${clamp(f.left - r.left, 8, Math.max(8, r.width - 260))}px`;
    fontPopup.style.top = `${clamp(f.bottom - r.top + popupHeight <= r.height - 8 ? f.bottom - r.top + 5 : f.top - r.top - popupHeight - 5, 8, Math.max(8, r.height - popupHeight - 8))}px`;
    fontLoading = true; fontError = ''; renderFonts();
    try {localFamilies = await getInstalledFonts();}
    catch {fontError = isTauri() ? 'Não foi possível ler as fontes do Windows. Clique no campo para tentar novamente.' : 'Permita o acesso às fontes locais no navegador e clique no campo para tentar novamente.';}
    finally {fontLoading = false; if (!disposed && !fontPopup.hidden) renderFonts();}
  }
  function closeQuickMenu(restoreFocus = false) {
    if (quickMenu.hidden) return;
    quickMenu.hidden = true; quickPoint = null; quickMotion.close();
    if (restoreFocus) viewport.focus({preventScroll: true});
  }
  function openQuickMenu(event) {
    closeOptions();
    closeQuickMenu(); quickPoint = point(event);
    quickMenu.hidden = false;
    const rect = root.getBoundingClientRect(), size = quickMenu.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const left = x + 18 + size.width <= rect.width - 8 ? x + 18 : x - size.width - 18;
    quickMenu.style.left = `${clamp(left, 8, Math.max(8, rect.width - size.width - 8))}px`;
    quickMenu.style.top = `${clamp(y - size.height / 2, 8, Math.max(8, rect.height - size.height - 8))}px`;
    quickMotion.open(event);
    quickMenu.querySelector("button").focus({preventScroll: true});
  }
  function quickAdd(kind) {
    const at = quickPoint;
    if (!at || locked) return;
    closeQuickMenu(true);
    if (kind === "image") {imagePoint = at; void chooseMedia();}
    else add(kind, at);
  }
  function notify(message, persistent = false) {
    clearTimeout(noticeTimer); notice.textContent = message; notice.hidden = false;
    if (!persistent) noticeTimer = setTimeout(() => {notice.hidden = true;}, 5000);
  }
  function reindex() {
    map = new Map(board.items.map(item => [item.id, item])); index = new SpatialIndex();
    order = new Map(board.items.map((item, i) => [item.id, i + 1]));
    for (const item of board.items) index.set(item.id, boundsOf(item, map));
    selected = new Set([...selected].filter(id => map.has(id)));
  }
  function saveStatus(message, error = false) {status.textContent = error ? message : ''; status.hidden = !error; status.classList.toggle("is-error", error); $("[data-command=retry]").hidden = !error || locked;}
  function scheduleSave() {
    dirty = true; saveVersion++; saveStatus("Alterações pendentes…");
    clearTimeout(saveTimer); saveTimer = setTimeout(() => flush(false), 800);
  }
  function flush(drain = true) {
    clearTimeout(saveTimer);
    if (imports) {notify("Aguarde a importação das imagens terminar."); return false;}
    if (storage) return flushNative(drain);
    if (!dirty || locked) return true;
    try {
      if (localStorage.getItem(key) !== snapshot) throw new Error("Outra janela alterou este quadro. Baixe uma cópia das suas alterações antes de sair.");
      const next = JSON.stringify({...board, camera});
      localStorage.setItem(key, next); snapshot = next; dirty = false;
      saveStatus("Salvo neste dispositivo"); return true;
    } catch (error) {
      saveStatus("Não foi possível salvar", true);
      notify(error.message.includes("Outra janela") ? error.message : "O armazenamento está indisponível ou cheio. Tente novamente ou baixe uma cópia antes de sair.", true);
      return false;
    }
  }
  async function flushNative(drain = true) {
    if (saving) {if (!await saving) return false; return dirty && drain ? flushNative(drain) : true;}
    if (!dirty || locked) return true;
    const version = saveVersion, value = {...board, camera: {...camera}};
    saving = (async () => {
      try {await storage.save(value); if (version === saveVersion) dirty = false; saveStatus(''); return true;}
      catch (error) {saveStatus('Não foi possível salvar', true); notify(`O quadro continua aberto para você tentar novamente. ${error.message || error}`, true); return false;}
    })();
    const success = await saving; saving = null;
    if (success && dirty && drain) return flushNative(drain);
    return success;
  }
  function remember(previous) {history.push(previous); if (history.length > 60) history.shift(); future = [];}
  function finishEdit() {if (editStart && editStart !== board) remember(editStart); editStart = null;}
  function commit(items, background = board.background) {
    if (locked) return;
    finishEdit(); remember(board); board = {...board, items, background}; reindex(); scheduleSave(); requestDraw();
  }
  function replaceItems(replacements, record = true) {
    const items = board.items.map(item => replacements.get(item.id) || item);
    if (record) commit(items);
    else {
      board = {...board, items};
      for (const [id, item] of replacements) {map.set(id, item); index.set(id, boundsOf(item, map));}
      for (const item of board.items) if (item.kind === "line" && (replacements.has(item.from) || replacements.has(item.to))) index.set(item.id, boundsOf(item, map));
      scheduleSave(); requestDraw();
    }
  }
  function requestDraw() {if (!frame && !disposed && !suspended) frame = requestAnimationFrame(render);}
  function measure() {hideFonts(); closeOptions(); closeQuickMenu(); bounds = viewport.getBoundingClientRect(); width = bounds.width || root.clientWidth || 1000; height = bounds.height || root.clientHeight || 600; requestDraw();}
  function point(event) {
    bounds = viewport.getBoundingClientRect();
    return {x: clamp((event.clientX - bounds.left - width / 2 - camera.x) / camera.zoom, -LIMIT, LIMIT), y: clamp((event.clientY - bounds.top - height / 2 - camera.y) / camera.zoom, -LIMIT, LIMIT)};
  }
  function center() {return {x: -camera.x / camera.zoom - 125, y: -camera.y / camera.zoom - 100};}
  function setMode(next) {
    closeOptions();
    closeQuickMenu();
    mode = next; lineStart = null; viewport.dataset.mode = mode;
    $("[data-mode=select]").setAttribute("aria-pressed", String(mode === "select"));
    for (const name of ["line", "draw"]) $(`[data-tool=${name}]`).setAttribute("aria-pressed", String(mode === name));
    hint.textContent = mode === "line" ? "Clique em dois cartões para conectar · Ou arraste uma linha no fundo · Esc: cancelar" : mode === "draw" ? "Arraste para desenhar · Espaço: navegar · Esc: sair" : "Arraste o fundo · Roda: zoom · Shift + arrastar: selecionar";
    requestDraw();
  }
  function select(ids) {selected = new Set(ids); requestDraw();}
  function add(kind, at = center(), extra = {}) {
    if (locked) return;
    if (board.items.length >= MAX_ITEMS) {notify(`Este quadro atingiu o limite de ${MAX_ITEMS} itens.`); return;}
    const item = createItem(kind, at, extra); commit([...board.items, item]); select([item.id]); setMode("select");
    return item;
  }
  function cardElement(item) {
    const node = document.createElement("article");
    node.className = `wb-card wb-${item.kind}`; node.dataset.workspaceObject = item.id; node.tabIndex = 0;
    const label = item.kind === 'video' ? 'Vídeo' : tools.find(([kind]) => kind === item.kind)?.[1] || item.kind;
    node.setAttribute("aria-label", label);
    node.innerHTML = `<div class="wb-card-handle" title="Arraste para mover"><span>${label}</span><button type="button" class="wb-grip" title="Opções do cartão" aria-label="Opções de ${label}" aria-haspopup="dialog" aria-expanded="false" aria-controls="wb-card-options">⠿</button></div><div class="wb-card-body"></div>${["se", "e", "s", "w", "n", "ne", "sw", "nw"].map(direction => `<button type="button" tabindex="-1" class="wb-resize" data-resize="${direction}" aria-label="Redimensionar ${label}: ${direction}" title="Arraste para redimensionar"></button>`).join("")}`;
    const body = node.querySelector(".wb-card-body");
    const field = (tag, name, placeholder, max = 20000) => {const el = document.createElement(tag); el.dataset.field = name; el.placeholder = placeholder; el.maxLength = max; el.setAttribute("aria-label", placeholder); body.append(el); return el;};
    if (item.kind === "image") {
      const header = node.querySelector('.wb-card-handle'), title = document.createElement('input');
      title.type = 'text'; title.dataset.field = 'imageTitle'; title.className = 'wb-image-title'; title.maxLength = 200; title.placeholder = 'Título da imagem…'; title.setAttribute('aria-label', 'Título da imagem'); title.hidden = true; header.insertBefore(title, header.querySelector('.wb-grip'));
      const img = document.createElement("img"); img.className = "wb-image-content"; img.draggable = false; img.decoding = "async"; body.append(img);
      field("textarea", "annotation", "Escreva sua anotação…").hidden = true;
    }
    else if (item.kind === 'video') {
      field('input', 'text', 'Título do vídeo');
      const preview = document.createElement('div'); preview.className = 'wb-link-preview'; body.append(preview);
    }
    else if (item.kind === "link") {
      field("input", "text", "Título do link"); field("input", "url", "https://…", 4000);
      const preview = document.createElement('div'); preview.className = 'wb-link-preview'; body.append(preview);
      const anchor = document.createElement("a"); anchor.className = "wb-open-link"; anchor.textContent = "Abrir link ↗"; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; body.append(anchor);
    } else if (item.kind === "tasks") {field("input", "text", "Título da lista"); const list = document.createElement("div"); list.className = "wb-task-list"; body.append(list); const button = document.createElement("button"); button.type = "button"; button.dataset.taskAdd = ""; button.className = "wb-task-add"; button.textContent = "+ Adicionar tarefa"; body.append(button);}
    else if (item.kind === "color") {const input = document.createElement("input"); input.type = "color"; input.dataset.field = "color"; input.className = "wb-swatch"; input.setAttribute("aria-label", "Escolher cor da amostra"); body.append(input); field("input", "text", "Nome da cor"); const code = document.createElement("span"); code.className = "wb-color-code"; body.append(code);}
    else field("textarea", "text", item.kind === "comment" ? "Escreva um comentário…" : "Escreva sua ideia…");
    return node;
  }
  function updateCard(node, item) {
    node.style.transform = `translate(${item.x}px, ${item.y}px)`; node.style.width = `${item.w}px`; node.style.height = `${item.h}px`;
    node.style.setProperty('--card-height', `${item.h}px`);
    node.style.setProperty("--card-color", item.color);
    node.style.setProperty("--card-background", item.kind === "color" ? item.background || "var(--surface)" : item.color);
    const family = item.fontFamily || (item.font && item.font !== 'default' ? CARD_FONTS[item.font] : '');
    node.style.setProperty("--card-font", family ? JSON.stringify(family) : "inherit");
    node.style.setProperty("--card-text", item.textColor || "inherit");
    node.style.setProperty("--card-weight", item.bold ? "700" : "400");
    node.classList.toggle("wb-custom-weight", item.bold !== undefined);
    node.querySelector('.wb-grip').disabled = locked;
    // User colors can be dark; use a contrasting foreground for readable notes.
    const rgb = item.color.slice(1).match(/../g).map(v => parseInt(v, 16));
    node.classList.toggle("wb-dark-card", rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 135);
    for (const field of node.querySelectorAll("[data-field]")) {const value = item[field.dataset.field] || ""; if (field.value !== value) field.value = value; field.disabled = locked;}
    if (item.kind === "image") {
      const img = node.querySelector("img"); const src = item.mediaPath ? mediaURL(item.mediaPath) : item.src; if (img.getAttribute("src") !== src) img.src = src; img.alt = item.imageTitle || item.annotation || "Imagem de referência";
      img.title = item.mediaPath || ''; img.onerror = () => {img.alt = 'Arquivo não encontrado. Verifique se a imagem continua no local original.';};
      node.querySelector('[data-field=annotation]').hidden = !item.hasAnnotation;
      node.querySelector('[data-field=imageTitle]').hidden = !item.hasImageTitle;
      node.querySelector('.wb-card-handle > span').hidden = Boolean(item.hasImageTitle);
      node.classList.toggle('wb-has-image-title', Boolean(item.hasImageTitle));
      for (const field of ['annotation', 'imageTitle']) {
        const input = node.querySelector(`[data-field=${field}]`), style = item[`${field}Style`] || {};
        const size = style.size || (field === 'annotation' ? 12 : 14);
        input.style.fontSize = `min(${size}px, ${field === 'annotation' ? 'calc(var(--card-height) * .12)' : 'min(36px, calc(var(--card-height) * .14))'})`;
        input.style.textAlign = style.align || 'left';
        input.style.color = style.color || item.textColor || 'inherit';
        if (style.fontFamily !== undefined) input.style.fontFamily = style.fontFamily ? JSON.stringify(style.fontFamily) : 'var(--font-family, system-ui)';
        else input.style.removeProperty('font-family');
      }
    }
    if (item.kind === "link") {const link = node.querySelector("a"); const url = safeURL(item.url); if (url) link.href = url; else link.removeAttribute("href"); link.setAttribute("aria-disabled", String(!url)); updateLinkPreview(node.querySelector('.wb-link-preview'), item.url);}
    if (item.kind === 'video') updateLinkPreview(node.querySelector('.wb-link-preview'), '', {src: mediaURL(item.mediaPath), thumbnail: item.thumbnail, kind: 'video', host: item.mediaPath.split(/[\\/]/).pop()});
    if (item.kind === "color") node.querySelector(".wb-color-code").textContent = item.color.toUpperCase();
    if (item.kind === "tasks") {
      const list = node.querySelector(".wb-task-list");
      while (list.children.length > item.tasks.length) list.lastElementChild.remove();
      item.tasks.forEach((task, i) => {
        let row = list.children[i];
        if (!row) {row = document.createElement("div"); row.className = "wb-task"; row.innerHTML = `<input type="checkbox" aria-label="Concluir tarefa"><input type="text" maxlength="1000" placeholder="Nova tarefa…" aria-label="Texto da tarefa"><button type="button" title="Remover tarefa" aria-label="Remover tarefa">×</button>`; list.append(row);}
        row.dataset.task = i; row.classList.toggle("is-done", task.done); row.children[0].checked = task.done;
        if (row.children[1].value !== task.text) row.children[1].value = task.text;
        for (const field of row.children) field.disabled = locked;
      });
    }
    for (const input of node.querySelectorAll('textarea, input[type=text], input:not([type])')) {
      const target = textContext(input); if (target) applyTextStyle(input, item, target);
    }
  }
  function pathData(item) {
    if (item.kind === "line") {const [a, b] = linePoints(item, map); return `M${a.x},${a.y} L${b.x},${b.y}`;}
    return item.points.map((p, i) => `${i ? "L" : "M"}${item.x + p[0] * item.w / (item.baseW || item.w)},${item.y + p[1] * item.h / (item.baseH || item.h)}`).join(" ");
  }
  function render() {
    frame = 0;
    world.style.transform = `translate(${width / 2 + camera.x}px, ${height / 2 + camera.y}px) scale(${camera.zoom})`;
    viewport.style.backgroundColor = board.background;
    const grid = 24 * camera.zoom * (camera.zoom < .4 ? 4 : camera.zoom < .8 ? 2 : 1);
    viewport.style.backgroundSize = `${grid}px ${grid}px`;
    viewport.style.backgroundPosition = `${width / 2 + camera.x}px ${height / 2 + camera.y}px`;
    const margin = 250 / camera.zoom;
    const view = {x: (-width / 2 - camera.x) / camera.zoom - margin, y: (-height / 2 - camera.y) / camera.zoom - margin, w: width / camera.zoom + margin * 2, h: height / camera.zoom + margin * 2};
    const visible = new Set(index.query(view));
    const focused = document.activeElement?.closest("[data-workspace-object]")?.dataset.workspaceObject;
    if (focused && map.has(focused)) visible.add(focused);
    for (const [id, entry] of nodes) if (!visible.has(id)) {stopLinkMedia(entry.node); entry.node.remove(); nodes.delete(id);}
    for (const id of visible) {
      const item = map.get(id), isPath = ["line", "draw"].includes(item.kind);
      let entry = nodes.get(id);
      if (!entry) {
        const node = isPath ? svgElement("g") : cardElement(item);
        if (isPath) {node.dataset.workspaceObject = id; node.classList.add("wb-path"); node.setAttribute("aria-label", item.kind === "line" ? "Conexão" : "Desenho"); const hit = svgElement("path"), ink = svgElement("path"); hit.classList.add("wb-path-hit"); ink.classList.add("wb-path-ink"); node.append(hit, ink); lines.append(node);}
        else cards.append(node);
        entry = {node, value: null}; nodes.set(id, entry);
      }
      const node = entry.node;
      if (isPath) {
        const from = map.get(item.from), to = map.get(item.to);
        if (entry.value !== item || entry.from !== from || entry.to !== to) {
          const d = pathData(item);
          for (const path of node.children) path.setAttribute("d", d);
          node.style.setProperty("--ink", item.color); entry.from = from; entry.to = to;
          node.style.setProperty('--stroke-width', item.strokeWidth ?? 2.5);
        }
        node.querySelector('.wb-path-hit').style.strokeWidth = `${Math.max(18, ((item.strokeWidth || 2.5) + 8) * camera.zoom)}px`;
      } else if (entry.value !== item) updateCard(node, item);
      if (!isPath) node.style.zIndex = order.get(id);
      node.classList.toggle("is-selected", selected.has(id)); node.classList.toggle("is-connecting", lineStart?.id === id);
      entry.value = item;
    }
    $(".wb-empty").hidden = Boolean(board.items.length) || locked;
    $(".workspace-zoom-label").textContent = `${Math.round(camera.zoom * 100)}%`;
    $(".workspace-color").value = board.background;
    $(".wb-selection").hidden = !selected.size || locked;
    $(".wb-selection-count").textContent = `${selected.size} ${selected.size === 1 ? "item" : "itens"}`;
    const textItem = map.get(activeImageText?.id);
    if (!textItem || !selected.has(textItem.id) || (activeImageText?.field === 'annotation' && !textItem.hasAnnotation) || (activeImageText?.field === 'imageTitle' && !textItem.hasImageTitle) || (activeImageText?.taskIndex !== undefined && !textItem.tasks?.[activeImageText.taskIndex])) activeImageText = null;
    imageTextTools.hidden = !activeImageText || locked;
    if (activeImageText) {
      const {field} = activeImageText, style = textStyle(textItem, activeImageText);
      imageTextTools.querySelector('.wb-text-context').textContent = field === 'annotation' ? 'Anotação' : field === 'imageTitle' ? 'Título' : field === 'task' ? `Tarefa ${activeImageText.taskIndex + 1}` : field === 'url' ? 'Endereço' : textItem.kind === 'tasks' || textItem.kind === 'link' ? 'Título' : 'Texto';
      if (document.activeElement !== imageFontSearch) imageFontSearch.value = style.fontFamily ?? textItem.fontFamily ?? (textItem.font && textItem.font !== 'default' ? CARD_FONTS[textItem.font] : '');
      const size = imageTextTools.querySelector('[data-image-style=size]');
      if (document.activeElement !== size) size.value = style.size || defaultTextSize(activeImageText);
      imageTextTools.querySelector('[data-text-bold]').setAttribute('aria-pressed', String(style.bold ?? textItem.bold ?? false));
      imageTextTools.querySelector('[data-image-style=color]').value = style.color || textItem.textColor || '#303b31';
      for (const button of imageTextTools.querySelectorAll('[data-image-align]')) button.setAttribute('aria-pressed', String(button.dataset.imageAlign === (style.align || 'left')));
    }
    const selectedPaths = [...selected].map(id => map.get(id));
    strokeTools.hidden = locked || !selectedPaths.length || !selectedPaths.every(item => ['line', 'draw'].includes(item?.kind));
    if (!strokeTools.hidden) {
      const widths = selectedPaths.map(item => item.strokeWidth ?? 2.5), same = widths.every(value => value === widths[0]);
      for (const input of strokeTools.querySelectorAll('input')) if (input !== document.activeElement) {input.value = same || input.type === 'range' ? widths[0] : ''; input.placeholder = same ? '' : 'Vários';}
    }
    if (selected.size) $(".wb-item-color").value = map.get([...selected][0])?.color || "#ffffff";
    $("[data-command=undo]").disabled = locked || !history.length;
    $("[data-command=redo]").disabled = locked || !future.length;
    $("[data-command=zoom-out]").disabled = camera.zoom <= MIN_ZOOM;
    $("[data-command=zoom-in]").disabled = camera.zoom >= MAX_ZOOM;
    if (!optionsMenu.hidden) syncOptions();
    if (pendingImageFocus) {
      const {id, field} = pendingImageFocus;
      const input = nodes.get(id)?.node.querySelector(`[data-field=${field}]`);
      if (input) {pendingImageFocus = null; input.focus({preventScroll: true});}
    }
    if (gesture && ["line", "draw"].includes(gesture.type)) {
      const g = gesture;
      preview.setAttribute("d", g.type === "line" ? `M${g.start.x},${g.start.y} L${g.end.x},${g.end.y}` : g.points.map((v, i) => `${i ? "L" : "M"}${v.join(",")}`).join(" "));
    }
  }
  function removeSelected() {
    if (!selected.size) return;
    commit(board.items.filter(item => !selected.has(item.id) && !(item.kind === "line" && (selected.has(item.from) || selected.has(item.to))))); select([]);
  }
  function duplicate() {
    const chosen = board.items.filter(item => selected.has(item.id));
    if (!chosen.length || board.items.length + chosen.length > MAX_ITEMS) return;
    const ids = new Map(chosen.map(item => [item.id, crypto.randomUUID()]));
    const copies = chosen.map(item => ({...item, id: ids.get(item.id), x: clamp(item.x + 30, -LIMIT, LIMIT), y: clamp(item.y + 30, -LIMIT, LIMIT), ...(item.kind === "line" ? {x2: item.x2 + 30, y2: item.y2 + 30, from: ids.get(item.from) || item.from, to: ids.get(item.to) || item.to} : {})}));
    commit([...board.items, ...copies]); select(copies.map(item => item.id));
  }
  function undo(redo = false) {
    if (locked) return;
    finishEdit(); const source = redo ? future : history, destination = redo ? history : future;
    if (!source.length) return;
    destination.push(board); board = source.pop(); reindex(); scheduleSave(); requestDraw();
  }
  function zoom(factor, at = {x: 0, y: 0}) {camera = zoomAt(camera, factor, at); camera.x = clamp(camera.x, -LIMIT * 3, LIMIT * 3); camera.y = clamp(camera.y, -LIMIT * 3, LIMIT * 3); if (!locked) scheduleSave(); requestDraw();}
  function fit() {
    if (!board.items.length) {camera = {x: 0, y: 0, zoom: 1};}
    else {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const item of board.items) {const b = boundsOf(item, map); left = Math.min(left, b.x); top = Math.min(top, b.y); right = Math.max(right, b.x + b.w); bottom = Math.max(bottom, b.y + b.h);}
      const z = clamp(Math.min((width - 220) / Math.max(1, right - left), (height - 150) / Math.max(1, bottom - top)), MIN_ZOOM, 1.5);
      camera = {x: -(left + right) / 2 * z + 32, y: -(top + bottom) / 2 * z, zoom: z};
    }
    if (!locked) scheduleSave(); requestDraw();
  }
  async function backup(restore = false) {
    $('.wb-backup-menu').open = false;
    if (!storage) {notify('Backup ZIP e arquivos locais estão disponíveis no aplicativo desktop.'); return;}
    if (locked || imports || !await flush()) return;
    imports++;
    try {
      if (restore) {
        const restored = await storage.restoreBackup();
        if (restored && !disposed) {validateBoard(restored); finishEdit(); remember(board); board = restored; camera = {...board.camera}; reindex(); scheduleSave(); requestDraw(); notify('Backup restaurado. Use Desfazer para voltar ao quadro anterior.');}
      } else {const path = await storage.createBackup({...board, camera}); if (path) notify('Backup ZIP criado com o quadro e suas mídias.');}
    } catch (error) {notify(`Não foi possível ${restore ? 'restaurar' : 'criar'} o backup: ${error.message || error}`, true);}
    finally {imports--; if (dirty && !disposed) scheduleSave();}
  }
  const commands = {undo: () => undo(), redo: () => undo(true), delete: removeSelected, duplicate, "zoom-in": () => zoom(1.2), "zoom-out": () => zoom(1 / 1.2), reset: () => zoom(1 / camera.zoom), fit, retry: flush, backup: () => backup(), restore: () => backup(true)};
  on(root, "click", event => {
    const alignment = event.target.closest('[data-image-align]')?.dataset.imageAlign;
    if (alignment && activeImageText && !locked) {
      const {id} = activeImageText, item = map.get(id);
      if (item) replaceItems(new Map([[id, styledText(item, activeImageText, {align: alignment})]]));
      return;
    }
    if (event.target.closest('[data-text-bold]') && activeImageText && !locked) {
      const item = map.get(activeImageText.id);
      if (item) replaceItems(new Map([[item.id, styledText(item, activeImageText, {bold: !(textStyle(item, activeImageText).bold ?? item.bold ?? false)})]]));
      return;
    }
    const choice = event.target.closest('[data-font-family]');
    if (choice && fontTarget && !locked) {
      const {id, field} = fontTarget, item = map.get(id), family = choice.dataset.fontFamily;
      if (!item) {hideFonts(); return;}
      const target = {...fontTarget};
      replaceItems(new Map([[id, field ? styledText(item, target, {fontFamily: family}) : {...item, font: 'default', fontFamily: family}]]));
      hideFonts(); fontInput.value = family;
      if (field) nodes.get(id)?.node.querySelector(target.taskIndex !== undefined ? `[data-task="${target.taskIndex}"] input[type=text]` : `[data-field=${field}]`)?.focus({preventScroll: true});
      else optionsMenu.focus({preventScroll: true});
      return;
    }
    const imageAction = event.target.closest('[data-image-edit]');
    if (imageAction && optionsId) {
      const item = map.get(optionsId), field = imageAction.dataset.imageEdit;
      closeOptions();
      replaceItems(new Map([[item.id, {...item, [field === 'annotation' ? 'hasAnnotation' : 'hasImageTitle']: true}]]));
      pendingImageFocus = {id: item.id, field}; return;
    }
    const grip = event.target.closest('.wb-grip');
    if (grip) {openOptions(grip); return;}
    if (event.target.closest('[data-format-bold]')) {
      const item = map.get(optionsId);
      if (item && !locked) replaceItems(new Map([[item.id, {...item, bold: !item.bold}]]));
      return;
    }
    const quick = event.target.closest("[data-quick-add]")?.dataset.quickAdd;
    if (quick) {quickAdd(quick); return;}
    const command = event.target.closest("[data-command]")?.dataset.command;
    if (command) {commands[command]?.(); return;}
    if (event.target.closest("button[data-mode]")) {setMode("select"); return;}
    const tool = event.target.closest("[data-tool]")?.dataset.tool;
    if (tool) {
      if (locked) return;
      finishEdit();
      if (tool === "image") {imagePoint = null; void chooseMedia();}
      else if (["line", "draw"].includes(tool)) {setMode(mode === tool ? "select" : tool); viewport.focus();}
      else add(tool);
      return;
    }
    const node = event.target.closest("[data-workspace-object]"), item = map.get(node?.dataset.workspaceObject);
    const anchor = event.target.closest(".wb-open-link");
    if (anchor && isTauri()) {event.preventDefault(); const url = safeURL(item?.url); if (url) void invoke("open_workspace_link", {url}).catch(() => notify("Não foi possível abrir o navegador. Copie o endereço do cartão."));}
    if (!item || locked) return;
    if (event.target.closest("[data-task-add]")) {
      if (item.tasks.length >= 200) {notify("A lista comporta até 200 tarefas."); return;}
      replaceItems(new Map([[item.id, {...item, tasks: [...item.tasks, {text: "", done: false}]}]]));
    }
    const row = event.target.closest("[data-task]");
    if (row && event.target.closest("button")) replaceItems(new Map([[item.id, {...item, tasks: item.tasks.filter((_, i) => i !== Number(row.dataset.task))}]]));
  });
  on(root, "focusin", event => {
    const target = textContext(event.target);
    if (target) {activeImageText = target; select([target.id]);}
    else if (!event.target.closest('.wb-selection') && !fontPopup.contains(event.target)) {activeImageText = null; requestDraw();}
    if (editable(event.target)) {finishEdit(); editStart = board;}
  });
  on(root, "focusout", event => {if (editable(event.target)) {finishEdit(); requestDraw();}});
  on(root, "input", event => {
    if (locked) return;
    if (event.target.matches('[data-stroke-width]')) {
      const value = Number(event.target.value);
      if (!event.target.value || !Number.isFinite(value) || value < .5 || value > 32) return;
      if (!editStart) editStart = board;
      const changes = new Map([...selected].map(id => map.get(id)).filter(item => ['line', 'draw'].includes(item?.kind)).map(item => [item.id, {...item, strokeWidth: value}]));
      if (changes.size) replaceItems(changes, false); return;
    }
    if (event.target.dataset.imageStyle && activeImageText) {
      const {id} = activeImageText, item = map.get(id), property = event.target.dataset.imageStyle;
      if (!item) return;
      const value = property === 'size' ? Number(event.target.value) : event.target.value;
      if (property === 'size' && (!event.target.value || !Number.isFinite(value) || value < 8 || value > 72)) return;
      if (!editStart) editStart = board;
      replaceItems(new Map([[id, styledText(item, activeImageText, {[property]: value})]]), false); return;
    }
    if (event.target === fontInput && !fontPopup.hidden) {fontQuery = fontInput.value; renderFonts(); return;}
    if (event.target.dataset.format) {
      const item = map.get(optionsId); if (!item) return;
      if (!editStart) editStart = board;
      const field = event.target.dataset.format === "background" && item.kind !== "color" ? "color" : event.target.dataset.format;
      replaceItems(new Map([[item.id, {...item, [field]: event.target.value}]]), false); return;
    }
    if (event.target.matches(".workspace-color")) {if (!editStart) editStart = board; board = {...board, background: event.target.value}; scheduleSave(); requestDraw(); return;}
    if (event.target.matches(".wb-item-color")) {if (!editStart) editStart = board; replaceItems(new Map([...selected].map(id => [id, {...map.get(id), color: event.target.value}])), false); return;}
    const node = event.target.closest("[data-workspace-object]"), item = map.get(node?.dataset.workspaceObject);
    if (!item) return;
    if (!editStart) editStart = board;
    let next = {...item}; const row = event.target.closest("[data-task]");
    if (row) next.tasks = item.tasks.map((task, i) => i === Number(row.dataset.task) ? {...task, ...(event.target.type === "checkbox" ? {done: event.target.checked} : {text: event.target.value})} : task);
    else if (event.target.dataset.field) next[event.target.dataset.field] = event.target.value;
    else return;
    replaceItems(new Map([[item.id, next]]), false);
  });
  on(root, "change", event => {if (editable(event.target)) {finishEdit(); requestDraw();}});
  on(viewport, "wheel", event => {
    hideFonts();
    closeOptions();
    closeQuickMenu();
    // Keep long notes and task lists scrollable without moving the board.
    const scrollable = event.target.closest("textarea, .wb-task-list, .wb-link .wb-card-body");
    if (!event.ctrlKey && scrollable && scrollable.scrollHeight > scrollable.clientHeight) return;
    event.preventDefault(); if (gesture) return;
    bounds = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    zoom(Math.exp(-clamp(delta, -500, 500) * .0015), {x: event.clientX - bounds.left - width / 2, y: event.clientY - bounds.top - height / 2});
  }, {passive: false});
  const preview = svgElement("path"); preview.classList.add("wb-preview");
  function cancelGesture() {
    if (!gesture) return;
    if (gesture.before && gesture.before !== board) {board = gesture.before; reindex(); scheduleSave();}
    gesture = null; preview.remove(); marquee.hidden = true; viewport.classList.remove("is-panning"); requestDraw();
  }
  on(viewport, "pointerdown", event => {
    if (gesture || ![0, 1].includes(event.button)) return;
    if (event.target.closest('.wb-link-media')) return;
    const node = event.target.closest("[data-workspace-object]"), id = node?.dataset.workspaceObject, item = map.get(id);
    const p = point(event);
    if (!space && event.button === 0 && mode === "select" && editable(event.target)) {select([id]); return;}
    if (!space && event.button === 0 && event.target.closest("a, button") && !event.target.closest(".wb-resize")) return;
    event.preventDefault(); finishEdit(); viewport.focus({preventScroll: true});
    if (space || event.button === 1 || (mode === "select" && !item && !event.shiftKey) || locked) {
      if (!space && !item) select([]);
      gesture = {type: "pan", startX: event.clientX, startY: event.clientY, camera: {...camera}}; viewport.classList.add("is-panning");
    } else if (mode === "line" && item && !["line", "draw"].includes(item.kind)) {
      if (!lineStart) {lineStart = {id}; select([id]); hint.textContent = "Agora clique no cartão de destino · Esc: cancelar";}
      else if (lineStart.id !== id) {const from = map.get(lineStart.id); add("line", {x: from.x, y: from.y}, {x2: p.x, y2: p.y, from: from.id, to: id, color: "#75876b"});}
      requestDraw(); return;
    } else if (mode === "line" || mode === "draw") {
      gesture = {type: mode, start: p, end: p, points: [[p.x, p.y]]}; lines.append(preview);
    } else if (event.shiftKey && !item) {gesture = {type: "marquee", start: p, selected: new Set(selected)}; marquee.hidden = false;}
    else if (item) {
      if (event.shiftKey) {const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); select(next); return;}
      if (!selected.has(id)) select([id]);
      const resize = event.target.closest(".wb-resize");
      gesture = {type: resize ? "resize" : "move", direction: resize?.dataset.resize || "se", start: p, before: board, originals: [...selected].map(id => map.get(id)), item, moved: false};
    }
    if (gesture) {gesture.pointerId = event.pointerId; viewport.setPointerCapture?.(event.pointerId);}
  });
  on(viewport, "pointermove", event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const g = gesture, p = point(event);
    if (g.type === "pan") {
      camera.x = clamp(g.camera.x + event.clientX - g.startX, -LIMIT * 3, LIMIT * 3); camera.y = clamp(g.camera.y + event.clientY - g.startY, -LIMIT * 3, LIMIT * 3); requestDraw();
    } else if (["move", "resize"].includes(g.type)) {
      let dx = p.x - g.start.x, dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * camera.zoom < 3) return;
      g.moved = true;
      const changed = new Map();
      if (g.type === "resize") changed.set(g.item.id, resizeCard(g.item, g.direction, dx, dy));
      else for (const item of g.originals) {
        if (event.shiftKey) {dx = Math.round(dx / 20) * 20; dy = Math.round(dy / 20) * 20;}
        const next = {...item, x: clamp(item.x + dx, -LIMIT, LIMIT), y: clamp(item.y + dy, -LIMIT, LIMIT)};
        if (item.kind === "line") {next.x2 = clamp(item.x2 + dx, -LIMIT, LIMIT); next.y2 = clamp(item.y2 + dy, -LIMIT, LIMIT);}
        changed.set(item.id, next);
      }
      replaceItems(changed, false);
    } else if (g.type === "marquee") {
      const rect = {x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y)};
      marquee.style.cssText = `left:${width / 2 + camera.x + rect.x * camera.zoom}px;top:${height / 2 + camera.y + rect.y * camera.zoom}px;width:${rect.w * camera.zoom}px;height:${rect.h * camera.zoom}px`;
      select([...g.selected, ...index.query(rect)]);
    } else {
      g.end = p;
      if (g.type === "draw") {
        const last = g.points.at(-1);
        if (g.points.length < 4000 && Math.hypot(p.x - last[0], p.y - last[1]) * camera.zoom > 2) g.points.push([p.x, p.y]);
      }
      // The preview is the only path changed while drawing.
      requestDraw();
    }
  });
  function endGesture(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const g = gesture; gesture = null;
    if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    viewport.classList.remove("is-panning"); preview.remove(); marquee.hidden = true;
    if (g.type === "pan") {if (!locked) scheduleSave();}
    else if (g.moved) {remember(g.before); requestDraw();}
    else if (g.type === "line" && Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) > 3 / camera.zoom) add("line", g.start, {x2: g.end.x, y2: g.end.y, color: "#75876b"});
    else if (g.type === "draw" && g.points.length > 1) {
      const xs = g.points.map(p => p[0]), ys = g.points.map(p => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), h = Math.max(1, Math.max(...ys) - y);
      add("draw", {x, y}, {w, h, baseW: w, baseH: h, points: g.points.map(p => [p[0] - x, p[1] - y]), color: "#526449"}); setMode("draw");
    }
  }
  on(viewport, "pointerup", endGesture);
  on(viewport, "pointercancel", cancelGesture);
  on(viewport, "lostpointercapture", cancelGesture);
  on(viewport, "dblclick", event => {
    if (event.button !== 0 || event.shiftKey || space || mode !== "select" || event.target.closest("[data-workspace-object]") || locked) return;
    event.preventDefault(); openQuickMenu(event);
  });
  on(document, "pointerdown", event => {if (!quickMenu.contains(event.target)) closeQuickMenu();}, {capture: true});
  on(document, "pointerdown", event => {if (!optionsMenu.contains(event.target) && !fontPopup.contains(event.target) && !event.target.closest('.wb-grip')) closeOptions();}, {capture: true});
  on(document, 'pointerdown', event => {
    if (activeImageText && !fontPopup.contains(event.target) && !event.target.closest('.wb-selection') && !textContext(event.target)) {activeImageText = null; requestDraw();}
    if (!fontPopup.hidden && !fontPopup.contains(event.target) && event.target !== fontInput) hideFonts();
  }, {capture: true});
  on(optionsMenu, "focusout", event => {if (event.relatedTarget && !optionsMenu.contains(event.relatedTarget) && !fontPopup.contains(event.relatedTarget) && event.relatedTarget !== optionsTrigger) closeOptions();});
  on(fontSearch, 'focus', () => {void showFonts();});
  on(fontSearch, 'pointerdown', () => {if (document.activeElement === fontSearch && fontPopup.hidden) void showFonts();});
  on(imageFontSearch, 'focus', () => {void showFonts(imageFontSearch);});
  on(imageFontSearch, 'pointerdown', () => {if (document.activeElement === imageFontSearch && fontPopup.hidden) void showFonts(imageFontSearch);});
  on(quickMenu, "focusout", event => {if (!quickMenu.contains(event.relatedTarget)) closeQuickMenu();});
  let toolDrag = null, toolDragged = false, dragFrame = 0;
  const dragGhost = document.createElement('div'); dragGhost.className = 'wb-tool-ghost'; dragGhost.hidden = true; dragGhost.setAttribute('aria-hidden', 'true');
  root.append(dragGhost);
  const draggableTools = ['note', 'tasks', 'image', 'link', 'comment', 'color'];
  function toolDropAllowed(x, y) {
    const rect = viewport.getBoundingClientRect(), hit = document.elementFromPoint?.(x, y);
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && (!hit || Boolean(hit.closest('.workspace-board')));
  }
  function clearToolDrag() {
    if (dragFrame) cancelAnimationFrame(dragFrame); dragFrame = 0;
    const drag = toolDrag; toolDrag = null; dragGhost.hidden = true;
    root.classList.remove('wb-dragging-tool'); drag?.tool.classList.remove('is-drag-origin');
    if (drag?.tool.hasPointerCapture?.(drag.pointerId)) drag.tool.releasePointerCapture(drag.pointerId);
  }
  function paintToolDrag() {
    dragFrame = 0; if (!toolDrag || !toolDragged) return;
    dragGhost.style.transform = 'translate3d(' + (toolDrag.latestX + 18) + 'px,' + (toolDrag.latestY + 16) + 'px,0)';
    const allowed = toolDropAllowed(toolDrag.latestX, toolDrag.latestY);
    dragGhost.classList.toggle('is-drop-ready', allowed);
    dragGhost.querySelector('small').textContent = allowed ? 'Solte para adicionar' : 'Arraste para o quadro';
  }
  on(root, 'pointerdown', event => {
    toolDragged = false;
    const tool = event.target.closest('[data-tool]');
    if (locked || event.button !== 0 || !tool || !draggableTools.includes(tool.dataset.tool)) return;
    clearToolDrag();
    toolDrag = {kind:tool.dataset.tool, tool, pointerId:event.pointerId, x:event.clientX, y:event.clientY}; event.preventDefault();
    if (Number.isInteger(event.pointerId)) tool.setPointerCapture?.(event.pointerId);
  });
  on(document, 'pointermove', event => {
    if (!toolDrag) return;
    toolDrag.latestX = event.clientX; toolDrag.latestY = event.clientY;
    if (!toolDragged && Math.hypot(event.clientX-toolDrag.x,event.clientY-toolDrag.y)>8) {
      toolDragged = true;
      const [, label, src] = tools.find(([kind]) => kind === toolDrag.kind);
      dragGhost.replaceChildren();
      const img = document.createElement('img'); img.src = src; img.alt = '';
      const name = document.createElement('strong'); name.textContent = label;
      const hint = document.createElement('small');
      dragGhost.append(img, name, hint); dragGhost.hidden = false;
      toolDrag.tool.classList.add('is-drag-origin'); root.classList.add('wb-dragging-tool');
    }
    if (toolDragged && !dragFrame) dragFrame = requestAnimationFrame(paintToolDrag);
  });
  on(document, 'pointerup', event => {
    if (!toolDrag) return;
    const kind = toolDrag.kind, allowed = toolDragged && toolDropAllowed(event.clientX,event.clientY);
    clearToolDrag();
    if (allowed) {
      const at = point(event);
      if (kind === 'image') {imagePoint = at; void chooseMedia();} else add(kind, at);
    }
  });
  on(document, 'pointercancel', () => {clearToolDrag(); toolDragged=false;});
  on(window, 'blur', clearToolDrag);
  on(document, 'dayline:visibility', event => {if(event.detail.hidden) clearToolDrag();});
  on(document, 'keydown', event => {
    if(event.key === 'Escape' && toolDrag) {clearToolDrag(); toolDragged=true; event.preventDefault(); event.stopImmediatePropagation();}
  }, {capture:true});
  on(root, 'click', event => {if(toolDragged) {toolDragged=false;event.preventDefault();event.stopImmediatePropagation();}}, {capture:true});
  on(root, 'dragstart', event => {if(event.target.closest('[data-tool]')) event.preventDefault();});
  on(viewport, "dragover", event => {if (!locked) {event.preventDefault(); event.dataTransfer.dropEffect = "copy";}});
  on(viewport, "drop", event => {
    if (locked) return; event.preventDefault(); const at = point(event), kind = event.dataTransfer.getData("application/x-dayline-tool");
    if (["note", "tasks", "link", "comment", "color"].includes(kind)) add(kind, at);
    else if (event.dataTransfer.files.length) {if (storage) {imagePoint = at; notify('Selecione o arquivo original para manter apenas o caminho no quadro.'); void chooseMedia();} else void importImages([...event.dataTransfer.files], at);}
    else {const text = event.dataTransfer.getData("text/plain").slice(0, 20000); if (text) add(safeURL(text) ? "link" : "note", at, safeURL(text) ? {url: text.slice(0, 4000)} : {text});}
  });
  async function chooseMedia(paths = null, dropPoint = null) {
    if (!storage) {$('.wb-file').click(); return;}
    if (locked || imports) return;
    const at = dropPoint || imagePoint || center(); imagePoint = null; imports++;
    try {
      const media = paths ? await storage.useMedia(paths) : await storage.pickMedia();
      for (const [i, file] of media.entries()) {
        if (disposed) break;
        const extra = {mediaPath: file.path, w: 360, h: 340};
        if (file.kind === 'video') extra.thumbnail = await videoThumbnail(mediaURL(file.path));
        if (!disposed) add(file.kind, {x: at.x + i * 35, y: at.y + i * 35}, extra);
      }
    } catch (error) {notify(`Não foi possível adicionar a mídia: ${error.message || error}`);}
    finally {imports--; if (dirty && !disposed) scheduleSave();}
  }
  async function importImages(files, at = center(), clipboard = false) {
    if (locked || imports) return;
    imports++; saveStatus("Preparando imagens…");
    try {
      for (const [i, file] of files.slice(0, 20).entries()) {
        if (disposed) break;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) {notify("Use PNG, JPG ou WebP de até 20 MB por imagem."); continue;}
        if (storage) {
          if (!clipboard) {notify('Use o seletor de mídia para adicionar arquivos sem copiá-los.'); continue;}
          const data = await new Promise((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);});
          const mediaPath = await storage.clipboardImage(data);
          if (!disposed) add('image', {x: at.x + i * 35, y: at.y + i * 35}, {mediaPath, w:300, h:275});
          continue;
        }
        const src = await compressImage(file);
        if (disposed) break;
        if (src.data.length > 2_000_000) {notify("Esta imagem é muito grande para o quadro. Tente uma versão menor."); continue;}
        const w = 300, h = clamp(w * src.height / src.width + 75, 160, 650);
        add("image", {x: at.x + i * 35, y: at.y + i * 35}, {src: src.data, w, h});
      }
      if (files.length > 20) notify("Adicione até 20 imagens por vez.");
    } catch {notify("Não foi possível abrir a imagem. Tente outro arquivo.");}
    finally {imports--; if (!disposed && dirty) scheduleSave();}
  }
  on($(".wb-file"), "change", event => {const at = imagePoint; imagePoint = null; void importImages([...event.target.files], at || center()); event.target.value = "";});
  on($(".wb-file"), "cancel", () => {imagePoint = null;});
  on(document, "paste", event => {
    if (locked || editable(event.target) || document.querySelector("dialog[open]")) return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {event.preventDefault(); void importImages(files, center(), true); return;}
    const text = event.clipboardData?.getData("text/plain").slice(0, 20000);
    if (text) {event.preventDefault(); add(safeURL(text) ? "link" : "note", center(), safeURL(text) ? {url: text.slice(0, 4000)} : {text});}
  });
  function keydown(event) {
    if (event.target.closest?.('.wb-link-media')) return;
    if (document.querySelector("dialog[open]")) return;
      if (!fontPopup.hidden && event.target === fontInput) {
        const choices = [...fontList.children];
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault(); fontActive = (fontActive + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
          choices.forEach((node, i) => node.classList.toggle('is-active', i === fontActive));
          fontInput.setAttribute('aria-activedescendant', choices[fontActive].id); choices[fontActive].scrollIntoView?.({block: 'nearest'}); return;
        }
        if (event.key === 'Enter') {event.preventDefault(); if (fontActive >= 0) choices[fontActive].click(); return;}
        if (event.key === 'Escape') {event.preventDefault(); hideFonts(); return;}
      }
    if (!optionsMenu.hidden) {
      if (event.key === "Escape") {event.preventDefault(); closeOptions(true); return;}
      const rows = [...optionsMenu.children].filter(row => !row.hidden);
      if (!editable(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey && /^[1-6]$/.test(event.key) && Number(event.key) <= rows.length) {
        event.preventDefault(); const row = rows[Number(event.key) - 1], control = row.matches('button') ? row : row.querySelector('input');
        control.focus(); if (control.type !== 'text') control.click(); return;
      }
      if (optionsMenu.contains(event.target) || fontPopup.contains(event.target)) return;
    }
    if (!quickMenu.hidden) {
      if (event.key === "Escape") {event.preventDefault(); closeQuickMenu(true); return;}
      if (!event.ctrlKey && !event.metaKey && !event.altKey && ["1", "2", "3"].includes(event.key)) {event.preventDefault(); quickAdd(["note", "image", "link"][Number(event.key) - 1]); return;}
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const buttons = [...quickMenu.querySelectorAll("button")], current = buttons.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (current + (event.key === "ArrowUp" ? 2 : 1)) % 3;
        buttons[next].focus({preventScroll: true}); return;
      }
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Tab") closeQuickMenu();
      else return;
    }
    if (event.key === "Escape") {
      if (gesture) {cancelGesture(); event.preventDefault();}
      else if (editable(event.target)) {event.target.blur(); viewport.focus(); event.preventDefault();}
      else if (mode !== "select" || selected.size) {setMode("select"); select([]); event.preventDefault();}
      return;
    }
    if (editable(event.target)) return;
    const keyName = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (event.code === "Space") {event.preventDefault(); space = true; viewport.classList.add("wb-space"); return;}
    if (mod && ["z", "y", "d", "a"].includes(keyName)) {
      event.preventDefault(); if (gesture) return;
      if (keyName === "z" || keyName === "y") undo(keyName === "y" || event.shiftKey);
      else if (keyName === "d") duplicate(); else select(map.keys()); return;
    }
    if (gesture || mod || event.altKey || locked) return;
    if (["Delete", "Backspace"].includes(event.key)) {event.preventDefault(); removeSelected();}
    else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selected.size) {
      event.preventDefault(); const step = event.shiftKey ? 20 : 2, dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      replaceItems(new Map([...selected].map(id => {const item = map.get(id); return [id, {...item, x: clamp(item.x + dx, -LIMIT, LIMIT), y: clamp(item.y + dy, -LIMIT, LIMIT), ...(item.kind === "line" ? {x2: clamp(item.x2 + dx, -LIMIT, LIMIT), y2: clamp(item.y2 + dy, -LIMIT, LIMIT)} : {})}];})));
    } else if (keyName === "v") setMode("select");
    else if (keyName === "n") add("note");
    else if (keyName === "f") fit();
    else if (["+", "="].includes(event.key)) zoom(1.2);
    else if (event.key === "-") zoom(1 / 1.2);
  }
  on(document, "keydown", keydown, {capture: true});
  on(document, "keyup", event => {if (event.code === "Space") {space = false; viewport.classList.remove("wb-space");}});
  on(window, "blur", () => {closeQuickMenu(); space = false; viewport.classList.remove("wb-space"); cancelGesture(); finishEdit(); flush();});
  on(window, "beforeunload", event => {finishEdit(); if (storage ? dirty || saving || imports : !flush()) {event.preventDefault(); event.returnValue = "";}});
  on(window, "pagehide", flush);
  on(document, "dayline:visibility", event => {
    suspended = event.detail.hidden;
    if (suspended) {hideFonts(); closeOptions(); closeQuickMenu();}
    if (suspended) {cancelGesture(); finishEdit(); flush(); if (frame) cancelAnimationFrame(frame); frame = 0; stopLinkMedia(cards); cards.replaceChildren(); lines.replaceChildren(); nodes.clear();}
    else measure();
  });
  on(window, "storage", event => {
    if (storage) return;
    if (event.key !== key && event.key !== null) return;
    if (dirty) {saveStatus("Conflito entre janelas", true); notify("Outra janela alterou o quadro. Baixe uma cópia antes de sair.", true); return;}
    try {const raw = localStorage.getItem(key), next = raw ? validateBoard(JSON.parse(raw)) : emptyBoard(); board = next; snapshot = raw; camera = {...board.camera}; history = []; future = []; selected.clear(); reindex(); requestDraw();}
    catch {notify("Outra janela gravou dados incompatíveis. O quadro aberto foi preservado.", true);}
  });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  if (storage && isTauri()) void import('@tauri-apps/api/window').then(async ({getCurrentWindow}) => {
    const win = getCurrentWindow(), scale = await win.scaleFactor();
    const unlisten = await win.onDragDropEvent(event => {
      if (event.payload.type !== 'drop' || disposed || suspended || locked || imports) return;
      const {x, y} = event.payload.position, rect = viewport.getBoundingClientRect();
      const clientX = x / scale, clientY = y / scale;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) void chooseMedia(event.payload.paths, point({clientX, clientY}));
    });
    if (disposed) unlisten(); else abort.signal.addEventListener('abort', unlisten, {once:true});
  }).catch(() => {if (!disposed) notify('Arraste de arquivos indisponível. Use o seletor de mídia.');});
  if (observer) observer.observe(viewport); else on(window, "resize", measure);
  reindex(); measure();
  if (locked) {notify(readError, true); saveStatus("Quadro em modo de leitura", true); $(".workspace-color").disabled = true; $("[data-command=restore]").disabled = true; for (const button of root.querySelectorAll("[data-tool]")) button.disabled = true;}
  return {
    flush() {finishEdit(); return flush();},
    destroy() {quickMotion.close(); disposed = true; clearToolDrag(); for (const animation of menuAnimations) animation.cancel(); abort.abort(); observer?.disconnect(); clearTimeout(saveTimer); clearTimeout(noticeTimer); if (frame) cancelAnimationFrame(frame); stopLinkMedia(cards); nodes.clear(); history = []; future = []; root.replaceChildren();},
  };
}

async function compressImage(file) {
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise((resolve, reject) => {image.onload = resolve; image.onerror = reject; image.src = url;});
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 80_000_000) throw new Error("Imagem muito grande");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return {data: canvas.toDataURL("image/webp", .82), width: canvas.width, height: canvas.height};
  } finally {URL.revokeObjectURL(url); image.src = "";}
}
