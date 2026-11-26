-- 038: Previsão de fechamento por documentação (Negócios › Documentações).
-- A gestão marca a data que o vendedor prevê para o cliente fechar, ou que o cliente desistiu.
alter table public.doc_corrida
  add column if not exists previsao date,
  add column if not exists desistiu boolean not null default false,
  add column if not exists previsao_em timestamptz,
  add column if not exists previsao_por text;

create or replace function public.doc_previsao(p_id bigint, p_data date, p_desistiu boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão pode marcar a previsão.'; end if;
  update doc_corrida
     set previsao = case when coalesce(p_desistiu, false) then null else p_data end,
         desistiu = coalesce(p_desistiu, false),
         previsao_em = case when p_data is null and not coalesce(p_desistiu, false) then null else now() end,
         previsao_por = case when p_data is null and not coalesce(p_desistiu, false) then null else lower(coalesce(auth.jwt() ->> 'email', '')) end
   where id = p_id;
  if not found then raise exception 'Documentação não encontrada.'; end if;
end $$;
revoke all on function public.doc_previsao(bigint, date, boolean) from public, anon;
grant execute on function public.doc_previsao(bigint, date, boolean) to authenticated;

-- doc_documentacoes passa a devolver previsao / desistiu (muda o tipo de retorno: drop + create)
drop function if exists public.doc_documentacoes(timestamptz);
create function public.doc_documentacoes(p_desde timestamptz default null)
returns table(id bigint, vendedor text, cliente text, em timestamptz, origem text, vinculado_em timestamptz, telefone text, email text,
  cidade text, estado text, tipo text, valor numeric, venda_id uuid, venda_cliente text, venda_data date, venda_valor numeric, dias integer,
  negocio_id text, ja_contado_para text[], previsao date, desistiu boolean, previsao_em timestamptz)
language plpgsql stable security definer set search_path = public as $function$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão vê as documentações.'; end if;
  return query
  select d.id, d.vendedor, d.cliente, d.em, d.origem, d.vinculado_em,
         x.telefone, x.email, x.cidade, x.estado, x.tipo, x.valor,
         m.id, m.cliente, m.data_venda, m.valor_venda,
         case when m.id is null then null else (m.data_venda - (d.em at time zone 'America/Fortaleza')::date) end,
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
end $function$;
revoke all on function public.doc_documentacoes(timestamptz) from public, anon;
grant execute on function public.doc_documentacoes(timestamptz) to authenticated;
