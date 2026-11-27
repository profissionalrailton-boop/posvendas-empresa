-- 043: Pipeline liberado por vendedor (pipe_liberados). Vendedor liberado vê e mexe só nos PRÓPRIOS cards
-- (vendedor = private.vendedor_logado()); o dono (private.pipe_acesso) continua vendo tudo e é o único que
-- redistribui, cria/exclui etiquetas e exclui cards.

create table if not exists public.pipe_liberados (
  vendedor text primary key,
  liberado_em timestamptz not null default now()
);
alter table public.pipe_liberados enable row level security;
drop policy if exists "pipe liberados leitura" on public.pipe_liberados;
create policy "pipe liberados leitura" on public.pipe_liberados for select to authenticated using (true);
drop policy if exists "pipe liberados dono" on public.pipe_liberados;
create policy "pipe liberados dono" on public.pipe_liberados for all to authenticated using (private.pipe_acesso()) with check (private.pipe_acesso());
revoke all on public.pipe_liberados from anon;
grant select, insert, delete on public.pipe_liberados to authenticated;

-- vendedor logado, se estiver liberado no pipeline
create or replace function private.pipe_vendedor()
returns text language sql stable security definer set search_path to 'public'
as $$ select l.vendedor from pipe_liberados l where l.vendedor = private.vendedor_logado() $$;

create or replace function private.pipe_card_meu(p_card bigint)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from pipe_cards c where c.id = p_card and c.vendedor is not null and c.vendedor = private.pipe_vendedor()) $$;

-- o que a tela precisa saber: dono, vendedor liberado ou nada
create or replace function public.pipe_meu_acesso()
returns jsonb language sql stable security definer set search_path to 'public'
as $$ select jsonb_build_object('dono', private.pipe_acesso(), 'vendedor', private.pipe_vendedor()) $$;
revoke all on function public.pipe_meu_acesso() from public, anon;
grant execute on function public.pipe_meu_acesso() to authenticated;

-- cards: vendedor vê/cria/edita os seus (não pode passar o card para outro vendedor nem excluir)
drop policy if exists "pipe vendedor ve" on public.pipe_cards;
create policy "pipe vendedor ve" on public.pipe_cards for select to authenticated using (vendedor is not null and vendedor = private.pipe_vendedor());
drop policy if exists "pipe vendedor cria" on public.pipe_cards;
create policy "pipe vendedor cria" on public.pipe_cards for insert to authenticated with check (vendedor is not null and vendedor = private.pipe_vendedor());
drop policy if exists "pipe vendedor edita" on public.pipe_cards;
create policy "pipe vendedor edita" on public.pipe_cards for update to authenticated
  using (vendedor is not null and vendedor = private.pipe_vendedor()) with check (vendedor is not null and vendedor = private.pipe_vendedor());

-- etiquetas: vendedor liberado só lê a lista; marca/desmarca nos próprios cards
drop policy if exists "pipe vendedor le etiquetas" on public.pipe_etiquetas;
create policy "pipe vendedor le etiquetas" on public.pipe_etiquetas for select to authenticated using (private.pipe_vendedor() is not null);
drop policy if exists "pipe vendedor etiqueta card" on public.pipe_card_etiquetas;
create policy "pipe vendedor etiqueta card" on public.pipe_card_etiquetas for all to authenticated
  using (private.pipe_card_meu(card_id)) with check (private.pipe_card_meu(card_id));

-- comentários e histórico dos próprios cards
drop policy if exists "pipe vendedor comentarios ve" on public.pipe_comentarios;
create policy "pipe vendedor comentarios ve" on public.pipe_comentarios for select to authenticated using (private.pipe_card_meu(card_id));
drop policy if exists "pipe vendedor comentarios cria" on public.pipe_comentarios;
create policy "pipe vendedor comentarios cria" on public.pipe_comentarios for insert to authenticated
  with check (private.pipe_card_meu(card_id) and autor = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "pipe vendedor historico" on public.pipe_historico;
create policy "pipe vendedor historico" on public.pipe_historico for select to authenticated using (private.pipe_card_meu(card_id));

insert into public.pipe_liberados (vendedor) values ('Ana Carolina'), ('Inigly Silva') on conflict do nothing;
