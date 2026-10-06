// Painel geral (diretoria): resumo da empresa em quadros, aberto como página principal para quem
// está na lista do financeiro (hoje Railton e Maria Aline).
// Fontes, para os números baterem com cada sistema:
//   - Vendas e documentação: administrativo_vendas (direto, mesmas contas do administrativo)
//   - Financeiro e pós-vendas: o próprio sistema calcula e responde (mensagem "resumo")
//   - Campanha: tabela pública campanha_ranking (a mesma do ranking)
const PAINEL_META_PARCELINHA = 3000000;
const PAINEL_META_NORMAL = 1000000;
const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = new Intl.NumberFormat("pt-BR");
const pctFmt = (v) => (v === null || v === undefined || !isFinite(v) ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
function isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function dataBR(iso) { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}`; }

// ---------- pedir resumo a um sistema encaixado ----------
const resumosPendentes = new Map();
let resumoSeq = 0;
function pedirResumo(app, limiteMs = 25000) {
  return new Promise((resolve, reject) => {
    const f = garantirFrame(app);
    const id = `r${++resumoSeq}`;
    const timer = setTimeout(() => { resumosPendentes.delete(id); reject(new Error("sem resposta")); }, limiteMs);
    resumosPendentes.set(id, { resolve, reject, timer });
    const enviarPedido = () => f.el.contentWindow.postMessage({ tipo: "resumo", id }, location.origin);
    if (f.pronto) enviarPedido();
    else {
      const espera = setInterval(() => { if (f.pronto) { clearInterval(espera); enviarPedido(); } }, 300);
      setTimeout(() => clearInterval(espera), limiteMs);
    }
  });
}
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const m = e.data || {};
  if (m.tipo !== "resumo-resposta" || !resumosPendentes.has(m.id)) return;
  const p = resumosPendentes.get(m.id);
  resumosPendentes.delete(m.id);
  clearTimeout(p.timer);
  if (m.erro) p.reject(new Error(m.erro)); else p.resolve(m.dados);
});

// ---------- blocos de interface ----------
function card(titulo, valor, sub, opts = {}) {
  return el("div", { class: "px-card" + (opts.destaque ? " px-destaque" : "") + (opts.status ? ` px-${opts.status}` : "") }, [
    el("div", { class: "px-titulo" }, titulo),
    el("div", { class: "px-valor" }, valor),
    sub ? el("div", { class: "px-sub" }, sub) : null,
  ]);
}
// barras horizontais de uma cor só (comparação de quantidades), com rótulo e valor em texto
function barras(itens, formatar) {
  const max = Math.max(...itens.map((i) => i.valor), 0) || 1;
  return el("div", { class: "px-barras" }, itens.map((i) =>
    el("div", { class: "px-barra-linha", title: `${i.nome}: ${formatar(i.valor)}${i.extra ? " · " + i.extra : ""}` }, [
      el("div", { class: "px-barra-nome" }, i.nome),
      el("div", { class: "px-barra-trilho" }, [el("div", { class: "px-barra", style: `width:${Math.max(2, (i.valor / max) * 100)}%` })]),
      el("div", { class: "px-barra-valor" }, formatar(i.valor)),
    ])));
}
function secao(id, titulo, subtitulo) {
  return el("section", { class: "px-secao", id }, [
    el("div", { class: "px-secao-cab" }, [el("h2", {}, titulo), subtitulo ? el("span", { class: "px-secao-sub" }, subtitulo) : null]),
    el("div", { class: "px-corpo" }, [el("div", { class: "px-carregando" }, "Carregando…")]),
  ]);
}
function preencher(id, filhos) {
  const corpo = document.querySelector(`#${id} .px-corpo`);
  corpo.innerHTML = "";
  [].concat(filhos).filter(Boolean).forEach((f) => corpo.appendChild(f));
}
function falha(id, texto) { preencher(id, [el("div", { class: "px-vazio" }, texto)]); }

// ---------- montagem ----------
let painelCarregando = false;
async function carregarPainel() {
  if (painelCarregando) return;
  painelCarregando = true;
  const raiz = document.getElementById("sx-painel");
  const hoje = new Date();
  const nomeMes = `${MESES_PT[hoje.getMonth()]} de ${hoje.getFullYear()}`;
  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "px-topo" }, [
    el("div", {}, [el("h1", {}, "Painel geral"), el("p", { class: "px-secao-sub" }, `Resumo de ${nomeMes} · atualizado às ${String(hoje.getHours()).padStart(2, "0")}:${String(hoje.getMinutes()).padStart(2, "0")}`)]),
    el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => carregarPainel() }, "↻ Atualizar"),
  ]));
  const kpis = el("div", { class: "px-grid px-kpis", id: "px-kpis" });
  raiz.appendChild(kpis);
  raiz.appendChild(secao("px-vendas", "Vendas do mês", "Produção pela data da venda"));
  raiz.appendChild(secao("px-pos", "Pós-vendas", "Adimplência e pagamentos"));
  raiz.appendChild(secao("px-fin", "Financeiro", `Contas e faturamento de ${MESES_PT[hoje.getMonth()]}`));
  raiz.appendChild(secao("px-campanha", "Campanha Rumo à Fortalcity", "Meta: R$ 3 mi em Parcelinha e R$ 1 mi em Adesão"));

  const k = { vendas: null, pos: null, fin: null };
  const desenharKpis = () => {
    kpis.innerHTML = "";
    kpis.appendChild(k.vendas
      ? card("Crédito vendido no mês", brl2.format(k.vendas.credito), `${num.format(k.vendas.qtd)} vendas · ${k.vendas.variacaoTexto}`, { destaque: true })
      : card("Crédito vendido no mês", "…"));
    kpis.appendChild(k.pos
      ? card("Adimplência", pctFmt(k.pos.pctAdimplencia), `${num.format(k.pos.inadimplentes)} inadimplentes de ${num.format(k.pos.acompanhados)}`, { status: k.pos.pctAdimplencia >= 90 ? "bom" : k.pos.pctAdimplencia >= 75 ? "atencao" : "critico" })
      : card("Adimplência", k.pos === false ? "—" : "…", k.pos === false ? "sem acesso aos dados" : null));
    kpis.appendChild(k.fin
      ? card("Resultado do mês", brl2.format(k.fin.resultado), `Faturamento ${brl2.format(k.fin.faturamento)} − despesas ${brl2.format(k.fin.despesas)}`, { status: k.fin.resultado >= 0 ? "bom" : "critico" })
      : card("Resultado do mês", k.fin === false ? "—" : "…"));
    kpis.appendChild(k.fin
      ? card("Saldo em conta", brl2.format(k.fin.saldoConta), "Acumulado até este mês", { status: k.fin.saldoConta >= 0 ? "bom" : "critico" })
      : card("Saldo em conta", k.fin === false ? "—" : "…"));
  };
  desenharKpis();

  await Promise.allSettled([
    painelVendas(hoje).then((r) => { k.vendas = r; desenharKpis(); }).catch((e) => falha("px-vendas", "Não foi possível carregar as vendas: " + e.message)),
    pedirResumo("posvendas").then((r) => { k.pos = r; desenharKpis(); painelPos(r); }).catch(() => { k.pos = false; desenharKpis(); falha("px-pos", "Sem acesso aos dados do pós-vendas para este login."); }),
    pedirResumo("financeiro").then((r) => { k.fin = r; desenharKpis(); painelFin(r); }).catch(() => { k.fin = false; desenharKpis(); falha("px-fin", "Não foi possível carregar o financeiro."); }),
    painelCampanha().catch((e) => falha("px-campanha", "Não foi possível carregar o ranking: " + e.message)),
  ]);
  painelCarregando = false;
}

// ---------- vendas (administrativo) ----------
// mesmos itens da aba Pendências do administrativo (DOC_ITEMS); o comprovante de antecipação só vale para Embracon antecipada
const DOCS_PENDENCIA = ["doc_completa_ok", "contrato_ok", "resumo_ok", "termo_juridico_ok", "gravacao_fechamento_ok", "comprovante_entrada_ok", "ouvir_gravacao_ok", "oferta_lance_ok", "checagem_feito_ok"];
function ehParcelinhaVenda(v) {
  const t = (v.tabela || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return !!v.parcelinha || t.includes("parcelinha");
}
async function painelVendas(hoje) {
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const mesmoDiaAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, Math.min(hoje.getDate(), new Date(hoje.getFullYear(), hoje.getMonth(), 0).getDate()));
  const campos = "id, cliente, vendedor, administradora, valor_venda, data_venda, parcelinha, tabela, parcela_antecipada, " + DOCS_PENDENCIA.join(", ") + ", envio_comprovante_antecipacao_ok";
  const { data: recentes, error } = await sb.from("administrativo_vendas").select(campos).gte("data_venda", isoLocal(inicioAnterior));
  if (error) throw error;
  const credito = (v) => Number(v.valor_venda) || 0;
  const doMes = recentes.filter((v) => v.data_venda >= isoLocal(inicioMes));
  const anteriorAteHoje = recentes.filter((v) => v.data_venda < isoLocal(inicioMes) && v.data_venda <= isoLocal(mesmoDiaAnterior));
  const total = doMes.reduce((s, v) => s + credito(v), 0);
  const totalAnterior = anteriorAteHoje.reduce((s, v) => s + credito(v), 0);
  const variacao = totalAnterior ? ((total - totalAnterior) / totalAnterior) * 100 : null;
  const variacaoTexto = variacao === null ? "sem base no mês anterior"
    : `${variacao >= 0 ? "▲" : "▼"} ${pctFmt(Math.abs(variacao))} vs mesmo período do mês anterior`;
  const parcelinha = doMes.filter(ehParcelinhaVenda);
  const normal = doMes.filter((v) => !ehParcelinhaVenda(v));
  const hojeISO = isoLocal(hoje);
  const vendasHoje = doMes.filter((v) => v.data_venda === hojeISO);

  const agrupar = (lista, chave) => {
    const m = new Map();
    lista.forEach((v) => { const c = chave(v) || "—"; const x = m.get(c) || { nome: c, valor: 0, qtd: 0 }; x.valor += credito(v); x.qtd++; m.set(c, x); });
    return [...m.values()].sort((a, b) => b.valor - a.valor).map((x) => ({ ...x, extra: `${x.qtd} venda${x.qtd > 1 ? "s" : ""}` }));
  };
  const pendentes = doMes.filter((v) => {
    const docs = [...DOCS_PENDENCIA];
    if (v.administradora === "Embracon" && v.parcela_antecipada) docs.push("envio_comprovante_antecipacao_ok");
    return docs.some((d) => !v[d]);
  });

  preencher("px-vendas", [
    el("div", { class: "px-grid" }, [
      card("Vendas no mês", num.format(doMes.length), `Ticket médio ${doMes.length ? brl2.format(total / doMes.length) : "—"}`),
      card("Parcelinha", brl2.format(parcelinha.reduce((s, v) => s + credito(v), 0)), `${parcelinha.length} vendas`),
      card("Adesão", brl2.format(normal.reduce((s, v) => s + credito(v), 0)), `${normal.length} vendas`),
      card("Vendas hoje", num.format(vendasHoje.length), vendasHoje.length ? brl2.format(vendasHoje.reduce((s, v) => s + credito(v), 0)) : "nenhuma ainda"),
      card("Documentação pendente", num.format(pendentes.length), pendentes.length ? "vendas do mês com documento faltando" : "tudo em dia neste mês", { status: pendentes.length ? "atencao" : "bom" }),
    ]),
    el("div", { class: "px-grid px-duplo" }, [
      el("div", { class: "px-card px-lista" }, [el("div", { class: "px-titulo" }, "Crédito por administradora"), barras(agrupar(doMes, (v) => v.administradora), (x) => brl2.format(x))]),
      el("div", { class: "px-card px-lista" }, [el("div", { class: "px-titulo" }, "Top vendedores do mês"), barras(agrupar(doMes, (v) => v.vendedor).slice(0, 6), (x) => brl2.format(x))]),
    ]),
  ]);
  return { credito: total, qtd: doMes.length, variacaoTexto };
}

// ---------- pós-vendas ----------
function painelPos(r) {
  preencher("px-pos", el("div", { class: "px-grid" }, [
    card("Inadimplentes", num.format(r.inadimplentes), `${num.format(r.emAtraso)} em atraso · ${num.format(r.canceladas)} canceladas`, { status: r.inadimplentes ? "critico" : "bom" }),
    card("Crédito em atraso", brl2.format(r.creditoAtraso), `${pctFmt(r.creditoTotal ? (r.creditoAtraso / r.creditoTotal) * 100 : null)} de ${brl2.format(r.creditoTotal)} acompanhados`),
    card("Pagaram no mês", num.format(r.confirmados.clientes), `${num.format(r.confirmados.parcelas)} parcelas · ${brl2.format(r.confirmados.credito)} em crédito`),
    card("Vencem em 7 dias", num.format(r.vencem7), "parcelas ainda sem baixa" + (r.semVencimento ? ` · ${num.format(r.semVencimento)} cliente${r.semVencimento > 1 ? "s" : ""} sem dia de vencimento no grupo` : ""), { status: r.semVencimento ? "atencao" : null }),
    card("Contempladas", num.format(r.contempladas), "cotas marcadas como contempladas"),
  ]));
}

// ---------- financeiro ----------
function painelFin(r) {
  const contas = r.proximas7.itens.length
    ? el("div", { class: "px-card px-lista" }, [
      el("div", { class: "px-titulo" }, "Próximas contas (7 dias)"),
      el("ul", { class: "px-itens" }, r.proximas7.itens.map((i) => el("li", {}, [el("span", {}, `${dataBR(i.vencimento)} · ${i.nome}`), el("strong", {}, brl2.format(i.valor))]))),
    ])
    : null;
  preencher("px-fin", [
    el("div", { class: "px-grid" }, [
      card("Faturamento do mês", brl2.format(r.faturamento), "receitas lançadas"),
      card("Despesas do mês", brl2.format(r.despesas), `${brl2.format(r.pagas)} pagas · ${brl2.format(r.pendentes)} a pagar`),
      card("Contas vencidas", num.format(r.vencidas.qtd), r.vencidas.qtd ? `${brl2.format(r.vencidas.valor)} em aberto` : "nenhuma em atraso", { status: r.vencidas.qtd ? "critico" : "bom" }),
      card("A pagar em 7 dias", brl2.format(r.proximas7.valor), `${num.format(r.proximas7.qtd)} conta${r.proximas7.qtd === 1 ? "" : "s"}`, { status: r.proximas7.qtd ? "atencao" : "bom" }),
    ]),
    contas,
  ]);
}

// ---------- campanha ----------
async function painelCampanha() {
  const { data, error } = await sb.from("campanha_ranking").select("vendedor, total_parcelinha, total_normal, ultima_venda_em");
  if (error) throw error;
  const lista = (data || []).map((r) => ({
    nome: r.vendedor,
    p: Number(r.total_parcelinha) || 0,
    n: Number(r.total_normal) || 0,
  }));
  const ganhadores = lista.filter((x) => x.p >= PAINEL_META_PARCELINHA && x.n >= PAINEL_META_NORMAL);
  const totalP = lista.reduce((s, x) => s + x.p, 0);
  const totalN = lista.reduce((s, x) => s + x.n, 0);
  // progresso de cada um: média do quanto já cumpriu de cada meta (limitada a 100% por meta)
  const progresso = lista.map((x) => ({ ...x, prog: (Math.min(1, x.p / PAINEL_META_PARCELINHA) + Math.min(1, x.n / PAINEL_META_NORMAL)) / 2 }))
    .sort((a, b) => b.prog - a.prog).slice(0, 5);
  preencher("px-campanha", [
    el("div", { class: "px-grid" }, [
      card("Parcelinha no time", brl2.format(totalP), "somando todos os vendedores"),
      card("Adesão no time", brl2.format(totalN), "somando todos os vendedores"),
      card("Viagens garantidas", num.format(ganhadores.length), ganhadores.length ? ganhadores.map((g) => g.nome).join(", ") : "ninguém bateu as duas metas ainda", { status: ganhadores.length ? "bom" : null }),
    ]),
    el("div", { class: "px-card px-lista" }, [
      el("div", { class: "px-titulo" }, "Mais perto da viagem (média das duas metas)"),
      barras(progresso.map((x) => ({ nome: x.nome, valor: x.prog * 100, extra: `Parcelinha ${brl2.format(x.p)} · Adesão ${brl2.format(x.n)}` })), (v) => pctFmt(v)),
    ]),
  ]);
}
