-- Oferta de lance marcada por parcela (checkbox "LANCE" ao lado de cada parcela na aba Clientes)
create table if not exists public.posvendas_lances (
  venda_id uuid not null references public.administrativo_vendas(id) on delete cascade,
  numero smallint not null check (numero >= 1),
  feito_em date not null default current_date,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (venda_id, numero)
);
alter table public.posvendas_lances enable row level security;
create policy "posvendas full access" on public.posvendas_lances
  for all to authenticated using (private.is_posvendas_user()) with check (private.is_posvendas_user());
grant select, insert, update, delete on public.posvendas_lances to authenticated;
