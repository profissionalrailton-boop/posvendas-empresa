// Aba "Quadro dos sonhos": mural com a próxima conquista de cada vendedor ativo (foto, valor e progresso).
// Visível só para os e-mails de QUADRO_SONHOS_EMAILS (sistema.js). Dados: RPC sonhos_equipe (sql/018,
// só diretoria/admin) + lista de vendedores ativos (administrativo_vendedores), para mostrar também
// quem ainda não definiu. Usa sonhoCalculo / enquadrar / fotoSonho de sonho.js.

async function carregarQuadroSonhos() {
  const raiz = document.getElementById("sx-quadro-sonhos");
  raiz.innerHTML = "";
  const hoje = new Date();
  raiz.appendChild(el("div", { class: "px-topo" }, [
    el("div", {}, [el("h1", {}, "Quadro dos sonhos"), el("p", { class: "px-secao-sub" }, `A próxima conquista de cada vendedor · atualizado às ${String(hoje.getHours()).padStart(2, "0")}:${String(hoje.getMinutes()).padStart(2, "0")}`)]),
    el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => carregarQuadroSonhos() }, "↻ Atualizar"),
  ]));
  const resumo = el("div", { class: "px-grid px-kpis" }, [el("div", { class: "px-carregando" }, "Carregando…")]);
  const grade = el("div", { class: "qs-grade" });
  raiz.appendChild(resumo);
  raiz.appendChild(grade);

  const [{ data: sonhos, error: e1 }, { data: vendedores, error: e2 }] = await Promise.all([
    sb.rpc("sonhos_equipe"),
    sb.from("administrativo_vendedores").select("nome, ativo").order("nome"),
  ]);
  if (e1 || !sonhos) {
    resumo.innerHTML = "";
    resumo.appendChild(el("div", { class: "px-vazio" }, "Não foi possível carregar o quadro: " + ((e1 && e1.message) || "sem acesso")));
    return;
  }
  const comSonho = sonhos.map((r) => ({ r, c: sonhoCalculo(r) })).sort((a, b) => b.c.pct - a.c.pct);
  const nomesCom = new Set(comSonho.map((x) => x.r.sonho.vendedor));
  const semSonho = (e2 ? [] : vendedores || []).filter((v) => v.ativo !== false && !nomesCom.has(v.nome) && v.nome !== "Railton Angelo");

  const somaSonhos = comSonho.reduce((s, x) => s + x.c.valor, 0);
  const somaJuntado = comSonho.reduce((s, x) => s + Math.min(x.c.juntado, x.c.valor), 0);
  const conquistados = comSonho.filter((x) => x.c.conquistado).length;
  resumo.innerHTML = "";
  resumo.appendChild(card("Vendedores com conquista definida", `${comSonho.length} de ${comSonho.length + semSonho.length}`,
    semSonho.length ? `${semSonho.length} ainda não definiram` : "todo o time definiu 🎉", { destaque: true }));
  resumo.appendChild(card("Valor de todos os sonhos", brl2.format(somaSonhos), `${brl2.format(somaJuntado)} já juntados pelo time`));
  resumo.appendChild(card("Caminho percorrido", somaSonhos ? pctFmt((somaJuntado / somaSonhos) * 100) : "—", "somando todos os sonhos"));
  resumo.appendChild(card("Conquistas alcançadas", num.format(conquistados), conquistados ? "parabéns ao time! 🏆" : "a primeira está chegando", { status: conquistados ? "bom" : null }));

  comSonho.forEach(({ r, c }) => {
    const s = r.sonho;
    grade.appendChild(el("div", { class: "qs-card" + (c.conquistado ? " conquistado" : "") }, [
      el("div", { class: "qs-foto" }, [fotoSonho(s, "qs-img", { loading: "lazy" }), el("div", { class: "qs-veu" }),
        el("div", { class: "qs-sobre" }, [
          el("div", { class: "qs-nome" }, s.vendedor),
          el("div", { class: "qs-titulo" }, s.titulo),
        ]),
        c.conquistado ? el("span", { class: "qs-selo" }, "🏆 Conquistado") : null,
      ]),
      el("div", { class: "qs-corpo" }, [
        el("div", { class: "qs-linha" }, [el("strong", {}, brl2.format(c.valor)), s.prazo ? el("span", {}, `até ${sonhoMesAno(s.prazo)}`) : el("span", {}, "sem prazo")]),
        el("div", { class: "sn-barra sn-barra-p qs-barra" }, [el("div", { class: "sn-barra-cheia", style: `width:${Math.max(c.juntado > 0 ? 2 : 0, c.pct)}%` })]),
        el("div", { class: "qs-linha qs-sub" }, [
          el("span", {}, `${pctFmt(c.pct)} · ${brl2.format(c.juntado)} juntados`),
          el("span", {}, c.conquistado ? "chegou lá!" : `faltam ${brl2.format(c.falta)}`),
        ]),
        !c.conquistado && c.vendasFaltam ? el("div", { class: "qs-plano" }, [
          `~${c.vendasFaltam} vendas`, c.porMes ? ` · ${c.porMes} por mês para o prazo` : "",
          ` · comissão média ${brl2.format(c.media)}`,
        ].join("")) : null,
      ]),
    ]));
  });
  semSonho.forEach((v) => {
    grade.appendChild(el("div", { class: "qs-card qs-vazio" }, [
      el("div", { class: "qs-foto qs-foto-vazia" }, [el("span", { class: "qs-interroga", "aria-hidden": "true" }, "?")]),
      el("div", { class: "qs-corpo" }, [
        el("div", { class: "qs-nome-vazio" }, v.nome),
        el("div", { class: "qs-sub" }, "Ainda não definiu a próxima conquista"),
      ]),
    ]));
  });
  if (!comSonho.length && !semSonho.length) grade.appendChild(el("div", { class: "px-vazio" }, "Nenhum vendedor ativo."));
}
