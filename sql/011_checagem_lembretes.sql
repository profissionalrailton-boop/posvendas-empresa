-- Lembretes da aba Checagem (administrativo): data + hora ajustáveis, aviso com som na hora
-- ou alguns minutos antes. Cada lembrete é de quem criou: só essa pessoa vê e recebe o aviso.
create table public.checagem_lembretes (
  id bigint generated always as identity primary key,
  venda_id uuid not null references public.administrativo_vendas(id) on delete cascade,
  data date not null,
  hora time not null,
  avisar_min smallint not null default 0 check (avisar_min in (0, 5, 10, 15, 30)),
  nota text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  concluido_em timestamptz,
  created_at timestamptz not null default now()
);
-- um lembrete em aberto por cliente para cada pessoa (remarcar = editar o mesmo)
create unique index checagem_lembretes_um_aberto on public.checagem_lembretes (venda_id, user_id) where concluido_em is null;

alter table public.checagem_lembretes enable row level security;
create policy "dono" on public.checagem_lembretes for all to authenticated
  using (user_id = auth.uid() and private.is_admin_allowed_user())
  with check (user_id = auth.uid() and private.is_admin_allowed_user());
grant select, insert, update, delete on public.checagem_lembretes to authenticated;
