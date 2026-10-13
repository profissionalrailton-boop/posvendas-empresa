-- Meta da campanha (Rumo à Fortalcity) para supervisores + histórico de equipe por data.

-- Quando um vendedor muda de equipe, as vendas de cada período contam para a equipe em que ele
-- estava na data da venda. Sem período cadastrado, vale a equipe atual (administrativo_vendedores).
create table public.vendedor_equipe_periodos (
  vendedor text not null,
  equipe text not null,
  desde date not null,
  ate date,
  primary key (vendedor, desde),
  check (ate is null or ate >= desde)
);
alter table public.vendedor_equipe_periodos enable row level security;
create policy "admin gerencia periodos de equipe" on public.vendedor_equipe_periodos for all to authenticated
  using (private.is_admin_allowed_user()) with check (private.is_admin_allowed_user());
grant select, insert, update, delete on public.vendedor_equipe_periodos to authenticated;

-- Lucas Gomes: Invictus até 14/09/2026 (vendas de 12/09 e 14/09 = R$ 185 mil), Legends desde 15/09
insert into public.vendedor_equipe_periodos (vendedor, equipe, desde, ate) values
  ('Lucas Gomes', 'Invictus', date '2000-01-01', date '2026-09-14'),
  ('Lucas Gomes', 'Legends',  date '2026-09-15', null);

create or replace function private.equipe_na_data(p_vendedor text, p_data date)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select equipe from public.vendedor_equipe_periodos
      where vendedor = p_vendedor and p_data >= desde and (ate is null or p_data <= ate)
      order by desde desc limit 1),
    (select equipe from public.administrativo_vendedores where nome = p_vendedor)
  )
$$;

-- Meta da campanha do supervisor: soma da equipe no período da campanha (01/09 a 31/12/2026)
alter table public.supervisores
  add column meta_campanha_parcelinha numeric(14, 2) check (meta_campanha_parcelinha >= 0),
  add column meta_campanha_adesao numeric(14, 2) check (meta_campanha_adesao >= 0);
update public.supervisores set meta_campanha_parcelinha = 4500000, meta_campanha_adesao = 3000000
  where email = 'tatiellysilvad1@gmail.com';

-- Andamento da meta de campanha dos supervisores: diretoria/administrativo veem todos; o supervisor
-- vê o seu. Mesmo período e mesma regra de Parcelinha da campanha (campanha_ranking_recalc).
create or replace function public.supervisao_campanha()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_dir boolean := private.is_allowed_user() or private.is_admin_allowed_user();
  v_sup text := private.supervisor_equipe();
begin
  if not v_dir and v_sup is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'nome', s.nome, 'equipe', s.equipe,
      'meta_parcelinha', s.meta_campanha_parcelinha, 'meta_adesao', s.meta_campanha_adesao,
      'feito_p', coalesce(f.p, 0), 'feito_a', coalesce(f.a, 0), 'qtd', coalesce(f.qtd, 0),
      'sou_eu', (s.email = lower(auth.jwt() ->> 'email'))
    ) order by s.equipe)
    from public.supervisores s
    left join lateral (
      select sum(a.valor_venda) filter (where coalesce(a.parcelinha, false)) as p,
             sum(a.valor_venda) filter (where not coalesce(a.parcelinha, false)) as a,
             count(*) as qtd
      from public.administrativo_vendas a
      where a.data_venda between date '2026-09-01' and date '2026-12-31'
        and private.equipe_na_data(a.vendedor, a.data_venda) = s.equipe
    ) f on true
    where s.meta_campanha_parcelinha is not null and (v_dir or s.equipe = v_sup)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.supervisao_campanha() from public, anon;
grant execute on function public.supervisao_campanha() to authenticated;

-- Metas do mês: o realizado de cada EQUIPE passa a contar a equipe do vendedor na data da venda
-- (vendedor_equipe_periodos). Resto igual ao sql/013.
create or replace function public.painel_metas(p_mes date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_mes date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
  v_dir boolean := private.is_allowed_user() or private.is_admin_allowed_user();
  v_sup text := private.supervisor_equipe();
  v_vend text := private.vendedor_logado();
  v_equipe text;
  v_res jsonb;
begin
  if not v_dir and v_sup is null and v_vend is null then
    return null;
  end if;
  v_equipe := coalesce(v_sup, (select equipe from administrativo_vendedores where nome = v_vend));

  with vendas_mes as (
    select vendedor, valor_venda, coalesce(parcelinha, false) as parc, data_venda
    from administrativo_vendas
    where data_venda >= v_mes and data_venda < v_fim
  ),
  feito as (
    select vendedor,
           coalesce(sum(valor_venda) filter (where coalesce(parcelinha, false)), 0) as p,
           coalesce(sum(valor_venda) filter (where not coalesce(parcelinha, false)), 0) as a,
           count(*) as qtd
    from administrativo_vendas
    where data_venda >= v_mes and data_venda < v_fim
    group by vendedor
  ),
  vend as (
    select v.nome, v.equipe, coalesce(f.p, 0) as feito_p, coalesce(f.a, 0) as feito_a, coalesce(f.qtd, 0) as qtd,
           m.meta_parcelinha, m.meta_adesao,
           exists (select 1 from supervisores s where s.nome = v.nome) as eh_supervisor
    from administrativo_vendedores v
    left join feito f on f.vendedor = v.nome
    left join lateral (
      select meta_parcelinha, meta_adesao from vendedor_metas vm
      where vm.vendedor = v.nome and vm.mes <= v_mes order by vm.mes desc limit 1
    ) m on true
  ),
  coletivas as (
    select t.alvo,
           case when t.alvo = 'Infinity' then (select coalesce(sum(p), 0) from feito)
                else (select coalesce(sum(valor_venda) filter (where parc), 0) from vendas_mes vm where private.equipe_na_data(vm.vendedor, vm.data_venda) = t.alvo) end as feito_p,
           case when t.alvo = 'Infinity' then (select coalesce(sum(a), 0) from feito)
                else (select coalesce(sum(valor_venda) filter (where not parc), 0) from vendas_mes vm where private.equipe_na_data(vm.vendedor, vm.data_venda) = t.alvo) end as feito_a,
           case when t.alvo = 'Infinity' then (select coalesce(sum(qtd), 0) from feito)
                else (select count(*) from vendas_mes vm where private.equipe_na_data(vm.vendedor, vm.data_venda) = t.alvo) end as qtd,
           m.meta_parcelinha, m.meta_adesao
    from (select 'Infinity' as alvo
          union select distinct equipe from administrativo_vendedores where equipe is not null) t
    left join lateral (
      select meta_parcelinha, meta_adesao from metas_coletivas mc
      where mc.alvo = t.alvo and mc.mes <= v_mes order by mc.mes desc limit 1
    ) m on true
  )
  select jsonb_build_object(
    'mes', v_mes,
    'papel', case when v_dir then 'diretoria' when v_sup is not null then 'supervisor' else 'vendedor' end,
    'equipe', v_equipe,
    'empresa', (select to_jsonb(c) from coletivas c where c.alvo = 'Infinity'),
    'equipes', coalesce((select jsonb_agg(to_jsonb(c) order by c.alvo) from coletivas c
                          where c.alvo <> 'Infinity' and (v_dir or c.alvo = v_equipe)), '[]'::jsonb),
    'vendedores', coalesce((select jsonb_agg(to_jsonb(x) order by x.equipe, x.nome) from vend x
                             where not x.eh_supervisor
                               and (v_dir or (v_sup is not null and x.equipe = v_sup) or (v_sup is null and x.nome = v_vend))), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.painel_metas(date) from public, anon;
grant execute on function public.painel_metas(date) to authenticated;
