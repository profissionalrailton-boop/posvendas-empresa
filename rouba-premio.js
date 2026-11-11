// Aba "Rouba prêmio": lista de metas; quem bate uma meta escolhe um prêmio da banca ou "rouba" de outra pessoa.
// Todo login vê; só o editor (RP_EDITOR) risca metas, escolhe prêmio e desfaz — a trava real é no banco
// (sql/021: funções rp_bater / rp_desfazer). Fotos = foto de perfil (foto-perfil.js, sql/022): cada vendedor
// troca a própria e o editor troca a de qualquer um.
const RP_EDITOR = "profissionalrailton@gmail.com";
const RP_FORA = ["Railton Angelo"]; // gestão com cadastro de vendedor: não participa
let rpDados = null;

const rpEditor = () => !!(perms && perms.email === RP_EDITOR);
const rpDataHora = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
const rpPremioTxt = (p) => `${p.emoji} ${p.nome}`;

const rpFoto = (nome, classe) => avatarPerfil(nome, rpDados.fotos.get(nome), classe);

async function carregarRoubaPremio() {
  const raiz = document.getElementById("sx-rouba-premio");
  if (!raiz.childElementCount) raiz.appendChild(el("div", { class: "px-carregando" }, "Abrindo a banca…"));
  const [m, p, f, e, v, a] = await Promise.all([
    sb.from("rp_metas").select("*").order("numero"),
    sb.from("rp_premios").select("*").order("ordem"),
    sb.from("vendedor_fotos").select("vendedor, foto_url"),
    sb.from("rp_eventos").select("*").order("id", { ascending: false }).limit(40),
    sb.from("administrativo_vendedores").select("nome, ativo").order("nome"),
    sb.from("posvendas_vendedor_acesso").select("vendedor").ilike("email", (perms && perms.email) || "-").limit(1),
  ]);
  const erro = [m, p, f, e, v].find((r) => r.error);
  if (erro) {
    raiz.innerHTML = "";
    raiz.appendChild(el("div", { class: "empty-state" }, "Não foi possível carregar o Rouba prêmio: " + erro.error.message));
    return;
  }
  rpDados = {
    metas: m.data, premios: p.data, eventos: e.data,
    fotos: new Map(f.data.map((x) => [x.vendedor, x.foto_url])),
    eu: a.data && a.data[0] ? a.data[0].vendedor : null,
    vendedores: v.data.filter((x) => x.ativo !== false && !RP_FORA.includes(x.nome)).map((x) => x.nome),
  };
  desenharRoubaPremio(raiz);
}

function desenharRoubaPremio(raiz) {
  const { metas, premios, eventos, vendedores } = rpDados;
  const editor = rpEditor();
  const banca = premios.filter((p) => !p.dono);
  const batidas = metas.filter((x) => x.batida_por).length;
  const roubos = premios.reduce((s, p) => s + p.vezes_roubado, 0);
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
        el("p", { class: "rp-sub" }, "Bateu uma meta da lista? Escolha um prêmio da banca ou roube o de alguém. Quem ainda não bateu, corre que dá tempo!"),
      ]),
      el("div", { class: "rp-topo-acoes" }, [
        editor && eventos.length ? el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: desfazerRoubaPremio }, "↩ Desfazer última jogada") : null,
        el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: carregarRoubaPremio }, "↻ Atualizar"),
      ]),
    ]),
    el("div", { class: "px-grid px-kpis" }, [
      card("Metas batidas", `${batidas} de ${metas.length}`, `${metas.length - batidas} ainda abertas`, { destaque: true }),
      card("Prêmios na banca", `${banca.length} de ${premios.length}`, banca.length ? "esperando dono" : "agora só roubando 😈"),
      card("Roubos", num.format(roubos), roubos ? "a disputa está quente 🔥" : "ninguém roubou ainda"),
    ]),

    el("h2", { class: "rp-h2" }, "🏦 Banca"),
    banca.length
      ? el("div", { class: "rp-banca" }, banca.map(premioCard))
      : el("div", { class: "rp-vazio" }, "A banca está vazia — a partir de agora, só roubando! 😈"),

    el("h2", { class: "rp-h2" }, "👥 Participantes"),
    el("div", { class: "rp-pessoas" }, participantes.map(([nome, lista]) => el("div", { class: "rp-pessoa" + (lista.length ? " tem" : "") }, [
      el("div", { class: "rp-pessoa-foto" }, [
        rpFoto(nome, "rp-avatar"),
        editor || nome === rpDados.eu ? el("button", { type: "button", class: "rp-foto-btn", title: nome === rpDados.eu ? "Trocar minha foto" : "Trocar foto", "aria-label": `Trocar foto de ${nome}`, onclick: () => trocarFotoPerfil(nome, carregarRoubaPremio) }, "📷") : null,
      ]),
      el("div", { class: "rp-pessoa-nome" }, nome),
      el("div", { class: "rp-pessoa-qtd" }, lista.length ? `${lista.length} ${lista.length === 1 ? "prêmio" : "prêmios"}` : "nenhum prêmio ainda"),
      lista.length ? el("div", { class: "rp-pessoa-premios" }, lista.map(premioCard)) : null,
    ]))),

    el("h2", { class: "rp-h2" }, "🎯 Metas"),
    editor ? el("p", { class: "rp-dica" }, "Clique numa meta aberta para riscar: escolha quem bateu e o prêmio que a pessoa pegou.") : null,
    el("ol", { class: "rp-metas" }, metas.map((x) => {
      const feita = !!x.batida_por;
      const conteudo = [
        el("span", { class: "rp-meta-num" }, String(x.numero)),
        el("span", { class: "rp-meta-txt" }, [
          el("span", { class: "rp-meta-titulo" }, x.titulo),
          feita ? el("span", { class: "rp-meta-quem" }, `✔ ${x.batida_por} · ${rpDataHora(x.batida_em).slice(0, 5)}`) : null,
        ]),
      ];
      return el("li", { class: "rp-meta" + (feita ? " feita" : "") },
        editor && !feita
          ? el("button", { type: "button", class: "rp-meta-btn", onclick: () => baterMetaRoubaPremio(x) }, conteudo)
          : el("div", { class: "rp-meta-btn" }, conteudo));
    })),

    el("h2", { class: "rp-h2" }, "📜 Últimas jogadas"),
    eventos.length
      ? el("ul", { class: "rp-jogadas" }, eventos.map((ev) => {
          const p = premioPorId.get(ev.premio_id), mt = metaPorNum.get(ev.meta);
          return el("li", { class: ev.de_dono ? "roubo" : "" }, [
            el("span", { class: "rp-jogada-ic", "aria-hidden": "true" }, ev.de_dono ? "🦹" : "🎉"),
            el("span", { class: "rp-jogada-txt" }, [
              el("strong", {}, ev.vendedor), ` bateu a meta ${ev.meta} (${mt ? mt.titulo.toLowerCase() : ""}) e `,
              ev.de_dono ? "roubou " : "pegou ", el("strong", {}, p ? rpPremioTxt(p) : "um prêmio"),
              ev.de_dono ? [" de ", el("strong", {}, ev.de_dono)] : " da banca",
            ].flat()),
            el("span", { class: "rp-jogada-data" }, rpDataHora(ev.em)),
          ]);
        }))
      : el("div", { class: "rp-vazio" }, "Nenhuma meta batida ainda. Quem vai abrir a disputa?"),
  ]));
}

function baterMetaRoubaPremio(meta) {
  const { premios, vendedores } = rpDados;
  const fundo = el("div", { class: "modal-overlay" });
  const fechar = () => fundo.remove();
  const erro = el("div", { class: "auth-error hidden" });
  const quem = el("select", { class: "ap-input" }, [el("option", { value: "" }, "Escolha quem bateu…"), ...vendedores.map((n) => el("option", { value: n }, n))]);
  const lista = el("div", { class: "rp-escolha" });
  let escolhido = null;
  const confirmar = el("button", { type: "button", class: "btn btn-primary btn-block", disabled: "disabled" }, "Confirmar");

  const desenharOpcoes = () => {
    const pessoa = quem.value;
    lista.innerHTML = "";
    if (escolhido && escolhido.dono === pessoa) escolhido = null;
    const grupos = [["Da banca", premios.filter((p) => !p.dono)], ["Roubar de alguém", premios.filter((p) => p.dono)]];
    grupos.forEach(([rot, ps]) => {
      if (!ps.length) return;
      lista.appendChild(el("div", { class: "rp-escolha-rot" }, rot));
      ps.forEach((p) => {
        const meu = p.dono && p.dono === pessoa;
        lista.appendChild(el("button", {
          type: "button", class: "rp-opcao" + (escolhido && escolhido.id === p.id ? " sel" : ""), disabled: meu || !pessoa ? "disabled" : null,
          onclick: () => { escolhido = p; desenharOpcoes(); },
        }, [
          el("span", { class: "rp-opcao-emoji", "aria-hidden": "true" }, p.emoji),
          el("span", { class: "rp-opcao-nome" }, p.nome),
          el("span", { class: "rp-opcao-dono" }, !p.dono ? "banca" : meu ? `já é de ${pessoa.split(" ")[0]}` : `com ${p.dono}`),
        ]));
      });
    });
    confirmar.disabled = !(pessoa && escolhido);
    confirmar.textContent = pessoa && escolhido
      ? (escolhido.dono ? `Confirmar: ${pessoa.split(" ")[0]} rouba ${escolhido.nome} de ${escolhido.dono.split(" ")[0]}` : `Confirmar: ${pessoa.split(" ")[0]} pega ${escolhido.nome}`)
      : "Confirmar";
  };
  quem.addEventListener("change", desenharOpcoes);
  confirmar.addEventListener("click", async () => {
    confirmar.disabled = true;
    const { error } = await sb.rpc("rp_bater", { p_meta: meta.numero, p_vendedor: quem.value, p_premio: escolhido.id });
    if (error) { erro.textContent = "Não foi possível salvar: " + error.message; erro.classList.remove("hidden"); confirmar.disabled = false; return; }
    fechar();
    showToast(escolhido.dono ? `🦹 ${quem.value} roubou ${escolhido.nome}!` : `🎉 ${quem.value} pegou ${escolhido.nome}!`);
    carregarRoubaPremio();
  });

  fundo.appendChild(el("div", { class: "modal-box rp-modal", role: "dialog", "aria-label": "Riscar meta" }, [
    el("div", { class: "modal-header" }, [
      el("div", {}, [el("div", { class: "modal-title" }, `Meta ${meta.numero}: ${meta.titulo}`), el("div", { class: "modal-sub" }, "Quem bateu e qual prêmio escolheu")]),
      el("button", { class: "icon-btn", type: "button", onclick: fechar, "aria-label": "Fechar" }, "✕"),
    ]),
    erro,
    el("div", { class: "field" }, [el("label", {}, "Quem bateu"), quem]),
    el("div", { class: "field" }, [el("label", {}, "Prêmio escolhido"), lista]),
    confirmar,
  ]));
  fundo.addEventListener("click", (ev) => { if (ev.target === fundo) fechar(); });
  document.body.appendChild(fundo);
  desenharOpcoes();
  quem.focus();
}

async function desfazerRoubaPremio() {
  const ev = rpDados.eventos[0];
  if (!ev) return;
  const p = rpDados.premios.find((x) => x.id === ev.premio_id);
  const txt = `Desfazer a última jogada?\n\n${ev.vendedor} bateu a meta ${ev.meta} e ${ev.de_dono ? "roubou" : "pegou"} ${p ? p.nome : "o prêmio"}${ev.de_dono ? " de " + ev.de_dono : " da banca"}.\n\nO prêmio volta para ${ev.de_dono || "a banca"} e a meta fica aberta de novo.`;
  if (!confirm(txt)) return;
  const { error } = await sb.rpc("rp_desfazer");
  if (error) { showToast("Não foi possível desfazer: " + error.message); return; }
  showToast("Jogada desfeita.");
  carregarRoubaPremio();
}
