-- Acesso dos VENDEDORES ao pós-vendas: cada um vê só os próprios clientes, só consulta
-- e pode registrar contato. A trava é no banco (RLS / funções), não só na tela.

-- e-mail de login → nome do vendedor (igual ao campo "vendedor" das vendas)
create table if not exists public.posvendas_vendedor_acesso (
  email text primary key,
  vendedor text not null,
  created_at timestamptz not null default now()
);
alter table public.posvendas_vendedor_acesso enable row level security;
-- e-mails comparados sem diferença de maiúsculas/minúsculas
create policy "self read own row" on public.posvendas_vendedor_acesso
  for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));
-- o pós-vendas vê a lista inteira, para mostrar o nome do vendedor nos contatos registrados
create policy "posvendas read all" on public.posvendas_vendedor_acesso
  for select to authenticated using (private.is_posvendas_user());
grant select on public.posvendas_vendedor_acesso to authenticated;

create or replace function private.vendedor_logado()
returns text language sql stable security definer set search_path to 'public' as $$
  select vendedor from public.posvendas_vendedor_acesso where lower(email) = lower(auth.jwt() ->> 'email');
$$;

create or replace function private.venda_do_vendedor(p_venda uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.administrativo_vendas v
    where v.id = p_venda and v.vendedor = private.vendedor_logado()
  );
$$;

-- Clientes do vendedor logado, só com os campos necessários
-- (sem CPF, renda, e-mail, endereço, documentos, crédito ou comissão)
create or replace function public.posvendas_meus_clientes()
returns table (
  id uuid, cliente text, vendedor text, administradora text, grupo text, cota text,
  numero_contrato text, numero_contato text, data_venda date, data_assembleia date,
  tipo_plano text, tabela text, parcelinha boolean, parcela_antecipada boolean,
  meses_antecipados integer, demais_parcelas numeric
)
language sql stable security definer set search_path to 'public' as $$
  select v.id, v.cliente, v.vendedor, v.administradora, v.grupo, v.cota,
         v.numero_contrato, v.numero_contato, v.data_venda, v.data_assembleia,
         v.tipo_plano, v.tabela, v.parcelinha, v.parcela_antecipada,
         v.meses_antecipados, v.demais_parcelas
  from public.administrativo_vendas v
  where private.vendedor_logado() is not null
    and v.vendedor = private.vendedor_logado();
$$;
revoke execute on function public.posvendas_meus_clientes() from public, anon;
grant execute on function public.posvendas_meus_clientes() to authenticated;

-- Leitura das tabelas do pós-vendas: só das vendas do próprio vendedor
create policy "vendedor read own" on public.posvendas_cobranca   for select to authenticated using (private.venda_do_vendedor(venda_id));
create policy "vendedor read own" on public.posvendas_pagamentos for select to authenticated using (private.venda_do_vendedor(venda_id));
create policy "vendedor read own" on public.posvendas_lances     for select to authenticated using (private.venda_do_vendedor(venda_id));
create policy "vendedor read own" on public.posvendas_anotacoes  for select to authenticated using (private.venda_do_vendedor(venda_id));
create policy "vendedor read" on public.posvendas_grupos for select to authenticated using (private.vendedor_logado() is not null);

-- Única escrita do vendedor: registrar CONTATO nos próprios clientes, assinado com o próprio e-mail
create policy "vendedor registra contato" on public.posvendas_anotacoes
  for insert to authenticated
  with check (
    private.venda_do_vendedor(venda_id)
    and tipo = 'contato'
    and lower(created_by) = lower(auth.jwt() ->> 'email')
  );

-- Parcelas já pagas no administrativo: também para o vendedor, só das vendas dele
create or replace function public.posvendas_pagas_administrativo()
returns table (venda_id uuid, ate_parcela smallint, recebido_em date)
language sql stable security definer set search_path to 'public' as $$
  select c.venda_id, max(c.numero)::smallint, max(c.recebido_em)
  from public.comissao_parcelas c
  where private.is_posvendas_user() or private.venda_do_vendedor(c.venda_id)
  group by c.venda_id
$$;
