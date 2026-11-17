-- 034 — Aba "Corrida da documentação": cada documentação pega avança uma casa até a linha de chegada.
-- A corrida vale de domingo 00:00 a sábado 23:59 (horário de Fortaleza) e zera sozinha: a tela só conta os
-- lançamentos da semana atual; as semanas anteriores ficam guardadas para o histórico.
-- Hoje só a gestão lança (financeiro ou administrativo). Quando o CRM mandar o vendedor no webhook, o n8n grava
-- aqui com origem 'crm' e negocio_id (único: o mesmo negócio não conta duas vezes).

create or replace function private.doc_gestor()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select private.is_allowed_user() or private.is_admin_allowed_user();
$$;
grant execute on function private.doc_gestor() to authenticated;

create table if not exists public.doc_corrida_config (
  id int primary key default 1 check (id = 1),
  casas int not null default 10 check (casas between 3 and 60),
  atualizado_em timestamptz not null default now()
);
insert into public.doc_corrida_config (id, casas) values (1, 10) on conflict (id) do nothing;

create table if not exists public.doc_corrida (
  id bigserial primary key,
  vendedor text not null,             -- nome igual ao de administrativo_vendedores
  cliente text,
  em timestamptz not null default now(),
  origem text not null default 'manual' check (origem in ('manual', 'crm')),
  negocio_id text unique,
  criado_por text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  criado_em timestamptz not null default now()
);
create index if not exists doc_corrida_em on public.doc_corrida (em);

alter table public.doc_corrida_config enable row level security;
alter table public.doc_corrida enable row level security;
drop policy if exists "doc: todos leem" on public.doc_corrida_config;
drop policy if exists "doc: todos leem" on public.doc_corrida;
create policy "doc: todos leem" on public.doc_corrida_config for select to authenticated using (true);
create policy "doc: todos leem" on public.doc_corrida for select to authenticated using (true);
grant select on public.doc_corrida_config, public.doc_corrida to authenticated;
grant select, insert, update, delete on public.doc_corrida_config, public.doc_corrida to service_role;
grant usage, select on sequence public.doc_corrida_id_seq to service_role;

-- lançar uma documentação (só a gestão)
create or replace function public.doc_lancar(p_vendedor text, p_cliente text default null, p_em timestamptz default null)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint;
begin
  if not private.doc_gestor() then raise exception 'Só a gestão pode lançar documentações.'; end if;
  if not exists (select 1 from administrativo_vendedores where nome = p_vendedor and ativo is not false) then
    raise exception 'Vendedor % não encontrado.', p_vendedor; end if;
  insert into doc_corrida (vendedor, cliente, em) values (p_vendedor, nullif(trim(p_cliente), ''), coalesce(p_em, now()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.doc_remover(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão pode remover documentações.'; end if;
  delete from doc_corrida where id = p_id;
end $$;

create or replace function public.doc_casas(p_casas int)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão pode mudar a linha de chegada.'; end if;
  update doc_corrida_config set casas = p_casas, atualizado_em = now() where id = 1;
end $$;

revoke all on function public.doc_lancar(text, text, timestamptz) from public, anon;
revoke all on function public.doc_remover(bigint) from public, anon;
revoke all on function public.doc_casas(int) from public, anon;
grant execute on function public.doc_lancar(text, text, timestamptz) to authenticated;
grant execute on function public.doc_remover(bigint) to authenticated;
grant execute on function public.doc_casas(int) to authenticated;

alter publication supabase_realtime add table public.doc_corrida, public.doc_corrida_config;
