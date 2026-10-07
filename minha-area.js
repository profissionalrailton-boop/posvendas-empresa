// Minha área (vendedor): página inicial de quem entra como vendedor. Mostra a produção do mês contra
// a meta individual (Parcelinha + Adesão, cadastrada pela gestão em vendedor_metas), as próprias
// vendas, documentos que faltam enviar e o andamento na campanha. Usa os blocos do painel.js.
// Dados: RPC vendedor_minhas_vendas (só as vendas dele, sem dados sensíveis — sql/012),
// vendedor_metas (RLS: só a própria) e campanha_ranking (pública).

// documentos que dependem do vendedor (os da administração — ouvir gravação, checagem, lance — ficam de fora)
const MA_DOCS = [
  { key: "doc_completa_ok", label: "Doc completa" },
  { key: "contrato_ok", label: "Contrato" },
  { key: "resumo_ok", label: "Resumo" },
  { key: "termo_juridico_ok", label: "Termo jurídico" },
  { key: "gravacao_fechamento_ok", label: "Gravação de fechamento" },
  { key: "comprovante_entrada_ok", label: "Comprovante de entrada" },
  { key: "envio_comprovante_antecipacao_ok", label: "Comprovante de parcela antecipada", condicao: (v) => v.administradora === "Embracon" && v.parcela_antecipada },
];
const MA_MESES_PENDENCIA = 4; // pendências de documento das vendas dos últimos meses

function docsFaltando(v) {
  return MA_DOCS.filter((d) => (!d.condicao || d.condicao(v)) && !v[d.key]).map((d) => d.label);
}
function primeiroNome(nome) { return (nome || "").trim().split(/\s+/)[0] || ""; }

// barra de progresso da meta (uma cor; o texto ao lado diz o número)
function progresso(feito, meta) {
  const pct = meta > 0 ? Math.min(100, (feito / meta) * 100) : 0;
  return el("div", { class: "px-progresso", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct)) }, [
    el("div", { class: "px-progresso-barra" + (meta > 0 && feito >= meta ? " completo" : ""), style: `width:${Math.max(meta > 0 && feito > 0 ? 2 : 0, pct)}%` }),
  ]);
}
function cardMeta(titulo, feito, meta, qtd) {
  if (!meta) {
    return card(titulo, brl2.format(feito), `${num.format(qtd)} venda${qtd === 1 ? "" : "s"} · meta ainda não definida`);
  }
  const falta = Math.max(0, meta - feito);
  const bateu = feito >= meta;
  const c = card(titulo, brl2.format(feito),
    bateu ? `Meta de ${brl2.format(meta)} batida! ✔` : `de ${brl2.format(meta)} · faltam ${brl2.format(falta)}`,
    { status: bateu ? "bom" : null, destaque: !bateu });
  c.appendChild(progresso(feito, meta));
  c.appendChild(el("div", { class: "px-sub px-pct" }, `${pctFmt((feito / meta) * 100)} da meta · ${num.format(qtd)} venda${qtd === 1 ? "" : "s"}`));
  return c;
}

let minhaAreaCarregando = false;
async function carregarMinhaArea() {
  if (minhaAreaCarregando) return;
  minhaAreaCarregando = true;
  const raiz = document.getElementById("sx-minha-area");
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const nomeMes = `${MESES_PT[hoje.getMonth()]} de ${hoje.getFullYear()}`;
  raiz.innerHTML = "";
  const titulo = el("h1", {}, "Minha área");
  raiz.appendChild(el("div", { class: "px-topo" }, [
    el("div", {}, [titulo, el("p", { class: "px-secao-sub" }, `Sua produção em ${nomeMes} · atualizado às ${String(hoje.getHours()).padStart(2, "0")}:${String(hoje.getMinutes()).padStart(2, "0")}`)]),
    el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => carregarMinhaArea() }, "↻ Atualizar"),
  ]));
  const kpis = el("div", { class: "px-grid px-kpis" }, [el("div", { class: "px-carregando" }, "Carregando…")]);
  raiz.appendChild(kpis);
  raiz.appendChild(secao("ma-vendas", "Minhas vendas do mês", "Pela data da venda"));
  raiz.appendChild(secao("ma-pendencias", "Documentos que faltam enviar", `Vendas dos últimos ${MA_MESES_PENDENCIA} meses`));
  raiz.appendChild(secao("ma-campanha", "Campanha Rumo à Fortalcity", "Meta: R$ 3 mi em Parcelinha e R$ 1 mi em Adesão"));

  try {
    const desde = new Date(hoje.getFullYear(), hoje.getMonth() - (MA_MESES_PENDENCIA - 1), 1);
    const [{ data: acesso }, { data: vendas, error: eV }, { data: metas, error: eM }] = await Promise.all([
      sb.from("posvendas_vendedor_acesso").select("vendedor").limit(1),
      sb.rpc("vendedor_minhas_vendas", { p_desde: isoLocal(desde) }),
      sb.from("vendedor_metas").select("mes, meta_parcelinha, meta_adesao").lte("mes", isoLocal(inicioMes)).order("mes", { ascending: false }).limit(1),
    ]);
    if (eV) throw eV;
    if (eM) throw eM;
    const meuNome = acesso && acesso[0] ? acesso[0].vendedor : "";
    if (meuNome) titulo.textContent = `Olá, ${primeiroNome(meuNome)}`;
    const meta = metas && metas[0] ? { p: Number(metas[0].meta_parcelinha) || 0, a: Number(metas[0].meta_adesao) || 0 } : { p: 0, a: 0 };

    const credito = (v) => Number(v.valor_venda) || 0;
    const doMes = (vendas || []).filter((v) => v.data_venda >= isoLocal(inicioMes));
    const parc = doMes.filter((v) => v.parcelinha);
    const ades = doMes.filter((v) => !v.parcelinha);
    const totalP = parc.reduce((s, v) => s + credito(v), 0);
    const totalA = ades.reduce((s, v) => s + credito(v), 0);
    const total = totalP + totalA;
    // ritmo: se continuar vendendo como até hoje, quanto fecha o mês
    const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const projecao = hoje.getDate() > 0 ? (total / hoje.getDate()) * diasNoMes : 0;
    const pendentes = (vendas || []).map((v) => ({ v, faltam: docsFaltando(v) })).filter((x) => x.faltam.length);

    kpis.innerHTML = "";
    kpis.appendChild(cardMeta("Meta Parcelinha", totalP, meta.p, parc.length));
    kpis.appendChild(cardMeta("Meta Adesão", totalA, meta.a, ades.length));
    kpis.appendChild(card("Total vendido no mês", brl2.format(total),
      `${num.format(doMes.length)} venda${doMes.length === 1 ? "" : "s"} · no ritmo atual, fecha o mês em ${brl2.format(projecao)}`));
    kpis.appendChild(card("Documentos pendentes", num.format(pendentes.length),
      pendentes.length ? `venda${pendentes.length === 1 ? "" : "s"} com documento faltando` : "tudo enviado 🎉",
      { status: pendentes.length ? "atencao" : "bom" }));

    // vendas do mês
    preencher("ma-vendas", doMes.length
      ? el("div", { class: "px-card px-lista" }, [
        el("ul", { class: "px-itens" }, doMes.map((v) => el("li", {}, [
          el("span", { class: "ma-venda" }, [
            el("span", { class: "ma-data" }, dataBR(v.data_venda)),
            el("span", { class: "ma-cliente" }, v.cliente),
            el("span", { class: "ma-tag" + (v.parcelinha ? " ma-tag-p" : "") }, v.parcelinha ? "Parcelinha" : "Adesão"),
            el("span", { class: "px-secao-sub ma-adm" }, v.administradora || ""),
          ]),
          el("strong", {}, brl2.format(credito(v))),
        ]))),
      ])
      : el("div", { class: "px-vazio" }, "Nenhuma venda lançada neste mês ainda."));

    // pendências de documento
    preencher("ma-pendencias", pendentes.length
      ? el("div", { class: "px-card px-lista" }, [
        el("ul", { class: "px-itens" }, pendentes.map(({ v, faltam }) => el("li", { class: "ma-pend" }, [
          el("span", { class: "ma-venda" }, [
            el("span", { class: "ma-data" }, dataBR(v.data_venda)),
            el("span", { class: "ma-cliente" }, v.cliente),
          ]),
          el("span", { class: "ma-faltam" }, "Falta: " + faltam.join(", ")),
        ]))),
      ])
      : el("div", { class: "px-vazio" }, "Nenhum documento pendente. Tudo em dia!"));

    await minhaCampanha(meuNome);
  } catch (e) {
    kpis.innerHTML = "";
    kpis.appendChild(el("div", { class: "px-vazio" }, "Não foi possível carregar seus números: " + (e.message || e)));
    ["ma-vendas", "ma-pendencias"].forEach((id) => falha(id, "—"));
    minhaCampanha("").catch(() => falha("ma-campanha", "Não foi possível carregar a campanha."));
  } finally {
    minhaAreaCarregando = false;
  }
}

async function minhaCampanha(meuNome) {
  const { data, error } = await sb.from("campanha_ranking").select("vendedor, total_parcelinha, total_normal");
  if (error) throw error;
  const lista = (data || []).map((r) => ({ nome: r.vendedor, p: Number(r.total_parcelinha) || 0, n: Number(r.total_normal) || 0 }))
    .map((x) => ({ ...x, prog: (Math.min(1, x.p / PAINEL_META_PARCELINHA) + Math.min(1, x.n / PAINEL_META_NORMAL)) / 2 }))
    .sort((a, b) => b.prog - a.prog);
  const eu = lista.find((x) => x.nome === meuNome) || { nome: meuNome, p: 0, n: 0, prog: 0 };
  const posicao = lista.indexOf(eu) + 1;
  const garantida = eu.p >= PAINEL_META_PARCELINHA && eu.n >= PAINEL_META_NORMAL;
  const ganhadores = lista.filter((x) => x.p >= PAINEL_META_PARCELINHA && x.n >= PAINEL_META_NORMAL).length;

  const cP = card("Minha Parcelinha na campanha", brl2.format(eu.p),
    eu.p >= PAINEL_META_PARCELINHA ? "Meta de R$ 3 mi batida! ✔" : `faltam ${brl2.format(PAINEL_META_PARCELINHA - eu.p)} para R$ 3 mi`,
    { status: eu.p >= PAINEL_META_PARCELINHA ? "bom" : null });
  cP.appendChild(progresso(eu.p, PAINEL_META_PARCELINHA));
  const cN = card("Minha Adesão na campanha", brl2.format(eu.n),
    eu.n >= PAINEL_META_NORMAL ? "Meta de R$ 1 mi batida! ✔" : `faltam ${brl2.format(PAINEL_META_NORMAL - eu.n)} para R$ 1 mi`,
    { status: eu.n >= PAINEL_META_NORMAL ? "bom" : null });
  cN.appendChild(progresso(eu.n, PAINEL_META_NORMAL));

  preencher("ma-campanha", el("div", { class: "px-grid" }, [
    cP,
    cN,
    card("Minha posição", posicao ? `${posicao}º` : "—",
      garantida ? "Viagem garantida! 🎉" : posicao ? `de ${lista.length} vendedores · ${pctFmt(eu.prog * 100)} do caminho` : "ainda sem vendas na campanha",
      { status: garantida ? "bom" : null, destaque: garantida }),
    card("Viagens garantidas no time", num.format(ganhadores), ganhadores ? "vendedores que já bateram as duas metas" : "ninguém bateu as duas metas ainda"),
  ]));
}
