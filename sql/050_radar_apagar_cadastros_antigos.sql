-- 050 — Cadastro de vendas (Radar): apaga os cadastros com mais de 7 dias, deixando só os da última semana.
-- Só apaga os já CADASTRADOS (pendente ainda não virou venda e fica até alguém cadastrar).
-- Trava: se o cadastro ainda tem imagens, só apaga quando a venda vinculada já tem pelo menos a mesma quantidade
-- (as imagens são copiadas para a ficha do cliente ao cadastrar). A venda em administrativo_vendas não é tocada.
-- Roda na rotina diária do n8n "Sistema Infinity - Limpeza diária (áudios e imagens antigas)", logo depois de
-- radar_n8n_limpar_imagens (031).

create or replace function public.radar_n8n_apagar_antigos(p_dias int default 7)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  delete from radar_cadastros_pendentes r
  where r.status = 'cadastrado'
    and r.created_at < now() - make_interval(days => p_dias)
    and (
      jsonb_typeof(r.imagens) <> 'array' or jsonb_array_length(r.imagens) = 0
      or exists (select 1 from administrativo_vendas v where v.id = r.venda_id
                 and jsonb_typeof(v.imagens) = 'array' and jsonb_array_length(v.imagens) >= jsonb_array_length(r.imagens))
    );
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.radar_n8n_apagar_antigos(int) from public, anon, authenticated;
grant execute on function public.radar_n8n_apagar_antigos(int) to service_role;
