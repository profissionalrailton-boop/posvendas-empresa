-- 035 — Negócios › Documentações: documentações que chegam do CRM (webhook → n8n) entram SEM vendedor.
-- A gestão vincula o vendedor na aba Documentações; só depois disso a documentação conta na corrida.
-- Os dados do cliente (telefone, e-mail, cidade, valor…) ficam numa tabela à parte, que só a gestão lê;
-- doc_corrida continua com leitura para todos (a corrida só mostra vendedor e data).
-- Tempo até o fechamento: cruza cada documentação vinculada com a primeira venda do mesmo vendedor no administrativo
-- a partir da data da documentação, pelo telefone (8 últimos dígitos) ou pelo nome do cliente.

alter table public.doc_corrida alter column vendedor drop not null;
alter table public.doc_corrida add column if not exists vinculado_em timestamptz;
alter table public.doc_corrida add column if not exists vinculado_por text;
update public.doc_corrida set vinculado_em = coalesce(vinculado_em, criado_em), vinculado_por = coalesce(vinculado_por, criado_por) where vendedor is not null;

create table if not exists public.doc_corrida_detalhes (
  doc_id bigint primary key references public.doc_corrida(id) on delete cascade,
  telefone text,
  email text,
  cidade text,
  estado text,
  tipo text,
  valor numeric,
  payload jsonb
);
alter table public.doc_corrida_detalhes enable row level security;
drop policy if exists "doc detalhes: gestão lê" on public.doc_corrida_detalhes;
create policy "doc detalhes: gestão lê" on public.doc_corrida_detalhes for select to authenticated using (private.doc_gestor());
grant select on public.doc_corrida_detalhes to authenticated;
grant select, insert, update, delete on public.doc_corrida_detalhes to service_role;

-- utilidades do cruzamento
create or replace function private.doc_digitos(t text) returns text language sql immutable as $$
  select regexp_replace(coalesce(t, ''), '\D', '', 'g');
$$;
create or replace function private.doc_nome(t text) returns text language sql immutable as $$
  select trim(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z ]+|\s+', ' ', 'g'));
$$;
grant execute on function private.doc_digitos(text), private.doc_nome(text) to authenticated, service_role;

-- n8n: recebe o JSON do CRM e cria a documentação sem vendedor
-- (mesmo negócio não entra duas vezes; sem id do negócio, o mesmo telefone em 12 h também não)
create or replace function public.doc_n8n_receber(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_neg text := nullif(trim(coalesce(p ->> 'negocio_id', p ->> 'id', p ->> 'deal_id', p ->> 'uuid', '')), '');
  v_tel text := nullif(trim(coalesce(p ->> 'telefone', p ->> 'phone', '')), '');
  v_id bigint;
  v_valor numeric;
begin
  if v_neg is not null then
    select id into v_id from doc_corrida where negocio_id = v_neg;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'id', v_id); end if;
  elsif length(private.doc_digitos(v_tel)) >= 8 then
    select d.id into v_id from doc_corrida d join doc_corrida_detalhes x on x.doc_id = d.id
     where right(private.doc_digitos(x.telefone), 8) = right(private.doc_digitos(v_tel), 8) and d.em > now() - interval '12 hours'
     limit 1;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'id', v_id); end if;
  end if;
  -- valor: "80000.00" (como o CRM manda) ou "80.000,00"
  begin
    if trim(coalesce(p ->> 'valor', '')) ~ '^\d+(\.\d+)?$' then v_valor := trim(p ->> 'valor')::numeric;
    else v_valor := nullif(replace(replace(regexp_replace(coalesce(p ->> 'valor', ''), '[^0-9,.]', '', 'g'), '.', ''), ',', '.'), '')::numeric;
    end if;
  exception when others then v_valor := null; end;
  insert into doc_corrida (vendedor, cliente, em, origem, negocio_id, criado_por)
  values (null, nullif(trim(coalesce(p ->> 'nome', p ->> 'cliente', '')), ''), now(), 'crm', v_neg, 'crm')
  returning id into v_id;
  insert into doc_corrida_detalhes (doc_id, telefone, email, cidade, estado, tipo, valor, payload)
  values (v_id, v_tel, nullif(trim(coalesce(p ->> 'email', '')), ''), nullif(trim(coalesce(p ->> 'cidade', '')), ''),
          nullif(trim(coalesce(p ->> 'estado', '')), ''), nullif(trim(coalesce(p ->> 'tipo', '')), ''), v_valor, p);
  return jsonb_build_object('ok', true, 'repetido', false, 'id', v_id);
end $$;
revoke all on function public.doc_n8n_receber(jsonb) from public, anon, authenticated;
grant execute on function public.doc_n8n_receber(jsonb) to service_role;

-- gestão: vincular / desvincular vendedor
create or replace function public.doc_vincular(p_id bigint, p_vendedor text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão pode vincular documentações.'; end if;
  if not exists (select 1 from administrativo_vendedores where nome = p_vendedor and ativo is not false) then
    raise exception 'Vendedor % não encontrado.', p_vendedor; end if;
  update doc_corrida set vendedor = p_vendedor, vinculado_em = now(), vinculado_por = lower(coalesce(auth.jwt() ->> 'email', ''))
   where id = p_id;
  if not found then raise exception 'Documentação não encontrada.'; end if;
end $$;
create or replace function public.doc_desvincular(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão pode desvincular documentações.'; end if;
  update doc_corrida set vendedor = null, vinculado_em = null, vinculado_por = null where id = p_id;
end $$;
revoke all on function public.doc_vincular(bigint, text), public.doc_desvincular(bigint) from public, anon;
grant execute on function public.doc_vincular(bigint, text), public.doc_desvincular(bigint) to authenticated;

-- lançamento manual passa a registrar o vínculo
create or replace function public.doc_lancar(p_vendedor text, p_cliente text default null, p_em timestamptz default null)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint;
begin
  if not private.doc_gestor() then raise exception 'Só a gestão pode lançar documentações.'; end if;
  if not exists (select 1 from administrativo_vendedores where nome = p_vendedor and ativo is not false) then
    raise exception 'Vendedor % não encontrado.', p_vendedor; end if;
  insert into doc_corrida (vendedor, cliente, em, vinculado_em, vinculado_por)
  values (p_vendedor, nullif(trim(p_cliente), ''), coalesce(p_em, now()), now(), lower(coalesce(auth.jwt() ->> 'email', '')))
  returning id into v_id;
  return v_id;
end $$;

-- gestão: documentações com detalhes e o fechamento encontrado no administrativo
create or replace function public.doc_documentacoes(p_desde timestamptz default null)
returns table (id bigint, vendedor text, cliente text, em timestamptz, origem text, vinculado_em timestamptz,
               telefone text, email text, cidade text, estado text, tipo text, valor numeric,
               venda_id uuid, venda_cliente text, venda_data date, venda_valor numeric, dias int)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão vê as documentações.'; end if;
  return query
  select d.id, d.vendedor, d.cliente, d.em, d.origem, d.vinculado_em,
         x.telefone, x.email, x.cidade, x.estado, x.tipo, x.valor,
         m.id, m.cliente, m.data_venda, m.valor_venda,
         case when m.id is null then null else (m.data_venda - (d.em at time zone 'America/Fortaleza')::date) end
  from doc_corrida d
  left join doc_corrida_detalhes x on x.doc_id = d.id
  left join lateral (
    select v.id, v.cliente, v.data_venda, v.valor_venda
    from administrativo_vendas v
    where d.vendedor is not null and v.vendedor = d.vendedor
      and v.data_venda >= (d.em at time zone 'America/Fortaleza')::date
      and (
        (length(private.doc_digitos(x.telefone)) >= 8 and right(private.doc_digitos(v.numero_contato), 8) = right(private.doc_digitos(x.telefone), 8))
        or (length(private.doc_nome(d.cliente)) >= 5 and (
              private.doc_nome(v.cliente) = private.doc_nome(d.cliente)
           or private.doc_nome(v.cliente) like private.doc_nome(d.cliente) || ' %'
           or private.doc_nome(d.cliente) like private.doc_nome(v.cliente) || ' %'))
      )
    order by v.data_venda, v.created_at
    limit 1
  ) m on true
  where p_desde is null or d.em >= p_desde
  order by d.em desc;
end $$;
revoke all on function public.doc_documentacoes(timestamptz) from public, anon;
grant execute on function public.doc_documentacoes(timestamptz) to authenticated;

-- TV: só documentações com vendedor
create or replace function public.doc_corrida_painel()
returns jsonb language sql stable security definer set search_path to 'public' as $$
with s as (
  select (now() at time zone 'America/Fortaleza')::date as hoje
), ini as (
  select ((hoje - extract(dow from hoje)::int)::timestamp at time zone 'America/Fortaleza') as ini from s
), lanc as (
  select c.vendedor, c.em from doc_corrida c, ini where c.vendedor is not null and c.em >= ini.ini and c.em < ini.ini + interval '7 days'
), ant as (
  select c.vendedor, count(*) as n from doc_corrida c, ini where c.vendedor is not null and c.em >= ini.ini - interval '7 days' and c.em < ini.ini group by c.vendedor
)
select jsonb_build_object(
  'agora', now(),
  'semana_ini', (select ini from ini),
  'semana_fim', (select ini + interval '7 days' from ini),
  'casas', coalesce((select casas from doc_corrida_config where id = 1), 10),
  'corredores', (select coalesce(jsonb_agg(jsonb_build_object(
      'nome', v.nome,
      'foto', (select f.foto_url from vendedor_fotos f where f.vendedor = v.nome limit 1),
      'docs', (select coalesce(jsonb_agg(l.em order by l.em), '[]'::jsonb) from lanc l where l.vendedor = v.nome))), '[]'::jsonb)
    from administrativo_vendedores v where v.ativo is not false and v.nome <> 'Railton Angelo'),
  'ultimos', (select coalesce(jsonb_agg(jsonb_build_object('nome', x.vendedor, 'em', x.em) order by x.em desc), '[]'::jsonb)
    from (select vendedor, em from lanc order by em desc limit 6) x),
  'semana_passada', (select coalesce(jsonb_agg(jsonb_build_object('nome', a.vendedor, 'n', a.n) order by a.n desc), '[]'::jsonb)
    from (select * from ant order by n desc limit 3) a)
);
$$;

-- 19/11/2026: formato real da integração do Convex CRM ({"cliente","telefone","tipo_bem","valor_bem","id_negocio","_meta"}).
-- doc_n8n_receber passou a ler cliente/tipo_bem/valor_bem/id_negocio (mantendo os nomes antigos como alternativa)
-- e a ignorar o envio de teste da tela de integração (_meta.integrationPreview = true). Versão aplicada no banco.
