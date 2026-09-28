-- Pós-vendas: tabelas próprias no mesmo Supabase do administrativo/financeiro.
-- Lê os clientes de administrativo_vendas (somente leitura) e guarda aqui só o que é do pós-vendas.

-- ---------- acesso ----------
create table if not exists public.posvendas_allowed_users (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.posvendas_allowed_users enable row level security;
create policy "self read own allowlist row" on public.posvendas_allowed_users
  for select to authenticated using (email = (auth.jwt() ->> 'email'));

create or replace function private.is_posvendas_user()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.posvendas_allowed_users
    where email = (auth.jwt() ->> 'email')
  );
$$;

-- o pós-vendas só LÊ os clientes e vendedores do administrativo
create policy "posvendas read only" on public.administrativo_vendas
  for select to authenticated using (private.is_posvendas_user());
create policy "posvendas read only" on public.administrativo_vendedores
  for select to authenticated using (private.is_posvendas_user());

-- ---------- dia de vencimento por grupo ----------
create table if not exists public.posvendas_grupos (
  administradora text not null,
  grupo text not null,
  dia_vencimento smallint not null check (dia_vencimento between 1 and 31),
  updated_at timestamptz not null default now(),
  primary key (administradora, grupo)
);

-- ---------- dados de cobrança por cliente (cota) ----------
create table if not exists public.posvendas_cobranca (
  venda_id uuid primary key references public.administrativo_vendas(id) on delete cascade,
  valor_parcela numeric,
  primeira_parcela_numero smallint not null default 2 check (primeira_parcela_numero >= 1),
  primeiro_vencimento date not null,   -- mês (e dia, se o grupo não tiver dia cadastrado) da primeira parcela acompanhada
  prazo smallint check (prazo is null or prazo >= 1),
  ativo boolean not null default true, -- false = cota cancelada/quitada: sai da adimplência e dos alertas
  observacao text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- baixas manuais ----------
create table if not exists public.posvendas_pagamentos (
  venda_id uuid not null references public.administrativo_vendas(id) on delete cascade,
  numero smallint not null check (numero >= 1),
  pago_em date not null,
  valor numeric,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (venda_id, numero)
);

-- ---------- lembretes personalizados ----------
create table if not exists public.posvendas_lembretes (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid references public.administrativo_vendas(id) on delete set null,
  data date not null,
  titulo text not null,
  descricao text,
  repetir_dias smallint check (repetir_dias is null or repetir_dias >= 1),
  concluido_em timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists posvendas_lembretes_pendentes_idx on public.posvendas_lembretes (data) where concluido_em is null;

-- ---------- histórico de contatos e promessas de pagamento ----------
create table if not exists public.posvendas_anotacoes (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.administrativo_vendas(id) on delete cascade,
  tipo text not null default 'contato' check (tipo in ('contato', 'promessa', 'observacao')),
  texto text not null,
  promessa_data date,
  resolvido_em timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists posvendas_anotacoes_venda_idx on public.posvendas_anotacoes (venda_id, created_at desc);

-- ---------- RLS: só quem está em posvendas_allowed_users ----------
do $$
declare t text;
begin
  foreach t in array array['posvendas_grupos','posvendas_cobranca','posvendas_pagamentos','posvendas_lembretes','posvendas_anotacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "posvendas full access" on public.%I for all to authenticated using (private.is_posvendas_user()) with check (private.is_posvendas_user())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant select on public.posvendas_allowed_users to authenticated;

insert into public.posvendas_allowed_users (email) values ('profissionalrailton@gmail.com'), ('infinitysolucoes.posvenda@gmail.com') on conflict do nothing;
