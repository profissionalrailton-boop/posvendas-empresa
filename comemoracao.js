// Comemoração de metas batidas: chuva de confete + cartão "Meta batida!" + musiquinha.
// Vale para as metas que cada login enxerga (painel_metas já filtra): vendedor → a própria e a da
// equipe; supervisor → equipe e vendedores dela; diretoria → todas. Inclui a meta da empresa.
// Cada conquista é comemorada uma vez por navegador (lembrada em localStorage). Com um painel
// aberto, as metas são reconferidas a cada 3 minutos, para comemorar na hora em que bater.
const COMEMORADAS_KEY = "infinity-metas-comemoradas";
const RECONFERIR_METAS_MS = 3 * 60 * 1000;

function lerComemoradas() {
  try { return new Set(JSON.parse(localStorage.getItem(COMEMORADAS_KEY) || "[]")); } catch (e) { return new Set(); }
}
function salvarComemoradas(set) {
  try { localStorage.setItem(COMEMORADAS_KEY, JSON.stringify([...set].slice(-400))); } catch (e) { /* só nesta visita */ }
}
const comemoradasDaSessao = new Set(); // reserva se o navegador bloquear o localStorage

// lista das metas batidas no resultado de painel_metas
function conquistasDe(r) {
  const mes = String(r.mes || "").slice(0, 7);
  const lista = [];
  const conferir = (tipo, alvo, nome, d) => {
    if (!d) return;
    [["p", "Parcelinha", d.feito_p, d.meta_parcelinha], ["a", "Adesão", d.feito_a, d.meta_adesao]].forEach(([k, rotulo, feito, meta]) => {
      const f = Number(feito) || 0, m = Number(meta) || 0;
      if (m > 0 && f >= m) lista.push({ chave: `${mes}|${tipo}|${alvo}|${k}`, tipo, nome, rotulo, feito: f, meta: m });
    });
  };
  const souVendedor = r.papel === "vendedor";
  (r.vendedores || []).forEach((v) => conferir(souVendedor ? "eu" : "vendedor", v.nome, v.nome, v));
  (r.equipes || []).forEach((e) => conferir("equipe", e.alvo, `Equipe ${e.alvo}`, e));
  conferir("empresa", "Infinity", "Infinity", r.empresa);
  return lista;
}

// confere e comemora o que ainda não foi comemorado; devolve quantas eram novas
function verificarConquistas(r) {
  if (!r) return 0;
  const vistas = lerComemoradas();
  const novas = conquistasDe(r).filter((c) => !vistas.has(c.chave) && !comemoradasDaSessao.has(c.chave));
  if (!novas.length) return 0;
  novas.forEach((c) => { vistas.add(c.chave); comemoradasDaSessao.add(c.chave); });
  salvarComemoradas(vistas);
  // empresa e equipe primeiro, depois a própria meta, depois os vendedores
  const peso = { empresa: 0, equipe: 1, eu: 2, vendedor: 3 };
  novas.sort((a, b) => peso[a.tipo] - peso[b.tipo]);
  comemorar(novas);
  return novas.length;
}

function textoConquista(c) {
  if (c.tipo === "eu") return { titulo: `Você bateu sua meta de ${c.rotulo}!`, sub: `${brl2.format(c.feito)} de ${brl2.format(c.meta)}` };
  if (c.tipo === "empresa") return { titulo: `A Infinity bateu a meta de ${c.rotulo}!`, sub: `${brl2.format(c.feito)} de ${brl2.format(c.meta)}` };
  if (c.tipo === "equipe") return { titulo: `${c.nome} bateu a meta de ${c.rotulo}!`, sub: `${brl2.format(c.feito)} de ${brl2.format(c.meta)}` };
  return { titulo: `${c.nome} bateu a meta de ${c.rotulo}!`, sub: `${brl2.format(c.feito)} de ${brl2.format(c.meta)}` };
}

// ---------- animação + cartão ----------
let comemorando = false;
const filaComemoracao = [];
function comemorar(novas) {
  filaComemoracao.push(novas);
  if (!comemorando) proximaComemoracao();
}
function proximaComemoracao() {
  const novas = filaComemoracao.shift();
  if (!novas) { comemorando = false; return; }
  comemorando = true;
  const menosMovimento = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const overlay = el("div", { class: "cq-overlay", role: "status", "aria-live": "polite" });
  const canvas = el("canvas", { class: "cq-confete", "aria-hidden": "true" });
  if (!menosMovimento) overlay.appendChild(canvas);
  const mostrar = novas.slice(0, 4);
  const resto = novas.length - mostrar.length;
  const fechar = () => {
    if (!overlay.isConnected) return;
    overlay.classList.add("saindo");
    setTimeout(() => { overlay.remove(); proximaComemoracao(); }, 350);
  };
  const cartao = el("div", { class: "cq-cartao" }, [
    el("div", { class: "cq-trofeu", "aria-hidden": "true" }, "🏆"),
    el("div", { class: "cq-rotulo" }, novas.length === 1 ? "Meta batida!" : `${novas.length} metas batidas!`),
    el("ul", { class: "cq-lista" }, mostrar.map((c) => {
      const t = textoConquista(c);
      return el("li", {}, [el("strong", {}, t.titulo), el("span", {}, t.sub)]);
    })),
    resto > 0 ? el("div", { class: "cq-resto" }, `e mais ${resto}…`) : null,
    el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: fechar }, "Comemorar! 🎉"),
  ]);
  overlay.appendChild(cartao);
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target === canvas) fechar(); });
  document.body.appendChild(overlay);
  tocarFanfarra();
  if (!menosMovimento) chuvaDeConfete(canvas);
  setTimeout(fechar, 9000);
}

function chuvaDeConfete(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const CORES = ["#fbbf24", "#8b5cf6", "#22d3ee", "#f97316", "#34d399", "#f472b6"];
  const pecas = [];
  // dois canhões, um de cada lado de baixo, + chuva de cima
  for (let i = 0; i < 90; i++) {
    const daEsquerda = i % 2 === 0;
    pecas.push({ x: daEsquerda ? 0 : W, y: H * 0.75, vx: (daEsquerda ? 1 : -1) * (4 + Math.random() * 9), vy: -(10 + Math.random() * 9),
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, cor: CORES[i % CORES.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 });
  }
  for (let i = 0; i < 70; i++) {
    pecas.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
      w: 6 + Math.random() * 5, h: 8 + Math.random() * 7, cor: CORES[i % CORES.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 });
  }
  const inicio = performance.now();
  const DURACAO = 5200;
  (function quadro(agora) {
    const t = agora - inicio;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = t > DURACAO - 900 ? Math.max(0, (DURACAO - t) / 900) : 1;
    pecas.forEach((p) => {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.cor;
      ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.rot * 2)), p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
      ctx.restore();
    });
    if (t < DURACAO && canvas.isConnected) requestAnimationFrame(quadro);
  })(inicio);
}

// musiquinha de vitória (sintetizada, ~2,5 s) — usa o som já liberado pela tela principal
function tocarFanfarra() {
  try {
    destravarAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + 0.05;
    const mestre = audioCtx.createGain();
    mestre.gain.value = 0.22;
    mestre.connect(audioCtx.destination);
    // [nota em Hz, início (s), duração (s)]
    const melodia = [
      [523.25, 0.00, 0.14], [659.25, 0.14, 0.14], [783.99, 0.28, 0.14], [1046.5, 0.42, 0.32],
      [783.99, 0.78, 0.12], [1046.5, 0.92, 0.75],
    ];
    const acorde = [[523.25, 0.92], [659.25, 0.92], [783.99, 0.92]];
    const nota = (freq, ini, dur, tipo, vol) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = tipo;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + ini);
      g.gain.exponentialRampToValueAtTime(vol, t0 + ini + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ini + dur);
      o.connect(g).connect(mestre);
      o.start(t0 + ini);
      o.stop(t0 + ini + dur + 0.05);
    };
    melodia.forEach(([f, i, d]) => { nota(f, i, d, "square", 0.5); nota(f * 2, i, d, "sine", 0.25); });
    acorde.forEach(([f, i]) => nota(f, i, 1.4, "triangle", 0.45));
  } catch (e) { /* sem som: a comemoração continua só com a animação */ }
}

// ---------- reconferir as metas com o painel aberto ----------
setInterval(async () => {
  if (document.hidden || typeof atual === "undefined" || !atual) return;
  const g = GRUPOS.find((x) => x.app === atual.app);
  if (!g || !g.nativo) return; // só com Painel geral / Minha área / Minha equipe na tela
  try {
    const r = await buscarMetas(new Date());
    if (verificarConquistas(r)) g.carregar(); // bateu agora: atualiza os números na tela também
  } catch (e) { /* tenta de novo na próxima volta */ }
}, RECONFERIR_METAS_MS);
