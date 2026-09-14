// Exercita os fluxos no DOM emulado. Não substitui um teste no WebView2/Windows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { toLocalInput, DAY } from "../src/domain.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/main.js", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  loader: {".svg": "dataurl"},
});
const code = bundle.outputFiles[0].text;
const key = "intervalo.agenda.v1";
async function eventually(check, label) {
  for (let n = 0; n < 80; n++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(check(), label || "A interface não atingiu o estado esperado.");
}
async function app({
  saved = null,
  savedProfile = null,
  brokenWrite = false,
  setup = null,
} = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, {
    url: "https://intervalo.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const w = dom.window;
  Object.defineProperty(w.crypto, "randomUUID", { value: randomUUID });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new w.Event("close"));
  };
  if (saved !== null) w.localStorage.setItem(key, saved);
  if (savedProfile !== null)
    w.localStorage.setItem("intervalo.profile.v1", savedProfile);
  if (brokenWrite)
    w.Storage.prototype.setItem = function () {
      throw new Error("QuotaExceededError");
    };
  if (setup) setup(w);
  w.eval(code);
  await eventually(
    () =>
      w.document.querySelector("#save-text").textContent !==
      "Carregando agenda…",
  );
  if (!w.document.querySelector("#error-banner").hidden) {
    /* A agenda inválida permanece bloqueada. */
  } else
    await eventually(
      () => !w.document.querySelector("#profile-button").disabled,
    );
  const query = (selector) => w.document.querySelector(selector);
  const click = (selector) => {
    assert.ok(query(selector), `Elemento ausente: ${selector}`);
    query(selector).click();
  };
  const field = (name, value) => {
    const el = query(`#commission-form [name="${name}"]`);
    el.value = value;
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const submit = () =>
    query("#commission-form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
  const data = () => JSON.parse(w.localStorage.getItem(key));
  return { dom, w, query, click, field, submit, data, errors };
}
function fillCommission(a, name = "Projeto de teste", amount = "1.234,56") {
  a.click("#new-button");
  a.field("name", name);
  a.field("client", "Cliente fictício");
  a.field("amount", amount);
  a.field("startAt", toLocalInput(Date.now() - 3 * DAY));
  a.field("dueAt", toLocalInput(Date.now() + 2 * DAY));
}

test("commission preview has one action row and routes video selection independently of Supabase", async () => {
  const a = await app({setup(w) {
    w.fetch = async () => {throw new Error("Unexpected network request without Supabase configuration");};
    // jsdom does not implement the browser's top-layer popover API.
    const matches = w.Element.prototype.matches;
    w.Element.prototype.matches = function (selector) {
      return selector === ":popover-open" ? this.hasAttribute("data-test-open") : matches.call(this, selector);
    };
    w.HTMLElement.prototype.showPopover = function () {this.setAttribute("data-test-open", "");};
    w.HTMLElement.prototype.hidePopover = function () {this.removeAttribute("data-test-open");};
  }});
  try {
    fillCommission(a);
    a.submit();
    await eventually(() => a.query(".commission-card"));
    const card = a.query(".commission-card");
    assert.equal(card.querySelectorAll(".card-bottom").length, 1);
    assert.equal(card.querySelectorAll('[data-action="share-preview"]').length, 1);
    a.click('[data-action="share-preview"]');
    assert.equal(a.query("[data-preview-status]").textContent, "");
    a.click('[data-action="generate-preview"]');
    await eventually(() => a.query("[data-preview-status]").textContent.includes("VITE_SUPABASE_URL"));
    assert.equal(a.query('[data-action="copy-preview"]').disabled, true);
    a.click('[data-action="upload-video"]');
    await eventually(() => a.query("[data-video-status]").textContent.includes("aplicativo desktop"));
    assert.equal(a.query('[data-action="upload-video"]').disabled, false);
    assert.equal(card.querySelector('[data-video-file]'), null);
    a.click('[data-action="close-preview"]');
    assert.equal(a.query("[data-preview-popover]").hasAttribute("data-test-open"), false);
    assert.deepEqual(a.errors, []);
  } finally {a.dom.window.close();}
});

const profileKey = "intervalo.profile.v1";
const notificationSettingsKey = "intervalo.notification-settings.v1";
const profileFixture = {
  name: "Nome de exemplo",
  photo: {
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==",
    width: 800,
    height: 400,
    zoom: 1,
    x: 0,
    y: 0,
  },
};
function submitProfile(a) {
  a.query("#profile-form").dispatchEvent(
    new a.w.Event("submit", { bubbles: true, cancelable: true }),
  );
}
test("preferência de aviso salva prazo, unidade e mensagem personalizada", async () => {
  const a = await app();
  try {
    a.click("#notifications-button");
    assert.equal(a.query("#notifications-dialog").open, true);
    a.query("#notification-amount").value = "1";
    a.query("#notification-unit").value = "days";
    a.query("#notification-message").value = "Lembrete: {nome}";
    a.query("#notifications-form").dispatchEvent(
      new a.w.Event("submit", { bubbles: true, cancelable: true }),
    );
    assert.equal(a.query("#notifications-dialog").open, false);
    assert.deepEqual(
      JSON.parse(a.w.localStorage.getItem(notificationSettingsKey)),
      { amount: 1, unit: "days", message: "Lembrete: {nome}" },
    );
    a.click("#notifications-button");
    assert.equal(a.query("#notification-amount").value, "1");
    assert.equal(a.query("#notification-unit").value, "days");
    assert.equal(a.query("#notification-message").value, "Lembrete: {nome}");
  } finally {
    a.dom.window.close();
  }
});
test("nome do perfil salva sem perder comissões e cancelar não aplica as mudanças", async () => {
  const a = await app();
  let reopened;
  try {
    fillCommission(a);
    a.submit();
    await eventually(() => a.query(".commission-card"));
    const agendaBefore = a.w.localStorage.getItem(key);
    a.click("#profile-button");
    a.query("#profile-name-input").value = "Meu estúdio";
    submitProfile(a);
    await eventually(() => !a.query("#profile-dialog").open);
    assert.equal(a.query("#profile-name").textContent, "Meu estúdio");
    assert.equal(a.w.localStorage.getItem(key), agendaBefore);
    reopened = await app({
      saved: agendaBefore,
      savedProfile: a.w.localStorage.getItem(profileKey),
    });
    assert.equal(reopened.query("#profile-name").textContent, "Meu estúdio");
    assert.ok(reopened.query(".commission-card"));
    a.click("#profile-button");
    a.query("#profile-name-input").value = "Descartar";
    a.click("[data-profile-close]");
    assert.equal(
      JSON.parse(a.w.localStorage.getItem(profileKey)).name,
      "Meu estúdio",
    );
    assert.deepEqual(a.errors, []);
  } finally {
    a.dom.window.close();
    reopened?.dom.window.close();
  }
});
test("zoom e posição ficam salvos; reabrir o editor preserva o recorte e remover foto mantém o nome", async () => {
  const a = await app({ savedProfile: JSON.stringify(profileFixture) });
  try {
    a.click("#profile-button");
    for (const [id, value] of [
      ["profile-zoom", "2"],
      ["profile-x", "50"],
      ["profile-y", "-40"],
    ]) {
      a.query(`#${id}`).value = value;
      a.query(`#${id}`).dispatchEvent(new a.w.Event("input"));
    }
    submitProfile(a);
    await eventually(() => !a.query("#profile-dialog").open);
    const saved = JSON.parse(a.w.localStorage.getItem(profileKey));
    assert.equal(saved.photo.zoom, 2);
    assert.equal(saved.photo.x, 0.5);
    assert.equal(saved.photo.y, -0.4);
    const avatarStyle = a.query("#profile-avatar img").style.cssText;
    a.click("#profile-button");
    assert.equal(a.query("#crop-image").style.cssText, avatarStyle);
    assert.equal(a.query("#profile-zoom").value, "2");
    a.click("#reset-photo");
    assert.equal(a.query("#profile-zoom").value, "1");
    a.click("#remove-photo");
    submitProfile(a);
    await eventually(() => !a.query("#profile-dialog").open);
    assert.equal(JSON.parse(a.w.localStorage.getItem(profileKey)).photo, null);
    assert.equal(a.query("#profile-name").textContent, "Nome de exemplo");
    assert.deepEqual(a.errors, []);
  } finally {
    a.dom.window.close();
  }
});
test("falha ao salvar perfil mantém a foto e o nome anteriores e permite corrigir a edição", async () => {
  const before = JSON.stringify(profileFixture);
  const a = await app({ savedProfile: before, brokenWrite: true });
  try {
    a.click("#profile-button");
    a.query("#profile-name-input").value = "Ainda não salvo";
    submitProfile(a);
    await eventually(() => !a.query("#profile-error").hidden);
    assert.equal(a.query("#profile-dialog").open, true);
    assert.equal(a.query("#profile-name-input").value, "Ainda não salvo");
    assert.equal(a.w.localStorage.getItem(profileKey), before);
    assert.equal(a.query("#profile-name").textContent, profileFixture.name);
  } finally {
    a.dom.window.close();
  }
});

test("cadastro, recarregamento, edição, conclusão, reabertura e exclusão pelo formulário", async () => {
  const a = await app();
  let reopened;
  try {
    assert.match(
      a.query(".empty-state").textContent,
      /Criar primeira comissão/,
    );
    fillCommission(a, "Animação <img src=x onerror=alert(1)>");
    a.submit();
    await eventually(() => a.query(".commission-card"));
    assert.equal(a.data().commissions.length, 1);
    assert.equal(a.data().commissions[0].amountCents, 123456);
    assert.equal(
      a.query(".commission-card h3").textContent,
      "Animação <img src=x onerror=alert(1)>",
    );
    assert.equal(
      a.query(".commission-card img"),
      null,
      "O nome deve ser texto, nunca HTML executável.",
    );
    assert.equal(a.query("#commission-dialog").open, false);

    reopened = await app({ saved: a.w.localStorage.getItem(key) });
    assert.equal(
      reopened.query(".commission-card h3").textContent,
      a.query(".commission-card h3").textContent,
    );
    a.click('.commission-card [data-action="edit"]');
    a.field("name", "Projeto editado");
    a.field("amount", "450,50");
    a.submit();
    await eventually(
      () =>
        !a.query("#commission-dialog").open &&
        a.query(".commission-card h3").textContent === "Projeto editado",
    );
    assert.equal(a.data().commissions[0].amountCents, 45050);
    const canvasKey=`dayline.workspace.board.v1:commission:${a.data().commissions[0].id}`;
    a.w.localStorage.setItem(canvasKey,'canvas preservado');
    a.click('.commission-card [data-action="toggle-done"]');
    a.click("#confirm-button");
    await eventually(
      () =>
        !!a.data().commissions[0].completedAt &&
        !a.query(".commission-card") &&
        !a.query("#save-button").disabled,
    );
    assert.equal(a.query("#stat-active").textContent, "0");
    assert.equal(a.w.localStorage.getItem(canvasKey),'canvas preservado','Entregar não remove o canvas');
    a.click("#nav-delivered");
    assert.equal(a.query(".commission-card").dataset.status, "done");
    a.click('.commission-card [data-action="toggle-done"]');
    await eventually(
      () =>
        a.data().commissions[0].completedAt === null &&
        !a.query(".commission-card") &&
        !a.query("#save-button").disabled,
    );
    a.click("#nav-overview");
    a.click('.commission-card [data-action="edit"]');
    a.click("#delete-button");
    assert.equal(a.query("#confirm-dialog").open, true);
    assert.match(a.query('#confirm-description').textContent,/permanentemente o canvas/);
    assert.match(a.query('#confirm-description').textContent,/imagens coladas/);
    assert.equal(a.w.localStorage.getItem(canvasKey),'canvas preservado');
    assert.equal(
      a.data().commissions.length,
      1,
      "Excluir precisa aguardar a confirmação.",
    );
    a.click("#confirm-button");
    await eventually(
      () =>
        a.data().commissions.length === 0 &&
        !a.query("#commission-dialog").open &&
        !a.query("#confirm-dialog").open,
    );
    assert.equal(a.query("#commission-dialog").open, false);
    assert.equal(a.w.localStorage.getItem(canvasKey),null,'Somente a exclusão confirmada remove o canvas');
    assert.deepEqual(a.errors, []);
  } finally {
    a.dom.window.close();
    reopened?.dom.window.close();
  }
});
test("rejeita prazo inválido e mantém a edição aberta quando o armazenamento falha", async () => {
  const a = await app({ brokenWrite: true });
  try {
    fillCommission(a);
    a.field("dueAt", toLocalInput(Date.now() - 4 * DAY));
    a.submit();
    await eventually(() => !a.query("#form-error").hidden);
    assert.match(a.query("#form-error").textContent, /depois do recebimento/);
    a.field("dueAt", toLocalInput(Date.now() + 2 * DAY));
    a.submit();
    await eventually(() =>
      /Não foi possível salvar/.test(a.query("#form-error").textContent),
    );
    assert.equal(a.query("#commission-dialog").open, true);
    assert.equal(
      a.query('#commission-form [name="name"]').value,
      "Projeto de teste",
    );
    assert.equal(a.query("#stat-active").textContent, "0");
    assert.equal(a.w.localStorage.getItem(key), null);
  } finally {
    a.dom.window.close();
  }
});
test("busca filtra as comissões e permite voltar à lista", async () => {
  const a = await app();
  try {
    fillCommission(a, "Motion de teste", "100,00");
    a.submit();
    await eventually(() => a.query(".commission-card"));
    const search = a.query("#search");
    search.value = "não existe";
    search.dispatchEvent(new a.w.Event("input"));
    assert.equal(a.query(".commission-card"), null);
    a.click('[data-action="clear-filters"]');
    assert.ok(a.query(".commission-card"));
    assert.deepEqual(a.errors, []);
  } finally {
    a.dom.window.close();
  }
});
test("agenda ilegível bloqueia alterações sem apagar o conteúdo existente", async () => {
  const saved = "{invalid-json";
  const a = await app({ saved });
  try {
    assert.equal(a.query("#error-banner").hidden, false);
    assert.equal(a.query("#new-button").disabled, true);
    assert.equal(a.query("#profile-button").disabled, true);
    assert.equal(a.w.localStorage.getItem(key), saved);
  } finally {
    a.dom.window.close();
  }
});

const fixture = (changes = {}) => ({id: "fixture", name:"Projeto", client:"Cliente", kind:"video", priority:"medium", notes:"", amountCents:10000, startAt:new Date(Date.now()-DAY).toISOString(), dueAt:new Date(Date.now()+DAY).toISOString(), createdAt:new Date(Date.now()-DAY).toISOString(), completedAt:null, paidAt:null, ...changes});
const savedData = (commissions=[],personalProjects=[],earnings) => JSON.stringify({schemaVersion:1,commissions,personalProjects,...(earnings?{earnings}:{})});
const submitElement = (a,id) => a.query(id).dispatchEvent(new a.w.Event("submit",{bubbles:true,cancelable:true}));

test("ganhos opcionais contabilizam pagamento uma vez e persistem ao reabrir o app",async()=>{
  const a=await app({saved:savedData([fixture()])});let reopened;
  try {
    a.click("#earnings-toggle"); a.query("#earnings-enabled").checked=true; a.query("#earnings-day").value="31";
    submitElement(a,"#earnings-form"); await eventually(()=>a.data().earnings?.enabled && !a.query("#save-button").disabled);
    a.click("[data-earnings-close]"); a.click('.dense-row [data-action="toggle-done"]'); a.click("#confirm-no");
    await eventually(()=>a.data().commissions[0].completedAt && !a.query("#save-button").disabled);
    assert.equal(a.data().earnings.entries.length,0);
    a.click("#nav-pending"); a.click('.dense-row [data-action="mark-paid"]');
    await eventually(()=>a.data().earnings.entries.length===1 && !a.query("#save-button").disabled);
    assert.equal(a.data().earnings.entries[0].amountCents,10000);
    a.click("#nav-delivered"); a.click('.dense-row [data-action="toggle-done"]');
    await eventually(()=>!a.data().commissions[0].completedAt && !a.query("#save-button").disabled);
    a.click("#nav-overview"); a.click('.dense-row [data-action="toggle-done"]'); a.click("#confirm-button");
    await eventually(()=>a.data().commissions[0].paidAt && !a.query("#save-button").disabled);
    assert.equal(a.data().earnings.entries.length,1);
    a.click("#earnings-toggle"); a.query("#earnings-enabled").checked=false; submitElement(a,"#earnings-form");
    await eventually(()=>a.data().earnings.enabled===false && !a.query("#save-button").disabled);
    reopened=await app({saved:a.w.localStorage.getItem(key)});
    assert.equal(reopened.data().earnings.entries.length,1); assert.equal(reopened.data().earnings.enabled,false);
    assert.deepEqual(a.errors,[]);
  }finally{a.w.close();reopened?.w.close();}
});
test("comissão em USD converte com cotação manual e mantém a conversão ao editar",async()=>{
  const a=await app({setup:w=>{w.fetch=async()=>{throw new Error("offline");};}});
  try{
    fillCommission(a,"Vídeo em dólar","100");
    a.field("currency","USD"); a.query('[name=currency]').dispatchEvent(new a.w.Event("change"));
    a.query("#exchange-rate").value="5,25";a.query("#exchange-rate").dispatchEvent(new a.w.Event("input"));
    a.submit();await eventually(()=>a.query(".commission-card"));
    assert.equal(a.data().commissions[0].amountCents,52500);
    assert.equal(a.data().commissions[0].originalAmountCents,10000);
    assert.match(a.query(".dense-value").textContent,/US\$/);
    a.click('.dense-row [data-action="edit"]'); assert.equal(a.query("#exchange-rate").value,"5.25");
    a.field("name","Nome atualizado");a.submit();await eventually(()=>!a.query("#commission-dialog").open);
    assert.equal(a.data().commissions[0].amountCents,52500);assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});
test("painel por duplo clique oculta a agenda e volta com filtros, densidade e dados intactos",async()=>{
  const a=await app({saved:savedData([fixture()]),setup:w=>w.localStorage.setItem("dayline.compact.v1","true")});
  try{
    assert.equal(a.query("#compact-toggle"),null);
    assert.equal(a.query("html").classList.contains("compact-mode"),false);
    a.query("#list-density").value="3";a.query("#list-density").dispatchEvent(new a.w.Event("input"));
    a.query("#search").value="Projeto";a.query("#search").dispatchEvent(new a.w.Event("input"));
    const before=a.w.localStorage.getItem(key);
    a.query(".card-title-block h3").dispatchEvent(new a.w.MouseEvent("dblclick",{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(a.query(".app-shell").hidden,true);assert.equal(a.query(".app-shell").inert,true);
    assert.equal(a.query("#project-workspace").hidden,false);assert.ok(a.query("#workspace-board") || a.query(".workspace-board"));
    assert.equal(a.query("#project-workspace").dataset.projectId,"fixture");
    assert.equal(a.query("#project-workspace").dataset.projectType,"commission");
    assert.equal(a.w.document.activeElement.id,"workspace-back");
    assert.equal(a.w.localStorage.getItem(key),before);
    a.click("#workspace-back");
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(a.query(".app-shell").hidden,false);assert.equal(a.query(".app-shell").inert,false);
    assert.equal(a.query("#project-workspace").hidden,true);assert.equal(a.query("#search").value,"Projeto");
    assert.equal(a.query("#agenda-section").dataset.listDensity,"roomy");
    assert.equal(a.w.document.activeElement.dataset.id,"fixture");
    assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});
test("painel pessoal abre por teclado e comissões entregues continuam com canvas acessível",async()=>{
  const project=fixture({id:"personal",kind:"Estudo"});
  const a=await app({saved:savedData([fixture(),fixture({id:"done",completedAt:new Date().toISOString(),paidAt:new Date().toISOString()})],[project])});
  try{
    a.query('.dense-row [data-action="edit"]').dispatchEvent(new a.w.MouseEvent("dblclick",{bubbles:true}));
    assert.equal(a.query("#project-workspace").hidden,true);
    a.click("#nav-delivered");a.query(".commission-card").dispatchEvent(new a.w.MouseEvent("dblclick",{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,30)); assert.equal(a.query("#project-workspace").hidden,false);
    a.click('#workspace-back'); await new Promise(resolve=>setTimeout(resolve,30));
    a.click("#nav-personal");a.query(".personal-card").dispatchEvent(new a.w.KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(a.query("#project-workspace").dataset.projectType,"personal");
    Object.defineProperty(a.w.document,"hidden",{configurable:true,value:true});a.w.document.dispatchEvent(new a.w.Event("visibilitychange"));
    Object.defineProperty(a.w.document,"hidden",{configurable:true,value:false});a.w.document.dispatchEvent(new a.w.Event("visibilitychange"));
    assert.equal(a.query("#project-workspace").hidden,false);
    a.query("#workspace-back").dispatchEvent(new a.w.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(a.query(".app-shell").hidden,false);assert.ok(a.query(".personal-card"));
    assert.equal(a.query("#nav-personal").classList.contains("active"),true);assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});
test("paginação limita o DOM e a busca encontra registros fora da página",async()=>{
  const items=Array.from({length:120},(_,i)=>fixture({id:`row-${i}`,name:`Comissão ${String(i).padStart(3,"0")}`}));
  const a=await app({saved:savedData(items)});
  try{
    assert.equal(a.w.document.querySelectorAll(".commission-card").length,50);
    a.click('[data-action="next-page"]');assert.equal(a.w.document.querySelectorAll(".commission-card").length,50);
    a.query("#search").value="Comissão 119";a.query("#search").dispatchEvent(new a.w.Event("input"));
    assert.equal(a.w.document.querySelectorAll(".commission-card").length,1);assert.equal(a.query(".commission-card").dataset.id,"row-119");
    assert.equal(a.data().commissions.length,120);
  }finally{a.w.close();}
});
test("barras pessoais atualizam e ficar oculto libera os cartões sem apagar os dados",async()=>{
  const project=fixture({id:"personal",kind:"Estudo"});delete project.amountCents;delete project.client;delete project.paidAt;delete project.completedAt;
  const timers=[];
  const a=await app({saved:savedData([], [project]),setup:w=>{
    const original=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>{timers.push(delay);return original(fn,delay,...args);};
  }});
  try{
    a.click("#nav-personal");
    const before=Number(a.query('[role=progressbar]').getAttribute("aria-valuenow"));
    a.w.Date.now=()=>Date.now()+DAY/2;
    // O relógio é recalculado a partir de Date, não por contagem de ticks.
    const NativeDate=a.w.Date;const offset=DAY/2;
    a.w.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[Date.now()+offset]));}static now(){return Date.now()+offset;}};
    a.w.dispatchEvent(new a.w.Event("focus"));
    assert.ok(Number(a.query('[role=progressbar]').getAttribute("aria-valuenow"))>before);
    Object.defineProperty(a.w.document,"hidden",{configurable:true,value:true});a.w.document.dispatchEvent(new a.w.Event("visibilitychange"));
    assert.equal(a.query(".commission-card"),null);assert.equal(a.data().personalProjects.length,1);
    assert.ok(timers.at(-1)>=15000);
    Object.defineProperty(a.w.document,"hidden",{configurable:true,value:false});a.w.document.dispatchEvent(new a.w.Event("visibilitychange"));
    assert.ok(a.query(".personal-card"));assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});
test("cor do aviso de feedback salva, reabre e cancela alterações",async()=>{
  const a=await app();let saved;
  try{
    a.click('#theme-button');
    const color=a.query('[data-theme="--feedback-notification"]');
    color.value='#ff8800';color.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    a.query('#theme-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));
    saved=a.w.localStorage.getItem('intervalo.theme.v1');
    assert.equal(JSON.parse(saved)['--feedback-notification'],'#ff8800');
  }finally{a.w.close();}
  const b=await app({setup:w=>w.localStorage.setItem('intervalo.theme.v1',saved)});
  try{
    assert.equal(b.query('html').style.getPropertyValue('--feedback-notification'),'#ff8800');
    b.click('#theme-button');
    const color=b.query('[data-theme="--feedback-notification"]');color.value='#0000ff';color.dispatchEvent(new b.w.Event('input',{bubbles:true}));
    b.query('#theme-dialog').dispatchEvent(new b.w.Event('cancel',{cancelable:true}));
    assert.equal(b.query('html').style.getPropertyValue('--feedback-notification'),'#ff8800');
    assert.equal(b.w.localStorage.getItem('intervalo.theme.v1'),saved);
  }finally{b.w.close();}
});

test("Esc descarta as cores e as opacidades sem alterar o tema salvo",async()=>{
  const a=await app();
  try{
    a.click("#theme-button");const input=a.query('[data-theme-opacity="--bg"]');input.value="25";input.dispatchEvent(new a.w.Event("input",{bubbles:true}));
    assert.match(a.query("html").style.getPropertyValue("--bg"),/0.25/);
    a.query("#theme-dialog").dispatchEvent(new a.w.Event("cancel",{cancelable:true}));
    assert.equal(a.query("html").style.getPropertyValue("--bg"),"#101310");assert.equal(a.w.localStorage.getItem("intervalo.theme.v1"),null);
  }finally{a.w.close();}
});
test("tipo personalizado não injeta HTML e filtros antigos usam o nome visível",async()=>{
  const a=await app({saved:savedData([fixture(),fixture({id:"custom",kind:'"><img src=x onerror=alert(1)>'})])});
  try{
    assert.equal(a.query(".commission-card img"),null);
    a.query("#kind-filter").value="Edição de vídeo";a.query("#kind-filter").dispatchEvent(new a.w.Event("change"));
    assert.equal(a.w.document.querySelectorAll(".commission-card").length,1);assert.equal(a.query(".commission-card").dataset.id,"fixture");
  }finally{a.w.close();}
});
test("janela nativa envia arraste, restaura pela bandeja e conclui fechamento com destroy",async()=>{
  const commands=[],callbacks=new Map(),listeners=new Map(),store=new Map([["agenda",JSON.parse(savedData([fixture()]))]]);
  let sequence=0;
  const a=await app({setup:w=>{
    w.isTauri=true;
    w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:"main"},currentWebview:{label:"main"}},
      transformCallback:fn=>{const id=++sequence;callbacks.set(id,fn);return id;},
      unregisterCallback:id=>callbacks.delete(id),
      invoke:async(cmd,args)=>{
        commands.push([cmd,args]);
        if(cmd==="plugin:event|listen"){listeners.set(args.event,args.handler);return args.handler;}
        if(cmd==="plugin:store|load")return 1;
        if(cmd==="plugin:store|get")return [store.get(args.key),store.has(args.key)];
        if(cmd==="plugin:store|set"){store.set(args.key,args.value);return;}
        if(cmd==="plugin:notification|is_permission_granted")return false;
        if(cmd==="plugin:notification|request_permission")return "denied";
        if(cmd==="plugin:autostart|is_enabled")return false;
        if(cmd==="plugin:window|inner_size")return {width:1100,height:640};
        if(cmd==="plugin:window|scale_factor")return 1;
        if(cmd==="plugin:window|is_visible")return true;
        if(cmd==="plugin:window|is_minimized")return false;
        if(cmd==="plugin:window|close")await callbacks.get(listeners.get("tauri://close-requested"))?.({event:"tauri://close-requested",id:1,payload:null});
      }};
  }});
  try{
    a.query("[data-window-drag]").dispatchEvent(new a.w.MouseEvent("mousedown",{button:0,bubbles:true}));
    assert.ok(commands.some(([cmd])=>cmd==="plugin:window|start_dragging"));
    const before=commands.filter(([cmd])=>cmd==="plugin:window|start_dragging").length;
    a.query("[data-window-close]").dispatchEvent(new a.w.MouseEvent("mousedown",{button:0,bubbles:true}));
    assert.equal(commands.filter(([cmd])=>cmd==="plugin:window|start_dragging").length,before);
    a.click("[data-window-minimize]");await eventually(()=>!a.query(".commission-card"));
    await callbacks.get(listeners.get("dayline-visibility"))({payload:true});assert.ok(a.query(".commission-card"));
    a.query(".commission-card").dispatchEvent(new a.w.MouseEvent("dblclick",{bubbles:true}));
    a.query("#project-workspace [data-window-drag]").dispatchEvent(new a.w.MouseEvent("mousedown",{button:0,bubbles:true}));
    assert.ok(commands.filter(([cmd])=>cmd==="plugin:window|start_dragging").length>before);
    a.click("#project-workspace [data-window-minimize]");await eventually(()=>a.query("html").classList.contains("app-background"));
    await callbacks.get(listeners.get("dayline-visibility"))({payload:true});
    assert.equal(a.query("#project-workspace").hidden,false);
    a.click("[data-window-close]");await eventually(()=>commands.some(([cmd])=>cmd==="plugin:window|destroy"));
    const capability=JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json",import.meta.url),"utf8"));
    for(const command of ["start-dragging","hide","close","destroy"])assert.ok(capability.permissions.includes(`core:window:allow-${command}`));
    assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});

const marketResponse = (code, bid, at=Date.now()) => ({ok:true,json:async()=>({[`${code}BRL`]:{code,codein:"BRL",bid:String(bid),ask:String(bid),timestamp:String(Math.floor(at/1000))}})});
function selectCurrency(a, code) {a.field("currency",code);a.query('[name="currency"]').dispatchEvent(new a.w.Event("change"));}
function addCurrency(a, code) {
  selectCurrency(a,"__add");
  assert.equal(a.query("#currency-picker").hidden,false);
  a.query("#currency-search").value=code;a.query("#currency-search").dispatchEvent(new a.w.Event("input"));
  a.query("#currency-options").value=code;a.click("#confirm-currency");
}
test("atualizar cotação faz nova consulta, muda a conversão e preserva o valor se a rede falhar",async()=>{
  let bid=5.1, calls=0, offline=false;
  const a=await app({setup:w=>{w.fetch=async(url,options)=>{
    calls++;assert.equal(options.cache,"no-store");if(offline)throw new Error("offline");return marketResponse("USD",bid);
  };}});
  try{
    fillCommission(a,"Valor atualizado","100");selectCurrency(a,"USD");
    await eventually(()=>a.query("#exchange-rate").value==="5.1"&&!a.query("#refresh-exchange").disabled);
    assert.match(a.query("#exchange-preview").textContent,/510,00/);
    bid=5.24;a.click("#refresh-exchange");
    await eventually(()=>a.query("#exchange-rate").value==="5.24"&&!a.query("#refresh-exchange").disabled);
    assert.equal(calls,2);assert.match(a.query("#exchange-preview").textContent,/524,00/);
    assert.match(a.query("#exchange-status").textContent,/AwesomeAPI/);assert.match(a.query("#exchange-checked").textContent,/Consultado às/);
    offline=true;a.click("#refresh-exchange");await eventually(()=>!a.query("#refresh-exchange").disabled);
    assert.equal(a.query("#exchange-rate").value,"5.24");assert.match(a.query("#exchange-status").textContent,/Não foi possível atualizar/);
    a.submit();await eventually(()=>a.query(".commission-card"));
    assert.equal(a.data().commissions[0].amountCents,52400);assert.ok(a.data().commissions[0].exchangeTimestamp);
    assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});
test("adicionar EUR funciona no formulário, nos ganhos e ao reabrir a agenda",async()=>{
  const a=await app({setup:w=>{w.fetch=async url=>marketResponse(url.includes("EUR-BRL")?"EUR":"USD",6);}});let reopened;
  try{
    fillCommission(a,"Comissão europeia","100");addCurrency(a,"EUR");
    await eventually(()=>a.query("#exchange-rate").value==="6");
    assert.equal(a.query('[name="currency"]').value,"EUR");assert.match(a.query("#exchange-rate-label").textContent,/1 EUR/);
    assert.match(a.query("#exchange-preview").textContent,/600,00/);
    a.submit();await eventually(()=>a.query(".commission-card"));
    assert.equal(a.data().commissions[0].currency,"EUR");assert.equal(a.data().commissions[0].amountCents,60000);
    a.click("#earnings-toggle");a.query("#earnings-enabled").checked=true;submitElement(a,"#earnings-form");
    await eventually(()=>a.data().earnings?.enabled&&!a.query("#save-button").disabled);a.click("[data-earnings-close]");
    a.click('.dense-row [data-action="toggle-done"]');a.click("#confirm-button");
    await eventually(()=>a.data().earnings.entries.length===1);
    assert.equal(a.data().earnings.entries[0].currency,"EUR");assert.equal(a.data().earnings.entries[0].amountCents,60000);
    reopened=await app({saved:a.w.localStorage.getItem(key)});
    reopened.click("#nav-delivered");reopened.click('.dense-row [data-action="edit"]');
    assert.equal(reopened.query('[name="currency"]').value,"EUR");assert.equal(reopened.query("#exchange-rate").value,"6");
    assert.deepEqual(a.errors,[]);assert.deepEqual(reopened.errors,[]);
  }finally{a.w.close();reopened?.w.close();}
});
test("resposta atrasada de USD não sobrescreve outra moeda nem a cotação manual",async()=>{
  let release;
  const a=await app({setup:w=>{w.fetch=async url=>url.includes("USD-BRL")?new Promise(resolve=>{release=resolve;}):marketResponse("EUR",6);}});
  try{
    fillCommission(a,"Várias moedas","20");selectCurrency(a,"USD");
    await eventually(()=>!!release);addCurrency(a,"EUR");await eventually(()=>a.query("#exchange-rate").value==="6");
    a.query("#exchange-rate").value="6,25";a.query("#exchange-rate").dispatchEvent(new a.w.Event("input"));
    release(marketResponse("USD",5.2));await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(a.query('[name="currency"]').value,"EUR");assert.equal(a.query("#exchange-rate").value,"6,25");
    a.submit();await eventually(()=>a.query(".commission-card"));assert.equal(a.data().commissions[0].amountCents,12500);
    assert.equal(a.data().commissions[0].exchangeSource,"manual");assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});
test("JPY sem centavos e KWD com três decimais mantêm valor correto ao editar",async()=>{
  const a=await app({setup:w=>{w.fetch=async url=>url.includes("JPY-BRL")?marketResponse("JPY",0.035):marketResponse("KWD",16.5);}});
  try{
    fillCommission(a,"Iene","1000");addCurrency(a,"JPY");await eventually(()=>a.query("#exchange-rate").value==="0.035");
    a.submit();await eventually(()=>a.query(".commission-card"));assert.equal(a.data().commissions[0].amountCents,3500);
    a.click('.dense-row [data-action="edit"]');assert.equal(a.query('[name="amount"]').value,"1000");
    a.submit();await eventually(()=>!a.query("#commission-dialog").open);
    fillCommission(a,"Dinar","1,234");addCurrency(a,"KWD");await eventually(()=>a.query("#exchange-rate").value==="16.5");
    a.submit();await eventually(()=>a.data().commissions.length===2 && !a.query("#commission-dialog").open && !a.query("#save-button").disabled);
    const kwd=a.data().commissions.find(item=>item.currency==="KWD");assert.equal(kwd.amountCents,2036);assert.equal(kwd.originalAmountDigits,3);
    a.query(`.commission-card[data-id="${kwd.id}"] [data-action="edit"]`).click();assert.equal(a.query('[name="amount"]').value,"1,234");
    a.submit();await eventually(()=>!a.query("#commission-dialog").open);assert.equal(a.data().commissions.find(item=>item.id===kwd.id).amountCents,2036);
    assert.deepEqual(a.errors,[]);
  }finally{a.w.close();}
});
