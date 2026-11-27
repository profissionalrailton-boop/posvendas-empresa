-- 045: rodízio separa Caminhão e Máquina (no card os dois continuam como "Pesados").
-- Moto segue a lista de Carro (no SDR, moto sempre foi pela integração de carro do Convex).

alter table public.pipe_distribuicao drop constraint if exists pipe_distribuicao_tipo_check;
delete from public.pipe_distribuicao;
delete from public.pipe_dist_vez;
alter table public.pipe_distribuicao add constraint pipe_distribuicao_tipo_check
  check (tipo in ('Imóvel','Automóvel','Moto','Caminhão','Máquina','Outro'));

-- chave do rodízio a partir do tipo que vem do n8n
create or replace function private.pipe_tipo_dist(p text)
returns text language sql immutable as $$
  select case
    when upper(coalesce(p, '')) in ('CAMINHAO','CAMINHÃO') then 'Caminhão'
    when upper(coalesce(p, '')) in ('MAQUINA','MÁQUINA','MAQUINARIO','MAQUINÁRIO') then 'Máquina'
    else coalesce(private.pipe_tipo_bem(p), 'Outro') end
$$;

insert into public.pipe_distribuicao (tipo, vendedor) values
  ('Imóvel','Reynaldo Galdino'), ('Imóvel','Cibelly Almeida'), ('Imóvel','Yarine Santos'), ('Imóvel','Lucas Gomes'),
  ('Imóvel','Ana Carolina'), ('Imóvel','Diego Ferreira'), ('Imóvel','Walisson Souza'), ('Imóvel','Sislândia Oliveira'),
  ('Automóvel','Reynaldo Galdino'), ('Automóvel','Lucas Gomes'), ('Automóvel','Inigly Silva'), ('Automóvel','Diego Ferreira'),
  ('Automóvel','Cibelly Almeida'), ('Automóvel','Iago Luis'), ('Automóvel','Yarine Santos'), ('Automóvel','Walisson Souza'),
  ('Automóvel','Matheus Araújo'), ('Automóvel','Sislândia Oliveira'), ('Automóvel','Ana Carolina'),
  ('Caminhão','Iago Luis'), ('Caminhão','Matheus Araújo'), ('Caminhão','Tatielly David'),
  ('Máquina','Iago Luis'), ('Máquina','Matheus Araújo');
insert into public.pipe_distribuicao (tipo, vendedor) select 'Moto', vendedor from public.pipe_distribuicao where tipo = 'Automóvel';

-- pipe_n8n_lead passa a sortear pela chave do rodízio (Caminhão / Máquina separados)
create or replace function public.pipe_n8n_lead(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_nome text := nullif(btrim(coalesce(p->>'nome', '')), '');
  v_tel text := nullif(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g'), '');
  v_tipo text := private.pipe_tipo_bem(p->>'tipo');
  v_coment text := nullif(btrim(coalesce(p->>'comentarios', '')), '');
  v_autor text := coalesce(nullif(p->>'autor', ''), 'SDR Atlas 🤖');
  v_card pipe_cards;
  v_novo boolean := false;
  v_extras text;
begin
  if v_tel is null and v_nome is null then raise exception 'Lead sem nome e sem telefone.'; end if;
  -- telefone com 55 na frente: guarda sem o 55
  if v_tel ~ '^55\d{10,11}$' then v_tel := substr(v_tel, 3); end if;

  select string_agg(initcap(replace(k, '_', ' ')) || ': ' || v, ' · ') into v_extras
    from jsonb_each_text(coalesce(p->'extras', '{}'::jsonb)) e(k, v) where nullif(btrim(v), '') is not null;

  if v_tel is not null and length(v_tel) >= 8 then
    select * into v_card from pipe_cards c
     where c.etapa <> 'fechado' and right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) = right(v_tel, 8)
     order by c.criado_em desc limit 1;
  end if;

  if v_card.id is null then
    insert into pipe_cards (nome, telefone, tipo_bem, vendedor, etapa, origem, criado_por, crm_id)
    values (coalesce(v_nome, 'Sem nome'), v_tel, v_tipo, private.pipe_proximo_vendedor(private.pipe_tipo_dist(p->>'tipo')), 'oportunidade',
            nullif(p->>'origem', ''), 'n8n', nullif(p->>'lead_id', ''))
    on conflict (crm_id) where crm_id is not null do nothing
    returning * into v_card;
    if v_card.id is null then
      select * into v_card from pipe_cards where crm_id = p->>'lead_id';
    else
      v_novo := true;
    end if;
  else
    update pipe_cards set
      etapa = case when etapa = 'reciclagem' then 'oportunidade' else etapa end,
      posicao = case when etapa = 'reciclagem' then extract(epoch from now()) else posicao end,
      tipo_bem = coalesce(tipo_bem, v_tipo),
      nome = case when nome in ('Sem nome', '.', '') and v_nome is not null then v_nome else nome end,
      atividade_em = now()
    where id = v_card.id returning * into v_card;
  end if;

  if v_coment is not null or v_extras is not null then
    insert into pipe_comentarios (card_id, autor, texto)
    values (v_card.id, v_autor, concat_ws(E'\n', case when not v_novo then '🔁 Lead voltou a falar com o SDR.' end, v_coment, v_extras));
  end if;

  insert into pipe_etiquetas (nome, cor)
  select distinct btrim(t), '#475569' from unnest(string_to_array(coalesce(p->>'tags', ''), ',')) t
   where btrim(t) <> '' and not exists (select 1 from pipe_etiquetas e where lower(e.nome) = lower(btrim(t)))
  on conflict do nothing;
  insert into pipe_card_etiquetas (card_id, etiqueta_id)
  select v_card.id, e.id from pipe_etiquetas e
   where lower(e.nome) in (select lower(btrim(t)) from unnest(string_to_array(coalesce(p->>'tags', ''), ',')) t where btrim(t) <> '')
  on conflict do nothing;

  return jsonb_build_object('card_id', v_card.id, 'novo', v_novo, 'vendedor', v_card.vendedor, 'etapa', v_card.etapa);
end $$;
revoke all on function public.pipe_n8n_lead(jsonb) from public, anon, authenticated;
grant execute on function public.pipe_n8n_lead(jsonb) to service_role;
