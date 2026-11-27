// Negócios › Reuniões — agenda e conversão das reuniões marcadas no Pipeline (sql/047).
// Dono vê todos; vendedor liberado no Pipeline vê só as dele (RLS). Os outros veem "em breve".
// Conversão = realizadas ÷ (agendadas que já passaram ou foram resolvidas). Remarcadas não contam (a nova substitui).
let rnDados = null;
let rnPeriodo = "mes";
let rnCanal = null, rnRecarga = null;

function rnFaixa() {
  const agora = Date.now();
  if (rnPeriodo === "mes") return [ddInicioMes(0), ddInicioMes(1)];
  if (rnPeriodo === "passado") return [ddInicioMes(-1), ddInicioMes(0)];
  if (rnPeriodo === "30") return [agora - 30 * 86400000, agora + 60 * 86400000];
  return [0, Infinity];
}

async function carregarReunioes() {
  const raiz = document.getElementById("sx-reunioes");
  if (!ppAcesso || ppAcesso.email !== perms.email) {
    const { data, error } = await sb.rpc("pipe_meu_acesso");
    ppAcesso = { ...(error ? { dono: false, vendedor: null } : data), email: perms.email };
  }
  if (!ppAcesso.dono && !ppAcesso.vendedor) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "pp-embreve" }, [
      el("div", { class: "pp-embreve-ic", "aria-hidden": "true" }, "📅"),
      el("h1", {}, "Reuniões · em breve"),
      el("p", {}, "Aqui vai ficar a agenda das suas reuniões marcadas no Pipeline."),
    ]));
    return;
  }
  rnAoVivo();
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "px-carregando" }, "Abrindo as reuniões…"));
  const [r, f] = await Promise.all([
    ppTudo(() => sb.from("pipe_reunioes").select("*").order("id")),
    sb.from("vendedor_fotos").select("vendedor, foto_url"),
  ]);
  if (r.error || f.error) { raiz.innerHTML = ""; raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível carregar: " + (r.error || f.error).message)); return; }
  rnDados = { reunioes: r.data, fotos: new Map(f.data.map((x) => [x.vendedor, x.foto_url])) };
  desenharReunioes(raiz);
}

function rnResumo(lista) {
  const agora = Date.now();
  const validas = lista.filter((x) => x.status !== "remarcada");
  const realizadas = validas.filter((x) => x.status === "realizada").length;
  const aguardando = validas.filter((x) => x.status === "agendada" && new Date(x.quando).getTime() >= agora).length;
  const atrasadas = validas.filter((x) => x.status === "agendada" && new Date(x.quando).getTime() < agora).length;
  const canceladas = validas.filter((x) => x.status === "cancelada").length;
  const base = validas.length - aguardando;
  return { total: validas.length, realizadas, aguardando, atrasadas, canceladas, taxa: base ? realizadas / base : null };
}

function desenharReunioes(raiz) {
  const { reunioes, fotos } = rnDados;
  const [ini, fim] = rnFaixa();
  const doPeriodo = reunioes.filter((x) => { const t = new Date(x.quando).getTime(); return t >= ini && t < fim; });
  const geral = rnResumo(doPeriodo);
  const dono = ppAcesso.dono;
  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "px-topo dd-topo" }, [
    el("div", {}, [
      el("h1", {}, dono ? "Reuniões" : "Minhas reuniões"),
      el("p", { class: "px-sub" }, "Marcadas quando o card vai para Agendamento. A reunião conta como feita quando o card é arrastado para Reunião."),
    ]),
  ]));

  // próximas (independe do período)
  const agora = Date.now();
  const abertas = reunioes.filter((x) => x.status === "agendada").sort((a, b) => new Date(a.quando) - new Date(b.quando));
  const atrasadas = abertas.filter((x) => new Date(x.quando).getTime() < agora - 60 * 60000);
  const proximas = abertas.filter((x) => new Date(x.quando).getTime() >= agora - 60 * 60000).slice(0, 30);
  const linha = (x, atrasada) => el("li", { class: atrasada ? "rn-atrasada" : "" }, [
    el("div", { class: "rn-quando" }, [el("strong", {}, rnDia(x.quando)), el("small", {}, rnHora(x.quando))]),
    el("span", { class: "rn-tipo " + x.tipo }, PP_TIPO_REUNIAO[x.tipo] || x.tipo),
    el("div", { class: "rn-info" }, [el("strong", {}, x.cliente || "Cliente"), x.obs ? el("small", {}, x.obs) : null]),
    dono && x.vendedor ? el("span", { class: "pp-card-vend" }, [avatarPerfil(x.vendedor, fotos.get(x.vendedor), "pp-foto"), dcPrimeiro(x.vendedor)]) : null,
    atrasada ? el("small", { class: "rn-aviso" }, "Já passou — arraste o card para Reunião ou remarque") : null,
  ]);
  raiz.appendChild(el("section", { class: "dd-bloco" }, [
    el("div", { class: "dd-bloco-cab" }, [el("h2", { class: "dd-h2" }, "📅 Próximas reuniões"), el("small", {}, `${proximas.length} agendada(s)`)]),
    proximas.length ? el("ul", { class: "rn-lista" }, proximas.map((x) => linha(x, false))) : el("p", { class: "px-vazio" }, "Nenhuma reunião agendada."),
    atrasadas.length ? el("div", { class: "dd-bloco-cab rn-cab-atraso" }, [el("h2", { class: "dd-h2" }, `⚠ Passaram e o card não foi para Reunião (${atrasadas.length})`)]) : null,
    atrasadas.length ? el("ul", { class: "rn-lista" }, atrasadas.slice(-30).reverse().map((x) => linha(x, true))) : null,
  ]));

  // período + números
  const periodos = [["mes", "Este mês"], ["passado", "Mês passado"], ["30", "Últimos 30 dias"], ["tudo", "Tudo"]];
  raiz.appendChild(el("div", { class: "dd-periodo", role: "tablist", "aria-label": "Período" }, periodos.map(([k, t]) =>
    el("button", { type: "button", role: "tab", "aria-selected": String(rnPeriodo === k), class: "dd-periodo-bt" + (rnPeriodo === k ? " sel" : ""), onclick: () => { rnPeriodo = k; desenharReunioes(raiz); } }, t))));
  const pres = rnResumo(doPeriodo.filter((x) => x.tipo === "presencial")), onl = rnResumo(doPeriodo.filter((x) => x.tipo === "online"));
  raiz.appendChild(el("div", { class: "dc-kpis" }, [
    dcKpi("📅", "Agendadas", String(geral.total)),
    dcKpi("🤝", "Feitas", String(geral.realizadas)),
    dcKpi("🎯", "Conversão", ddPct(geral.taxa)),
    dcKpi("⏳", "Aguardando", String(geral.aguardando)),
  ]));
  raiz.appendChild(el("p", { class: "rn-tipos-resumo" }, `🤝 Presencial: ${pres.realizadas}/${pres.total} · ${ddPct(pres.taxa)}   ·   💻 Online: ${onl.realizadas}/${onl.total} · ${ddPct(onl.taxa)}`));

  if (dono) {
    const porVend = new Map();
    doPeriodo.forEach((x) => { const v = x.vendedor || "Sem vendedor"; if (!porVend.has(v)) porVend.set(v, []); porVend.get(v).push(x); });
    const linhas = [...porVend.entries()].map(([v, l]) => ({ v, r: rnResumo(l) }))
      .sort((a, b) => (b.r.taxa ?? -1) - (a.r.taxa ?? -1) || b.r.total - a.r.total);
    raiz.appendChild(el("section", { class: "dd-bloco" }, [
      el("div", { class: "dd-bloco-cab" }, [el("h2", { class: "dd-h2" }, "Conversão por vendedor"), el("small", {}, "Feitas ÷ agendadas que já passaram")]),
      linhas.length ? el("div", { class: "rn-tabela-wrap" }, el("table", { class: "rn-tabela" }, [
        el("thead", {}, el("tr", {}, ["Vendedor", "Agendadas", "Feitas", "Não aconteceram", "Aguardando", "Conversão"].map((t) => el("th", {}, t)))),
        el("tbody", {}, linhas.map(({ v, r }) => el("tr", {}, [
          el("td", {}, el("span", { class: "pp-card-vend" }, [avatarPerfil(v, fotos.get(v), "pp-foto"), v])),
          el("td", {}, String(r.total)),
          el("td", {}, String(r.realizadas)),
          el("td", {}, String(r.canceladas + r.atrasadas)),
          el("td", {}, String(r.aguardando)),
          el("td", {}, el("div", { class: "rn-barra" }, [
            el("span", { class: "rn-barra-fundo" }, el("span", { class: "rn-barra-cheia", style: `width:${Math.round((r.taxa || 0) * 100)}%` })),
            el("strong", {}, ddPct(r.taxa)),
          ])),
        ]))),
      ])) : el("p", { class: "px-vazio" }, "Nenhuma reunião neste período."),
    ]));
  }
  raiz.appendChild(el("p", { class: "atd-rodape" }, "🔎 \"Não aconteceram\" = card voltou para trás ou foi para a Reciclagem, ou a data passou sem o card ir para Reunião. Se o card pular direto para Documentação ou Em negociação, a reunião conta como feita."));
}

const rnSemana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function rnDia(iso) {
  const d = new Date(new Date(iso).getTime() - DC_OFFSET);
  const hoje = new Date(Date.now() - DC_OFFSET).toISOString().slice(0, 10);
  const amanha = new Date(Date.now() - DC_OFFSET + 86400000).toISOString().slice(0, 10);
  const dia = d.toISOString().slice(0, 10);
  if (dia === hoje) return "Hoje";
  if (dia === amanha) return "Amanhã";
  return `${rnSemana[d.getUTCDay()]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}
const rnHora = (iso) => new Date(new Date(iso).getTime() - DC_OFFSET).toISOString().slice(11, 16);

function rnAoVivo() {
  if (rnCanal) return;
  rnCanal = sb.channel("negocios-reunioes")
    .on("postgres_changes", { event: "*", schema: "public", table: "pipe_reunioes" }, () => {
      clearTimeout(rnRecarga);
      rnRecarga = setTimeout(() => {
        const raiz = document.getElementById("sx-reunioes");
        if (raiz && !raiz.classList.contains("hidden")) carregarReunioes();
      }, 800);
    })
    .subscribe();
}
