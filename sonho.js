// "Minha próxima conquista" (antes "Meu sonho"): banner motivacional no topo da Minha área do vendedor (foto + nome + valor)
// com o progresso pela comissão das vendas desde o cadastro (+ o que ele já tem guardado).
// Gestão vê os sonhos do time no Painel geral. Dados: tabela vendedor_sonhos e RPCs meu_sonho /
// sonhos_equipe (sql/018). Fotos no bucket público "sonhos", pasta = id do login.

const SONHO_FRASES = [
  "Cada ligação te deixa mais perto. Bora pra próxima!",
  "Conquista grande se paga com venda feita. Vamos?",
  "Quem prospecta hoje, conquista amanhã.",
  "Disciplina é fazer o que precisa, mesmo sem vontade.",
  "Sua conquista não cai do céu, ela tem plano. Siga o plano!",
  "Um não é só o caminho até o próximo sim.",
  "Foco no cliente, o resultado vem junto.",
  "A diferença entre sonho e conquista é a data. Coloque a sua!",
  "Hoje é dia de fechar. Você consegue!",
  "Constância vence talento. Uma venda de cada vez.",
];
const SONHO_FOTO_MAX = 1600;

function sonhoFrase() {
  const d = new Date();
  const dia = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return SONHO_FRASES[dia % SONHO_FRASES.length];
}
// progresso a partir da resposta da RPC (meu_sonho / sonhos_equipe)
function sonhoCalculo(r) {
  const s = r.sonho;
  const valor = Number(s.valor) || 0;
  const juntado = (Number(s.ja_tenho) || 0) + (Number(r.comissao_desde) || 0);
  const falta = Math.max(0, valor - juntado);
  const pct = valor > 0 ? Math.min(100, (juntado / valor) * 100) : 0;
  const media = Number(r.comissao_media) || 0;
  const vendasFaltam = falta > 0 && media > 0 ? Math.ceil(falta / media) : 0;
  let porMes = null, mesesRestantes = null;
  if (s.prazo && vendasFaltam) {
    const hoje = new Date(), p = new Date(s.prazo + "T12:00:00");
    mesesRestantes = Math.max(1, (p.getFullYear() - hoje.getFullYear()) * 12 + (p.getMonth() - hoje.getMonth()) + 1);
    porMes = Math.ceil(vendasFaltam / mesesRestantes);
  }
  return { valor, juntado, falta, pct, media, vendasFaltam, porMes, mesesRestantes, conquistado: falta === 0 };
}
const sonhoMesAno = (iso) => { const [y, m] = iso.split("-"); return `${MESES_PT[Number(m) - 1].toLowerCase()} de ${y}`; };
// enquadramento escolhido pelo vendedor: ponto de foco (x, y em %) e zoom
function enquadrar(img, s) {
  const x = s && s.foto_x != null ? Number(s.foto_x) : 50;
  const y = s && s.foto_y != null ? Number(s.foto_y) : 50;
  const z = s && s.foto_zoom != null ? Number(s.foto_zoom) : 1;
  img.style.objectPosition = `${x}% ${y}%`;
  img.style.transformOrigin = `${x}% ${y}%`;
  img.style.transform = z > 1 ? `scale(${z})` : "";
  return img;
}
function fotoSonho(s, classe, extra = {}) {
  return s.foto_url ? enquadrar(el("img", { class: classe, src: s.foto_url, alt: s.titulo, ...extra }), s) : el("div", { class: classe + " sn-sem-foto" });
}

// ---------- Minha área ----------
async function blocoMeuSonho(alvo) {
  alvo.innerHTML = "";
  const { data: r, error } = await sb.rpc("meu_sonho");
  if (error || !r) { alvo.remove(); return; }
  if (!r.sonho) {
    alvo.appendChild(el("div", { class: "sn-convite" }, [
      el("div", { class: "sn-convite-ic", "aria-hidden": "true" }, "🌟"),
      el("div", { class: "sn-convite-txt" }, [
        el("strong", {}, "Qual é a sua próxima conquista?"),
        el("span", {}, "Coloque aqui a foto do que você quer conquistar (carro, casa, viagem…) e acompanhe cada venda te levando até ele."),
      ]),
      el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => abrirFormSonho(null, () => blocoMeuSonho(alvo)) }, "Definir minha próxima conquista"),
    ]));
    return;
  }
  const s = r.sonho, c = sonhoCalculo(r);
  const banner = el("div", { class: "sn-banner" + (c.conquistado ? " conquistado" : "") }, [
    fotoSonho(s, "sn-foto"),
    el("div", { class: "sn-veu" }),
    el("div", { class: "sn-conteudo" }, [
      el("div", { class: "sn-topo" }, [
        el("span", { class: "sn-rotulo" }, c.conquistado ? "🏆 Conquista alcançada!" : "✨ Minha próxima conquista"),
        el("button", { type: "button", class: "sn-editar", onclick: () => abrirFormSonho(s, () => blocoMeuSonho(alvo)) }, "Editar"),
      ]),
      el("div", { class: "sn-titulo" }, s.titulo),
      el("div", { class: "sn-valor" }, brl2.format(c.valor) + (s.prazo ? ` · até ${sonhoMesAno(s.prazo)}` : "")),
      el("div", { class: "sn-barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(c.pct)) }, [
        el("div", { class: "sn-barra-cheia", style: `width:${Math.max(c.juntado > 0 ? 2 : 0, c.pct)}%` }),
      ]),
      el("div", { class: "sn-numeros" }, [
        el("span", {}, [el("strong", {}, pctFmt(c.pct)), " do caminho"]),
        el("span", {}, [el("strong", {}, brl2.format(c.juntado)), " juntados"]),
        c.conquistado ? null : el("span", {}, ["faltam ", el("strong", {}, brl2.format(c.falta))]),
      ]),
      c.conquistado ? el("div", { class: "sn-plano" }, "Você chegou lá! 🎉 Que tal definir a próxima conquista?")
        : c.vendasFaltam ? el("div", { class: "sn-plano" }, [
          `Faltam cerca de `, el("strong", {}, `${c.vendasFaltam} venda${c.vendasFaltam === 1 ? "" : "s"}`),
          ` (sua comissão média é ${brl2.format(c.media)} por venda)`,
          c.porMes ? [" · para chegar no prazo: ", el("strong", {}, `${c.porMes} por mês`)] : null,
        ].flat().filter(Boolean)) : null,
      el("div", { class: "sn-frase" }, `“${sonhoFrase()}”`),
    ]),
  ]);
  alvo.appendChild(banner);
}

// ---------- formulário (criar / editar) ----------
function comprimirFotoSonho(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > SONHO_FOTO_MAX || h > SONHO_FOTO_MAX) { const k = SONHO_FOTO_MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao preparar a imagem."))), "image/jpeg", 0.82);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}
function numeroBR(txt) {
  const t = String(txt || "").replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
function abrirFormSonho(atual, aoSalvar) {
  const fundo = el("div", { class: "modal-overlay" });
  const erro = el("div", { class: "auth-error hidden" });
  const foto = el("input", { type: "file", accept: "image/*" });
  // editor de enquadramento: arrastar a foto para posicionar + zoom; mostra como fica no banner e no quadrado do painel
  const enq = { foto_x: atual ? Number(atual.foto_x ?? 50) : 50, foto_y: atual ? Number(atual.foto_y ?? 50) : 50, foto_zoom: atual ? Number(atual.foto_zoom ?? 1) : 1 };
  const prevBanner = el("img", { class: "sn-enq-img", alt: "", draggable: "false" });
  const prevQuadro = el("img", { class: "sn-enq-img", alt: "", draggable: "false" });
  const zoom = el("input", { type: "range", min: "1", max: "3", step: "0.05", value: String(enq.foto_zoom), "aria-label": "Zoom da foto" });
  const atualizarPrevias = () => { enquadrar(prevBanner, enq); enquadrar(prevQuadro, enq); };
  const caixaBanner = el("div", { class: "sn-enq-banner", title: "Arraste para enquadrar" }, [prevBanner, el("span", { class: "sn-enq-dica" }, "arraste para enquadrar")]);
  const editor = el("div", { class: "sn-enq" + (atual && atual.foto_url ? "" : " hidden") }, [
    caixaBanner,
    el("div", { class: "sn-enq-linha" }, [
      el("div", { class: "sn-enq-quadro" }, prevQuadro),
      el("div", { class: "sn-enq-ctrl" }, [
        el("label", {}, ["Zoom", zoom]),
        el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => { enq.foto_x = 50; enq.foto_y = 50; enq.foto_zoom = 1; zoom.value = "1"; atualizarPrevias(); } }, "Centralizar"),
        el("span", { class: "sn-enq-legenda" }, "Em cima: como fica no banner. Ao lado: no celular e no painel."),
      ]),
    ]),
  ]);
  const definirFotoPrevia = (src) => { prevBanner.src = src; prevQuadro.src = src; editor.classList.remove("hidden"); atualizarPrevias(); };
  if (atual && atual.foto_url) definirFotoPrevia(atual.foto_url);
  foto.addEventListener("change", () => {
    const f = foto.files && foto.files[0];
    if (f) { enq.foto_x = 50; enq.foto_y = 50; enq.foto_zoom = 1; zoom.value = "1"; definirFotoPrevia(URL.createObjectURL(f)); }
  });
  zoom.addEventListener("input", () => { enq.foto_zoom = Number(zoom.value); atualizarPrevias(); });
  // arrastar: mover a foto para a direita = olhar mais para a esquerda (foco diminui)
  let arraste = null;
  caixaBanner.addEventListener("pointerdown", (e) => {
    arraste = { x: e.clientX, y: e.clientY, fx: enq.foto_x, fy: enq.foto_y };
    try { caixaBanner.setPointerCapture(e.pointerId); } catch (_) { /* segue sem captura */ }
    e.preventDefault();
    caixaBanner.classList.add("arrastando");
  });
  caixaBanner.addEventListener("pointermove", (e) => {
    if (!arraste) return;
    const r = caixaBanner.getBoundingClientRect();
    const k = 100 / enq.foto_zoom;
    enq.foto_x = Math.min(100, Math.max(0, arraste.fx - ((e.clientX - arraste.x) / r.width) * k * 1.5));
    enq.foto_y = Math.min(100, Math.max(0, arraste.fy - ((e.clientY - arraste.y) / r.height) * k));
    atualizarPrevias();
  });
  const soltar = () => { arraste = null; caixaBanner.classList.remove("arrastando"); };
  caixaBanner.addEventListener("pointerup", soltar);
  caixaBanner.addEventListener("pointercancel", soltar);
  const fmt = (n) => (n || n === 0 ? Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  const titulo = el("input", { type: "text", required: "required", maxlength: "80", placeholder: "Ex.: Hilux SRV 2027", value: atual ? atual.titulo : "" });
  const valor = el("input", { type: "text", inputmode: "decimal", required: "required", placeholder: "Ex.: 280.000,00", value: atual ? fmt(atual.valor) : "" });
  const prazo = el("input", { type: "month", value: atual && atual.prazo ? atual.prazo.slice(0, 7) : "" });
  const jaTenho = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", value: atual && Number(atual.ja_tenho) ? fmt(atual.ja_tenho) : "" });
  const salvar = el("button", { type: "submit", class: "btn btn-primary btn-block" }, "Salvar minha conquista");
  const fechar = () => fundo.remove();
  const form = el("form", {}, [
    el("div", { class: "field" }, [el("label", {}, "Foto da conquista"), foto, editor]),
    el("div", { class: "field" }, [el("label", {}, "O que é"), titulo]),
    el("div", { class: "field" }, [el("label", {}, "Quanto custa (R$)"), valor]),
    el("div", { class: "field" }, [el("label", {}, "Até quando (opcional)"), prazo]),
    el("div", { class: "field" }, [el("label", {}, "Quanto você já tem guardado para ele (opcional)"), jaTenho]),
    salvar,
    atual ? el("button", { type: "button", class: "btn btn-secondary btn-block sn-apagar", onclick: async () => {
      if (!confirm("Remover a sua próxima conquista da Minha área?")) return;
      const { error } = await sb.from("vendedor_sonhos").delete().eq("vendedor", atual.vendedor);
      if (error) { erro.textContent = error.message; erro.classList.remove("hidden"); return; }
      fechar(); aoSalvar();
    } }, "Remover conquista") : null,
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    erro.classList.add("hidden");
    const v = numeroBR(valor.value), j = jaTenho.value.trim() ? numeroBR(jaTenho.value) : 0;
    if (!(v > 0)) { erro.textContent = "Informe quanto custa a conquista."; erro.classList.remove("hidden"); return; }
    if (!(j >= 0)) { erro.textContent = "Valor guardado inválido."; erro.classList.remove("hidden"); return; }
    salvar.disabled = true; salvar.textContent = "Salvando…";
    try {
      const [{ data: acesso }, { data: u }] = await Promise.all([
        sb.from("posvendas_vendedor_acesso").select("vendedor").limit(1),
        sb.auth.getUser(),
      ]);
      const vendedor = acesso && acesso[0] && acesso[0].vendedor;
      if (!vendedor) throw new Error("Seu login não está ligado a um vendedor.");
      let fotoUrl = atual ? atual.foto_url : null;
      const arquivo = foto.files && foto.files[0];
      if (arquivo) {
        const blob = await comprimirFotoSonho(arquivo);
        const caminho = `${u.user.id}/${Date.now()}.jpg`;
        const { error: eUp } = await sb.storage.from("sonhos").upload(caminho, blob, { contentType: "image/jpeg", upsert: true });
        if (eUp) throw eUp;
        fotoUrl = sb.storage.from("sonhos").getPublicUrl(caminho).data.publicUrl;
      }
      const linha = { vendedor, titulo: titulo.value.trim(), valor: v, prazo: prazo.value ? prazo.value + "-01" : null,
        ja_tenho: j, foto_url: fotoUrl, updated_at: new Date().toISOString(),
        foto_x: Math.round(enq.foto_x * 100) / 100, foto_y: Math.round(enq.foto_y * 100) / 100, foto_zoom: Math.round(enq.foto_zoom * 100) / 100 };
      const { error: eS } = await sb.from("vendedor_sonhos").upsert(linha, { onConflict: "vendedor" });
      if (eS) throw eS;
      fechar();
      showToast(atual ? "Conquista atualizada." : "Conquista salva! Agora é rumo a ela 🚀");
      aoSalvar();
    } catch (err) {
      erro.textContent = "Não foi possível salvar: " + (err.message || err);
      erro.classList.remove("hidden");
      salvar.disabled = false; salvar.textContent = "Salvar minha conquista";
    }
  });
  fundo.appendChild(el("div", { class: "modal-box sn-modal" }, [
    el("div", { class: "modal-header" }, [
      el("div", {}, [el("div", { class: "modal-title" }, atual ? "Editar minha próxima conquista" : "Definir minha próxima conquista"),
        el("div", { class: "modal-sub" }, "O progresso conta a comissão das suas vendas a partir de agora")]),
      el("button", { class: "icon-btn", type: "button", onclick: fechar }, "✕"),
    ]),
    erro, form,
  ]));
  fundo.addEventListener("click", (e) => { if (e.target === fundo) fechar(); });
  document.body.appendChild(fundo);
  titulo.focus();
}

// ---------- Painel geral (gestão) ----------
async function blocoSonhosEquipe(id) {
  const { data, error } = await sb.rpc("sonhos_equipe");
  if (error || !data) { falha(id, "Não foi possível carregar as conquistas do time."); return; }
  if (!data.length) { preencher(id, el("div", { class: "px-vazio" }, "Nenhum vendedor cadastrou a próxima conquista ainda.")); return; }
  preencher(id, el("div", { class: "sn-grade" }, data.map((r) => {
    const s = r.sonho, c = sonhoCalculo(r);
    return el("div", { class: "sn-mini" + (c.conquistado ? " conquistado" : "") }, [
      el("div", { class: "sn-mini-moldura" }, fotoSonho(s, "sn-mini-foto", { loading: "lazy" })),
      el("div", { class: "sn-mini-corpo" }, [
        el("div", { class: "sn-mini-nome" }, s.vendedor),
        el("div", { class: "sn-mini-titulo" }, `${s.titulo} · ${brl2.format(c.valor)}`),
        el("div", { class: "sn-barra sn-barra-p" }, [el("div", { class: "sn-barra-cheia", style: `width:${Math.max(c.juntado > 0 ? 2 : 0, c.pct)}%` })]),
        el("div", { class: "sn-mini-sub" }, c.conquistado ? "Conquistado! 🏆"
          : `${pctFmt(c.pct)} · faltam ${brl2.format(c.falta)}${c.vendasFaltam ? ` (~${c.vendasFaltam} vendas)` : ""}${s.prazo ? ` · até ${sonhoMesAno(s.prazo)}` : ""}`),
      ]),
    ]);
  })));
}
