-- 039: documentação casa com venda lançada até 7 dias ANTES da data da documentação
-- (caso JOSE VALDERI LEITE NOBRE: doc 24/11, venda cadastrada com data 23/11).
CREATE OR REPLACE FUNCTION public.doc_documentacoes(p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id bigint, vendedor text, cliente text, em timestamp with time zone, origem text, vinculado_em timestamp with time zone, telefone text, email text, cidade text, estado text, tipo text, valor numeric, venda_id uuid, venda_cliente text, venda_data date, venda_valor numeric, dias integer, negocio_id text, ja_contado_para text[], previsao date, desistiu boolean, previsao_em timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not private.doc_gestor() then raise exception 'Só a gestão vê as documentações.'; end if;
  return query
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
      and v.data_venda >= (d.em at time zone 'America/Fortaleza')::date - 7  -- tolerância: administrativo às vezes lança a venda com data anterior à documentação
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
  where p_desde is null or d.em >= p_desde
  order by d.em desc;
end $function$

;
