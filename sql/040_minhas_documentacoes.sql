-- 040: o vendedor vê as PRÓPRIAS documentações (Negócios › Minhas documentações) e marca a previsão de fechamento delas.
-- A lista (com o cruzamento com as vendas do administrativo) vira private.doc_lista; a gestão continua usando
-- doc_documentacoes (todas) e o vendedor usa doc_minhas_documentacoes (só as dele, pelo e-mail → vendedor).

create or replace function private.doc_lista(p_desde timestamptz, p_vendedor text)
returns table(id bigint, vendedor text, cliente text, em timestamptz, origem text, vinculado_em timestamptz, telefone text,
  email text, cidade text, estado text, tipo text, valor numeric, venda_id uuid, venda_cliente text, venda_data date,
  venda_valor numeric, dias integer, negocio_id text, ja_contado_para text[], previsao date, desistiu boolean, previsao_em timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select d.id, d.vendedor, d.cliente, d.em, d.origem, d.vinculado_em,
         x.telefone, x.email, x.cidade, x.estado, x.tipo, x.valor,
         m.id, m.cliente, m.data_venda, m.valor_venda,
         case when m.id is null then null else greatest(0, m.data_venda - (d.em at time zone 'America/Fortaleza')::date) end,
         d.negocio_id,
         case when d.negocio_id is null then null else
           array(select o.vendedor from doc_corrida o where o.negocio_id = d.negocio_id and o.id <> d.id and o.vendedor is not null order by o.em) end,
         d.previsao, d.desistiu, d.previsao_em
  from doc_corrida d
  left join doc_corrida_detalhes x on x.doc_id = d.id
  left join lateral (
    select v.id, v.cliente, v.data_venda, v.valor_venda
    from administrativo_vendas v
    where d.vendedor is not null and v.vendedor = d.vendedor
      and v.data_venda >= (d.em at time zone 'America/Fortaleza')::date - 7  -- tolerância: venda lançada com data anterior à documentação
      and (
        (length(private.doc_digitos(x.telefone)) >= 8 and right(private.doc_digitos(v.numero_contato), 8) = right(private.doc_digitos(x.telefone), 8))
        or (length(private.doc_nome(d.cliente)) >= 5 and (
              private.doc_nome(v.cliente) = private.doc_nome(d.cliente)
           or private.doc_nome(v.cliente) like private.doc_nome(d.cliente) || ' %'
           or private.doc_nome(d.cliente) like private.doc_nome(v.cliente) || ' %'))
      )
    order by (v.data_venda < (d.em at time zone 'America/Fortaleza')::date), v.data_venda, v.created_at
    limit 1
  ) m on true
  where (p_desde is null or d.em >= p_desde)
    and (p_vendedor is null or d.vendedor = p_vendedor)
  order by d.em desc
$$;
revoke all on function private.doc_lista(timestamptz, text) from public, anon, authenticated;

create or replace function public.doc_documentacoes(p_desde timestamptz default null)
returns table(id bigint, vendedor text, cliente text, em timestamptz, origem text, vinculado_em timestamptz, telefone text,
  email text, cidade text, estado text, tipo text, valor numeric, venda_id uuid, venda_cliente text, venda_data date,
  venda_valor numeric, dias integer, negocio_id text, ja_contado_para text[], previsao date, desistiu boolean, previsao_em timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão vê as documentações.'; end if;
  return query select * from private.doc_lista(p_desde, null);
end $$;

create or replace function public.doc_minhas_documentacoes()
returns table(id bigint, vendedor text, cliente text, em timestamptz, origem text, vinculado_em timestamptz, telefone text,
  email text, cidade text, estado text, tipo text, valor numeric, venda_id uuid, venda_cliente text, venda_data date,
  venda_valor numeric, dias integer, negocio_id text, ja_contado_para text[], previsao date, desistiu boolean, previsao_em timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v text := private.vendedor_logado();
begin
  if v is null then raise exception 'Seu e-mail não está ligado a um vendedor.'; end if;
  return query select * from private.doc_lista(null, v);
end $$;
revoke all on function public.doc_minhas_documentacoes() from public, anon;
grant execute on function public.doc_minhas_documentacoes() to authenticated;

-- previsão: gestão em qualquer documentação; vendedor só nas dele
create or replace function public.doc_previsao(p_id bigint, p_data date, p_desistiu boolean default false)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not private.doc_gestor()
     and not exists (select 1 from doc_corrida where id = p_id and vendedor is not null and vendedor = private.vendedor_logado()) then
    raise exception 'Você só pode marcar a previsão das suas documentações.';
  end if;
  update doc_corrida
     set previsao = case when coalesce(p_desistiu, false) then null else p_data end,
         desistiu = coalesce(p_desistiu, false),
         previsao_em = case when p_data is null and not coalesce(p_desistiu, false) then null else now() end,
         previsao_por = case when p_data is null and not coalesce(p_desistiu, false) then null else lower(coalesce(auth.jwt() ->> 'email', '')) end
   where id = p_id;
  if not found then raise exception 'Documentação não encontrada.'; end if;
end $$;
