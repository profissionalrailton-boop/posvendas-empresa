-- 047: agenda de reuniões do Pipeline (Negócios › Reuniões).
-- Card que vai para Agendamento pede data/hora e tipo (presencial/online) → pipe_reunioes.
-- A reunião vira "realizada" quando o card vai para Reunião (ou pula direto para Documentação/Em negociação/Fechado);
-- se o card volta para trás ou vai para a Reciclagem, a reunião fica "cancelada". Remarcar guarda a anterior como "remarcada".
-- Taxa de conversão = realizadas ÷ (agendadas que já passaram ou foram resolvidas).

create table if not exists public.pipe_reunioes (
  id bigserial primary key,
  card_id bigint not null references public.pipe_cards(id) on delete cascade,
  vendedor text,
  cliente text,
  quando timestamptz not null,
  tipo text not null check (tipo in ('presencial', 'online')),
  obs text,
  status text not null default 'agendada' check (status in ('agendada', 'realizada', 'cancelada', 'remarcada')),
  resolvida_em timestamptz,
  criado_em timestamptz not null default now(),
  criado_por text not null default lower(coalesce(auth.jwt() ->> 'email', ''))
);
create index if not exists pipe_reunioes_card on public.pipe_reunioes (card_id, criado_em desc);
create index if not exists pipe_reunioes_quando on public.pipe_reunioes (quando);
create index if not exists pipe_reunioes_vendedor on public.pipe_reunioes (vendedor, quando);

alter table public.pipe_reunioes enable row level security;
drop policy if exists "pipe dono" on public.pipe_reunioes;
create policy "pipe dono" on public.pipe_reunioes for select to authenticated using (private.pipe_acesso());
drop policy if exists "pipe vendedor ve" on public.pipe_reunioes;
create policy "pipe vendedor ve" on public.pipe_reunioes for select to authenticated using (vendedor is not null and vendedor = private.pipe_vendedor());
revoke all on public.pipe_reunioes from anon;
grant select on public.pipe_reunioes to authenticated;

-- marcar / remarcar (dono ou o vendedor do card): grava a reunião e leva o card para Agendamento
create or replace function public.pipe_agendar(p_card bigint, p_quando timestamptz, p_tipo text, p_obs text default null)
returns bigint language plpgsql security definer set search_path to 'public'
as $$
declare c pipe_cards; v_id bigint;
begin
  select * into c from pipe_cards where id = p_card;
  if c.id is null then raise exception 'Card não encontrado.'; end if;
  if not private.pipe_acesso() and (c.vendedor is null or c.vendedor is distinct from private.pipe_vendedor()) then
    raise exception 'Você só pode agendar reunião dos seus clientes.';
  end if;
  if p_tipo not in ('presencial', 'online') then raise exception 'Escolha presencial ou online.'; end if;
  if p_quando is null then raise exception 'Escolha a data e a hora.'; end if;
  update pipe_reunioes set status = 'remarcada', resolvida_em = now() where card_id = p_card and status = 'agendada';
  insert into pipe_reunioes (card_id, vendedor, cliente, quando, tipo, obs)
  values (p_card, c.vendedor, c.nome, p_quando, p_tipo, nullif(btrim(coalesce(p_obs, '')), ''))
  returning id into v_id;
  update pipe_cards set etapa = 'agendamento', reuniao_em = p_quando,
         posicao = case when etapa <> 'agendamento' then extract(epoch from now()) else posicao end,
         atividade_em = now()
   where id = p_card;
  return v_id;
end $$;
revoke all on function public.pipe_agendar(bigint, timestamptz, text, text) from public, anon;
grant execute on function public.pipe_agendar(bigint, timestamptz, text, text) to authenticated;

-- card mudou de etapa: resolve a reunião agendada
create or replace function private.pipe_card_reuniao()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.etapa is not distinct from old.etapa or old.etapa <> 'agendamento' then return new; end if;
  update pipe_reunioes
     set status = case when new.etapa in ('reuniao', 'documentacao', 'negociacao', 'fechado') then 'realizada' else 'cancelada' end,
         resolvida_em = now()
   where card_id = new.id and status = 'agendada';
  return new;
end $$;
drop trigger if exists pipe_card_reuniao on public.pipe_cards;
create trigger pipe_card_reuniao after update of etapa on public.pipe_cards
  for each row execute function private.pipe_card_reuniao();

-- vendedor do card mudou (redistribuição): a reunião agendada acompanha
create or replace function private.pipe_card_reuniao_vendedor()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.vendedor is distinct from old.vendedor then
    update pipe_reunioes set vendedor = new.vendedor where card_id = new.id and status = 'agendada';
  end if;
  return new;
end $$;
drop trigger if exists pipe_card_reuniao_vendedor on public.pipe_cards;
create trigger pipe_card_reuniao_vendedor after update of vendedor on public.pipe_cards
  for each row execute function private.pipe_card_reuniao_vendedor();

alter publication supabase_realtime add table public.pipe_reunioes;
