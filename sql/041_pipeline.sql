-- 041: Pipeline de negócios (Negócios › Pipeline) — substituto do quadro do CRM.
-- Fase de teste: só o dono (private.pipe_acesso) vê e mexe; os vendedores veem "em breve".
-- Etapas: reciclagem, oportunidade, contato, agendamento, reuniao, documentacao, negociacao, fechado.
-- "Perdeu" leva o card para a reciclagem com o motivo; de lá a gestão redistribui vários de uma vez.

create or replace function private.pipe_acesso()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) in ('profissionalrailton@gmail.com') $$;

create table if not exists public.pipe_etiquetas (
  id bigserial primary key,
  nome text not null,
  cor text not null default '#6366f1',
  criado_em timestamptz not null default now()
);
create unique index if not exists pipe_etiquetas_nome on public.pipe_etiquetas (lower(nome));

create table if not exists public.pipe_cards (
  id bigserial primary key,
  nome text not null,
  telefone text,
  tipo_bem text,
  valor_credito numeric,
  vendedor text,
  etapa text not null default 'oportunidade'
    check (etapa in ('reciclagem','oportunidade','contato','agendamento','reuniao','documentacao','negociacao','fechado')),
  posicao double precision not null default extract(epoch from now()),
  email text,
  cidade text,
  estado text,
  genero text,
  origem text,
  reuniao_em timestamptz,
  perdido_motivo text,
  perdido_obs text,
  perdido_em timestamptz,
  perdido_por text,
  fechado_em timestamptz,
  crm_id text,
  etapa_desde timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  criado_por text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  atualizado_em timestamptz not null default now()
);
create index if not exists pipe_cards_etapa on public.pipe_cards (etapa, posicao);
create index if not exists pipe_cards_vendedor on public.pipe_cards (vendedor);
create unique index if not exists pipe_cards_crm on public.pipe_cards (crm_id) where crm_id is not null;

create table if not exists public.pipe_card_etiquetas (
  card_id bigint not null references public.pipe_cards(id) on delete cascade,
  etiqueta_id bigint not null references public.pipe_etiquetas(id) on delete cascade,
  primary key (card_id, etiqueta_id)
);

create table if not exists public.pipe_comentarios (
  id bigserial primary key,
  card_id bigint not null references public.pipe_cards(id) on delete cascade,
  autor text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  texto text not null,
  em timestamptz not null default now()
);
create index if not exists pipe_comentarios_card on public.pipe_comentarios (card_id, em);

create table if not exists public.pipe_historico (
  id bigserial primary key,
  card_id bigint not null references public.pipe_cards(id) on delete cascade,
  de text,
  para text not null,
  detalhe text,
  por text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  em timestamptz not null default now()
);
create index if not exists pipe_historico_card on public.pipe_historico (card_id, em);

-- histórico automático de etapa / vendedor
create or replace function private.pipe_cards_hist()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' then
    insert into pipe_historico (card_id, de, para, detalhe) values (new.id, null, new.etapa, 'Card criado' || coalesce(' · ' || new.vendedor, ''));
    return new;
  end if;
  if new.etapa is distinct from old.etapa then
    new.etapa_desde := now();
    if new.etapa = 'fechado' and new.fechado_em is null then new.fechado_em := now(); end if;
    if new.etapa <> 'reciclagem' then new.perdido_motivo := null; new.perdido_obs := null; new.perdido_em := null; new.perdido_por := null; end if;
    insert into pipe_historico (card_id, de, para, detalhe)
    values (new.id, old.etapa, new.etapa, case when new.etapa = 'reciclagem' and new.perdido_motivo is not null then 'Perdido: ' || new.perdido_motivo end);
  end if;
  if new.vendedor is distinct from old.vendedor then
    insert into pipe_historico (card_id, de, para, detalhe)
    values (new.id, new.etapa, new.etapa, 'Vendedor: ' || coalesce(old.vendedor, '—') || ' → ' || coalesce(new.vendedor, '—'));
  end if;
  return new;
end $$;
drop trigger if exists pipe_cards_hist_ins on public.pipe_cards;
create trigger pipe_cards_hist_ins after insert on public.pipe_cards for each row execute function private.pipe_cards_hist();
drop trigger if exists pipe_cards_hist_upd on public.pipe_cards;
create trigger pipe_cards_hist_upd before update on public.pipe_cards for each row execute function private.pipe_cards_hist();

-- RLS: só quem tem acesso ao pipeline (fase de teste)
do $$
declare t text;
begin
  foreach t in array array['pipe_etiquetas','pipe_cards','pipe_card_etiquetas','pipe_comentarios','pipe_historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "pipe acesso" on public.%I', t);
    execute format('create policy "pipe acesso" on public.%I for all to authenticated using (private.pipe_acesso()) with check (private.pipe_acesso())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.pipe_etiquetas_id_seq, public.pipe_cards_id_seq, public.pipe_comentarios_id_seq, public.pipe_historico_id_seq to authenticated;

-- redistribuir vários cards da reciclagem de uma vez (round-robin entre os vendedores escolhidos)
create or replace function public.pipe_redistribuir(p_cards bigint[], p_vendedores text[])
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare i int := 0; c bigint; n int := coalesce(array_length(p_vendedores, 1), 0);
begin
  if not private.pipe_acesso() then raise exception 'Sem acesso ao pipeline.'; end if;
  if n = 0 then raise exception 'Escolha pelo menos um vendedor.'; end if;
  foreach c in array p_cards loop
    update pipe_cards set vendedor = p_vendedores[(i % n) + 1], etapa = 'oportunidade', posicao = extract(epoch from now()) + i
     where id = c and etapa = 'reciclagem';
    if found then i := i + 1; end if;
  end loop;
  return i;
end $$;
revoke all on function public.pipe_redistribuir(bigint[], text[]) from public, anon;
grant execute on function public.pipe_redistribuir(bigint[], text[]) to authenticated;

alter publication supabase_realtime add table public.pipe_cards;

insert into public.pipe_etiquetas (nome, cor) values
  ('Tráfego WhatsApp', '#111827'), ('Follow-up Atlas', '#65a30d'), ('Indicação', '#2563eb'), ('Lead quente', '#dc2626')
on conflict do nothing;
