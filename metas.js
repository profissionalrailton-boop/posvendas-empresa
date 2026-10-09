// Metas do mês (empresa, equipes e vendedores) para o Painel geral, a Minha área e a Minha equipe.
// Tudo vem da função painel_metas (sql/013), que já devolve só o que cada login pode ver:
//   diretoria → tudo · supervisor → empresa + a equipe dele e os vendedores dela · vendedor → empresa + equipe + ele
// Realizado = crédito vendido no mês; Parcelinha pelo campo parcelinha (regra da campanha).

// Prêmio do mês para quando a EMPRESA (Infinity) bater as duas metas (Parcelinha e Adesão).
// Chave = "AAAA-MM". Para um prêmio novo, é só acrescentar o mês aqui.
const PREMIOS_EMPRESA = {
  "2026-10": { icone: "🎃", titulo: "Festa de Halloween", texto: "Se a Infinity bater a meta de Parcelinha e a de Adesão em outubro, a Festa de Halloween está garantida!" },
};
// Tema visual dos painéis por mês (liga e desliga sozinho pela data de hoje)
const TEMAS_DO_MES = { "2026-10": "halloween" };
function chaveMes(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
(function aplicarTemaDoMes() {
  const tema = TEMAS_DO_MES[chaveMes(new Date())];
  if (tema) document.querySelectorAll(".sx-painel").forEach((p) => p.classList.add(`tema-${tema}`));
})();

// faixa do prêmio no quadro da empresa: quanto falta para as duas metas ou "garantido"
function faixaPremio(premio, d) {
  const fp = Number(d.feito_p) || 0, fa = Number(d.feito_a) || 0;
  const mp = Number(d.meta_parcelinha) || 0, ma = Number(d.meta_adesao) || 0;
  const temMeta = mp > 0 || ma > 0;
  const batida = temMeta && fp >= mp && fa >= ma;
  const faltas = [mp > fp ? `${brl2.format(mp - fp)} em Parcelinha` : null, ma > fa ? `${brl2.format(ma - fa)} em Adesão` : null].filter(Boolean);
  return el("div", { class: "mt-premio" + (batida ? " garantido" : "") }, [
    el("div", { class: "mt-premio-icone", "aria-hidden": "true" }, batida ? "🎉" : premio.icone),
    el("div", {}, [
      el("div", { class: "mt-premio-rotulo" }, batida ? "Prêmio garantido!" : "Prêmio da meta da empresa"),
      el("div", { class: "mt-premio-titulo" }, premio.titulo),
      el("div", { class: "mt-premio-texto" }, batida
        ? `A Infinity bateu as duas metas — a ${premio.titulo} está garantida! 🥳`
        : !temMeta ? premio.texto
          : `${premio.texto} Faltam ${faltas.join(" e ")}.`),
    ]),
  ]);
}

async function buscarMetas(data = new Date()) {
  const mes = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: r, error } = await sb.rpc("painel_metas", { p_mes: mes });
  if (error) throw error;
  if (!r) throw new Error("sem acesso às metas");
  return r;
}

// uma linha "Parcelinha  R$ x de R$ y · 45%" com barra
function linhaMeta(rotulo, feito, meta) {
  const f = Number(feito) || 0;
  const m = Number(meta) || 0;
  const bateu = m > 0 && f >= m;
  return el("div", { class: "mt-linha" }, [
    el("div", { class: "mt-linha-topo" }, [
      el("span", { class: "mt-rotulo" }, rotulo),
      el("span", { class: "mt-num" + (bateu ? " batida" : "") }, m
        ? `${brl2.format(f)} de ${brl2.format(m)} · ${pctFmt((f / m) * 100)}${bateu ? " ✔" : ""}`
        : `${brl2.format(f)} · sem meta`),
    ]),
    progresso(f, m),
    m && !bateu ? el("div", { class: "mt-falta" }, `faltam ${brl2.format(m - f)}`) : null,
  ]);
}

// quadro de uma meta coletiva (empresa ou equipe) com Parcelinha e Adesão
function cardColetiva(titulo, d, opts = {}) {
  const c = el("div", { class: "px-card mt-card" + (opts.destaque ? " px-destaque" : "") + (opts.premio ? " mt-com-premio" : "") }, [
    el("div", { class: "px-titulo" }, titulo),
    el("div", { class: "px-sub" }, d ? `${num.format(d.qtd || 0)} venda${d.qtd === 1 ? "" : "s"} · ${brl2.format((Number(d.feito_p) || 0) + (Number(d.feito_a) || 0))} no total` : "—"),
  ]);
  if (d) {
    c.appendChild(linhaMeta("Parcelinha", d.feito_p, d.meta_parcelinha));
    c.appendChild(linhaMeta("Adesão", d.feito_a, d.meta_adesao));
    if (opts.premio) c.appendChild(faixaPremio(opts.premio, d));
  }
  return c;
}

// quadros da empresa e das equipes (a equipe do próprio login primeiro)
function blocoColetivas(r, { soEquipe = false } = {}) {
  const equipes = [...(r.equipes || [])].sort((a, b) => (a.alvo === r.equipe ? -1 : b.alvo === r.equipe ? 1 : a.alvo.localeCompare(b.alvo)));
  const cardsEquipes = equipes.map((e) => cardColetiva(`Equipe ${e.alvo}`, e, { destaque: e.alvo === r.equipe && r.papel !== "diretoria" }));
  const premio = PREMIOS_EMPRESA[String(r.mes || "").slice(0, 7)];
  const cardEmpresa = soEquipe ? null : cardColetiva("Infinity · empresa", r.empresa, { destaque: r.papel === "diretoria", premio });
  // diretoria: empresa primeiro; vendedor/supervisor: a própria equipe primeiro
  return el("div", { class: "px-grid px-duplo" }, r.papel === "diretoria" ? [cardEmpresa, ...cardsEquipes] : [...cardsEquipes, cardEmpresa]);
}

// tabela de acompanhamento por vendedor (mais perto da meta primeiro; sem meta vai para o fim)
function tabelaVendedores(lista, { mostrarEquipe = true } = {}) {
  const pctDe = (f, m) => (Number(m) > 0 ? Math.min(1, (Number(f) || 0) / Number(m)) : null);
  const progressoMedio = (v) => {
    const ps = [pctDe(v.feito_p, v.meta_parcelinha), pctDe(v.feito_a, v.meta_adesao)].filter((x) => x !== null);
    return ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : -1;
  };
  const ordenados = [...lista].sort((a, b) => progressoMedio(b) - progressoMedio(a) || a.nome.localeCompare(b.nome));
  if (!ordenados.length) return el("div", { class: "px-vazio" }, "Nenhum vendedor nesta equipe.");
  const celula = (f, m) => {
    const fv = Number(f) || 0;
    const mv = Number(m) || 0;
    return el("td", {}, [
      el("div", { class: "mt-cel-topo" }, [
        el("strong", {}, brl2.format(fv)),
        el("span", { class: "mt-cel-pct" + (mv && fv >= mv ? " batida" : "") }, mv ? pctFmt((fv / mv) * 100) : "sem meta"),
      ]),
      progresso(fv, mv),
      el("div", { class: "mt-cel-meta" }, mv ? (fv >= mv ? `meta ${brl2.format(mv)} ✔` : `meta ${brl2.format(mv)} · faltam ${brl2.format(mv - fv)}`) : ""),
    ]);
  };
  return el("div", { class: "px-card mt-tabela-card" }, [
    el("div", { class: "mt-tabela-wrap" }, [
      el("table", { class: "mt-tabela" }, [
        el("thead", {}, [el("tr", {}, [
          el("th", {}, "Vendedor"),
          el("th", {}, "Parcelinha"),
          el("th", {}, "Adesão"),
          el("th", { class: "mt-num-col" }, "Vendas"),
        ])]),
        el("tbody", {}, ordenados.map((v) => el("tr", {}, [
          el("td", {}, [el("div", { class: "mt-nome" }, v.nome), mostrarEquipe && v.equipe ? el("div", { class: "px-sub" }, v.equipe) : null]),
          celula(v.feito_p, v.meta_parcelinha),
          celula(v.feito_a, v.meta_adesao),
          el("td", { class: "mt-num-col" }, num.format(v.qtd || 0)),
        ]))),
      ]),
    ]),
  ]);
}

// ---------- Minha equipe (supervisor) ----------
let minhaEquipeCarregando = false;
async function carregarMinhaEquipe() {
  if (minhaEquipeCarregando) return;
  minhaEquipeCarregando = true;
  const raiz = document.getElementById("sx-minha-equipe");
  const hoje = new Date();
  const nomeMes = `${MESES_PT[hoje.getMonth()]} de ${hoje.getFullYear()}`;
  raiz.innerHTML = "";
  const titulo = el("h1", {}, "Minha equipe");
  raiz.appendChild(el("div", { class: "px-topo" }, [
    el("div", {}, [titulo, el("p", { class: "px-secao-sub" }, `Metas de ${nomeMes} · atualizado às ${String(hoje.getHours()).padStart(2, "0")}:${String(hoje.getMinutes()).padStart(2, "0")}`)]),
    el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => carregarMinhaEquipe() }, "↻ Atualizar"),
  ]));
  raiz.appendChild(secao("me-coletivas", "Metas da equipe e da empresa", "Crédito vendido no mês"));
  raiz.appendChild(secao("me-vendedores", "Vendedores da equipe", "Mais perto da meta primeiro"));
  raiz.appendChild(secao("me-campanha", "Campanha Rumo à Fortalcity", "Meta: R$ 3 mi em Parcelinha e R$ 1 mi em Adesão"));
  try {
    const r = await buscarMetas(hoje);
    if (r.equipe) titulo.textContent = `Equipe ${r.equipe}`;
    preencher("me-coletivas", blocoColetivas(r));
    preencher("me-vendedores", tabelaVendedores(r.vendedores || [], { mostrarEquipe: false }));
    verificarConquistas(r);
    await campanhaDaEquipe(r);
  } catch (e) {
    falha("me-coletivas", "Não foi possível carregar as metas: " + (e.message || e));
    falha("me-vendedores", "—");
    falha("me-campanha", "—");
  } finally {
    minhaEquipeCarregando = false;
  }
}

// campanha: só os vendedores da equipe (a supervisão pode ver os nomes da própria equipe)
async function campanhaDaEquipe(r) {
  const nomes = new Set((r.vendedores || []).map((v) => v.nome));
  const { data, error } = await sb.from("campanha_ranking").select("vendedor, total_parcelinha, total_normal");
  if (error) throw error;
  const lista = (data || []).filter((x) => nomes.has(x.vendedor))
    .map((x) => ({ nome: x.vendedor, p: Number(x.total_parcelinha) || 0, n: Number(x.total_normal) || 0 }))
    .map((x) => ({ ...x, prog: (Math.min(1, x.p / PAINEL_META_PARCELINHA) + Math.min(1, x.n / PAINEL_META_NORMAL)) / 2 }))
    .sort((a, b) => b.prog - a.prog);
  const garantidos = lista.filter((x) => x.p >= PAINEL_META_PARCELINHA && x.n >= PAINEL_META_NORMAL);
  preencher("me-campanha", [
    el("div", { class: "px-grid" }, [
      card("Parcelinha da equipe", brl2.format(lista.reduce((s, x) => s + x.p, 0)), "desde o início da campanha"),
      card("Adesão da equipe", brl2.format(lista.reduce((s, x) => s + x.n, 0)), "desde o início da campanha"),
      card("Viagens garantidas na equipe", num.format(garantidos.length), garantidos.length ? garantidos.map((g) => g.nome).join(", ") : "ninguém bateu as duas metas ainda", { status: garantidos.length ? "bom" : null }),
    ]),
    lista.length ? el("div", { class: "px-card px-lista" }, [
      el("div", { class: "px-titulo" }, "Mais perto da viagem (média das duas metas)"),
      barras(lista.map((x) => ({ nome: x.nome, valor: x.prog * 100, extra: `Parcelinha ${brl2.format(x.p)} · Adesão ${brl2.format(x.n)}` })), (v) => pctFmt(v)),
    ]) : null,
  ]);
}
