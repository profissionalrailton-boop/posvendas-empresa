-- Metas da empresa e das equipes + supervisores de equipe.

-- Metas coletivas do mês: alvo = 'Infinity' (empresa toda) ou o nome da equipe ('Invictus', 'Legends').
-- Como nas metas individuais, mês sem linha própria usa a do último mês que tiver.
create table public.metas_coletivas (
  alvo text not null,
  mes date not null check (extract(day from mes) = 1),
  meta_parcelinha numeric(14, 2) not null default 0 check (meta_parcelinha >= 0),
  meta_adesao numeric(14, 2) not null default 0 check (meta_adesao >= 0),
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  primary key (alvo, mes)
);
alter table public.metas_coletivas enable row level security;
create policy "admin gerencia metas coletivas" on public.metas_coletivas for all to authenticated
  using (private.is_admin_allowed_user()) with check (private.is_admin_allowed_user());
create policy "diretoria le metas coletivas" on public.metas_coletivas for select to authenticated
  using (private.is_allowed_user());
grant select, insert, update, delete on public.metas_coletivas to authenticated;

-- Supervisores: acompanham a equipe (metas da equipe e de cada vendedor dela). Não aparecem
-- como vendedores no acompanhamento de metas.
create table public.supervisores (
  email text primary key check (email = lower(email)),
  nome text not null,
  equipe text not null,
  created_at timestamptz not null default now()
);
alter table public.supervisores enable row level security;
create policy "self read" on public.supervisores for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));
create policy "admin gerencia supervisores" on public.supervisores for all to authenticated
  using (private.is_admin_allowed_user()) with check (private.is_admin_allowed_user());
grant select, insert, update, delete on public.supervisores to authenticated;

create or replace function private.supervisor_equipe()
returns text language sql stable security definer set search_path to 'public' as $$
  select equipe from public.supervisores where email = lower(auth.jwt() ->> 'email')
$$;

insert into public.supervisores (email, nome, equipe) values ('tatiellysilvad1@gmail.com', 'Tatielly David', 'Invictus');

-- Acompanhamento de metas do mês, filtrado por quem pede:
--   diretoria/administrativo → empresa, todas as equipes e todos os vendedores
--   supervisor               → empresa, a equipe dele e os vendedores dela
--   vendedor                 → empresa, a equipe dele e ele mesmo
-- Realizado = crédito vendido no mês (data_venda), Parcelinha pelo campo parcelinha (regra da campanha).
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

  with feito as (
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
                else (select coalesce(sum(feito_p), 0) from vend where equipe = t.alvo) end as feito_p,
           case when t.alvo = 'Infinity' then (select coalesce(sum(a), 0) from feito)
                else (select coalesce(sum(feito_a), 0) from vend where equipe = t.alvo) end as feito_a,
           case when t.alvo = 'Infinity' then (select coalesce(sum(qtd), 0) from feito)
                else (select coalesce(sum(qtd), 0) from vend where equipe = t.alvo) end as qtd,
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
