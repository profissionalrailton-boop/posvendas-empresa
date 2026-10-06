// Sistema Infinity: tela principal que une o Administrativo e o Pós-vendas num menu só.
// Cada sistema continua sendo o mesmo de sempre (e funciona sozinho no endereço dele); aqui ele é
// aberto "encaixado" na área de conteúdo, no mesmo endereço, então o login é compartilhado.
// Cada login só vê os grupos/abas que tem permissão — a trava real continua no banco (RLS).
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const ic = (path) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONES = {
  administrativo: ic('<rect x="2.5" y="6" width="15" height="10.5" rx="2"/><path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6M2.5 10.5h15"/>'),
  posvendas: ic('<path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5z"/><path d="M6.5 8.5h7M6.5 11h4.5"/>'),
  radar: ic('<circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="4"/><path d="M10 10l4.5-4.5"/><circle cx="10" cy="10" r="0.8" fill="currentColor"/>'),
  ranking: ic('<path d="M6.5 3h7v3.5a3.5 3.5 0 0 1-7 0V3z"/><path d="M6.5 4.5H4a2 2 0 0 0 2.6 2.9M13.5 4.5H16a2 2 0 0 1-2.6 2.9M10 10v3.5M7 17h6M8 13.5h4V17H8z"/>'),
  painel: ic('<rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.5"/><rect x="11" y="2.5" width="6.5" height="4" rx="1.5"/><rect x="11" y="8.5" width="6.5" height="9" rx="1.5"/><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5"/>'),
  financeiro: ic('<path d="M10 2.5v15"/><path d="M13.6 5.6c-.6-1-1.9-1.6-3.6-1.6-2.1 0-3.6 1-3.6 2.6 0 3.6 7.3 1.8 7.3 5.4 0 1.6-1.6 2.7-3.7 2.7-1.8 0-3.2-.7-3.9-1.9"/>'),
};

// Menu: grupos e abas. "exige" = permissão necessária (ver descobrirPermissoes).
const GRUPOS = [
  {
    // Painel geral da diretoria (página desta tela, sem iframe — ver painel.js). Só quem tem o financeiro.
    app: "painel", titulo: "Painel geral", exige: "fin", unico: true, nativo: true,
    itens: [{ aba: "painel", label: "Painel geral" }],
  },
  {
    // página única (sem subitens), pública: aparece para todo mundo que tem algum acesso.
    // semProtocolo: o ranking não conversa com o menu; "pronto" = página carregada.
    app: "ranking", titulo: "Ranking da premiação", url: "/ranking/", exige: "qualquer", unico: true, semProtocolo: true,
    itens: [{ aba: "ranking", label: "Ranking da premiação" }],
  },
  {
    // Radar de Oportunidades (Lovable): aberto do endereço dele, para a extensão "Infinity Convert+
    // Bridge" continuar funcionando (ela só atua em *.lovable.app). Visível para quem tem acesso ao
    // pós-vendas (Caio, vendedores e gestão); a equipe só do administrativo não vê.
    app: "radar", titulo: "Radar de Oportunidades", url: "https://infinity-radar-oportunidades.lovable.app", exige: "pos",
    semProtocolo: true, permitir: "clipboard-read; clipboard-write",
    itens: [
      { aba: "inicio", label: "Início", caminho: "/" },
      { aba: "embracon", label: "Radar Embracon", caminho: "/radar-embracon" },
      { aba: "ancora", label: "Radar Âncora", caminho: "/radar-ancora" },
      { aba: "cartas", label: "Cartas contempladas", caminho: "/cartas-contempladas" },
      { aba: "propostas", label: "Propostas selecionadas", caminho: "/propostas-selecionadas" },
    ],
  },
  {
    app: "administrativo", titulo: "Administrativo", url: "/administrativo/", exige: "adm",
    itens: [
      { aba: "clientes", label: "Clientes" },
      { aba: "producao", label: "Produção" },
      { aba: "pendencias", label: "Pendências" },
      { aba: "checagem", label: "Checagem" },
      { aba: "analise", label: "Análise de gravação" },
      { aba: "radar", label: "Cadastro de vendas" },
      { aba: "reincidencia", label: "Reincidência" },
      { aba: "gestao", label: "Gestão" },
      { aba: "vendedores", label: "Vendedores" },
      { aba: "comissao", label: "Mapa de comissão", exige: "comissao" },
    ],
  },
  {
    app: "posvendas", titulo: "Pós-vendas", url: "/posvendas/", exige: "pos",
    itens: [
      { aba: "hoje", label: "Fila de hoje", soPosVendas: true },
      { aba: "clientes", label: "Clientes" },
      { aba: "confirmacoes", label: "Confirmações" },
      { aba: "adimplencia", label: "Adimplência" },
      { aba: "lembretes", label: "Lembretes", soPosVendas: true },
      { aba: "grupos", label: "Grupos e vencimentos", soPosVendas: true },
    ],
  },
  {
    // só quem está em allowed_users (hoje: Railton e Maria Aline)
    app: "financeiro", titulo: "Financeiro", url: "/financeiro/", exige: "fin",
    itens: [
      { aba: "contas", label: "Contas" },
      { aba: "dashboard", label: "Dashboard" },
      { aba: "payroll", label: "Folha de pagamento" },
      { aba: "cards", label: "Cartões de crédito" },
    ],
  },
];

const PREFS_KEY = "infinity-sistema-prefs"; // último item aberto e grupos recolhidos (só conveniência)
let perms = null;          // { adm, comissao, pos: "completo" | "vendedor" | null }
let atual = null;          // { app, aba }
const frames = {};         // app -> { el, pronto, pendente }

// ---------- helpers ----------
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function lerPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch (e) { return {}; } }
function salvarPrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...lerPrefs(), ...p })); } catch (e) { /* sem armazenamento */ } }

// ---------- tema (mesma chave dos dois sistemas) ----------
const THEME_KEY = "infinity-admin-theme";
function currentTheme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
function setTheme(theme) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  if (theme === "light") root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme");
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* só nesta visita */ }
  Object.values(frames).forEach((f) => enviar(f, { tipo: "tema", tema: theme }));
  setTimeout(() => root.classList.remove("theme-transition"), 350);
}
document.querySelectorAll("#theme-toggle, #theme-toggle-auth").forEach((b) => b.addEventListener("click", () => setTheme(currentTheme() === "light" ? "dark" : "light")));

// ---------- login ----------
const authScreen = document.getElementById("auth-screen");
const mainApp = document.getElementById("main-app");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const authNotice = document.getElementById("auth-notice");
const authSubmit = document.getElementById("auth-submit");
let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  authError.classList.add("hidden");
  authNotice.classList.add("hidden");
  const login = mode === "login";
  document.getElementById("auth-title").textContent = login ? "Entrar" : "Criar conta";
  document.getElementById("auth-sub").textContent = login ? "Administrativo e pós-vendas" : "Apenas e-mails autorizados têm acesso aos dados";
  authSubmit.textContent = login ? "Entrar" : "Criar conta";
  document.getElementById("auth-toggle-text").textContent = login ? "Ainda não tem conta?" : "Já tem conta?";
  document.getElementById("auth-toggle-link").textContent = login ? "Criar conta" : "Entrar";
}
document.getElementById("auth-toggle-link").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
function translateAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/already registered/i.test(msg)) return "Este e-mail já possui conta. Tente entrar.";
  if (/password.*at least/i.test(msg)) return "A senha precisa ter pelo menos 6 caracteres.";
  return msg;
}
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authNotice.classList.add("hidden");
  const email = authForm.email.value.trim();
  const password = authForm.password.value;
  authSubmit.disabled = true;
  try {
    if (authMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session === null) {
        authNotice.textContent = "Conta criada. Verifique seu e-mail para confirmar antes de entrar.";
        authNotice.classList.remove("hidden");
      }
    }
  } catch (err) {
    authError.textContent = translateAuthError(err.message);
    authError.classList.remove("hidden");
  } finally {
    authSubmit.disabled = false;
  }
});
document.getElementById("logout-btn").addEventListener("click", () => sb.auth.signOut());

// ---------- trocar senha ----------
const cpOverlay = document.getElementById("change-password-overlay");
const cpForm = document.getElementById("change-password-form");
const cpError = document.getElementById("change-password-error");
document.getElementById("change-password-btn").addEventListener("click", () => { cpForm.reset(); cpError.classList.add("hidden"); cpOverlay.classList.remove("hidden"); });
document.getElementById("change-password-close").addEventListener("click", () => cpOverlay.classList.add("hidden"));
cpOverlay.addEventListener("click", (e) => { if (e.target === cpOverlay) cpOverlay.classList.add("hidden"); });
cpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  cpError.classList.add("hidden");
  if (cpForm.password.value !== cpForm.passwordConfirm.value) {
    cpError.textContent = "As senhas não coincidem.";
    cpError.classList.remove("hidden");
    return;
  }
  const btn = document.getElementById("change-password-submit");
  btn.disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password: cpForm.password.value });
    if (error) { cpError.textContent = error.message; cpError.classList.remove("hidden"); return; }
    cpOverlay.classList.add("hidden");
    showToast("Senha alterada com sucesso.");
  } finally { btn.disabled = false; }
});

let logado = false;
sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    authScreen.classList.add("hidden");
    mainApp.classList.remove("hidden");
    document.getElementById("user-email").textContent = session.user.email;
    if (!logado) { logado = true; iniciar(); }
  } else {
    logado = false;
    perms = null;
    atual = null;
    // derruba os sistemas encaixados (eles também saem pela sessão compartilhada)
    Object.keys(frames).forEach((app) => { frames[app].el.remove(); delete frames[app]; });
    document.getElementById("sx-nav").innerHTML = "";
    document.getElementById("sx-alertas").innerHTML = "";
    document.getElementById("sx-painel").innerHTML = "";
    document.getElementById("sx-painel").classList.add("hidden");
    mainApp.classList.add("hidden");
    authScreen.classList.remove("hidden");
    setAuthMode("login");
    authForm.reset();
  }
});

// ---------- permissões ----------
// Cada consulta só devolve a linha do próprio e-mail (RLS "self read"), então "achou" = tem acesso.
async function temLinha(tabela) {
  const { data, error } = await sb.from(tabela).select("email").limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}
async function descobrirPermissoes() {
  const [adm, comissao, posCompleto, vendedor, fin] = await Promise.all([
    temLinha("admin_allowed_users"),
    temLinha("comissao_acesso"),
    temLinha("posvendas_allowed_users"),
    temLinha("posvendas_vendedor_acesso"),
    temLinha("allowed_users"), // lista de acesso do financeiro
  ]);
  return { adm, comissao, fin, pos: posCompleto ? "completo" : vendedor ? "vendedor" : null };
}
function itensPermitidos(grupo) {
  if (grupo.exige === "adm" && !perms.adm) return [];
  if (grupo.exige === "pos" && !perms.pos) return [];
  if (grupo.exige === "fin" && !perms.fin) return [];
  if (grupo.exige === "qualquer" && !(perms.adm || perms.pos || perms.fin)) return [];
  return grupo.itens.filter((it) => {
    if (it.exige === "comissao" && !perms.comissao) return false;
    if (it.soPosVendas && perms.pos !== "completo") return false;
    return true;
  });
}
function permitido(app, aba) {
  const g = GRUPOS.find((x) => x.app === app);
  return !!g && itensPermitidos(g).some((it) => it.aba === aba);
}

// ---------- menu ----------
function montarMenu() {
  const nav = document.getElementById("sx-nav");
  nav.innerHTML = "";
  const recolhidos = new Set(lerPrefs().recolhidos || []);
  GRUPOS.forEach((g) => {
    const itens = itensPermitidos(g);
    if (!itens.length) return;
    if (g.unico) {
      nav.appendChild(el("div", { class: "sx-bloco" }, [
        el("button", { type: "button", class: "sx-item sx-unico", "data-app": g.app, "data-aba": itens[0].aba, title: g.titulo, onclick: () => abrir(g.app, itens[0].aba) }, [
          el("span", { class: "sx-ic", html: ICONES[g.app] }),
          el("span", { class: "sx-item-texto" }, g.titulo),
        ]),
      ]));
      return;
    }
    const aberto = !recolhidos.has(g.app);
    const lista = el("div", { class: "sx-sub", id: `sx-sub-${g.app}` }, itens.map((it) =>
      el("button", { type: "button", class: "sx-subitem", "data-app": g.app, "data-aba": it.aba, onclick: () => abrir(g.app, it.aba) }, [
        el("span", { class: "sx-bolinha" }), el("span", {}, it.label),
      ])));
    const cab = el("button", { type: "button", class: "sx-item sx-grupo" + (aberto ? " aberto" : ""), "aria-expanded": String(aberto), "aria-controls": `sx-sub-${g.app}` }, [
      el("span", { class: "sx-ic", html: ICONES[g.app] }),
      el("span", { class: "sx-grupo-titulo" }, g.titulo),
      el("span", { class: "sx-seta", "aria-hidden": "true" }, "›"),
    ]);
    if (!aberto) lista.classList.add("fechado");
    cab.addEventListener("click", () => {
      const fechar = !lista.classList.contains("fechado");
      lista.classList.toggle("fechado", fechar);
      cab.classList.toggle("aberto", !fechar);
      cab.setAttribute("aria-expanded", String(!fechar));
      const rec = new Set(lerPrefs().recolhidos || []);
      if (fechar) rec.add(g.app); else rec.delete(g.app);
      salvarPrefs({ recolhidos: [...rec] });
    });
    nav.appendChild(el("div", { class: "sx-bloco" }, [cab, lista]));
  });
}
function marcarAtivo() {
  document.querySelectorAll(".sx-subitem, .sx-unico").forEach((b) => b.classList.toggle("ativo", !!atual && b.dataset.app === atual.app && b.dataset.aba === atual.aba));
  document.querySelectorAll(".sx-grupo").forEach((b) => b.classList.toggle("contem-ativo", !!atual && b.getAttribute("aria-controls") === `sx-sub-${atual.app}`));
  if (atual) {
    const g = GRUPOS.find((x) => x.app === atual.app);
    const it = g.itens.find((x) => x.aba === atual.aba);
    document.getElementById("sx-topbar-titulo").textContent = g.unico ? g.titulo : `${g.titulo} · ${it ? it.label : ""}`;
    document.title = `Infinity | ${it ? it.label : g.titulo}`;
  }
}

// ---------- sistemas encaixados ----------
function enviar(f, msg) { if (f && f.pronto && f.el.contentWindow) f.el.contentWindow.postMessage(msg, location.origin); }
// endereço da página de um item (sistemas sem protocolo, como o Radar, trocam de página pelo endereço)
function urlDoItem(g, aba) {
  const it = g.itens.find((x) => x.aba === aba);
  return it && it.caminho ? new URL(it.caminho, g.url).href : g.url;
}
function garantirFrame(app, aba) {
  if (frames[app]) return frames[app];
  const g = GRUPOS.find((x) => x.app === app);
  const src = aba ? urlDoItem(g, aba) : g.url;
  const iframe = el("iframe", { class: "sx-frame hidden", src, title: g.titulo, allow: g.permitir || null });
  document.getElementById("sx-conteudo").appendChild(iframe);
  frames[app] = { el: iframe, pronto: false, pendente: null, src };
  if (g.semProtocolo) {
    iframe.addEventListener("load", () => {
      frames[app].pronto = true;
      if (atual && atual.app === app) document.getElementById("sx-carregando").classList.add("hidden");
    });
  }
  return frames[app];
}
function abrir(app, aba) {
  if (!permitido(app, aba)) return;
  const g = GRUPOS.find((x) => x.app === app);
  const painel = document.getElementById("sx-painel");
  if (g.nativo) {
    Object.values(frames).forEach((x) => x.el.classList.add("hidden"));
    document.getElementById("sx-carregando").classList.add("hidden");
    painel.classList.remove("hidden");
    if (!painel.childElementCount) carregarPainel();
    atual = { app, aba };
    marcarAtivo();
    fecharMenuCelular();
    return;
  }
  painel.classList.add("hidden");
  const f = garantirFrame(app, aba);
  if (g.semProtocolo) {
    // sem conversa com o menu: troca de página pelo endereço (se o item tiver um caminho próprio)
    const destino = urlDoItem(g, aba);
    if (g.itens.some((x) => x.caminho) && destino !== f.src) { f.src = destino; f.pronto = false; f.el.src = destino; }
  }
  Object.entries(frames).forEach(([nome, x]) => x.el.classList.toggle("hidden", nome !== app));
  document.getElementById("sx-carregando").classList.toggle("hidden", f.pronto);
  if (!g.semProtocolo) { if (f.pronto) enviar(f, { tipo: "abrir-aba", aba }); else f.pendente = aba; }
  atual = { app, aba };
  salvarPrefs({ ultimo: atual });
  marcarAtivo();
  // abre o grupo do item, se estiver recolhido
  const lista = document.getElementById(`sx-sub-${app}`);
  if (lista && lista.classList.contains("fechado")) lista.previousElementSibling.click();
  fecharMenuCelular();
}

window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const app = Object.keys(frames).find((nome) => frames[nome].el.contentWindow === e.source);
  if (!app) return;
  const f = frames[app];
  const m = e.data || {};
  if (m.tipo === "pronto") {
    f.pronto = true;
    enviar(f, { tipo: "tema", tema: currentTheme() });
    if (f.pendente) { enviar(f, { tipo: "abrir-aba", aba: f.pendente }); f.pendente = null; }
    if (atual && atual.app === app) document.getElementById("sx-carregando").classList.add("hidden");
  }
  if (m.tipo === "aba-mudou" && atual && atual.app === app && permitido(app, m.aba)) {
    atual = { app, aba: m.aba };
    salvarPrefs({ ultimo: atual });
    marcarAtivo();
  }
  if (m.tipo === "aviso-lembrete") mostrarAvisoLembrete(m, app);
  if (m.tipo === "testar-som") testarSom(m.silencioso);
});

async function iniciar() {
  document.getElementById("sx-carregando").classList.remove("hidden");
  document.getElementById("sx-sem-acesso").classList.add("hidden");
  perms = await descobrirPermissoes();
  montarMenu();
  const liberados = GRUPOS.map((g) => ({ g, itens: itensPermitidos(g) })).filter((x) => x.itens.length);
  if (!liberados.length) {
    document.getElementById("sx-carregando").classList.add("hidden");
    document.getElementById("sx-sem-acesso").classList.remove("hidden");
    return;
  }
  // o pós-vendas fica carregado em segundo plano para os lembretes tocarem em qualquer aba
  if (perms.pos === "completo") garantirFrame("posvendas");
  // o administrativo também, para os lembretes da checagem
  if (perms.adm) garantirFrame("administrativo");
  const [app, aba] = paginaInicial(liberados);
  abrir(app, aba);
}
// Página principal de cada login (sempre a mesma ao entrar):
// diretoria (financeiro) → Painel geral; vendedor → Radar; pós-vendas → Fila de hoje; administrativo → Clientes.
function paginaInicial(liberados) {
  const opcoes = [];
  if (perms.fin) opcoes.push(["painel", "painel"]);
  if (perms.pos === "vendedor") opcoes.push(["radar", "inicio"]);
  if (perms.pos === "completo" && !perms.adm) opcoes.push(["posvendas", "hoje"]);
  if (perms.adm) opcoes.push(["administrativo", "clientes"]);
  const escolhida = opcoes.find(([app, aba]) => permitido(app, aba));
  if (escolhida) return escolhida;
  const primeiro = liberados.find((x) => !x.g.unico) || liberados[0];
  return [primeiro.g.app, primeiro.itens[0].aba];
}

// ---------- fixar o menu aberto ----------
// Recolhido, o menu mostra só os ícones e abre ao passar o mouse; fixado, fica sempre aberto.
function aplicarFixo(fixo) {
  document.body.classList.toggle("sx-fixo", fixo);
  const btn = document.getElementById("sx-fixar");
  btn.setAttribute("aria-pressed", String(fixo));
  btn.title = fixo ? "Soltar o menu (abre só ao passar o mouse)" : "Fixar o menu aberto";
  btn.setAttribute("aria-label", btn.title);
}
aplicarFixo(!!lerPrefs().fixo);
document.getElementById("sx-fixar").addEventListener("click", () => {
  const fixo = !document.body.classList.contains("sx-fixo");
  aplicarFixo(fixo);
  salvarPrefs({ fixo });
});

// ---------- menu no celular ----------
function fecharMenuCelular() { document.body.classList.remove("sx-menu-aberto"); }
document.getElementById("sx-menu-btn").addEventListener("click", () => document.body.classList.toggle("sx-menu-aberto"));
document.getElementById("sx-fundo-menu").addEventListener("click", fecharMenuCelular);

// ---------- avisos dos lembretes (pós-vendas e checagem do administrativo) ----------
// O som e o alerta ficam aqui na tela principal, porque o pós-vendas pode estar escondido atrás
// do administrativo — e o navegador só libera som na janela onde a pessoa clica.
let audioCtx = null;
function destravarAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) { /* sem suporte a áudio */ }
}
document.addEventListener("click", destravarAudio);
document.addEventListener("keydown", destravarAudio);
function tocarSom() {
  destravarAudio();
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + 0.02;
  [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, atraso]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + atraso);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + atraso + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + atraso + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + atraso);
    osc.stop(t0 + atraso + 0.55);
  });
}
async function testarSom(silencioso) {
  if (silencioso) destravarAudio(); else tocarSom();
  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch (e) { /* opcional */ }
}
function mostrarAvisoLembrete(m, app = "posvendas") {
  tocarSom();
  const card = el("div", { class: "pv-alerta" }, [
    el("div", { class: "pv-alerta-head" }, [el("span", {}, m.rotulo || "🔔 Lembrete"), el("span", { class: "pv-muted" }, m.texto)]),
    el("div", { class: "pv-strong" }, m.titulo),
    m.cliente ? el("div", { class: "pv-muted" }, m.cliente) : null,
    m.descricao ? el("div", { class: "pv-muted" }, m.descricao) : null,
    el("div", { class: "pv-alerta-acoes" }, [
      el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => { card.remove(); enviar(frames[app], { tipo: "concluir-lembrete", id: m.id }); } }, "Concluir"),
      m.podeAdiar ? el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => { card.remove(); enviar(frames[app], { tipo: "adiar-lembrete", id: m.id, min: 10 }); } }, "Adiar 10 min") : null,
      el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => {
        card.remove();
        abrir(app, m.aba || "lembretes");
        if (m.vendaId) enviar(frames[app], { tipo: "abrir-ficha", vendaId: m.vendaId });
      } }, "Abrir"),
      el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => card.remove() }, "Fechar"),
    ]),
  ]);
  document.getElementById("sx-alertas").appendChild(card);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Lembrete ${m.texto}`, { body: m.titulo + (m.cliente ? ` — ${m.cliente}` : ""), icon: "logo.png", tag: `${app}-${m.id}` });
    }
  } catch (e) { /* notificação do sistema é opcional */ }
}
