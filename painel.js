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
    el("div", { class: "px-valor" + (opts.sensivel ? " px-din" : "") }, valor),
    sub ? el("div", { class: "px-sub" + (opts.subSensivel ? " px-din" : "") }, sub) : null,
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
// salários dos vendedores (RPC recebimentos_equipe — sql/019): só folhas pagas, sem descontar vales
const RECEB_FORA = ["Railton Angelo"]; // gestão que também tem cadastro de vendedor
async function blocoRecebimentosEquipe(id) {
  const { data, error } = await sb.rpc("recebimentos_equipe");
  if (error || !data) { falha(id, "Não foi possível carregar os salários."); return; }
  const lista = data.filter((x) => !RECEB_FORA.includes(x.nome));
  if (!lista.length) { preencher(id, el("div", { class: "px-vazio" }, "Nenhuma folha paga nos últimos 12 meses.")); return; }
  // colunas = meses que aparecem em alguma folha (do mais antigo ao mais novo)
  const meses = [...new Set(lista.flatMap((x) => x.meses.map((m) => m.mes)))].sort();
  const maior = Math.max(1, ...lista.flatMap((x) => x.meses.map((m) => Number(m.valor) || 0)));
  const totalTime = lista.reduce((s, x) => s + Number(x.total), 0);
  const ultimoMes = meses[meses.length - 1];
  const totalUltimo = lista.reduce((s, x) => s + (Number((x.meses.find((m) => m.mes === ultimoMes) || {}).valor) || 0), 0);
  const nomeMes = (iso) => { const [y, m] = iso.split("-"); return `${MESES_PT[Number(m) - 1].slice(0, 3).toLowerCase()}/${y.slice(2)}`; };
  const cab = el("tr", {}, [
    el("th", {}, "Vendedor"),
    ...meses.map((m) => el("th", { class: "rc-num" }, nomeMes(m))),
    el("th", { class: "rc-num" }, "Total 12 meses"),
    el("th", { class: "rc-num" }, "Média/mês"),
  ]);
  const linhas = lista.map((x) => {
    const porMes = new Map(x.meses.map((m) => [m.mes, Number(m.valor) || 0]));
    return el("tr", {}, [
      el("td", { class: "rc-nome" }, x.nome),
      ...meses.map((m) => {
        const v = porMes.get(m);
        return el("td", { class: "rc-num" }, v === undefined ? el("span", { class: "rc-sem" }, "—") : el("div", { class: "rc-cel" }, [
          el("div", { class: "rc-barra" }, el("div", { style: `width:${Math.max(3, (v / maior) * 100)}%` })),
          el("span", {}, brl2.format(v)),
        ]));
      }),
      el("td", { class: "rc-num rc-total" }, brl2.format(Number(x.total))),
      el("td", { class: "rc-num" }, brl2.format(Number(x.total) / Math.max(1, x.folhas))),
    ]);
  });
  preencher(id, [
    el("div", { class: "px-grid px-kpis" }, [
      card("Pago aos vendedores (12 meses)", brl2.format(totalTime), `${lista.length} vendedores ativos`, { destaque: true }),
      card(`Folha de ${MESES_PT[Number(ultimoMes.slice(5, 7)) - 1].toLowerCase()}`, brl2.format(totalUltimo), "última folha paga"),
      card("Maior recebido (12 meses)", brl2.format(Number(lista[0].total)), lista[0].nome),
    ]),
    el("div", { class: "px-card rc-tabela-wrap" }, el("table", { class: "rc-tabela" }, [el("thead", {}, cab), el("tbody", {}, linhas)])),
  ]);
}

function falha(id, texto) { preencher(id, [el("div", { class: "px-vazio" }, texto)]); }

// ---------- olhinho: esconder os valores de Resultado do mês e Saldo em conta ----------
// A escolha fica salva neste aparelho.
const PX_OCULTAR = "px-ocultar-valores";
function pxOculto() { try { return localStorage.getItem(PX_OCULTAR) === "1"; } catch (e) { return false; } }
function pxAplicarOculto(raiz) {
  const oculto = pxOculto();
  raiz.classList.toggle("px-oculto", oculto);
  const b = document.getElementById("px-olho");
  if (b) {
    b.textContent = oculto ? "🙈 Mostrar valores" : "👁 Ocultar valores";
    b.setAttribute("aria-pressed", oculto ? "true" : "false");
    b.title = oculto ? "Mostrar Resultado do mês e Saldo em conta" : "Esconder Resultado do mês e Saldo em conta";
  }
}
function pxBotaoOlho(raiz) {
  const b = el("button", { type: "button", id: "px-olho", class: "btn btn-secondary btn-sm px-olho", onclick: () => {
    try { localStorage.setItem(PX_OCULTAR, pxOculto() ? "0" : "1"); } catch (e) { raiz.classList.toggle("px-oculto"); return; }
    pxAplicarOculto(raiz);
  } });
  setTimeout(() => pxAplicarOculto(raiz), 0);
  return b;
}

// ---------- montagem ----------
let painelCarregando = false;
async function carregarPainel() {
  if (painelCarregando) return;
  painelCarregando = true;
  const raiz = document.getElementById("sx-painel");
  const hoje = new Date();
  const nomeMes = `${MESES_PT[hoje.getMonth()]} de ${hoje.getFullYear()}`;
  raiz.innerHTML = "";
  pxAplicarOculto(raiz);
  raiz.appendChild(el("div", { class: "px-topo" }, [
    el("div", {}, [el("h1", {}, "Painel geral"), el("p", { class: "px-secao-sub" }, `Resumo de ${nomeMes} · atualizado às ${String(hoje.getHours()).padStart(2, "0")}:${String(hoje.getMinutes()).padStart(2, "0")}`)]),
    el("div", { class: "px-topo-acoes" }, [
      pxBotaoOlho(raiz),
      el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => carregarPainel() }, "↻ Atualizar"),
    ]),
  ]));
  const kpis = el("div", { class: "px-grid px-kpis", id: "px-kpis" });
  raiz.appendChild(kpis);
  raiz.appendChild(secao("px-metas", "Metas do mês", "Empresa, equipes e cada vendedor · crédito vendido no mês"));
  raiz.appendChild(secao("px-ritmo", "Ritmo e projeção do mês", "Comparação com o mesmo período dos meses anteriores e projeção de fechamento no ritmo deles"));
  raiz.appendChild(secao("px-vendas", "Vendas do mês", "Produção pela data da venda"));
  raiz.appendChild(secao("px-pos", "Pós-vendas", "Adimplência e pagamentos"));
  raiz.appendChild(secao("px-fin", "Financeiro", `Contas e faturamento de ${MESES_PT[hoje.getMonth()]}`));
  raiz.appendChild(secao("px-campanha", "Campanha Rumo à Fortalcity", "Meta: R$ 3 mi em Parcelinha e R$ 1 mi em Adesão"));
  raiz.appendChild(secao("px-sonhos", "Próximas conquistas do time", "O que cada vendedor quer conquistar · progresso pela comissão desde o cadastro"));
  blocoSonhosEquipe("px-sonhos").catch(() => falha("px-sonhos", "Não foi possível carregar as conquistas do time."));
  raiz.appendChild(secao("px-receb", "Salários dos vendedores", "Recebido nos últimos 12 meses pela folha de pagamento · salário + comissões + bônus, sem descontos"));
  blocoRecebimentosEquipe("px-receb").catch(() => falha("px-receb", "Não foi possível carregar os salários."));

  const k = { vendas: null, pos: null, fin: null };
  const desenharKpis = () => {
    kpis.innerHTML = "";
    kpis.appendChild(k.vendas
      ? card("Crédito vendido no mês", brl2.format(k.vendas.credito), `${num.format(k.vendas.qtd)} venda${k.vendas.qtd === 1 ? "" : "s"} · ${k.vendas.variacaoTexto}`, { destaque: true })
      : card("Crédito vendido no mês", "…"));
    kpis.appendChild(k.pos
      ? card("Adimplência", pctFmt(k.pos.pctAdimplencia), `${num.format(k.pos.inadimplentes)} inadimplentes de ${num.format(k.pos.acompanhados)}`, { status: k.pos.pctAdimplencia >= 90 ? "bom" : k.pos.pctAdimplencia >= 75 ? "atencao" : "critico" })
      : card("Adimplência", k.pos === false ? "—" : "…", k.pos === false ? "sem acesso aos dados" : null));
    kpis.appendChild(k.fin
      ? card("Resultado do mês", brl2.format(k.fin.resultado), `Faturamento ${brl2.format(k.fin.faturamento)} − despesas ${brl2.format(k.fin.despesas)}`, { status: k.fin.resultado >= 0 ? "bom" : "critico", sensivel: true, subSensivel: true })
      : card("Resultado do mês", k.fin === false ? "—" : "…"));
    kpis.appendChild(k.fin
      ? card("Saldo em conta", brl2.format(k.fin.saldoConta), "Acumulado até este mês", { status: k.fin.saldoConta >= 0 ? "bom" : "critico", sensivel: true })
      : card("Saldo em conta", k.fin === false ? "—" : "…"));
  };
  desenharKpis();

  await Promise.allSettled([
    painelVendas(hoje).then((r) => { k.vendas = r; desenharKpis(); }).catch((e) => falha("px-vendas", "Não foi possível carregar as vendas: " + e.message)),
    pedirResumo("posvendas").then((r) => { k.pos = r; desenharKpis(); painelPos(r); }).catch(() => { k.pos = false; desenharKpis(); falha("px-pos", "Sem acesso aos dados do pós-vendas para este login."); }),
    pedirResumo("financeiro").then((r) => { k.fin = r; desenharKpis(); painelFin(r); }).catch(() => { k.fin = false; desenharKpis(); falha("px-fin", "Não foi possível carregar o financeiro."); }),
    painelRitmo(hoje).catch((e) => falha("px-ritmo", "Não foi possível calcular a projeção: " + (e.message || e))),
    painelCampanha().catch((e) => falha("px-campanha", "Não foi possível carregar o ranking: " + e.message)),
    buscarMetas(hoje).then((r) => { preencher("px-metas", [blocoColetivas(r), tabelaVendedores(r.vendedores || [])]); verificarConquistas(r); })
      .catch((e) => falha("px-metas", "Não foi possível carregar as metas: " + (e.message || e))),
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

// ---------- ritmo e projeção ----------
// Produção (crédito vendido) até o dia de hoje comparada ao mesmo período dos meses fechados, e projeção
// de fechamento: em média, até o dia D os meses anteriores tinham feito X% do total do mês → atual ÷ X%.
// Só entram meses a partir de set/2026: jul e ago foram importados com a data de venda no início do mês.
const RITMO_INICIO = "2026-09-01";
const RITMO_MESES = 6; // no máximo os 6 meses fechados mais recentes
const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
function compactoBRL(v) {
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (Math.abs(v) >= 1e3) return `R$ ${Math.round(v / 1e3).toLocaleString("pt-BR")} mil`;
  return brl2.format(v);
}
async function painelRitmo(hoje) {
  const ano = hoje.getFullYear(), mes = hoje.getMonth(), dia = hoje.getDate();
  const inicioHist = new Date(ano, mes - RITMO_MESES, 1);
  const desde = isoLocal(inicioHist) > RITMO_INICIO ? isoLocal(inicioHist) : RITMO_INICIO;
  const [{ data, error }, metas] = await Promise.all([
    sb.from("administrativo_vendas").select("data_venda, valor_venda, parcelinha, tabela").gte("data_venda", desde).lte("data_venda", isoLocal(hoje)),
    buscarMetas(hoje).catch(() => null),
  ]);
  if (error) throw error;

  // acumulado por dia de cada mês
  const meses = new Map(); // "YYYY-MM" → { chave, dias, porDia[], qtdAte[] }
  const chaveDe = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const garantir = (y, m) => {
    const k = chaveDe(y, m);
    if (!meses.has(k)) { const dias = new Date(y, m + 1, 0).getDate(); meses.set(k, { chave: k, ano: y, mes: m, dias, porDia: Array(dias + 1).fill(0), qtdDia: Array(dias + 1).fill(0), p: 0, a: 0 }); }
    return meses.get(k);
  };
  for (let d = new Date(desde + "T12:00:00"); d <= hoje; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) garantir(d.getFullYear(), d.getMonth());
  (data || []).forEach((v) => {
    const [y, m, d] = v.data_venda.slice(0, 10).split("-").map(Number);
    const x = garantir(y, m - 1);
    const val = Number(v.valor_venda) || 0;
    x.porDia[d] += val; x.qtdDia[d]++;
    if (ehParcelinhaVenda(v)) x.p += val; else x.a += val;
  });
  const lista = [...meses.values()].sort((a, b) => a.chave.localeCompare(b.chave));
  lista.forEach((x) => {
    x.acum = [0]; x.qtdAcum = [0];
    for (let d = 1; d <= x.dias; d++) { x.acum[d] = x.acum[d - 1] + x.porDia[d]; x.qtdAcum[d] = x.qtdAcum[d - 1] + x.qtdDia[d]; }
    x.total = x.acum[x.dias];
    x.nome = MESES_PT[x.mes];
    x.curto = MESES_PT[x.mes].slice(0, 3);
  });
  const atual = lista.find((x) => x.chave === chaveDe(ano, mes)) || garantir(ano, mes);
  const fechados = lista.filter((x) => x.chave < atual.chave && x.total > 0);
  const ateHoje = atual.acum[dia], qtdHoje = atual.qtdAcum[dia];
  const diaDe = (x) => Math.min(dia, x.dias);
  fechados.forEach((x) => { x.ateDia = x.acum[diaDe(x)]; x.qtdAteDia = x.qtdAcum[diaDe(x)]; x.parte = x.ateDia / x.total; });
  const anterior = fechados[fechados.length - 1] || null;

  // projeção: proporção média (ponderada pelo volume) que os meses fechados tinham feito até o dia D
  const somaAte = fechados.reduce((s, x) => s + x.ateDia, 0);
  const somaTot = fechados.reduce((s, x) => s + x.total, 0);
  const parte = somaTot ? somaAte / somaTot : 0;
  const projecao = parte > 0 ? ateHoje / parte : null;
  const cenarios = fechados.filter((x) => x.parte > 0).map((x) => ({ x, v: ateHoje / x.parte }));
  const minC = cenarios.length ? cenarios.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const maxC = cenarios.length ? cenarios.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const meta = metas && metas.empresa ? (Number(metas.empresa.meta_parcelinha) || 0) + (Number(metas.empresa.meta_adesao) || 0) : 0;
  const restantes = atual.dias - dia;

  const cards = [];
  cards.push(card(`Produção até hoje (1 a ${dia}/${String(mes + 1).padStart(2, "0")})`, brl2.format(ateHoje), `${num.format(qtdHoje)} venda${qtdHoje === 1 ? "" : "s"} · ${restantes} dia${restantes === 1 ? "" : "s"} para fechar o mês`));
  if (anterior) {
    const varA = anterior.ateDia ? ((ateHoje - anterior.ateDia) / anterior.ateDia) * 100 : null;
    cards.push(card(`Mesmo período de ${anterior.nome} (1 a ${diaDe(anterior)})`, brl2.format(anterior.ateDia),
      (varA === null ? "sem vendas nesse período" : `${varA >= 0 ? "▲" : "▼"} ${pctFmt(Math.abs(varA))} ${varA >= 0 ? "acima" : "abaixo"} · `) + `${num.format(anterior.qtdAteDia)} vendas · fechou em ${compactoBRL(anterior.total)}`,
      { status: varA === null ? null : varA >= 0 ? "bom" : "atencao" }));
  }
  if (projecao !== null) {
    const faixa = minC && maxC && cenarios.length > 1 ? ` · entre ${compactoBRL(minC.v)} (ritmo de ${minC.x.curto}) e ${compactoBRL(maxC.v)} (ritmo de ${maxC.x.curto})` : "";
    cards.push(card("Projeção de fechamento", brl0.format(projecao),
      `até o dia ${dia} costuma sair ${pctFmt(parte * 100)} do mês${faixa}`, { destaque: true }));
    if (meta > 0) {
      const pctMeta = (projecao / meta) * 100;
      const falta = Math.max(0, meta - ateHoje);
      cards.push(card("Projeção × meta do mês", pctFmt(pctMeta),
        `meta ${compactoBRL(meta)} · ${falta > 0 ? `faltam ${compactoBRL(falta)}${restantes > 0 ? ` (${compactoBRL(falta / restantes)} por dia)` : ""}` : "meta batida 🎉"}`,
        { status: pctMeta >= 100 ? "bom" : pctMeta >= 80 ? "atencao" : "critico" }));
    }
  } else {
    cards.push(card("Projeção de fechamento", "—", "ainda não há meses fechados suficientes para projetar"));
  }

  const aviso = projecao !== null && dia < 7 ? el("div", { class: "px-sub rt-aviso" }, "Início de mês: a projeção oscila bastante nos primeiros dias e fica mais confiável a partir da segunda semana.") : null;
  const parteAtualP = ateHoje ? atual.p / ateHoje : 0;
  const divisao = projecao !== null && ateHoje > 0 ? el("div", { class: "px-sub rt-aviso" },
    `Mantida a divisão atual: Parcelinha ≈ ${compactoBRL(projecao * parteAtualP)} · Adesão ≈ ${compactoBRL(projecao * (1 - parteAtualP))}.`) : null;

  // tabela de transparência: cada mês fechado até o dia D
  const tabela = fechados.length ? el("div", { class: "px-card rc-tabela-wrap" }, el("table", { class: "rc-tabela" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Mês"), el("th", { class: "rc-num" }, `Até o dia ${dia}`), el("th", { class: "rc-num" }, "Mês fechado"), el("th", { class: "rc-num" }, `% feito até o dia ${dia}`), el("th", { class: "rc-num" }, "Se repetir esse ritmo")])),
    el("tbody", {}, [
      ...fechados.slice().reverse().map((x) => el("tr", {}, [
        el("td", { class: "rc-nome" }, `${x.nome}/${String(x.ano).slice(2)}`),
        el("td", { class: "rc-num" }, brl2.format(x.ateDia)),
        el("td", { class: "rc-num" }, brl2.format(x.total)),
        el("td", { class: "rc-num" }, pctFmt(x.parte * 100)),
        el("td", { class: "rc-num" }, x.parte > 0 ? brl0.format(ateHoje / x.parte) : "—"),
      ])),
      el("tr", { class: "rt-linha-atual" }, [
        el("td", { class: "rc-nome" }, `${atual.nome}/${String(atual.ano).slice(2)} (atual)`),
        el("td", { class: "rc-num rc-total" }, brl2.format(ateHoje)),
        el("td", { class: "rc-num" }, projecao !== null ? `≈ ${brl0.format(projecao)}` : "—"),
        el("td", { class: "rc-num" }, pctFmt(parte * 100)),
        el("td", { class: "rc-num" }, "média ponderada"),
      ]),
    ]),
  ])) : null;

  preencher("px-ritmo", [el("div", { class: "px-grid px-kpis" }, cards), aviso, divisao, graficoRitmo(atual, fechados, dia, projecao, meta), tabela]);
}

// cor fixa por mês do calendário (o mesmo mês mantém a cor; meses vizinhos nunca repetem).
// O roxo fica reservado para o mês atual e a projeção.
const CORES_MESES_RITMO = ["#22d3ee", "#f59e0b", "#ec4899", "#10b981", "#f97316", "#3b82f6"];
const corMesRitmo = (x) => CORES_MESES_RITMO[x.mes % CORES_MESES_RITMO.length];

// curva acumulada do mês atual × meses fechados, com a projeção tracejada até o fim do mês
function graficoRitmo(atual, fechados, dia, projecao, meta) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 760, H = 260, L = 64, R = 118, T = 14, B = 28;
  const maxDias = Math.max(atual.dias, ...fechados.map((x) => x.dias));
  const topo = Math.max(1, projecao || 0, meta || 0, atual.acum[dia], ...fechados.map((x) => x.total)) * 1.06;
  const X = (d) => L + ((d - 1) / (maxDias - 1)) * (W - L - R);
  const Y = (v) => T + (1 - v / topo) * (H - T - B);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "rt-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Produção acumulada por dia do mês: mês atual, meses anteriores e projeção");
  const add = (tag, at, txt) => { const n = document.createElementNS(NS, tag); Object.entries(at).forEach(([k, v]) => n.setAttribute(k, v)); if (txt !== undefined) n.textContent = txt; svg.appendChild(n); return n; };
  // grade + eixo y (4 linhas)
  const passo = (() => { const bruto = topo / 4; const p = Math.pow(10, Math.floor(Math.log10(bruto))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= bruto) || bruto; })();
  for (let v = 0; v <= topo; v += passo) {
    add("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: "rt-grade" });
    add("text", { x: L - 8, y: Y(v) + 4, class: "rt-eixo", "text-anchor": "end" }, v === 0 ? "0" : compactoBRL(v).replace("R$ ", ""));
  }
  [1, 5, 10, 15, 20, 25, 30].filter((d) => d <= maxDias).forEach((d) => add("text", { x: X(d), y: H - 8, class: "rt-eixo", "text-anchor": "middle" }, String(d)));
  if (meta > 0) {
    add("line", { x1: L, x2: W - R, y1: Y(meta), y2: Y(meta), class: "rt-meta" });
    add("text", { x: L + 6, y: Y(meta) - 6, class: "rt-eixo rt-meta-txt" }, `meta ${compactoBRL(meta)}`);
  }
  const caminho = (x, ate) => { let p = ""; for (let d = 1; d <= ate; d++) p += `${d === 1 ? "M" : "L"}${X(d).toFixed(1)},${Y(x.acum[d]).toFixed(1)}`; return p; };
  const rotulos = [];
  const anterior = fechados[fechados.length - 1];
  fechados.forEach((x) => {
    add("path", { d: caminho(x, x.dias), class: "rt-linha rt-passado", style: `stroke:${corMesRitmo(x)}` });
    rotulos.push({ y: Y(x.total), txt: `${x.curto} ${compactoBRL(x.total).replace("R$ ", "")}`, cls: "rt-rot-passado", cor: corMesRitmo(x) });
  });
  if (projecao !== null && dia < atual.dias) {
    add("path", { d: `M${X(dia)},${Y(atual.acum[dia])}L${X(atual.dias)},${Y(projecao)}`, class: "rt-linha rt-projecao" });
    add("circle", { cx: X(atual.dias), cy: Y(projecao), r: 4, class: "rt-ponto-proj" });
    rotulos.push({ y: Y(projecao), txt: `projeção ${compactoBRL(projecao).replace("R$ ", "")}`, cls: "rt-rot-atual" });
  }
  add("path", { d: caminho(atual, dia), class: "rt-linha rt-atual" });
  add("circle", { cx: X(dia), cy: Y(atual.acum[dia]), r: 4.5, class: "rt-ponto" });
  // rótulos diretos à direita, afastados para não encostar
  rotulos.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rotulos.length; i++) if (rotulos[i].y - rotulos[i - 1].y < 14) rotulos[i].y = rotulos[i - 1].y + 14;
  rotulos.forEach((r) => {
    if (r.cor) add("line", { x1: W - R + 6, x2: W - R + 16, y1: r.y, y2: r.y, class: "rt-rot-marca", style: `stroke:${r.cor}` });
    add("text", { x: W - R + (r.cor ? 21 : 8), y: r.y + 4, class: "rt-rot " + r.cls }, r.txt);
  });
  // dica ao passar o mouse: uma faixa por dia
  const largura = (W - L - R) / (maxDias - 1);
  for (let d = 1; d <= maxDias; d++) {
    const linhas = [`Dia ${d}`];
    if (d <= dia) linhas.push(`${atual.nome}: ${brl2.format(atual.acum[d])}`);
    fechados.slice().reverse().forEach((x) => { if (d <= x.dias) linhas.push(`${x.nome}: ${brl2.format(x.acum[d])}`); });
    const r = add("rect", { x: X(d) - largura / 2, y: T, width: largura, height: H - T - B, class: "rt-alvo" });
    const t = document.createElementNS(NS, "title"); t.textContent = linhas.join("\n"); r.appendChild(t);
  }
  const legenda = el("div", { class: "rt-legenda" }, [
    el("span", {}, [el("i", { class: "rt-leg rt-leg-atual" }), `${atual.nome} (até hoje)`]),
    projecao !== null ? el("span", {}, [el("i", { class: "rt-leg rt-leg-proj" }), "projeção"]) : null,
    ...fechados.slice().reverse().map((x) => el("span", {}, [el("i", { class: "rt-leg", style: `border-top-color:${corMesRitmo(x)}` }), x.nome])),
  ]);
  return el("div", { class: "px-card rt-grafico" }, [el("div", { class: "px-titulo" }, "Produção acumulada no mês, dia a dia"), legenda, svg]);
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
  const [{ data, error }, sup] = await Promise.all([
    sb.from("campanha_ranking").select("vendedor, total_parcelinha, total_normal, ultima_venda_em"),
    buscarSupervisao().catch(() => []),
  ]);
  if (error) throw error;
  verificarConquistasSupervisao(sup);
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
    sup.length ? el("div", { class: "px-grid px-duplo" }, sup.map(cardFortal)) : null,
  ]);
}
