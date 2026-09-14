// Interface visual do quadro: ferramentas, estrutura inicial e menus auxiliares.
import textIcon from "../icons/texto.svg";
import tasksIcon from "../icons/Tarefas.svg";
import imageIcon from "../icons/image.svg";
import linkIcon from "../icons/link.svg";
import lineIcon from "../icons/Linha.svg";
import drawIcon from "../icons/desenhar.svg";
import commentIcon from "../icons/comentario.svg";
import colorIcon from "../icons/cor.svg";
import {icon} from "./icons.js";

// Ferramentas disponíveis para criar cartões e conexões no quadro.
export const tools = [
  ["note", "Nota", textIcon], ["tasks", "Tarefas", tasksIcon], ["image", "Imagem", imageIcon], ["link", "Link", linkIcon],
  ["line", "Conectar", lineIcon], ["draw", "Desenhar", drawIcon], ["comment", "Comentário", commentIcon], ["color", "Cor", colorIcon],
];

// Monta a interface estática que o controlador do quadro utiliza.
export function renderWorkspaceUI(root) {
  root.innerHTML = `<div class="workspace-board" tabindex="0" role="region" aria-label="Quadro infinito. Arraste o fundo para navegar e use a roda para zoom.">
      <div class="wb-world"><svg class="wb-lines" aria-label="Conexões e desenhos"></svg><div class="wb-cards"></div></div>
      <div class="wb-empty"><span class="wb-empty-mark">+</span><h2>Espaço para suas ideias</h2><p>Adicione uma nota, arraste imagens<br>e conecte as partes do seu projeto.</p><span>Seu quadro começa aqui</span></div>
      <div class="wb-marquee" hidden></div>
    </div>
    <div class="wb-toolbar" role="toolbar" aria-label="Adicionar ao quadro">
      <button type="button" data-mode="select" title="Selecionar / mover (V)" aria-label="Selecionar / mover" aria-pressed="true"><span class="wb-pointer">↖</span><span>Mover</span></button>
      <span class="wb-divider"></span>
      ${tools.map(([kind, label, src]) => `<button type="button" data-tool="${kind}" draggable="${!["image", "line", "draw"].includes(kind)}" title="${label}" ${["line", "draw"].includes(kind) ? 'aria-pressed="false"' : ""}><img src="${src}" alt="" draggable="false"><span>${label}</span></button>`).join("")}
    </div>
    <div class="wb-top-actions"><span class="wb-save" role="status" aria-live="polite" hidden></span><button type="button" data-command="retry" hidden>Tentar salvar</button><details class="wb-backup-menu"><summary>Backup</summary><div><button type="button" data-command="backup">Criar Backup</button><button type="button" data-command="restore">Restaurar Backup</button></div></details><label class="workspace-color-label" title="Cor do fundo">Fundo <input class="workspace-color" type="color" aria-label="Cor do fundo do quadro"></label></div>
    <div class="wb-selection" role="toolbar" aria-label="Seleção" hidden><span class="wb-selection-count"></span><label title="Cor dos itens selecionados"><input type="color" class="wb-item-color" aria-label="Cor dos itens selecionados"></label><button type="button" data-command="duplicate" title="Duplicar (Ctrl+D)" aria-label="Duplicar seleção">${icon("plus")}</button><button type="button" data-command="delete" title="Excluir (Delete)" aria-label="Excluir seleção">${icon("trash")}</button></div>
    <div class="wb-bottom"><div class="wb-history"><button type="button" data-command="undo" title="Desfazer (Ctrl+Z)" aria-label="Desfazer">${icon("undo")}</button><button type="button" data-command="redo" title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">${icon("undo", "wb-redo")}</button></div><span class="wb-hint" hidden></span><div class="workspace-tools"><button type="button" data-command="zoom-out" aria-label="Diminuir zoom">−</button><button type="button" data-command="reset" class="workspace-zoom-label" title="Voltar a 100%">100%</button><button type="button" data-command="zoom-in" aria-label="Aumentar zoom">+</button><button type="button" data-command="fit" class="workspace-reset" title="Enquadrar todos os itens" aria-label="Enquadrar todos os itens">${icon("maximize")}</button></div></div>
    <div class="wb-notice" role="alert" hidden></div><input class="wb-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>`;

  const quickMenu = document.createElement("div");
  quickMenu.className = "wb-quick-menu"; quickMenu.hidden = true;
  quickMenu.setAttribute("role", "menu"); quickMenu.setAttribute("aria-label", "Adicionar no cursor");
  quickMenu.innerHTML = [tools[0], tools[2], tools[3]].map(([kind, label, src], i) => `<div class="wb-quick-slot" role="none"><button type="button" role="menuitem" data-quick-add="${kind}" aria-label="${i + 1}. ${label}"><img src="${src}" alt="" draggable="false"><span>${label}</span><kbd>${i + 1}</kbd></button></div>`).join("");
  root.append(quickMenu);

  const optionsMenu = document.createElement("div");
  optionsMenu.className = "wb-options-menu"; optionsMenu.id = "wb-card-options"; optionsMenu.hidden = true; optionsMenu.tabIndex = -1;
  optionsMenu.setAttribute("role", "dialog"); optionsMenu.setAttribute("aria-label", "Opções do cartão");
  optionsMenu.innerHTML = `<button type="button" class="wb-option" data-image-edit="annotation" hidden><span class="wb-option-symbol">✎</span><span data-option-label="Adicionar anotação"></span></button>
    <button type="button" class="wb-option" data-image-edit="imageTitle" hidden><span class="wb-option-symbol">T</span><span data-option-label="Título"></span></button>
    <label class="wb-option"><span class="wb-option-symbol">Aa</span><span><small data-option-label="Mudar a fonte"></small><input type="text" class="wb-font-search" aria-label="Buscar fontes instaladas" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="wb-font-list" autocomplete="off" placeholder="Buscar fontes do computador…"></span></label>
    <label class="wb-option"><span class="wb-option-symbol">A</span><span data-option-label="Cor do texto"></span><input type="color" data-format="textColor" aria-label="Cor do texto do cartão"></label>
    <button type="button" class="wb-option" data-format-bold aria-pressed="false"><span class="wb-option-symbol"><b>B</b></span><span data-option-label="Deixar em negrito"></span></button>
    <label class="wb-option"><span class="wb-option-symbol">◧</span><span data-option-label="Cor do fundo"></span><input type="color" data-format="background" aria-label="Cor do fundo do cartão"></label>`;
  root.append(optionsMenu);

  const fontPopup = document.createElement("div"); fontPopup.className = "wb-font-popup"; fontPopup.hidden = true;
  fontPopup.innerHTML = '<div id="wb-font-list" role="listbox" aria-label="Fontes instaladas"></div><small class="wb-font-status" role="status"></small>';
  root.append(fontPopup);
  return {quickMenu, optionsMenu, fontPopup};
}
