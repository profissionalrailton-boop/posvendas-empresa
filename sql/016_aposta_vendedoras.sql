-- 016 — Aba "Aposta": duelo de produção entre duas vendedoras (só vendas de Adesão, parcelinha = false).
-- Uma aposta ativa por vez; para um novo duelo, desativa a atual e insere outra linha.

create table if not exists public.apostas (
  id bigserial primary key,
  titulo text not null default 'Aposta',
  inicio date not null,
  fim date not null,
  lutadora_a text not null,     -- nome igual ao de administrativo_vendedores
  apelido_a text not null,
  lutadora_b text not null,
  apelido_b text not null,
  premio text,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.apostas enable row level security;
create policy "admin gerencia apostas" on public.apostas for all to authenticated
  using (private.is_admin_allowed_user()) with check (private.is_admin_allowed_user());
grant select, insert, update, delete on public.apostas to authenticated;
grant usage, select on sequence public.apostas_id_seq to authenticated;

insert into public.apostas (titulo, inicio, fim, lutadora_a, apelido_a, lutadora_b, apelido_b)
values ('Fight Night Infinity', date '2026-11-01', date '2026-11-30', 'Tatielly David', 'Taty', 'Yarine Santos', 'Yarine');

-- Placar da aposta ativa: para qualquer login com acesso ao sistema. Devolve só data, valor e
-- administradora de cada venda de Adesão das duas (sem cliente, CPF etc.).
create or replace function public.aposta_atual()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  a public.apostas;
begin
  if not (private.is_allowed_user() or private.is_admin_allowed_user() or private.is_posvendas_user()
          or private.vendedor_logado() is not null or private.supervisor_equipe() is not null) then
    return null;
  end if;
  select * into a from public.apostas where ativa order by id desc limit 1;
  if a.id is null then return null; end if;
  return jsonb_build_object(
    'aposta', to_jsonb(a),
    'vendas', coalesce((
      select jsonb_agg(jsonb_build_object('vendedor', v.vendedor, 'data', v.data_venda, 'valor', v.valor_venda, 'administradora', v.administradora)
                       order by v.data_venda, v.created_at)
      from administrativo_vendas v
      where v.vendedor in (a.lutadora_a, a.lutadora_b)
        and not coalesce(v.parcelinha, false)
        and v.data_venda between a.inicio and a.fim
    ), '[]'::jsonb)
  );
end;
$function$;
grant execute on function public.aposta_atual() to authenticated;

notify pgrst, 'reload schema';

-- (aplicado em 04/11) bolsa da luta
alter table public.apostas add column if not exists premio_detalhe text;
update public.apostas set premio = 'R$ 1.000 para a vencedora',
  premio_detalhe = 'Quem perder paga R$ 500 para a outra e a Infinity paga mais R$ 500 para a vencedora' where id = 1;
