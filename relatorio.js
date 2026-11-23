// Negócios › Relatório semanal (só gestão): o relatório da equipe de domingo a sábado, no mesmo modelo 1920x1080
// que o n8n manda no WhatsApp toda segunda às 8h (relatorio/modelo.js). Números vêm da RPC relatorio_semanal (sql/037).
// "Baixar imagem" gera o PNG no próprio navegador (html-to-image).
let rsInicio = null; // domingo (AAAA-MM-DD) da semana exibida; null = última semana completa
let rsDados = null;
let rsAoRedimensionar = null;

function rsHojeFortaleza() {
  const d = new Date(Date.now() - 3 * 3600000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const rsIso = (d) => d.toISOString().slice(0, 10);
function rsSomarDias(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return rsIso(d); }
function rsUltimaSemana() { const h = rsHojeFortaleza(); h.setUTCDate(h.getUTCDate() - h.getUTCDay() - 7); return rsIso(h); }
function rsSemanaAtual() { const h = rsHojeFortaleza(); h.setUTCDate(h.getUTCDate() - h.getUTCDay()); return rsIso(h); }
const rsCurta = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };

function rsCarregarScript(src, global) {
  if (window[global]) return Promise.resolve();
  return new Promise((ok, erro) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => erro(new Error("não carregou " + src));
    document.head.appendChild(s);
  });
}
function rsFontes() {
  if (document.getElementById("rs-fontes")) return;
  const l = document.createElement("link");
  l.id = "rs-fontes"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@500;600;700;800;900&display=swap";
  document.head.appendChild(l);
}

async function carregarRelatorio() {
  const raiz = document.getElementById("sx-relatorio");
  rsFontes();
  if (!rsInicio) rsInicio = rsUltimaSemana();
  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "px-carregando" }, "Montando o relatório…"));
  try {
    await rsCarregarScript("relatorio/modelo.js?v=1", "RelatorioSemanal");
  } catch (e) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível abrir o modelo do relatório."));
    return;
  }
  const { data, error } = await sb.rpc("relatorio_semanal", { p_inicio: rsInicio });
  if (error) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível carregar o relatório: " + error.message));
    return;
  }
  rsDados = data;
  desenharRelatorio(raiz);
}

function desenharRelatorio(raiz) {
  const atual = rsSemanaAtual();
  const emAndamento = rsInicio >= atual;
  const fim = rsSomarDias(rsInicio, 6);

  raiz.innerHTML = "";
  const btBaixar = el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => rsBaixar(btBaixar) }, "⬇ Baixar imagem");
  raiz.appendChild(el("div", { class: "px-topo rs-topo" }, [
    el("div", {}, [
      el("h1", {}, "Relatório semanal"),
      el("p", { class: "px-sub" }, "Semana de domingo a sábado. Toda segunda às 8h a imagem da semana anterior chega no WhatsApp da gestão."),
    ]),
    el("div", { class: "rs-acoes" }, [
      el("div", { class: "rs-semana" }, [
        el("button", { type: "button", class: "btn btn-secondary btn-sm", title: "Semana anterior", onclick: () => { rsInicio = rsSomarDias(rsInicio, -7); carregarRelatorio(); } }, "‹"),
        el("span", {}, `${rsCurta(rsInicio)} a ${rsCurta(fim)}${emAndamento ? " · em andamento" : ""}`),
        el("button", { type: "button", class: "btn btn-secondary btn-sm", title: "Próxima semana", disabled: emAndamento ? "" : null,
          onclick: () => { if (!emAndamento) { rsInicio = rsSomarDias(rsInicio, 7); carregarRelatorio(); } } }, "›"),
      ]),
      btBaixar,
    ]),
  ]));

  const palco = el("div", { class: "rs-palco" });
  const escala = el("div", { class: "rs-escala" });
  const pagina = window.RelatorioSemanal.montar(rsDados);
  escala.appendChild(pagina);
  palco.appendChild(escala);
  raiz.appendChild(palco);

  const ajustar = () => {
    const k = Math.min(1, palco.clientWidth / 1920);
    escala.style.transform = `scale(${k})`;
    palco.style.height = Math.round(1080 * k) + "px";
  };
  if (rsAoRedimensionar) window.removeEventListener("resize", rsAoRedimensionar);
  rsAoRedimensionar = ajustar;
  window.addEventListener("resize", ajustar);
  requestAnimationFrame(ajustar);
}

async function rsBaixar(bt) {
  const pagina = document.querySelector("#sx-relatorio .rs-pagina");
  if (!pagina) return;
  const texto = bt.textContent;
  bt.disabled = true; bt.textContent = "Gerando…";
  try {
    await rsCarregarScript("https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js", "htmlToImage");
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const url = await window.htmlToImage.toPng(pagina, { width: 1920, height: 1080, pixelRatio: 1, cacheBust: true, backgroundColor: "#0b1a33" });
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-semana-${rsInicio}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) {
    showToast("Não foi possível gerar a imagem: " + (e && e.message ? e.message : e));
  } finally {
    bt.disabled = false; bt.textContent = texto;
  }
}
