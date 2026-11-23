/* Relatório semanal da equipe — modelo 1920x1080.
   Usado pela aba "Relatório semanal" (relatorio.js) e pelo envio automático de segunda-feira (n8n + Gotenberg).
   RelatorioSemanal.montar(dados) devolve um elemento <div class="rs-pagina"> de 1920x1080.
   dados = retorno da RPC relatorio_semanal(). */
(function () {
  var script = document.currentScript;
  var BASE = script && script.src ? script.src.replace(/[^\/]*$/, "") : "relatorio/";

  var CSS = [
    ".rs-pagina{--rs-navy:#0b1a33;--rs-navy2:#12254a;--rs-navy3:#1a3260;--rs-line:rgba(212,175,55,.22);--rs-gold:#d4af37;--rs-gold2:#f1d47a;--rs-text:#f4f1e8;--rs-muted:#a9b3c7;--rs-down:#f87171;--rs-up:#4ade80;",
    "width:1920px;height:1080px;overflow:hidden;position:relative;font-family:Montserrat,sans-serif;color:var(--rs-text);text-align:left;line-height:1.2;",
    "background:radial-gradient(1200px 700px at 85% -10%,#1d3a70 0%,transparent 60%),radial-gradient(900px 600px at -10% 110%,#162d58 0%,transparent 60%),#0b1a33;}",
    ".rs-pagina *{box-sizing:border-box;margin:0;padding:0;}",
    ".rs-in{padding:44px 60px 34px;height:100%;display:flex;flex-direction:column;gap:26px;}",
    ".rs-head{display:flex;align-items:center;gap:28px;}",
    ".rs-head img{height:92px;}",
    ".rs-tit{flex:1;border-left:2px solid var(--rs-line);padding-left:28px;}",
    ".rs-tit small{font-size:18px;letter-spacing:6px;text-transform:uppercase;color:var(--rs-gold);font-weight:700;}",
    ".rs-tit h1{font-family:Cinzel,serif;font-size:52px;font-weight:700;line-height:1.05;margin-top:4px;}",
    ".rs-mes{text-align:right;padding:16px 24px;border-radius:18px;border:1px solid var(--rs-line);background:rgba(212,175,55,.06);}",
    ".rs-mes small{display:block;font-size:15px;color:var(--rs-muted);font-weight:600;text-transform:uppercase;letter-spacing:2px;}",
    ".rs-mes strong{font-size:38px;font-weight:900;color:var(--rs-gold2);}",
    ".rs-mes span{font-size:18px;color:var(--rs-muted);font-weight:600;}",
    ".rs-kpis{display:grid;grid-template-columns:1.35fr 1fr 1fr 1fr;gap:20px;}",
    ".rs-kpi{padding:22px 26px;border-radius:20px;background:linear-gradient(160deg,var(--rs-navy3),var(--rs-navy2));border:1px solid var(--rs-line);}",
    ".rs-kpi small{font-size:16px;color:var(--rs-muted);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;}",
    ".rs-kpi strong{display:block;font-size:58px;font-weight:900;line-height:1.1;margin-top:6px;}",
    ".rs-kpi.rs-princ strong{color:var(--rs-gold2);font-size:66px;}",
    ".rs-kpi p{font-size:17px;color:var(--rs-muted);font-weight:600;margin-top:4px;}",
    ".rs-down{color:var(--rs-down);font-weight:800;}.rs-up{color:var(--rs-up);font-weight:800;}",
    ".rs-grade{flex:1;display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:20px;min-height:0;}",
    ".rs-card{padding:24px 28px;border-radius:22px;background:rgba(18,37,74,.75);border:1px solid var(--rs-line);display:flex;flex-direction:column;min-height:0;overflow:hidden;}",
    ".rs-card h2{font-size:22px;font-weight:800;display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:18px;}",
    ".rs-card h2 span{font-size:15px;color:var(--rs-muted);font-weight:600;}",
    ".rs-vazio{font-size:17px;color:var(--rs-muted);font-weight:600;padding:20px 0;}",
    ".rs-l{display:grid;grid-template-columns:34px 52px 1fr;align-items:center;gap:12px;margin-bottom:14px;}",
    ".rs-pos{font-size:22px;font-weight:900;color:var(--rs-muted);text-align:center;}",
    ".rs-l.rs-1 .rs-pos{color:var(--rs-gold2);}",
    ".rs-foto{width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid var(--rs-line);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;background:var(--rs-navy3);}",
    ".rs-l.rs-1 .rs-foto{border-color:var(--rs-gold);box-shadow:0 0 0 3px rgba(212,175,55,.25);}",
    ".rs-info{min-width:0;}",
    ".rs-topo{display:flex;justify-content:space-between;align-items:baseline;gap:8px;}",
    ".rs-nome{font-size:19px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".rs-val{font-size:20px;font-weight:800;white-space:nowrap;}",
    ".rs-val em{font-style:normal;font-size:14px;color:var(--rs-muted);font-weight:600;margin-left:6px;}",
    ".rs-barra{height:9px;border-radius:5px;background:rgba(255,255,255,.07);margin-top:7px;overflow:hidden;}",
    ".rs-barra i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#b8912a,var(--rs-gold2));}",
    ".rs-docs{display:grid;grid-template-columns:1fr 1fr;column-gap:26px;}",
    ".rs-docs .rs-l{grid-template-columns:44px 1fr;margin-bottom:16px;}",
    ".rs-docs .rs-foto,.rs-q .rs-foto{width:44px;height:44px;font-size:13px;}",
    ".rs-docs .rs-nome{font-size:17px;}.rs-docs .rs-val{font-size:18px;}",
    ".rs-ng{display:flex;align-items:center;gap:18px;padding:10px 18px;border-radius:16px;background:rgba(212,175,55,.08);margin-bottom:12px;}",
    ".rs-ng strong{font-size:50px;font-weight:900;color:var(--rs-gold2);line-height:1;}",
    ".rs-ng p{font-size:16px;color:var(--rs-muted);font-weight:600;line-height:1.35;}",
    ".rs-ng p b{color:var(--rs-text);}",
    ".rs-sub{font-size:15px;color:var(--rs-muted);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;}",
    ".rs-q .rs-l{grid-template-columns:44px 1fr auto;margin-bottom:7px;}",
    ".rs-q .rs-nome small{display:block;font-size:13px;color:var(--rs-muted);font-weight:600;}",
    ".rs-q .rs-nome{font-size:17px;}",
    ".rs-selo{font-size:22px;font-weight:900;padding:4px 14px;border-radius:12px;background:rgba(212,175,55,.14);color:var(--rs-gold2);}",
    ".rs-rodape{display:grid;grid-template-columns:1.15fr 2fr;gap:20px;}",
    ".rs-mini{padding:18px 26px;border-radius:20px;background:rgba(18,37,74,.75);border:1px solid var(--rs-line);min-height:158px;}",
    ".rs-mini h3{font-size:16px;color:var(--rs-muted);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:12px;}",
    ".rs-mix{display:flex;height:22px;border-radius:6px;overflow:hidden;gap:3px;}",
    ".rs-mix i{display:block;height:100%;}",
    ".rs-leg{display:flex;gap:10px 22px;margin-top:10px;font-size:15px;font-weight:600;color:var(--rs-muted);flex-wrap:wrap;}",
    ".rs-leg b{color:var(--rs-text);}",
    ".rs-leg span i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:7px;vertical-align:-1px;}",
    ".rs-rp{display:flex;align-items:center;gap:20px;}",
    ".rs-rp .rs-foto{width:74px;height:74px;border:3px solid var(--rs-gold);font-size:20px;}",
    ".rs-rp .rs-t{flex:1;white-space:nowrap;}",
    ".rs-rp .rs-t strong{font-size:24px;font-weight:900;}",
    ".rs-rp .rs-t p{font-size:16px;color:var(--rs-muted);font-weight:600;margin-top:3px;}",
    ".rs-chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;}",
    ".rs-chips span{font-size:15px;font-weight:700;padding:8px 14px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid var(--rs-line);white-space:nowrap;}",
    ".rs-pe{display:flex;justify-content:space-between;font-size:14px;color:var(--rs-muted);font-weight:600;}"
  ].join("");

  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var CORES_MIX = ["#d4af37", "#7fa6e8", "#e8eef9", "#9b8cf0", "#5fc9a8"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(v) { return Number(v) || 0; }
  function br(v, casas) { return num(v).toLocaleString("pt-BR", { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 }); }
  function dinheiro(v) {
    v = num(v);
    if (v >= 1e6) return "R$ " + br(v / 1e6, 2) + " mi";
    if (v >= 1e3) return "R$ " + br(Math.round(v / 1e3)) + " mil";
    return "R$ " + br(v);
  }
  function data(iso) { var p = String(iso).slice(0, 10).split("-"); return { d: +p[2], m: +p[1] - 1, a: +p[0] }; }
  function iniciais(n) { return String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p[0]; }).join("").toUpperCase(); }
  function plural(n, s, p) { return n + " " + (n === 1 ? s : p); }

  function foto(dados, nome, extra) {
    var url = (dados.fotos || {})[nome];
    if (url) return '<img class="rs-foto" crossorigin="anonymous" src="' + esc(url) + '" alt="">';
    return '<div class="rs-foto">' + esc(iniciais(nome)) + "</div>";
  }

  function periodo(dados) {
    var a = data(dados.inicio), b = data(dados.fim);
    if (a.m === b.m) return a.d + " a " + b.d + " de " + MESES[b.m];
    return a.d + " de " + MESES[a.m] + " a " + b.d + " de " + MESES[b.m];
  }

  function variacao(atual, anterior, rotulo) {
    atual = num(atual); anterior = num(anterior);
    if (!anterior) return rotulo + ": " + (rotulo.indexOf("R$") >= 0 ? "—" : "0");
    var pct = Math.round((atual - anterior) / anterior * 100);
    var cls = pct < 0 ? "rs-down" : "rs-up";
    return '<span class="' + cls + '">' + (pct < 0 ? "▼ " : "▲ ") + Math.abs(pct) + "%</span> vs. semana anterior (" + rotulo + ")";
  }

  function montar(dados) {
    if (!document.getElementById("rs-estilo")) {
      var st = document.createElement("style");
      st.id = "rs-estilo";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var v = dados.vendas || {};
    var fim = data(dados.fim), ini = data(dados.inicio);
    var ticket = num(v.contratos) ? num(v.total) / num(v.contratos) : 0;
    var h = [];

    h.push('<div class="rs-in">');
    h.push('<header class="rs-head"><img src="' + BASE + 'logo.png" alt="Infinity">');
    h.push('<div class="rs-tit"><small>Relatório semanal da equipe</small><h1>' + esc(periodo(dados)) + "</h1></div>");
    h.push('<div class="rs-mes"><small>' + esc(MESES[fim.m].charAt(0).toUpperCase() + MESES[fim.m].slice(1)) + " até o dia " + fim.d + "</small><strong>" + dinheiro(v.mes_total) +
      "</strong> <span>· " + plural(num(v.mes_contratos), "contrato", "contratos") + "</span></div></header>");

    h.push('<section class="rs-kpis">');
    h.push('<div class="rs-kpi rs-princ"><small>Total vendido na semana</small><strong>' + dinheiro(v.total) + "</strong><p>" +
      (num(v.ant_total) ? variacao(v.total, v.ant_total, dinheiro(v.ant_total)) : "semana anterior: sem vendas") + "</p></div>");
    h.push('<div class="rs-kpi"><small>Contratos</small><strong>' + num(v.contratos) + "</strong><p>semana anterior: " + num(v.ant_contratos) + "</p></div>");
    h.push('<div class="rs-kpi"><small>Ticket médio</small><strong>' + (ticket ? dinheiro(ticket) : "—") + "</strong><p>por contrato</p></div>");
    var dc = dados.docs || {};
    h.push('<div class="rs-kpi"><small>Documentações</small><strong>' + num(dc.total) + "</strong><p>" +
      (num(dc.ant_total) ? "semana anterior: " + num(dc.ant_total) : "clientes mandaram documentos") + "</p></div>");
    h.push("</section>");

    h.push('<section class="rs-grade">');
    // ranking de vendas
    var rk = (dados.ranking || []).slice(0, 5);
    var maxV = rk.length ? num(rk[0].total) : 1;
    h.push('<div class="rs-card"><h2>🏆 Ranking de vendas <span>valor vendido · contratos</span></h2>');
    if (!rk.length) h.push('<div class="rs-vazio">Nenhuma venda lançada na semana.</div>');
    rk.forEach(function (x, i) {
      h.push('<div class="rs-l' + (i === 0 ? " rs-1" : "") + '"><div class="rs-pos">' + (i + 1) + "º</div>" + foto(dados, x.vendedor) +
        '<div class="rs-info"><div class="rs-topo"><span class="rs-nome">' + esc(x.vendedor) + '</span><span class="rs-val">' + dinheiro(x.total) +
        "<em>" + plural(num(x.contratos), "contrato", "contratos") + '</em></span></div><div class="rs-barra"><i style="width:' + (num(x.total) / maxV * 100).toFixed(1) + '%"></i></div></div></div>');
    });
    h.push("</div>");

    // corrida da documentação
    var dl = (dc.lista || []).slice(0, 10);
    var maxD = dl.length ? num(dl[0].n) : 1;
    h.push('<div class="rs-card"><h2>📄 Corrida da documentação <span>documentações</span></h2>');
    if (!dl.length) h.push('<div class="rs-vazio">Nenhuma documentação na semana.</div>');
    else {
      h.push('<div class="rs-docs">');
      dl.forEach(function (x, i) {
        h.push('<div class="rs-l' + (i === 0 ? " rs-1" : "") + '">' + foto(dados, x.vendedor) + '<div class="rs-info"><div class="rs-topo"><span class="rs-nome">' + esc(x.vendedor) +
          '</span><span class="rs-val">' + num(x.n) + '</span></div><div class="rs-barra"><i style="width:' + (num(x.n) / maxD * 100).toFixed(1) + '%"></i></div></div></div>');
      });
      h.push("</div>");
    }
    h.push("</div>");

    // qualidade
    var q = dados.qualidade || {};
    h.push('<div class="rs-card rs-q"><h2>🎧 Qualidade dos atendimentos</h2>');
    if (!num(q.n)) h.push('<div class="rs-vazio">Nenhuma gravação analisada na semana.</div>');
    else {
      h.push('<div class="rs-ng"><strong>' + br(q.media, 1) + "</strong><p>nota média em <b>" + plural(num(q.n), "gravação", "gravações") + "</b> analisadas<br>(atendimento + fechamento)</p></div>");
      h.push('<div class="rs-sub">Maiores notas da semana</div>');
      (q.top || []).forEach(function (x) {
        h.push('<div class="rs-l">' + foto(dados, x.vendedor) + '<div class="rs-nome">' + esc(x.vendedor) + "<small>" + plural(num(x.n), "gravação", "gravações") +
          '</small></div><div class="rs-selo">' + br(x.media, 1) + "</div></div>");
      });
    }
    h.push("</div></section>");

    // rodapé: mix + rouba prêmio
    h.push('<section class="rs-rodape"><div class="rs-mini"><h3>De onde veio a venda</h3>');
    var mix = dados.mix || [];
    if (mix.length > 4) {
      var resto = mix.slice(3).reduce(function (s, x) { return s + num(x.total); }, 0);
      mix = mix.slice(0, 3).concat([{ administradora: "Outros", tipo: "", total: resto }]);
    }
    if (!mix.length) h.push('<div class="rs-vazio">Sem vendas na semana.</div>');
    else {
      h.push('<div class="rs-mix">' + mix.map(function (x, i) { return '<i style="flex:' + num(x.total) + ";background:" + CORES_MIX[i] + '"></i>'; }).join("") + "</div>");
      h.push('<div class="rs-leg">' + mix.map(function (x, i) {
        return '<span><i style="background:' + CORES_MIX[i] + '"></i>' + esc((x.administradora + " " + (x.tipo || "")).trim()) + " <b>" + dinheiro(x.total) + "</b></span>";
      }).join("") + "</div>");
    }
    h.push("</div>");
    var rp = dados.rouba_premio;
    h.push('<div class="rs-mini"><h3>Rouba Prêmio · destaque da semana</h3>');
    if (!rp || !rp.vendedor) h.push('<div class="rs-vazio">Nenhum prêmio conquistado na semana.</div>');
    else {
      var chips = (rp.premios || []).slice(0, 5).map(function (p) { return "<span>" + esc(p.emoji || "🎁") + " " + (num(p.qtd) > 1 ? num(p.qtd) + "× " : "") + esc(p.nome) + "</span>"; }).join("");
      h.push('<div class="rs-rp">' + foto(dados, rp.vendedor) + '<div class="rs-t"><strong>' + esc(rp.vendedor) + "</strong><p>" + plural(num(rp.metas), "meta batida", "metas batidas") +
        " na semana" + (num(rp.premios_agora) ? " · está com " + plural(num(rp.premios_agora), "prêmio", "prêmios") : "") + '</p></div><div class="rs-chips">' + chips + "</div></div>");
    }
    h.push("</div></section>");

    h.push('<footer class="rs-pe"><span>Fonte: Sistema Infinity · vendas lançadas pelo administrativo, Corrida da documentação e Meus atendimentos</span><span>Semana de domingo ' +
      String(ini.d).padStart(2, "0") + "/" + String(ini.m + 1).padStart(2, "0") + " a sábado " + String(fim.d).padStart(2, "0") + "/" + String(fim.m + 1).padStart(2, "0") + "/" + fim.a + "</span></footer>");
    h.push("</div>");

    var el = document.createElement("div");
    el.className = "rs-pagina";
    el.innerHTML = h.join("");
    return el;
  }

  window.RelatorioSemanal = { montar: montar, BASE: BASE };
})();
