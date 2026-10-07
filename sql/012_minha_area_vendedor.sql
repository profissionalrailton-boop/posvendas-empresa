-- "Minha área" do vendedor: meta individual do mês (Parcelinha + Adesão) e as próprias vendas.

-- Metas mensais por vendedor, definidas pela gestão no administrativo (aba Vendedores).
-- Mês sem meta cadastrada usa a do último mês que tiver (a meta "repete" até ser mudada).
create table public.vendedor_metas (
  vendedor text not null,
  mes date not null check (extract(day from mes) = 1),
  meta_parcelinha numeric(14, 2) not null default 0 check (meta_parcelinha >= 0),
  meta_adesao numeric(14, 2) not null default 0 check (meta_adesao >= 0),
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  primary key (vendedor, mes)
);
alter table public.vendedor_metas enable row level security;
create policy "admin gerencia metas" on public.vendedor_metas for all to authenticated
  using (private.is_admin_allowed_user()) with check (private.is_admin_allowed_user());
create policy "diretoria le metas" on public.vendedor_metas for select to authenticated
  using (private.is_allowed_user());
create policy "vendedor le a propria meta" on public.vendedor_metas for select to authenticated
  using (vendedor = private.vendedor_logado());
grant select, insert, update, delete on public.vendedor_metas to authenticated;

-- Vendas do próprio vendedor a partir de uma data, só com o necessário para a Minha área
-- (sem CPF, telefone, renda etc.). Parcelinha pela mesma regra da campanha (campo parcelinha).
create or replace function public.vendedor_minhas_vendas(p_desde date)
returns table (
  id uuid, cliente text, administradora text, valor_venda numeric, data_venda date, parcelinha boolean,
  doc_completa_ok boolean, contrato_ok boolean, resumo_ok boolean, termo_juridico_ok boolean,
  gravacao_fechamento_ok boolean, comprovante_entrada_ok boolean, envio_comprovante_antecipacao_ok boolean,
  parcela_antecipada boolean
)
language sql stable security definer set search_path to 'public' as $$
  select v.id, v.cliente, v.administradora, v.valor_venda, v.data_venda, coalesce(v.parcelinha, false),
         v.doc_completa_ok, v.contrato_ok, v.resumo_ok, v.termo_juridico_ok,
         v.gravacao_fechamento_ok, v.comprovante_entrada_ok, v.envio_comprovante_antecipacao_ok,
         coalesce(v.parcela_antecipada, false)
  from public.administrativo_vendas v
  where private.vendedor_logado() is not null
    and v.vendedor = private.vendedor_logado()
    and v.data_venda >= p_desde
  order by v.data_venda desc
$$;
revoke all on function public.vendedor_minhas_vendas(date) from public, anon;
grant execute on function public.vendedor_minhas_vendas(date) to authenticated;
