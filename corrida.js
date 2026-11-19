// Aba "Corrida da documentação": cada documentação pega avança uma casa até a linha de chegada.
// A semana vai de domingo 00:00 a sábado 23:59 (horário de Fortaleza) e zera sozinha: a pista só conta os
// lançamentos da semana atual; as semanas anteriores aparecem no histórico.
// Só a gestão (financeiro ou administrativo) lança, remove e muda a linha de chegada — trava no banco (sql/034).
// Quando o CRM mandar o vendedor no webhook, o n8n grava direto em doc_corrida e a pista anda sozinha.
const DC_FORA = ["Railton Angelo"]; // gestão com cadastro de vendedor: não corre
const DC_OFFSET = 3 * 3600 * 1000;  // Fortaleza = UTC-3 (sem horário de verão)
const DC_CORES = ["#f97316", "#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#60a5fa", "#fb7185", "#2dd4bf", "#c084fc", "#fbbf24", "#4ade80", "#38bdf8", "#e879f9"];
let dcDados = null;
let dcCanal = null, dcRecarga = null, dcAoVivoOk = false, dcAcaoLocal = 0;

const dcGestor = () => !!(perms && (perms.fin || perms.adm));
const dcPrimeiro = (nome) => String(nome || "").split(" ")[0];

// início da semana (domingo 00:00 em Fortaleza) de um instante, em milissegundos UTC
function dcInicioSemana(ms) {
  const local = new Date(ms - DC_OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - local.getUTCDay()) + DC_OFFSET;
}
const DC_SEMANA = 7 * 24 * 3600 * 1000;
const dcDia = (ms) => new Date(ms - DC_OFFSET).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dcDataHora = (iso) => {
  const d = new Date(new Date(iso).getTime() - DC_OFFSET);
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).replace(".", "") +
    " · " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
};
function dcFaltaTxt(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`;
}

async function carregarCorrida() {
  const raiz = document.getElementById("sx-corrida");
  dcAoVivo();
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "px-carregando" }, "Preparando a pista…"));
  const desde = new Date(dcInicioSemana(Date.now()) - 5 * DC_SEMANA).toISOString();
  const [c, l, f, v] = await Promise.all([
    sb.from("doc_corrida_config").select("casas").eq("id", 1).maybeSingle(),
    // só as documentações com vendedor contam (as que chegam do CRM sem vendedor esperam o vínculo em Negócios › Documentações)
    sb.from("doc_corrida").select("id, vendedor, cliente, em, origem").not("vendedor", "is", null).gte("em", desde).order("em").range(0, 4999),
    sb.from("vendedor_fotos").select("vendedor, foto_url"),
    sb.from("administrativo_vendedores").select("nome, ativo").order("nome"),
  ]);
  const erro = [c, l, f, v].find((r) => r.error);
  if (erro) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível carregar a corrida: " + erro.error.message));
    return;
  }
  const antes = dcDados;
  dcDados = {
    casas: (c.data && c.data.casas) || 10,
    lancamentos: l.data,
    fotos: new Map(f.data.map((x) => [x.vendedor, x.foto_url])),
    vendedores: v.data.filter((x) => x.ativo !== false && !DC_FORA.includes(x.nome)).map((x) => x.nome),
    posAntes: antes ? antes.posicoes : null,
  };
  desenharCorrida(raiz);
}

// placar de uma semana: casas andadas e ordem (empate: quem chegou primeiro naquela contagem)
function dcPlacar(ini, fim) {
  const daSemana = dcDados.lancamentos.filter((x) => { const t = new Date(x.em).getTime(); return t >= ini && t < fim; });
  const porVendedor = new Map(dcDados.vendedores.map((n) => [n, []]));
  daSemana.forEach((x) => { if (!porVendedor.has(x.vendedor)) porVendedor.set(x.vendedor, []); porVendedor.get(x.vendedor).push(x); });
  const linhas = [...porVendedor.entries()].map(([nome, docs]) => ({
    nome, docs, casas: docs.length,
    ultimo: docs.length ? new Date(docs[docs.length - 1].em).getTime() : Infinity,
    chegouEm: docs.length >= dcDados.casas ? new Date(docs[dcDados.casas - 1].em).getTime() : null,
  }));
  linhas.sort((a, b) => b.casas - a.casas || a.ultimo - b.ultimo || a.nome.localeCompare(b.nome, "pt-BR"));
  return { linhas, daSemana };
}

function desenharCorrida(raiz) {
  const gestor = dcGestor();
  const agora = Date.now();
  const ini = dcInicioSemana(agora), fim = ini + DC_SEMANA;
  const { casas } = dcDados;
  const { linhas, daSemana } = dcPlacar(ini, fim);
  const lider = linhas[0] && linhas[0].casas ? linhas[0] : null;
  const chegaram = linhas.filter((x) => x.chegouEm).sort((a, b) => a.chegouEm - b.chegouEm);
  const ordemChegada = new Map(chegaram.map((x, i) => [x.nome, i + 1]));
  const posicoes = new Map(linhas.map((x) => [x.nome, x.casas]));
  const posAntes = dcDados.posAntes;
  dcDados.posicoes = posicoes;

  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "px-topo dc-topo" }, [
    el("div", {}, [
      el("h1", {}, "Corrida da documentação"),
      el("p", { class: "px-sub" }, `Cada documentação pega avança uma casa. Semana de ${dcDia(ini)} a ${dcDia(fim - 1)} · zera no domingo.`),
    ]),
    el("div", { class: "dc-topo-acoes" }, [
      el("span", { class: "rp-aovivo dc-aovivo" + (dcAoVivoOk ? " on" : "") }, dcAoVivoOk ? "● Ao vivo" : "○ Conectando…"),
      gestor ? el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => dcModalCasas() }, `🏁 Chegada: ${casas} casas`) : null,
      gestor ? el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => dcModalLancar() }, "＋ Lançar documentação") : null,
    ]),
  ]));

  // números da semana
  raiz.appendChild(el("div", { class: "dc-kpis" }, [
    dcKpi("📄", "Documentações na semana", String(daSemana.length)),
    dcKpi("👑", "Na frente", lider ? `${dcPrimeiro(lider.nome)} · ${lider.casas} ${lider.casas === 1 ? "casa" : "casas"}` : "Largada!"),
    dcKpi("🏁", chegaram.length ? "Já cruzaram a chegada" : "Linha de chegada", chegaram.length ? String(chegaram.length) : `${casas} casas`),
    dcKpi("⏳", "Zera em", dcFaltaTxt(fim - agora)),
  ]));

  // pista
  const pista = el("div", { class: "dc-pista", style: `--dc-casas:${casas}` });
  pista.appendChild(el("div", { class: "dc-pista-cab", "aria-hidden": "true" }, [
    el("span", { class: "dc-cab-largada" }, "LARGADA"),
    el("div", { class: "dc-cab-casas" }, Array.from({ length: casas }, (_, i) => el("span", {}, String(i + 1)))),
    el("span", { class: "dc-cab-chegada" }, "🏁"),
  ]));
  linhas.forEach((x, i) => {
    const cor = DC_CORES[dcDados.vendedores.indexOf(x.nome) % DC_CORES.length] || DC_CORES[i % DC_CORES.length];
    const pos = Math.min(x.casas, casas);
    const pct = (pos / casas) * 100;
    const chegou = !!x.chegouEm;
    const antes = posAntes ? posAntes.get(x.nome) : undefined;
    const andou = antes !== undefined && x.casas > antes;
    const pctAntes = andou ? (Math.min(antes, casas) / casas) * 100 : pct;
    const corredor = el("div", { class: "dc-corredor" + (andou ? " andou" : ""), style: `--p:${pctAntes}`, "data-p": String(pct) }, [
      x === lider && !chegou ? el("span", { class: "dc-coroa", "aria-hidden": "true" }, "👑") : null,
      chegou ? el("span", { class: "dc-coroa", "aria-hidden": "true" }, ordemChegada.get(x.nome) === 1 ? "🏆" : "🏅") : null,
      avatarPerfil(x.nome, dcDados.fotos.get(x.nome), "dc-foto"),
      andou ? el("span", { class: "dc-mais", "aria-hidden": "true" }, "+" + (x.casas - antes)) : null,
    ]);
    pista.appendChild(el("div", { class: "dc-raia" + (chegou ? " chegou" : "") + (x === lider ? " lider" : ""), style: `--dc-cor:${cor}` }, [
      el("div", { class: "dc-raia-quem" }, [
        el("span", { class: "dc-pos" }, chegou ? `${ordemChegada.get(x.nome)}º` : x.casas ? `${i + 1}º` : "–"),
        el("span", { class: "dc-nome", title: x.nome }, x.nome),
      ]),
      el("div", { class: "dc-trilho", role: "img", "aria-label": `${x.nome}: ${x.casas} de ${casas} casas` }, [
        el("div", { class: "dc-casas" }, Array.from({ length: casas }, (_, k) => el("span", { class: k < pos ? "feita" : "" }))),
        el("div", { class: "dc-rastro", style: `width:${pct}%` }),
        el("div", { class: "dc-chegada", "aria-hidden": "true" }),
        corredor,
      ]),
      el("div", { class: "dc-raia-placar" }, [
        el("strong", {}, String(x.casas)),
        el("small", {}, `/${casas}`),
        gestor ? el("button", { type: "button", class: "dc-mais-btn", title: `Lançar documentação para ${x.nome}`, "aria-label": `Lançar documentação para ${x.nome}`, onclick: () => dcModalLancar(x.nome) }, "+1") : null,
      ]),
    ]));
  });
  raiz.appendChild(pista);
  // depois de desenhar, faz o corredor que andou deslizar da casa anterior até a nova
  requestAnimationFrame(() => {
    pista.querySelectorAll(".dc-corredor.andou").forEach((c) => { c.classList.add("anima"); c.style.setProperty("--p", c.dataset.p); });
  });

  // lançamentos da semana + histórico
  const baixo = el("div", { class: "dc-baixo" });
  const lista = el("div", { class: "dc-bloco" }, [el("h2", { class: "dc-h2" }, `Documentações da semana (${daSemana.length})`)]);
  if (!daSemana.length) lista.appendChild(el("div", { class: "dc-vazio" }, gestor ? "Nenhuma ainda. Use “＋ Lançar documentação” ou o “+1” na raia do vendedor." : "Nenhuma ainda. A largada é agora!"));
  else lista.appendChild(el("ul", { class: "dc-lista" }, daSemana.slice().reverse().map((x) => el("li", {}, [
    avatarPerfil(x.vendedor, dcDados.fotos.get(x.vendedor), "dc-lista-foto"),
    el("div", { class: "dc-lista-txt" }, [
      el("strong", {}, x.vendedor),
      el("small", {}, [dcDataHora(x.em), gestor && x.cliente ? " · " + x.cliente : "", x.origem === "crm" ? " · CRM" : ""].join("")),
    ]),
    gestor ? el("button", { type: "button", class: "icon-btn", title: "Remover", "aria-label": `Remover documentação de ${x.vendedor}`, onclick: () => dcRemover(x) }, "✕") : null,
  ]))));
  baixo.appendChild(lista);

  const hist = el("div", { class: "dc-bloco" }, [el("h2", { class: "dc-h2" }, "Semanas anteriores")]);
  const semanas = [];
  for (let k = 1; k <= 4; k++) {
    const i0 = ini - k * DC_SEMANA;
    const p = dcPlacar(i0, i0 + DC_SEMANA);
    if (p.daSemana.length) semanas.push({ i0, p });
  }
  if (!semanas.length) hist.appendChild(el("div", { class: "dc-vazio" }, "O histórico aparece a partir da próxima semana."));
  semanas.forEach(({ i0, p }) => {
    const top = p.linhas.filter((x) => x.casas).slice(0, 3);
    hist.appendChild(el("div", { class: "dc-semana" }, [
      el("div", { class: "dc-semana-cab" }, [el("span", {}, `${dcDia(i0)} a ${dcDia(i0 + DC_SEMANA - 1)}`), el("small", {}, `${p.daSemana.length} documentações`)]),
      el("ol", { class: "dc-podio" }, top.map((x, i) => el("li", {}, [
        el("span", { class: "dc-medalha", "aria-hidden": "true" }, ["🥇", "🥈", "🥉"][i]),
        avatarPerfil(x.nome, dcDados.fotos.get(x.nome), "dc-lista-foto"),
        el("span", { class: "dc-podio-nome" }, x.nome),
        el("strong", {}, String(x.casas)),
      ]))),
    ]));
  });
  baixo.appendChild(hist);
  raiz.appendChild(baixo);
}
const dcKpi = (ic, rot, val) => el("div", { class: "dc-kpi" }, [
  el("span", { class: "dc-kpi-ic", "aria-hidden": "true" }, ic),
  el("div", {}, [el("div", { class: "dc-kpi-rot" }, rot), el("div", { class: "dc-kpi-val" }, val)]),
]);

// ---------- gestão: lançar, remover, linha de chegada ----------
function dcModal(titulo, sub, corpo) {
  const fundo = el("div", { class: "modal-overlay" });
  const fechar = () => fundo.remove();
  fundo.addEventListener("click", (e) => { if (e.target === fundo) fechar(); });
  fundo.appendChild(el("div", { class: "modal-box rp-modal", role: "dialog", "aria-label": titulo }, [
    el("div", { class: "modal-header" }, [
      el("div", {}, [el("div", { class: "modal-title" }, titulo), sub ? el("div", { class: "modal-sub" }, sub) : null]),
      el("button", { class: "icon-btn", type: "button", onclick: fechar, "aria-label": "Fechar" }, "✕"),
    ]),
    ...corpo,
  ]));
  document.body.appendChild(fundo);
  return fechar;
}

// campo de valor em reais: aceita "250000", "250.000" ou "250.000,00"; formata ao sair do campo
function dcLerValor(txt) {
  let s = String(txt || "").replace(/[^\d,.]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function dcCampoValor(atual) {
  const campo = el("input", { type: "text", class: "ap-input", maxlength: "20", placeholder: "R$ 0,00 (opcional)", autocomplete: "off", inputmode: "decimal" });
  const fmt = (n) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (atual) campo.value = fmt(Number(atual));
  campo.addEventListener("blur", () => { const n = dcLerValor(campo.value); if (n !== null) campo.value = fmt(n); });
  return campo;
}

function dcModalLancar(vendedor) {
  let escolhido = vendedor || null;
  const grade = el("div", { class: "dc-escolha" });
  const pintar = () => {
    grade.innerHTML = "";
    dcDados.vendedores.forEach((n) => grade.appendChild(el("button", { type: "button", class: "dc-escolha-item" + (n === escolhido ? " sel" : ""), onclick: () => { escolhido = n; pintar(); } }, [
      avatarPerfil(n, dcDados.fotos.get(n), "dc-escolha-foto"),
      el("span", {}, dcPrimeiro(n)),
    ])));
  };
  pintar();
  const cliente = el("input", { type: "text", class: "ap-input", maxlength: "120", placeholder: "Nome do cliente (opcional)", autocomplete: "off" });
  const telefone = el("input", { type: "tel", class: "ap-input", maxlength: "20", placeholder: "Celular do cliente (opcional)", autocomplete: "off", inputmode: "tel" });
  const valor = dcCampoValor(null);
  const quando = el("input", { type: "datetime-local", class: "ap-input" });
  const agoraLocal = new Date(Date.now() - DC_OFFSET);
  quando.value = agoraLocal.toISOString().slice(0, 16);
  const erro = el("div", { class: "auth-error hidden" });
  const ok = el("button", { type: "button", class: "btn btn-primary btn-block" }, "🏃 Avançar uma casa");
  const fechar = dcModal("Lançar documentação", "Quem pegou a documentação?", [
    el("div", { class: "field" }, [grade]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Cliente"), cliente]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Celular"), telefone]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Valor do bem"), valor]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Quando"), quando]),
    erro, ok,
  ]);
  ok.addEventListener("click", async () => {
    erro.classList.add("hidden");
    if (!escolhido) { erro.textContent = "Escolha o vendedor."; erro.classList.remove("hidden"); return; }
    let em = null;
    if (quando.value) {
      const t = new Date(quando.value + ":00Z").getTime() + DC_OFFSET; // o campo está no horário de Fortaleza
      if (t > Date.now() + 5 * 60000) { erro.textContent = "A data não pode ser no futuro."; erro.classList.remove("hidden"); return; }
      em = new Date(t).toISOString();
    }
    const v = dcLerValor(valor.value);
    if (valor.value.trim() && v === null) { erro.textContent = "Valor do bem inválido."; erro.classList.remove("hidden"); return; }
    ok.disabled = true;
    const { error } = await sb.rpc("doc_lancar", { p_vendedor: escolhido, p_cliente: cliente.value.trim() || null, p_em: em, p_telefone: telefone.value.replace(/\D/g, "") || null, p_valor: v });
    if (error) { ok.disabled = false; erro.textContent = "Não foi possível lançar: " + error.message; erro.classList.remove("hidden"); return; }
    fechar();
    dcAcaoLocal = Date.now();
    showToast(`🏃 ${dcPrimeiro(escolhido)} avançou uma casa!`);
    carregarCorrida();
  });
}

async function dcRemover(x) {
  if (!confirm(`Remover a documentação de ${x.vendedor}${x.cliente ? " (" + x.cliente + ")" : ""}, de ${dcDataHora(x.em)}?\n\nEle volta uma casa na corrida.`)) return;
  const { error } = await sb.rpc("doc_remover", { p_id: x.id });
  if (error) { showToast("Não foi possível remover: " + error.message); return; }
  dcAcaoLocal = Date.now();
  showToast("Documentação removida.");
  carregarCorrida();
}

function dcModalCasas() {
  const campo = el("input", { type: "number", class: "ap-input", min: "3", max: "60", step: "1", value: String(dcDados.casas) });
  const erro = el("div", { class: "auth-error hidden" });
  const ok = el("button", { type: "button", class: "btn btn-primary btn-block" }, "Salvar");
  const fechar = dcModal("Linha de chegada", "Quantas documentações para cruzar a chegada na semana", [
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Casas"), campo]),
    el("p", { class: "atd-dica" }, "Vale para a semana atual e as próximas. Quem já passou da nova linha aparece como chegou."),
    erro, ok,
  ]);
  ok.addEventListener("click", async () => {
    const n = Math.round(Number(campo.value));
    if (!(n >= 3 && n <= 60)) { erro.textContent = "Use um número de 3 a 60."; erro.classList.remove("hidden"); return; }
    ok.disabled = true;
    const { error } = await sb.rpc("doc_casas", { p_casas: n });
    if (error) { ok.disabled = false; erro.textContent = "Não foi possível salvar: " + error.message; erro.classList.remove("hidden"); return; }
    fechar();
    dcAcaoLocal = Date.now();
    carregarCorrida();
  });
}

// ---------- ao vivo ----------
function dcMudou() {
  clearTimeout(dcRecarga);
  dcRecarga = setTimeout(() => {
    const raiz = document.getElementById("sx-corrida");
    if (raiz && !raiz.classList.contains("hidden")) carregarCorrida();
  }, 500);
}
// documentação nova: quem está em outra parte do sistema recebe um aviso; quem está na aba vê o corredor andar
function dcAvisar(novo) {
  if (!novo || Date.now() - dcAcaoLocal < 4000) return;
  const raiz = document.getElementById("sx-corrida");
  const naAba = raiz && !raiz.classList.contains("hidden");
  const casas = dcDados ? dcDados.casas : 10;
  const ini = dcInicioSemana(Date.now());
  const total = dcDados ? dcDados.lancamentos.filter((x) => x.vendedor === novo.vendedor && new Date(x.em).getTime() >= ini).length + 1 : null;
  if (total === casas) {
    showToast(`🏁 ${dcPrimeiro(novo.vendedor)} cruzou a linha de chegada!`);
    if (naAba && typeof tocarFanfarra === "function") tocarFanfarra();
  } else if (!naAba) {
    showToast(`🏃 ${dcPrimeiro(novo.vendedor)} pegou uma documentação e avançou na corrida!`);
  }
}
function dcAoVivo() {
  if (dcCanal) return;
  const mud = (tabela) => ({ event: "*", schema: "public", table: tabela });
  dcCanal = sb.channel("corrida-documentacao")
    .on("postgres_changes", mud("doc_corrida"), (msg) => {
      // nova com vendedor (lançamento manual) ou vinculada agora (veio do CRM sem vendedor)
      const n = msg.new;
      if (n && n.vendedor && (msg.eventType === "INSERT" || (msg.eventType === "UPDATE" && !(dcDados && dcDados.lancamentos.some((x) => x.id === n.id))))) dcAvisar(n);
      dcMudou();
    })
    .on("postgres_changes", mud("doc_corrida_config"), dcMudou)
    .subscribe((status) => {
      dcAoVivoOk = status === "SUBSCRIBED";
      document.querySelectorAll(".dc-aovivo").forEach((x) => { x.classList.toggle("on", dcAoVivoOk); x.textContent = dcAoVivoOk ? "● Ao vivo" : "○ Conectando…"; });
      if (dcAoVivoOk) dcMudou();
    });
}
// virada da semana com a aba aberta: redesenha sozinha (zera a pista)
setInterval(() => {
  const raiz = document.getElementById("sx-corrida");
  if (!dcDados || !raiz || raiz.classList.contains("hidden")) return;
  const kpi = raiz.querySelector(".dc-kpi:last-child .dc-kpi-val");
  const ini = dcInicioSemana(Date.now());
  if (dcDados.semanaIni && dcDados.semanaIni !== ini) carregarCorrida();
  else if (kpi) kpi.textContent = dcFaltaTxt(ini + DC_SEMANA - Date.now());
  dcDados.semanaIni = ini;
}, 60000);
