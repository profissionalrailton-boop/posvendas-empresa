const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const ESTORNO_ATE_PARCELA = 5;       // atraso até essa parcela = risco de estorno de comissão
const DIAS_PROXIMOS = 5;             // "vencem nos próximos X dias" na fila de hoje
const HORIZONTE_DIAS = 180;          // até quando gerar parcelas futuras na ficha
const AGING = [
  { label: "1 a 5 dias", min: 1, max: 5 },
  { label: "6 a 15 dias", min: 6, max: 15 },
  { label: "16 a 30 dias", min: 16, max: 30 },
  { label: "31 a 60 dias", min: 31, max: 60 },
  { label: "Mais de 60 dias", min: 61, max: Infinity },
];

let state = {
  session: null,
  authMode: "login",
  activeTab: "hoje",
  hasAccess: false,
  vendas: [],
  grupos: new Map(),      // "adm|grupo" -> dia_vencimento
  cobranca: new Map(),    // venda_id -> posvendas_cobranca
  pagamentos: new Map(),  // venda_id -> Map(numero -> pagamento)
  lances: new Map(),      // venda_id -> Map(numero -> oferta de lance feita)
  comissaoAte: new Map(), // venda_id -> { ate_parcela, recebido_em } (mapa de comissão do administrativo)
  pagasAdm: new Map(),    // venda_id -> Map(numero -> pagamento vindo do administrativo), calculado em recalcular()
  lancesOk: true,         // false se a tabela posvendas_lances ainda não existir
  clientesInicio: 2,      // primeira parcela mostrada na grade da aba Clientes
  producaoMes: (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })(), // abas Clientes e Confirmações
  lembretes: [],
  promessas: [],          // anotações do tipo promessa ainda não resolvidas
  situacoes: new Map(),   // venda_id -> resultado de calcSituacao
  fichaId: null,
  filters: {
    clientes: { search: "", adm: "", vendedor: "", situacao: "" },
    confirmacoes: { search: "", adm: "", vendedor: "" },
    adimplencia: { adm: "", vendedor: "" },
  },
};

// ---------- tema claro/escuro (mesma chave do administrativo) ----------
const THEME_KEY = "infinity-admin-theme";
function currentTheme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
function setTheme(theme, save) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  if (theme === "light") root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme");
  if (save) { try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* sem armazenamento: só vale nesta visita */ } }
  const next = theme === "light" ? "escuro" : "claro";
  document.querySelectorAll("#theme-toggle, #theme-toggle-auth").forEach((b) => { b.title = "Mudar para o tema " + next; });
  setTimeout(() => root.classList.remove("theme-transition"), 350);
}
document.querySelectorAll("#theme-toggle, #theme-toggle-auth").forEach((b) => {
  b.title = "Mudar para o tema " + (currentTheme() === "light" ? "escuro" : "claro");
  b.addEventListener("click", () => setTheme(currentTheme() === "light" ? "dark" : "light", true));
});

// ---------- helpers ----------
// Datas sempre no fuso local (toISOString() vira o dia seguinte depois das 21h no Brasil).
function parseDate(s) { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function diffDays(a, b) { return Math.round((a - b) / 86400000); }
function lastDayOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function fmtMoney(n) { return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtPct(n) { return n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`; }
function formatDateBR(s) {
  if (!s) return "—";
  const d = typeof s === "string" ? parseDate(s) : s;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function formatDateTimeBR(s) {
  const d = new Date(s);
  return `${formatDateBR(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function grupoKey(adm, grupo) { return `${adm}|${grupo}`; }
function normalizaGrupo(g) { return String(g).trim().replace(/^0+(?=.)/, ""); }
function pct(parte, total) { return total ? (parte / total) * 100 : null; }
function userEmail() { return state.session?.user?.email || null; }

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}
function emptyState(msg) { return el("div", { class: "empty-state" }, msg); }

async function fetchAllRows(build) {
  const pageSize = 1000;
  let all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
  }
  return all;
}

// ---------- regras de parcela ----------
// Parcela n vence no mês do primeiro vencimento + (n - primeira parcela acompanhada),
// no dia de vencimento do grupo (ou no dia do primeiro vencimento, se o grupo ainda não tiver dia).
function diaVencimento(venda, cob) {
  return state.grupos.get(grupoKey(venda.administradora, venda.grupo)) ?? parseDate(cob.primeiro_vencimento).getDate();
}
function vencimentoParcela(venda, cob, numero) {
  const base = parseDate(cob.primeiro_vencimento);
  const mes = new Date(base.getFullYear(), base.getMonth() + (numero - cob.primeira_parcela_numero), 1);
  const dia = Math.min(diaVencimento(venda, cob), lastDayOfMonth(mes.getFullYear(), mes.getMonth()));
  return new Date(mes.getFullYear(), mes.getMonth(), dia);
}
function gerarParcelas(venda, cob, ate) {
  const pagos = new Map([...(state.pagasAdm.get(venda.id) || []), ...(state.pagamentos.get(venda.id) || [])]);
  const hoje = today();
  const lista = [];
  for (let n = cob.primeira_parcela_numero; n < cob.primeira_parcela_numero + 400; n++) {
    if (cob.prazo && n > cob.prazo) break;
    const venc = vencimentoParcela(venda, cob, n);
    if (venc > ate && !pagos.has(n)) break;
    const pagamento = pagos.get(n) || null;
    const atraso = pagamento ? 0 : Math.max(0, diffDays(hoje, venc));
    lista.push({ numero: n, venc, pagamento, atraso, status: pagamento ? "pago" : atraso > 0 ? "atraso" : diffDays(venc, hoje) === 0 ? "hoje" : "aberto" });
  }
  return lista;
}
// Sem cobrança salva, usa a estimada pelo cadastro (valor = demais_parcelas, dia = dia do grupo).
// Só fica "sem_cobranca" quando o grupo ainda não tem dia de vencimento.
function cobrancaEstimada(venda) {
  if (!state.grupos.has(grupoKey(venda.administradora, venda.grupo))) return null;
  const s = sugestaoCobranca(venda);
  return { ...s, valor_parcela: venda.demais_parcelas ?? null, prazo: null, observacao: null, estimada: true };
}
function calcSituacao(venda) {
  const cob = state.cobranca.get(venda.id) || cobrancaEstimada(venda);
  if (!cob) return { status: "sem_cobranca", parcelas: [], atrasadas: [] };
  const parcelas = gerarParcelas(venda, cob, addDays(today(), HORIZONTE_DIAS));
  if (!cob.ativo) return { status: "inativo", cob, parcelas, atrasadas: [] };
  const atrasadas = parcelas.filter((p) => p.status === "atraso");
  const proxima = parcelas.find((p) => p.status === "hoje" || p.status === "aberto") || null;
  const valorParcela = Number(cob.valor_parcela) || 0;
  return {
    status: atrasadas.length ? "atraso" : "em_dia",
    cob,
    parcelas,
    atrasadas,
    proxima,
    maxAtraso: atrasadas.length ? Math.max(...atrasadas.map((p) => p.atraso)) : 0,
    valorAtraso: atrasadas.length * valorParcela,
    riscoEstorno: atrasadas.some((p) => p.numero <= ESTORNO_ATE_PARCELA),
  };
}
// Parcelas que já chegam pagas do administrativo:
//  - a 1ª, paga na adesão;
//  - as antecipadas (meses antecipados do cadastro);
//  - tudo até a última parcela marcada no mapa de comissão (comissão da N caiu = cliente pagou até a N).
function calcPagasAdm(v) {
  const m = new Map();
  m.set(1, { pago_em: v.data_venda, origem: "adesao" });
  const meses = v.parcela_antecipada ? Number(v.meses_antecipados) || 0 : 0;
  for (let n = 2; n <= 1 + meses; n++) m.set(n, { pago_em: v.data_venda, origem: "antecipada" });
  const com = state.comissaoAte.get(v.id);
  if (com) for (let n = 2; n <= com.ate_parcela; n++) if (!m.has(n)) m.set(n, { pago_em: com.recebido_em, origem: "administrativo" });
  return m;
}
function ultimaPagaAdm(v) { return Math.max(...state.pagasAdm.get(v.id).keys()); }
function pagamentoDe(v, n) { return state.pagamentos.get(v.id)?.get(n) || state.pagasAdm.get(v.id)?.get(n) || null; }
const ORIGEM_LABEL = { adesao: "Paga na adesão", antecipada: "Antecipada na venda", administrativo: "Paga — informado pelo administrativo" };

function recalcular() {
  state.pagasAdm = new Map(state.vendas.map((v) => [v.id, calcPagasAdm(v)]));
  state.situacoes = new Map(state.vendas.map((v) => [v.id, calcSituacao(v)]));
}
function sit(v) { return state.situacoes.get(v.id); }

const SITUACAO_LABEL = { atraso: "Em atraso", em_dia: "Em dia", sem_cobranca: "Grupo sem dia de vencimento", inativo: "Cancelada/quitada" };
function situacaoTag(s) {
  const txt = s.status === "atraso" ? `${s.atrasadas.length} em atraso · ${s.maxAtraso}d` : SITUACAO_LABEL[s.status];
  return el("span", { class: `pv-tag ${s.status}` }, txt);
}
function adminBadge(adm) { return el("span", { class: `admin-badge ${adm}` }, adm); }

// ---------- auth ----------
const authScreen = document.getElementById("auth-screen");
const mainApp = document.getElementById("main-app");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const authNotice = document.getElementById("auth-notice");
const authTitle = document.getElementById("auth-title");
const authSub = document.getElementById("auth-sub");
const authSubmit = document.getElementById("auth-submit");
const authToggleText = document.getElementById("auth-toggle-text");
const authToggleLink = document.getElementById("auth-toggle-link");

function setAuthMode(mode) {
  state.authMode = mode;
  authError.classList.add("hidden");
  authNotice.classList.add("hidden");
  if (mode === "login") {
    authTitle.textContent = "Entrar";
    authSub.textContent = "Pós-vendas e adimplência";
    authSubmit.textContent = "Entrar";
    authToggleText.textContent = "Ainda não tem conta?";
    authToggleLink.textContent = "Criar conta";
  } else {
    authTitle.textContent = "Criar conta";
    authSub.textContent = "Apenas e-mails autorizados têm acesso aos dados";
    authSubmit.textContent = "Criar conta";
    authToggleText.textContent = "Já tem conta?";
    authToggleLink.textContent = "Entrar";
  }
}
authToggleLink.addEventListener("click", () => setAuthMode(state.authMode === "login" ? "signup" : "login"));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authNotice.classList.add("hidden");
  const email = authForm.email.value.trim();
  const password = authForm.password.value;
  authSubmit.disabled = true;
  try {
    if (state.authMode === "login") {
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

function translateAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/already registered/i.test(msg)) return "Este e-mail já possui conta. Tente entrar.";
  if (/password.*at least/i.test(msg)) return "A senha precisa ter pelo menos 6 caracteres.";
  return msg;
}

document.getElementById("logout-btn").addEventListener("click", () => sb.auth.signOut());

// ---------- change password ----------
const changePasswordOverlay = document.getElementById("change-password-overlay");
const changePasswordForm = document.getElementById("change-password-form");
const changePasswordError = document.getElementById("change-password-error");
const changePasswordSubmit = document.getElementById("change-password-submit");

document.getElementById("change-password-btn").addEventListener("click", () => {
  changePasswordForm.reset();
  changePasswordError.classList.add("hidden");
  changePasswordOverlay.classList.remove("hidden");
});
document.getElementById("change-password-close").addEventListener("click", () => changePasswordOverlay.classList.add("hidden"));
changePasswordOverlay.addEventListener("click", (e) => {
  if (e.target.id === "change-password-overlay") e.target.classList.add("hidden");
});
changePasswordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  changePasswordError.classList.add("hidden");
  const password = changePasswordForm.password.value;
  if (password !== changePasswordForm.passwordConfirm.value) {
    changePasswordError.textContent = "As senhas não coincidem.";
    changePasswordError.classList.remove("hidden");
    return;
  }
  changePasswordSubmit.disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      changePasswordError.textContent = error.message;
      changePasswordError.classList.remove("hidden");
      return;
    }
    changePasswordOverlay.classList.add("hidden");
    showToast("Senha alterada com sucesso.");
  } finally {
    changePasswordSubmit.disabled = false;
  }
});

sb.auth.onAuthStateChange((_event, session) => {
  const wasLogged = !!state.session;
  state.session = session;
  if (session) {
    authScreen.classList.add("hidden");
    mainApp.classList.remove("hidden");
    document.getElementById("user-email").textContent = session.user.email;
    if (!wasLogged) loadAll();
  } else {
    mainApp.classList.add("hidden");
    authScreen.classList.remove("hidden");
    setAuthMode("login");
    authForm.reset();
  }
});

// ---------- tabs ----------
const TABS = ["hoje", "clientes", "confirmacoes", "adimplencia", "lembretes", "grupos"];
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.activeTab = btn.dataset.tab;
    renderActiveTab();
  });
});
function renderActiveTab() {
  TABS.forEach((t) => document.getElementById("tab-" + t).classList.toggle("hidden", !state.hasAccess || state.activeTab !== t));
  document.getElementById("no-access").classList.toggle("hidden", state.hasAccess);
  document.getElementById("month-nav-wrap").classList.toggle("hidden", !state.hasAccess || !["clientes", "confirmacoes"].includes(state.activeTab));
  if (!state.hasAccess) return;
  renderMonthNav();
  ({ hoje: renderHoje, clientes: renderClientes, confirmacoes: renderConfirmacoes, adimplencia: renderAdimplencia, lembretes: renderLembretes, grupos: renderGrupos })[state.activeTab]();
}

// ---------- mês de produção ----------
function mesKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function daProducao(v) { return v.data_venda.slice(0, 7) === mesKey(state.producaoMes); }
function primeiroMesProducao() {
  if (!state.vendas.length) return state.producaoMes;
  const min = state.vendas.reduce((m, v) => (v.data_venda < m ? v.data_venda : m), state.vendas[0].data_venda);
  const d = parseDate(min);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function renderMonthNav() {
  const m = state.producaoMes;
  document.getElementById("month-label").textContent = `${MONTH_NAMES[m.getMonth()]} ${m.getFullYear()}`;
  document.getElementById("prev-month").disabled = m <= primeiroMesProducao();
}
function mudarMes(delta) {
  const m = state.producaoMes;
  state.producaoMes = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  state.clientesInicio = 2;
  renderActiveTab();
}
document.getElementById("prev-month").addEventListener("click", () => { if (!document.getElementById("prev-month").disabled) mudarMes(-1); });
document.getElementById("next-month").addEventListener("click", () => mudarMes(1));

// ---------- data loading ----------
async function loadAll() {
  const { data: acesso } = await sb.from("posvendas_allowed_users").select("email").limit(1);
  state.hasAccess = Array.isArray(acesso) && acesso.length > 0;
  if (!state.hasAccess) { renderActiveTab(); return; }
  try {
    const [vendas, grupos, cobranca, pagamentos, lembretes, promessas] = await Promise.all([
      fetchAllRows(() => sb.from("administrativo_vendas")
        .select("id, cliente, vendedor, administradora, grupo, cota, numero_contrato, numero_contato, email, cpf, valor_venda, data_venda, data_assembleia, tipo_plano, tabela, parcelinha, parcela_antecipada, meses_antecipados, primeira_parcela, demais_parcelas")
        .order("cliente")),
      fetchAllRows(() => sb.from("posvendas_grupos").select("administradora, grupo, dia_vencimento").order("grupo")),
      fetchAllRows(() => sb.from("posvendas_cobranca").select("*").order("venda_id")),
      fetchAllRows(() => sb.from("posvendas_pagamentos").select("venda_id, numero, pago_em, valor").order("venda_id").order("numero")),
      fetchAllRows(() => sb.from("posvendas_lembretes").select("*")
        .or(`concluido_em.is.null,concluido_em.gte.${isoDate(addDays(today(), -30))}`)
        .order("data").order("id")),
      fetchAllRows(() => sb.from("posvendas_anotacoes").select("*").eq("tipo", "promessa").is("resolvido_em", null).order("promessa_data").order("id")),
    ]);
    // O administrativo grava alguns grupos com zeros à esquerda ("000540") e outros sem ("540"):
    // aqui tudo vira o mesmo grupo, sem zeros.
    vendas.forEach((v) => { if (v.grupo) v.grupo = normalizaGrupo(v.grupo); });
    state.vendas = vendas;
    state.grupos = new Map(grupos.map((g) => [grupoKey(g.administradora, normalizaGrupo(g.grupo)), g.dia_vencimento]));
    state.cobranca = new Map(cobranca.map((c) => [c.venda_id, c]));
    state.pagamentos = new Map();
    pagamentos.forEach((p) => {
      if (!state.pagamentos.has(p.venda_id)) state.pagamentos.set(p.venda_id, new Map());
      state.pagamentos.get(p.venda_id).set(p.numero, p);
    });
    state.lembretes = lembretes;
    state.promessas = promessas;
    await Promise.all([loadLances(), loadPagasAdministrativo()]);
    recalcular();
    populateFilterOptions();
    renderActiveTab();
    if (state.fichaId) renderFicha();
  } catch (err) {
    showToast("Erro ao carregar os dados: " + err.message);
  }
}
async function loadLances() {
  state.lances = new Map();
  try {
    const rows = await fetchAllRows(() => sb.from("posvendas_lances").select("venda_id, numero, feito_em").order("venda_id").order("numero"));
    rows.forEach((l) => {
      if (!state.lances.has(l.venda_id)) state.lances.set(l.venda_id, new Map());
      state.lances.get(l.venda_id).set(l.numero, l);
    });
    state.lancesOk = true;
  } catch (err) {
    state.lancesOk = false; // tabela ainda não criada: a grade mostra os checkboxes de lance desativados
  }
}
async function loadPagasAdministrativo() {
  const { data, error } = await sb.rpc("posvendas_pagas_administrativo");
  // sem a função no banco, segue só com adesão + meses antecipados do cadastro
  state.comissaoAte = new Map(error ? [] : (data || []).map((r) => [r.venda_id, r]));
}
function refreshViews() {
  recalcular();
  renderActiveTab();
  if (state.fichaId) renderFicha();
}

function uniqueSorted(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")); }
function fillSelect(select, values, firstLabel) {
  const current = select.value;
  select.innerHTML = "";
  select.appendChild(el("option", { value: "" }, firstLabel));
  values.forEach((v) => select.appendChild(el("option", { value: v }, v)));
  if (values.includes(current)) select.value = current;
}
function populateFilterOptions() {
  const adms = uniqueSorted(state.vendas.map((v) => v.administradora));
  const vendedores = uniqueSorted(state.vendas.map((v) => v.vendedor));
  fillSelect(document.getElementById("cli-adm"), adms, "Todas as administradoras");
  fillSelect(document.getElementById("adi-adm"), adms, "Todas as administradoras");
  fillSelect(document.getElementById("conf-adm"), adms, "Todas as administradoras");
  fillSelect(document.getElementById("cli-vendedor"), vendedores, "Todos os vendedores");
  fillSelect(document.getElementById("conf-vendedor"), vendedores, "Todos os vendedores");
  fillSelect(document.getElementById("adi-vendedor"), vendedores, "Todos os vendedores");
  const lembreteCliente = document.getElementById("lembrete-cliente");
  const cur = lembreteCliente.value;
  lembreteCliente.innerHTML = "";
  lembreteCliente.appendChild(el("option", { value: "" }, "Sem vínculo com um cliente"));
  state.vendas.forEach((v) => lembreteCliente.appendChild(el("option", { value: v.id }, `${v.cliente} — ${v.administradora} ${v.grupo || ""}/${v.cota || ""}`)));
  lembreteCliente.value = cur;
}

// ---------- linhas de lista reutilizáveis ----------
function clienteRow(v, detalhe, extra = []) {
  return el("div", { class: "pend-client-row pv-row" }, [
    el("button", { type: "button", class: "pv-link pend-client-name", onclick: () => openFicha(v.id) }, v.cliente),
    adminBadge(v.administradora),
    el("span", { class: "pend-client-missing" }, detalhe),
    ...extra,
  ]);
}
function vendaById(id) { return state.vendas.find((v) => v.id === id); }

// ---------- HOJE ----------
function renderHoje() {
  const hoje = today();
  document.getElementById("hoje-data").textContent = formatDateBR(hoje);
  const ativos = state.vendas.filter((v) => ["atraso", "em_dia"].includes(sit(v).status));
  const atrasados = ativos.filter((v) => sit(v).status === "atraso");
  const lembretesHoje = state.lembretes.filter((l) => !l.concluido_em && parseDate(l.data) <= hoje);
  const proximos = [];
  ativos.forEach((v) => sit(v).parcelas.forEach((p) => {
    if (p.pagamento) return;
    const d = diffDays(p.venc, hoje);
    if (d >= 0 && d <= DIAS_PROXIMOS) proximos.push({ v, p, d });
  }));
  proximos.sort((a, b) => a.d - b.d);

  document.getElementById("hoje-sum-atraso").textContent = atrasados.length;
  document.getElementById("hoje-sum-hoje").textContent = proximos.filter((x) => x.d === 0).length;
  document.getElementById("hoje-sum-lembretes").textContent = lembretesHoje.length;
  document.getElementById("hoje-sum-adimp").textContent = fmtPct(pct(ativos.length - atrasados.length, ativos.length));

  const baixaBtn = (v, p) => el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => darBaixa(v, p.numero, isoDate(today())) }, `Baixa ${p.numero}ª hoje`);

  fillList("hoje-proximos", proximos, "Nada vencendo nos próximos dias.", ({ v, p, d }) =>
    clienteRow(v, `${p.numero}ª parcela · vence ${d === 0 ? "hoje" : d === 1 ? "amanhã" : "em " + d + " dias"} (${formatDateBR(p.venc)}) · ${fmtMoney(Number(sit(v).cob.valor_parcela))}`,
      [baixaBtn(v, p)]));
  fillList("hoje-lembretes", lembretesHoje, "Nenhum lembrete para hoje.", (l) => lembreteRow(l));
}
function fillList(id, items, emptyMsg, render) {
  const box = document.getElementById(id);
  box.innerHTML = "";
  const nodes = items.map(render).filter(Boolean);
  if (!nodes.length) box.appendChild(emptyState(emptyMsg));
  else nodes.forEach((n) => box.appendChild(n));
}

// ---------- CLIENTES ----------
["cli-search", "cli-adm", "cli-vendedor", "cli-situacao"].forEach((id) => {
  document.getElementById(id).addEventListener(id === "cli-search" ? "input" : "change", () => {
    state.filters.clientes = {
      search: document.getElementById("cli-search").value,
      adm: document.getElementById("cli-adm").value,
      vendedor: document.getElementById("cli-vendedor").value,
      situacao: document.getElementById("cli-situacao").value,
    };
    renderClientes();
  });
});
function renderClientes() {
  const { search, adm, vendedor, situacao } = state.filters.clientes;
  const q = search.trim().toLowerCase();
  const doMes = state.vendas.filter(daProducao);
  const list = doMes.filter((v) => {
    if (adm && v.administradora !== adm) return false;
    if (vendedor && v.vendedor !== vendedor) return false;
    if (situacao && sit(v).status !== situacao) return false;
    if (q && !`${v.cliente} ${v.numero_contrato || ""} ${v.grupo || ""} ${v.cota || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  // ordem: dia de vencimento (VENC do grupo); mesmo dia, por nome; sem dia de vencimento no final
  const diaDe = (v) => state.grupos.get(grupoKey(v.administradora, v.grupo)) ?? 99;
  list.sort((a, b) => diaDe(a) - diaDe(b) || a.cliente.localeCompare(b.cliente, "pt-BR"));
  document.getElementById("clientes-count").textContent = list.length === doMes.length
    ? `${doMes.length} cliente${doMes.length === 1 ? "" : "s"} na produção`
    : `${list.length} de ${doMes.length} clientes na produção`;

  // Grade no formato da planilha: cliente – VENC, grupo/cota, e para cada parcela a baixa + oferta de lance.
  const inicio = state.clientesInicio;
  const numeros = Array.from({ length: CLIENTES_COLUNAS }, (_, i) => inicio + i);
  document.getElementById("cli-col-label").textContent = `${numeros[0]}ª a ${numeros[numeros.length - 1]}ª`;
  document.getElementById("cli-prev").disabled = inicio <= 2;
  const thead = document.getElementById("clientes-thead");
  thead.innerHTML = "";
  thead.appendChild(el("tr", {}, [
    el("th", {}, "Cliente"), el("th", {}, "Grupo / cota"), el("th", {}, "Parcela"),
    ...numeros.flatMap((n) => [el("th", { class: "pv-grid-parc" }, `${n}ª`), el("th", { class: "pv-grid-lance" }, "Lance")]),
  ]));

  const tbody = document.getElementById("clientes-tbody");
  tbody.innerHTML = "";
  if (!list.length) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: String(3 + CLIENTES_COLUNAS * 2) }, [emptyState(doMes.length ? "Nenhum cliente com os filtros atuais." : "Nenhuma venda nesse mês.")])]));
    return;
  }
  const hoje = today();
  list.forEach((v) => {
    const s = sit(v);
    const tr = el("tr", {}, [
      el("td", { class: "pv-grid-nome" }, [
        el("div", { class: "pv-nome-linha" }, [
          el("span", { class: `pv-adimp ${s.status}`, title: adimplenciaTitulo(s), "aria-label": adimplenciaTitulo(s) }),
          el("button", { type: "button", class: "pv-link pend-client-name", onclick: () => openFicha(v.id) }, v.cliente),
        ]),
        el("div", { class: "pv-muted" }, [adminBadge(v.administradora), ` ${v.vendedor}`]),
      ]),
      el("td", { class: "pv-strong pv-nowrap" }, `${v.grupo || "—"}/${v.cota || "—"}`),
      el("td", { class: "pv-nowrap" }, (s.cob?.valor_parcela ?? v.demais_parcelas) != null ? fmtMoney(Number(s.cob?.valor_parcela ?? v.demais_parcelas)) : "—"),
    ]);
    numeros.forEach((n) => {
      tr.appendChild(el("td", { class: "pv-grid-parc" }, [parcelaCelula(v, s, n, hoje)]));
      const lance = state.lances.get(v.id)?.get(n);
      const box = el("input", {
        type: "checkbox",
        class: "com-check",
        disabled: state.lancesOk && s.cob ? null : "disabled",
        title: !state.lancesOk ? "Oferta de lance ainda não disponível" : lance ? `Lance ofertado em ${formatDateBR(lance.feito_em)}` : `Marcar oferta de lance da ${n}ª parcela`,
        "aria-label": `Oferta de lance da ${n}ª parcela de ${v.cliente}`,
      });
      box.checked = !!lance;
      box.addEventListener("change", () => toggleLance(v, n, box));
      tr.appendChild(el("td", { class: "pv-grid-lance" }, [box]));
    });
    tbody.appendChild(tr);
  });
}

const CLIENTES_COLUNAS = 4;
document.getElementById("cli-prev").addEventListener("click", () => {
  state.clientesInicio = Math.max(2, state.clientesInicio - CLIENTES_COLUNAS);
  renderClientes();
});
document.getElementById("cli-next").addEventListener("click", () => {
  state.clientesInicio += CLIENTES_COLUNAS;
  renderClientes();
});

function adimplenciaTitulo(s) {
  if (s.status === "em_dia") return "Adimplente";
  if (s.status === "atraso") return `Inadimplente — ${s.atrasadas.length} parcela${s.atrasadas.length > 1 ? "s" : ""} em atraso, ${s.maxAtraso} dia${s.maxAtraso > 1 ? "s" : ""}`;
  return SITUACAO_LABEL[s.status];
}

function parcelaCelula(v, s, n, hoje) {
  const cob = s.cob;
  const pago = state.pagamentos.get(v.id)?.get(n);
  const adm = state.pagasAdm.get(v.id)?.get(n);
  if (!pago && adm) {
    // já chega paga do administrativo: não precisa de baixa, só da oferta de lance
    const txt = { adesao: "Adesão", antecipada: "Antecipada", administrativo: "Paga" }[adm.origem];
    return el("span", { class: "pv-cell pago adm", title: ORIGEM_LABEL[adm.origem] }, [txt, el("span", { class: "pv-ic ok" }, "✓")]);
  }
  if (!cob) return el("span", { class: "pv-cell na", title: "Grupo sem dia de vencimento" }, "—");
  if (!pago && n < cob.primeira_parcela_numero) return el("span", { class: "pv-cell na", title: "Antes da primeira parcela acompanhada" }, "—");
  if (cob.prazo && n > cob.prazo) return el("span", { class: "pv-cell na", title: "Fora do prazo do plano" }, "—");
  const venc = vencimentoParcela(v, cob, n);
  let cls, conteudo, title;
  if (pago) {
    cls = "pago"; conteudo = [formatDateBR(pago.pago_em), el("span", { class: "pv-ic ok" }, "✓")];
    title = `Paga em ${formatDateBR(pago.pago_em)} · vencimento ${formatDateBR(venc)}`;
  } else if (!cob.ativo) {
    cls = "na"; conteudo = "—"; title = "Cota cancelada/quitada";
  } else if (venc < hoje) {
    cls = "atraso"; conteudo = ["NÃO PAGOU", el("span", { class: "pv-ic x" }, "✕")];
    title = `Venceu em ${formatDateBR(venc)} · ${diffDays(hoje, venc)} dias de atraso`;
  } else {
    const d = diffDays(venc, hoje);
    cls = d === 0 ? "hoje" : "aberto"; conteudo = d === 0 ? "Vence hoje" : `vence ${formatDateBR(venc).slice(0, 5)}`;
    title = `Vence em ${formatDateBR(venc)}`;
  }
  if (cls === "na") return el("span", { class: "pv-cell na", title }, conteudo);
  return el("button", { type: "button", class: `pv-cell ${cls}`, title: title + " — clique para " + (pago ? "alterar" : "dar baixa"), onclick: () => openBaixa(v, n) }, conteudo);
}

async function toggleLance(v, n, box) {
  const marcar = box.checked;
  box.disabled = true;
  let error;
  const row = { venda_id: v.id, numero: n, feito_em: isoDate(today()), created_by: userEmail() };
  if (marcar) ({ error } = await sb.from("posvendas_lances").upsert(row));
  else ({ error } = await sb.from("posvendas_lances").delete().eq("venda_id", v.id).eq("numero", n));
  box.disabled = false;
  if (error) { box.checked = !marcar; showToast("Erro ao salvar: " + error.message); return; }
  if (!state.lances.has(v.id)) state.lances.set(v.id, new Map());
  if (marcar) state.lances.get(v.id).set(n, row); else state.lances.get(v.id).delete(n);
  box.title = marcar ? `Lance ofertado em ${formatDateBR(row.feito_em)}` : `Marcar oferta de lance da ${n}ª parcela`;
}

// ---------- modal de baixa (data escolhida) ----------
const baixaOverlay = document.getElementById("baixa-overlay");
const baixaForm = document.getElementById("baixa-form");
let baixaAlvo = null;
function openBaixa(v, n) {
  baixaAlvo = { v, n };
  const pago = state.pagamentos.get(v.id)?.get(n);
  const s = sit(v);
  document.getElementById("baixa-title").textContent = `${pago ? "Baixa da" : "Dar baixa na"} ${n}ª parcela`;
  document.getElementById("baixa-sub").textContent = `${v.cliente} · vence ${formatDateBR(vencimentoParcela(v, s.cob, n))}` +
    (s.cob.valor_parcela ? ` · ${fmtMoney(Number(s.cob.valor_parcela))}` : "");
  baixaForm.pago_em.value = pago ? pago.pago_em : isoDate(today());
  document.getElementById("baixa-desfazer").classList.toggle("hidden", !pago);
  baixaOverlay.classList.remove("hidden");
  baixaForm.pago_em.focus();
}
function closeBaixa() { baixaOverlay.classList.add("hidden"); baixaAlvo = null; }
document.getElementById("baixa-close").addEventListener("click", closeBaixa);
baixaOverlay.addEventListener("click", (e) => { if (e.target.id === "baixa-overlay") closeBaixa(); });
baixaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!baixaAlvo) return;
  const { v, n } = baixaAlvo;
  const btn = document.getElementById("baixa-salvar");
  btn.disabled = true;
  try { await darBaixa(v, n, baixaForm.pago_em.value); } finally { btn.disabled = false; }
  closeBaixa();
});
document.getElementById("baixa-desfazer").addEventListener("click", async () => {
  if (!baixaAlvo) return;
  const { v, n } = baixaAlvo;
  closeBaixa();
  await desfazerBaixa(v, n);
});

// ---------- CONFIRMAÇÕES ----------
// Igual ao mapa de comissão do administrativo, mas para as baixas: só entra venda com pelo menos
// uma parcela paga, e cada coluna mostra se aquela parcela já teve baixa.
const CONF_PARCELAS_MIN = 8;
["conf-search", "conf-adm", "conf-vendedor"].forEach((id) => {
  document.getElementById(id).addEventListener(id === "conf-search" ? "input" : "change", () => {
    state.filters.confirmacoes = {
      search: document.getElementById("conf-search").value,
      adm: document.getElementById("conf-adm").value,
      vendedor: document.getElementById("conf-vendedor").value,
    };
    renderConfirmacoes();
  });
});
function renderConfirmacoes() {
  const comBaixa = state.vendas.filter((v) => daProducao(v) && state.pagamentos.get(v.id)?.size);
  const { search, adm, vendedor } = state.filters.confirmacoes;
  const q = search.trim().toLowerCase();
  const list = comBaixa.filter((v) => {
    if (adm && v.administradora !== adm) return false;
    if (vendedor && v.vendedor !== vendedor) return false;
    if (q && !`${v.cliente} ${v.numero_contrato || ""} ${v.grupo || ""} ${v.cota || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  // mais recente confirmação primeiro
  const ultimaBaixa = (v) => [...state.pagamentos.get(v.id).values()].reduce((m, p) => (p.pago_em > m ? p.pago_em : m), "");
  list.sort((a, b) => ultimaBaixa(b).localeCompare(ultimaBaixa(a)) || a.cliente.localeCompare(b.cliente, "pt-BR"));

  const mesAtual = isoDate(today()).slice(0, 7);
  let parcelas = 0, valor = 0, doMes = 0;
  list.forEach((v) => state.pagamentos.get(v.id).forEach((p) => {
    parcelas++;
    valor += Number(p.valor) || 0;
    if (p.pago_em.slice(0, 7) === mesAtual) doMes++;
  }));
  document.getElementById("conf-sum-vendas").textContent = list.length;
  document.getElementById("conf-sum-parcelas").textContent = parcelas;
  document.getElementById("conf-sum-valor").textContent = fmtMoney(valor);
  document.getElementById("conf-sum-mes").textContent = doMes;

  const colunas = Math.max(CONF_PARCELAS_MIN, ...list.map((v) => Math.max(...state.pagamentos.get(v.id).keys())));
  const thead = document.getElementById("conf-thead");
  thead.innerHTML = "";
  thead.appendChild(el("tr", {}, [
    el("th", {}, "Cliente"), el("th", {}, "Administradora"), el("th", {}, "Contrato"), el("th", {}, "Grupo"), el("th", {}, "Cota"),
    ...Array.from({ length: colunas }, (_, i) => el("th", { class: "com-p" }, `${i + 1}ª`)),
    el("th", { class: "com-p" }, "Pagas"),
  ]));

  const tbody = document.getElementById("conf-tbody");
  tbody.innerHTML = "";
  if (!list.length) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: String(6 + colunas), class: "empty-state" },
      comBaixa.length ? "Nenhuma venda com os filtros atuais." : "Nenhuma baixa nas vendas desse mês. Elas aparecem aqui assim que uma parcela for marcada como paga.")]));
    return;
  }
  list.forEach((v) => {
    const pagos = state.pagamentos.get(v.id);
    const s = sit(v);
    const primeira = s.cob?.primeira_parcela_numero ?? 1;
    const hoje = today();
    const tr = el("tr", {}, [
      el("td", { class: "com-cliente" }, [
        el("div", { class: "com-cliente-nome" }, [
          el("button", { type: "button", class: "pv-link pend-client-name", onclick: () => openFicha(v.id) }, v.cliente),
          v.parcelinha ? el("span", { class: "com-tag-parcelinha" }, "Parcelinha") : null,
        ]),
        el("div", { class: "com-cliente-sub" }, `Venda em ${formatDateBR(v.data_venda)} · ${v.vendedor}`),
      ]),
      el("td", {}, [adminBadge(v.administradora)]),
      el("td", {}, v.numero_contrato || "—"),
      el("td", {}, v.grupo || "—"),
      el("td", {}, v.cota || "—"),
    ]);
    for (let n = 1; n <= colunas; n++) {
      const pago = pagos.get(n);
      const adm = state.pagasAdm.get(v.id)?.get(n);
      if (!pago && adm) {
        const box = el("input", { type: "checkbox", class: "com-check pv-check-adm", disabled: "disabled", title: ORIGEM_LABEL[adm.origem], "aria-label": `Parcela ${n} de ${v.cliente}` });
        box.checked = true;
        tr.appendChild(el("td", { class: "com-p" }, [box]));
        continue;
      }
      if (!pago && n < primeira) {
        tr.appendChild(el("td", { class: "com-p com-na", title: n === 1 ? "Paga na adesão" : "Antes da primeira parcela acompanhada" }, "—"));
        continue;
      }
      if (!pago && s.cob?.prazo && n > s.cob.prazo) {
        tr.appendChild(el("td", { class: "com-p com-na", title: "Fora do prazo do plano" }, "—"));
        continue;
      }
      // Só a parcela com baixa tem caixinha (marcada). As demais não podem ser marcadas aqui:
      // a baixa é dada na aba Clientes ou na ficha.
      if (!pago) {
        const venc = s.cob ? vencimentoParcela(v, s.cob, n) : null;
        const atrasada = venc && venc < hoje;
        tr.appendChild(el("td", { class: "com-p" }, [el("span", {
          class: "pv-conf-vazio" + (atrasada ? " late" : ""),
          title: venc ? `${n}ª parcela — ${atrasada ? "venceu" : "vence"} ${formatDateBR(venc)}${atrasada ? " (em atraso)" : ""}` : `${n}ª parcela`,
        })]));
        continue;
      }
      const box = el("input", {
        type: "checkbox",
        class: "com-check",
        title: `Paga em ${formatDateBR(pago.pago_em)}${pago.valor ? " · " + fmtMoney(Number(pago.valor)) : ""} — desmarque para desfazer a baixa`,
        "aria-label": `Parcela ${n} de ${v.cliente}`,
      });
      box.checked = true;
      box.addEventListener("change", async () => {
        box.disabled = true;
        await desfazerBaixa(v, n);
        renderConfirmacoes(); // volta a marcação se a ação foi cancelada ou falhou
      });
      tr.appendChild(el("td", { class: "com-p" }, [box]));
    }
    const pagasN = new Set([...pagos.keys(), ...(state.pagasAdm.get(v.id) || new Map()).keys()]).size;
    const total = s.cob?.prazo ?? null;
    tr.appendChild(el("td", { class: "com-p com-count" + (total && pagasN >= total ? " done" : "") }, total ? `${pagasN}/${total}` : String(pagasN)));
    tbody.appendChild(tr);
  });
}

// ---------- ADIMPLÊNCIA ----------
["adi-adm", "adi-vendedor"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
  state.filters.adimplencia = { adm: document.getElementById("adi-adm").value, vendedor: document.getElementById("adi-vendedor").value };
  renderAdimplencia();
}));
function statsDe(vendas) {
  const inad = vendas.filter((v) => sit(v).status === "atraso");
  return {
    total: vendas.length,
    inad: inad.length,
    pct: pct(vendas.length - inad.length, vendas.length),
    valor: inad.reduce((s, v) => s + sit(v).valorAtraso, 0),
  };
}
function renderAdimplencia() {
  const { adm, vendedor } = state.filters.adimplencia;
  const base = state.vendas.filter((v) => ["atraso", "em_dia"].includes(sit(v).status)
    && (!adm || v.administradora === adm) && (!vendedor || v.vendedor === vendedor));
  const geral = statsDe(base);
  document.getElementById("adi-pct").textContent = fmtPct(geral.pct);
  document.getElementById("adi-total").textContent = geral.total;
  document.getElementById("adi-inad").textContent = geral.inad;
  document.getElementById("adi-valor").textContent = fmtMoney(geral.valor);

  const aging = document.getElementById("adi-aging");
  aging.innerHTML = "";
  const inad = base.filter((v) => sit(v).status === "atraso");
  AGING.forEach((b) => {
    const n = inad.filter((v) => sit(v).maxAtraso >= b.min && sit(v).maxAtraso <= b.max).length;
    aging.appendChild(el("div", { class: "pv-aging-item" + (n ? " has" : "") }, [
      el("div", { class: "pv-aging-n" }, n),
      el("div", { class: "pv-aging-label" }, b.label),
    ]));
  });

  const semCobranca = state.vendas.filter((v) => sit(v).status === "sem_cobranca" && (!adm || v.administradora === adm) && (!vendedor || v.vendedor === vendedor)).length;
  renderStatsTable("adi-por-adm", agrupar(base, (v) => v.administradora), "Administradora");
  renderStatsTable("adi-por-vendedor", agrupar(base, (v) => v.vendedor), "Vendedor");
  const porMes = agrupar(base, (v) => v.data_venda.slice(0, 7));
  porMes.sort((a, b) => b.key.localeCompare(a.key));
  porMes.forEach((g) => { const [y, m] = g.key.split("-"); g.label = `${MONTH_NAMES[Number(m) - 1]} ${y}`; });
  renderStatsTable("adi-por-mes", porMes, "Mês da venda", { preserveOrder: true });
  if (semCobranca) {
    document.getElementById("adi-por-mes").appendChild(el("div", { class: "pv-footnote" },
      semCobranca > 1 ? `${semCobranca} clientes com grupo sem dia de vencimento ficam fora do cálculo.` : "1 cliente com grupo sem dia de vencimento fica fora do cálculo."));
  }
}
function agrupar(vendas, keyFn) {
  const map = new Map();
  vendas.forEach((v) => { const k = keyFn(v) || "—"; if (!map.has(k)) map.set(k, []); map.get(k).push(v); });
  return [...map.entries()].map(([key, vs]) => ({ key, label: key, ...statsDe(vs) }));
}
function renderStatsTable(id, grupos, titulo, opts = {}) {
  const box = document.getElementById(id);
  box.innerHTML = "";
  if (!grupos.length) { box.appendChild(emptyState("Sem clientes com dados de cobrança.")); return; }
  if (!opts.preserveOrder) grupos.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || b.total - a.total);
  const table = el("table", { class: "pv-table pv-stats" }, [
    el("thead", {}, [el("tr", {}, [el("th", {}, titulo), el("th", {}, "Clientes"), el("th", {}, "Inadimplentes"), el("th", {}, "Em atraso"), el("th", { class: "pv-bar-col" }, "Adimplência")])]),
  ]);
  const tbody = el("tbody");
  grupos.forEach((g) => {
    const cls = g.pct === null ? "" : g.pct >= 90 ? "ok" : g.pct >= 75 ? "warn" : "crit";
    tbody.appendChild(el("tr", {}, [
      el("td", { class: "pv-strong" }, g.label),
      el("td", {}, g.total),
      el("td", {}, g.inad),
      el("td", {}, fmtMoney(g.valor)),
      el("td", { class: "pv-bar-col" }, [el("div", { class: "pv-bar" }, [
        el("div", { class: "pv-bar-track" }, [el("div", { class: `pv-bar-fill ${cls}`, style: `width:${g.pct ?? 0}%` })]),
        el("span", { class: "pv-bar-val" }, fmtPct(g.pct)),
      ])]),
    ]));
  });
  table.appendChild(tbody);
  box.appendChild(el("div", { class: "table-scroll" }, [table]));
}

// ---------- LEMBRETES ----------
const lembreteForm = document.getElementById("lembrete-form");
lembreteForm.elements["data"].value = isoDate(today());
lembreteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(lembreteForm);
  const ok = await criarLembrete({
    titulo: fd.get("titulo").trim(),
    data: fd.get("data"),
    repetir_dias: fd.get("repetir_dias") ? Number(fd.get("repetir_dias")) : null,
    venda_id: fd.get("venda_id") || null,
    descricao: fd.get("descricao").trim() || null,
  });
  if (ok) { lembreteForm.reset(); lembreteForm.elements["data"].value = isoDate(today()); }
});
async function criarLembrete(payload) {
  const { data, error } = await sb.from("posvendas_lembretes").insert({ ...payload, created_by: userEmail() }).select().single();
  if (error) { showToast("Erro ao salvar lembrete: " + error.message); return false; }
  state.lembretes.push(data);
  state.lembretes.sort((a, b) => a.data.localeCompare(b.data));
  showToast("Lembrete salvo.");
  refreshViews();
  return true;
}
async function concluirLembrete(l) {
  const concluido_em = new Date().toISOString();
  const { error } = await sb.from("posvendas_lembretes").update({ concluido_em }).eq("id", l.id);
  if (error) { showToast("Erro ao salvar: " + error.message); return; }
  l.concluido_em = concluido_em;
  if (l.repetir_dias) {
    // o próximo conta a partir da data do lembrete (ou de hoje, se ele estava atrasado)
    const base = parseDate(l.data) < today() ? today() : parseDate(l.data);
    await criarLembrete({ titulo: l.titulo, descricao: l.descricao, venda_id: l.venda_id, repetir_dias: l.repetir_dias, data: isoDate(addDays(base, l.repetir_dias)) });
    return;
  }
  showToast("Lembrete concluído.");
  refreshViews();
}
async function reabrirLembrete(l) {
  const { error } = await sb.from("posvendas_lembretes").update({ concluido_em: null }).eq("id", l.id);
  if (error) { showToast("Erro ao salvar: " + error.message); return; }
  l.concluido_em = null;
  refreshViews();
}
async function excluirLembrete(l) {
  if (!confirm(`Excluir o lembrete "${l.titulo}"?`)) return;
  const { error } = await sb.from("posvendas_lembretes").delete().eq("id", l.id);
  if (error) { showToast("Erro ao excluir: " + error.message); return; }
  state.lembretes = state.lembretes.filter((x) => x.id !== l.id);
  refreshViews();
}
function lembreteRow(l, opts = {}) {
  const v = l.venda_id ? vendaById(l.venda_id) : null;
  const atraso = !l.concluido_em ? diffDays(today(), parseDate(l.data)) : 0;
  const quando = l.concluido_em ? `Concluído em ${formatDateTimeBR(l.concluido_em)}`
    : atraso > 0 ? `Atrasado ${atraso} dia${atraso > 1 ? "s" : ""} (${formatDateBR(l.data)})`
    : atraso === 0 ? "Hoje" : formatDateBR(l.data);
  return el("div", { class: "pend-client-row pv-row" + (l.concluido_em ? " pv-done" : "") }, [
    el("span", { class: "pv-lembrete-data" + (atraso > 0 ? " late" : "") }, quando),
    el("div", { class: "pv-lembrete-txt" }, [
      el("div", { class: "pv-strong" }, [l.titulo, l.repetir_dias ? el("span", { class: "pv-repeat", title: "Repete a cada " + l.repetir_dias + " dias" }, ` ↻ ${l.repetir_dias}d`) : null]),
      l.descricao ? el("div", { class: "pv-muted" }, l.descricao) : null,
    ]),
    v && !opts.semCliente ? el("button", { type: "button", class: "pv-link", onclick: () => openFicha(v.id) }, v.cliente) : null,
    l.concluido_em
      ? el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => reabrirLembrete(l) }, "Reabrir")
      : el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => concluirLembrete(l) }, "Concluir"),
    el("button", { type: "button", class: "icon-btn pv-icon-sm", title: "Excluir", onclick: () => excluirLembrete(l) }, "✕"),
  ]);
}
function renderLembretes() {
  const pend = state.lembretes.filter((l) => !l.concluido_em);
  const conc = state.lembretes.filter((l) => l.concluido_em).sort((a, b) => b.concluido_em.localeCompare(a.concluido_em)).slice(0, 20);
  document.getElementById("lembretes-pend-count").textContent = `${pend.length} pendente${pend.length === 1 ? "" : "s"}`;
  fillList("lembretes-pendentes", pend, "Nenhum lembrete pendente.", (l) => lembreteRow(l));
  fillList("lembretes-concluidos", conc, "Nenhum lembrete concluído nos últimos 30 dias.", (l) => lembreteRow(l));
}

// ---------- GRUPOS ----------
function renderGrupos() {
  const map = new Map();
  state.vendas.forEach((v) => {
    if (!v.grupo) return;
    const k = grupoKey(v.administradora, v.grupo);
    if (!map.has(k)) map.set(k, { administradora: v.administradora, grupo: v.grupo, n: 0 });
    map.get(k).n++;
  });
  const grupos = [...map.values()].sort((a, b) =>
    (state.grupos.has(grupoKey(a.administradora, a.grupo)) - state.grupos.has(grupoKey(b.administradora, b.grupo)))
    || a.administradora.localeCompare(b.administradora) || a.grupo.localeCompare(b.grupo, "pt-BR", { numeric: true }));
  const tbody = document.getElementById("grupos-tbody");
  tbody.innerHTML = "";
  if (!grupos.length) { tbody.appendChild(el("tr", {}, [el("td", { colspan: "4" }, [emptyState("Nenhum grupo cadastrado no administrativo.")])])); return; }
  grupos.forEach((g) => {
    const dia = state.grupos.get(grupoKey(g.administradora, g.grupo));
    const input = el("input", { type: "number", min: "1", max: "31", class: "pv-dia-input", value: dia ?? "", placeholder: "—" });
    input.addEventListener("change", () => salvarDiaGrupo(g.administradora, g.grupo, input));
    tbody.appendChild(el("tr", {}, [
      el("td", {}, [adminBadge(g.administradora)]),
      el("td", { class: "pv-strong" }, g.grupo),
      el("td", {}, g.n),
      el("td", {}, [input, dia ? null : el("span", { class: "pv-tag sem_cobranca pv-ml" }, "Preencher")]),
    ]));
  });
}
async function salvarDiaGrupo(administradora, grupo, input) {
  const raw = input.value.trim();
  const k = grupoKey(administradora, grupo);
  let error;
  if (!raw) {
    ({ error } = await sb.from("posvendas_grupos").delete().eq("administradora", administradora).eq("grupo", grupo));
    if (!error) state.grupos.delete(k);
  } else {
    const dia = Number(raw);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) { showToast("Informe um dia entre 1 e 31."); return; }
    ({ error } = await sb.from("posvendas_grupos").upsert({ administradora, grupo, dia_vencimento: dia, updated_at: new Date().toISOString() }));
    if (!error) state.grupos.set(k, dia);
  }
  if (error) { showToast("Erro ao salvar: " + error.message); return; }
  showToast(raw ? `Grupo ${grupo}: vence todo dia ${raw}.` : `Dia do grupo ${grupo} removido.`);
  refreshViews();
}

// ---------- baixa manual ----------
async function darBaixa(venda, numero, pagoEm) {
  if (!pagoEm) { showToast("Informe a data do pagamento."); return; }
  const cob = state.cobranca.get(venda.id);
  const row = { venda_id: venda.id, numero, pago_em: pagoEm, valor: cob?.valor_parcela ?? null, created_by: userEmail() };
  const { error } = await sb.from("posvendas_pagamentos").upsert(row);
  if (error) { showToast("Erro ao dar baixa: " + error.message); return; }
  if (!state.pagamentos.has(venda.id)) state.pagamentos.set(venda.id, new Map());
  state.pagamentos.get(venda.id).set(numero, row);
  showToast(`Baixa da ${numero}ª parcela de ${venda.cliente}.`);
  refreshViews();
}
async function desfazerBaixa(venda, numero) {
  if (!confirm(`Desfazer a baixa da ${numero}ª parcela de ${venda.cliente}?`)) return;
  const { error } = await sb.from("posvendas_pagamentos").delete().eq("venda_id", venda.id).eq("numero", numero);
  if (error) { showToast("Erro ao desfazer: " + error.message); return; }
  state.pagamentos.get(venda.id)?.delete(numero);
  refreshViews();
}
async function resolverPromessa(p) {
  const resolvido_em = new Date().toISOString();
  const { error } = await sb.from("posvendas_anotacoes").update({ resolvido_em }).eq("id", p.id);
  if (error) { showToast("Erro ao salvar: " + error.message); return; }
  p.resolvido_em = resolvido_em;
  state.promessas = state.promessas.filter((x) => x.id !== p.id);
  if (fichaState.anotacoes) fichaState.anotacoes.forEach((a) => { if (a.id === p.id) a.resolvido_em = resolvido_em; });
  refreshViews();
}

// ---------- FICHA DO CLIENTE ----------
const fichaOverlay = document.getElementById("ficha-overlay");
const fichaState = { anotacoes: null, mostrarTodas: false };
document.getElementById("ficha-close").addEventListener("click", closeFicha);
fichaOverlay.addEventListener("click", (e) => { if (e.target.id === "ficha-overlay") closeFicha(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !fichaOverlay.classList.contains("hidden")) closeFicha(); });

async function openFicha(id) {
  state.fichaId = id;
  fichaState.anotacoes = null;
  fichaState.mostrarTodas = false;
  fichaOverlay.classList.remove("hidden");
  renderFicha();
  const { data, error } = await sb.from("posvendas_anotacoes").select("*").eq("venda_id", id).order("created_at", { ascending: false });
  if (state.fichaId !== id) return;
  if (error) { showToast("Erro ao carregar histórico: " + error.message); return; }
  fichaState.anotacoes = data || [];
  renderFicha();
}
function closeFicha() {
  state.fichaId = null;
  fichaOverlay.classList.add("hidden");
}

function detail(k, v) { return el("div", { class: "detail-item" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v ?? "—")]); }
function sectionTitle(txt, extra) { return el("div", { class: "pv-section-title" }, [el("span", {}, txt), extra || null]); }
function whatsappLink(numero) {
  const digits = (numero || "").replace(/\D/g, "");
  if (digits.length < 10) return numero || "—";
  const full = digits.length <= 11 ? "55" + digits : digits;
  return el("a", { href: `https://wa.me/${full}`, target: "_blank", rel: "noopener", class: "pv-link" }, numero);
}

function renderFicha() {
  const v = vendaById(state.fichaId);
  if (!v) { closeFicha(); return; }
  const s = sit(v);
  document.getElementById("ficha-title").textContent = v.cliente;
  const sub = document.getElementById("ficha-sub");
  sub.innerHTML = "";
  sub.append(adminBadge(v.administradora), ` Grupo ${v.grupo || "—"} · Cota ${v.cota || "—"} · `, situacaoTag(s));

  const body = document.getElementById("ficha-body");
  const scroll = body.scrollTop;
  body.innerHTML = "";
  body.appendChild(el("div", { class: "detail-grid" }, [
    detail("Vendedor", v.vendedor),
    detail("Contrato", v.numero_contrato),
    detail("Telefone", whatsappLink(v.numero_contato)),
    detail("E-mail", v.email),
    detail("Data da venda", formatDateBR(v.data_venda)),
    detail("Assembleia", formatDateBR(v.data_assembleia)),
    detail("Crédito", v.valor_venda ? fmtMoney(Number(v.valor_venda)) : "—"),
    detail("Plano / tabela", [v.tipo_plano, v.tabela].filter(Boolean).join(" · ") || "—"),
    detail("Tipo", [v.parcelinha ? "Parcelinha" : "Adesão", v.parcela_antecipada ? `antecipou${v.meses_antecipados ? " " + v.meses_antecipados + " meses" : ""}` : null].filter(Boolean).join(" · ")),
  ]));

  body.appendChild(buildCobrancaForm(v, s));
  if (s.cob) body.appendChild(buildParcelas(v, s));
  body.appendChild(buildHistorico(v));
  body.appendChild(buildLembretesCliente(v));
  body.scrollTop = scroll;
}

function sugestaoCobranca(v) {
  // Acompanhamos a partir da parcela seguinte à última já paga no administrativo (adesão, antecipadas
  // ou mapa de comissão). Cada parcela paga cobre um mês: a 2ª vence no mês depois da venda.
  const primeira = Math.max(2, ultimaPagaAdm(v) + 1);
  const venda = parseDate(v.data_venda);
  const mes = new Date(venda.getFullYear(), venda.getMonth() + 1 + (primeira - 2), 1);
  const diaGrupo = state.grupos.get(grupoKey(v.administradora, v.grupo));
  const dia = Math.min(diaGrupo || venda.getDate(), lastDayOfMonth(mes.getFullYear(), mes.getMonth()));
  return {
    valor_parcela: v.demais_parcelas ?? "",
    primeira_parcela_numero: primeira,
    primeiro_vencimento: isoDate(new Date(mes.getFullYear(), mes.getMonth(), dia)),
    prazo: "",
    ativo: true,
    observacao: "",
  };
}

function buildCobrancaForm(v, s) {
  const cob = s.cob || sugestaoCobranca(v);
  const salva = s.cob && !s.cob.estimada;
  const diaGrupo = state.grupos.get(grupoKey(v.administradora, v.grupo));
  const wrap = el("div", { class: "pv-section" });
  wrap.appendChild(sectionTitle("Dados de cobrança", salva ? null
    : el("span", { class: "pv-tag sem_cobranca" }, s.cob ? "Estimado pelo cadastro — salve só se precisar ajustar" : "Grupo sem dia de vencimento")));
  const form = el("div", { class: "client-form-grid pv-cob-form" }, [
    el("label", {}, ["Valor da parcela", el("input", { type: "number", step: "0.01", min: "0", name: "valor_parcela", value: cob.valor_parcela ?? "" })]),
    el("label", {}, ["Dia de vencimento do grupo", el("input", { type: "number", min: "1", max: "31", name: "dia_grupo", value: diaGrupo ?? "", placeholder: "Usa o dia da data abaixo" })]),
    el("label", {}, ["1ª parcela acompanhada (nº)", el("input", { type: "number", min: "1", name: "primeira_parcela_numero", value: cob.primeira_parcela_numero, required: "required" })]),
    el("label", {}, ["Vencimento dessa parcela", el("input", { type: "date", name: "primeiro_vencimento", value: cob.primeiro_vencimento, required: "required" })]),
    el("label", {}, ["Prazo (total de parcelas)", el("input", { type: "number", min: "1", name: "prazo", value: cob.prazo ?? "", placeholder: "Opcional" })]),
    el("label", {}, ["Situação da cota", el("select", { name: "ativo" }, [
      el("option", { value: "1", selected: cob.ativo ? "selected" : null }, "Ativa"),
      el("option", { value: "0", selected: cob.ativo ? null : "selected" }, "Cancelada / quitada"),
    ])]),
    el("label", { class: "span-2" }, ["Observação", el("input", { name: "observacao", value: cob.observacao ?? "" })]),
  ]);
  const btn = el("button", { type: "submit", class: "btn btn-primary btn-sm" }, salva ? "Salvar alterações" : "Salvar dados de cobrança");
  const formEl = el("form", {}, [form, el("div", { class: "client-form-actions" }, [btn])]);
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try { await salvarCobranca(v, new FormData(formEl)); } finally { btn.disabled = false; }
  });
  wrap.appendChild(formEl);
  return wrap;
}
async function salvarCobranca(v, fd) {
  const diaRaw = (fd.get("dia_grupo") || "").trim();
  const diaAtual = state.grupos.get(grupoKey(v.administradora, v.grupo));
  if (v.grupo && diaRaw && Number(diaRaw) !== diaAtual) {
    const dia = Number(diaRaw);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) { showToast("Dia de vencimento deve ser entre 1 e 31."); return; }
    const { error } = await sb.from("posvendas_grupos").upsert({ administradora: v.administradora, grupo: v.grupo, dia_vencimento: dia, updated_at: new Date().toISOString() });
    if (error) { showToast("Erro ao salvar o dia do grupo: " + error.message); return; }
    state.grupos.set(grupoKey(v.administradora, v.grupo), dia);
  }
  const row = {
    venda_id: v.id,
    valor_parcela: fd.get("valor_parcela") ? Number(fd.get("valor_parcela")) : null,
    primeira_parcela_numero: Number(fd.get("primeira_parcela_numero")),
    primeiro_vencimento: fd.get("primeiro_vencimento"),
    prazo: fd.get("prazo") ? Number(fd.get("prazo")) : null,
    ativo: fd.get("ativo") === "1",
    observacao: (fd.get("observacao") || "").trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (!state.cobranca.has(v.id)) row.created_by = userEmail();
  const { data, error } = await sb.from("posvendas_cobranca").upsert(row).select().single();
  if (error) { showToast("Erro ao salvar: " + error.message); return; }
  state.cobranca.set(v.id, data);
  showToast("Dados de cobrança salvos.");
  refreshViews();
}

function buildParcelas(v, s) {
  const wrap = el("div", { class: "pv-section" });
  const hoje = today();
  // por padrão: todas as vencidas + as próximas 3; o resto fica atrás do "ver todas"
  let lista = s.parcelas;
  const futuras = lista.filter((p) => p.venc > hoje && !p.pagamento);
  const escondidas = fichaState.mostrarTodas ? 0 : Math.max(0, futuras.length - 3);
  if (escondidas) { const corte = new Set(futuras.slice(3).map((p) => p.numero)); lista = lista.filter((p) => !corte.has(p.numero)); }
  const pagas = s.parcelas.filter((p) => p.pagamento).length;
  wrap.appendChild(sectionTitle(`Parcelas · ${pagas} com baixa`, escondidas || fichaState.mostrarTodas
    ? el("button", { type: "button", class: "pv-link", onclick: () => { fichaState.mostrarTodas = !fichaState.mostrarTodas; renderFicha(); } }, fichaState.mostrarTodas ? "Mostrar menos" : `Ver mais ${escondidas} futuras`)
    : null));
  if (!lista.length) { wrap.appendChild(emptyState("Nenhuma parcela no período.")); return wrap; }
  const tbody = el("tbody");
  [...lista].reverse().forEach((p) => {
    const statusTxt = p.pagamento ? `Pago em ${formatDateBR(p.pagamento.pago_em)}` : p.status === "atraso" ? `${p.atraso} dia${p.atraso > 1 ? "s" : ""} de atraso` : p.status === "hoje" ? "Vence hoje" : "A vencer";
    const statusCls = p.pagamento ? "em_dia" : p.status === "atraso" ? "atraso" : p.status === "hoje" ? "sem_cobranca" : "aberto";
    let acao;
    if (p.pagamento) {
      acao = el("button", { type: "button", class: "pv-link pv-muted", onclick: () => desfazerBaixa(v, p.numero) }, "desfazer");
    } else {
      const data = el("input", { type: "date", class: "pv-date-sm", value: isoDate(hoje) });
      acao = el("div", { class: "pv-baixa" }, [data, el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => darBaixa(v, p.numero, data.value) }, "Dar baixa")]);
    }
    tbody.appendChild(el("tr", { class: p.status === "atraso" ? "pv-row-late" : "" }, [
      el("td", { class: "pv-strong" }, `${p.numero}ª`),
      el("td", {}, formatDateBR(p.venc)),
      el("td", {}, [el("span", { class: `pv-tag ${statusCls}` }, statusTxt)]),
      el("td", { class: "pv-right" }, [acao]),
    ]));
  });
  wrap.appendChild(el("div", { class: "table-scroll" }, [el("table", { class: "pv-table pv-parcelas" }, [
    el("thead", {}, [el("tr", {}, [el("th", {}, "Nº"), el("th", {}, "Vencimento"), el("th", {}, "Situação"), el("th", {}, "")])]),
    tbody,
  ])]));
  return wrap;
}

function buildHistorico(v) {
  const wrap = el("div", { class: "pv-section" });
  wrap.appendChild(sectionTitle("Histórico de contatos e promessas"));
  const tipo = el("select", { name: "tipo" }, [
    el("option", { value: "contato" }, "Contato feito"),
    el("option", { value: "promessa" }, "Promessa de pagamento"),
    el("option", { value: "observacao" }, "Observação"),
  ]);
  const promessaLabel = el("label", { class: "hidden" }, ["Vai pagar em", el("input", { type: "date", name: "promessa_data", value: isoDate(addDays(today(), 3)) })]);
  tipo.addEventListener("change", () => promessaLabel.classList.toggle("hidden", tipo.value !== "promessa"));
  const texto = el("input", { name: "texto", required: "required", placeholder: "Ex.: liguei, disse que paga na sexta" });
  const form = el("form", { class: "client-form-grid pv-hist-form" }, [
    el("label", {}, ["Tipo", tipo]),
    promessaLabel,
    el("label", { class: "span-2" }, ["Anotação", texto]),
    el("div", { class: "pv-hist-actions" }, [el("button", { type: "submit", class: "btn btn-primary btn-sm" }, "Registrar")]),
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const row = {
      venda_id: v.id,
      tipo: fd.get("tipo"),
      texto: fd.get("texto").trim(),
      promessa_data: fd.get("tipo") === "promessa" ? fd.get("promessa_data") || null : null,
      created_by: userEmail(),
    };
    const { data, error } = await sb.from("posvendas_anotacoes").insert(row).select().single();
    if (error) { showToast("Erro ao registrar: " + error.message); return; }
    fichaState.anotacoes = [data, ...(fichaState.anotacoes || [])];
    if (data.tipo === "promessa") state.promessas.push(data);
    showToast("Registrado.");
    refreshViews();
  });
  wrap.appendChild(form);

  if (fichaState.anotacoes === null) { wrap.appendChild(emptyState("Carregando histórico...")); return wrap; }
  if (!fichaState.anotacoes.length) { wrap.appendChild(emptyState("Nenhum registro ainda.")); return wrap; }
  const TIPO_LABEL = { contato: "Contato", promessa: "Promessa", observacao: "Observação" };
  const list = el("div", { class: "pv-timeline" });
  fichaState.anotacoes.forEach((a) => {
    list.appendChild(el("div", { class: "pv-timeline-item" }, [
      el("div", { class: "pv-timeline-head" }, [
        el("span", { class: `pv-tipo ${a.tipo}` }, TIPO_LABEL[a.tipo]),
        el("span", { class: "pv-muted" }, formatDateTimeBR(a.created_at) + (a.created_by ? " · " + a.created_by : "")),
      ]),
      el("div", {}, a.texto),
      a.tipo === "promessa" ? el("div", { class: "pv-muted" }, [
        `Vai pagar em ${formatDateBR(a.promessa_data)} · `,
        a.resolvido_em ? "resolvida" : el("button", { type: "button", class: "pv-link", onclick: () => resolverPromessa(a) }, "marcar como resolvida"),
      ]) : null,
    ]));
  });
  wrap.appendChild(list);
  return wrap;
}

function buildLembretesCliente(v) {
  const wrap = el("div", { class: "pv-section" });
  wrap.appendChild(sectionTitle("Lembretes deste cliente"));
  const titulo = el("input", { name: "titulo", required: "required", placeholder: "Ex.: confirmar pagamento da 3ª parcela" });
  const data = el("input", { type: "date", name: "data", required: "required", value: isoDate(addDays(today(), 1)) });
  const form = el("form", { class: "client-form-grid pv-hist-form" }, [
    el("label", { class: "span-2" }, ["O que fazer", titulo]),
    el("label", {}, ["Data", data]),
    el("div", { class: "pv-hist-actions" }, [el("button", { type: "submit", class: "btn btn-primary btn-sm" }, "Criar lembrete")]),
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await criarLembrete({ titulo: titulo.value.trim(), data: data.value, venda_id: v.id });
  });
  wrap.appendChild(form);
  const doCliente = state.lembretes.filter((l) => l.venda_id === v.id && !l.concluido_em);
  if (doCliente.length) doCliente.forEach((l) => wrap.appendChild(lembreteRow(l, { semCliente: true })));
  return wrap;
}
