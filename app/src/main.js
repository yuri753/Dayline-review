// Controlador principal: conecta dados, navegação, formulários e renderização.
import {
  KINDS,
  prepared,
  PRIORITIES,
  localDay,
  toLocalInput,
  amountInput,
  money,
  makeCommission,
  makePersonalProject,
  validateDataset,
  timing,
  stats,
  filterItems,
  durationLabel,
  hasReceivedPayment,
} from "./domain.js";
import {
  openRepository,
  openProfileRepository,
  STORAGE_KEY,
} from "./storage.js";
import { EMPTY_PROFILE, PROFILE_KEY, imageStyle, initials, readProfileImage } from "./profile.js";
import {deleteProjectCanvas} from './board-storage.js';
import { createProfileEditor } from "./profile-editor.js";
import { icon } from "./icons.js";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { bindSidebar } from "./sidebar.js";
import { bindProjectWorkspace } from "./project-workspace.js";
import {getInstalledFonts} from "./installed-fonts.js";
import { bindMoneyForm } from "./money-form.js";
import { bindEarnings } from "./earnings-view.js";
import { capturePayments } from "./earnings.js";
import {createPreviewActions, previewMarkup} from "./commission-preview/menu.js";
import {createFeedbackActions} from "./commission-preview/feedback.js";
const disableAutostart = () => invoke("plugin:autostart|disable");
const enableAutostart = () => invoke("plugin:autostart|enable");
const isAutostartEnabled = () => invoke("plugin:autostart|is_enabled");

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
document.addEventListener("contextmenu", event => event.preventDefault());
if (isTauri()) document.documentElement.classList.add("tauri-window");

const nativeWindow = isTauri() ? getCurrentWindow() : null;
function setupWindowDrag() {
  if (!nativeWindow) return;
  const drag = event => {
    if (event.button !== 0 || event.isPrimary === false || event.target.closest("button, a, input, select, textarea, [contenteditable]")) return;
    event.preventDefault();
    void nativeWindow.startDragging().catch(error => {console.error(error); toast("Não foi possível mover o widget.", true);});
  };
  for (const region of $$("[data-window-drag]")) {
    region.addEventListener("mousedown", drag);
    region.addEventListener("pointerdown", event => {if (event.pointerType && event.pointerType !== "mouse") drag(event);});
  }
}
function setupWindowControls() {
  const fullscreenButtons = $$('[data-window-fullscreen]');
  const workspace = $("#project-workspace");
  const updateFullscreenButton = fullscreen => {
    for (const button of fullscreenButtons) {
      button.setAttribute("aria-label", fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia");
      button.title = fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia";
    }
  };
  const animateFullscreenChange = async change => {
    workspace?.classList.add("is-fullscreen-transitioning");
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      await change();
      await new Promise(resolve => setTimeout(resolve, 180));
    } finally {
      workspace?.classList.remove("is-fullscreen-transitioning");
    }
  };
  for (const button of fullscreenButtons) button.addEventListener("click", async () => {
    try {
      if (nativeWindow) {
        const fullscreen = await nativeWindow.isFullscreen();
        await animateFullscreenChange(() => nativeWindow.setFullscreen(!fullscreen));
        updateFullscreenButton(!fullscreen);
      } else if (document.fullscreenElement) {
        await animateFullscreenChange(() => document.exitFullscreen());
      } else {
        await animateFullscreenChange(() => document.documentElement.requestFullscreen());
      }
    } catch (error) {console.error("Não foi possível alternar a tela cheia:", error); toast("Não foi possível alternar a tela cheia.", true);}
  });
  document.addEventListener("fullscreenchange", () => updateFullscreenButton(Boolean(document.fullscreenElement)));
  if (!nativeWindow) return;
  for (const button of $$("[data-window-minimize]")) button.addEventListener("click", async () => {
    try {await nativeWindow.hide(); setAppHidden(true);}
    catch (error) {console.error(error); setAppHidden(false); toast("Não foi possível minimizar o widget.", true);}
  });
  for (const button of $$("[data-window-close]")) button.addEventListener("click", async () => {
    if (state.busy || state.confirmRunning) {toast("Aguarde o salvamento terminar para fechar."); return;}
    if (projectWorkspace && !await projectWorkspace.flush()) return;
    try {await nativeWindow.close();} catch (error) {console.error(error); toast("Não foi possível fechar o widget.", true);}
  });
  let closingWindow = false;
  void nativeWindow.onCloseRequested(async event => {
    event.preventDefault();
    if (closingWindow) return;
    if (state.busy || state.confirmRunning) {toast('Aguarde o salvamento terminar para fechar.'); return;}
    closingWindow = true;
    try {if (!projectWorkspace || await projectWorkspace.flush()) await nativeWindow.destroy();}
    catch (error) {console.error(error); toast('Não foi possível salvar e fechar o quadro.', true);}
    finally {closingWindow = false;}
  }).catch(console.error);
  void nativeWindow.listen("dayline-visibility", event => {setAppHidden(!event.payload); if (event.payload) updateClock();}).catch(console.error);
  void nativeWindow.onFocusChanged(async event => {
    appFocused = event.payload;
    if (event.payload) {setAppHidden(false); updateClock();}
    else {
      try {setAppHidden(!(await nativeWindow.isVisible()) || await nativeWindow.isMinimized());} catch {}
      restartClock();
    }
  }).catch(console.error);
}
async function setupAutostart() {
  const toggle = $("#startup-toggle");
  if (!toggle) return;
  if (!isTauri()) {toggle.disabled = true; toggle.title = "Disponível no aplicativo instalado no Windows"; return;}
  try {
    toggle.setAttribute("aria-pressed", String(await isAutostartEnabled()));
  } catch (error) {
    console.error("Não foi possível ler o autostart:", error);
    toggle.disabled = true;
    return;
  }
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      const enabled = toggle.getAttribute("aria-pressed") === "true";
      if (enabled) await disableAutostart();
      else await enableAutostart();
      toggle.setAttribute("aria-pressed", String(!enabled));
      toast(!enabled ? "O app vai iniciar com o Windows." : "O app não vai mais iniciar com o Windows.");
    } catch (error) {
      console.error("Não foi possível alterar o autostart:", error);
      toast("Não foi possível alterar essa opção.", true);
    } finally {
      toggle.disabled = false;
    }
  });
}
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
let formatters = new Map();
function dateFormatter(options) {
  const key = JSON.stringify(options);
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat("pt-BR", options));
  return formatters.get(key);
}
const dateText = (value, options = {}) => dateFormatter({day: "2-digit", month: "short", ...options}).format(new Date(value)).replace(/\./g, "");
const hourText = value => dateFormatter({hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(new Date(value));
const setText = (el, text) => {if (el && el.textContent !== String(text)) el.textContent = String(text);};
const state = {
  // Estado transitório da tela; os dados persistentes vivem em state.repo.
  data: { schemaVersion: 1, commissions: [], personalProjects: [] },
  repo: null,
  ready: false,
  busy: false,
  view: "active",
  area: "commissions",
  search: "",
  sort: "priority",
  kindFilter: "",
  profile: { ...EMPTY_PROFILE },
  profileRepo: null,
  profileReady: false,
  editingId: null,
  editingPersonal: false,
  page: 0,
  confirmAction: null,
  confirmCancelAction: null,
  confirmRejectAction: null,
};
const THEME_KEY = "intervalo.theme.v1";
const FONT_KEY = "intervalo.font.v1";
const SIDEBAR_WIDTH_KEY = "intervalo.sidebar-width.v1";
const NOTIFICATION_KEY = "intervalo.notifications.v1";
const NOTIFICATION_SETTINGS_KEY = "intervalo.notification-settings.v1";
const CATEGORIES_KEY = "intervalo.categories.v1";
const LIST_DENSITY_KEY = "intervalo.list-density.v1";
const LIST_DENSITIES = Object.freeze({
  1: ["small", "Pequeno"],
  2: ["comfortable", "Médio"],
  3: ["roomy", "Grande"],
});
const DEFAULT_NOTIFICATION_SETTINGS = {
  amount: 2,
  unit: "hours",
  message: "Faltam menos de 2 horas para entregar “{nome}”.",
};
const DEFAULT_THEME = {
  "--bg": "#101310",
  "--sidebar": "#141714",
  "--surface": "#1a1e1a",
  "--surface-hover": "#202620",
  "--border": "#2c322b",
  "--text": "#f0f1e9",
  "--muted": "#a0a99b",
  "--dim": "#747f71",
  "--mint": "#b5e88b",
  "--amber": "#efbc72",
  "--red": "#f28e83",
  "--blue": "#a6c7df",
  "--commission-action": "#b5e88b",
  "--personal-action": "#b5e88b",
  "--feedback-notification": "#c4e3aa",
};
const DEFAULT_THEME_OPACITY = Object.fromEntries(
  Object.keys(DEFAULT_THEME).map((key) => [key, 1]),
);
let theme = { ...DEFAULT_THEME };
let themeBeforeEdit = { ...DEFAULT_THEME };
let themeOpacity = { ...DEFAULT_THEME_OPACITY };
let themeOpacityBeforeEdit = { ...DEFAULT_THEME_OPACITY };
const DEFAULT_FONT = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
let font = DEFAULT_FONT;
let fontBeforeEdit = DEFAULT_FONT;
let localFontsLoaded = false;
let fontsLoading = false;
let fontName = "", fontNameBeforeEdit = "";
const notificationMarks = new Set();
let notificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
let appHidden = false;
let appFocused = true;
let cardNodes = [];
let indexedData = null;
let commissionIndex = new Map();
let personalIndex = new Map();
let earningsView, moneyForm, projectWorkspace;
let externalChangePending = false;
let lastMinute = -1;
let nextDeadlineCheck = 0;
let lastEarningsCheck = 0;
let notificationPermission = false;
let permissionRequest = null;
const notificationInFlight = new Set();
const notificationRetry = new Map();
const PAGE_SIZE = 50;

// Índices evitam procurar o mesmo projeto repetidamente durante a renderização.
function refreshIndexes() {
  if (indexedData === state.data) return;
  indexedData = state.data;
  commissionIndex = new Map(state.data.commissions.map(item => [item.id, item]));
  personalIndex = new Map(state.data.personalProjects.map(item => [item.id, item]));
  nextDeadlineCheck = 0;
  lastMinute = -1;
}

let viewReleased = false;
let clockTimer = null;
let categories = [];

function categoryLabel(value) {
  return (Object.hasOwn(KINDS, value) ? KINDS[value] : value) || "Sem categoria";
}
function readCategories() {
  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || "[]");
    categories = Array.isArray(saved)
      ? saved.filter((value) => typeof value === "string" && value.trim() && value.length <= 50)
      : [];
  } catch {
    categories = [];
  }
}
function saveCategory(value) {
  const label = value.trim();
  if (!label || Object.values(KINDS).includes(label)) return;
  if (!categories.includes(label)) {
    categories = [...categories, label].sort((a, b) => a.localeCompare(b, "pt-BR"));
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  }
}
function applyListDensity(value) {
  const level = String(Math.round(Math.min(3, Math.max(1, Number(value) || 1))));
  const [name, label] = LIST_DENSITIES[level];
  $("#agenda-section")?.setAttribute("data-list-density", name);
  document.documentElement.dataset.density = name;
  const input = $("#list-density");
  const output = $("#list-density-value");
  if (input) input.value = level;
  if (output) output.textContent = label;
  return level;
}
function readListDensity() {
  let saved = 1;
  try {saved = Number(localStorage.getItem(LIST_DENSITY_KEY));} catch {}
  return Number.isInteger(saved) && saved >= 1 && saved <= 3 ? saved : 1;
}
function allCategories() {
  return [...categories].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
function filterCategories() {
  const current = (state.area === "personal" ? state.data.personalProjects : state.data.commissions).map((item) => categoryLabel(item.kind));
  return [...new Set([...categories, ...current].filter((value) => value !== "Sem categoria"))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}
function renderCategoryOptions() {
  const list = $("#work-categories");
  const filter = $("#kind-filter");
  const option = (label, value = label) => {
    const element = document.createElement("option");
    element.textContent = label;
    element.value = value;
    return element;
  };
  if (list) list.replaceChildren(...allCategories().map((label) => option(label)));
  if (filter) {
    const value = state.kindFilter;
    filter.replaceChildren(option("Todos os tipos", ""), ...filterCategories().map((label) => option(label)));
    filter.value = value;
  }
}
function renderCategoryManager() {
  const list = $("#category-list");
  if (!list) return;
  list.replaceChildren(
    ...allCategories().map((label) => {
      const item = document.createElement("li");
      item.innerHTML = `<span>${escapeHTML(label)}</span><button type="button" class="icon-button" data-category-delete="${escapeHTML(label)}" aria-label="Remover ${escapeHTML(label)}" title="Remover categoria">${icon("close")}</button>`;
      return item;
    }),
  );
  $("#category-empty").hidden = categories.length > 0;
}
function openCategories() {
  renderCategoryManager();
  $("#category-dialog").showModal();
  $("#category-input").focus();
}
function closeCategories() {
  $("#category-dialog").close();
  $("#category-form").reset();
}

function setupSidebarResizer() {bindSidebar({notify: toast});}

function readNotificationMarks() {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTIFICATION_KEY) || "[]");
    if (Array.isArray(saved)) saved.forEach((key) => notificationMarks.add(key));
  } catch {
    // Um histórico inválido não deve impedir o uso da agenda.
  }
}
function markNotification(key) {
  notificationMarks.add(key);
  try {localStorage.setItem(NOTIFICATION_KEY, JSON.stringify([...notificationMarks]));} catch (error) {console.warn("Não foi possível salvar o histórico de avisos:", error);}
}
function readNotificationSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTIFICATION_SETTINGS_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    const amount = Number(saved.amount);
    const unit = saved.unit === "days" ? "days" : saved.unit === "hours" ? "hours" : null;
    const message = typeof saved.message === "string" ? saved.message.trim() : "";
    if (Number.isInteger(amount) && amount >= 1 && amount <= 365 && unit && message && message.length <= 240)
      notificationSettings = { amount, unit, message };
  } catch {
    // Uma configuração inválida volta ao padrão sem bloquear a agenda.
  }
}
function openNotifications() {
  void requestNotificationPermission(true).then(() => {nextDeadlineCheck = 0; restartClock();});
  $("#notification-amount").value = notificationSettings.amount;
  $("#notification-unit").value = notificationSettings.unit;
  $("#notification-message").value = notificationSettings.message;
  $("#notifications-dialog").showModal();
  $("#notification-amount").focus();
}
function closeNotifications() {
  $("#notifications-dialog").close();
}
function notificationLeadTime() {
  return notificationSettings.amount * (notificationSettings.unit === "days" ? 24 : 1) * 60 * 60 * 1000;
}
function notificationBody(item) {
  return notificationSettings.message.replaceAll("{nome}", item.name);
}
async function requestNotificationPermission(request = false) {
  if (permissionRequest) return permissionRequest;
  permissionRequest = (async () => {
    if (isTauri()) {
      notificationPermission = await invoke("plugin:notification|is_permission_granted");
      if (!notificationPermission && request) notificationPermission = await invoke("plugin:notification|request_permission") === "granted";
    } else if (window.Notification) {
      if (request && Notification.permission === "default") await Notification.requestPermission();
      notificationPermission = Notification.permission === "granted";
    }
    return notificationPermission;
  })();
  try {return await permissionRequest;} catch {notificationPermission = false; return false;} finally {permissionRequest = null;}
}
async function sendSystemNotification(options) {
  if (!notificationPermission) return false;
  if (isTauri()) await invoke("send_deadline_notification", options);
  else new Notification(options.title, {body: options.body});
  return true;
}
async function sendDeadlineNotification(item, kind, now) {
  const key = `${item.id}:${item.dueAt}:${kind}:${kind === "custom" ? notificationLeadTime() : 0}`;
  if (notificationMarks.has(key) || notificationInFlight.has(key) || (notificationRetry.get(key) || 0) > now) return;
  const legacy = `${item.id}:${kind}`;
  if (notificationMarks.has(legacy)) {notificationMarks.delete(legacy); markNotification(key); return;}
  notificationInFlight.add(key);
  try {
    const sent = await sendSystemNotification({title: kind === "custom" ? "Entrega se aproxima" : "Hora da entrega", body: kind === "custom" ? notificationBody(item) : `Chegou o horário de entregar “${item.name}”.`});
    if (sent) {markNotification(key); notificationRetry.delete(key);}
    else notificationRetry.set(key, now + 60_000);
  } catch (error) {notificationRetry.set(key, now + 60_000); console.warn("Falha ao enviar aviso:", error);}
  finally {notificationInFlight.delete(key);}
}
function checkDeadlineNotifications(now) {
  if (now < nextDeadlineCheck) return;
  nextDeadlineCheck = now + 60_000;
  if (!notificationPermission) return;
  const lead = notificationLeadTime();
  for (const item of state.data.commissions) {
    if (item.completedAt) continue;
    const due = prepared(item).due;
    if (now < due - lead) nextDeadlineCheck = Math.min(nextDeadlineCheck, due - lead);
    else if (now < due) {void sendDeadlineNotification(item, "custom", now); nextDeadlineCheck = Math.min(nextDeadlineCheck, due);}
    else void sendDeadlineNotification(item, "due", now);
  }
  // Descarta chaves de comissões excluídas ou com novo prazo.
  for (const key of notificationMarks) {
    const item = commissionIndex.get(key.split(":")[0]);
    if (!item || (!key.includes(item.dueAt) && key.split(":").length > 2)) notificationMarks.delete(key);
  }
}

function validColor(value) {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}
function validColorOpacity(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function colorWithOpacity(color, opacity) {
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return opacity >= 1
    ? color
    : `rgb(${red} ${green} ${blue} / ${opacity})`;
}
function applyTheme(values) {
  theme = { ...DEFAULT_THEME, ...values };
  themeOpacity = { ...DEFAULT_THEME_OPACITY, ...themeOpacity };
  for (const [property, value] of Object.entries(theme)) {
    document.documentElement.style.setProperty(
      property,
      colorWithOpacity(value, themeOpacity[property]),
    );
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme["--bg"]);
  $$("[data-theme]").forEach((input) => {
    input.value = theme[input.dataset.theme];
  });
  $$('[data-theme-opacity]').forEach((input) => {
    const property = input.dataset.themeOpacity;
    input.value = String(Math.round(themeOpacity[property] * 100));
    const output = document.querySelector(`[data-opacity-value="${property}"]`);
    if (output) output.textContent = `${input.value}%`;
  });
}
function readTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
    if (!saved || typeof saved !== "object") return { ...DEFAULT_THEME };
    themeOpacity = Object.fromEntries(
      Object.entries(DEFAULT_THEME_OPACITY).map(([key, value]) => [
        key,
        validColorOpacity(saved.opacity?.[key]) ? Number(saved.opacity[key]) : value,
      ]),
    );
    return Object.fromEntries(
      Object.entries(DEFAULT_THEME).map(([key, value]) => [
        key,
        validColor(saved[key]) ? saved[key] : value,
      ]),
    );
  } catch {
    return { ...DEFAULT_THEME };
  }
}
function openTheme() {
  themeBeforeEdit = { ...theme };
  themeOpacityBeforeEdit = { ...themeOpacity };
  applyTheme(theme);
  $("#theme-dialog").showModal();
}
function closeTheme() {
  themeOpacity = { ...themeOpacityBeforeEdit };
  applyTheme(themeBeforeEdit);
  $("#theme-dialog").close();
}
function saveTheme() {
  localStorage.setItem(THEME_KEY, JSON.stringify({ ...theme, opacity: themeOpacity }));
  themeBeforeEdit = { ...theme };
  themeOpacityBeforeEdit = { ...themeOpacity };
  $("#theme-dialog").close();
  toast("Cores salvas neste dispositivo.");
}
function validFont(value) {
  return typeof value === "string" && value.trim().length <= 100 && (!value.trim() || /^[\p{L}\p{M}\p{N} .,'_()-]+$/u.test(value.trim()));
}
function applyFont(value) {
  fontName = validFont(value) ? value.trim() : "";
  font = fontName ? `${JSON.stringify(fontName)}, ${DEFAULT_FONT}` : DEFAULT_FONT;
  document.documentElement.style.setProperty("--font-family", font);
  $("#font-input").value = validFont(value) && value.trim() ? value.trim() : "";
  $("#font-preview").style.fontFamily = font;
}
function readFont() {
  let saved = "";
  try {saved = localStorage.getItem(FONT_KEY) || "";} catch {}
  return validFont(saved) ? saved : "";
}
function openFont() {
  fontBeforeEdit = font;
  fontNameBeforeEdit = fontName;
  $("#font-input").value = fontName;
  $("#font-preview").style.fontFamily = font;
  $("#font-dialog").showModal();
  $("#font-input").focus();
  void loadLocalFonts();
}
async function loadLocalFonts() {
  if (localFontsLoaded || fontsLoading) return;
  fontsLoading = true;
  try {
    const families = await getInstalledFonts();
    $("#installed-fonts").replaceChildren(
      ...families.map((family) => {
        const option = document.createElement("option");
        option.value = family;
        return option;
      }),
    );
    localFontsLoaded = true;
  } catch {
    // O nome continua podendo ser digitado sem permissão para listar fontes.
  } finally {fontsLoading = false;} 
}
function closeFont() {
  applyFont(fontNameBeforeEdit);
  $("#font-dialog").close();
}
function saveFont() {
  const value = $("#font-input").value.trim();
  if (value && !validFont(value)) {
    toast("Digite apenas o nome da fonte instalada no computador.", true);
    return;
  }
  localStorage.setItem(FONT_KEY, value);
  applyFont(value);
  fontBeforeEdit = font;
  fontNameBeforeEdit = fontName;
  $("#font-dialog").close();
  toast("Fonte salva neste dispositivo.");
}

function injectIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
function toast(message, error = false, kind = "") {
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}${kind === "feedback" ? " feedback-notice" : ""}`;
  el.innerHTML = `${icon(error ? "alert" : "checkCircle")}<span>${escapeHTML(message)}</span>`;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), error || kind === "feedback" ? 6500 : 3500);
}
function saveLabel(text, error = false) {
  $("#save-text").textContent = text;
  $("#save-indicator").classList.toggle("error", error);
}
function setBusy(busy) {
  state.busy = busy;
  $("#save-button").disabled = busy;
  $("#confirm-button").disabled = busy;
  $("#confirm-no").disabled = busy;
  $("#confirm-cancel").disabled = busy;
  $("#new-personal-button").disabled = busy || !state.ready;
  $("#delete-button").disabled = busy;
  $("#new-button").disabled = busy || !state.ready;
  $("#profile-button").disabled = busy || !state.profileReady;
  if (!busy && externalChangePending) queueMicrotask(syncExternalChanges);
}
async function persist(commissions, personalProjects = state.data.personalProjects, earnings = state.data.earnings, refresh = true) {
  if (!state.ready) throw new Error("A agenda ainda não está disponível.");
  if (state.busy) throw new Error("Aguarde o salvamento terminar.");
  setBusy(true);
  saveLabel("Salvando…");
  try {
    earnings = capturePayments(earnings, state.data.commissions, commissions);
    const next = validateDataset({ schemaVersion: 1, commissions, personalProjects, ...(earnings ? {earnings} : {}) });
    await state.repo.save(next);
    state.data = next;
    refreshIndexes();
    saveLabel("Tudo salvo neste dispositivo");
    if (refresh) renderAll();
    earningsView?.render();
    restartClock();
  } catch (error) {
    saveLabel("Não foi possível salvar", true);
    if (error.code === "STALE_DATA") throw error;
    throw new Error(
      "Não foi possível salvar. A alteração não foi aplicada. Verifique o espaço e a permissão de gravação e tente novamente.",
      { cause: error },
    );
  } finally {
    setBusy(false);
  }
}

function renderStats(now = Date.now()) {
  const summary = stats(state.data.commissions, now);
  const pendingPayments = state.data.commissions.filter(
    (item) => item.completedAt && !hasReceivedPayment(item),
  ).length;
  setText($("#stat-active"), summary.active);
  setText($("#stat-soon"), summary.soon);
  setText($("#stat-amount"), money(summary.amount));
  setText($("#nav-count"), summary.active);
  setText($("#nav-pending-count"), pendingPayments);
  const note = summary.late
    ? `<span class="late-inline">${summary.late} ${summary.late === 1 ? "prazo precisa" : "prazos precisam"} de atenção</span>`
    : summary.active
      ? "Tudo dentro do prazo. Pode respirar."
      : "Seu próximo projeto começa aqui.";
  if ($("#stat-active-note").innerHTML !== note) $("#stat-active-note").innerHTML = note;
}
function dateMarkup(value) {
  return `<time datetime="${escapeHTML(value)}">${dateText(value, { year: "numeric" })} <span class="hour">· ${hourText(value)}</span></time>`;
}
function completionTimingMarkup(item) {
  if (!item.completedAt) return "";
  const difference = Date.parse(item.dueAt) - Date.parse(item.completedAt);
  if (difference > 0) return `<div class="completion-lead">${icon("clock")}Terminou ${durationLabel(difference)} antes do prazo</div>`;
  if (difference < 0) return `<div class="completion-lead late">${icon("clock")}Terminou ${durationLabel(difference)} depois do prazo</div>`;
  return `<div class="completion-lead">${icon("clock")}Terminou no prazo</div>`;
}
function denseCompletionMarkup(item) {
  if (!item.completedAt) return `<time datetime="${item.dueAt}" title="Prazo: ${dateText(item.dueAt, {year: "numeric"})} ${hourText(item.dueAt)}">${dateText(item.dueAt)} · ${hourText(item.dueAt)}</time>`;
  const difference = Date.parse(item.dueAt) - Date.parse(item.completedAt);
  const timing = difference > 0 ? `Terminou ${durationLabel(difference)} antes` : difference < 0 ? `Terminou ${durationLabel(difference)} depois` : "Terminou no prazo";
  return `<span class="dense-completion">Prazo era ${dateText(item.dueAt)} · ${hourText(item.dueAt)} · ${timing}</span>`;
}
function denseRow(item, personal = false) {
  const status = timing(item), pending = item.completedAt && !hasReceivedPayment(item);
    const action = personal ? "toggle-personal-done" : pending ? "mark-paid" : "toggle-done";
    const label = personal ? (item.completedAt ? "Reabrir projeto" : "Finalizar projeto") : pending ? "Pagamento recebido" : item.completedAt ? "Reabrir comissão" : "Marcar entregue";
  const actionIcon = personal ? (item.completedAt ? "undo" : "check") : item.completedAt && !pending ? "undo" : "check";
  const editButton = `<button class="icon-button" data-action="edit${personal ? "-personal" : ""}" data-id="${item.id}" aria-label="Editar ${escapeHTML(item.name)}" title="Editar">${icon("edit")}</button>`;
  return `<div class="dense-row"><div class="dense-row-head">${projectPhotoMarkup(item, personal)}<h3 title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</h3>${personal ? "" : `<strong class="dense-value" title="${(item.currency && item.currency !== "BRL") ? `≈ ${money(item.amountCents)}` : "Valor combinado"}">${money(item.originalAmountCents ?? item.amountCents, item.currency || "BRL", item.originalAmountDigits ?? 2)}</strong>`}<button class="icon-button" data-action="${action}" data-id="${item.id}" aria-label="${label}: ${escapeHTML(item.name)}" title="${label}">${icon(actionIcon)}</button>${editButton}</div><div class="dense-row-meta"><span class="dense-kind" title="${escapeHTML(categoryLabel(item.kind))}">${escapeHTML(categoryLabel(item.kind))}</span><span class="dense-priority priority-${item.priority}" title="Prioridade ${escapeHTML(PRIORITIES[item.priority])}">${escapeHTML(PRIORITIES[item.priority])}</span>${denseCompletionMarkup(item)}<span class="dense-remaining">${item.completedAt ? (personal ? "Finalizado" : status.label) : status.text}</span></div>${item.completedAt ? "" : `<div class="progress-track" role="progressbar" aria-label="Prazo de ${escapeHTML(item.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(status.percent)}"><span class="progress-fill" style="width:${status.percent.toFixed(2)}%"></span></div>`}</div>`;
}
function cacheCardNodes() {
  cardNodes = [...$("#commission-list").querySelectorAll(".commission-card")].map(card => ({
    card, item: (card.classList.contains("personal-card") ? personalIndex : commissionIndex).get(card.dataset.id),
    pills: [...card.querySelectorAll(".status-pill")], fills: [...card.querySelectorAll(".progress-fill")],
    progresses: [...card.querySelectorAll('[role="progressbar"]')], percent: card.querySelector(".percent-label"),
    remaining: card.querySelector(".time-remaining span"), denseRemaining: card.querySelector(".dense-remaining"),
  }));
}
function projectPhotoMarkup(item, personal = false) {
  const label = item.photo ? "Alterar foto do projeto" : "Adicionar foto ao projeto";
  const image = item.photo ? `<img src="${escapeHTML(item.photo.src)}" alt="" draggable="false">` : icon(personal ? "spark" : item.kind);
  return `<div class="kind-icon-wrap"><button class="kind-icon ${Object.hasOwn(KINDS, item.kind) ? item.kind : "other"}" type="button" data-photo-trigger data-id="${item.id}" data-project-type="${personal ? "personal" : "commission"}" aria-label="${label}" title="${label}">${image}</button><div class="photo-popover" data-photo-menu hidden><strong>Alterar foto?</strong><label class="photo-upload"><span>Escolher do computador</span><input type="file" accept="image/jpeg,image/png,image/webp" data-photo-file data-id="${item.id}" data-project-type="${personal ? "personal" : "commission"}"></label>${item.photo ? `<button type="button" class="photo-remove" data-photo-remove data-id="${item.id}" data-project-type="${personal ? "personal" : "commission"}">Remover foto</button>` : ""}</div></div>`;
}
function pageMarkup(items, personal = false) {
  state.page = Math.min(state.page, Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1));
  const start = state.page * PAGE_SIZE;
  const rows = items.slice(start, start + PAGE_SIZE).map(personal ? personalCardMarkup : cardMarkup).join("");
  return rows + (items.length > PAGE_SIZE ? `<div class="list-pagination"><button class="button secondary" data-action="previous-page" ${state.page ? "" : "disabled"}>Anterior</button><span>${start+1}–${Math.min(start+PAGE_SIZE,items.length)} de ${items.length}</span><button class="button secondary" data-action="next-page" ${start+PAGE_SIZE >= items.length ? "disabled" : ""}>Próxima</button></div>` : "");
}
function cardMarkup(item) {
  const status = timing(item);
  const pendingPayment = item.completedAt && !hasReceivedPayment(item);
  const delivered = !!item.completedAt;
  const deliveryDetails = delivered
    ? `<div class="delivery-details"><div><span class="date-label">ENTREGUE EM</span>${dateMarkup(item.completedAt)}</div><div><span class="date-label">PRAZO ERA</span>${dateMarkup(item.dueAt)}</div></div>${completionTimingMarkup(item)}`
    : `<div class="timeline-dates"><div class="date-block"><span class="date-label">RECEBIDA EM</span>${dateMarkup(item.startAt)}</div><div class="date-block"><span class="date-label">ENTREGAR ATÉ</span>${dateMarkup(item.dueAt)}</div></div>`;
  return `<article class="commission-card" data-id="${item.id}" data-status="${status.key}" tabindex="0" title="${item.completedAt ? "Comissão entregue" : "Duplo clique para abrir o painel"}" aria-label="${escapeHTML(item.name)}">
    ${denseRow(item)}<div class="card-top">${projectPhotoMarkup(item)}<div class="card-title-block"><h3>${escapeHTML(item.name)}</h3><div class="card-meta">${escapeHTML(categoryLabel(item.kind))}${item.client ? `<span class="meta-dot">·</span>${escapeHTML(item.client)}` : ""}</div></div><div class="card-value">${money(item.originalAmountCents ?? item.amountCents, item.currency || "BRL", item.originalAmountDigits ?? 2)}<small>${(item.currency && item.currency !== "BRL") ? `≈ ${money(item.amountCents)}` : "valor combinado"}</small></div></div>
    <span class="priority-badge priority-${item.priority}">${escapeHTML(PRIORITIES[item.priority])}</span>
    ${deliveryDetails}
    ${delivered ? `<div class="delivered-caption">${icon("checkCircle")}Tempo congelado no momento da entrega</div>` : `<div class="progress-track" role="progressbar" aria-label="Tempo decorrido do prazo de ${escapeHTML(item.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(status.percent)}"><span class="progress-fill" style="width:${status.percent}%"></span></div><div class="timeline-caption"><span class="time-remaining">${icon("clock")}<span>${escapeHTML(status.text)}</span></span><span class="percent-label">${Math.floor(status.percent)}% do prazo decorrido</span></div>`}
    ${item.notes ? `<p class="notes-preview">${escapeHTML(item.notes)}</p>` : ""}
    <div class="card-bottom"><span class="status-pill">${status.label}</span><div class="card-actions"><button class="small-action client-feedback-button" data-action="client-feedback" data-id="${item.id}">Feedback do cliente</button><button class="small-action" data-action="share-preview" data-id="${item.id}">Compartilhar prévia</button><button class="small-action" data-action="${pendingPayment ? "mark-paid" : "toggle-done"}" data-id="${item.id}">${icon(pendingPayment ? "check" : item.completedAt ? "undo" : "check")}<span>${pendingPayment ? "Pagamento recebido" : item.completedAt ? "Reabrir comissão" : "Marcar entregue"}</span></button><button class="icon-button" data-action="edit" data-id="${item.id}" aria-label="Editar ${escapeHTML(item.name)}" title="Editar comissão">${icon("edit")}</button></div></div>
    ${previewMarkup()}
  </article>`;
}
function personalCardMarkup(item) {
  const status = timing(item);
  return `<article class="commission-card personal-card" data-id="${item.id}" data-status="${status.key}" tabindex="0" title="Duplo clique para abrir o painel" aria-label="${escapeHTML(item.name)}">
    ${denseRow(item, true)}<div class="card-top">${projectPhotoMarkup(item, true)}<div class="card-title-block"><h3>${escapeHTML(item.name)}</h3><div class="card-meta">${escapeHTML(item.kind || "Projeto pessoal")}</div></div></div>
    <span class="priority-badge priority-${item.priority}">${escapeHTML(PRIORITIES[item.priority])}</span>
    ${item.completedAt ? `<div class="timeline-dates"><div class="date-block"><span class="date-label">FINALIZADO EM</span>${dateMarkup(item.completedAt)}</div><div class="date-block"><span class="date-label">PRAZO ERA</span>${dateMarkup(item.dueAt)}</div></div>${completionTimingMarkup(item)}` : `<div class="timeline-dates"><div class="date-block"><span class="date-label">COMEÇOU EM</span>${dateMarkup(item.startAt)}</div><div class="date-block"><span class="date-label">PRETENDE TERMINAR</span>${dateMarkup(item.dueAt)}</div></div>`}
    ${item.completedAt ? "" : `<div class="progress-track" role="progressbar" aria-label="Tempo decorrido do projeto ${escapeHTML(item.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(status.percent)}"><span class="progress-fill" style="width:${status.percent}%"></span></div><div class="timeline-caption"><span class="time-remaining">${icon("clock")}<span>${escapeHTML(status.text)}</span></span><span class="percent-label">${Math.floor(status.percent)}% do prazo decorrido</span></div>`}
    ${item.notes ? `<p class="notes-preview">${escapeHTML(item.notes)}</p>` : ""}
    <div class="card-bottom"><span class="status-pill">${item.completedAt ? "Finalizado" : status.label}</span><div class="card-actions"><button class="small-action" data-action="toggle-personal-done" data-id="${item.id}">${icon(item.completedAt ? "undo" : "check")}<span>${item.completedAt ? "Reabrir projeto" : "Finalizar projeto"}</span></button><button class="icon-button" data-action="edit-personal" data-id="${item.id}" aria-label="Editar ${escapeHTML(item.name)}" title="Editar projeto pessoal">${icon("edit")}</button></div></div>
  </article>`;
}
function renderList() {
  refreshIndexes();
  cardNodes = [];
  const items = filterItems(state.data.commissions, {
    view: state.view,
    search: state.search,
    sort: state.sort,
    kind: state.kindFilter,
  });
  if (state.area === "personal") {
    const query = state.search.trim().toLocaleLowerCase("pt-BR");
    const personalItems = state.data.personalProjects
      .filter((item) => (state.view === "personal-done" ? !!item.completedAt : !item.completedAt) && (!query || prepared(item).search.includes(query)) && (!state.kindFilter || categoryLabel(item.kind) === state.kindFilter))
      .sort((a, b) => {
        const weights = { low: 1, medium: 2, high: 3 };
        if (state.sort === "recent") return prepared(b).created - prepared(a).created;
        return (state.sort === "priority" ? weights[b.priority] - weights[a.priority] : 0) || prepared(a).due - prepared(b).due;
      });
    $("#breadcrumb-title").textContent = "Projetos pessoais";
    $(".personal-status-filter").hidden = false;
    $("#personal-status-filter").value = state.view === "personal-done" ? "personal-done" : "active";
    $("#list-title").textContent = "Seus projetos pessoais";
    $("#list-count").textContent = `${personalItems.length} ${personalItems.length === 1 ? "projeto" : "projetos"}`;
    $("#commission-list").innerHTML = personalItems.length
      ? pageMarkup(personalItems, true)
      : `<div class="empty-state"><div class="empty-art"><span>${icon("spark")}</span><span>${icon("calendar")}</span></div><h3>Um espaço para suas ideias.</h3><p>Organize projetos que não são comissões, sem cliente ou valor para preencher.</p><button class="button primary" data-action="new-personal">${icon("plus")}Criar projeto pessoal</button></div>`;
    $("#commission-list").setAttribute("aria-busy", "false");
    cacheCardNodes();
    clientFeedback.updateButtons();
    return;
  }
  $("#list-title").textContent =
    state.view === "done"
      ? "Trabalho entregue"
      : state.view === "pending"
        ? "Pagamentos pendentes"
        : "Suas comissões";
  $("#list-count").textContent =
    `${items.length} ${items.length === 1 ? "projeto" : "projetos"}`;
  $$("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#commission-list").setAttribute("aria-busy", "false");
  if (items.length) {
    $("#commission-list").innerHTML = pageMarkup(items);
    cacheCardNodes();
    clientFeedback.updateButtons();
    return;
  }
  const emptyAgenda = state.data.commissions.length === 0;
  const filtered = state.search || state.kindFilter;
  const title = emptyAgenda
    ? "Seu próximo projeto começa aqui."
    : filtered
      ? "Nenhuma comissão por aqui."
      : state.view === "pending"
        ? "Nenhum pagamento pendente."
      : state.view === "done"
        ? "Cada entrega merece seu lugar."
        : "Agenda leve, cabeça livre.";
  const description = emptyAgenda
    ? "Dê um lugar às suas ideias, aos seus clientes e àquela data que você não pode esquecer."
    : filtered
      ? "Nenhum projeto corresponde a esta busca. Você pode limpar os filtros para ver sua agenda."
      : state.view === "pending"
        ? "Quando uma comissão for entregue sem pagamento, ela aparecerá aqui."
      : state.view === "done"
        ? "Ao marcar uma comissão como entregue, ela aparece aqui para você consultar quando quiser."
        : "Você não tem comissões em andamento. Que tal anotar o próximo trabalho?";
  $("#commission-list").innerHTML =
    `<div class="empty-state"><div class="empty-art"><span>${icon("calendar")}</span><span>${icon("logo")}</span><span>${icon("check")}</span></div><h3>${title}</h3><p>${description}</p>${emptyAgenda || (!filtered && state.view !== "done") ? `<button class="button primary" data-action="new">${icon("plus")}${emptyAgenda ? "Criar primeira comissão" : "Nova comissão"}</button>` : `<button class="button secondary" data-action="clear-filters">Ver todas as comissões</button>`}</div>`;
}

function renderNext() {
  let next = null;
  for (const item of state.data.commissions) if (!item.completedAt && (!next || prepared(item).due < prepared(next).due)) next = item;
  if (!next) {
    $("#next-panel").innerHTML =
      `<div class="eyebrow">${icon("spark")}SEU PRÓXIMO PASSO</div><h3>Um novo projeto.<br>Um novo intervalo.</h3><p class="next-subtitle">Quando você adicionar uma comissão, a próxima entrega aparece aqui.</p><button class="next-action" data-action="new">Adicionar comissão ${icon("arrow")}</button>`;
    return;
  }
  const late = Date.parse(next.dueAt) <= Date.now();
  $("#next-panel").innerHTML =
    `<div class="eyebrow">${icon(late ? "alert" : "clock")}${late ? "PRAZO QUE PEDE ATENÇÃO" : "PRÓXIMA ENTREGA"}</div><h3>${escapeHTML(next.name)}</h3><p class="next-subtitle">${dateText(next.dueAt, { month: "long" })} · ${hourText(next.dueAt)}</p><div class="next-countdown"><strong id="next-time" data-id="${next.id}">${durationLabel(Date.parse(next.dueAt) - Date.now())}</strong><span>${late ? "de atraso" : "restantes"}</span></div><button class="next-action" data-action="edit" data-id="${next.id}">Ver comissão ${icon("arrow")}</button>`;
}
function renderNavigation() {
  // Atualiza o item ativo e o título conforme a área/filtro atual.
  $$(".sidebar nav button").forEach((button) => {
    button.classList.remove("active");
    button.removeAttribute("aria-current");
  });
  if (state.area === "personal") {
    $("#breadcrumb-title").textContent = "Projetos pessoais";
    $("#nav-personal").classList.add("active");
    $("#nav-personal").setAttribute("aria-current", "page");
    return;
  }
  $(".personal-status-filter").hidden = true;
  const delivered = state.view === "done";
  const pending = state.view === "pending";
  $("#breadcrumb-title").textContent = pending
    ? "Pagamentos pendentes"
    : delivered
      ? "Entregues"
      : "Visão geral";
  const activeButton = pending ? "#nav-pending" : delivered ? "#nav-delivered" : "#nav-overview";
  $(activeButton).classList.add("active");
  $(activeButton).setAttribute("aria-current", "page");
}
let renderedProfile = null;
function renderProfile() {
  if (renderedProfile === state.profile) return;
  renderedProfile = state.profile;
  const { name, photo } = state.profile;
  $("#profile-name").textContent = name || "Seu nome";
  $("#profile-name").title = name || "Seu nome";
  $("#profile-button").setAttribute(
    "aria-label",
    name ? `Editar perfil de ${name}` : "Personalizar seu perfil",
  );
  const avatar = $("#profile-avatar");
  avatar.textContent = "";
  if (photo) {
    const img = document.createElement("img");
    img.src = photo.src;
    img.alt = "";
    img.style.cssText = imageStyle(photo);
    avatar.append(img);
  } else {
    const letters = initials(name);
    if (letters) avatar.textContent = letters;
    else avatar.innerHTML = icon("user");
  }
}
async function saveProfile(profile) {
  if (!state.profileReady || state.busy)
    throw new Error("Aguarde a agenda ficar disponível.");
  setBusy(true);
  saveLabel("Salvando perfil…");
  try {
    await state.profileRepo.save(profile);
    state.profile = profile;
    renderProfile();
    saveLabel("Tudo salvo neste dispositivo");
  } catch (cause) {
    saveLabel("Não foi possível salvar o perfil", true);
    if (cause.code === "STALE_DATA") throw cause;
    throw new Error(
      "Não foi possível salvar seu perfil. Suas alterações continuam aqui para tentar novamente.",
      { cause },
    );
  } finally {
    setBusy(false);
  }
}
const profileEditor = createProfileEditor({
  getProfile: () => state.profile,
  save: saveProfile,
  isBusy: () => state.busy || !state.profileReady,
  notify: toast,
});
function renderAll() {
  // Ponto único que redesenha a agenda depois de qualquer alteração relevante.
  refreshIndexes();
  earningsView?.render();
  if (appHidden) {viewReleased = true; return;}
  if (projectWorkspace?.active) return;
  viewReleased = false;
  $(".view-tabs").hidden = state.area === "personal";
  $("#sort option[value=value]").hidden = state.area === "personal";
  renderCategoryOptions();
  renderNavigation();
  renderStats();
  renderList();
  renderProfile();
  renderNext();
}

function setAppHidden(hidden) {
  if (appHidden === hidden) return;
  appHidden = hidden;
  document.dispatchEvent(new CustomEvent("dayline:visibility", {detail: {hidden}}));
  document.documentElement.classList.toggle("app-background", hidden || !appFocused);
  if (hidden && state.ready && !viewReleased) {
    $("#commission-list").replaceChildren();
    $("#next-panel").replaceChildren();
    $("#profile-avatar").replaceChildren();
    if (!$("#profile-dialog").open) $("#crop-image").removeAttribute("src");
    cardNodes = []; formatters.clear(); renderedProfile = null; viewReleased = true;
  } else if (!hidden && viewReleased && state.ready) {
    viewReleased = false; renderAll();
  }
  restartClock();
}
let previousDateSignature = "", timezone = "", zoneCheckedAt = -Infinity;
function updateClock() {
  const now = new Date(), ms = now.getTime();
  if (nextDeadlineCheck - ms > 60_000) nextDeadlineCheck = 0;
  if (state.ready) {
    checkDeadlineNotifications(ms);
    if (ms - lastEarningsCheck >= 60_000 || ms < lastEarningsCheck) {lastEarningsCheck = ms; void earningsView?.remind(ms);}
  }
  if (appHidden || projectWorkspace?.active) return;
  if (ms - zoneCheckedAt >= 60_000 || ms < zoneCheckedAt) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone !== zone) {timezone = zone; formatters.clear();}
    zoneCheckedAt = ms;
  }
  const signature = `${localDay(now)}:${timezone}:${now.getTimezoneOffset()}`;
  if (signature !== previousDateSignature) {
    formatters.clear();
    setText($("#sidebar-date"), dateFormatter({day: "2-digit", month: "2-digit", year: "2-digit"}).format(now));
    if (state.ready && previousDateSignature) renderAll();
    previousDateSignature = signature;
  }
  if (!state.ready) return;
  let changedStatus = false;
  for (const {card, item, pills, fills, progresses, percent, remaining, denseRemaining} of cardNodes) {
    if (!item || item.completedAt) continue;
    const status = timing(item, ms);
    if (card.dataset.status !== status.key) {card.dataset.status = status.key; changedStatus = true;}
    for (const pill of pills) setText(pill, status.label);
    const width = `${status.percent.toFixed(2)}%`, integer = String(Math.floor(status.percent));
    for (const fill of fills) if (fill.style.width !== width) fill.style.width = width;
    for (const bar of progresses) if (bar.getAttribute("aria-valuenow") !== integer) bar.setAttribute("aria-valuenow", integer);
    setText(percent, `${integer}% do prazo decorrido`); setText(remaining, status.text); setText(denseRemaining, status.text);
  }
  const minute = Math.floor(ms / 60_000);
  if (lastMinute !== minute || changedStatus) {renderStats(ms); lastMinute = minute;}
  const node = $("#next-time"), item = node && commissionIndex.get(node.dataset.id);
  if (item) {
    const diff = prepared(item).due - ms;
    setText(node, durationLabel(diff)); setText(node.nextElementSibling, diff <= 0 ? "de atraso" : "restantes");
    if (!$("#next-panel .eyebrow").textContent.includes(diff <= 0 ? "PRAZO QUE PEDE ATENÇÃO" : "PRÓXIMA ENTREGA")) renderNext();
  }
}

function clearFormError() {
  $("#form-error").hidden = true;
  $$('[aria-invalid="true"]').forEach((el) =>
    el.removeAttribute("aria-invalid"),
  );
}
function openForm(id = null, personal = false) {
  if (!state.ready || state.busy) return;
  const item = id ? (personal ? state.data.personalProjects : state.data.commissions).find((c) => c.id === id) : null;
  if (id && !item) return;
  state.editingId = item?.id ?? null;
  state.editingPersonal = personal;
  const form = $("#commission-form");
  form.reset();
  clearFormError();
  const now = new Date();
  now.setSeconds(0, 0);
  const due = new Date(now);
  due.setDate(due.getDate() + 7);
  due.setHours(18, 0, 0, 0);
  const values = {
    name: item?.name ?? "",
    client: item?.client ?? "",
    notes: item?.notes ?? "",
    kind: item && !personal ? categoryLabel(item.kind) : "",
    personalKind: item && personal ? item.kind : "",
    amount: item && !personal ? amountInput(item.originalAmountCents ?? item.amountCents, item.originalAmountDigits ?? 2) : "",
    startAt: toLocalInput(item?.startAt ?? now),
    dueAt: toLocalInput(item?.dueAt ?? due),
    priority: item?.priority ?? "medium",
  };
  for (const [key, value] of Object.entries(values))
    form.elements.namedItem(key).value = value;
  $$(".commission-only").forEach((el) => { el.hidden = personal; });
  $(".personal-only").hidden = !personal;
  $("#commission-form [name=amount]").required = !personal;
  $("#start-label").textContent = personal ? "Começou em" : "Recebida em";
  $("#due-label").textContent = personal ? "Pretende terminar em" : "Entregar até";
  $("#form-title").textContent = item ? (personal ? "Editar projeto pessoal" : "Editar comissão") : (personal ? "Novo projeto pessoal" : "Nova comissão");
  $("#save-button").innerHTML =
    `${icon("check")}${item ? "Salvar alterações" : personal ? "Salvar projeto" : "Salvar comissão"}`;
  $("#delete-button").hidden = !item;
  moneyForm.open(item, personal);
  $("#commission-dialog").showModal();
  form.elements.namedItem("name").focus();
}
function closeForm() {
  if (!state.busy) $("#commission-dialog").close();
}
function askConfirm(title, description, label, action, danger = false, cancelAction = null, rejectAction = null) {
  $("#confirm-title").textContent = title;
  $("#confirm-description").textContent = description;
  $("#confirm-button").textContent = label;
  $("#confirm-button").classList.toggle("danger", danger);
  $("#confirm-error").hidden = true;
  state.confirmAction = action;
  state.confirmCancelAction = cancelAction;
  state.confirmRejectAction = rejectAction;
  $("#confirm-no").hidden = !rejectAction;
  $("#confirm-dialog").showModal();
}
function navigate(view) {
  state.area = "commissions";
  state.page = 0;
  state.view = view;
  state.search = "";
  state.kindFilter = "";
  $("#search").value = "";
  $("#kind-filter").value = "";
  renderAll();
}

const clientFeedback = createFeedbackActions({getCommission: id => commissionIndex.get(id), getCommissions: () => state.data.commissions, onNewFeedback: item => {if(item)toast(`O cliente enviou feedback para “${item.name}”. Abra Feedback do cliente para conferir.`, false, "feedback");}});

const actions = {
  ...clientFeedback.actions,
  // MENU VISUAL: novas opções do index.html entram neste mapa usando o mesmo
  // valor de data-action do botão. A função recebe o elemento quando necessário.
  "previous-page": () => {state.page = Math.max(0,state.page-1); renderList();},
  "next-page": () => {state.page++; renderList();},
  new: () => openForm(),
  "new-personal": () => openForm(null, true),
  edit: (el) => openForm(el.dataset.id),
  "edit-personal": (el) => openForm(el.dataset.id, true),
  overview: () => navigate("active"),
  delivered: () => navigate("done"),
  pending: () => navigate("pending"),
  async "toggle-personal-done"(el) {
    const item = state.data.personalProjects.find(project => project.id === el.dataset.id);
    if (!item) return;
    if (item.completedAt) {
      state.view = "active";
      await persist(state.data.commissions, state.data.personalProjects.map(project => project.id === item.id ? {...project, completedAt: null} : project));
      toast("Projeto reaberto.");
      return;
    }
    askConfirm(
      "Finalizar este projeto pessoal?",
      `“${item.name}” ficará oculto em andamento e poderá ser consultado no filtro “Finalizados”.`,
      "Finalizar projeto",
      async () => {
        await persist(state.data.commissions, state.data.personalProjects.map(project => project.id === item.id ? {...project, completedAt: new Date().toISOString()} : project));
        toast("Projeto pessoal finalizado.");
      },
    );
  },
  personal: () => {
    state.area = "personal";
    state.view = "active";
    state.page = 0;
    state.kindFilter = "";
    state.search = "";
    $("#search").value = "";
    renderAll();
  },
  "open-categories": openCategories,
  "open-theme": openTheme,
  "open-font": openFont,
  "open-notifications": openNotifications,
  ...createPreviewActions({getCommission: id => commissionIndex.get(id), toast}),
  "reset-theme": () => {
    applyTheme(DEFAULT_THEME);
    themeOpacity = { ...DEFAULT_THEME_OPACITY };
    applyTheme(DEFAULT_THEME);
  },
  "reset-font": () => applyFont(""),
  "close-form": closeForm,
  "clear-filters": () => navigate("all"),
  reload: () => location.reload(),
  async "cancel-confirm"() {
    if (!state.busy && !state.confirmRunning) {
      $("#confirm-dialog").close();
      const cancelAction = state.confirmCancelAction;
      state.confirmAction = null;
      state.confirmCancelAction = null;
      state.confirmRejectAction = null;
      if (cancelAction) await cancelAction();
      $("#confirm-dialog").close();
    }
  },
  async confirm() {
    if (state.busy || state.confirmRunning || !state.confirmAction) return;
    state.confirmRunning = true;
    const action = state.confirmAction;
    try {
      await action();
      $("#confirm-dialog").close();
      state.confirmAction = null;
      state.confirmCancelAction = null;
      state.confirmRejectAction = null;
    } catch (error) {
      $("#confirm-error").textContent = error.message;
      $("#confirm-error").hidden = false;
    } finally {state.confirmRunning = false;}
  },
  delete() {
    if (state.editingPersonal) {
      const item = state.data.personalProjects.find((c) => c.id === state.editingId);
      if (!item) return;
      askConfirm(
        "Excluir este projeto pessoal?",
        `Excluir “${item.name}” apagará permanentemente o canvas, as anotações e as imagens coladas deste projeto. Esta ação não pode ser desfeita. Arquivos originais de outras pastas do seu computador serão preservados.`,
        "Excluir projeto",
        async () => {
          await deleteProjectCanvas({type:'personal', id:item.id}, () => persist(state.data.commissions, state.data.personalProjects.filter((c) => c.id !== item.id)));
          $("#commission-dialog").close();
          toast("Projeto pessoal excluído.");
        },
        true,
      );
      return;
    }
    const item = state.data.commissions.find((c) => c.id === state.editingId);
    if (!item) return;
    askConfirm(
      "Excluir esta comissão?",
      `Excluir “${item.name}” apagará permanentemente o canvas, as anotações e as imagens coladas desta comissão. Esta ação não pode ser desfeita. Arquivos originais de outras pastas do seu computador serão preservados.`,
      "Excluir comissão",
      async () => {
        await deleteProjectCanvas({type:'commission', id:item.id}, () => persist(state.data.commissions.filter((c) => c.id !== item.id)));
        $("#commission-dialog").close();
        toast("Comissão excluída.");
      },
      true,
    );
  },
  async "toggle-done"(el) {
    const item = state.data.commissions.find((c) => c.id === el.dataset.id);
    if (!item) return;
    if (item.completedAt) {
      await persist(state.data.commissions.map((c) =>
        c.id === item.id ? { ...c, completedAt: null, paidAt: null } : c,
      ));
      toast("Comissão reaberta.");
      return;
    }
    const complete = (paidAt) => persist(state.data.commissions.map((c) =>
      c.id === item.id ? { ...c, completedAt: new Date().toISOString(), paidAt } : c,
    ));
    askConfirm(
      "Você já recebeu o pagamento?",
      `A entrega de “${item.name}” foi concluída. O pagamento já foi recebido?`,
      "Sim, pagamento recebido",
      async () => {
        await complete(new Date().toISOString());
        toast("Comissão entregue e pagamento recebido.");
      },
      false,
      null,
      async () => {
        await complete(null);
        toast("Comissão entregue e movida para pagamentos pendentes.");
      },
    );
  },
  async "mark-paid"(el) {
    const item = state.data.commissions.find((c) => c.id === el.dataset.id);
    if (!item?.completedAt || hasReceivedPayment(item)) return;
    await persist(state.data.commissions.map((c) =>
      c.id === item.id ? { ...c, paidAt: new Date().toISOString() } : c,
    ));
    toast("Pagamento recebido. Comissão finalizada.");
  },
};

actions["reject-confirm"] = async () => {
  if (state.busy || !state.confirmRejectAction) return;
  try {await state.confirmRejectAction();} catch (error) {$("#confirm-error").textContent = error.message; $("#confirm-error").hidden = false; return;}
  $("#confirm-dialog").close();
  state.confirmAction = null;
  state.confirmCancelAction = null;
  state.confirmRejectAction = null;
};

function closePhotoMenus(except = null) {
  document.querySelectorAll("[data-photo-menu]").forEach(menu => {
    if (menu !== except) menu.hidden = true;
  });
}
function projectWithPhoto(id, type, photo) {
  const key = type === "personal" ? "personalProjects" : "commissions";
  const items = state.data[key].map(item => item.id === id ? {...item, photo} : item);
  return type === "personal"
    ? persist(state.data.commissions, items)
    : persist(items, state.data.personalProjects);
}

document.addEventListener("click", async (event) => {
  const photoTrigger = event.target.closest("[data-photo-trigger]");
  if (photoTrigger) {
    event.preventDefault();
    event.stopPropagation();
    const menu = photoTrigger.parentElement.querySelector("[data-photo-menu]");
    const shouldOpen = menu.hidden;
    closePhotoMenus(menu);
    menu.hidden = !shouldOpen;
    return;
  }
  const photoRemove = event.target.closest("[data-photo-remove]");
  if (photoRemove) {
    event.preventDefault();
    closePhotoMenus();
    if (state.busy) return;
    try {
      await projectWithPhoto(photoRemove.dataset.id, photoRemove.dataset.projectType, null);
      toast("Foto removida.");
    } catch (error) {toast(error.message || "Não foi possível remover a foto.", true);}
    return;
  }
  if (!event.target.closest("[data-photo-menu]")) closePhotoMenus();
  const deleteCategory = event.target.closest("[data-category-delete]");
  if (deleteCategory) {
    categories = categories.filter((value) => value !== deleteCategory.dataset.categoryDelete);
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
    renderCategoryManager();
    renderAll();
    return;
  }
  if (event.target.closest("[data-theme-close]")) {
    closeTheme();
    return;
  }
  if (event.target.closest("[data-font-close]")) {
    closeFont();
    return;
  }
  if (event.target.closest("[data-notifications-close]")) {
    closeNotifications();
    return;
  }
  const actionEl = event.target.closest("[data-action]");
  if (actionEl) {
    event.preventDefault();
    if (state.busy) return;
    try {
      await actions[actionEl.dataset.action]?.(actionEl);
    } catch (error) {
      toast(error.message || "Não foi possível concluir a ação.", true);
    }
    return;
  }
  const viewEl = event.target.closest("[data-view]");
  if (viewEl) {
    state.page = 0;
    state.view = viewEl.dataset.view;
    renderAll();
  }
});
document.addEventListener("change", async event => {
  const input = event.target.closest("[data-photo-file]");
  if (!input || !input.files?.[0] || state.busy) return;
  try {
    const photo = await readProfileImage(input.files[0], 360, 0.78);
    await projectWithPhoto(input.dataset.id, input.dataset.projectType, photo);
    closePhotoMenus();
    toast("Foto do projeto atualizada.");
  } catch (error) {toast(error.message || "Não foi possível carregar a foto.", true);}
  finally {input.value = "";}
});
$("#notifications-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = Number($("#notification-amount").value);
  const unit = $("#notification-unit").value;
  const message = $("#notification-message").value.trim();
  if (!Number.isInteger(amount) || amount < 1 || amount > 365 || !["hours", "days"].includes(unit) || !message || message.length > 240) {
    toast("Preencha um prazo e um aviso válido.", true);
    return;
  }
  try {localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify({amount, unit, message}));}
  catch {toast("Não foi possível salvar os avisos. Tente novamente.", true); return;}
  notificationSettings = {amount, unit, message};
  nextDeadlineCheck = 0; restartClock();
  closeNotifications();
  toast("Avisos de prazo salvos neste dispositivo.");
});
$("#theme-form").addEventListener("input", (event) => {
  const input = event.target.closest("[data-theme]");
  if (input && validColor(input.value)) {
    theme[input.dataset.theme] = input.value;
    document.documentElement.style.setProperty(
      input.dataset.theme,
      colorWithOpacity(input.value, themeOpacity[input.dataset.theme]),
    );
  }
  const opacityInput = event.target.closest("[data-theme-opacity]");
  if (opacityInput) {
    const property = opacityInput.dataset.themeOpacity;
    themeOpacity[property] = Number(opacityInput.value) / 100;
    document.documentElement.style.setProperty(
      property,
      colorWithOpacity(theme[property], themeOpacity[property]),
    );
    document.querySelector(`[data-opacity-value="${property}"]`).textContent = `${opacityInput.value}%`;
  }
});
$("#theme-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {saveTheme();} catch {toast("Não foi possível salvar as cores. Tente novamente.", true);}
});
$("#font-form").addEventListener("input", () => {
  void loadLocalFonts();
  const value = $("#font-input").value.trim();
  if (validFont(value) || !value) {
    const preview = value ? `"${value}", ${DEFAULT_FONT}` : DEFAULT_FONT;
    $("#font-preview").style.fontFamily = preview;
  }
});
$("#font-input").addEventListener("pointerdown", () => {
  void loadLocalFonts();
});
$("#font-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {saveFont();} catch {toast("Não foi possível salvar a fonte. Tente novamente.", true);}
});
$("#commission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  clearFormError();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  try {
    const input = Object.fromEntries(new FormData(form));
    if (state.editingPersonal) {
      const existing = state.data.personalProjects.find((c) => c.id === state.editingId) ?? null;
      const item = makePersonalProject({ ...input, kind: input.personalKind }, existing);
      const personalProjects = existing
        ? state.data.personalProjects.map((c) => (c.id === item.id ? item : c))
        : [...state.data.personalProjects, item];
      await persist(state.data.commissions, personalProjects);
      $("#commission-dialog").close();
      toast(existing ? "Alterações salvas." : "Projeto pessoal adicionado.");
      state.area = "personal";
      renderAll();
      return;
    }
    const existing = state.data.commissions.find((c) => c.id === state.editingId) ?? null;
    const item = makeCommission({...input, ...moneyForm.values()}, existing);
    await persist(existing ? state.data.commissions.map((c) => (c.id === item.id ? item : c)) : [...state.data.commissions, item]);
    try {saveCategory(input.kind);} catch {toast("Comissão salva. Não foi possível guardar o tipo nos favoritos.", true);}
    $("#commission-dialog").close();
    toast(
      existing ? "Alterações salvas." : "Comissão adicionada à sua agenda.",
    );
    if (!existing) {
      state.search = "";
      $("#search").value = "";
      state.view = "active";
      renderAll();
    }
  } catch (error) {
    $("#form-error").textContent = error.message;
    $("#form-error").hidden = false;
  }
});
$("#commission-form").addEventListener("input", clearFormError);
$("#search").addEventListener("input", (event) => {
  state.page = 0;
  state.search = event.target.value;
  renderList();
});
$("#kind-filter").addEventListener("change", (event) => {
  state.page = 0;
  state.kindFilter = event.target.value;
  renderList();
});
$("#personal-status-filter").addEventListener("change", (event) => {
  state.page = 0;
  state.view = event.target.value;
  renderList();
});
$("#category-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#category-input");
  const value = input.value.trim();
  if (!value) return;
  if (value.length > 50) {
    toast("O tipo de trabalho pode ter até 50 caracteres.", true);
    return;
  }
  saveCategory(value);
  input.value = "";
  renderCategoryManager();
  renderCategoryOptions();
  toast("Tipo de trabalho salvo.");
});
$("[data-category-close]").addEventListener("click", closeCategories);
$("#sort").addEventListener("change", (event) => {
  state.page = 0;
  state.sort = event.target.value;
  renderList();
});
$("#list-density").addEventListener("input", (event) => {
  const level = applyListDensity(event.target.value);
  try {localStorage.setItem(LIST_DENSITY_KEY, level);} catch {toast("Não foi possível salvar a densidade.", true);}
});
["commission-dialog", "confirm-dialog", "theme-dialog", "font-dialog", "category-dialog"].forEach((id) => {
  $(`#${id}`).addEventListener("cancel", (event) => {
    if (state.confirmRunning) {event.preventDefault(); return;}
    if (state.busy) event.preventDefault();
    if (id === "theme-dialog" && !state.busy) {event.preventDefault(); closeTheme();}
    if (id === "font-dialog" && !state.busy) closeFont();
    if (id === "category-dialog" && !state.busy) closeCategories();
    if (id === "confirm-dialog" && !state.busy) {state.confirmAction = null; state.confirmRejectAction = null; state.confirmCancelAction = null;}
  });
});
document.addEventListener("keydown", (event) => {
  const editingText = /^(INPUT|TEXTAREA|SELECT)$/.test(
    document.activeElement?.tagName,
  );
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "n" &&
    !editingText &&
    !projectWorkspace?.active &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    openForm();
  }
});
window.addEventListener("blur", () => {appFocused = false; document.documentElement.classList.add("app-background"); restartClock();});
window.addEventListener("focus", () => {
  appFocused = true; document.documentElement.classList.remove("app-background");
  restartClock();
  void requestNotificationPermission().then(() => {nextDeadlineCheck = 0;});
  setAppHidden(false);
  updateClock();
});
window.addEventListener("pageshow", () => {
  restartClock();
  setAppHidden(false);
  updateClock();
});
document.addEventListener("visibilitychange", () => {
  setAppHidden(document.hidden);
  if (!document.hidden) updateClock();
});
// Não fecha formulários abertos nem perde eventos recebidos durante uma gravação.
async function syncExternalChanges() {
  if (!externalChangePending || state.busy || !state.ready || document.querySelector("dialog[open]")) return;
  externalChangePending = false;
  try {
    state.data = await state.repo.read();
    if (isTauri()) await invoke('board_recover_deletions');
    if (state.profileReady) state.profile = await state.profileRepo.read();
    renderAll(); restartClock(); toast("Agenda atualizada por outra aba.");
  } catch {
    state.ready = false; setBusy(false);
    $("#error-text").textContent = "Os dados mudaram em outra aba e não puderam ser lidos. Reabra a agenda.";
    $("#error-banner").hidden = false;
  }
}
window.addEventListener("storage", event => {
  if (isTauri()) return;
  if ([STORAGE_KEY, PROFILE_KEY, null].includes(event.key)) {externalChangePending = true; void syncExternalChanges();}
  if (event.key === CATEGORIES_KEY) {readCategories(); renderCategoryOptions();}
  if (event.key === LIST_DENSITY_KEY) applyListDensity(readListDensity());
  if (event.key === THEME_KEY && !$("#theme-dialog").open) applyTheme(readTheme());
  if (event.key === FONT_KEY && !$("#font-dialog").open) applyFont(readFont());
  if (event.key === NOTIFICATION_SETTINGS_KEY) {readNotificationSettings(); nextDeadlineCheck = 0;}
});
for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("close", () => {void syncExternalChanges();});

async function init() {
  injectIcons();
  setupWindowDrag();
  setupWindowControls();
  void setupAutostart();
  moneyForm = bindMoneyForm();
  projectWorkspace = bindProjectWorkspace({getItem: (id, type) => (type === "personal" ? personalIndex : commissionIndex).get(id), canOpen: () => state.ready && !state.busy, onChange: () => {renderAll(); updateClock(); restartClock();}});
  earningsView = bindEarnings({getData: () => state.data, isBusy: () => state.busy || !state.ready, notify: toast, sendNotification: sendSystemNotification, save: (earnings, refresh = true) => persist(state.data.commissions, state.data.personalProjects, earnings, refresh)});
  void requestNotificationPermission(isTauri());
  readCategories();
  applyListDensity(readListDensity());
  applyTheme(readTheme());
  applyFont(readFont());
  setupSidebarResizer();
  readNotificationMarks();
  readNotificationSettings();
  updateClock();
  setBusy(false);
  try {
    state.repo = await openRepository();
    state.data = await state.repo.read();
    if (isTauri()) await invoke('board_recover_deletions');
    state.ready = true;
    saveLabel("Tudo salvo neste dispositivo");
    renderAll();
  } catch (error) {
    console.error("Falha ao abrir a agenda:", error);
    saveLabel("Não foi possível abrir os dados", true);
    $("#error-text").textContent =
      "Não foi possível ler sua agenda. Os dados existentes não foram substituídos. Verifique o acesso aos arquivos ou ao armazenamento do navegador e tente novamente.";
    $("#error-banner").hidden = false;
    $("#commission-list").setAttribute("aria-busy", "false");
    $("#commission-list").innerHTML = "";
  }
  if (state.ready) {
    clientFeedback.start();
    try {
      state.profileRepo = await openProfileRepository();
      state.profile = await state.profileRepo.read();
      state.profileReady = true;
      renderProfile();
    } catch (error) {
      console.error("Falha ao abrir o perfil:", error);
      toast(
        "Não foi possível ler seu perfil. Você ainda pode usar as comissões.",
        true,
      );
    }
  }
  setBusy(false);
  updateClock();
  restartClock();
}

function restartClock() {
  if (clockTimer !== null) clearTimeout(clockTimer);
  const hasActive = state.data.commissions.some(item => !item.completedAt) || state.data.personalProjects.length > 0;
  const interval = appHidden || projectWorkspace?.active ? 60_000 : !appFocused ? 15_000 : hasActive ? 1000 : 60_000;
  const due = nextDeadlineCheck > Date.now() ? nextDeadlineCheck - Date.now() : interval;
  clockTimer = setTimeout(() => {clockTimer = null; updateClock(); restartClock();}, Math.max(50, Math.min(interval, due)));
}
window.addEventListener("pagehide", () => {clearTimeout(clockTimer); clockTimer = null;});
init();
