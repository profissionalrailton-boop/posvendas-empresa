// Apresentação para o cliente: uma conversa guiada, animada e em tela cheia, montada com os dados
// REAIS da proposta escolhida no Radar (grupo, parcela, participantes, assembleia...).
// Fluxo: Radar (Iniciar contrato → "Apresentação") manda os dados para a tela principal
// (postMessage, ou #apresentacao=... no endereço) → abre esta página → o vendedor confere,
// digita o nome do cliente e começa.
// Acesso: só os e-mails de APRESENTACAO_EMAILS (sistema.js).
//
// Contrato dos dados (versão 1) — todos opcionais, exceto administradora:
// { versao, administradora: "Embracon"|"Âncora", grupo, plano, tabela, tipo_bem, credito, prazo,
//   primeira_parcela, demais_parcelas, com_seguro, entrada_total, meses_carencia, data_assembleia,
//   participantes, vagas, contemplados, contemplados_lance_fixo, contemplados_lance_livre,
//   media_lance, pct_contemplacao, pos_contemplacao: { credito, parcela, prazo } }

const AP_MARCAS = {
  Embracon: { nome: "Embracon", completo: "Consórcio Embracon", anos: 38, lancePct: 25, comA: "com a Embracon", cor: "#d7182a", cor2: "#ff5a5f", escura: "#191919", slogan: "Porque sonhar não tem limites" },
  "Âncora": { nome: "Âncora", completo: "Âncora Consórcios", anos: 35, lancePct: 30, comA: "com a Âncora Consórcios", cor: "#12a39a", cor2: "#3fd0c3", escura: "#0d2b45", slogan: "Há mais de 35 anos realizando sonhos" },
};
const AP_OBJETIVOS = [
  { id: "casa", rotulo: "sua casa própria", icone: "🏡" },
  { id: "carro", rotulo: "seu carro", icone: "🚗" },
  { id: "moto", rotulo: "sua moto", icone: "🏍️" },
  { id: "caminhao", rotulo: "seu caminhão", icone: "🚚" },
  { id: "terreno", rotulo: "seu terreno", icone: "🌳" },
  { id: "negocio", rotulo: "seu negócio", icone: "🏪" },
  { id: "sonho", rotulo: "o seu sonho", icone: "✨" },
];
const AP_EXEMPLO = {
  versao: 1, administradora: "Embracon", grupo: "007270", plano: "Mais por Menos 25%", tabela: "Select Estendido", tipo_bem: "Imóvel",
  credito: 200000, prazo: 200, primeira_parcela: 2600, demais_parcelas: 1180, com_seguro: false, entrada_total: 2600, meses_carencia: 0,
  data_assembleia: null, participantes: 1480, vagas: 12, contemplados: 64, contemplados_lance_fixo: 22, contemplados_lance_livre: 18,
  media_lance: 41, pos_contemplacao: { credito: 150000, parcela: 1770, prazo: 160 },
};

const ap = { dados: null, cliente: "", objetivo: "sonho", tela: 0, passo: 0, telas: [], apresentando: false, exemplo: false };

// ---------- utilidades ----------
const apBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const apBrl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const apNum = new Intl.NumberFormat("pt-BR");
const apN = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
function apData(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}
const apDataBR = (d) => (d ? d.toLocaleDateString("pt-BR") : "—");
function apDiasAte(d) {
  if (!d) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.round((d - hoje) / 86400000);
}
function apMarca() { return AP_MARCAS[ap.dados && ap.dados.administradora] || AP_MARCAS.Embracon; }
function apObjetivo() { return AP_OBJETIVOS.find((o) => o.id === ap.objetivo) || AP_OBJETIVOS[AP_OBJETIVOS.length - 1]; }
function apPrimeiroNome() { return (ap.cliente || "").trim().split(/\s+/)[0] || ""; }
function apNomeBonito(s) { return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()); }
function objetivoDoBem(tipo) {
  const t = (tipo || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (t.includes("imov") || t.includes("casa")) return "casa";
  if (t.includes("moto")) return "moto";
  if (t.includes("caminh") || t.includes("pesad")) return "caminhao";
  if (t.includes("auto") || t.includes("carro") || t.includes("veic")) return "carro";
  return "sonho";
}

// conta de 0 até o valor (só quando o elemento aparece)
function contar(elemento, valor, formatar, ms = 1400) {
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    elemento.textContent = formatar(valor * e);
    if (t < 1 && elemento.isConnected) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

// ---------- números do grupo ----------
function apCalculos() {
  const d = ap.dados || {};
  const credito = apN(d.credito);
  const parcela = apN(d.demais_parcelas) ?? apN(d.primeira_parcela);
  const participantes = apN(d.participantes);
  const saldo = participantes && parcela ? participantes * parcela : null; // parcela bruta (suposição)
  const cartas = saldo && credito ? Math.floor(saldo / credito) : null;
  const pct = apMarca().lancePct;
  const lance = credito ? credito * (pct / 100) : null;
  const liberado = credito ? credito - lance : null;
  const assembleia = apData(d.data_assembleia);
  return { credito, parcela, participantes, saldo, cartas, pct, lance, liberado, assembleia, dias: apDiasAte(assembleia) };
}

// ---------- telas ----------
// cada tela: { id, passos, montar() → elemento }. Elementos com data-p="n" aparecem no passo n.
const ICONE_PESSOA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7"/></svg>';

function telaAbertura() {
  const o = apObjetivo();
  return el("div", { class: "ap-tela ap-abertura" }, [
    el("div", { class: "ap-aceno", "aria-hidden": "true" }, "👋"),
    el("h1", { class: "ap-titulo-xl" }, apPrimeiroNome() ? `Olá, ${apPrimeiroNome()}!` : "Olá!"),
    el("p", { class: "ap-lead" }, [`Vamos ver juntos o caminho até `, el("strong", {}, o.rotulo), ` ${o.icone}`]),
    el("p", { class: "ap-lead ap-suave", "data-p": "1" }, `${apMarca().comA} e a Infinity ao seu lado.`),
  ]);
}

function telaAdministradora() {
  const m = apMarca();
  const chips = [["🏠", "Imóveis"], ["🚗", "Veículos"], ["🚜", "Bens móveis"], ["✈️", "Serviços"]];
  const selos = [["👥", "Mais de 100 mil contemplados"], ["📍", "Presença em todo o Brasil"], ["🏛️", "Autorizada pelo Banco Central"]];
  return el("div", { class: "ap-tela ap-adm" }, [
    el("div", { class: "ap-faixa" }, [
      el("div", { class: "ap-marca-nome" }, m.completo),
      el("h2", { class: "ap-titulo-l" }, ["Há mais de ", el("span", { class: "ap-destaque" }, `${m.anos} anos`), el("br"), "realizando sonhos"]),
    ]),
    el("div", { class: "ap-chips", "data-p": "1" }, chips.map(([i, t], k) => el("div", { class: "ap-chip", style: `--k:${k}` }, [el("span", { class: "ap-chip-ic" }, i), t]))),
    el("div", { class: "ap-selos", "data-p": "2" }, selos.map(([i, t], k) => el("div", { class: "ap-selo", style: `--k:${k}` }, [el("span", {}, i), t]))),
  ]);
}

function cofre(nivel) {
  // cofrinho/pote com nível de "dinheiro" animado por CSS (--nivel 0..1)
  return el("div", { class: "ap-cofre", style: `--nivel:${nivel}`, html: `
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs><clipPath id="ap-pote"><path d="M40 60 Q40 40 60 40 H140 Q160 40 160 60 V160 Q160 180 140 180 H60 Q40 180 40 160 Z"/></clipPath></defs>
      <g clip-path="url(#ap-pote)"><rect class="ap-cofre-agua" x="30" y="40" width="140" height="140"/></g>
      <path class="ap-cofre-borda" d="M40 60 Q40 40 60 40 H140 Q160 40 160 60 V160 Q160 180 140 180 H60 Q40 180 40 160 Z"/>
      <rect class="ap-cofre-tampa" x="70" y="26" width="60" height="14" rx="5"/>
      <rect class="ap-cofre-fenda" x="85" y="31" width="30" height="4" rx="2"/>
    </svg>` });
}

function telaComoFunciona() {
  const pessoas = el("div", { class: "ap-pessoas" }, Array.from({ length: 12 }, (_, k) => el("span", { class: "ap-pessoa", style: `--k:${k}`, html: ICONE_PESSOA })));
  const moedas = el("div", { class: "ap-moedas", "data-p": "1" }, Array.from({ length: 8 }, (_, k) => el("span", { class: "ap-moeda", style: `--k:${k}` }, "💰")));
  return el("div", { class: "ap-tela ap-como" }, [
    el("h2", { class: "ap-titulo-l" }, "Como funciona o consórcio"),
    el("div", { class: "ap-como-palco" }, [pessoas, moedas, el("div", { class: "ap-como-cofre", "data-p": "1" }, cofre(0.8))]),
    el("div", { class: "ap-falas" }, [
      el("p", { "data-p": "0" }, "Um grupo de pessoas com o mesmo objetivo se junta."),
      el("p", { "data-p": "1" }, "Todo mês, cada uma paga a sua parcela, e esse dinheiro forma o saldo do grupo."),
      el("p", { "data-p": "2" }, ["Nas ", el("strong", {}, "assembleias"), ", esse saldo vira cartas de crédito para os contemplados, por sorteio ou por lance."]),
    ]),
  ]);
}

function telaGrupo() {
  const c = apCalculos();
  const d = ap.dados || {};
  const tela = el("div", { class: "ap-tela ap-grupo" }, [
    el("h2", { class: "ap-titulo-l" }, ["O seu grupo", d.grupo ? el("span", { class: "ap-tag" }, `Grupo ${d.grupo}`) : null]),
  ]);
  if (!c.participantes || !c.parcela) {
    tela.appendChild(el("p", { class: "ap-lead" }, "Os dados de participantes deste grupo não vieram na consulta."));
    return tela;
  }
  const nPart = el("span", { class: "ap-num" }, "0");
  const nSaldo = el("span", { class: "ap-num ap-num-destaque" }, "R$ 0");
  const nCartas = el("span", { class: "ap-num" }, "0");
  const conta = el("div", { class: "ap-conta" }, [
    el("div", { class: "ap-conta-item", "data-p": "0", "data-conta": "part" }, [nPart, el("span", { class: "ap-conta-rot" }, "participantes pagando")]),
    el("div", { class: "ap-conta-op", "data-p": "1" }, "×"),
    el("div", { class: "ap-conta-item", "data-p": "1" }, [el("span", { class: "ap-num" }, apBrl.format(c.parcela)), el("span", { class: "ap-conta-rot" }, "parcela do plano")]),
    el("div", { class: "ap-conta-op", "data-p": "2" }, "="),
    el("div", { class: "ap-conta-item ap-conta-total", "data-p": "2", "data-conta": "saldo" }, [nSaldo, el("span", { class: "ap-conta-rot" }, "entram no grupo por mês (estimativa)")]),
  ]);
  tela.appendChild(conta);
  const cartas = c.cartas ? Math.min(c.cartas, 40) : 0;
  tela.appendChild(el("div", { class: "ap-cartas-linha", "data-p": "3", "data-conta": "cartas" }, [
    el("div", { class: "ap-cartas" }, Array.from({ length: cartas }, (_, k) => el("span", { class: "ap-carta", style: `--k:${k}` }))),
    el("p", { class: "ap-lead" }, c.cartas
      ? ["Isso dá para entregar cerca de ", nCartas, ` cartas de ${apBrl0.format(c.credito)} por assembleia.`]
      : ["Esse saldo é dividido entre os contemplados de cada assembleia."]),
  ]));
  if (c.assembleia) {
    tela.appendChild(el("div", { class: "ap-assembleia", "data-p": "3" }, [
      el("span", { class: "ap-assembleia-ic", "aria-hidden": "true" }, "📅"),
      el("span", {}, ["Próxima assembleia: ", el("strong", {}, apDataBR(c.assembleia)), c.dias !== null && c.dias >= 0 ? ` · faltam ${c.dias} dia${c.dias === 1 ? "" : "s"}` : ""]),
    ]));
  }
  tela.appendChild(el("p", { class: "ap-aviso" }, "Estimativa feita com o número de participantes e a parcela deste plano. Não é garantia de contemplação."));
  tela._animar = (passo) => {
    if (passo === 0 && !tela._p0) { tela._p0 = 1; contar(nPart, c.participantes, (v) => apNum.format(Math.round(v))); }
    if (passo === 2 && !tela._p2) { tela._p2 = 1; contar(nSaldo, c.saldo, (v) => apBrl0.format(v), 1800); }
    if (passo === 3 && !tela._p3 && c.cartas) { tela._p3 = 1; contar(nCartas, c.cartas, (v) => apNum.format(Math.round(v)), 1200); }
  };
  return tela;
}

function telaContemplacao() {
  const d = ap.dados || {};
  const media = apN(d.media_lance);
  const pctCont = apN(d.pct_contemplacao);
  const formas = [
    { ic: "🎱", t: "Sorteio", txt: "Todo mês, todos concorrem com chances iguais.", cls: "ap-sorteio" },
    { ic: "🔨", t: "Lance livre", txt: "Você oferece um valor com recursos próprios. O maior lance é contemplado.", extra: media ? `Lance médio contemplado neste grupo: ${apNum.format(media)}%` : null, cls: "ap-lance" },
    { ic: "📄", t: "Lance embutido", txt: "Você usa uma parte da sua própria carta de crédito como lance.", cls: "ap-embutido" },
  ];
  return el("div", { class: "ap-tela ap-formas" }, [
    el("h2", { class: "ap-titulo-l" }, "Como você é contemplado"),
    el("div", { class: "ap-formas-grid" }, formas.map((f, k) => el("div", { class: `ap-forma ${f.cls}`, "data-p": String(k + 1) }, [
      el("div", { class: "ap-forma-ic", "aria-hidden": "true" }, f.ic),
      el("h3", {}, f.t),
      el("p", {}, f.txt),
      f.extra ? el("p", { class: "ap-forma-extra" }, f.extra) : null,
    ]))),
    apN(d.contemplados) ? el("p", { class: "ap-lead ap-suave", "data-p": "3" }, `Neste grupo, ${apNum.format(apN(d.contemplados))} pessoas já foram contempladas.`)
      : pctCont ? el("p", { class: "ap-lead ap-suave", "data-p": "3" }, `Neste grupo, ${apNum.format(pctCont)}% das cotas já foram contempladas.`) : null,
  ]);
}

function telaEstrategia() {
  const c = apCalculos();
  if (!c.credito) return el("div", { class: "ap-tela" }, [el("h2", { class: "ap-titulo-l" }, "A sua estratégia"), el("p", { class: "ap-lead" }, "Crédito não informado.")]);
  return el("div", { class: "ap-tela ap-estrategia", style: `--pct:${c.pct}` }, [
    el("h2", { class: "ap-titulo-l" }, "A estratégia para você"),
    el("p", { class: "ap-lead" }, "Usamos o lance embutido para acelerar a sua contemplação, sem tirar dinheiro do seu bolso."),
    el("div", { class: "ap-barra-carta" }, [
      el("div", { class: "ap-barra-total" }, [el("span", {}, "Carta de crédito"), el("strong", {}, apBrl.format(c.credito))]),
      el("div", { class: "ap-barra-partes", "data-p": "1" }, [
        el("div", { class: "ap-parte ap-parte-lance" }, [el("span", {}, `Lance embutido (${c.pct}%)`), el("strong", {}, apBrl.format(c.lance))]),
        el("div", { class: "ap-parte ap-parte-livre" }, [el("span", {}, "Crédito liberado para você"), el("strong", {}, apBrl.format(c.liberado))]),
      ]),
    ]),
    el("div", { class: "ap-estrategia-fim", "data-p": "2" }, [
      el("span", { class: "ap-check", "aria-hidden": "true" }, "✔"),
      el("p", {}, [`Você recebe `, el("strong", {}, apBrl.format(c.liberado)), ` para ${apObjetivo().rotulo}, e os ${apBrl.format(c.lance)} do lance são abatidos do saldo devedor.`]),
    ]),
  ]);
}

function telaInvestimento() {
  const d = ap.dados || {};
  const pos = d.pos_contemplacao || {};
  const entrada = apN(d.entrada_total) ?? apN(d.primeira_parcela);
  const itens = [
    entrada ? { r: "Para começar", v: apBrl.format(entrada), s: apN(d.meses_carencia) ? `entrada com ${d.meses_carencia} meses de carência` : "1ª parcela" } : null,
    apN(d.demais_parcelas) ? { r: "Demais parcelas", v: apBrl.format(apN(d.demais_parcelas)), s: d.com_seguro ? "com seguro de vida" : "por mês" } : null,
    apN(d.prazo) ? { r: "Prazo", v: `${apNum.format(apN(d.prazo))} meses`, s: "para quitar" } : null,
    apN(pos.parcela) ? { r: "Depois de contemplado", v: apBrl.format(apN(pos.parcela)), s: apN(pos.prazo) ? `por ${apNum.format(apN(pos.prazo))} meses` : "parcela" } : null,
  ].filter(Boolean);
  return el("div", { class: "ap-tela ap-invest" }, [
    el("h2", { class: "ap-titulo-l" }, "Quanto você investe"),
    el("div", { class: "ap-invest-grid" }, itens.map((it, k) => el("div", { class: "ap-invest-card", "data-p": String(k + 1) }, [
      el("span", { class: "ap-invest-rot" }, it.r), el("strong", {}, it.v), el("span", { class: "ap-invest-sub" }, it.s),
    ]))),
    el("p", { class: "ap-lead ap-suave", "data-p": String(itens.length) }, "Sem juros de financiamento: no consórcio, as parcelas já incluem a taxa de administração e o fundo de reserva do grupo."),
  ]);
}

function telaLinhaTempo() {
  const c = apCalculos();
  const o = apObjetivo();
  const marcos = [
    { ic: "✍️", t: "Hoje", s: "Você entra no grupo" },
    { ic: "📅", t: c.assembleia ? apDataBR(c.assembleia) : "1ª assembleia", s: "Primeira assembleia: você já concorre" },
    { ic: "🏆", t: "Contemplação", s: "Por sorteio ou pelo seu lance" },
    { ic: o.icone, t: "Conquista!", s: `${o.rotulo.charAt(0).toUpperCase()}${o.rotulo.slice(1)} nas suas mãos` },
  ];
  return el("div", { class: "ap-tela ap-tempo" }, [
    el("h2", { class: "ap-titulo-l" }, "O seu caminho"),
    el("div", { class: "ap-tempo-linha" }, [
      el("div", { class: "ap-tempo-trilho", "data-p": "1" }),
      ...marcos.map((m, k) => el("div", { class: "ap-marco", "data-p": String(k + 1), style: `--k:${k}` }, [
        el("div", { class: "ap-marco-ic", "aria-hidden": "true" }, m.ic), el("strong", {}, m.t), el("span", {}, m.s),
      ])),
    ]),
  ]);
}

function telaPassos() {
  const passos = [
    { ic: "📞", t: "Confirmação do plano", s: "A administradora liga para confirmar prazo, valor e parcelas." },
    { ic: "🛡️", t: "Confirmação dos seus dados", s: "Uma segunda ligação valida suas informações pessoais." },
    { ic: "📈", t: "Grupo saudável", s: "Com todos pagando em dia, o grupo contempla todo mês." },
  ];
  return el("div", { class: "ap-tela ap-passos" }, [
    el("h2", { class: "ap-titulo-l" }, "Para tudo dar certo"),
    el("div", { class: "ap-passos-grid" }, passos.map((p, k) => el("div", { class: "ap-passo", "data-p": String(k + 1) }, [
      el("div", { class: "ap-passo-ic", "aria-hidden": "true" }, p.ic), el("h3", {}, p.t), el("p", {}, p.s), el("span", { class: "ap-passo-ok", "aria-hidden": "true" }, "✔"),
    ]))),
    el("p", { class: "ap-lead", "data-p": "4" }, ["🔑 ", el("strong", {}, "Sucesso na contemplação!"), " Atenda as ligações e mantenha as parcelas em dia."]),
  ]);
}

function telaResumo() {
  const d = ap.dados || {};
  const c = apCalculos();
  const linhas = [
    ["Administradora", apMarca().completo],
    d.grupo ? ["Grupo", d.grupo] : null,
    c.credito ? ["Carta de crédito", apBrl.format(c.credito)] : null,
    c.liberado ? [`Crédito com lance embutido (${c.pct}%)`, apBrl.format(c.liberado)] : null,
    apN(d.entrada_total) ?? apN(d.primeira_parcela) ? ["Para começar", apBrl.format(apN(d.entrada_total) ?? apN(d.primeira_parcela))] : null,
    apN(d.demais_parcelas) ? ["Demais parcelas", apBrl.format(apN(d.demais_parcelas))] : null,
    apN(d.prazo) ? ["Prazo", `${apNum.format(apN(d.prazo))} meses`] : null,
    c.assembleia ? ["Próxima assembleia", apDataBR(c.assembleia)] : null,
  ].filter(Boolean);
  return el("div", { class: "ap-tela ap-resumo" }, [
    el("h2", { class: "ap-titulo-l" }, apPrimeiroNome() ? `${apPrimeiroNome()}, esta é a sua proposta` : "A sua proposta"),
    el("dl", { class: "ap-resumo-lista" }, linhas.map(([r, v], k) => el("div", { style: `--k:${k}` }, [el("dt", {}, r), el("dd", {}, v)]))),
    el("p", { class: "ap-titulo-m", "data-p": "1" }, `Vamos conquistar ${apObjetivo().rotulo}? 🤝`),
  ]);
}

const AP_TELAS = [
  { id: "abertura", passos: 1, montar: telaAbertura },
  { id: "administradora", passos: 2, montar: telaAdministradora },
  { id: "como", passos: 2, montar: telaComoFunciona },
  { id: "grupo", passos: 3, montar: telaGrupo },
  { id: "formas", passos: 3, montar: telaContemplacao },
  { id: "estrategia", passos: 2, montar: telaEstrategia },
  { id: "investimento", passos: 4, montar: telaInvestimento },
  { id: "tempo", passos: 4, montar: telaLinhaTempo },
  { id: "passos", passos: 4, montar: telaPassos },
  { id: "resumo", passos: 1, montar: telaResumo },
];

function textoResumo() {
  const d = ap.dados || {};
  const c = apCalculos();
  return [
    `*Proposta ${apMarca().completo}*${ap.cliente ? ` — ${ap.cliente.trim()}` : ""}`,
    d.grupo ? `Grupo: ${d.grupo}` : null,
    c.credito ? `Carta de crédito: ${apBrl.format(c.credito)}` : null,
    c.liberado ? `Crédito com lance embutido (${c.pct}%): ${apBrl.format(c.liberado)}` : null,
    apN(d.entrada_total) ?? apN(d.primeira_parcela) ? `Para começar: ${apBrl.format(apN(d.entrada_total) ?? apN(d.primeira_parcela))}` : null,
    apN(d.demais_parcelas) ? `Demais parcelas: ${apBrl.format(apN(d.demais_parcelas))}` : null,
    apN(d.prazo) ? `Prazo: ${apN(d.prazo)} meses` : null,
    c.assembleia ? `Próxima assembleia: ${apDataBR(c.assembleia)}` : null,
  ].filter(Boolean).join("\n");
}

// ---------- montagem da página ----------
function carregarApresentacao() {
  const raiz = document.getElementById("sx-apresentacao");
  raiz.innerHTML = "";
  raiz.appendChild(ap.dados ? preparacao() : semDados());
}

function semDados() {
  return el("div", { class: "ap-prep" }, [
    el("h1", {}, "Apresentação para o cliente"),
    el("p", { class: "px-secao-sub" }, "Abra no Radar a proposta escolhida, clique em Iniciar contrato e depois em Apresentação: os dados reais do grupo chegam aqui."),
    el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => receberApresentacao(AP_EXEMPLO, { exemplo: true }) }, "Ver com dados de exemplo"),
  ]);
}

function preparacao() {
  const d = ap.dados;
  const m = apMarca();
  const c = apCalculos();
  const nome = el("input", { type: "text", class: "ap-input", placeholder: "Ex.: Maria da Silva", value: ap.cliente, "aria-label": "Nome do cliente" });
  nome.addEventListener("input", () => { ap.cliente = nome.value; });
  const objetivo = el("select", { class: "ap-input", "aria-label": "O que o cliente quer conquistar" }, AP_OBJETIVOS.map((o) => el("option", { value: o.id }, `${o.icone} ${o.rotulo}`)));
  objetivo.value = ap.objetivo;
  objetivo.addEventListener("change", () => { ap.objetivo = objetivo.value; });
  const dado = (r, v) => el("div", { class: "ap-dado" }, [el("span", {}, r), el("strong", {}, v ?? "—")]);
  return el("div", { class: "ap-prep" }, [
    el("div", { class: "px-topo" }, [
      el("div", {}, [el("h1", {}, "Apresentação para o cliente"), el("p", { class: "px-secao-sub" }, ap.exemplo ? "Dados de EXEMPLO — abra pelo Radar para usar os dados reais." : `Proposta recebida do Radar · ${m.completo}`)]),
    ]),
    el("div", { class: "ap-prep-grid" }, [
      el("div", { class: "px-card" }, [
        el("div", { class: "px-titulo" }, "Antes de começar"),
        el("label", { class: "ap-campo" }, ["Nome do cliente", nome]),
        el("label", { class: "ap-campo" }, ["O que ele quer conquistar", objetivo]),
        el("button", { type: "button", class: "btn btn-primary ap-iniciar", onclick: iniciarApresentacao }, "▶ Iniciar apresentação"),
        el("p", { class: "px-sub" }, "Avance com clique, seta → ou espaço. Volte com a seta ←. Esc sai."),
      ]),
      el("div", { class: "px-card" }, [
        el("div", { class: "px-titulo" }, "Dados da proposta"),
        el("div", { class: "ap-dados" }, [
          dado("Grupo", d.grupo), dado("Plano", d.plano), dado("Crédito", c.credito ? apBrl.format(c.credito) : null),
          dado("Demais parcelas", c.parcela ? apBrl.format(c.parcela) : null), dado("Prazo", apN(d.prazo) ? `${apN(d.prazo)} meses` : null),
          dado("Participantes", c.participantes ? apNum.format(c.participantes) : null),
          dado("Saldo estimado/mês", c.saldo ? apBrl0.format(c.saldo) : null), dado("Cartas por assembleia", c.cartas !== null ? `≈ ${apNum.format(c.cartas)}` : null),
          dado("Próxima assembleia", c.assembleia ? apDataBR(c.assembleia) : null), dado(`Lance embutido (${m.nome})`, `${m.lancePct}%`),
        ]),
      ]),
    ]),
  ]);
}

// ---------- modo apresentação (tela cheia) ----------
let apPalco = null;
function iniciarApresentacao() {
  const m = apMarca();
  ap.tela = 0; ap.passo = 0; ap.apresentando = true;
  apPalco = el("div", { class: "ap-palco", style: `--marca:${m.cor};--marca2:${m.cor2};--marca-escura:${m.escura}`, tabindex: "-1" });
  const conteudo = el("div", { class: "ap-conteudo" });
  const barra = el("div", { class: "ap-barra" }, [
    el("button", { type: "button", class: "ap-btn", "aria-label": "Voltar", onclick: (e) => { e.stopPropagation(); voltar(); } }, "‹"),
    el("div", { class: "ap-pontos" }, AP_TELAS.map((_, k) => el("span", { class: "ap-ponto", "data-k": String(k) }))),
    el("button", { type: "button", class: "ap-btn", "aria-label": "Avançar", onclick: (e) => { e.stopPropagation(); avancar(); } }, "›"),
    el("button", { type: "button", class: "ap-btn ap-btn-txt", onclick: async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(textoResumo()); e.target.textContent = "Copiado ✔"; setTimeout(() => { e.target.textContent = "Copiar resumo"; }, 1800); } catch (er) { /* sem área de transferência */ }
    } }, "Copiar resumo"),
    el("button", { type: "button", class: "ap-btn ap-btn-txt", onclick: (e) => { e.stopPropagation(); sairApresentacao(); } }, "Sair"),
  ]);
  apPalco.appendChild(el("div", { class: "ap-logo-canto" }, [el("img", { src: "logo.png", alt: "Infinity" }), el("span", {}, m.completo)]));
  apPalco.appendChild(conteudo);
  apPalco.appendChild(barra);
  apPalco.addEventListener("click", (e) => { if (!e.target.closest(".ap-barra")) avancar(); });
  // toque: deslizar para os lados
  let x0 = null;
  apPalco.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  apPalco.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); if (dx < 0) avancar(); else voltar(); }
  });
  document.body.appendChild(apPalco);
  document.addEventListener("keydown", teclas);
  try { if (apPalco.requestFullscreen) apPalco.requestFullscreen().catch(() => {}); } catch (e) { /* sem tela cheia: segue na janela */ }
  document.addEventListener("fullscreenchange", aoSairTelaCheia);
  apPalco.focus();
  mostrarTela(0, 0);
}
function aoSairTelaCheia() { if (!document.fullscreenElement && ap.apresentando && apPalco && apPalco._estavaCheia) sairApresentacao(); if (document.fullscreenElement === apPalco) apPalco._estavaCheia = true; }
function sairApresentacao() {
  ap.apresentando = false;
  document.removeEventListener("keydown", teclas);
  document.removeEventListener("fullscreenchange", aoSairTelaCheia);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (apPalco) { apPalco.remove(); apPalco = null; }
}
function teclas(e) {
  if (!ap.apresentando) return;
  if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); avancar(); }
  else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); voltar(); }
  else if (e.key === "Escape") sairApresentacao();
}
function mostrarTela(indice, passo) {
  const def = AP_TELAS[indice];
  const conteudo = apPalco.querySelector(".ap-conteudo");
  const nova = def.montar();
  nova.classList.add("ap-entrando");
  conteudo.innerHTML = "";
  conteudo.appendChild(nova);
  ap.tela = indice;
  ap.passo = 0;
  aplicarPasso(nova, 0);
  for (let p = 1; p <= passo; p++) aplicarPasso(nova, p);
  apPalco.querySelectorAll(".ap-ponto").forEach((p) => p.classList.toggle("ativo", Number(p.dataset.k) === indice));
  apPalco.dataset.tela = def.id;
}
function aplicarPasso(tela, passo) {
  ap.passo = passo;
  tela.querySelectorAll("[data-p]").forEach((n) => { if (Number(n.dataset.p) <= passo) n.classList.add("ap-visivel"); });
  if (typeof tela._animar === "function") tela._animar(passo);
}
function avancar() {
  const def = AP_TELAS[ap.tela];
  const tela = apPalco.querySelector(".ap-tela");
  if (ap.passo < def.passos) { aplicarPasso(tela, ap.passo + 1); return; }
  if (ap.tela < AP_TELAS.length - 1) mostrarTela(ap.tela + 1, 0);
}
function voltar() {
  if (ap.passo > 0) {
    const tela = apPalco.querySelector(".ap-tela");
    tela.querySelectorAll("[data-p]").forEach((n) => { if (Number(n.dataset.p) >= ap.passo) n.classList.remove("ap-visivel"); });
    ap.passo -= 1;
    return;
  }
  if (ap.tela > 0) mostrarTela(ap.tela - 1, AP_TELAS[ap.tela - 1].passos);
}

// ---------- entrada dos dados ----------
// chamado pela tela principal quando o Radar manda uma proposta (ou pelo exemplo)
function receberApresentacao(dados, { exemplo = false } = {}) {
  if (!dados || !AP_MARCAS[dados.administradora]) dados = { ...(dados || {}), administradora: "Embracon" };
  ap.dados = dados;
  ap.exemplo = exemplo;
  ap.cliente = dados.cliente ? apNomeBonito(String(dados.cliente)) : "";
  ap.objetivo = objetivoDoBem(dados.tipo_bem);
  if (ap.apresentando) sairApresentacao();
  const raiz = document.getElementById("sx-apresentacao");
  if (raiz) raiz.innerHTML = "";
  if (typeof abrir === "function" && permitido("apresentacao", "apresentacao")) abrir("apresentacao", "apresentacao");
  if (raiz && !raiz.childElementCount) carregarApresentacao();
}
