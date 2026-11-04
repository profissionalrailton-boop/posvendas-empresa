// Desfile da Viagem (novembro: prêmio da meta = viagem da equipe). De tempos em tempos algo atravessa
// a tela dos painéis: avião puxando a faixa "Rumo à viagem!", nuvens, mala rodando, bola de praia quicando.
// Mesmo funcionamento do halloween.js: só com painel do tema visível, nunca atrapalha cliques
// (pointer-events: none) e não roda para quem pediu menos movimento no sistema operacional.
(function () {
  const INTERVALO_MIN_MS = 15000;
  const INTERVALO_MAX_MS = 30000;
  const menosMovimento = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (menosMovimento) return;
  if (!document.querySelector(".sx-painel.tema-viagem")) return; // fora de novembro (ver TEMAS_DO_MES em metas.js)

  const conteudo = document.getElementById("sx-conteudo");
  if (!conteudo) return;
  const palco = document.createElement("div");
  palco.className = "hw-palco";
  palco.setAttribute("aria-hidden", "true");
  conteudo.appendChild(palco);

  const FRASES = ["Rumo a Canoa Quebrada! 🏖️", "Bora bater os 6 milhões! 🚀", "Quadriciclo nas dunas te espera! 🏜️", "Próxima parada: Canoa Quebrada! 🌴", "Casa de praia garantida? Depende de você! 🏠"];

  function painelComTemaVisivel() {
    return [...document.querySelectorAll(".sx-painel.tema-viagem")].some((p) => !p.classList.contains("hidden"));
  }
  function criar(conteudoHtml, classe) {
    const n = document.createElement("div");
    n.className = "hw-bicho " + (classe || "");
    n.innerHTML = conteudoHtml;
    palco.appendChild(n);
    return n;
  }
  const aleatorio = (a, b) => a + Math.random() * (b - a);

  // avião puxando faixa, subindo e descendo de leve
  function aviao() {
    const L = palco.clientWidth, H = palco.clientHeight;
    const daEsquerda = Math.random() < 0.5;
    const frase = FRASES[Math.floor(Math.random() * FRASES.length)];
    // o ✈️ aponta para a direita/cima; para voltar, espelha o conjunto e a faixa fica atrás do avião
    const a = criar(daEsquerda
      ? `<span class="vg-faixa">${frase}</span><span class="hw-emoji" style="font-size:30px">✈️</span>`
      : `<span class="hw-emoji" style="font-size:30px;display:inline-block;transform:scaleX(-1)">✈️</span><span class="vg-faixa">${frase}</span>`,
    "vg-aviao-wrap");
    const largura = 260;
    const x0 = daEsquerda ? -largura - 20 : L + 20, x1 = daEsquerda ? L + 40 : -largura - 40;
    const y = aleatorio(30, Math.max(50, H * 0.35));
    const quadros = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      quadros.push({ transform: `translate(${x0 + (x1 - x0) * t}px, ${y + Math.sin(t * Math.PI * 2) * 18}px)` });
    }
    a.animate(quadros, { duration: aleatorio(9000, 11000), easing: "linear", fill: "both" }).onfinish = () => a.remove();
  }

  // nuvens passando devagar, meio transparentes
  function nuvens() {
    const L = palco.clientWidth, H = palco.clientHeight;
    for (let i = 0; i < 3; i++) {
      const n = criar("☁️", "hw-emoji");
      n.style.fontSize = `${aleatorio(28, 46)}px`;
      const y = aleatorio(20, H * 0.5);
      n.animate([
        { transform: `translate(${L + 30}px, ${y}px)`, opacity: 0 },
        { opacity: 0.75, offset: 0.15 },
        { opacity: 0.75, offset: 0.85 },
        { transform: `translate(-90px, ${y}px)`, opacity: 0 },
      ], { duration: aleatorio(11000, 15000), delay: i * 1400, easing: "linear", fill: "both" }).onfinish = () => n.remove();
    }
  }

  // mala de viagem deslizando pelo rodapé, com um balancinho
  function mala() {
    const L = palco.clientWidth, H = palco.clientHeight;
    const m = criar("🧳", "hw-emoji");
    const tam = aleatorio(30, 38);
    m.style.fontSize = `${tam}px`;
    const daEsquerda = Math.random() < 0.5;
    const x0 = daEsquerda ? -60 : L + 20, x1 = daEsquerda ? L + 60 : -80;
    const y = H - tam - 18;
    const quadros = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      quadros.push({ transform: `translate(${x0 + (x1 - x0) * t}px, ${y - Math.abs(Math.sin(t * Math.PI * 6)) * 4}px) rotate(${Math.sin(t * Math.PI * 12) * 4}deg)` });
    }
    m.animate(quadros, { duration: aleatorio(7000, 9000), easing: "linear", fill: "both" }).onfinish = () => m.remove();
  }

  // bola de praia quicando pelo rodapé
  function bola() {
    const L = palco.clientWidth, H = palco.clientHeight;
    const b = criar("🏐", "hw-emoji");
    const tam = aleatorio(26, 34);
    b.style.fontSize = `${tam}px`;
    const daEsquerda = Math.random() < 0.5;
    const x0 = daEsquerda ? -60 : L + 20, x1 = daEsquerda ? L + 60 : -80;
    const chao = H - tam - 18;
    const quadros = [];
    const pulos = 5;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const altura = Math.abs(Math.sin(t * Math.PI * pulos)) * aleatorio(70, 110) * (1 - t * 0.5);
      quadros.push({ transform: `translate(${x0 + (x1 - x0) * t}px, ${chao - altura}px) rotate(${(daEsquerda ? 1 : -1) * t * 720}deg)` });
    }
    b.animate(quadros, { duration: aleatorio(6500, 8000), easing: "linear", fill: "both" }).onfinish = () => b.remove();
  }

  const DESFILE = [aviao, nuvens, mala, bola];
  let ultimo = -1;
  function proximo() {
    setTimeout(() => {
      if (!document.hidden && painelComTemaVisivel() && palco.childElementCount === 0) {
        let i;
        do { i = Math.floor(Math.random() * DESFILE.length); } while (i === ultimo && DESFILE.length > 1);
        ultimo = i;
        try { DESFILE[i](); } catch (e) { /* enfeite: nunca pode quebrar o painel */ }
      }
      proximo();
    }, aleatorio(INTERVALO_MIN_MS, INTERVALO_MAX_MS));
  }
  // o primeiro (avião com a faixa) aparece logo depois de abrir, para mostrar que existe
  setTimeout(() => { if (painelComTemaVisivel()) { ultimo = 0; try { aviao(); } catch (e) { /* ignora */ } } proximo(); }, 4000);
})();
