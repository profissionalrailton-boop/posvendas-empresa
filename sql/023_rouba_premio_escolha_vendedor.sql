-- 023 — Rouba prêmio, novo fluxo: o Railton marca as metas batidas (uma ou várias) para um vendedor;
-- cada meta batida libera 1 escolha, que o PRÓPRIO vendedor faz na aba (da banca ou roubando de alguém).
-- Meta batida sem linha em rp_eventos = escolha pendente. O Railton também pode escolher por ele.

drop function if exists public.rp_bater(int, text, int);

-- marcar metas batidas (só o editor)
create or replace function public.rp_marcar(p_metas int[], p_vendedor text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_ja text;
begin
  if not private.rp_editor() then raise exception 'Só o Railton pode marcar metas.'; end if;
  if coalesce(array_length(p_metas, 1), 0) = 0 then raise exception 'Escolha pelo menos uma meta.'; end if;
  if not exists (select 1 from administrativo_vendedores where nome = p_vendedor) then
    raise exception 'Vendedor % não encontrado.', p_vendedor; end if;
  select string_agg(numero::text, ', ') into v_ja from rp_metas where numero = any(p_metas) and batida_por is not null;
  if v_ja is not null then raise exception 'Meta(s) % já foram batidas.', v_ja; end if;
  update rp_metas set batida_por = p_vendedor, batida_em = now() where numero = any(p_metas);
end $$;
grant execute on function public.rp_marcar(int[], text) to authenticated;

-- desmarcar uma meta batida cuja escolha ainda não foi usada (só o editor)
create or replace function public.rp_desmarcar(p_meta int)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not private.rp_editor() then raise exception 'Só o Railton pode desmarcar metas.'; end if;
  if exists (select 1 from rp_eventos where meta = p_meta) then
    raise exception 'O prêmio dessa meta já foi escolhido. Desfaça a escolha antes.'; end if;
  update rp_metas set batida_por = null, batida_em = null where numero = p_meta;
end $$;
grant execute on function public.rp_desmarcar(int) to authenticated;

-- escolher um prêmio usando uma escolha pendente. Sem p_vendedor = o vendedor logado;
-- com p_vendedor = o editor escolhendo por alguém.
create or replace function public.rp_escolher(p_premio int, p_vendedor text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_quem text; v_meta int; v_dono text;
begin
  if p_vendedor is not null then
    if not private.rp_editor() then raise exception 'Só o Railton pode escolher por outra pessoa.'; end if;
    v_quem := p_vendedor;
  else
    v_quem := private.vendedor_logado();
    if v_quem is null then raise exception 'Seu login não está ligado a um vendedor.'; end if;
  end if;
  select m.numero into v_meta from rp_metas m
   where m.batida_por = v_quem and not exists (select 1 from rp_eventos e where e.meta = m.numero)
   order by m.batida_em, m.numero limit 1 for update;
  if v_meta is null then raise exception 'Não há prêmio liberado para escolher.'; end if;
  select dono into v_dono from rp_premios where id = p_premio for update;
  if not found then raise exception 'Prêmio não encontrado.'; end if;
  if v_dono = v_quem then raise exception 'Esse prêmio já é seu.'; end if;
  update rp_premios set dono = v_quem, vezes_roubado = vezes_roubado + (case when v_dono is null then 0 else 1 end) where id = p_premio;
  insert into rp_eventos (meta, vendedor, premio_id, de_dono) values (v_meta, v_quem, p_premio, v_dono);
end $$;
grant execute on function public.rp_escolher(int, text) to authenticated;

-- desfazer a última escolha: o prêmio volta para quem tinha e a escolha fica pendente de novo (meta continua batida)
create or replace function public.rp_desfazer()
returns void language plpgsql security definer set search_path to 'public' as $$
declare e rp_eventos;
begin
  if not private.rp_editor() then raise exception 'Só o Railton pode desfazer.'; end if;
  select * into e from rp_eventos order by id desc limit 1 for update;
  if not found then raise exception 'Nenhuma escolha para desfazer.'; end if;
  update rp_premios set dono = e.de_dono, vezes_roubado = greatest(0, vezes_roubado - (case when e.de_dono is null then 0 else 1 end)) where id = e.premio_id;
  delete from rp_eventos where id = e.id;
end $$;
