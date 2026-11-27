// Negócios › Pipeline — quadro de negócios (substituto do quadro do CRM). Banco: sql/041_pipeline.sql.
// Acesso (sql/043): o dono vê tudo; vendedor em pipe_liberados vê/mexe só nos próprios cards; os outros veem "em breve".
// Etapas na ordem do funil (Reciclagem é a 1ª coluna: leads para retrabalho). A aba Distribuir marca vários e redistribui em lote.
const PIPE_ETAPAS = [
  { id: "reciclagem", nome: "Reciclagem", dica: "Leads para retrabalho" },
  { id: "oportunidade", nome: "Oportunidade", dica: "Lead novo" },
  { id: "contato", nome: "1º contato", dica: "Conseguiu falar com o lead" },
  { id: "agendamento", nome: "Agendamento", dica: "Reunião marcada" },
  { id: "reuniao", nome: "Reunião", dica: "Reunião feita" },
  { id: "documentacao", nome: "Documentação", dica: "Pegou a documentação" },
  { id: "negociacao", nome: "Em negociação", dica: "Documentação entregue, mas demorando a fechar" },
  { id: "fechado", nome: "Fechado", dica: "Venda feita" },
];
const PIPE_NOME_ETAPA = { reciclagem: "Reciclagem", ...Object.fromEntries(PIPE_ETAPAS.map((e) => [e.id, e.nome])) };
const PIPE_MOTIVOS = ["Não respondeu às 3 tentativas", "Sumiu sem proposta", "Sumiu com proposta", "Curioso", "Já comprou", "Sem entrada", "Não quer consórcio", "Quer à vista", "Número errado", "Outro"]; // mesmos do Convex
const PIPE_TIPOS = ["Imóvel", "Automóvel", "Moto", "Pesados", "Serviços", "Outro"];
const PIPE_CORES = ["#111827", "#dc2626", "#ea580c", "#ca8a04", "#65a30d", "#059669", "#0891b2", "#2563eb", "#7c3aed", "#db2777"];

let pp = null;                 // { cards, etiquetas, cardEtiq: Map(card → Set(etiqueta)), vendedores, fotos }
let ppVista = "quadro";        // "quadro" | "reciclagem"
let ppFiltro = null;           // ver ppFiltrosVazios
let ppFiltrosAberto = false;
let ppRecSel = new Set();      // cards marcados na reciclagem
let ppCanal = null, ppRecarga = null;

const ppMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const ppDiasDesde = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const ppTelDigitos = (t) => String(t || "").replace(/\D/g, "");
const ppWhats = (t) => { const d = ppTelDigitos(t); return d ? `https://wa.me/${d.length <= 11 ? "55" + d : d}` : null; };
let ppAcesso = null;           // { dono: bool, vendedor: nome | null } — vem do banco (pipe_meu_acesso)
const ppDono = () => !!(ppAcesso && ppAcesso.dono);

// datetime-local (horário de Fortaleza) <-> ISO
const ppParaLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - DC_OFFSET).toISOString().slice(0, 16) : "");
const ppDeLocal = (v) => (v ? new Date(new Date(v + ":00Z").getTime() + DC_OFFSET).toISOString() : null);

// o banco devolve no máximo 1000 linhas por consulta: busca de 1000 em 1000 até acabar
async function ppTudo(consulta) {
  const tudo = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await consulta().range(ini, ini + 999);
    if (error) return { data: null, error };
    tudo.push(...data);
    if (data.length < 1000) return { data: tudo, error: null };
  }
}

async function carregarPipeline() {
  const raiz = document.getElementById("sx-pipeline");
  if (ppAcesso && ppAcesso.email !== perms.email) ppAcesso = null; // trocou de usuário sem recarregar
  if (!ppAcesso) {
    const { data, error } = await sb.rpc("pipe_meu_acesso");
    ppAcesso = { ...(error ? { dono: false, vendedor: null } : data), email: perms.email };
  }
  if (!ppAcesso.dono && !ppAcesso.vendedor) { desenharPipelineEmBreve(raiz); return; }
  if (!ppDono()) ppVista = "quadro";
  ppAoVivo();
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "px-carregando" }, "Abrindo o pipeline…"));
  if (!ppFiltro) ppFiltro = ppFiltrosVazios();
  const [c, e, ce, f, v, cm] = await Promise.all([
    ppTudo(() => sb.from("pipe_cards").select("*").order("id")),
    sb.from("pipe_etiquetas").select("*").order("nome"),
    ppTudo(() => sb.from("pipe_card_etiquetas").select("card_id, etiqueta_id").order("card_id").order("etiqueta_id")),
    sb.from("vendedor_fotos").select("vendedor, foto_url"),
    sb.from("administrativo_vendedores").select("nome, ativo").order("nome"),
    ppTudo(() => sb.from("pipe_comentarios").select("card_id").order("id")),
  ]);
  const erro = [c, e, ce, f, v, cm].find((r) => r.error);
  if (erro) { raiz.innerHTML = ""; raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível abrir o pipeline: " + erro.error.message)); return; }
  const cardEtiq = new Map();
  ce.data.forEach((x) => { if (!cardEtiq.has(x.card_id)) cardEtiq.set(x.card_id, new Set()); cardEtiq.get(x.card_id).add(x.etiqueta_id); });
  const comentarios = new Map();
  cm.data.forEach((x) => comentarios.set(x.card_id, (comentarios.get(x.card_id) || 0) + 1));
  pp = {
    cards: c.data,
    comentarios,
    etiquetas: e.data,
    cardEtiq,
    fotos: new Map(f.data.map((x) => [x.vendedor, x.foto_url])),
    vendedores: v.data.filter((x) => x.ativo !== false && !DC_FORA.includes(x.nome)).map((x) => x.nome),
  };
  // quem tem card mas não é vendedor ativo (veio do Convex, já saiu): aparece no filtro para redistribuir
  pp.antigos = [...new Set(c.data.map((x) => x.vendedor).filter((n) => n && !pp.vendedores.includes(n)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  desenharPipeline(raiz);
}

function desenharPipelineEmBreve(raiz) {
  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "pp-embreve" }, [
    el("div", { class: "pp-embreve-ic", "aria-hidden": "true" }, "🚧"),
    el("h1", {}, "Pipeline · em breve"),
    el("p", {}, "Aqui vai ficar o quadro dos seus clientes, etapa por etapa, no lugar do CRM. Assim que estiver pronto, a gente avisa."),
  ]));
}

const PIPE_EMOJI_BEM = { "Imóvel": "🏠", "Automóvel": "🚗", "Moto": "🏍️", "Pesados": "🚚", "Serviços": "🛠️", "Outro": "📦" };
const ppEmojiBem = (t) => PIPE_EMOJI_BEM[t] || "❔";
// dias sem atividade (mudança de etapa, comentário ou troca de vendedor zeram)
const ppParado = (x) => ppDiasDesde(x.atividade_em || x.etapa_desde);

function ppFiltrosVazios() {
  return { vendedor: "", etiqueta: "", busca: "", criadoDe: "", criadoAte: "", paradoMin: "", status: "perdidos", etapas: new Set(), motivos: new Set() };
}
// quantos filtros estão ligados (para o número no botão Filtros)
function ppQtdFiltros() {
  const f = ppFiltro;
  let n = [f.etiqueta, f.busca.trim(), f.criadoDe, f.criadoAte, f.paradoMin].filter(Boolean).length;
  if (ppVista === "reciclagem") n += (f.status !== "perdidos" ? 1 : 0) + (f.etapas.size ? 1 : 0) + (f.motivos.size ? 1 : 0);
  return n;
}

// filtros comuns (quadro e reciclagem)
function ppVisiveis(lista) {
  const f = ppFiltro;
  const b = f.busca.trim().toLowerCase();
  const bDig = ppTelDigitos(b);
  const de = f.criadoDe ? new Date(f.criadoDe + "T00:00:00-03:00").getTime() : -Infinity;
  const ate = f.criadoAte ? new Date(f.criadoAte + "T23:59:59-03:00").getTime() : Infinity;
  const min = f.paradoMin === "" ? 0 : Number(f.paradoMin);
  return lista.filter((x) => {
    const criado = new Date(x.criado_em).getTime();
    return (!f.vendedor || (f.vendedor === "—" ? !x.vendedor : x.vendedor === f.vendedor)) &&
      (!f.etiqueta || (pp.cardEtiq.get(x.id) || new Set()).has(Number(f.etiqueta))) &&
      (!b || (x.nome || "").toLowerCase().includes(b) || (bDig.length >= 4 && ppTelDigitos(x.telefone).includes(bDig))) &&
      criado >= de && criado <= ate &&
      (!min || ppParado(x) >= min);
  });
}

function ppPainelFiltros(raiz) {
  const f = ppFiltro;
  const redesenhar = () => desenharPipeline(raiz);
  const campo = (rot, controle) => el("div", { class: "field" }, [el("label", { class: "atd-rot" }, rot), controle]);
  const sel = (valor, opcoes, aoMudar, rot) => { const s = el("select", { class: "ap-input", "aria-label": rot, onchange: (e) => { aoMudar(e.target.value); redesenhar(); } }, opcoes.map(([v, t]) => el("option", { value: v }, t))); s.value = valor; return s; };
  const data = (valor, aoMudar, rot) => el("input", { type: "date", class: "ap-input", value: valor, "aria-label": rot, onchange: (e) => { aoMudar(e.target.value); redesenhar(); } });
  const busca = el("input", { type: "search", class: "ap-input pp-busca", placeholder: "Nome ou telefone", value: f.busca, "aria-label": "Buscar cliente" });
  let t = null;
  busca.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { f.busca = busca.value; const pos = busca.selectionStart; redesenhar(); const nb = raiz.querySelector(".pp-busca"); if (nb) { nb.focus(); nb.setSelectionRange(pos, pos); } }, 300); });
  const chips = (lista, conjunto, rotulo) => el("div", { class: "pp-motivos" }, lista.map(([v, txt]) => el("button", { type: "button", class: "pp-motivo" + (conjunto.has(v) ? " sel" : ""), "aria-pressed": String(conjunto.has(v)),
    onclick: () => { conjunto.has(v) ? conjunto.delete(v) : conjunto.add(v); redesenhar(); } }, txt)));

  const rec = ppVista === "reciclagem";
  const motivosExistentes = [...new Set(pp.cards.filter((x) => x.etapa === "reciclagem").map((x) => x.perdido_motivo || "Sem motivo"))];
  return el("div", { class: "pp-filtros-painel" }, [
    el("div", { class: "pp-filtros-grade" }, [
      campo("Buscar", busca),
      campo("Etiqueta", sel(f.etiqueta, [["", "Todas"], ...pp.etiquetas.map((e) => [String(e.id), e.nome])], (v) => (f.etiqueta = v), "Etiqueta")),
      campo("Parado há", sel(f.paradoMin, [["", "Qualquer tempo"], ["1", "1 dia ou mais"], ["3", "3 dias ou mais"], ["7", "7 dias ou mais"], ["15", "15 dias ou mais"], ["30", "30 dias ou mais"]], (v) => (f.paradoMin = v), "Dias parado")),
      campo("Criado de", data(f.criadoDe, (v) => (f.criadoDe = v), "Criado a partir de")),
      campo("Criado até", data(f.criadoAte, (v) => (f.criadoAte = v), "Criado até")),
    ]),
    rec ? campo("Situação", el("div", { class: "pp-motivos" }, [["perdidos", "♻ Reciclagem"], ["ativos", "Outras etapas"], ["todos", "Todas as etapas"]].map(([v, txt]) =>
      el("button", { type: "button", class: "pp-motivo" + (f.status === v ? " sel" : ""), "aria-pressed": String(f.status === v), onclick: () => { f.status = v; redesenhar(); } }, txt)))) : null,
    rec && f.status !== "perdidos" ? campo("Etapa no funil", chips(PIPE_ETAPAS.filter((e) => e.id !== "fechado" && e.id !== "reciclagem").map((e) => [e.id, e.nome]), f.etapas)) : null,
    rec && f.status !== "ativos" && motivosExistentes.length ? campo("Motivo (reciclagem)", chips(motivosExistentes.map((m) => [m, m]), f.motivos)) : null,
    el("div", { class: "pp-filtros-pe" }, [
      el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => { ppFiltro = ppFiltrosVazios(); redesenhar(); } }, "Limpar filtros"),
      el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => { ppFiltrosAberto = false; redesenhar(); } }, "Fechar"),
    ]),
  ]);
}

// filtro de vendedor fica fora do botão Filtros
function ppSelVendedor(raiz) {
  const s = el("select", { class: "ap-input pp-filtro pp-sel-vend", "aria-label": "Filtrar por vendedor", onchange: (e) => { ppFiltro.vendedor = e.target.value; desenharPipeline(raiz); } },
    [["", "Todos os vendedores"], ...pp.vendedores.map((n) => [n, n]), ...(pp.antigos || []).map((n) => [n, n + " (saiu)"]), ["—", "Sem vendedor"]].map(([v, t]) => el("option", { value: v }, t)));
  s.value = ppFiltro.vendedor;
  return s;
}

function desenharPipeline(raiz) {
  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "px-topo pp-topo" }, [
    el("div", {}, [
      el("h1", {}, "Pipeline"),
      el("p", { class: "px-sub" }, ppDono() ? "Arraste o card para mudar de etapa." : "Seus clientes, etapa por etapa. Arraste o card para mudar de etapa."),
    ]),
    el("div", { class: "pp-topo-acoes" }, [
      ppDono() ? el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: ppModalDistribuicao }, "🔀 Distribuição") : null,
      ppDono() ? el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: ppModalEtiquetas }, "🏷 Etiquetas") : null,
      el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => ppModalCard(null) }, "＋ Novo lead"),
    ]),
  ]));

  const nFiltros = ppQtdFiltros();
  raiz.appendChild(el("div", { class: "pp-barra" }, [
    el("div", { class: "dd-periodo pp-vistas", role: "tablist", "aria-label": "Visão" }, [
      ["quadro", `Quadro (${pp.cards.length})`],
      ppDono() ? ["reciclagem", "↪ Distribuir leads"] : null,
    ].filter(Boolean).map(([k, t]) => el("button", { type: "button", role: "tab", "aria-selected": String(ppVista === k), class: "dd-periodo-bt" + (ppVista === k ? " sel" : ""),
      onclick: () => { ppVista = k; ppRecSel.clear(); desenharPipeline(raiz); } }, t))),
    el("div", { class: "pp-barra-dir" }, [ppDono() ? ppSelVendedor(raiz) : null,
    el("button", { type: "button", class: "btn btn-secondary btn-sm pp-bt-filtros" + (nFiltros ? " ativo" : ""), "aria-expanded": String(ppFiltrosAberto),
      onclick: () => { ppFiltrosAberto = !ppFiltrosAberto; desenharPipeline(raiz); } }, `⚙ Filtros${nFiltros ? ` (${nFiltros})` : ""}`)]),
  ]));
  if (ppFiltrosAberto) raiz.appendChild(ppPainelFiltros(raiz));

  if (ppVista === "reciclagem") { raiz.appendChild(ppReciclagem(raiz)); return; }

  const quadro = el("div", { class: "pp-quadro" });
  PIPE_ETAPAS.forEach((etapa) => {
    const lista = ppVisiveis(pp.cards.filter((x) => x.etapa === etapa.id)).sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em)); // mais novos em cima
    const soma = lista.reduce((a, x) => a + (Number(x.valor_credito) || 0), 0);
    const corpo = el("div", { class: "pp-col-corpo" }, lista.length ? lista.map((x) => ppCartao(x)) : [el("p", { class: "pp-col-vazia" }, "Solte um card aqui")]);
    const col = el("section", { class: `pp-col pp-col-${etapa.id}`, "aria-label": etapa.nome }, [
      el("header", { class: "pp-col-cab", title: etapa.dica }, [
        el("div", {}, [el("strong", {}, etapa.nome), el("span", { class: "pp-col-n" }, String(lista.length))]),
        el("small", {}, soma ? ppMoeda.format(soma) : etapa.dica),
      ]),
      corpo,
    ]);
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("alvo"); });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("alvo"); });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("alvo");
      const id = Number(e.dataTransfer.getData("text/plain"));
      const card = pp.cards.find((x) => x.id === id);
      if (!card || card.etapa === etapa.id) return;
      if (etapa.id === "reciclagem") ppModalPerdeu(card); // pede o motivo
      else ppMover(card, etapa.id);
    });
    quadro.appendChild(col);
  });
  raiz.appendChild(quadro);
}

function ppEtiquetasDoCard(x) {
  const ids = pp.cardEtiq.get(x.id);
  if (!ids || !ids.size) return null;
  return el("div", { class: "pp-etqs" }, pp.etiquetas.filter((t) => ids.has(t.id)).map((t) => el("span", { class: "pp-etq", style: `--etq:${t.cor}` }, t.nome)));
}

function ppSeloParado(x) {
  if (x.etapa === "fechado") return el("span", { class: "pp-selo ok" }, x.fechado_em ? `✓ ${ddDataCurta(x.fechado_em)}` : "✓ Fechado");
  const d = ppParado(x);
  const cls = d >= 7 ? " parado" : d >= 3 ? " morno" : " novo";
  return el("span", { class: "pp-selo" + cls, title: "Dias sem atividade (mudar de etapa ou comentar zera)" }, d === 0 ? "Hoje" : d === 1 ? "Ontem" : `${d} dias`);
}

function ppCartao(x) {
  const nCom = pp.comentarios.get(x.id) || 0;
  const zap = ppWhats(x.telefone);
  const parar = (e) => e.stopPropagation();
  const card = el("article", { class: "pp-card", draggable: "true", tabindex: "0", role: "button", "aria-label": `Abrir ${x.nome}` }, [
    el("div", { class: "pp-card-cab" }, [
      el("span", { class: "pp-card-bem", title: x.tipo_bem || "Tipo do bem não informado", "aria-label": x.tipo_bem || "Tipo do bem não informado" }, ppEmojiBem(x.tipo_bem)),
      ppSeloParado(x),
      x.telefone ? el("a", { class: "pp-card-tel", href: `tel:${ppTelDigitos(x.telefone)}`, onclick: parar }, `📞 ${ddTel(x.telefone)}`) : null,
    ]),
    el("strong", { class: "pp-card-nome" }, x.nome),
    x.tipo_bem ? el("small", { class: "pp-card-info" }, x.tipo_bem) : null,
    x.reuniao_em && (x.etapa === "agendamento" || x.etapa === "reuniao") ? el("small", { class: "pp-card-reuniao" }, `📅 ${dcDataHora(x.reuniao_em)}`) : null,
    el("div", { class: "pp-card-meio" }, [
      ppEtiquetasDoCard(x) || el("span"),
      el("span", { class: "pp-card-valor" + (x.valor_credito ? "" : " zero") }, ppMoeda.format(Number(x.valor_credito) || 0)),
    ]),
    el("div", { class: "pp-card-rodape" }, [
      el("div", { class: "pp-card-acoes" }, [
        x.telefone ? el("a", { class: "pp-acao lig", href: `tel:${ppTelDigitos(x.telefone)}`, title: "Ligar", "aria-label": `Ligar para ${x.nome}`, onclick: parar }, "📞") : null,
        zap ? el("a", { class: "pp-acao zap", href: zap, target: "_blank", rel: "noopener", title: "WhatsApp", "aria-label": `WhatsApp de ${x.nome}`, onclick: parar }, "💬") : null,
        el("span", { class: "pp-acao com", title: `${nCom} comentário(s)` }, ["🗨", nCom ? el("b", {}, String(nCom)) : null]),
      ]),
      x.vendedor ? el("span", { class: "pp-card-vend" }, [avatarPerfil(x.vendedor, pp.fotos.get(x.vendedor), "pp-foto"), dcPrimeiro(x.vendedor)]) : el("span", { class: "pp-card-vend sem" }, "Sem vendedor"),
    ]),
  ]);
  card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(x.id)); e.dataTransfer.effectAllowed = "move"; card.classList.add("arrastando"); });
  card.addEventListener("dragend", () => card.classList.remove("arrastando"));
  card.addEventListener("click", () => ppModalCard(x));
  card.addEventListener("keydown", (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ppModalCard(x); } });
  return card;
}

async function ppMover(card, etapa, extra = {}) {
  const antes = { etapa: card.etapa, etapa_desde: card.etapa_desde, atividade_em: card.atividade_em };
  Object.assign(card, { etapa, etapa_desde: new Date().toISOString(), atividade_em: new Date().toISOString(), posicao: Date.now() / 1000 }, extra);
  desenharPipeline(document.getElementById("sx-pipeline"));
  const { error } = await sb.from("pipe_cards").update({ etapa, posicao: card.posicao, ...extra }).eq("id", card.id);
  if (error) { Object.assign(card, antes); desenharPipeline(document.getElementById("sx-pipeline")); showToast("Não foi possível mover: " + error.message); return false; }
  showToast(`${card.nome} → ${PIPE_NOME_ETAPA[etapa]}`);
  return true;
}

// ---------- card (novo / abrir) ----------
// formulário do card (novo lead e "Editar" do card aberto). aoSalvar(dados) roda depois de gravar.
function ppFormCard(x, aoSalvar) {
  const novo = !x;
  const c = x || { nome: "", etapa: "oportunidade", vendedor: !ppDono() ? ppAcesso.vendedor : ppFiltro.vendedor && ppFiltro.vendedor !== "—" ? ppFiltro.vendedor : "" };
  const campo = (tipo, valor, attrs = {}) => el("input", { type: tipo, class: "ap-input", value: valor ?? "", autocomplete: "off", ...attrs });
  const nome = campo("text", c.nome, { maxlength: "120", placeholder: "Nome do cliente" });
  const tel = campo("tel", c.telefone, { maxlength: "20", placeholder: "(88) 99999-9999", inputmode: "tel" });
  const tipo = el("select", { class: "ap-input" }, [el("option", { value: "" }, "—"), ...PIPE_TIPOS.map((t) => el("option", { value: t }, t))]);
  tipo.value = c.tipo_bem || "";
  const valor = dcCampoValor(c.valor_credito ?? null);
  const vend = el("select", { class: "ap-input" }, [el("option", { value: "" }, "Sem vendedor"), ...pp.vendedores.map((n) => el("option", { value: n }, n))]);
  if (c.vendedor && !pp.vendedores.includes(c.vendedor)) vend.appendChild(el("option", { value: c.vendedor }, c.vendedor));
  vend.value = c.vendedor || "";
  const etapa = el("select", { class: "ap-input" }, PIPE_ETAPAS.map((e) => el("option", { value: e.id }, e.nome)));
  etapa.value = c.etapa;
  const reuniao = campo("datetime-local", ppParaLocal(c.reuniao_em));
  const email = campo("email", c.email, { maxlength: "120", placeholder: "email@exemplo.com" });
  const cidade = campo("text", c.cidade, { maxlength: "80" });
  const estado = campo("text", c.estado, { maxlength: "2", placeholder: "CE", style: "text-transform:uppercase" });
  const genero = el("select", { class: "ap-input" }, ["", "Feminino", "Masculino", "Outro"].map((g) => el("option", { value: g }, g || "—")));
  genero.value = c.genero || "";
  const origem = campo("text", c.origem, { maxlength: "60", placeholder: "Tráfego, indicação…" });
  const erro = el("div", { class: "auth-error hidden" });

  const etqSel = new Set(novo ? [] : [...(pp.cardEtiq.get(c.id) || [])]);
  const etqBox = el("div", { class: "pp-etq-escolha" });
  const pintarEtq = () => {
    etqBox.innerHTML = "";
    if (!pp.etiquetas.length) etqBox.appendChild(el("small", { class: "pv-muted" }, "Nenhuma etiqueta criada ainda."));
    pp.etiquetas.forEach((t) => etqBox.appendChild(el("button", { type: "button", class: "pp-etq pp-etq-bt" + (etqSel.has(t.id) ? " sel" : ""), style: `--etq:${t.cor}`, "aria-pressed": String(etqSel.has(t.id)),
      onclick: () => { etqSel.has(t.id) ? etqSel.delete(t.id) : etqSel.add(t.id); pintarEtq(); } }, (etqSel.has(t.id) ? "✓ " : "") + t.nome)));
  };
  pintarEtq();
  const salvar = el("button", { type: "button", class: "btn btn-primary btn-block" }, novo ? "＋ Criar lead" : "Salvar alterações");

  const form = el("div", { class: "pp-form-card" }, [
    el("div", { class: "pp-form" }, [
      el("div", { class: "field pp-span2" }, [el("label", { class: "atd-rot" }, "Nome"), nome]),
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Telefone"), tel]),
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Tipo do bem"), tipo]),
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Valor do crédito"), valor]),
      ppDono() ? el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Vendedor"), vend]) : null,
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Etapa"), etapa]),
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Reunião"), reuniao]),
    ]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Etiquetas"), etqBox]),
    el("details", { class: "pp-mais", open: c.email || c.cidade || c.genero ? "" : null }, [
      el("summary", {}, "Mais informações"),
      el("div", { class: "pp-form" }, [
        el("div", { class: "field pp-span2" }, [el("label", { class: "atd-rot" }, "E-mail"), email]),
        el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Cidade"), cidade]),
        el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Estado"), estado]),
        el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Gênero"), genero]),
        el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Origem"), origem]),
      ]),
    ]),
    erro, salvar,
  ]);

  salvar.addEventListener("click", async () => {
    erro.classList.add("hidden");
    if (!nome.value.trim()) { erro.textContent = "Coloque o nome do cliente."; erro.classList.remove("hidden"); nome.focus(); return; }
    const v = dcLerValor(valor.value);
    if (valor.value.trim() && v === null) { erro.textContent = "Valor do crédito inválido."; erro.classList.remove("hidden"); return; }
    if (etapa.value === "reciclagem" && c.etapa !== "reciclagem") { erro.textContent = "Para mandar para a reciclagem use o botão “Perdeu” (pede o motivo)."; erro.classList.remove("hidden"); return; }
    const dados = {
      nome: nome.value.trim(), telefone: ppTelDigitos(tel.value) || null, tipo_bem: tipo.value || null, valor_credito: v,
      vendedor: vend.value || null, etapa: etapa.value, reuniao_em: ppDeLocal(reuniao.value),
      email: email.value.trim() || null, cidade: cidade.value.trim() || null, estado: estado.value.trim().toUpperCase() || null,
      genero: genero.value || null, origem: origem.value.trim() || null,
    };
    if (novo || dados.etapa !== c.etapa) dados.posicao = Date.now() / 1000;
    salvar.disabled = true;
    const r = novo ? await sb.from("pipe_cards").insert(dados).select("id").single() : await sb.from("pipe_cards").update(dados).eq("id", c.id).select("id").single();
    if (r.error) { salvar.disabled = false; erro.textContent = "Não foi possível salvar: " + r.error.message; erro.classList.remove("hidden"); return; }
    const id = r.data.id;
    const antes = novo ? new Set() : (pp.cardEtiq.get(id) || new Set());
    const add = [...etqSel].filter((e) => !antes.has(e)), del = [...antes].filter((e) => !etqSel.has(e));
    if (add.length) await sb.from("pipe_card_etiquetas").insert(add.map((etiqueta_id) => ({ card_id: id, etiqueta_id })));
    if (del.length) await sb.from("pipe_card_etiquetas").delete().eq("card_id", id).in("etiqueta_id", del);
    showToast(novo ? `Lead ${dados.nome} criado.` : "Card salvo.");
    aoSalvar(dados);
  });
  form.focar = () => setTimeout(() => nome.focus(), 50);
  return form;
}

function ppModalCard(x) {
  if (x) { ppAbrirCard(x); return; }
  let fechar = null;
  const form = ppFormCard(null, () => { fechar(); carregarPipeline(); });
  fechar = dcModal("Novo lead", "Nome e telefone já bastam para começar", [form]);
  form.focar();
}

// card aberto (estilo CRM): faixa com os dados no topo, ações e etiquetas à esquerda, comentários no meio
function ppAbrirCard(c) {
  const fundo = el("div", { class: "modal-overlay" });
  const fechar = () => fundo.remove();
  fundo.addEventListener("click", (e) => { if (e.target === fundo) fechar(); });
  const ids = pp.cardEtiq.get(c.id) || new Set();
  const etqs = pp.etiquetas.filter((t) => ids.has(t.id));

  // centro: comentários (padrão), editar, histórico
  const coment = el("div", { class: "pp-coment pp-cm-coment" }, el("small", { class: "pv-muted" }, "Carregando comentários…"));
  const hist = el("details", { class: "pp-hist", open: "" }, [el("summary", {}, "Histórico"), el("small", { class: "pv-muted" }, "Carregando…")]);
  const centro = el("section", { class: "pp-cm-centro" });
  let vista = "coment";
  const botoesVista = {};
  const mostrar = (v) => {
    vista = v;
    centro.innerHTML = "";
    if (v === "coment") centro.appendChild(coment);
    if (v === "hist") centro.appendChild(hist);
    if (v === "editar") centro.appendChild(ppFormCard(c, () => { fechar(); carregarPipeline(); }));
    Object.entries(botoesVista).forEach(([k, b]) => b.classList.toggle("sel", k === v));
  };

  const acao = (k, ic, txt, onclick, cls) => {
    const b = el("button", { type: "button", class: "pp-cm-acao " + (cls || ""), onclick }, [el("span", { "aria-hidden": "true" }, ic), txt]);
    if (k) botoesVista[k] = b;
    return b;
  };
  const etapa = el("select", { class: "ap-input pp-cm-etapa", "aria-label": "Mudar etapa" }, PIPE_ETAPAS.map((e) => el("option", { value: e.id }, e.nome)));
  etapa.value = c.etapa;
  etapa.addEventListener("change", async () => {
    if (etapa.value === "reciclagem") { fechar(); ppModalPerdeu(c); return; }
    if (await ppMover(c, etapa.value)) { fechar(); } else etapa.value = c.etapa;
  });

  const esquerda = el("aside", { class: "pp-cm-esq" }, [
    acao("coment", "💬", `Comentários${pp.comentarios.get(c.id) ? ` (${pp.comentarios.get(c.id)})` : ""}`, () => mostrar("coment")),
    acao("editar", "✏️", "Editar", () => mostrar("editar")),
    c.telefone ? el("a", { class: "pp-cm-acao lig", href: `tel:${ppTelDigitos(c.telefone)}` }, [el("span", { "aria-hidden": "true" }, "📞"), "Ligar"]) : null,
    c.telefone ? el("a", { class: "pp-cm-acao zap", href: ppWhats(c.telefone), target: "_blank", rel: "noopener" }, [el("span", { "aria-hidden": "true" }, "🟢"), "WhatsApp"]) : null,
    acao("hist", "🕘", "Histórico", () => mostrar("hist")),
    el("div", { class: "pp-cm-caixa" }, [el("label", { class: "atd-rot" }, "Etapa"), etapa]),
    el("div", { class: "pp-cm-caixa" }, [
      el("label", { class: "atd-rot" }, "Etiquetas"),
      etqs.length ? el("div", { class: "pp-etqs" }, etqs.map((t) => el("span", { class: "pp-etq", style: `--etq:${t.cor}` }, t.nome))) : el("small", { class: "pv-muted" }, "Nenhuma — use Editar"),
    ]),
    c.vendedor ? el("div", { class: "pp-cm-caixa pp-cm-vend" }, [avatarPerfil(c.vendedor, pp.fotos.get(c.vendedor), "pp-foto"), el("span", {}, c.vendedor)]) : null,
    c.etapa === "reciclagem" && c.perdido_motivo ? el("div", { class: "pp-cm-caixa" }, [el("label", { class: "atd-rot" }, "Motivo da perda"), el("span", { class: "dd-chip pp-rec-motivo" }, c.perdido_motivo), c.perdido_obs ? el("small", { class: "pv-muted" }, c.perdido_obs) : null]) : null,
  ]);

  const cab = el("header", { class: "pp-cm-cab" }, [
    el("div", { class: "pp-cm-bem", "aria-hidden": "true" }, ppEmojiBem(c.tipo_bem)),
    el("div", { class: "pp-cm-titulo" }, [
      el("div", { class: "pp-cm-nome" }, [el("strong", {}, c.nome), el("span", { class: "pp-cm-etapa-txt" }, "• " + PIPE_NOME_ETAPA[c.etapa].toUpperCase())]),
      el("div", { class: "pp-cm-sub" }, [
        c.tipo_bem ? el("span", {}, c.tipo_bem) : null,
        c.telefone ? el("a", { href: `tel:${ppTelDigitos(c.telefone)}` }, `📞 ${ddTel(c.telefone)}`) : null,
        c.cidade ? el("span", {}, `${c.cidade}${c.estado ? "/" + c.estado : ""}`) : null,
      ]),
    ]),
    el("div", { class: "pp-cm-datas" }, [
      el("span", { title: "Criado em" }, `🗓 ${dcDataHora(c.criado_em)}`),
      el("span", { title: "Na etapa desde" }, `⏱ ${dcDataHora(c.etapa_desde)}`),
      ppSeloParado(c),
    ]),
    el("div", { class: "pp-cm-valor" }, ppMoeda.format(Number(c.valor_credito) || 0)),
    el("button", { type: "button", class: "pp-cm-fechar", "aria-label": "Fechar", onclick: fechar }, "✕"),
  ]);

  const rodape = el("footer", { class: "pp-cm-rodape" }, [
    c.etapa !== "reciclagem" ? el("button", { type: "button", class: "btn pp-perdeu", onclick: () => { fechar(); ppModalPerdeu(c); } }, "✕ Perdeu") : null,
    c.etapa !== "fechado" ? el("button", { type: "button", class: "btn pp-ganhou", onclick: async () => { fechar(); await ppMover(c, "fechado"); } }, "✓ Ganhou") : null,
    ppDono() ? el("button", { type: "button", class: "icon-btn", title: "Excluir card", "aria-label": `Excluir ${c.nome}`, onclick: async () => {
      if (!confirm(`Excluir o card de ${c.nome}? Os comentários e o histórico também somem.`)) return;
      const { error } = await sb.from("pipe_cards").delete().eq("id", c.id);
      if (error) { showToast("Não foi possível excluir: " + error.message); return; }
      fechar(); showToast("Card excluído."); carregarPipeline();
    } }, "🗑") : null,
  ]);

  fundo.appendChild(el("div", { class: "modal-box pp-cm", role: "dialog", "aria-label": c.nome }, [
    cab,
    el("div", { class: "pp-cm-corpo" }, [esquerda, centro]),
    rodape,
  ]));
  document.body.appendChild(fundo);
  mostrar("coment");
  ppCarregarConversa(c, coment, hist);
}

async function ppCarregarConversa(c, coment, hist) {
  const [cm, h] = await Promise.all([
    sb.from("pipe_comentarios").select("*").eq("card_id", c.id).order("em", { ascending: false }),
    sb.from("pipe_historico").select("*").eq("card_id", c.id).order("em", { ascending: false }),
  ]);
  const texto = el("textarea", { class: "ap-input pp-coment-txt", rows: "2", maxlength: "2000", placeholder: "Adicionar comentário…" });
  const enviar = el("button", { type: "button", class: "btn btn-primary btn-sm" }, "Enviar");
  const lista = el("ul", { class: "pp-coment-lista" });
  const pintar = (itens) => {
    lista.innerHTML = "";
    if (!itens.length) lista.appendChild(el("li", { class: "pv-muted" }, "Nenhum comentário ainda."));
    itens.forEach((m) => lista.appendChild(el("li", {}, [
      el("small", {}, `${m.autor.split("@")[0]} · ${dcDataHora(m.em)}`),
      el("p", {}, m.texto),
    ])));
  };
  let itens = cm.data || [];
  pintar(itens);
  enviar.addEventListener("click", async () => {
    const t = texto.value.trim();
    if (!t) return;
    enviar.disabled = true;
    const { data, error } = await sb.from("pipe_comentarios").insert({ card_id: c.id, texto: t }).select().single();
    enviar.disabled = false;
    if (error) { showToast("Não foi possível comentar: " + error.message); return; }
    texto.value = "";
    c.atividade_em = data.em;
    pp.comentarios.set(c.id, (pp.comentarios.get(c.id) || 0) + 1);
    desenharPipeline(document.getElementById("sx-pipeline")); // atualiza contador e "parado" do card atrás do modal
    itens = [data, ...itens];
    pintar(itens);
  });
  coment.innerHTML = "";
  coment.append(el("label", { class: "atd-rot" }, `Comentários (${itens.length})`), el("div", { class: "pp-coment-novo" }, [texto, enviar]), lista);

  hist.innerHTML = "";
  hist.append(el("summary", {}, `Histórico (${(h.data || []).length})`), el("ul", { class: "pp-hist-lista" }, (h.data || []).map((x) => el("li", {}, [
    el("small", {}, dcDataHora(x.em)),
    el("span", {}, x.detalhe && !x.detalhe.startsWith("Perdido") ? x.detalhe : `${x.de ? PIPE_NOME_ETAPA[x.de] + " → " : ""}${PIPE_NOME_ETAPA[x.para] || x.para}${x.detalhe ? " · " + x.detalhe : ""}`),
  ]))));
}

// ---------- perdeu → reciclagem ----------
function ppModalPerdeu(c) {
  let motivo = null;
  const grade = el("div", { class: "pp-motivos" });
  const pintar = () => {
    grade.innerHTML = "";
    PIPE_MOTIVOS.forEach((m) => grade.appendChild(el("button", { type: "button", class: "pp-motivo" + (motivo === m ? " sel" : ""), "aria-pressed": String(motivo === m), onclick: () => { motivo = m; pintar(); } }, m)));
  };
  pintar();
  const obs = el("textarea", { class: "ap-input", rows: "2", maxlength: "500", placeholder: "Detalhe (opcional)" });
  const erro = el("div", { class: "auth-error hidden" });
  const ok = el("button", { type: "button", class: "btn btn-primary btn-block" }, "♻ Mandar para a reciclagem");
  const fechar = dcModal(`Perdeu: ${c.nome}`, "Por que o lead foi perdido?", [el("div", { class: "field" }, [grade]), el("div", { class: "field" }, [obs]), erro, ok]);
  ok.addEventListener("click", async () => {
    if (!motivo) { erro.textContent = "Escolha o motivo."; erro.classList.remove("hidden"); return; }
    ok.disabled = true;
    const feito = await ppMover(c, "reciclagem", { perdido_motivo: motivo, perdido_obs: obs.value.trim() || null, perdido_em: new Date().toISOString(), perdido_por: c.vendedor });
    if (feito) fechar(); else ok.disabled = false;
  });
}

// ---------- reciclagem: perdidos (e, se quiser, ativos) → marcar vários e redistribuir ----------
function ppReciclagem(raiz) {
  const f = ppFiltro;
  const base = pp.cards.filter((x) => x.etapa !== "fechado" && (
    f.status === "todos" ? true : f.status === "ativos" ? x.etapa !== "reciclagem" : x.etapa === "reciclagem"));
  const lista = ppVisiveis(base)
    .filter((x) => x.etapa === "reciclagem" ? (!f.motivos.size || f.motivos.has(x.perdido_motivo || "Sem motivo")) : (!f.etapas.size || f.etapas.has(x.etapa)))
    .sort((a, b) => ppParado(b) - ppParado(a));
  [...ppRecSel].forEach((id) => { if (!lista.some((x) => x.id === id)) ppRecSel.delete(id); });
  const wrap = el("section", { class: "dd-bloco pp-rec" });

  const rotulo = f.status === "ativos" ? "leads de outras etapas" : f.status === "todos" ? "leads" : "leads na reciclagem";
  const todos = lista.length && lista.every((x) => ppRecSel.has(x.id));
  wrap.appendChild(el("div", { class: "pp-rec-barra" }, [
    el("label", { class: "pp-check" }, [
      el("input", { type: "checkbox", checked: todos ? "" : null, disabled: lista.length ? null : "", onchange: (e) => { lista.forEach((x) => (e.target.checked ? ppRecSel.add(x.id) : ppRecSel.delete(x.id))); desenharPipeline(raiz); } }),
      `Selecionar todos · ${lista.length} ${rotulo}`,
    ]),
    el("button", { type: "button", class: "btn btn-primary btn-sm", disabled: ppRecSel.size ? null : "", onclick: () => ppModalRedistribuir(raiz) }, `↪ Redistribuir ${ppRecSel.size || ""}`.trim()),
  ]));

  if (!lista.length) {
    wrap.appendChild(el("p", { class: "px-vazio" }, f.status === "perdidos" && !base.length
      ? "Nenhum lead na reciclagem. Para redistribuir leads de outras etapas, abra Filtros › Situação › Outras etapas."
      : "Nenhum lead com esses filtros."));
    return wrap;
  }
  wrap.appendChild(el("ul", { class: "pp-rec-lista" }, lista.map((x) => {
    const perdido = x.etapa === "reciclagem";
    return el("li", { class: ppRecSel.has(x.id) ? "sel" : "" }, [
      el("input", { type: "checkbox", checked: ppRecSel.has(x.id) ? "" : null, "aria-label": `Selecionar ${x.nome}`, onchange: (e) => { e.target.checked ? ppRecSel.add(x.id) : ppRecSel.delete(x.id); desenharPipeline(raiz); } }),
      el("span", { class: "pp-rec-bem", "aria-hidden": "true" }, ppEmojiBem(x.tipo_bem)),
      el("button", { type: "button", class: "pp-rec-info", onclick: () => ppModalCard(x) }, [
        el("strong", {}, x.nome),
        el("small", {}, [x.tipo_bem, x.valor_credito ? ppMoeda.format(x.valor_credito) : null, x.telefone ? ddTel(x.telefone) : null, `criado ${ddDataCurta(x.criado_em)}`].filter(Boolean).join(" · ")),
        ppEtiquetasDoCard(x),
      ]),
      perdido
        ? el("span", { class: "dd-chip pp-rec-motivo", title: x.perdido_obs || "" }, x.perdido_motivo || "Sem motivo")
        : el("span", { class: `dd-chip pp-rec-etapa pp-col-${x.etapa}` }, PIPE_NOME_ETAPA[x.etapa]),
      ppSeloParado(x),
      el("small", { class: "pp-rec-quem" }, x.vendedor ? dcPrimeiro(x.vendedor) : "Sem vendedor"),
    ]);
  })));
  return wrap;
}

function ppModalRedistribuir(raiz) {
  const sel = pp.cards.filter((x) => ppRecSel.has(x.id));
  const nPerd = sel.filter((x) => x.etapa === "reciclagem").length, nAtiv = sel.length - nPerd;
  const escolhidos = new Set();
  const grade = el("div", { class: "dc-escolha" });
  const pintar = () => {
    grade.innerHTML = "";
    pp.vendedores.forEach((n) => grade.appendChild(el("button", { type: "button", class: "dc-escolha-item" + (escolhidos.has(n) ? " sel" : ""), "aria-pressed": String(escolhidos.has(n)),
      onclick: () => { escolhidos.has(n) ? escolhidos.delete(n) : escolhidos.add(n); pintar(); } }, [avatarPerfil(n, pp.fotos.get(n), "dc-escolha-foto"), el("span", {}, dcPrimeiro(n))])));
  };
  pintar();
  const explica = [
    nPerd ? `${nPerd} da reciclagem vão para Oportunidade` : null,
    nAtiv ? `${nAtiv} de outras etapas continuam onde estão, só troca o vendedor` : null,
  ].filter(Boolean).join(" · ");
  const erro = el("div", { class: "auth-error hidden" });
  const ok = el("button", { type: "button", class: "btn btn-primary btn-block" }, "↪ Redistribuir");
  const fechar = dcModal(`Redistribuir ${sel.length} lead(s)`, `Escolha um ou mais vendedores — os leads são divididos por igual. ${explica}.`, [el("div", { class: "field" }, [grade]), erro, ok]);
  ok.addEventListener("click", async () => {
    if (!escolhidos.size) { erro.textContent = "Escolha pelo menos um vendedor."; erro.classList.remove("hidden"); return; }
    ok.disabled = true;
    const cards = [...ppRecSel].sort(() => Math.random() - 0.5);
    const { data, error } = await sb.rpc("pipe_redistribuir", { p_cards: cards, p_vendedores: [...escolhidos] });
    if (error) { ok.disabled = false; erro.textContent = "Não foi possível redistribuir: " + error.message; erro.classList.remove("hidden"); return; }
    fechar();
    ppRecSel.clear();
    showToast(`${data} lead(s) redistribuído(s) para ${[...escolhidos].map(dcPrimeiro).join(", ")}.`);
    carregarPipeline();
  });
}

// ---------- etiquetas ----------
function ppModalEtiquetas() {
  const lista = el("ul", { class: "pp-etq-lista" });
  const uso = (id) => [...pp.cardEtiq.values()].filter((s) => s.has(id)).length;
  const pintar = () => {
    lista.innerHTML = "";
    if (!pp.etiquetas.length) lista.appendChild(el("li", { class: "pv-muted" }, "Nenhuma etiqueta ainda."));
    pp.etiquetas.forEach((t) => lista.appendChild(el("li", {}, [
      el("span", { class: "pp-etq", style: `--etq:${t.cor}` }, t.nome),
      el("small", { class: "pv-muted" }, `${uso(t.id)} card(s)`),
      el("button", { type: "button", class: "icon-btn", "aria-label": `Excluir etiqueta ${t.nome}`, onclick: async () => {
        if (!confirm(`Excluir a etiqueta "${t.nome}"? Ela sai de todos os cards.`)) return;
        const { error } = await sb.from("pipe_etiquetas").delete().eq("id", t.id);
        if (error) { showToast("Não foi possível excluir: " + error.message); return; }
        pp.etiquetas = pp.etiquetas.filter((e) => e.id !== t.id);
        pp.cardEtiq.forEach((s) => s.delete(t.id));
        pintar();
      } }, "🗑"),
    ])));
  };
  pintar();
  let cor = PIPE_CORES[7];
  const cores = el("div", { class: "pp-cores" });
  const pintarCores = () => {
    cores.innerHTML = "";
    PIPE_CORES.forEach((c) => cores.appendChild(el("button", { type: "button", class: "pp-cor" + (c === cor ? " sel" : ""), style: `--etq:${c}`, "aria-label": `Cor ${c}`, "aria-pressed": String(c === cor), onclick: () => { cor = c; pintarCores(); } })));
  };
  pintarCores();
  const nome = el("input", { type: "text", class: "ap-input", maxlength: "30", placeholder: "Nome da etiqueta" });
  const erro = el("div", { class: "auth-error hidden" });
  const criar = el("button", { type: "button", class: "btn btn-primary btn-block" }, "＋ Criar etiqueta");
  dcModal("Etiquetas", "Crie etiquetas para marcar os cards (origem, temperatura, campanha…)", [
    lista,
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Nova etiqueta"), nome]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Cor"), cores]),
    erro, criar,
  ]);
  criar.addEventListener("click", async () => {
    erro.classList.add("hidden");
    if (!nome.value.trim()) { erro.textContent = "Dê um nome para a etiqueta."; erro.classList.remove("hidden"); return; }
    criar.disabled = true;
    const { data, error } = await sb.from("pipe_etiquetas").insert({ nome: nome.value.trim(), cor }).select().single();
    criar.disabled = false;
    if (error) { erro.textContent = /duplicate|unique/i.test(error.message) ? "Já existe uma etiqueta com esse nome." : "Não foi possível criar: " + error.message; erro.classList.remove("hidden"); return; }
    pp.etiquetas = [...pp.etiquetas, data].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    nome.value = "";
    pintar();
    const raiz = document.getElementById("sx-pipeline");
    if (raiz && !raiz.classList.contains("hidden")) desenharPipeline(raiz);
  });
}

// ---------- ao vivo ----------
function ppAoVivo() {
  if (ppCanal) return;
  ppCanal = sb.channel("negocios-pipeline")
    .on("postgres_changes", { event: "*", schema: "public", table: "pipe_cards" }, () => {
      clearTimeout(ppRecarga);
      ppRecarga = setTimeout(() => {
        const raiz = document.getElementById("sx-pipeline");
        if (raiz && !raiz.classList.contains("hidden") && !document.querySelector(".modal-overlay")) carregarPipeline();
      }, 800);
    })
    .subscribe();
}

// ---------- distribuição dos leads novos (n8n → pipe_n8n_lead): quem entra no rodízio de cada tipo do bem ----------
const PIPE_TIPOS_DIST = ["Imóvel", "Automóvel", "Moto", "Pesados", "Outro"];
async function ppModalDistribuicao() {
  const [d, l] = await Promise.all([
    sb.from("pipe_distribuicao").select("tipo, vendedor"),
    sb.from("pipe_liberados").select("vendedor").order("vendedor"),
  ]);
  if (d.error || l.error) { showToast("Não foi possível abrir a distribuição: " + (d.error || l.error).message); return; }
  const marcado = new Set(d.data.map((x) => `${x.tipo}|${x.vendedor}`));
  const vendedores = l.data.map((x) => x.vendedor);
  const tabela = el("table", { class: "pp-dist" });
  const pintar = () => {
    tabela.innerHTML = "";
    tabela.appendChild(el("thead", {}, el("tr", {}, [el("th", {}, "Vendedor"), ...PIPE_TIPOS_DIST.map((t) => el("th", {}, [el("span", { "aria-hidden": "true" }, ppEmojiBem(t) + " "), t]))])));
    tabela.appendChild(el("tbody", {}, vendedores.map((v) => el("tr", {}, [
      el("td", {}, el("span", { class: "pp-card-vend" }, [avatarPerfil(v, pp.fotos.get(v), "pp-foto"), v])),
      ...PIPE_TIPOS_DIST.map((t) => {
        const k = `${t}|${v}`;
        return el("td", {}, el("input", { type: "checkbox", checked: marcado.has(k) ? "" : null, "aria-label": `${v} recebe ${t}`, onchange: async (e) => {
          const liga = e.target.checked;
          e.target.disabled = true;
          const r = liga ? await sb.from("pipe_distribuicao").insert({ tipo: t, vendedor: v }) : await sb.from("pipe_distribuicao").delete().eq("tipo", t).eq("vendedor", v);
          e.target.disabled = false;
          if (r.error) { e.target.checked = !liga; showToast("Não foi possível salvar: " + r.error.message); return; }
          liga ? marcado.add(k) : marcado.delete(k);
          pintar();
        } }));
      }),
    ]))));
    tabela.appendChild(el("tfoot", {}, el("tr", {}, [el("td", {}, "Recebem"), ...PIPE_TIPOS_DIST.map((t) => {
      const n = vendedores.filter((v) => marcado.has(`${t}|${v}`)).length;
      return el("td", { class: n ? "" : "pp-dist-zero" }, n ? String(n) : "todos");
    })])));
  };
  pintar();
  dcModal("Distribuição de leads novos", "Leads que chegam do SDR, follow-up, Instagram e formulário caem em rodízio entre os marcados de cada tipo. Se ninguém estiver marcado, o rodízio é entre todos.", [
    el("div", { class: "pp-dist-wrap" }, tabela),
  ]);
}
