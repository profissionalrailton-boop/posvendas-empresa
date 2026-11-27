-- 044: leads novos das automações do n8n (SDR Atlas, Follow-up, SDR Instagram, Formulário) caem direto no Pipeline,
-- no lugar do Convex. O vendedor é escolhido em rodízio por tipo do bem (pipe_distribuicao), só entre os liberados.
-- Telefone que já tem card aberto não vira card novo: entra comentário + etiquetas no card existente
-- (se estava na Reciclagem, volta para Oportunidade com o mesmo vendedor).

create table if not exists public.pipe_distribuicao (
  tipo text not null check (tipo in ('Imóvel','Automóvel','Moto','Pesados','Outro')),
  vendedor text not null,
  primary key (tipo, vendedor)
);
create table if not exists public.pipe_dist_vez (
  tipo text primary key,
  ultimo text,
  em timestamptz not null default now()
);
alter table public.pipe_distribuicao enable row level security;
alter table public.pipe_dist_vez enable row level security;
drop policy if exists "pipe dono" on public.pipe_distribuicao;
create policy "pipe dono" on public.pipe_distribuicao for all to authenticated using (private.pipe_acesso()) with check (private.pipe_acesso());
drop policy if exists "pipe dono" on public.pipe_dist_vez;
create policy "pipe dono" on public.pipe_dist_vez for select to authenticated using (private.pipe_acesso());
revoke all on public.pipe_distribuicao, public.pipe_dist_vez from anon;
grant select, insert, delete on public.pipe_distribuicao to authenticated;
grant select on public.pipe_dist_vez to authenticated;

-- começa com todos os liberados em todos os tipos (o dono ajusta na tela Distribuição)
insert into public.pipe_distribuicao (tipo, vendedor)
select t, l.vendedor from public.pipe_liberados l, unnest(array['Imóvel','Automóvel','Moto','Pesados','Outro']) t
on conflict do nothing;

create or replace function private.pipe_tipo_bem(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when upper(p) in ('CARRO','AUTOMOVEL','AUTOMÓVEL','AUTO') then 'Automóvel'
    when upper(p) in ('MOTO','MOTOCICLETA') then 'Moto'
    when upper(p) in ('IMOVEL','IMÓVEL','TERRENO','CASA') then 'Imóvel'
    when upper(p) in ('CAMINHAO','CAMINHÃO','MAQUINA','MÁQUINA','MAQUINARIO','MAQUINÁRIO','PESADOS') then 'Pesados'
    else 'Outro' end
$$;

-- próximo vendedor do rodízio de um tipo (trava a linha da vez para dois leads ao mesmo tempo não caírem no mesmo)
create or replace function private.pipe_proximo_vendedor(p_tipo text)
returns text language plpgsql security definer set search_path to 'public'
as $$
declare lista text[]; ult text; pos int; escolhido text;
begin
  insert into pipe_dist_vez (tipo) values (coalesce(p_tipo, 'Outro')) on conflict do nothing;
  select ultimo into ult from pipe_dist_vez where tipo = coalesce(p_tipo, 'Outro') for update;
  select array_agg(d.vendedor order by d.vendedor) into lista
    from pipe_distribuicao d join pipe_liberados l on l.vendedor = d.vendedor
   where d.tipo = coalesce(p_tipo, 'Outro');
  if lista is null then
    select array_agg(vendedor order by vendedor) into lista from pipe_liberados;
  end if;
  if lista is null then return null; end if;
  pos := coalesce(array_position(lista, ult), 0);
  escolhido := lista[(pos % array_length(lista, 1)) + 1];
  update pipe_dist_vez set ultimo = escolhido, em = now() where tipo = coalesce(p_tipo, 'Outro');
  return escolhido;
end $$;

-- chamado pelo n8n (credencial SUPABASE_VPS = service_role)
-- p: { nome, telefone, tipo, comentarios, tags ("A, B"), origem, lead_id, extras {chave: valor} }
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
    values (coalesce(v_nome, 'Sem nome'), v_tel, v_tipo, private.pipe_proximo_vendedor(coalesce(v_tipo, 'Outro')), 'oportunidade',
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
