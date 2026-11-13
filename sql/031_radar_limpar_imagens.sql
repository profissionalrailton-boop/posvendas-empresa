-- 031 — Cadastro de vendas (Radar): as imagens do vendedor são apagadas do cadastro do Radar 7 dias depois de a
-- venda ser cadastrada. Elas continuam na ficha do cliente (administrativo_vendas.imagens), para onde são copiadas
-- ao cadastrar — só some a duplicata. Roda na rotina diária do n8n "Sistema Infinity - Meus atendimentos (apagar
-- áudios antigos)". Trava: só apaga se a venda vinculada tiver pelo menos a mesma quantidade de imagens.

alter table public.radar_cadastros_pendentes add column if not exists imagens_apagadas_em timestamptz;

create or replace function public.radar_n8n_limpar_imagens(p_dias int default 7)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update radar_cadastros_pendentes r set imagens = '[]'::jsonb, imagens_apagadas_em = now()
  from administrativo_vendas v
  where v.id = r.venda_id
    and r.status = 'cadastrado'
    and r.cadastrado_em < now() - make_interval(days => p_dias)
    and jsonb_typeof(r.imagens) = 'array' and jsonb_array_length(r.imagens) > 0
    and jsonb_typeof(v.imagens) = 'array' and jsonb_array_length(v.imagens) >= jsonb_array_length(r.imagens);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.radar_n8n_limpar_imagens(int) from public, anon, authenticated;
grant execute on function public.radar_n8n_limpar_imagens(int) to service_role;
