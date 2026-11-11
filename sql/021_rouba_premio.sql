-- 021 — Aba "Rouba prêmio": metas a bater; quem bate escolhe um prêmio da banca ou "rouba" de outra pessoa.
-- Todo login vê; só o Railton edita (riscar meta, escolher prêmio, desfazer, trocar fotos).
-- As mudanças passam pelas funções rp_bater / rp_desfazer (atômicas, com histórico em rp_eventos).

create or replace function private.rp_editor()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'profissionalrailton@gmail.com';
$$;
grant execute on function private.rp_editor() to authenticated;

create table if not exists public.rp_metas (
  numero int primary key,
  titulo text not null,
  batida_por text,            -- nome igual ao de administrativo_vendedores
  batida_em timestamptz
);
create table if not exists public.rp_premios (
  id serial primary key,
  ordem int not null,
  nome text not null,
  emoji text not null default '🎁',
  dono text,                  -- null = está na banca
  vezes_roubado int not null default 0
);
create table if not exists public.rp_fotos (
  vendedor text primary key,
  foto_url text not null,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.rp_eventos (
  id bigserial primary key,
  meta int not null references public.rp_metas(numero),
  vendedor text not null,
  premio_id int not null references public.rp_premios(id),
  de_dono text,               -- null = pegou da banca; senão, de quem roubou
  em timestamptz not null default now()
);

alter table public.rp_metas enable row level security;
alter table public.rp_premios enable row level security;
alter table public.rp_fotos enable row level security;
alter table public.rp_eventos enable row level security;
create policy "rp: todos leem" on public.rp_metas for select to authenticated using (true);
create policy "rp: todos leem" on public.rp_premios for select to authenticated using (true);
create policy "rp: todos leem" on public.rp_fotos for select to authenticated using (true);
create policy "rp: todos leem" on public.rp_eventos for select to authenticated using (true);
create policy "rp: editor grava fotos" on public.rp_fotos for all to authenticated
  using (private.rp_editor()) with check (private.rp_editor());
grant select on public.rp_metas, public.rp_premios, public.rp_eventos to authenticated;
grant select, insert, update, delete on public.rp_fotos to authenticated;

-- fotos dos participantes (bucket público; só o editor grava)
insert into storage.buckets (id, name, public) values ('rouba-premio', 'rouba-premio', true) on conflict (id) do nothing;
create policy "rouba-premio: leitura" on storage.objects for select to authenticated using (bucket_id = 'rouba-premio');
create policy "rouba-premio: editor grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'rouba-premio' and private.rp_editor());
create policy "rouba-premio: editor troca" on storage.objects for update to authenticated
  using (bucket_id = 'rouba-premio' and private.rp_editor());
create policy "rouba-premio: editor apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'rouba-premio' and private.rp_editor());

-- bater meta: risca a meta e passa o prêmio escolhido (da banca ou de outra pessoa) para quem bateu
create or replace function public.rp_bater(p_meta int, p_vendedor text, p_premio int)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_dono text; v_batida text;
begin
  if not private.rp_editor() then raise exception 'Só o Railton pode marcar metas.'; end if;
  select batida_por into v_batida from rp_metas where numero = p_meta for update;
  if not found then raise exception 'Meta % não existe.', p_meta; end if;
  if v_batida is not null then raise exception 'Essa meta já foi batida por %.', v_batida; end if;
  if not exists (select 1 from administrativo_vendedores where nome = p_vendedor) then
    raise exception 'Vendedor % não encontrado.', p_vendedor; end if;
  select dono into v_dono from rp_premios where id = p_premio for update;
  if not found then raise exception 'Prêmio não encontrado.'; end if;
  if v_dono = p_vendedor then raise exception 'Esse prêmio já é de %.', p_vendedor; end if;
  update rp_metas set batida_por = p_vendedor, batida_em = now() where numero = p_meta;
  update rp_premios set dono = p_vendedor, vezes_roubado = vezes_roubado + (case when v_dono is null then 0 else 1 end) where id = p_premio;
  insert into rp_eventos (meta, vendedor, premio_id, de_dono) values (p_meta, p_vendedor, p_premio, v_dono);
end $$;
grant execute on function public.rp_bater(int, text, int) to authenticated;

-- desfazer a última jogada (devolve o prêmio a quem tinha e "desrisca" a meta)
create or replace function public.rp_desfazer()
returns void language plpgsql security definer set search_path to 'public' as $$
declare e rp_eventos;
begin
  if not private.rp_editor() then raise exception 'Só o Railton pode desfazer.'; end if;
  select * into e from rp_eventos order by id desc limit 1 for update;
  if not found then raise exception 'Nenhuma jogada para desfazer.'; end if;
  update rp_premios set dono = e.de_dono, vezes_roubado = greatest(0, vezes_roubado - (case when e.de_dono is null then 0 else 1 end)) where id = e.premio_id;
  update rp_metas set batida_por = null, batida_em = null where numero = e.meta;
  delete from rp_eventos where id = e.id;
end $$;
grant execute on function public.rp_desfazer() to authenticated;

insert into public.rp_metas (numero, titulo) values
 (1,'VENDA ONLINE'),(2,'VENDA DE CAMINHÃO'),(3,'VENDA DE IMÓVEL'),(4,'VENDA EXTERNA'),(5,'VENDA PARCELINHA'),
 (6,'FAZER 3 VENDAS'),(7,'ATINGIR 200 MIL'),(8,'ATINGIR 500 MIL'),(9,'ATINGIR 1 MILHÃO'),(10,'VENDA ACIMA DE 200 MIL'),
 (11,'VENDA NA ÂNCORA'),(12,'FAZER 2 VENDAS DE IMÓVEL'),(13,'FAZER 2 VENDAS NO DIA'),(14,'VENDA NA ÂNCORA COM CARÊNCIA'),(15,'FAZER 3 VENDAS NA SEMANA'),
 (16,'ATINGIR 400 MIL'),(17,'FAZER VENDA ACIMA DE 300 MIL'),(18,'VENDA DE MÁQUINA'),(19,'VENDA DE CRÉDITO RURAL'),(20,'VENDA DE IMPACTO'),
 (21,'VENDA EM 3 DIAS CONSECUTIVOS'),(22,'VENDA ONLINE'),(23,'FAZER 3 VENDAS'),(24,'ATINGIR 500 MIL'),(25,'VENDA DE CAMINHÃO'),
 (26,'VENDA ACIMA DE 200 MIL'),(27,'FAZER 2 VENDAS NO DIA'),(28,'VENDA NA ÂNCORA'),(29,'ATINGIR 200 MIL'),(30,'VENDA EXTERNA'),
 (31,'FAZER 2 VENDAS DE IMÓVEL'),(32,'VENDA DE MÁQUINA'),(33,'ATINGIR 400 MIL'),(34,'VENDA PARCELINHA'),(35,'VENDA NA ÂNCORA COM CARÊNCIA'),
 (36,'FAZER 3 VENDAS NA SEMANA'),(37,'VENDA DE CRÉDITO RURAL'),(38,'ATINGIR 1 MILHÃO'),(39,'VENDA DE IMPACTO'),(40,'FAZER VENDA ACIMA DE 300 MIL'),
 (41,'VENDA EM 3 DIAS CONSECUTIVOS'),(42,'VENDA ONLINE'),(43,'FAZER 2 VENDAS NO DIA'),(44,'VENDA DE CAMINHÃO'),(45,'ATINGIR 500 MIL'),
 (46,'VENDA NA ÂNCORA'),(47,'FAZER 3 VENDAS'),(48,'VENDA EXTERNA'),(49,'VENDA DE IMÓVEL'),(50,'VENDA PARCELINHA')
on conflict (numero) do nothing;

insert into public.rp_premios (ordem, nome, emoji) values
 (1,'Rodízio Lapiazza','🍕'),(2,'Corte de cabelo','💈'),(3,'Manicure e pedicure','💅'),(4,'Gravata','👔'),
 (5,'Caixa de chocolate','🍫'),(6,'Camisa social','👕'),(7,'Salto social','👠'),(8,'Pix de R$ 50,00','💸'),
 (9,'Pix de R$ 100,00','💸'),(10,'Pix de R$ 20,00','💸'),(11,'Pix de R$ 300,00','💰'),(12,'Pix de R$ 50,00','💸');
