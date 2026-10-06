-- Painel geral (diretoria) no sistema unificado: quem está na lista do financeiro (allowed_users —
-- hoje Railton e Maria Aline) pode LER os dados do pós-vendas usados no resumo de adimplência
-- e confirmações. Só leitura: nenhuma escrita, e o pós-vendas não aparece no menu para quem
-- não está em posvendas_allowed_users.
create policy "painel read" on public.posvendas_grupos     for select to authenticated using (private.is_allowed_user());
create policy "painel read" on public.posvendas_cobranca   for select to authenticated using (private.is_allowed_user());
create policy "painel read" on public.posvendas_pagamentos for select to authenticated using (private.is_allowed_user());
create policy "painel read" on public.posvendas_lances     for select to authenticated using (private.is_allowed_user());

-- parcelas já pagas no administrativo (mapa de comissão) também para o painel
create or replace function public.posvendas_pagas_administrativo()
returns table (venda_id uuid, ate_parcela smallint, recebido_em date)
language sql stable security definer set search_path to 'public' as $$
  select c.venda_id, max(c.numero)::smallint, max(c.recebido_em)
  from public.comissao_parcelas c
  where private.is_posvendas_user() or private.is_allowed_user() or private.venda_do_vendedor(c.venda_id)
  group by c.venda_id
$$;
