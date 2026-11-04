// Aba "Aposta": duelo de produção entre duas vendedoras, com tema de luta.
// Só vale venda de Adesão (parcelinha = false). Dados da função aposta_atual (sql/016), que devolve
// a aposta ativa e as vendas de Adesão das duas no período (sem dados de cliente).
// Para um novo duelo: desativar a linha atual em "apostas" e inserir outra (nomes iguais aos do cadastro).
const APOSTA_FOTO = "aposta.jpg?v=1";
// recorte do rosto de cada uma no pôster (pixels do aposta.jpg, 1189×1323): centro x, y e tamanho do recorte
// a = Taty (de cabelo liso e óculos, à direita no pôster) · b = Yarine (cabelo cacheado, à esquerda)
const APOSTA_ROSTOS = { a: { x: 800, y: 290, lado: 300 }, b: { x: 525, y: 300, lado: 300 } };
let apostaTimer = null;

const ltBrl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const ltData = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}`; };

function rostoAposta(lado, cor) {
  const r = APOSTA_ROSTOS[lado];
  const tam = 84;
  const esc = tam / r.lado;
  return el("div", {
    class: `lt-avatar lt-${cor}`, "aria-hidden": "true",
    style: `background-image:url(${APOSTA_FOTO});background-size:${Math.round(1189 * esc)}px auto;` +
      `background-position:${-Math.round(r.x * esc - tam / 2)}px ${-Math.round(r.y * esc - tam / 2)}px`,
  });
}

// rounds = semanas do período (1–7, 8–14, …); o último round pega até o fim
function roundsAposta(ap) {
  const ini = new Date(ap.inicio + "T12:00:00"), fim = new Date(ap.fim + "T12:00:00");
  const rounds = [];
  for (let d = new Date(ini); d <= fim; d.setDate(d.getDate() + 7)) {
    const f = new Date(d); f.setDate(f.getDate() + 6);
    const iso = (x) => x.toISOString().slice(0, 10);
    rounds.push({ ini: iso(d), fim: iso(f > fim ? fim : f) });
  }
  // sobra de 1–2 dias no fim do mês entra no último round
  if (rounds.length > 1) {
    const ult = rounds[rounds.length - 1];
    const dias = (new Date(ult.fim) - new Date(ult.ini)) / 86400000 + 1;
    if (dias <= 2) { rounds[rounds.length - 2].fim = ult.fim; rounds.pop(); }
  }
  return rounds;
}

function cantoAposta(lado, cor, nome, apelido, st, lider, rotuloCanto) {
  return el("div", { class: `lt-canto lt-${cor}` + (lider ? " lider" : "") }, [
    el("div", { class: "lt-canto-rotulo" }, rotuloCanto),
    rostoAposta(lado, cor),
    el("div", { class: "lt-nome" }, apelido.toUpperCase()),
    el("div", { class: "lt-nome-completo" }, nome),
    el("div", { class: "lt-total" }, ltBrl0.format(st.total)),
    el("div", { class: "lt-total-rot" }, "em Adesão"),
    el("div", { class: "lt-stats" }, [
      el("div", {}, [el("strong", {}, String(st.qtd)), el("span", {}, st.qtd === 1 ? "venda" : "vendas")]),
      el("div", {}, [el("strong", {}, st.qtd ? ltBrl0.format(st.total / st.qtd) : "—"), el("span", {}, "ticket médio")]),
      el("div", {}, [el("strong", {}, st.maior ? ltBrl0.format(st.maior) : "—"), el("span", {}, "maior golpe")]),
    ]),
    lider ? el("div", { class: "lt-cinturao" }, "🏆 NA FRENTE") : null,
  ]);
}

async function carregarAposta() {
  const raiz = document.getElementById("sx-aposta");
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "lt-carregando" }, "Preparando o octógono…"));
  const { data: r, error } = await sb.rpc("aposta_atual");
  if (error || !r) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, error ? "Não foi possível carregar a aposta." : "Nenhuma aposta ativa no momento."));
    return;
  }
  const ap = r.aposta;
  const stats = (nome) => {
    const vs = r.vendas.filter((v) => v.vendedor === nome);
    return { total: vs.reduce((s, v) => s + Number(v.valor), 0), qtd: vs.length, maior: Math.max(0, ...vs.map((v) => Number(v.valor))) };
  };
  const A = stats(ap.lutadora_a), B = stats(ap.lutadora_b);
  const soma = A.total + B.total;
  const pctA = soma ? (A.total / soma) * 100 : 50;
  const diff = Math.abs(A.total - B.total);
  const liderA = A.total > B.total, liderB = B.total > A.total;

  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const fim = new Date(ap.fim + "T12:00:00"), ini = new Date(ap.inicio + "T12:00:00");
  const diasFaltam = Math.round((fim - hoje) / 86400000);
  const encerrada = diasFaltam < 0;
  const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  const status = soma === 0 ? "O gongo tocou! Ninguém pontuou ainda — quem abre o placar?"
    : diff === 0 ? "Empate técnico! Está tudo igual no octógono."
    : `${(liderA ? ap.apelido_a : ap.apelido_b).toUpperCase()} ${encerrada ? "venceu" : "lidera"} por ${ltBrl0.format(diff)}`;

  // rounds (semanas)
  const rounds = roundsAposta(ap).map((rd, i) => {
    const naRound = (nome) => r.vendas.filter((v) => v.vendedor === nome && v.data >= rd.ini && v.data <= rd.fim).reduce((s, v) => s + Number(v.valor), 0);
    const a = naRound(ap.lutadora_a), b = naRound(ap.lutadora_b);
    const futuro = rd.ini > hojeISO, agora = rd.ini <= hojeISO && hojeISO <= rd.fim;
    const venc = futuro || (a === 0 && b === 0) ? null : a > b ? "a" : b > a ? "b" : "empate";
    return el("div", { class: "lt-round" + (agora ? " agora" : "") + (futuro ? " futuro" : "") }, [
      el("div", { class: "lt-round-num" }, `ROUND ${i + 1}`),
      el("div", { class: "lt-round-datas" }, `${ltData(rd.ini)} a ${ltData(rd.fim)}${agora ? " · AO VIVO" : ""}`),
      el("div", { class: "lt-round-linha" + (venc === "a" ? " venceu" : "") }, [el("span", {}, ap.apelido_a), el("strong", {}, futuro ? "—" : ltBrl0.format(a))]),
      el("div", { class: "lt-round-linha" + (venc === "b" ? " venceu" : "") }, [el("span", {}, ap.apelido_b), el("strong", {}, futuro ? "—" : ltBrl0.format(b))]),
      el("div", { class: "lt-round-res" }, futuro ? "em breve" : venc === null ? (agora ? "em andamento" : "sem golpes")
        : venc === "empate" ? "empate" : `${agora ? "vencendo" : "venceu"}: ${(venc === "a" ? ap.apelido_a : ap.apelido_b)}`),
    ]);
  });

  // golpes (vendas) mais recentes primeiro
  const golpes = [...r.vendas].reverse().slice(0, 12).map((v) => {
    const ehA = v.vendedor === ap.lutadora_a;
    return el("li", { class: ehA ? "lt-vermelho" : "lt-azul" }, [
      el("span", { class: "lt-golpe-ic", "aria-hidden": "true" }, "🥊"),
      el("span", { class: "lt-golpe-txt" }, [el("strong", {}, ehA ? ap.apelido_a : ap.apelido_b), ` acertou ${ltBrl0.format(Number(v.valor))}`, v.administradora ? el("span", { class: "lt-golpe-adm" }, ` · ${v.administradora}`) : null]),
      el("span", { class: "lt-golpe-data" }, ltData(v.data)),
    ]);
  });

  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "lt-pagina" }, [
    el("div", { class: "lt-topo" }, [
      el("div", {}, [
        el("div", { class: "lt-chamada" }, "APOSTA ENTRE VENDEDORAS"),
        el("h1", { class: "lt-titulo" }, ap.titulo.toUpperCase()),
        el("div", { class: "lt-sub" }, `Só vale venda de Adesão · ${ltData(ap.inicio)} a ${ltData(ap.fim)}`),
      ]),
      el("div", { class: "lt-relogio" + (encerrada ? " fim" : "") }, encerrada
        ? [el("strong", {}, "FIM"), el("span", {}, "luta encerrada")]
        : [el("strong", {}, String(diasFaltam)), el("span", {}, diasFaltam === 1 ? "dia para o gongo final" : diasFaltam === 0 ? "último dia!" : "dias para o gongo final")]),
    ]),
    el("div", { class: "lt-arena" }, [
      el("div", { class: "lt-poster" }, [el("img", { src: APOSTA_FOTO, alt: `${ap.apelido_a} contra ${ap.apelido_b}` })]),
      el("div", { class: "lt-placar" }, [
        el("div", { class: "lt-cantos" }, [
          cantoAposta("a", "vermelho", ap.lutadora_a, ap.apelido_a, A, liderA, "CANTO VERMELHO"),
          el("div", { class: "lt-vs", "aria-hidden": "true" }, "VS"),
          cantoAposta("b", "azul", ap.lutadora_b, ap.apelido_b, B, liderB, "CANTO AZUL"),
        ]),
        el("div", { class: "lt-cabo", role: "img", "aria-label": `${ap.apelido_a} ${Math.round(pctA)}% contra ${ap.apelido_b} ${Math.round(100 - pctA)}% da produção somada` }, [
          el("div", { class: "lt-cabo-a", style: `width:${pctA}%` }, soma ? `${Math.round(pctA)}%` : ""),
          el("div", { class: "lt-cabo-b", style: `width:${100 - pctA}%` }, soma ? `${Math.round(100 - pctA)}%` : ""),
        ]),
        el("div", { class: "lt-status" }, status),
        el("div", { class: "lt-soma" }, `Produção somada das duas: ${ltBrl0.format(soma)}`),
        ap.premio ? el("div", { class: "lt-bolsa" }, [
          el("div", { class: "lt-bolsa-ic", "aria-hidden": "true" }, "💰"),
          el("div", {}, [
            el("div", { class: "lt-bolsa-rot" }, encerrada ? "BOLSA DA LUTA" : "VALENDO"),
            el("div", { class: "lt-bolsa-valor" }, ap.premio),
            ap.premio_detalhe ? el("div", { class: "lt-bolsa-det" }, ap.premio_detalhe) : null,
          ]),
        ]) : null,
      ]),
    ]),
    el("h2", { class: "lt-secao" }, "ROUNDS DA SEMANA"),
    el("div", { class: "lt-rounds" }, rounds),
    el("h2", { class: "lt-secao" }, "ÚLTIMOS GOLPES"),
    golpes.length ? el("ul", { class: "lt-golpes" }, golpes) : el("div", { class: "lt-vazio" }, "Nenhuma venda de Adesão ainda. A luta está só começando!"),
  ]));

  // atualiza sozinho a cada minuto enquanto a aba estiver aberta
  clearInterval(apostaTimer);
  apostaTimer = setInterval(() => {
    if (!document.hidden && !raiz.classList.contains("hidden")) carregarAposta();
  }, 60000);
}
