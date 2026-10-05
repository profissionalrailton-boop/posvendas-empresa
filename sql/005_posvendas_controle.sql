-- "Controle feito": marca os clientes em que o pós-vendas já fez o primeiro contato (aba Clientes).
create table if not exists public.posvendas_controle (
  venda_id uuid primary key references public.administrativo_vendas(id) on delete cascade,
  feito_em date not null default current_date,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.posvendas_controle enable row level security;
create policy "posvendas full access" on public.posvendas_controle
  for all to authenticated using (private.is_posvendas_user()) with check (private.is_posvendas_user());
grant select, insert, update, delete on public.posvendas_controle to authenticated;
