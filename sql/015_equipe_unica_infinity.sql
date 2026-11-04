-- 015 — A partir de 01/11/2026 só existe a equipe Infinity (fim de Invictus e Legends).
--   * histórico preservado: cada vendedor fica na equipe antiga até 31/10/2026 (vendedor_equipe_periodos),
--     então as metas/painéis de setembro e outubro continuam mostrando Invictus e Legends;
--   * Tatielly deixa de ser supervisora e passa a ser vendedora (regras de vendedor);
--   * Felipe Cavalcante e Djalma Neto desligados em 01/11/2026: saem das listas a partir de novembro,
--     mas as vendas e o histórico continuam; o acesso de vendedor do Felipe é removido.

alter table public.administrativo_vendedores
  add column if not exists ativo boolean not null default true,
  add column if not exists desligado_em date;

-- 1) histórico: equipe antiga até 31/10 para quem ainda não tinha período registrado
insert into public.vendedor_equipe_periodos (vendedor, equipe, desde, ate)
select v.nome, v.equipe, date '2000-01-01', date '2026-10-31'
from public.administrativo_vendedores v
where v.equipe is not null and v.equipe <> 'Infinity'
  and not exists (select 1 from public.vendedor_equipe_periodos p where p.vendedor = v.nome);
-- quem já tinha período em aberto (Lucas Gomes) fecha em 31/10
update public.vendedor_equipe_periodos set ate = date '2026-10-31' where ate is null and equipe <> 'Infinity';

-- 2) desligados
update public.administrativo_vendedores
   set ativo = false, desligado_em = date '2026-11-01'
 where nome in ('Felipe Cavalcante', 'Djalma Neto');
delete from public.posvendas_vendedor_acesso where vendedor in ('Felipe Cavalcante', 'Djalma Neto');

-- 3) todos os ativos na Infinity a partir de 01/11
insert into public.vendedor_equipe_periodos (vendedor, equipe, desde, ate)
select v.nome, 'Infinity', date '2026-11-01', null
from public.administrativo_vendedores v
where v.ativo
  and not exists (select 1 from public.vendedor_equipe_periodos p where p.vendedor = v.nome and p.equipe = 'Infinity');
update public.administrativo_vendedores set equipe = 'Infinity' where ativo;

-- 4) Tatielly vira vendedora (fim da supervisão e da meta da Fortal de supervisora)
delete from public.supervisores where nome = 'Tatielly David';

-- 5) painel_metas: equipes do mês vêm dos períodos (histórico) e desligados só aparecem até o mês em que saíram
create or replace function public.painel_metas(p_mes date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
  v_equipe := coalesce(v_sup, private.equipe_na_data(v_vend, v_mes));
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
    select v.nome, private.equipe_na_data(v.nome, v_mes) as equipe,
           coalesce(f.p, 0) as feito_p, coalesce(f.a, 0) as feito_a, coalesce(f.qtd, 0) as qtd,
           m.meta_parcelinha, m.meta_adesao,
           exists (select 1 from supervisores s where s.nome = v.nome) as eh_supervisor
    from administrativo_vendedores v
    left join feito f on f.vendedor = v.nome
    left join lateral (
      select meta_parcelinha, meta_adesao from vendedor_metas vm
      where vm.vendedor = v.nome and vm.mes <= v_mes order by vm.mes desc limit 1
    ) m on true
    where v.ativo or v.desligado_em > v_mes
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
          union select distinct equipe from vendedor_equipe_periodos
                 where equipe is not null and desde < v_fim and (ate is null or ate >= v_mes)) t
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
$function$;

notify pgrst, 'reload schema';
