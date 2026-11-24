-- 036: documentação do CRM já chega com o proprietário (vendedor) do negócio.
-- O campo "proprietario" do JSON pode vir como ID do CRM (ex.: 1434) ou como nome (ex.: "Lucas Gomes").
-- Se for reconhecido, o registro entra já vinculado ao vendedor (a corrida anda na hora).
-- Se não vier / não for reconhecido, continua entrando como "Aguardando vendedor" (vínculo manual).
-- Registros que já estão aguardando vendedor NÃO são alterados.

create table if not exists public.doc_crm_proprietarios (
  crm_id   integer primary key,
  vendedor text not null
);
alter table public.doc_crm_proprietarios enable row level security;
revoke all on public.doc_crm_proprietarios from anon, authenticated;
drop policy if exists doc_crm_prop_ler on public.doc_crm_proprietarios;
create policy doc_crm_prop_ler on public.doc_crm_proprietarios for select to authenticated using (private.doc_gestor());
grant select on public.doc_crm_proprietarios to authenticated;

insert into public.doc_crm_proprietarios (crm_id, vendedor) values
  (81,   'Ana Carolina'),
  (87,   'Iago Luis'),
  (90,   'Lucas Gomes'),
  (92,   'Matheus Araújo'),
  (94,   'Tatielly David'),
  (97,   'Yarine Santos'),
  (399,  'Inigly Silva'),
  (564,  'Reynaldo Galdino'),
  (865,  'Cibelly Almeida'),
  (1434, 'Walisson Souza'),
  (1435, 'Diego Ferreira'),
  (1766, 'Sislândia Oliveira')
on conflict (crm_id) do update set vendedor = excluded.vendedor;

-- Resolve o proprietário (ID ou nome) para o nome do vendedor cadastrado. Null se não reconhecer.
create or replace function private.doc_proprietario(p_valor text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text := nullif(trim(coalesce(p_valor, '')), '');
  r text;
begin
  if v is null then return null; end if;
  if v ~ '^\d+$' then
    select vendedor into r from doc_crm_proprietarios where crm_id = v::integer;
    return r;
  end if;
  -- nome completo igual ao cadastro (sem acento / maiúsculas)
  select nome into r from administrativo_vendedores
   where ativo is not false and private.doc_nome(nome) = private.doc_nome(v) limit 1;
  if found then return r; end if;
  -- nome do mapa do CRM igual (ex.: "Reynaldo" escrito diferente cai aqui só se igual)
  select m.vendedor into r from doc_crm_proprietarios m where private.doc_nome(m.vendedor) = private.doc_nome(v) limit 1;
  if found then return r; end if;
  -- só o primeiro nome, se for único entre os ativos
  select min(nome) into r from administrativo_vendedores
   where ativo is not false and split_part(private.doc_nome(nome), ' ', 1) = split_part(private.doc_nome(v), ' ', 1)
  having count(*) = 1;
  return r;
end $$;

create or replace function public.doc_n8n_receber(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_neg text := nullif(trim(coalesce(p ->> 'id_negocio', p -> '_meta' ->> 'negocioId', p ->> 'negocio_id', p ->> 'id', p ->> 'deal_id', p ->> 'uuid', '')), '');
  v_tel text := nullif(trim(coalesce(p ->> 'telefone', p ->> 'phone', '')), '');
  v_tipo text := nullif(trim(coalesce(p ->> 'tipo_bem', p ->> 'tipo', '')), '');
  v_valor_txt text := trim(coalesce(p ->> 'valor_bem', p ->> 'valor', ''));
  v_vend text := private.doc_proprietario(coalesce(p ->> 'proprietario', p ->> 'id_proprietario', p ->> 'proprietario_id'));
  v_id bigint;
  v_valor numeric;
begin
  if coalesce((p -> '_meta' ->> 'integrationPreview')::boolean, false) then
    return jsonb_build_object('ok', true, 'teste', true);
  end if;
  -- Mesmo negócio ainda esperando vendedor: não duplica (e não mexe nele).
  -- Mesmo negócio já contado para o mesmo vendedor: não conta de novo.
  if v_neg is not null then
    select id into v_id from doc_corrida
     where negocio_id = v_neg and (vendedor is null or vendedor = v_vend) limit 1;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'id', v_id); end if;
  elsif length(private.doc_digitos(v_tel)) >= 8 then
    select d.id into v_id from doc_corrida d join doc_corrida_detalhes x on x.doc_id = d.id
     where (d.vendedor is null or d.vendedor = v_vend)
       and right(private.doc_digitos(x.telefone), 8) = right(private.doc_digitos(v_tel), 8) and d.em > now() - interval '12 hours'
     limit 1;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'id', v_id); end if;
  end if;
  begin
    if v_valor_txt ~ '^\d+(\.\d+)?$' then v_valor := v_valor_txt::numeric;
    else v_valor := nullif(replace(replace(regexp_replace(v_valor_txt, '[^0-9,.]', '', 'g'), '.', ''), ',', '.'), '')::numeric;
    end if;
  exception when others then v_valor := null; end;
  insert into doc_corrida (vendedor, cliente, em, origem, negocio_id, criado_por, vinculado_em, vinculado_por)
  values (v_vend, nullif(trim(coalesce(p ->> 'cliente', p ->> 'nome', '')), ''), now(), 'crm', v_neg, 'crm',
          case when v_vend is not null then now() end, case when v_vend is not null then 'crm' end)
  returning id into v_id;
  insert into doc_corrida_detalhes (doc_id, telefone, email, cidade, estado, tipo, valor, payload)
  values (v_id, v_tel, nullif(trim(coalesce(p ->> 'email', '')), ''), nullif(trim(coalesce(p ->> 'cidade', '')), ''),
          nullif(trim(coalesce(p ->> 'estado', '')), ''), v_tipo, v_valor, p);
  return jsonb_build_object('ok', true, 'repetido', false, 'id', v_id, 'vendedor', v_vend);
end $function$;
