-- 042: Pipeline — "dias parado" conta da última atividade (mudou de etapa, comentou ou trocou de vendedor),
-- e a redistribuição em lote também vale para leads ativos (troca só o vendedor; os perdidos voltam para Oportunidade).

alter table public.pipe_cards add column if not exists atividade_em timestamptz not null default now();
update public.pipe_cards set atividade_em = greatest(etapa_desde, coalesce((select max(em) from public.pipe_comentarios c where c.card_id = pipe_cards.id), etapa_desde));

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
    new.atividade_em := now();
    if new.etapa = 'fechado' and new.fechado_em is null then new.fechado_em := now(); end if;
    if new.etapa <> 'reciclagem' then new.perdido_motivo := null; new.perdido_obs := null; new.perdido_em := null; new.perdido_por := null; end if;
    insert into pipe_historico (card_id, de, para, detalhe)
    values (new.id, old.etapa, new.etapa, case when new.etapa = 'reciclagem' and new.perdido_motivo is not null then 'Perdido: ' || new.perdido_motivo end);
  end if;
  if new.vendedor is distinct from old.vendedor then
    new.atividade_em := now();
    insert into pipe_historico (card_id, de, para, detalhe)
    values (new.id, new.etapa, new.etapa, 'Vendedor: ' || coalesce(old.vendedor, '—') || ' → ' || coalesce(new.vendedor, '—'));
  end if;
  return new;
end $$;

-- comentário novo zera o "parado"
create or replace function private.pipe_coment_atividade()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  update pipe_cards set atividade_em = now() where id = new.card_id;
  return new;
end $$;
drop trigger if exists pipe_coment_atividade on public.pipe_comentarios;
create trigger pipe_coment_atividade after insert on public.pipe_comentarios for each row execute function private.pipe_coment_atividade();

create or replace function public.pipe_redistribuir(p_cards bigint[], p_vendedores text[])
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare i int := 0; c bigint; n int := coalesce(array_length(p_vendedores, 1), 0);
begin
  if not private.pipe_acesso() then raise exception 'Sem acesso ao pipeline.'; end if;
  if n = 0 then raise exception 'Escolha pelo menos um vendedor.'; end if;
  foreach c in array p_cards loop
    update pipe_cards
       set vendedor = p_vendedores[(i % n) + 1],
           etapa = case when etapa = 'reciclagem' then 'oportunidade' else etapa end,
           posicao = case when etapa = 'reciclagem' then extract(epoch from now()) + i else posicao end,
           atividade_em = now()
     where id = c and etapa <> 'fechado';
    if found then i := i + 1; end if;
  end loop;
  return i;
end $$;
