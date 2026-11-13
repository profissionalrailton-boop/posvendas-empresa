// Aba "Meus atendimentos" (Fase 1): o vendedor GRAVA na hora ou ENVIA O ARQUIVO de um atendimento/fechamento.
// Depois de gravar (ou ao escolher o arquivo) ele informa cliente, tipo (Atendimento | Fechamento) e resultado
// (pegou documentação | não passou — vendeu | não fechou). A análise comercial (n8n) entra na Fase 2.
// Banco: sql/025 (tabela atendimentos_gravacoes + funções atd_* + bucket privado "atendimentos").
//
// Robustez da gravação:
// - o áudio sobe em pedaços (ATD_PARTE_SEG) enquanto grava; cada pedaço fica guardado no aparelho (IndexedDB)
//   até confirmar o envio — se a internet cair ou a página fechar, ele sobe quando a aba for aberta de novo;
// - a tela é mantida acesa (Wake Lock); se o celular cortar o microfone (tela bloqueada / troca de app), a
//   gravação fica "interrompida" e o vendedor pode continuar (novo segmento na mesma gravação) ou finalizar;
// - "chamada no computador": grava a tela/aba compartilhada COM áudio + microfone, em estéreo
//   (vendedor à esquerda, cliente à direita) para separar as vozes na transcrição.
const ATD_PARTE_SEG = 60;                    // um pedaço por minuto de gravação
const ATD_PEDACO_ARQ = 8 * 1024 * 1024;      // arquivo enviado: pedaços de 8 MB (o bucket aceita até 10 MB)
const ATD_MAX_ARQ = 600 * 1024 * 1024;       // limite de arquivo enviado
const ATD_TIPOS = { atendimento: "Atendimento", fechamento: "Fechamento" };
const ATD_RESULTADOS = {
  atendimento: [["documentacao", "Pegou documentação"], ["sem_documentacao", "Não passou documentação"]],
  fechamento: [["vendeu", "Vendeu"], ["nao_fechou", "Não fechou"]],
};
const ATD_RES_TXT = { documentacao: "Pegou documentação", sem_documentacao: "Não passou documentação", vendeu: "Vendeu", nao_fechou: "Não fechou" };
const ATD_RES_OK = new Set(["documentacao", "vendeu"]);
const ATD_STATUS = { gravando: "Incompleta", aguardando: "Aguardando análise", processando: "Analisando…", pronta: "Análise pronta", erro: "Erro na análise" };

let atdDados = null;   // { eu, uid, lista, filtro }
let atdRec = null;     // gravação em andamento nesta aba
let atdCanal = null;
let atdRecarregar = null;
const atdFila = [];    // pedaços aguardando envio: { chave, id, caminho, blob, tipo, prog, guardado }
let atdEnviando = false;
const atdEsperas = []; // { id, resolve } — quem espera a fila de uma gravação esvaziar
const atdFinalizandoAqui = new Set(); // formulário aberto esperando o envio: ele mesmo finaliza

const atdDuracao = (s) => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(ss).padStart(2, "0");
};
const atdDataHora = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
const atdMb = (b) => (b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB";
const atdCelular = () => !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ---------- cópia local dos pedaços (IndexedDB) ----------
let atdBancoLocal = null;
function atdIdb() {
  if (atdBancoLocal) return atdBancoLocal;
  atdBancoLocal = new Promise((resolve) => {
    try {
      const req = indexedDB.open("infinity-atendimentos", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("pedacos", { keyPath: "chave" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return atdBancoLocal;
}
async function atdIdbFaz(modo, fn) {
  const db = await atdIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("pedacos", modo);
      const req = fn(tx.objectStore("pedacos"));
      tx.oncomplete = () => resolve(req ? req.result : true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
const atdIdbGuardar = (item) => atdIdbFaz("readwrite", (st) => st.put({ chave: item.chave, id: item.id, caminho: item.caminho, blob: item.blob, tipo: item.tipo, prog: item.prog }));
const atdIdbApagar = (chave) => atdIdbFaz("readwrite", (st) => st.delete(chave));
const atdIdbTodos = () => atdIdbFaz("readonly", (st) => st.getAll());

// formulário preenchido antes do áudio terminar de subir: finaliza sozinho quando a fila esvaziar
function atdFormGuardado(id, dados) {
  try {
    const k = "atd-form-" + id;
    if (dados === undefined) return JSON.parse(localStorage.getItem(k) || "null");
    if (dados === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(dados));
  } catch (e) { return null; }
  return null;
}

// ---------- fila de envio ----------
async function atdEnfileirar(item, guardar) {
  item.guardado = !!guardar;
  atdFila.push(item);
  if (guardar) await atdIdbGuardar(item);
  atdEnviarFila();
}
const atdNaFila = (id) => atdFila.filter((x) => x.id === id).length;

async function atdEnviarFila() {
  if (atdEnviando) return;
  atdEnviando = true;
  try {
    while (atdFila.length) {
      const item = atdFila[0];
      const { error } = await sb.storage.from("atendimentos").upload(item.caminho, item.blob, { contentType: item.tipo || "application/octet-stream", upsert: true });
      if (error) {
        const msg = String(error.message || error);
        // recusado pela regra do banco: só desiste se a gravação foi descartada ou já foi para análise
        if (/row-level security|policy/i.test(msg)) {
          const { data: g, error: eG } = await sb.from("atendimentos_gravacoes").select("status").eq("id", item.id).maybeSingle();
          if (!eG && (!g || !["gravando", "aguardando"].includes(g.status))) {
            atdFila.shift();
            if (item.guardado) await atdIdbApagar(item.chave);
            if (!atdNaFila(item.id)) atdFilaVazia(item.id);
            continue;
          }
        }
        atdAvisoEnvio(true);
        await new Promise((r) => setTimeout(r, navigator.onLine ? 5000 : 15000));
        continue;
      }
      atdAvisoEnvio(false);
      const p = item.prog;
      await sb.rpc("atd_progresso", { p_id: item.id, p_segmentos: p.seg, p_partes: p.partes, p_tamanho: p.bytes, p_duracao: p.dur == null ? null : Math.round(p.dur) });
      atdFila.shift();
      if (item.guardado) await atdIdbApagar(item.chave);
      if (!atdNaFila(item.id)) atdFilaVazia(item.id);
      atdPintarRec();
    }
  } finally {
    atdEnviando = false;
  }
}
window.addEventListener("online", () => atdEnviarFila());

async function atdFilaVazia(id) {
  for (let i = atdEsperas.length - 1; i >= 0; i--) if (atdEsperas[i].id === id) { atdEsperas[i].resolve(); atdEsperas.splice(i, 1); }
  const form = atdFormGuardado(id);
  if (form && !(atdRec && atdRec.id === id) && !atdFinalizandoAqui.has(id)) {
    const { error } = await sb.rpc("atd_finalizar", { p_id: id, p_cliente: form.cliente, p_tipo: form.tipo, p_resultado: form.resultado });
    if (!error) { atdFormGuardado(id, null); showToast("Gravação de " + form.cliente + " enviada ✅"); }
    atdMudou();
  }
}
const atdEsperarFila = (id) => (atdNaFila(id) ? new Promise((resolve) => atdEsperas.push({ id, resolve })) : Promise.resolve());

// pedaços que ficaram no aparelho (página fechada, internet caiu): sobem de novo
async function atdRetomarGuardados() {
  const todos = await atdIdbTodos();
  if (!todos || !todos.length) return;
  todos.sort((a, b) => (a.chave < b.chave ? -1 : 1)).forEach((it) => {
    if (!atdFila.some((x) => x.chave === it.chave)) atdFila.push({ ...it, guardado: true });
  });
  atdEnviarFila();
}

function atdAvisoEnvio(problema) {
  const av = document.getElementById("atd-aviso-envio");
  if (av) av.classList.toggle("hidden", !problema);
}

// ---------- carregar / desenhar ----------
async function carregarMeusAtendimentos() {
  const raiz = document.getElementById("sx-meus-atendimentos");
  atdAoVivo();
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "px-carregando" }, "Abrindo seus atendimentos…"));
  const [l, a, u] = await Promise.all([
    sb.from("atendimentos_gravacoes").select("id, criado_em, vendedor, cliente, tipo, resultado, origem, canais, arquivo_nome, pasta, segmentos, partes, tamanho_bytes, duracao_seg, status, nota, mime, extensao")
      .order("criado_em", { ascending: false }).limit(300),
    sb.rpc("atd_eu"),
    sb.auth.getUser(),
  ]);
  if (l.error) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível carregar os atendimentos: " + l.error.message));
    return;
  }
  atdDados = {
    lista: l.data,
    eu: a.error ? null : a.data || null,
    uid: u.data && u.data.user ? u.data.user.id : null,
    filtro: atdDados ? atdDados.filtro : "",
  };
  desenharMeusAtendimentos(raiz);
  atdRetomarGuardados();
}

function atdMudou() {
  clearTimeout(atdRecarregar);
  atdRecarregar = setTimeout(() => {
    const raiz = document.getElementById("sx-meus-atendimentos");
    if (raiz && !raiz.classList.contains("hidden") && raiz.childElementCount) carregarMeusAtendimentos();
  }, 600);
}
function atdAoVivo() {
  if (atdCanal) return;
  atdCanal = sb.channel("meus-atendimentos")
    .on("postgres_changes", { event: "*", schema: "public", table: "atendimentos_gravacoes" }, () => atdMudou())
    .subscribe();
}

function desenharMeusAtendimentos(raiz) {
  const { lista, eu } = atdDados;
  const ehGestao = lista.some((g) => g.vendedor !== eu) || !eu;
  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "px-topo" }, [
    el("div", {}, [
      el("h1", {}, "Meus atendimentos"),
      el("p", { class: "px-sub" }, eu
        ? "Grave ou envie o áudio dos seus atendimentos e fechamentos. A análise de cada um aparece aqui."
        : "Gravações de atendimentos e fechamentos enviadas pelos vendedores."),
    ]),
    el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => carregarMeusAtendimentos() }, "↻ Atualizar"),
  ]));
  if (eu) raiz.appendChild(el("div", { id: "atd-acao" }));
  raiz.appendChild(el("div", { id: "atd-aviso-envio", class: "atd-aviso hidden" }, "📶 Sem conexão no momento — o áudio está guardado neste aparelho e sobe sozinho quando a internet voltar. Não apague os dados do navegador."));

  // resumo
  const minhas = eu ? lista.filter((g) => g.vendedor === eu && g.status !== "gravando") : [];
  if (eu && minhas.length) {
    const mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
    const doMes = minhas.filter((g) => new Date(g.criado_em) >= mes);
    const atd = doMes.filter((g) => g.tipo === "atendimento"), fch = doMes.filter((g) => g.tipo === "fechamento");
    raiz.appendChild(el("div", { class: "atd-kpis" }, [
      atdKpi("Gravações no mês", String(doMes.length)),
      atdKpi("Atendimentos", atd.length ? `${atd.filter((g) => g.resultado === "documentacao").length} de ${atd.length} com documentação` : "—"),
      atdKpi("Fechamentos", fch.length ? `${fch.filter((g) => g.resultado === "vendeu").length} de ${fch.length} vendidos` : "—"),
    ]));
  }

  // lista
  const vendedores = [...new Set(lista.map((g) => g.vendedor))].sort();
  const cab = el("div", { class: "atd-lista-cab" }, [el("h2", { class: "atd-h2" }, eu && !ehGestao ? "Minhas gravações" : "Gravações")]);
  if (ehGestao && vendedores.length > 1) {
    const sel = el("select", { class: "ap-input atd-filtro", "aria-label": "Filtrar por vendedor" },
      [el("option", { value: "" }, "Todos os vendedores"), ...vendedores.map((n) => el("option", { value: n }, n))]);
    sel.value = atdDados.filtro;
    sel.addEventListener("change", () => { atdDados.filtro = sel.value; desenharMeusAtendimentos(raiz); });
    cab.appendChild(sel);
  }
  raiz.appendChild(cab);
  const visiveis = lista.filter((g) => (!atdDados.filtro || g.vendedor === atdDados.filtro) && !(atdRec && atdRec.id === g.id));
  if (!visiveis.length) {
    raiz.appendChild(el("div", { class: "empty-state" }, eu ? "Nenhuma gravação ainda. Use “Gravar agora” no próximo atendimento 🎙️" : "Nenhuma gravação enviada ainda."));
  } else {
    raiz.appendChild(el("div", { class: "atd-lista" }, visiveis.map((g) => atdLinha(g, ehGestao))));
  }
  raiz.appendChild(el("p", { class: "atd-rodape" }, "🧠 Em breve: cada gravação recebe uma análise com notas por etapa, o que você fez bem, o que pode melhorar e a sua evolução."));
  atdPintarRec();
}

const atdKpi = (rot, val) => el("div", { class: "atd-kpi" }, [el("div", { class: "atd-kpi-rot" }, rot), el("div", { class: "atd-kpi-val" }, val)]);

function atdLinha(g, mostrarVendedor) {
  const meu = g.vendedor === atdDados.eu;
  const incompleta = g.status === "gravando";
  const naFila = atdNaFila(g.id);
  const info = [
    g.duracao_seg ? "⏱ " + atdDuracao(g.duracao_seg) : null,
    g.tamanho_bytes ? atdMb(g.tamanho_bytes) : null,
    g.origem === "arquivo" ? "📁 arquivo" : g.canais ? "💻 chamada" : "🎙️ gravado",
  ].filter(Boolean).join(" · ");
  const acoes = [];
  if (g.partes > 0) acoes.push(el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: (ev) => atdOuvir(g, ev.currentTarget) }, "▶ Ouvir"));
  if (meu && incompleta && g.partes > 0 && !naFila) acoes.push(el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => atdFormulario(g.id, null) }, "Concluir"));
  if (meu && g.status === "aguardando") acoes.push(el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => atdFormulario(g.id, g) }, "✏️ Editar"));
  if (meu && (incompleta || g.status === "aguardando")) acoes.push(el("button", { type: "button", class: "btn btn-secondary btn-sm atd-apagar", title: "Descartar gravação", "aria-label": "Descartar gravação", onclick: () => atdDescartar(g) }, "🗑"));
  return el("div", { class: "atd-item" + (incompleta ? " incompleta" : "") }, [
    el("div", { class: "atd-item-topo" }, [
      el("div", { class: "atd-item-quem" }, [
        el("div", { class: "atd-item-cliente" }, g.cliente || (incompleta ? "Gravação sem dados" : "—")),
        el("div", { class: "atd-item-data" }, [atdDataHora(g.criado_em), mostrarVendedor ? " · " + g.vendedor : ""].join("")),
      ]),
      el("span", { class: "atd-status s-" + g.status }, naFila ? "Enviando áudio…" : ATD_STATUS[g.status] || g.status),
    ]),
    el("div", { class: "atd-item-tags" }, [
      g.tipo ? el("span", { class: "atd-tag t-" + g.tipo }, ATD_TIPOS[g.tipo]) : null,
      g.resultado ? el("span", { class: "atd-tag " + (ATD_RES_OK.has(g.resultado) ? "r-ok" : "r-nao") }, (ATD_RES_OK.has(g.resultado) ? "✓ " : "✕ ") + ATD_RES_TXT[g.resultado]) : null,
      el("span", { class: "atd-item-info" }, info),
    ]),
    incompleta && meu && !naFila ? el("div", { class: "atd-item-alerta" }, g.partes > 0
      ? "A gravação não foi concluída. Toque em “Concluir” para informar o cliente e enviar, ou descarte."
      : "Nenhum áudio chegou desta gravação. Pode descartar.") : null,
    acoes.length ? el("div", { class: "atd-item-acoes" }, acoes) : null,
    el("div", { class: "atd-player" }),
  ]);
}

// ---------- área de ação (gravar / enviar / gravando) ----------
function atdPintarRec() {
  const box = document.getElementById("atd-acao");
  atdPilula();
  if (!box) return;
  box.innerHTML = "";
  if (!atdRec) {
    box.appendChild(el("div", { class: "atd-acao" }, [
      el("div", { class: "atd-botoes" }, [
        el("button", { type: "button", class: "atd-grande gravar", onclick: () => atdEscolherModo() }, [
          el("span", { class: "atd-grande-ic" }, "🎙️"), el("span", { class: "atd-grande-txt" }, "Gravar agora"),
          el("span", { class: "atd-grande-sub" }, "presencial ou chamada no computador"),
        ]),
        el("button", { type: "button", class: "atd-grande enviar", onclick: () => atdEscolherArquivo() }, [
          el("span", { class: "atd-grande-ic" }, "📁"), el("span", { class: "atd-grande-txt" }, "Enviar arquivo"),
          el("span", { class: "atd-grande-sub" }, "áudio ou vídeo já gravado"),
        ]),
      ]),
      el("p", { class: "atd-dica" }, "Avise o cliente que o atendimento está sendo gravado. No celular, deixe esta tela aberta e não bloqueie o aparelho durante a gravação (de preferência, na tomada)."),
    ]));
    return;
  }
  const r = atdRec;
  const enviados = r.partesEnviadas();
  const fila = atdNaFila(r.id);
  const estado = r.estado; // gravando | pausado | interrompido | parando
  box.appendChild(el("div", { class: "atd-rec " + estado }, [
    el("div", { class: "atd-rec-topo" }, [
      el("span", { class: "atd-rec-ponto", "aria-hidden": "true" }),
      el("span", { class: "atd-rec-estado" }, estado === "gravando" ? "Gravando" : estado === "pausado" ? "Pausado" : estado === "parando" ? "Finalizando…" : "Gravação interrompida"),
      el("span", { class: "atd-rec-tempo", id: "atd-rec-tempo" }, atdDuracao(r.segundos())),
    ]),
    el("div", { class: "atd-rec-modo" }, r.modo === "chamada" ? "💻 Chamada no computador (tela + microfone)" : "🎙️ Microfone deste aparelho"),
    estado === "interrompido"
      ? el("div", { class: "atd-rec-alerta" }, "O aparelho parou o microfone (tela bloqueada, troca de app ou fim do compartilhamento). O que já foi gravado está salvo. Continue gravando ou finalize.")
      : el("div", { class: "atd-rec-alerta leve" }, r.modo === "chamada" ? "Mantenha a chamada e esta aba abertas até finalizar." : "⚠️ Não bloqueie a tela nem troque de app até finalizar."),
    el("div", { class: "atd-rec-envio" }, `☁️ ${enviados} ${enviados === 1 ? "pedaço salvo" : "pedaços salvos"} na nuvem${fila ? ` · ${fila} na fila` : ""}`),
    el("div", { class: "atd-rec-botoes" }, [
      estado === "gravando" ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => atdPausar() }, "⏸ Pausar") : null,
      estado === "pausado" ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => atdRetomar() }, "▶ Continuar") : null,
      estado === "interrompido" ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => atdContinuarInterrompida() }, "🎙️ Continuar gravando") : null,
      estado !== "parando" ? el("button", { type: "button", class: "btn btn-primary atd-parar", onclick: () => atdFinalizarGravacao() }, "⏹ Finalizar") : null,
      estado !== "parando" ? el("button", { type: "button", class: "btn btn-secondary atd-apagar", onclick: () => atdCancelarGravacao() }, "Cancelar") : null,
    ]),
  ]));
}

// indicador fixo enquanto grava (o vendedor pode navegar por outras abas do sistema)
function atdPilula() {
  let p = document.getElementById("atd-pilula");
  const raiz = document.getElementById("sx-meus-atendimentos");
  const naAba = raiz && !raiz.classList.contains("hidden");
  if (!atdRec || naAba) { if (p) p.remove(); return; }
  if (!p) {
    p = el("button", { type: "button", id: "atd-pilula", class: "atd-pilula", onclick: () => abrir("meusatendimentos", "meusatendimentos") });
    document.body.appendChild(p);
  }
  p.textContent = (atdRec.estado === "gravando" ? "● Gravando " : "⏸ Gravação ") + atdDuracao(atdRec.segundos());
}

// ---------- gravação ----------
function atdMimeGravacao() {
  const op = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm", "audio/aac"];
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of op) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}
const atdExtDe = (mime) => (/mp4|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : "webm");

function atdEscolherModo() {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("Este navegador não grava áudio. Use o Chrome (ou o Safari atualizado) ou envie o arquivo.");
    return;
  }
  if (atdCelular()) { atdComecar("mic"); return; }
  const fechar = atdModal("Como vai ser o atendimento?", "Escolha de onde vem o áudio", [
    el("div", { class: "atd-modos" }, [
      el("button", { type: "button", class: "atd-modo", onclick: () => { fechar(); atdComecar("mic"); } }, [
        el("span", { class: "atd-modo-ic" }, "🎙️"),
        el("span", {}, [el("strong", {}, "Presencial / microfone"), el("small", {}, "Grava o que o microfone deste computador escuta (cliente na sua frente ou ligação no viva-voz).")]),
      ]),
      el("button", { type: "button", class: "atd-modo", onclick: () => { fechar(); atdComecar("chamada"); } }, [
        el("span", { class: "atd-modo-ic" }, "💻"),
        el("span", {}, [el("strong", {}, "Chamada no computador"), el("small", {}, "WhatsApp Desktop/Web, Meet, Zoom… Na próxima tela, escolha a janela/aba da chamada (ou a tela inteira) e ative “Compartilhar áudio”.")]),
      ]),
    ]),
  ]);
}

async function atdPegarAudio(modo) {
  const micReq = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
  if (modo === "mic") {
    const mic = await navigator.mediaDevices.getUserMedia(micReq);
    return { stream: mic, fontes: [mic], canais: null, bits: 48000, vigiar: mic.getAudioTracks() };
  }
  const tela = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: "include" });
  if (!tela.getAudioTracks().length) {
    tela.getTracks().forEach((t) => t.stop());
    throw new Error("O áudio da chamada não foi compartilhado. Tente de novo e marque “Compartilhar áudio” (ou “Compartilhar áudio do sistema”).");
  }
  let mic;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { tela.getTracks().forEach((t) => t.stop()); throw e; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try { await ctx.resume(); } catch (e) { /* já ativo */ }
  const junta = ctx.createChannelMerger(2);
  ctx.createMediaStreamSource(mic).connect(junta, 0, 0);                                        // esquerda: vendedor
  ctx.createMediaStreamSource(new MediaStream(tela.getAudioTracks())).connect(junta, 0, 1);    // direita: cliente
  const destino = ctx.createMediaStreamDestination();
  destino.channelCount = 2;
  junta.connect(destino);
  return { stream: destino.stream, fontes: [mic, tela], ctx, canais: "vendedor_esq_cliente_dir", bits: 64000, vigiar: [...mic.getAudioTracks(), ...tela.getAudioTracks(), ...tela.getVideoTracks()] };
}

async function atdComecar(modo) {
  if (atdRec) return;
  const mime = atdMimeGravacao();
  if (mime === null) { showToast("Este navegador não grava áudio."); return; }
  let audio;
  try {
    audio = await atdPegarAudio(modo);
  } catch (e) {
    const negou = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    showToast(negou ? "Permissão negada. Libere o microfone para este site nas configurações do navegador." : (e.message || "Não foi possível acessar o microfone."));
    return;
  }
  const ext = atdExtDe(mime);
  const { data: id, error } = await sb.rpc("atd_criar", { p_origem: "gravacao", p_mime: mime || null, p_extensao: ext, p_canais: audio.canais });
  if (error) { atdSoltar(audio); showToast("Não foi possível iniciar: " + error.message); return; }
  atdRec = {
    id, modo, mime, ext, canais: audio.canais, seg: 0, partes: 0, bytes: 0,
    acumulado: 0, desde: null, estado: "gravando", audio: null, rec: null, wake: null, relogio: null,
    segundos() { return this.acumulado + (this.desde ? (Date.now() - this.desde) / 1000 : 0); },
    partesEnviadas() { return this.partes - atdNaFila(this.id); },
  };
  atdNovoSegmento(audio);
  atdRec.relogio = setInterval(() => {
    const t = document.getElementById("atd-rec-tempo");
    if (t && atdRec) t.textContent = atdDuracao(atdRec.segundos());
    atdPilula();
  }, 1000);
  atdTelaAcesa(true);
  desenharMeusAtendimentos(document.getElementById("sx-meus-atendimentos"));
  showToast("Gravando 🎙️");
}

function atdNovoSegmento(audio) {
  const r = atdRec;
  r.seg += 1;
  r.audio = audio;
  let idx = 0;
  const seg = r.seg;
  const opcoes = { audioBitsPerSecond: audio.bits };
  if (r.mime) opcoes.mimeType = r.mime;
  const rec = new MediaRecorder(audio.stream, opcoes);
  r.rec = rec;
  rec.ondataavailable = (ev) => {
    if (!ev.data || !ev.data.size || !atdRec || atdRec.id !== r.id) return;
    idx += 1;
    r.partes += 1;
    r.bytes += ev.data.size;
    const caminho = `${atdDados.uid}/${r.id}/${String(seg).padStart(2, "0")}-${String(idx).padStart(4, "0")}.${r.ext}`;
    atdEnfileirar({ chave: `${r.id}/${caminho}`, id: r.id, caminho, blob: ev.data, tipo: (r.mime || ev.data.type || "").split(";")[0] || "application/octet-stream",
      prog: { seg, partes: r.partes, bytes: r.bytes, dur: r.segundos() } }, true);
    atdPintarRec();
  };
  rec.onerror = () => atdInterrompida();
  // o celular derruba o microfone ao bloquear a tela / trocar de app; no computador, "parar compartilhamento"
  audio.vigiar.forEach((t) => t.addEventListener("ended", () => atdInterrompida()));
  rec.start(ATD_PARTE_SEG * 1000);
  r.desde = Date.now();
  r.estado = "gravando";
}

function atdSoltar(audio) {
  if (!audio) return;
  audio.fontes.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  if (audio.ctx) audio.ctx.close().catch(() => {});
}
function atdPararGravador() {
  const r = atdRec;
  return new Promise((resolve) => {
    if (!r || !r.rec || r.rec.state === "inactive") { resolve(); return; }
    r.rec.addEventListener("stop", () => setTimeout(resolve, 50), { once: true });
    try { r.rec.stop(); } catch (e) { resolve(); }
  });
}
function atdCongelarTempo() {
  if (atdRec && atdRec.desde) { atdRec.acumulado += (Date.now() - atdRec.desde) / 1000; atdRec.desde = null; }
}

async function atdInterrompida() {
  const r = atdRec;
  if (!r || r.estado === "interrompido" || r.estado === "parando") return;
  atdCongelarTempo();
  r.estado = "interrompido";
  await atdPararGravador();
  atdSoltar(r.audio);
  r.audio = null;
  atdPintarRec();
}
async function atdContinuarInterrompida() {
  if (!atdRec) return;
  try {
    const audio = await atdPegarAudio(atdRec.modo);
    atdNovoSegmento(audio);
    atdTelaAcesa(true);
    atdPintarRec();
  } catch (e) {
    showToast(e.message || "Não foi possível voltar a gravar.");
  }
}
function atdPausar() {
  const r = atdRec;
  if (!r || !r.rec || r.rec.state !== "recording") return;
  r.rec.pause();
  atdCongelarTempo();
  r.estado = "pausado";
  atdPintarRec();
}
function atdRetomar() {
  const r = atdRec;
  if (!r || !r.rec || r.rec.state !== "paused") return;
  r.rec.resume();
  r.desde = Date.now();
  r.estado = "gravando";
  atdPintarRec();
}

async function atdEncerrar() {
  const r = atdRec;
  atdCongelarTempo();
  r.estado = "parando";
  atdPintarRec();
  await atdPararGravador();
  atdSoltar(r.audio);
  clearInterval(r.relogio);
  atdTelaAcesa(false);
}
async function atdFinalizarGravacao() {
  const r = atdRec;
  if (!r) return;
  await atdEncerrar();
  const id = r.id, partes = r.partes;
  atdRec = null;
  atdPilula();
  if (!partes) {
    await sb.rpc("atd_descartar", { p_id: id });
    showToast("Nada foi gravado.");
    carregarMeusAtendimentos();
    return;
  }
  desenharMeusAtendimentos(document.getElementById("sx-meus-atendimentos"));
  atdFormulario(id, null);
}
async function atdCancelarGravacao() {
  if (!atdRec || !confirm("Cancelar e apagar esta gravação?")) return;
  const id = atdRec.id;
  await atdEncerrar();
  atdRec = null;
  await atdApagarTudo(id);
  showToast("Gravação cancelada.");
  carregarMeusAtendimentos();
}

// mantém a tela acesa durante a gravação (navegadores atuais)
async function atdTelaAcesa(ligar) {
  try {
    if (!ligar) { if (atdRec && atdRec.wake) await atdRec.wake.release(); return; }
    if (atdRec && "wakeLock" in navigator && document.visibilityState === "visible") atdRec.wake = await navigator.wakeLock.request("screen");
  } catch (e) { /* sem wake lock: segue gravando */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !atdRec) return;
  atdTelaAcesa(true);
  // alguns celulares "silenciam" o microfone em vez de encerrar: confere ao voltar
  const t = atdRec.audio && atdRec.audio.vigiar[0];
  if (atdRec.estado === "gravando" && t && (t.readyState === "ended" || t.muted)) atdInterrompida();
  atdPintarRec();
});
window.addEventListener("beforeunload", (ev) => {
  if (atdRec || atdFila.some((x) => !x.guardado)) { ev.preventDefault(); ev.returnValue = ""; }
});

// ---------- enviar arquivo ----------
function atdEscolherArquivo() {
  const input = el("input", { type: "file", accept: "audio/*,video/*,.opus,.ogg,.oga,.m4a,.mp3,.wav,.aac,.amr,.3gp,.mp4,.webm" });
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > ATD_MAX_ARQ) { showToast(`Arquivo muito grande (${atdMb(f.size)}). O limite é ${atdMb(ATD_MAX_ARQ)} — se for vídeo, envie só o áudio.`); return; }
    atdFormulario(null, null, f);
  });
  input.click();
}

function atdDuracaoArquivo(f) {
  return new Promise((resolve) => {
    const m = document.createElement(/^video/.test(f.type) ? "video" : "audio");
    const url = URL.createObjectURL(f);
    const fim = (v) => { URL.revokeObjectURL(url); resolve(isFinite(v) && v > 0 ? v : null); };
    m.preload = "metadata";
    m.onloadedmetadata = () => fim(m.duration);
    m.onerror = () => fim(null);
    setTimeout(() => fim(null), 8000);
    m.src = url;
  });
}

async function atdEnviarArquivo(f, dados, botao) {
  const ext = ((f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin").slice(0, 8);
  const { data: id, error } = await sb.rpc("atd_criar", { p_origem: "arquivo", p_mime: f.type || null, p_extensao: ext, p_arquivo_nome: f.name });
  if (error) throw error;
  atdFinalizandoAqui.add(id);
  const dur = await atdDuracaoArquivo(f);
  const total = Math.max(1, Math.ceil(f.size / ATD_PEDACO_ARQ));
  for (let i = 0; i < total; i++) {
    const caminho = `${atdDados.uid}/${id}/01-${String(i + 1).padStart(4, "0")}.${ext}`;
    const blob = f.slice(i * ATD_PEDACO_ARQ, Math.min(f.size, (i + 1) * ATD_PEDACO_ARQ));
    // o arquivo continua no aparelho: não guarda cópia, só a fila em memória
    atdEnfileirar({ chave: `${id}/${caminho}`, id, caminho, blob, tipo: "application/octet-stream",
      prog: { seg: 1, partes: i + 1, bytes: Math.min(f.size, (i + 1) * ATD_PEDACO_ARQ), dur } }, false);
  }
  atdFormGuardado(id, dados);
  const timer = setInterval(() => {
    const falta = atdNaFila(id);
    botao.textContent = `Enviando… ${Math.round(((total - falta) / total) * 100)}%`;
  }, 500);
  await atdEsperarFila(id);
  clearInterval(timer);
  return id;
}

// ---------- formulário: cliente, tipo e resultado ----------
function atdModal(titulo, sub, corpo) {
  const fundo = el("div", { class: "modal-overlay" });
  const fechar = () => fundo.remove();
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

// id = gravação já criada (após gravar / concluir / editar); arquivo = envio de arquivo (cria ao confirmar)
function atdFormulario(id, atual, arquivo) {
  const escolha = { tipo: atual ? atual.tipo : null, resultado: atual ? atual.resultado : null };
  const erro = el("div", { class: "auth-error hidden" });
  const cliente = el("input", { type: "text", class: "ap-input", maxlength: "120", placeholder: "Nome do cliente", autocomplete: "off" });
  cliente.value = atual && atual.cliente ? atual.cliente : "";
  const tipos = el("div", { class: "atd-opcoes" });
  const resultados = el("div", { class: "atd-opcoes" });
  const rotRes = el("label", { class: "atd-rot hidden" }, "Resultado");
  const confirmar = el("button", { type: "button", class: "btn btn-primary btn-block" }, arquivo ? "Enviar gravação" : "Salvar");

  const opcao = (txt, sub, ativo, onclick, classe) => el("button", { type: "button", class: "atd-opcao" + (ativo ? " sel" : "") + (classe ? " " + classe : ""), onclick }, [el("strong", {}, txt), sub ? el("small", {}, sub) : null]);
  function pintar() {
    tipos.innerHTML = "";
    tipos.appendChild(opcao("Atendimento", "propostas, dúvidas, documentação", escolha.tipo === "atendimento", () => { if (escolha.tipo !== "atendimento") escolha.resultado = null; escolha.tipo = "atendimento"; pintar(); }));
    tipos.appendChild(opcao("Fechamento", "cliente veio para fechar o contrato", escolha.tipo === "fechamento", () => { if (escolha.tipo !== "fechamento") escolha.resultado = null; escolha.tipo = "fechamento"; pintar(); }));
    resultados.innerHTML = "";
    rotRes.classList.toggle("hidden", !escolha.tipo);
    if (escolha.tipo) ATD_RESULTADOS[escolha.tipo].forEach(([v, txt]) =>
      resultados.appendChild(opcao((ATD_RES_OK.has(v) ? "✓ " : "✕ ") + txt, null, escolha.resultado === v, () => { escolha.resultado = v; pintar(); }, ATD_RES_OK.has(v) ? "ok" : "nao")));
  }
  pintar();

  const fechar = atdModal(arquivo ? "Enviar gravação" : atual ? "Editar gravação" : "Gravação finalizada 🎉", arquivo ? `${arquivo.name} · ${atdMb(arquivo.size)}` : "Conte como foi para a análise", [
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Cliente"), cliente]),
    el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Tipo"), tipos]),
    el("div", { class: "field" }, [rotRes, resultados]),
    erro, confirmar,
  ]);
  setTimeout(() => cliente.focus(), 50);

  confirmar.addEventListener("click", async () => {
    erro.classList.add("hidden");
    const dados = { cliente: cliente.value.trim(), tipo: escolha.tipo, resultado: escolha.resultado };
    if (!dados.cliente) { erro.textContent = "Informe o nome do cliente."; erro.classList.remove("hidden"); return; }
    if (!dados.tipo || !dados.resultado) { erro.textContent = "Escolha o tipo e o resultado."; erro.classList.remove("hidden"); return; }
    confirmar.disabled = true;
    let gid = id;
    if (gid) atdFinalizandoAqui.add(gid);
    try {
      if (arquivo) {
        confirmar.textContent = "Enviando… 0%";
        gid = await atdEnviarArquivo(arquivo, dados, confirmar);
      } else if (atdNaFila(gid)) {
        // ainda subindo o áudio: guarda o formulário e finaliza sozinho quando terminar
        atdFormGuardado(gid, dados);
        confirmar.textContent = "Enviando o áudio…";
        if (!navigator.onLine) {
          atdFinalizandoAqui.delete(gid); // finaliza sozinho quando a internet voltar
          showToast("Sem internet: o áudio fica guardado neste aparelho e é enviado quando a conexão voltar.");
          fechar(); carregarMeusAtendimentos(); return;
        }
        await atdEsperarFila(gid);
      }
      const { error } = await sb.rpc("atd_finalizar", { p_id: gid, p_cliente: dados.cliente, p_tipo: dados.tipo, p_resultado: dados.resultado });
      if (error) throw error;
      atdFormGuardado(gid, null);
      atdFinalizandoAqui.delete(gid);
      fechar();
      showToast(atual ? "Gravação atualizada ✅" : "Gravação enviada ✅");
      carregarMeusAtendimentos();
    } catch (e) {
      if (gid) atdFinalizandoAqui.delete(gid);
      confirmar.disabled = false;
      confirmar.textContent = arquivo ? "Enviar gravação" : "Salvar";
      erro.textContent = "Não foi possível salvar: " + (e.message || e);
      erro.classList.remove("hidden");
    }
  });
}

// ---------- ouvir / descartar ----------
async function atdArquivos(g) {
  const { data, error } = await sb.storage.from("atendimentos").list(g.pasta, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  return (data || []).filter((x) => x.name && !x.name.startsWith(".")).map((x) => `${g.pasta}/${x.name}`).sort();
}
async function atdOuvir(g, botao) {
  const item = botao.closest(".atd-item");
  const box = item.querySelector(".atd-player");
  if (box.childElementCount) { box.innerHTML = ""; return; }
  botao.disabled = true;
  const txt = botao.textContent;
  botao.textContent = "Carregando…";
  try {
    const caminhos = await atdArquivos(g);
    if (!caminhos.length) throw new Error("nenhum áudio encontrado");
    // junta os pedaços de cada segmento (gravação retomada = mais de um segmento)
    const segs = new Map();
    for (const c of caminhos) {
      const nome = c.split("/").pop();
      const s = nome.split("-")[0];
      const { data, error } = await sb.storage.from("atendimentos").download(c);
      if (error) throw error;
      if (!segs.has(s)) segs.set(s, []);
      segs.get(s).push(data);
    }
    const tipo = g.origem === "arquivo" ? (g.mime || "") : (g.mime || "audio/webm").split(";")[0];
    const video = /^video/.test(tipo);
    [...segs.entries()].forEach(([s, partes], i) => {
      const url = URL.createObjectURL(new Blob(partes, { type: tipo || undefined }));
      if (segs.size > 1) box.appendChild(el("div", { class: "atd-player-rot" }, `Parte ${i + 1}`));
      box.appendChild(el(video ? "video" : "audio", { controls: "controls", src: url, preload: "metadata", class: "atd-audio" }));
    });
  } catch (e) {
    showToast("Não foi possível abrir o áudio: " + (e.message || e));
  } finally {
    botao.disabled = false;
    botao.textContent = txt;
  }
}

async function atdApagarTudo(id) {
  // tira da fila e da cópia local, apaga os arquivos e a linha
  for (let i = atdFila.length - 1; i >= 0; i--) if (atdFila[i].id === id && i > 0) atdFila.splice(i, 1);
  const todos = (await atdIdbTodos()) || [];
  await Promise.all(todos.filter((x) => x.id === id).map((x) => atdIdbApagar(x.chave)));
  atdFormGuardado(id, null);
  const g = (atdDados.lista || []).find((x) => x.id === id);
  const pasta = g && g.pasta ? g.pasta : `${atdDados.uid}/${id}`;
  const { data } = await sb.storage.from("atendimentos").list(pasta, { limit: 1000 });
  if (data && data.length) await sb.storage.from("atendimentos").remove(data.map((x) => `${pasta}/${x.name}`));
  const { error } = await sb.rpc("atd_descartar", { p_id: id });
  if (error) throw error;
}
async function atdDescartar(g) {
  if (!confirm(`Descartar a gravação${g.cliente ? " de " + g.cliente : ""}? O áudio será apagado.`)) return;
  try {
    await atdApagarTudo(g.id);
    showToast("Gravação descartada.");
  } catch (e) {
    showToast("Não foi possível descartar: " + (e.message || e));
  }
  carregarMeusAtendimentos();
}
