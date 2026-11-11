// Aba "Rouba prêmio": lista de metas e banca de prêmios.
// Fluxo: o editor (RP_EDITOR) marca as metas batidas de um vendedor (uma ou várias de uma vez); cada meta batida
// libera 1 escolha, que o PRÓPRIO vendedor faz nesta aba — prêmio da banca ou roubado de alguém. O editor também
// pode escolher por ele, desmarcar meta sem escolha feita e desfazer a última escolha.
// Trava real no banco (sql/021 + sql/023: rp_marcar, rp_desmarcar, rp_escolher, rp_desfazer).
// Fotos = foto de perfil (foto-perfil.js, sql/022).
const RP_EDITOR = "profissionalrailton@gmail.com";
const RP_FORA = ["Railton Angelo"]; // gestão com cadastro de vendedor: não participa
let rpDados = null;

const rpEditor = () => !!(perms && perms.email === RP_EDITOR);
const rpDataHora = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
const rpPremioTxt = (p) => `${p.emoji} ${p.nome}`;
const rpPrimeiro = (nome) => nome.split(" ")[0];
const rpFoto = (nome, classe) => avatarPerfil(nome, rpDados.fotos.get(nome), classe);
const rpPendentes = (nome) => rpDados.pendentes.get(nome) || 0;

async function carregarRoubaPremio() {
  const raiz = document.getElementById("sx-rouba-premio");
  rpAoVivo();
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "px-carregando" }, "Abrindo a banca…"));
  const [m, p, f, e, v, a] = await Promise.all([
    sb.from("rp_metas").select("*").order("numero"),
    sb.from("rp_premios").select("*").order("ordem"),
    sb.from("vendedor_fotos").select("vendedor, foto_url"),
    sb.from("rp_eventos").select("*").order("id", { ascending: false }),
    sb.from("administrativo_vendedores").select("nome, ativo").order("nome"),
    sb.from("posvendas_vendedor_acesso").select("vendedor").ilike("email", (perms && perms.email) || "-").limit(1),
  ]);
  const erro = [m, p, f, e, v].find((r) => r.error);
  if (erro) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível carregar o Rouba prêmio: " + erro.error.message));
    return;
  }
  // meta batida sem escolha registrada = escolha pendente de quem bateu
  const usadas = new Set(e.data.map((x) => x.meta));
  const pendentes = new Map();
  m.data.forEach((x) => { if (x.batida_por && !usadas.has(x.numero)) pendentes.set(x.batida_por, (pendentes.get(x.batida_por) || 0) + 1); });
  rpDados = {
    metas: m.data, premios: p.data, eventos: e.data, usadas, pendentes,
    fotos: new Map(f.data.map((x) => [x.vendedor, x.foto_url])),
    eu: a.data && a.data[0] ? a.data[0].vendedor : null,
    vendedores: v.data.filter((x) => x.ativo !== false && !RP_FORA.includes(x.nome)).map((x) => x.nome),
  };
  desenharRoubaPremio(raiz);
}

function desenharRoubaPremio(raiz) {
  const { metas, premios, eventos, vendedores, usadas, eu } = rpDados;
  const editor = rpEditor();
  const banca = premios.filter((p) => !p.dono);
  const batidas = metas.filter((x) => x.batida_por).length;
  const roubos = premios.reduce((s, p) => s + p.vezes_roubado, 0);
  const totalPend = [...rpDados.pendentes.values()].reduce((s, n) => s + n, 0);
  const minhasPend = eu ? rpPendentes(eu) : 0;
  const premioPorId = new Map(premios.map((p) => [p.id, p]));
  const metaPorNum = new Map(metas.map((x) => [x.numero, x]));

  // participantes: quem tem mais prêmios primeiro
  const porDono = new Map(vendedores.map((n) => [n, []]));
  premios.forEach((p) => { if (p.dono) { if (!porDono.has(p.dono)) porDono.set(p.dono, []); porDono.get(p.dono).push(p); } });
  const participantes = [...porDono.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR"));

  const premioCard = (p) => el("div", { class: "rp-premio" }, [
    el("div", { class: "rp-premio-emoji", "aria-hidden": "true" }, p.emoji),
    el("div", { class: "rp-premio-nome" }, p.nome),
    p.vezes_roubado ? el("div", { class: "rp-premio-roubado" }, `roubado ${p.vezes_roubado}×`) : null,
  ]);

  raiz.innerHTML = "";
  raiz.appendChild(el("div", { class: "rp-pagina" }, [
    el("div", { class: "rp-topo" }, [
      el("div", {}, [
        el("div", { class: "rp-chamada" }, "PREMIAÇÃO INFINITY"),
        el("h1", { class: "rp-titulo" }, "🎁 Rouba prêmio"),
        el("p", { class: "rp-sub" }, "Cada meta batida libera 1 prêmio: pegue da banca ou roube o de alguém. Quem ainda não bateu, corre que dá tempo!"),
      ]),
      el("div", { class: "rp-topo-acoes" }, [
        editor ? el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => marcarMetasRoubaPremio() }, "✔ Marcar metas batidas") : null,
        editor && eventos.length ? el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: desfazerRoubaPremio }, "↩ Desfazer última escolha") : null,
        el("span", { class: "rp-aovivo" + (rpAoVivoOk ? " on" : ""), title: "A tela atualiza sozinha quando alguém marca meta ou escolhe prêmio" }, rpAoVivoOk ? "● Ao vivo" : "○ Conectando…"),
        el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: carregarRoubaPremio }, "↻ Atualizar"),
      ]),
    ]),

    minhasPend ? el("div", { class: "rp-vez" }, [
      rpFoto(eu, "rp-vez-foto"),
      el("div", { class: "rp-vez-txt" }, [
        el("strong", {}, `É a sua vez, ${rpPrimeiro(eu)}! 🎉`),
        el("span", {}, minhasPend === 1 ? "Você bateu uma meta e tem 1 prêmio para escolher." : `Você bateu metas e tem ${minhasPend} prêmios para escolher.`),
      ]),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => escolherPremioRoubaPremio(eu, false) }, minhasPend === 1 ? "Escolher meu prêmio" : `Escolher prêmio (${minhasPend})`),
    ]) : null,

    el("div", { class: "px-grid px-kpis" }, [
      card("Metas batidas", `${batidas} de ${metas.length}`, `${metas.length - batidas} ainda abertas`, { destaque: true }),
      card("Prêmios na banca", `${banca.length} de ${premios.length}`, banca.length ? "esperando dono" : "agora só roubando 😈"),
      card("Escolhas pendentes", num.format(totalPend), totalPend ? "tem gente para escolher prêmio 👀" : "ninguém na fila"),
      card("Roubos", num.format(roubos), roubos ? "a disputa está quente 🔥" : "ninguém roubou ainda"),
    ]),

    el("h2", { class: "rp-h2" }, "🏦 Banca"),
    banca.length
      ? el("div", { class: "rp-banca" }, banca.map(premioCard))
      : el("div", { class: "rp-vazio" }, "A banca está vazia — a partir de agora, só roubando! 😈"),

    el("h2", { class: "rp-h2" }, "👥 Participantes"),
    el("div", { class: "rp-pessoas" }, participantes.map(([nome, lista]) => {
      const pend = rpPendentes(nome);
      const podeEscolher = pend && (editor || nome === eu);
      return el("div", { class: "rp-pessoa" + (lista.length ? " tem" : "") + (pend ? " pend" : "") }, [
        el("div", { class: "rp-pessoa-foto" }, [
          rpFoto(nome, "rp-avatar"),
          editor || nome === eu ? el("button", { type: "button", class: "rp-foto-btn", title: nome === eu ? "Trocar minha foto" : "Trocar foto", "aria-label": `Trocar foto de ${nome}`, onclick: () => trocarFotoPerfil(nome, carregarRoubaPremio) }, "📷") : null,
        ]),
        el("div", { class: "rp-pessoa-nome" }, nome),
        el("div", { class: "rp-pessoa-qtd" }, lista.length ? `${lista.length} ${lista.length === 1 ? "prêmio" : "prêmios"}` : "nenhum prêmio ainda"),
        pend ? (podeEscolher
          ? el("button", { type: "button", class: "rp-pend", onclick: () => escolherPremioRoubaPremio(nome, nome !== eu) }, `🎁 ${pend} para escolher${nome !== eu ? " · escolher por ele(a)" : ""}`)
          : el("div", { class: "rp-pend" }, `🎁 ${pend} para escolher`)) : null,
        lista.length ? el("div", { class: "rp-pessoa-premios" }, lista.map(premioCard)) : null,
      ]);
    })),

    el("h2", { class: "rp-h2" }, "🎯 Metas"),
    editor ? el("p", { class: "rp-dica" }, "Clique numa meta aberta para marcar quem bateu (dá para marcar várias de uma vez). Clique numa meta batida com escolha pendente para desmarcar.") : null,
    el("ol", { class: "rp-metas" }, metas.map((x) => {
      const feita = !!x.batida_por, pend = feita && !usadas.has(x.numero);
      const conteudo = [
        el("span", { class: "rp-meta-num" }, String(x.numero)),
        el("span", { class: "rp-meta-txt" }, [
          el("span", { class: "rp-meta-titulo" }, x.titulo),
          feita ? el("span", { class: "rp-meta-quem" }, `✔ ${x.batida_por} · ${rpDataHora(x.batida_em).slice(0, 5)}${pend ? " · escolha pendente" : ""}`) : null,
        ]),
      ];
      const acao = !editor ? null : !feita ? () => marcarMetasRoubaPremio(x.numero) : pend ? () => desmarcarMetaRoubaPremio(x) : null;
      return el("li", { class: "rp-meta" + (feita ? " feita" : "") + (pend ? " pend" : "") },
        acao ? el("button", { type: "button", class: "rp-meta-btn", onclick: acao }, conteudo) : el("div", { class: "rp-meta-btn" }, conteudo));
    })),

    el("h2", { class: "rp-h2" }, "📜 Últimas escolhas"),
    eventos.length
      ? el("ul", { class: "rp-jogadas" }, eventos.slice(0, 40).map((ev) => {
          const p = premioPorId.get(ev.premio_id), mt = metaPorNum.get(ev.meta);
          return el("li", { class: ev.de_dono ? "roubo" : "" }, [
            el("span", { class: "rp-jogada-ic", "aria-hidden": "true" }, ev.de_dono ? "🦹" : "🎉"),
            el("span", { class: "rp-jogada-txt" }, [
              el("strong", {}, ev.vendedor), ev.de_dono ? " roubou " : " pegou ", el("strong", {}, p ? rpPremioTxt(p) : "um prêmio"),
              ev.de_dono ? [" de ", el("strong", {}, ev.de_dono)] : " da banca",
              el("span", { class: "rp-jogada-meta" }, ` · meta ${ev.meta}${mt ? " (" + mt.titulo.toLowerCase() + ")" : ""}`),
            ].flat()),
            el("span", { class: "rp-jogada-data" }, rpDataHora(ev.em)),
          ]);
        }))
      : el("div", { class: "rp-vazio" }, "Nenhum prêmio escolhido ainda. Quem vai abrir a disputa?"),
  ]));
}

function rpModal(titulo, sub, corpo) {
  const fundo = el("div", { class: "modal-overlay" });
  const fechar = () => fundo.remove();
  fundo.appendChild(el("div", { class: "modal-box rp-modal", role: "dialog", "aria-label": titulo }, [
    el("div", { class: "modal-header" }, [
      el("div", {}, [el("div", { class: "modal-title" }, titulo), sub ? el("div", { class: "modal-sub" }, sub) : null]),
      el("button", { class: "icon-btn", type: "button", onclick: fechar, "aria-label": "Fechar" }, "✕"),
    ]),
    ...corpo,
  ]));
  fundo.addEventListener("click", (ev) => { if (ev.target === fundo) fechar(); });
  document.body.appendChild(fundo);
  return fechar;
}
const rpErro = (box, msg) => { box.textContent = msg; box.classList.remove("hidden"); };

// editor: marcar uma ou várias metas abertas como batidas por um vendedor
function marcarMetasRoubaPremio(metaInicial) {
  const abertas = rpDados.metas.filter((x) => !x.batida_por);
  const marcadas = new Set(metaInicial ? [metaInicial] : []);
  const erro = el("div", { class: "auth-error hidden" });
  const quem = el("select", { class: "ap-input" }, [el("option", { value: "" }, "Escolha quem bateu…"), ...rpDados.vendedores.map((n) => el("option", { value: n }, n))]);
  const confirmar = el("button", { type: "button", class: "btn btn-primary btn-block" }, "Confirmar");
  const lista = el("div", { class: "rp-checks" }, abertas.map((x) => {
    const cb = el("input", { type: "checkbox", checked: marcadas.has(x.numero) ? "checked" : null });
    cb.addEventListener("change", () => { cb.checked ? marcadas.add(x.numero) : marcadas.delete(x.numero); atualizar(); });
    return el("label", { class: "rp-check" }, [cb, el("span", { class: "rp-meta-num" }, String(x.numero)), el("span", {}, x.titulo)]);
  }));
  const atualizar = () => {
    const n = marcadas.size;
    confirmar.disabled = !(quem.value && n);
    confirmar.textContent = quem.value && n ? `Confirmar: ${n} ${n === 1 ? "meta" : "metas"} para ${rpPrimeiro(quem.value)} · libera ${n} ${n === 1 ? "prêmio" : "prêmios"}` : "Confirmar";
  };
  quem.addEventListener("change", atualizar);
  const fechar = rpModal("Marcar metas batidas", "Cada meta marcada libera 1 prêmio para a pessoa escolher", [
    erro,
    el("div", { class: "field" }, [el("label", {}, "Quem bateu"), quem]),
    el("div", { class: "field" }, [el("label", {}, "Metas batidas"), lista]),
    confirmar,
  ]);
  confirmar.addEventListener("click", async () => {
    confirmar.disabled = true;
    rpAcaoLocal = Date.now();
    const { error } = await sb.rpc("rp_marcar", { p_metas: [...marcadas], p_vendedor: quem.value });
    if (error) { rpErro(erro, "Não foi possível salvar: " + error.message); confirmar.disabled = false; return; }
    fechar();
    showToast(`✔ ${rpPrimeiro(quem.value)} liberou ${marcadas.size} ${marcadas.size === 1 ? "prêmio" : "prêmios"} para escolher!`);
    carregarRoubaPremio();
  });
  atualizar();
  quem.focus();
}

async function desmarcarMetaRoubaPremio(meta) {
  if (!confirm(`Desmarcar a meta ${meta.numero} (${meta.titulo})?\n\nEla volta a ficar aberta e ${meta.batida_por} perde 1 escolha de prêmio.`)) return;
  rpAcaoLocal = Date.now();
  const { error } = await sb.rpc("rp_desmarcar", { p_meta: meta.numero });
  if (error) { showToast("Não foi possível desmarcar: " + error.message); return; }
  showToast("Meta desmarcada.");
  carregarRoubaPremio();
}

// escolher prêmio (o próprio vendedor; ou o editor por ele, com porOutro = true)
function escolherPremioRoubaPremio(nome, porOutro) {
  const pend = rpPendentes(nome);
  const erro = el("div", { class: "auth-error hidden" });
  const lista = el("div", { class: "rp-escolha" });
  const confirmar = el("button", { type: "button", class: "btn btn-primary btn-block", disabled: "disabled" }, "Escolha um prêmio");
  let escolhido = null;
  const desenhar = () => {
    lista.innerHTML = "";
    [["Da banca", rpDados.premios.filter((p) => !p.dono)], ["Roubar de alguém 😈", rpDados.premios.filter((p) => p.dono)]].forEach(([rot, ps]) => {
      if (!ps.length) return;
      lista.appendChild(el("div", { class: "rp-escolha-rot" }, rot));
      ps.forEach((p) => {
        const meu = p.dono === nome;
        lista.appendChild(el("button", {
          type: "button", class: "rp-opcao" + (escolhido && escolhido.id === p.id ? " sel" : ""), disabled: meu ? "disabled" : null,
          onclick: () => { escolhido = p; desenhar(); },
        }, [
          el("span", { class: "rp-opcao-emoji", "aria-hidden": "true" }, p.emoji),
          el("span", { class: "rp-opcao-nome" }, p.nome),
          el("span", { class: "rp-opcao-dono" }, !p.dono ? "banca" : meu ? (porOutro ? `já é de ${rpPrimeiro(nome)}` : "já é seu") : `com ${p.dono}`),
        ]));
      });
    });
    confirmar.disabled = !escolhido;
    confirmar.textContent = !escolhido ? "Escolha um prêmio"
      : escolhido.dono ? `Confirmar: roubar ${escolhido.nome} de ${rpPrimeiro(escolhido.dono)}` : `Confirmar: pegar ${escolhido.nome}`;
  };
  const fechar = rpModal(porOutro ? `Escolher prêmio por ${nome}` : "Escolha seu prêmio 🎁",
    `${pend} ${pend === 1 ? "prêmio liberado" : "prêmios liberados"} · pegue da banca ou roube de alguém`, [erro, lista, confirmar]);
  confirmar.addEventListener("click", async () => {
    confirmar.disabled = true;
    rpAcaoLocal = Date.now();
    const { error } = await sb.rpc("rp_escolher", porOutro ? { p_premio: escolhido.id, p_vendedor: nome } : { p_premio: escolhido.id });
    if (error) { rpErro(erro, "Não foi possível escolher: " + error.message); confirmar.disabled = false; return; }
    fechar();
    if (!rpAoVivoOk) showToast(escolhido.dono ? `🦹 ${rpPrimeiro(nome)} roubou ${escolhido.nome} de ${rpPrimeiro(escolhido.dono)}!` : `🎉 ${rpPrimeiro(nome)} pegou ${escolhido.nome}!`);
    carregarRoubaPremio();
  });
  desenhar();
}

async function desfazerRoubaPremio() {
  const ev = rpDados.eventos[0];
  if (!ev) return;
  const p = rpDados.premios.find((x) => x.id === ev.premio_id);
  const txt = `Desfazer a última escolha?\n\n${ev.vendedor} ${ev.de_dono ? "roubou" : "pegou"} ${p ? p.nome : "o prêmio"}${ev.de_dono ? " de " + ev.de_dono : " da banca"}.\n\nO prêmio volta para ${ev.de_dono || "a banca"} e ${rpPrimeiro(ev.vendedor)} fica com a escolha pendente de novo (a meta continua batida).`;
  if (!confirm(txt)) return;
  rpAcaoLocal = Date.now();
  const { error } = await sb.rpc("rp_desfazer");
  if (error) { showToast("Não foi possível desfazer: " + error.message); return; }
  showToast("Escolha desfeita.");
  carregarRoubaPremio();
}

// ---------- ao vivo (Supabase Realtime nas tabelas rp_* e vendedor_fotos) ----------
// Qualquer mudança recarrega a aba (se estiver aberta) e uma escolha nova mostra um aviso para todos.
let rpCanal = null, rpRecarga = null, rpAoVivoOk = false, rpAcaoLocal = 0;
function rpMudou() {
  clearTimeout(rpRecarga);
  rpRecarga = setTimeout(() => {
    const raiz = document.getElementById("sx-rouba-premio");
    if (raiz && !raiz.classList.contains("hidden")) carregarRoubaPremio();
  }, 500);
}
// escolha nova: quem está com a aba aberta (inclusive quem escolheu) vê a animação grande;
// quem está em outra parte do sistema recebe só o aviso pequeno
function rpAvisarEscolha(ev) {
  if (!rpDados) return;
  const raiz = document.getElementById("sx-rouba-premio");
  if (raiz && !raiz.classList.contains("hidden")) { rpCelebrar(ev); return; }
  if (Date.now() - rpAcaoLocal < 4000) return;
  const p = rpDados.premios.find((x) => x.id === ev.premio_id);
  const nome = p ? p.nome : "um prêmio";
  showToast(ev.de_dono ? `🦹 ${rpPrimeiro(ev.vendedor)} roubou ${nome} de ${rpPrimeiro(ev.de_dono)}!` : `🎉 ${rpPrimeiro(ev.vendedor)} pegou ${nome} da banca!`);
}

// ---------- animação de tela cheia (uma por vez, em fila) ----------
const rpFila = [];
let rpAnimando = false;
const RPA_CORES = ["#f59e0b", "#ec4899", "#22d3ee", "#10b981", "#a78bfa", "#f97316", "#fde047"];
function rpCelebrar(ev) {
  const p = rpDados.premios.find((x) => x.id === ev.premio_id) || { nome: "um prêmio", emoji: "🎁" };
  rpFila.push({ ev, p, foto: rpDados.fotos.get(ev.vendedor), fotoVitima: ev.de_dono ? rpDados.fotos.get(ev.de_dono) : null });
  if (!rpAnimando) rpProximaCelebracao();
}
function rpProximaCelebracao() {
  const item = rpFila.shift();
  if (!item) { rpAnimando = false; return; }
  rpAnimando = true;
  const { ev, p, foto, fotoVitima } = item;
  const roubo = !!ev.de_dono;
  const confete = roubo ? null : el("div", { class: "rpa-confete", "aria-hidden": "true" }, Array.from({ length: 70 }, () => el("i", {
    style: `left:${Math.random() * 100}%;background:${RPA_CORES[Math.floor(Math.random() * RPA_CORES.length)]};` +
      `animation-delay:${(Math.random() * 0.9).toFixed(2)}s;animation-duration:${(2.2 + Math.random() * 1.6).toFixed(2)}s;` +
      `width:${6 + Math.random() * 8}px;height:${8 + Math.random() * 10}px;--gira:${Math.round(Math.random() * 720 - 360)}deg`,
  })));
  const camada = el("div", { class: "rpa " + (roubo ? "roubo" : "pega"), role: "status", "aria-live": "assertive",
    "aria-label": roubo ? `${ev.vendedor} roubou ${p.nome} de ${ev.de_dono}` : `${ev.vendedor} pegou ${p.nome} da banca` }, [
    el("div", { class: "rpa-raios", "aria-hidden": "true" }),
    confete,
    el("div", { class: "rpa-card" }, [
      el("div", { class: "rpa-selo" }, roubo ? "🦹 ROUBOU!" : "🎉 PEGOU!"),
      el("div", { class: "rpa-foto-wrap" }, [
        avatarPerfil(ev.vendedor, foto, "rpa-foto"),
        el("div", { class: "rpa-emoji", "aria-hidden": "true" }, p.emoji),
      ]),
      el("div", { class: "rpa-nome" }, ev.vendedor),
      el("div", { class: "rpa-premio" }, [el("span", { "aria-hidden": "true" }, p.emoji + " "), p.nome]),
      roubo
        ? el("div", { class: "rpa-vitima" }, [avatarPerfil(ev.de_dono, fotoVitima, "rpa-vitima-foto"), el("span", {}, ["roubado de ", el("strong", {}, ev.de_dono), " 😱"])])
        : el("div", { class: "rpa-vitima" }, "direto da banca 🏦"),
    ]),
  ]);
  let fechado = false;
  const fechar = () => {
    if (fechado) return;
    fechado = true;
    camada.classList.add("saindo");
    setTimeout(() => { camada.remove(); setTimeout(rpProximaCelebracao, 250); }, 380);
  };
  camada.addEventListener("click", fechar);
  document.body.appendChild(camada);
  setTimeout(fechar, 5500);
}
function rpAoVivo() {
  if (rpCanal) return;
  const mud = (tabela, evento = "*") => ({ event: evento, schema: "public", table: tabela });
  rpCanal = sb.channel("rouba-premio")
    .on("postgres_changes", mud("rp_metas"), rpMudou)
    .on("postgres_changes", mud("rp_premios"), rpMudou)
    .on("postgres_changes", mud("vendedor_fotos"), rpMudou)
    .on("postgres_changes", mud("rp_eventos"), (msg) => { if (msg.eventType === "INSERT") rpAvisarEscolha(msg.new); rpMudou(); })
    .subscribe((status) => {
      rpAoVivoOk = status === "SUBSCRIBED";
      document.querySelectorAll(".rp-aovivo").forEach((x) => { x.classList.toggle("on", rpAoVivoOk); x.textContent = rpAoVivoOk ? "● Ao vivo" : "○ Conectando…"; });
      if (rpAoVivoOk) rpMudou(); // ao (re)conectar, pega o que mudou enquanto estava fora
    });
}
