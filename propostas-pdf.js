// Proposta comercial em PDF (modelo img/proposta-modelo.webp, 1086×1448).
// O modelo é recortado em cabeçalho + bloco de cada proposta + rodapé: com 1 proposta sai só o bloco 1,
// com 2 os blocos 1 e 2, e assim por diante (máx. 3). Os valores são escritos por cima, no canvas,
// e o canvas vira um PDF de uma página (jsPDF). Quem chama: recebimento das propostas do Radar (sistema.js).
const PDF_MODELO = "img/proposta-modelo.webp";
const PDF_LARG = 1086;
const PDF_CAB = 355;           // cabeçalho: 0..355
const PDF_BLOCO = 272;         // bloco N: 355 + (N-1)*272
const PDF_RODAPE = 1171;       // rodapé: 1171..1448
const PDF_ALT_RODAPE = 1448 - PDF_RODAPE;
let pdfModeloImg = null;

function pdfCarregarModelo() {
  if (pdfModeloImg) return pdfModeloImg;
  pdfModeloImg = new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => { pdfModeloImg = null; falha(new Error("Não foi possível abrir o modelo da proposta.")); };
    img.src = PDF_MODELO + "?v=1";
  });
  return pdfModeloImg;
}

let pdfJsPromise = null;
function pdfCarregarJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => ok(window.jspdf);
    s.onerror = () => { pdfJsPromise = null; falha(new Error("Não foi possível carregar o gerador de PDF.")); };
    document.head.appendChild(s);
  });
  return pdfJsPromise;
}

const pdfMoeda = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
const pdfNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// normaliza o que vem do Radar e calcula o que faltar (valor final = entrada + parcelas; taxas = valor final − crédito)
function pdfNormalizarProposta(p) {
  const credito = pdfNum(p.credito);
  const entrada = pdfNum(p.entrada);
  const parcela = pdfNum(p.parcela);
  const prazo = pdfNum(p.prazo);
  const p1 = pdfNum(p.primeirasParcelas);       // parcelinha: valor da 1ª à Nª parcela
  const n1 = pdfNum(p.qtdPrimeirasParcelas) || (p1 ? 12 : 0);
  let valorFinal = pdfNum(p.valorFinal);
  if (valorFinal === null && parcela !== null && prazo !== null) valorFinal = (entrada || 0) + (p1 ? p1 * n1 : 0) + parcela * prazo;
  let totalTaxas = pdfNum(p.totalTaxas);
  if (totalTaxas === null && valorFinal !== null && credito !== null) totalTaxas = Math.max(0, valorFinal - credito);
  return {
    administradora: p.administradora || "—",
    tipo: p.tipo || "consorcio",
    credito, valorFinal, totalTaxas,
    entradaTxt: p1 ? `${n1}x ${pdfMoeda(p1)}` : pdfMoeda(entrada || 0),
    entradaRotulo: p1 ? `1ª a ${n1}ª parcela` : null,
    parcelaTxt: parcela !== null ? pdfMoeda(parcela) : "—",
    prazoTxt: prazo !== null ? `${prazo} ${prazo === 1 ? "mês" : "meses"}` : "—",
  };
}

function pdfTexto(g, txt, x, y, { tam = 18, peso = 700, cor = "#0f1b33", alinhar = "left", larguraMax = null } = {}) {
  g.font = `${peso} ${tam}px Inter, Arial, sans-serif`;
  g.fillStyle = cor;
  g.textAlign = alinhar;
  g.textBaseline = "middle";
  let t = String(txt ?? "");
  if (larguraMax) {
    let f = tam;
    while (g.measureText(t).width > larguraMax && f > 10) { f -= 1; g.font = `${peso} ${f}px Inter, Arial, sans-serif`; }
  }
  g.fillText(t, x, y);
}

// pinta por cima de um texto do modelo usando a cor do próprio fundo (amostra à esquerda e à direita da área)
function pdfCobrir(g, x, y, w, h, raio = 0) {
  const a = g.getImageData(x - 4, y + Math.floor(h / 2), 1, 1).data;
  const b = g.getImageData(x + w + 3, y + Math.floor(h / 2), 1, 1).data;
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, `rgb(${a[0]},${a[1]},${a[2]})`);
  grad.addColorStop(1, `rgb(${b[0]},${b[1]},${b[2]})`);
  g.fillStyle = grad;
  if (raio && g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, raio); g.fill(); } else g.fillRect(x, y, w, h);
}

async function pdfMontarCanvas(dados) {
  const img = await pdfCarregarModelo();
  const propostas = (dados.propostas || []).slice(0, 3).map(pdfNormalizarProposta);
  const n = Math.max(1, propostas.length);
  const alt = PDF_CAB + n * PDF_BLOCO + PDF_ALT_RODAPE;
  const c = document.createElement("canvas");
  const esc = 2; // dobro da resolução para o PDF ficar nítido
  c.width = PDF_LARG * esc; c.height = alt * esc;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.scale(esc, esc);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, PDF_LARG, PDF_CAB, 0, 0, PDF_LARG, PDF_CAB);
  for (let i = 0; i < n; i++) g.drawImage(img, 0, PDF_CAB + i * PDF_BLOCO, PDF_LARG, PDF_BLOCO, 0, PDF_CAB + i * PDF_BLOCO, PDF_LARG, PDF_BLOCO);
  g.drawImage(img, 0, PDF_RODAPE, PDF_LARG, PDF_ALT_RODAPE, 0, PDF_CAB + n * PDF_BLOCO, PDF_LARG, PDF_ALT_RODAPE);
  // a partir daqui, getImageData lê em pixels do canvas (escala 2): amostras feitas em coordenadas × esc
  const amostra = (x, y, w, h, raio) => {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    pdfCobrir(g, x * esc, y * esc, w * esc, h * esc, raio * esc);
    g.restore();
  };

  // cabeçalho
  const v = (txt, x, y, larg) => pdfTexto(g, txt || "", x, y, { tam: 18, peso: 700, cor: "#0f1b33", larguraMax: larg });
  v(dados.consultor, 272, 241, 250);
  v(dados.cliente, 255, 266, 265);
  v(dados.telefone, 270, 291, 250);
  v(dados.cpf, 220, 316, 300);
  v(dados.protocolo, 790, 248, 250);
  v(dados.tipoBem, 808, 274, 230);
  v(dados.dataCriacao, 842, 300, 200);

  propostas.forEach((p, i) => {
    const t = PDF_CAB + i * PDF_BLOCO; // topo do bloco
    // administradora no lugar de "Empresa Administradora"
    amostra(172, t + 82, 170, 52, 0);
    pdfTexto(g, p.administradora, 175, t + 108, { tam: 21, peso: 800, cor: "#ffffff", larguraMax: 165 });
    // valor do crédito (caixa dourada vazia)
    pdfTexto(g, pdfMoeda(p.credito), 207, t + 217, { tam: 24, peso: 800, cor: "#f3c969", alinhar: "center", larguraMax: 270 });
    // entrada / parcela / prazo: valor embaixo do rótulo
    if (p.entradaRotulo) { amostra(505, t + 50, 100, 24, 0); pdfTexto(g, p.entradaRotulo + ":", 508, t + 62, { tam: 15, peso: 700, cor: "#1f2a44" }); }
    pdfTexto(g, p.entradaTxt, 510, t + 92, { tam: 19, peso: 800, larguraMax: 160 });
    pdfTexto(g, p.parcelaTxt, 512, t + 162, { tam: 19, peso: 800, larguraMax: 160 });
    pdfTexto(g, p.prazoTxt, 512, t + 230, { tam: 19, peso: 800, larguraMax: 160 });
    // total de taxas
    pdfTexto(g, pdfMoeda(p.totalTaxas), 790, t + 120, { tam: 20, peso: 800, larguraMax: 230 });
    // valor final: rótulo pequeno + valor dentro da pílula dourada
    amostra(784, t + 164, 244, 44, 10);
    pdfTexto(g, "VALOR FINAL DO BEM", 906, t + 174, { tam: 11, peso: 800, cor: "#3a2a07", alinhar: "center" });
    pdfTexto(g, pdfMoeda(p.valorFinal), 906, t + 195, { tam: 21, peso: 800, cor: "#1b1405", alinhar: "center", larguraMax: 230 });
  });
  return c;
}

async function pdfGerarProposta(dados) {
  const [{ jsPDF }, canvas] = await Promise.all([pdfCarregarJsPDF(), pdfMontarCanvas(dados)]);
  const w = canvas.width / 2, h = canvas.height / 2;
  const doc = new jsPDF({ orientation: "portrait", unit: "px", format: [w, h], hotfixes: ["px_scaling"], compress: true });
  doc.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, w, h);
  return doc.output("blob");
}

// ---------- Radar → Sistema: "Gerar PDF" das propostas selecionadas ----------
// dados = { propostas: [{ administradora, tipo, credito, entrada, parcela, prazo, primeirasParcelas?, qtdPrimeirasParcelas?,
//           totalTaxas?, valorFinal?, tipoBem? }], tipoBem? }
const PDF_TIPOS_BEM = ["Imóvel", "Automóvel", "Moto", "Pesados", "Outro"];
const pdfProtocolo = () => {
  const d = new Date(Date.now() - DC_OFFSET).toISOString().slice(0, 10).replace(/-/g, "");
  return `INF-${d}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
};
const pdfNomeArquivo = (txt) => String(txt || "").replace(/[^\p{L}\p{N} ._-]+/gu, "").trim() || "cliente";

async function receberPropostaPdf(dados) {
  const propostas = ((dados && dados.propostas) || []).slice(0, 3);
  if (!propostas.length) { showToast("Nenhuma proposta selecionada no Radar."); return; }
  if (!ppAcesso || ppAcesso.email !== perms.email) {
    const { data, error } = await sb.rpc("pipe_meu_acesso");
    ppAcesso = { ...(error ? { dono: false, vendedor: null } : data), email: perms.email };
  }
  const temPipeline = ppAcesso.dono || !!ppAcesso.vendedor;
  let card = null;

  const busca = el("input", { type: "search", class: "ap-input", placeholder: "Nome ou telefone do cliente", autocomplete: "off" });
  const lista = el("ul", { class: "pdf-busca-lista" });
  const escolhido = el("div", { class: "pdf-escolhido hidden" });
  const nome = el("input", { type: "text", class: "ap-input", maxlength: "120", placeholder: "Nome do cliente" });
  const tel = el("input", { type: "tel", class: "ap-input", maxlength: "20", placeholder: "Telefone" });
  const cpf = el("input", { type: "text", class: "ap-input", maxlength: "18", placeholder: "CPF (opcional)", inputmode: "numeric" });
  const tipoBem = el("select", { class: "ap-input" }, PDF_TIPOS_BEM.map((t) => el("option", { value: t }, t)));
  const tb = dados.tipoBem || propostas[0].tipoBem;
  tipoBem.value = PDF_TIPOS_BEM.includes(tb) ? tb : "Imóvel";
  const erro = el("div", { class: "auth-error hidden" });
  const gerar = el("button", { type: "button", class: "btn btn-primary btn-block" }, "📄 Gerar PDF");

  const escolher = (c) => {
    card = c;
    if (c) { nome.value = c.nome; tel.value = c.telefone ? ddTel(c.telefone) : ""; if (PDF_TIPOS_BEM.includes(c.tipo_bem)) tipoBem.value = c.tipo_bem; }
    escolhido.innerHTML = "";
    escolhido.classList.toggle("hidden", !c);
    if (c) escolhido.append(el("span", {}, `📎 Vai anexar no card de ${c.nome}${c.vendedor ? " · " + c.vendedor : ""}`), el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => escolher(null) }, "Trocar"));
    lista.innerHTML = "";
    gerar.textContent = c ? "📄 Gerar PDF e anexar ao card" : "📄 Gerar PDF";
  };
  let t = null;
  busca.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = busca.value.trim();
      lista.innerHTML = "";
      if (q.length < 2) return;
      const dig = q.replace(/\D/g, "");
      let consulta = sb.from("pipe_cards").select("id, nome, telefone, vendedor, etapa, tipo_bem").order("atividade_em", { ascending: false }).limit(12);
      consulta = dig.length >= 4 ? consulta.ilike("telefone", `%${dig}%`) : consulta.ilike("nome", `%${q}%`);
      const { data, error } = await consulta;
      if (error) { lista.appendChild(el("li", { class: "pv-muted" }, "Erro na busca: " + error.message)); return; }
      if (!data.length) { lista.appendChild(el("li", { class: "pv-muted" }, "Nenhum cliente encontrado no seu Pipeline.")); return; }
      data.forEach((c) => lista.appendChild(el("li", {}, el("button", { type: "button", class: "pdf-busca-item", onclick: () => escolher(c) }, [
        el("span", { "aria-hidden": "true" }, ppEmojiBem(c.tipo_bem)),
        el("strong", {}, c.nome),
        el("small", {}, [c.telefone ? ddTel(c.telefone) : null, PIPE_NOME_ETAPA[c.etapa], ppAcesso.dono && c.vendedor ? dcPrimeiro(c.vendedor) : null].filter(Boolean).join(" · ")),
      ]))));
    }, 300);
  });

  const resumo = propostas.map((p, i) => el("li", {}, [
    el("strong", {}, `Proposta ${i + 1} · ${p.administradora || "—"}`),
    el("span", {}, `${pdfMoeda(pdfNum(p.credito))} · parcela ${pdfMoeda(pdfNum(p.parcela))}${p.prazo ? ` · ${p.prazo} meses` : ""}`),
  ]));

  const fechar = dcModal("Proposta comercial em PDF", `${propostas.length} proposta(s) selecionada(s) no Radar`, [
    el("ul", { class: "pdf-resumo" }, resumo),
    temPipeline ? el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Anexar ao cliente do Pipeline"), busca, lista, escolhido]) : null,
    el("div", { class: "pdf-campos" }, [
      el("div", { class: "field pp-span2" }, [el("label", { class: "atd-rot" }, "Cliente"), nome]),
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Telefone"), tel]),
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "CPF"), cpf]),
      el("div", { class: "field" }, [el("label", { class: "atd-rot" }, "Tipo do bem"), tipoBem]),
    ]),
    erro, gerar,
  ]);
  setTimeout(() => (temPipeline ? busca : nome).focus(), 60);

  gerar.addEventListener("click", async () => {
    erro.classList.add("hidden");
    if (!nome.value.trim()) { erro.textContent = "Coloque o nome do cliente (ou escolha o card)."; erro.classList.remove("hidden"); return; }
    gerar.disabled = true;
    gerar.textContent = "Gerando…";
    try {
      const protocolo = pdfProtocolo();
      const consultor = (card && card.vendedor) || ppAcesso.vendedor || (perms.email === "profissionalrailton@gmail.com" ? "Railton Angelo" : "");
      const blob = await pdfGerarProposta({
        consultor, cliente: nome.value.trim(), telefone: tel.value.trim(), cpf: cpf.value.trim(), protocolo,
        tipoBem: tipoBem.value, dataCriacao: new Date(Date.now() - DC_OFFSET).toISOString().slice(0, 10).split("-").reverse().join("/"),
        propostas,
      });
      const arquivo = `Proposta ${pdfNomeArquivo(nome.value)} ${protocolo}.pdf`;
      const a = el("a", { href: URL.createObjectURL(blob), download: arquivo });
      document.body.appendChild(a); a.click(); a.remove();
      if (card) {
        const caminho = `${card.id}/${protocolo}.pdf`;
        const up = await sb.storage.from("propostas").upload(caminho, blob, { contentType: "application/pdf", upsert: false });
        if (up.error) throw new Error("PDF baixado, mas não foi possível anexar ao card: " + up.error.message);
        const res = propostas.map((p) => p.administradora).filter(Boolean).join(", ");
        const ins = await sb.from("pipe_anexos").insert({ card_id: card.id, nome: arquivo, caminho, resumo: `${propostas.length} proposta(s) · ${res} · ${protocolo}` });
        if (ins.error) throw new Error("PDF baixado, mas não foi possível registrar no card: " + ins.error.message);
        showToast(`📄 PDF gerado e anexado ao card de ${card.nome}.`);
      } else showToast("📄 PDF gerado.");
      fechar();
    } catch (e) {
      gerar.disabled = false;
      gerar.textContent = card ? "📄 Gerar PDF e anexar ao card" : "📄 Gerar PDF";
      erro.textContent = e.message || String(e);
      erro.classList.remove("hidden");
    }
  });
}

// lista de propostas em PDF anexadas (card aberto do Pipeline)
async function pdfCaixaAnexos(caixa, cardId) {
  const { data, error } = await sb.from("pipe_anexos").select("*").eq("card_id", cardId).order("criado_em", { ascending: false });
  caixa.innerHTML = "";
  caixa.appendChild(el("label", { class: "atd-rot" }, "Propostas em PDF"));
  if (error || !data.length) { caixa.appendChild(el("small", { class: "pv-muted" }, error ? "Não foi possível carregar" : "Nenhuma ainda — gere pelo Radar")); return; }
  data.forEach((x) => caixa.appendChild(el("button", { type: "button", class: "pdf-anexo", title: x.resumo || x.nome, onclick: async () => {
    const { data: url, error: e } = await sb.storage.from("propostas").createSignedUrl(x.caminho, 300, { download: x.nome });
    if (e) { showToast("Não foi possível abrir: " + e.message); return; }
    window.open(url.signedUrl, "_blank", "noopener");
  } }, [el("span", { "aria-hidden": "true" }, "📄"), el("span", {}, dcDataHora(x.criado_em))])));
}
