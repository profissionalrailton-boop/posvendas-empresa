// Desfile de Halloween: de tempos em tempos um personagem atravessa a tela dos painéis
// (morcegos, fantasminha, aranha descendo pelo fio, abóbora rolando). Só roda quando um painel com
// o tema de Halloween está aberto e a aba do navegador está visível; nunca atrapalha cliques
// (pointer-events: none) e não roda para quem pediu menos movimento no sistema operacional.
(function () {
  const INTERVALO_MIN_MS = 15000;
  const INTERVALO_MAX_MS = 30000;
  const menosMovimento = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (menosMovimento) return;
  if (!document.querySelector(".sx-painel.tema-halloween")) return; // fora de outubro (ver TEMAS_DO_MES em metas.js)

  const conteudo = document.getElementById("sx-conteudo");
  if (!conteudo) return;
  const palco = document.createElement("div");
  palco.className = "hw-palco";
  palco.setAttribute("aria-hidden", "true");
  conteudo.appendChild(palco);

  // aranha desenhada (o emoji de aranha não aparece em todo Windows)
  const ARANHA_SVG = `<svg viewBox="0 0 40 40" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M14 17 6 11M14 20 4 20M14 23 6 29M15 26 9 34M26 17l8-6M26 20h10M26 23l8 6M25 26l6 8"/>
    <ellipse cx="20" cy="22" rx="6.5" ry="8" fill="currentColor" stroke="none"/>
    <circle cx="20" cy="12.5" r="4.2" fill="currentColor" stroke="none"/>
    <circle cx="18.4" cy="12" r="1" fill="#f97316" stroke="none"/><circle cx="21.6" cy="12" r="1" fill="#f97316" stroke="none"/>
  </svg>`;

  function painelComTemaVisivel() {
    return [...document.querySelectorAll(".sx-painel.tema-halloween")].some((p) => !p.classList.contains("hidden"));
  }
  function criar(conteudoHtml, classe) {
    const n = document.createElement("div");
    n.className = "hw-bicho " + (classe || "");
    n.innerHTML = conteudoHtml;
    palco.appendChild(n);
    return n;
  }
  const aleatorio = (a, b) => a + Math.random() * (b - a);

  // morcegos: bando de 3 cruzando em zigue-zague
  function morcegos() {
    const L = palco.clientWidth, H = palco.clientHeight;
    const daEsquerda = Math.random() < 0.5;
    const yBase = aleatorio(40, Math.max(60, H * 0.45));
    for (let i = 0; i < 3; i++) {
      const b = criar("🦇", "hw-emoji");
      b.style.fontSize = `${aleatorio(20, 30)}px`;
      const x0 = daEsquerda ? -60 : L + 20, x1 = daEsquerda ? L + 60 : -80;
      const y0 = yBase + i * 22;
      const quadros = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        quadros.push({ transform: `translate(${x0 + (x1 - x0) * t}px, ${y0 + Math.sin(t * Math.PI * 4 + i) * 26}px) scaleX(${daEsquerda ? 1 : -1})` });
      }
      b.animate(quadros, { duration: aleatorio(5200, 7000), delay: i * 350, easing: "linear", fill: "both" }).onfinish = () => b.remove();
    }
  }

  // fantasminha: flutua devagar balançando, meio transparente
  function fantasma() {
    const L = palco.clientWidth, H = palco.clientHeight;
    const g = criar("👻", "hw-emoji hw-fantasma");
    g.style.fontSize = `${aleatorio(30, 42)}px`;
    const daDireita = Math.random() < 0.5;
    const x0 = daDireita ? L + 30 : -70, x1 = daDireita ? -90 : L + 50;
    const y = aleatorio(H * 0.25, H * 0.7);
    const quadros = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      quadros.push({ transform: `translate(${x0 + (x1 - x0) * t}px, ${y + Math.sin(t * Math.PI * 3) * 30}px) rotate(${Math.sin(t * Math.PI * 6) * 8}deg)`, opacity: t < 0.1 ? t * 8.5 : t > 0.9 ? (1 - t) * 8.5 : 0.85 });
    }
    g.animate(quadros, { duration: aleatorio(9000, 12000), easing: "linear", fill: "both" }).onfinish = () => g.remove();
  }

  // aranha: desce pelo fio, balança e sobe de volta
  function aranha() {
    const L = palco.clientWidth;
    const x = aleatorio(L * 0.15, L * 0.85);
    const queda = aleatorio(120, 240);
    const a = criar(`<div class="hw-fio"></div><div class="hw-aranha">${ARANHA_SVG}</div>`, "hw-aranha-wrap");
    a.style.left = `${x}px`;
    const fio = a.querySelector(".hw-fio"), corpo = a.querySelector(".hw-aranha");
    const tempos = { duration: 7000, easing: "ease-in-out", fill: "both" };
    fio.animate([{ height: "0px" }, { height: `${queda}px`, offset: 0.35 }, { height: `${queda}px`, offset: 0.65 }, { height: "0px" }], tempos);
    corpo.animate([
      { transform: "translate(-50%, -40px) rotate(0deg)" },
      { transform: `translate(-50%, ${queda}px) rotate(0deg)`, offset: 0.35 },
      { transform: `translate(-50%, ${queda}px) rotate(14deg)`, offset: 0.45 },
      { transform: `translate(-50%, ${queda}px) rotate(-14deg)`, offset: 0.55 },
      { transform: `translate(-50%, ${queda}px) rotate(0deg)`, offset: 0.65 },
      { transform: "translate(-50%, -40px) rotate(0deg)" },
    ], tempos).onfinish = () => a.remove();
  }

  // abóbora rolando pelo rodapé da tela
  function abobora() {
    const L = palco.clientWidth, H = palco.clientHeight;
    const p = criar("🎃", "hw-emoji");
    const tam = aleatorio(28, 38);
    p.style.fontSize = `${tam}px`;
    const daEsquerda = Math.random() < 0.5;
    const x0 = daEsquerda ? -60 : L + 20, x1 = daEsquerda ? L + 60 : -80;
    const y = H - tam - 18;
    const voltas = (Math.abs(x1 - x0) / (Math.PI * tam)) * 360;
    p.animate([
      { transform: `translate(${x0}px, ${y}px) rotate(0deg)` },
      { transform: `translate(${x1}px, ${y}px) rotate(${daEsquerda ? voltas : -voltas}deg)` },
    ], { duration: aleatorio(6500, 8500), easing: "linear", fill: "both" }).onfinish = () => p.remove();
  }

  const BICHOS = [morcegos, fantasma, aranha, abobora];
  let ultimo = -1;
  function proximo() {
    setTimeout(() => {
      if (!document.hidden && painelComTemaVisivel() && palco.childElementCount === 0) {
        let i;
        do { i = Math.floor(Math.random() * BICHOS.length); } while (i === ultimo && BICHOS.length > 1);
        ultimo = i;
        try { BICHOS[i](); } catch (e) { /* enfeite: nunca pode quebrar o painel */ }
      }
      proximo();
    }, aleatorio(INTERVALO_MIN_MS, INTERVALO_MAX_MS));
  }
  // o primeiro aparece logo depois de abrir, para mostrar que existe
  setTimeout(() => { if (painelComTemaVisivel()) { ultimo = 0; try { morcegos(); } catch (e) { /* ignora */ } } proximo(); }, 4000);
})();
