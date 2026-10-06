-- Vendedor passa a ver o CRÉDITO (valor_venda) dos próprios clientes (pedido do usuário em 2026-10-06).
-- Continua sem CPF, renda, e-mail, endereço, documentos e comissão.
drop function if exists public.posvendas_meus_clientes();
create function public.posvendas_meus_clientes()
returns table (
  id uuid, cliente text, vendedor text, administradora text, grupo text, cota text,
  numero_contrato text, numero_contato text, data_venda date, data_assembleia date,
  tipo_plano text, tabela text, parcelinha boolean, parcela_antecipada boolean,
  meses_antecipados integer, demais_parcelas numeric, valor_venda numeric
)
language sql stable security definer set search_path to 'public' as $$
  select v.id, v.cliente, v.vendedor, v.administradora, v.grupo, v.cota,
         v.numero_contrato, v.numero_contato, v.data_venda, v.data_assembleia,
         v.tipo_plano, v.tabela, v.parcelinha, v.parcela_antecipada,
         v.meses_antecipados, v.demais_parcelas, v.valor_venda
  from public.administrativo_vendas v
  where private.vendedor_logado() is not null
    and v.vendedor = private.vendedor_logado();
$$;
revoke execute on function public.posvendas_meus_clientes() from public, anon;
grant execute on function public.posvendas_meus_clientes() to authenticated;
