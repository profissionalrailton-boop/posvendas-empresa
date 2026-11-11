// Foto de perfil do vendedor (tabela vendedor_fotos + bucket "perfis" — sql/022).
// O próprio vendedor troca a dele (Minha área ou Rouba prêmio); o Railton pode trocar a de qualquer um.
// Usada na Minha área (topo) e no Rouba prêmio (cards dos participantes).
const PERFIL_LADO = 480; // a foto é recortada em quadrado (centro) e reduzida para 480×480

const iniciaisPerfil = (nome) => (nome || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

function avatarPerfil(nome, url, classe) {
  return url
    ? el("img", { class: classe, src: url, alt: `Foto de ${nome}`, loading: "lazy" })
    : el("div", { class: classe + " pf-sem-foto", "aria-hidden": "true" }, iniciaisPerfil(nome));
}

async function buscarFotoPerfil(nome) {
  const { data } = await sb.from("vendedor_fotos").select("foto_url").eq("vendedor", nome).limit(1);
  return data && data[0] ? data[0].foto_url : null;
}

function recortarFotoPerfil(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const sx = (img.width - lado) / 2, sy = (img.height - lado) / 2.6; // um pouco acima do centro: costuma pegar o rosto
      const cv = document.createElement("canvas"); cv.width = PERFIL_LADO; cv.height = PERFIL_LADO;
      cv.getContext("2d").drawImage(img, sx, Math.max(0, sy), lado, lado, 0, 0, PERFIL_LADO, PERFIL_LADO);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao preparar a imagem."))), "image/jpeg", 0.85);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

// abre o seletor de arquivo e salva como foto de perfil de "nome"; chama aoSalvar(url) no fim
function trocarFotoPerfil(nome, aoSalvar) {
  const input = el("input", { type: "file", accept: "image/*" });
  input.addEventListener("change", async () => {
    const arquivo = input.files && input.files[0];
    if (!arquivo) return;
    try {
      showToast("Enviando foto…");
      const [blob, { data: u }] = await Promise.all([recortarFotoPerfil(arquivo), sb.auth.getUser()]);
      const caminho = `${u.user.id}/${Date.now()}.jpg`;
      const { error: eUp } = await sb.storage.from("perfis").upload(caminho, blob, { contentType: "image/jpeg", upsert: true });
      if (eUp) throw eUp;
      const url = sb.storage.from("perfis").getPublicUrl(caminho).data.publicUrl;
      const { error: eS } = await sb.from("vendedor_fotos").upsert({ vendedor: nome, foto_url: url, atualizado_em: new Date().toISOString() }, { onConflict: "vendedor" });
      if (eS) throw eS;
      showToast("Foto atualizada! 📸");
      if (aoSalvar) aoSalvar(url);
    } catch (err) {
      showToast("Não foi possível salvar a foto: " + (err.message || err));
    }
  });
  input.click();
}
