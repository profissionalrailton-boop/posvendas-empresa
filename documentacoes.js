// Negócios › Documentações (só gestão): as documentações que chegam do CRM pelo webhook (n8n → doc_n8n_receber) entram
// sem vendedor; aqui a gestão vincula o vendedor e só então ela anda na Corrida da documentação.
// Também mostra, por vendedor, quantas documentações viraram venda e o tempo médio até o fechamento — o cruzamento com
// as vendas do administrativo é feito no banco (doc_documentacoes, sql/035): mesmo vendedor, venda a partir da data da
// documentação, pelo telefone (8 últimos dígitos) ou pelo nome do cliente.
let ddDados = null;
let ddCanal = null, ddRecarga = null, ddAcaoLocal = 0;
let ddPeriodo = "mes";
let ddAberto = null; // vendedor com a lista aberta

const ddMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const ddDias = (n) => (n === 0 ? "no mesmo dia" : n === 1 ? "1 dia" : `${n} dias`);
const ddDiasAte = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const ddTel = (t) => {
  const d = String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t || "";
};
const ddDataCurta = (s) => { const [a, m, d] = String(s).slice(0, 10).split("-"); return `${d}/${m}/${a.slice(2)}`; };

// início do mês em Fortaleza (UTC-3), em ms
function ddInicioMes(deslocamento) {
  const local = new Date(Date.now() - DC_OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + deslocamento, 1) + DC_OFFSET;
}
function ddFaixaPeriodo() {
  if (ddPeriodo === "mes") return [ddInicioMes(0), Infinity];
  if (ddPeriodo === "passado") return [ddInicioMes(-1), ddInicioMes(0)];
  if (ddPeriodo === "90") return [Date.now() - 90 * 86400000, Infinity];
  return [0, Infinity];
}

async function carregarDocumentacoes() {
  const raiz = document.getElementById("sx-documentacoes");
  ddAoVivo();
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "px-carregando" }, "Abrindo as documentações…"));
  const [d, f, v] = await Promise.all([
    sb.rpc("doc_documentacoes", { p_desde: null }),
    sb.from("vendedor_fotos").select("vendedor, foto_url"),
    sb.from("administrativo_vendedores").select("nome, ativo").order("nome"),
  ]);
  const erro = [d, f, v].find((r) => r.error);
  if (erro) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível carregar as documentações: " + erro.error.message));
    return;
  }
  ddDados = {
    docs: d.data || [],
    fotos: new Map(f.data.map((x) => [x.vendedor, x.foto_url])),
    vendedores: v.data.filter((x) => x.ativo !== false && !DC_FORA.includes(x.nome)).map((x) => x.nome),
  };
  desenharDocumentacoes(raiz);
}

function ddResumo(lista) {
  const fechadas = lista.filter((x) => x.venda_id);
  const dias = fechadas.map((x) => x.dias).filter((n) => n !== null && n !== undefined);
  const media = dias.length ? dias.reduce((a, n) => a + n, 0) / dias.length : null;
  const ordenados = dias.slice().sort((a, b) => a - b);
  const mediana = ordenados.length ? ordenados[Math.floor((ordenados.length - 1) / 2)] : null;
  return { total: lista.length, fechadas: fechadas.length, conversao: lista.length ? fechadas.length / lista.length : null, media, mediana };
}
const ddMediaTxt = (m) => (m === null ? "—" : m < 1 ? "< 1 dia" : m === 1 ? "1 dia" : `${m.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`);
const ddPct = (p) => (p === null ? "—" : `${Math.round(p * 100)}%`);

function desenharDocumentacoes(raiz) {
  const { docs, vendedores } = ddDados;
  const [ini, fim] = ddFaixaPeriodo();
  const semVendedor = docs.filter((x) => !x.vendedor).sort((a, b) => new Date(a.em) - new Date(b.em));
  const doPeriodo = docs.filter((x) => { const t = new Date(x.em).getTime(); return x.vendedor && t >= ini && t < fim; });
  const geral = ddResumo(doPeriodo);

  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "px-topo dd-topo" }, [
    el("div", {}, [
      el("h1", {}, "Documentações"),
      el("p", { class: "px-sub" }, "Recebidas do CRM e lançadas à mão. Vincule o vendedor para a documentação contar na corrida; o fechamento é encontrado sozinho nas vendas do administrativo."),
    ]),
    el("div", { class: "dd-topo-acoes" }, [
      el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => { if (!dcDados) { dcDados = { vendedores: ddDados.vendedores, fotos: ddDados.fotos, casas: 10, lancamentos: [] }; } dcModalLancar(); } }, "＋ Lançar documentação"),
    ]),
  ]));

  // aguardando vendedor
  const bloco = el("section", { class: "dd-bloco dd-espera" + (semVendedor.length ? " tem" : "") }, [
    el("div", { class: "dd-bloco-cab" }, [
      el("h2", { class: "dd-h2" }, semVendedor.length ? `⏳ Aguardando vendedor (${semVendedor.length})` : "✅ Nenhuma documentação aguardando vendedor"),
      semVendedor.length ? el("small", {}, "Só contam na corrida depois de vinculadas") : null,
    ]),
  ]);
  if (semVendedor.length) bloco.appendChild(el("div", { class: "dd-espera-lista" }, semVendedor.map((x) => el("div", { class: "dd-espera-item" }, [
    el("div", { class: "dd-espera-info" }, [
      el("strong", {}, x.cliente || "Cliente sem nome"),
      el("small", {}, [
        x.tipo ? x.tipo.charAt(0).toUpperCase() + x.tipo.slice(1) : null,
        x.valor ? ddMoeda.format(x.valor) : null,
        x.cidade ? x.cidade + (x.estado ? "/" + x.estado : "") : null,
        x.telefone ? "📞 " + ddTel(x.telefone) : null,
      ].filter(Boolean).join(" · ")),
      el("small", { class: "dd-quando" }, `Recebida ${dcDataHora(x.em)}${ddDiasAte(x.em) ? ` · há ${ddDias(ddDiasAte(x.em))}` : ""}${x.origem === "crm" ? " · CRM" : ""}`),
      x.ja_contado_para && x.ja_contado_para.length
        ? el("small", { class: "dd-repetido" }, `🔁 Este negócio já contou para ${x.ja_contado_para.join(", ")}. Vincule só se for outro vendedor; se não, descarte.`)
        : null,
    ]),
    el("div", { class: "dd-espera-acoes" }, [
      el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => ddVincular(x) }, "Vincular vendedor"),
      el("button", { type: "button", class: "icon-btn", title: "Editar nome e celular", "aria-label": `Editar ${x.cliente || "documentação"}`, onclick: () => ddEditar(x) }, "✏️"),
      el("button", { type: "button", class: "icon-btn", title: "Descartar", "aria-label": `Descartar documentação de ${x.cliente || "cliente"}`, onclick: () => ddDescartar(x) }, "🗑"),
    ]),
  ]))));
  raiz.appendChild(bloco);

  // período + números
  const periodos = [["mes", "Este mês"], ["passado", "Mês passado"], ["90", "Últimos 90 dias"], ["tudo", "Tudo"]];
  raiz.appendChild(el("div", { class: "dd-periodo", role: "tablist", "aria-label": "Período" }, periodos.map(([k, t]) =>
    el("button", { type: "button", role: "tab", "aria-selected": String(ddPeriodo === k), class: "dd-periodo-bt" + (ddPeriodo === k ? " sel" : ""), onclick: () => { ddPeriodo = k; desenharDocumentacoes(raiz); } }, t))));
  raiz.appendChild(el("div", { class: "dc-kpis" }, [
    dcKpi("📄", "Documentações", String(geral.total)),
    dcKpi("🤝", "Viraram venda", geral.total ? `${geral.fechadas} · ${ddPct(geral.conversao)}` : "—"),
    dcKpi("⏱", "Tempo médio até fechar", ddMediaTxt(geral.media)),
    dcKpi("📍", "Metade fecha em até", geral.mediana === null ? "—" : ddDias(geral.mediana)),
  ]));

  // por vendedor
  const porVendedor = new Map(vendedores.map((n) => [n, []]));
  doPeriodo.forEach((x) => { if (!porVendedor.has(x.vendedor)) porVendedor.set(x.vendedor, []); porVendedor.get(x.vendedor).push(x); });
  const linhas = [...porVendedor.entries()].map(([nome, lista]) => ({ nome, lista, r: ddResumo(lista) }))
    .sort((a, b) => b.r.total - a.r.total || b.r.fechadas - a.r.fechadas || a.nome.localeCompare(b.nome, "pt-BR"));
  const grade = el("div", { class: "dd-vendedores" });
  linhas.forEach(({ nome, lista, r }) => {
    const aberto = ddAberto === nome;
    const abertas = lista.filter((x) => !x.venda_id);
    const card = el("div", { class: "dd-vend" + (aberto ? " aberto" : "") + (r.total ? "" : " vazio") }, [
      el("button", { type: "button", class: "dd-vend-cab", "aria-expanded": String(aberto), disabled: r.total ? null : "disabled",
        onclick: () => { ddAberto = aberto ? null : nome; desenharDocumentacoes(raiz); } }, [
        avatarPerfil(nome, ddDados.fotos.get(nome), "dd-vend-foto"),
        el("div", { class: "dd-vend-nome" }, [el("strong", {}, nome), el("small", {}, r.total ? `${r.total} ${r.total === 1 ? "documentação" : "documentações"}` : "Nenhuma no período")]),
        el("div", { class: "dd-vend-num conv" }, [el("strong", {}, r.total ? ddPct(r.conversao) : "—"), el("small", {}, "viraram venda")]),
        el("div", { class: "dd-vend-num tempo" }, [el("strong", {}, ddMediaTxt(r.media)), el("small", {}, "até fechar")]),
        el("div", { class: "dd-vend-num abertas" }, [el("strong", {}, String(abertas.length)), el("small", {}, "em aberto")]),
        r.total ? el("span", { class: "dd-seta", "aria-hidden": "true" }, aberto ? "▴" : "▾") : null,
      ]),
      aberto ? el("ul", { class: "dd-docs" }, lista.slice().sort((a, b) => new Date(b.em) - new Date(a.em)).map((x) => el("li", {}, [
        el("div", { class: "dd-doc-info" }, [
          el("strong", {}, x.cliente || "Cliente sem nome"),
          el("small", {}, [dcDataHora(x.em), x.telefone ? ddTel(x.telefone) : null, x.valor ? ddMoeda.format(x.valor) : null, x.origem === "crm" ? "CRM" : "manual"].filter(Boolean).join(" · ")),
        ]),
        x.venda_id
          ? el("span", { class: "dd-chip ok", title: `Venda de ${x.venda_cliente || ""} em ${ddDataCurta(x.venda_data)}${x.venda_valor ? " · " + ddMoeda.format(x.venda_valor) : ""}` },
            `✓ Fechou ${x.dias === 0 ? "no mesmo dia" : "em " + ddDias(x.dias)} · ${ddDataCurta(x.venda_data)}`)
          : el("span", { class: "dd-chip " + (ddDiasAte(x.em) >= 15 ? "parada" : "aberta") }, `Em aberto há ${ddDias(ddDiasAte(x.em))}`),
        el("button", { type: "button", class: "icon-btn", title: "Editar nome e celular", "aria-label": `Editar ${x.cliente || "documentação"}`, onclick: () => ddEditar(x) }, "✏️"),
        el("button", { type: "button", class: "icon-btn", title: "Desvincular (volta para Aguardando vendedor)", "aria-label": `Desvincular ${x.cliente || "documentação"}`, onclick: () => ddDesvincular(x) }, "↩"),
      ]))) : null,
    ]);
    grade.appendChild(card);
  });
  raiz.appendChild(el("section", { class: "dd-bloco" }, [
    el("div", { class: "dd-bloco-cab" }, [el("h2", { class: "dd-h2" }, "Por vendedor"), el("small", {}, "Toque no vendedor para ver as documentações")]),
    grade,
  ]));
  raiz.appendChild(el("p", { class: "atd-rodape" }, "🔎 O fechamento é a primeira venda do mesmo vendedor no administrativo, a partir da data da documentação, com o mesmo telefone ou o mesmo nome do cliente. Documentação em aberto há 15 dias ou mais aparece em vermelho."));
}

// ---------- ações ----------
function ddVincular(x) {
  let escolhido = null;
  const grade = el("div", { class: "dc-escolha" });
  const pintar = () => {
    grade.innerHTML = "";
    // mesmo negócio já contado para um vendedor: ele não pode receber de novo (outro vendedor pode)
    const jaContado = new Set(x.ja_contado_para || []);
    ddDados.vendedores.forEach((n) => grade.appendChild(el("button", { type: "button", class: "dc-escolha-item" + (n === escolhido ? " sel" : "") + (jaContado.has(n) ? " bloqueado" : ""),
      disabled: jaContado.has(n) ? "disabled" : null, title: jaContado.has(n) ? "Este negócio já foi contado para " + n : null,
      onclick: () => { escolhido = n; pintar(); } }, [
      avatarPerfil(n, ddDados.fotos.get(n), "dc-escolha-foto"),
      el("span", {}, jaContado.has(n) ? "já contou" : dcPrimeiro(n)),
    ])));
  };
  pintar();
  const erro = el("div", { class: "auth-error hidden" });
  const ok = el("button", { type: "button", class: "btn btn-primary btn-block" }, "Vincular e avançar na corrida");
  const fechar = dcModal("Vincular vendedor", `${x.cliente || "Cliente sem nome"}${x.telefone ? " · " + ddTel(x.telefone) : ""} · recebida ${dcDataHora(x.em)}`, [
    el("div", { class: "field" }, [grade]),
    erro, ok,
  ]);
  ok.addEventListener("click", async () => {
    erro.classList.add("hidden");
    if (!escolhido) { erro.textContent = "Escolha o vendedor."; erro.classList.remove("hidden"); return; }
    ok.disabled = true;
    const { error } = await sb.rpc("doc_vincular", { p_id: x.id, p_vendedor: escolhido });
    if (error) { ok.disabled = false; erro.textContent = "Não foi possível vincular: " + error.message; erro.classList.remove("hidden"); return; }
    fechar();
    ddAcaoLocal = Date.now();
    dcAcaoLocal = Date.now();
    showToast(`🏃 ${dcPrimeiro(escolhido)} avançou uma casa na corrida!`);
    carregarDocumentacoes();
  });
}
function ddEditar(x) {
  const nome = el("input", { type: "text", class: "ap-input", maxlength: "120", placeholder: "Nome do cliente", autocomplete: "off" });
  nome.value = x.cliente || "";
  const tel = el("input", { type: "tel", class: "ap-input", maxlength: "20", placeholder: "(88) 99999-9999", autocomplete: "off", inputmode: "tel" });
  tel.value = x.telefone ? ddTel(x.telefone) : "";
  const valor = dcCampoValor(x.valor);
  const erro = el("div", { class: "auth-error hidden" });
  const ok = el("button", { type: "button", class: "btn btn-primary btn-block" }, "Salvar");
  const fechar = dcModal("Editar documentação", `${x.vendedor ? x.vendedor + " · " : ""}${dcDataHora(x.em)}`, [
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Cliente"), nome]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Celular"), tel]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Valor do bem"), valor]),
    el("p", { class: "atd-dica" }, "Com o nome completo e o celular, o sistema encontra sozinho a venda desse cliente no administrativo e calcula o tempo até o fechamento."),
    erro, ok,
  ]);
  setTimeout(() => nome.focus(), 50);
  ok.addEventListener("click", async () => {
    erro.classList.add("hidden");
    const digitos = tel.value.replace(/\D/g, "");
    if (tel.value.trim() && digitos.length < 10) { erro.textContent = "Celular incompleto: use DDD + número."; erro.classList.remove("hidden"); return; }
    const v = dcLerValor(valor.value);
    if (valor.value.trim() && v === null) { erro.textContent = "Valor do bem inválido."; erro.classList.remove("hidden"); return; }
    ok.disabled = true;
    const { error } = await sb.rpc("doc_editar", { p_id: x.id, p_cliente: nome.value.trim() || null, p_telefone: digitos || null, p_valor: v });
    if (error) { ok.disabled = false; erro.textContent = "Não foi possível salvar: " + error.message; erro.classList.remove("hidden"); return; }
    fechar();
    ddAcaoLocal = Date.now();
    showToast("Documentação atualizada.");
    carregarDocumentacoes();
  });
}
async function ddDesvincular(x) {
  if (!confirm(`Desvincular ${x.cliente || "esta documentação"} de ${x.vendedor}?\n\nEla volta para "Aguardando vendedor" e ${dcPrimeiro(x.vendedor)} volta uma casa na corrida.`)) return;
  const { error } = await sb.rpc("doc_desvincular", { p_id: x.id });
  if (error) { showToast("Não foi possível desvincular: " + error.message); return; }
  ddAcaoLocal = Date.now();
  carregarDocumentacoes();
}
async function ddDescartar(x) {
  if (!confirm(`Descartar a documentação de ${x.cliente || "cliente sem nome"}?\n\nUse quando ela chegou repetida ou por engano. Não dá para desfazer.`)) return;
  const { error } = await sb.rpc("doc_remover", { p_id: x.id });
  if (error) { showToast("Não foi possível descartar: " + error.message); return; }
  ddAcaoLocal = Date.now();
  showToast("Documentação descartada.");
  carregarDocumentacoes();
}

// ---------- ao vivo: documentação nova do CRM aparece sozinha ----------
function ddAoVivo() {
  if (ddCanal) return;
  ddCanal = sb.channel("negocios-documentacoes")
    .on("postgres_changes", { event: "*", schema: "public", table: "doc_corrida" }, (msg) => {
      if (msg.eventType === "INSERT" && msg.new && !msg.new.vendedor && Date.now() - ddAcaoLocal > 4000) showToast("📄 Documentação nova do CRM aguardando vendedor");
      clearTimeout(ddRecarga);
      ddRecarga = setTimeout(() => {
        const raiz = document.getElementById("sx-documentacoes");
        if (raiz && !raiz.classList.contains("hidden")) carregarDocumentacoes();
      }, 600);
    })
    .subscribe();
}
