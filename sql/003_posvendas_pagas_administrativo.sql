-- Até qual parcela cada venda já está paga, segundo o mapa de comissão do administrativo.
-- Se a comissão da parcela N caiu, o cliente pagou até a N (inclusive as que a tabela não comissiona).
-- Devolve só isso: o pós-vendas não enxerga valores nem a tabela de comissão.
create or replace function public.posvendas_pagas_administrativo()
returns table (venda_id uuid, ate_parcela smallint, recebido_em date)
language sql stable security definer set search_path to 'public' as $$
  select c.venda_id, max(c.numero)::smallint, max(c.recebido_em)
  from public.comissao_parcelas c
  where private.is_posvendas_user()
  group by c.venda_id
$$;
revoke execute on function public.posvendas_pagas_administrativo() from public, anon;
grant execute on function public.posvendas_pagas_administrativo() to authenticated;
