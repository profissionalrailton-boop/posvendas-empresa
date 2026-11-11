
-- 024 — Rouba prêmio ao vivo: tabelas no Realtime (a tela de todos atualiza sozinha; RLS de leitura continua valendo)
alter publication supabase_realtime add table public.rp_metas, public.rp_premios, public.rp_eventos, public.vendedor_fotos;
