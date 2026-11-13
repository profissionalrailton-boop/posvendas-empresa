-- 025 — Meus atendimentos (Fase 1): o vendedor grava (ou envia o arquivo de) um ATENDIMENTO ou FECHAMENTO.
-- Fase 1 = gravar/enviar e guardar; a análise comercial (n8n) e a cópia para a auditoria (analises_fechamento)
-- entram na Fase 2 usando as colunas analise/nota/auditoria_id.
--
-- Áudio no bucket privado "atendimentos", em pedaços: {auth.uid}/{gravacao_id}/{segmento}-{parte}.{ext}
--   gravação ao vivo: cada segmento é um arquivo contínuo (pedaços concatenados na ordem = arquivo válido);
--   um novo segmento começa quando a gravação é retomada depois de interrompida.
--   arquivo enviado: segmento 1, pedaços binários do arquivo original (concatenar = arquivo original).
-- canais = 'vendedor_esq_cliente_dir' quando a chamada foi gravada no computador (microfone à esquerda, áudio
-- da chamada à direita) — ajuda a separar as vozes na transcrição.
--
-- Quem vê: o próprio vendedor; o supervisor, a equipe dele; a diretoria (allowed_users), tudo.
-- Escrita só pelas funções abaixo (o vendedor não altera status/nota/análise).

create table if not exists public.atendimentos_gravacoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  vendedor text not null,
  equipe text,
  cliente text,
  tipo text check (tipo in ('atendimento', 'fechamento')),
  resultado text check (resultado in ('documentacao', 'sem_documentacao', 'vendeu', 'nao_fechou')),
  origem text not null check (origem in ('gravacao', 'arquivo')),
  mime text,
  extensao text,
  canais text,
  arquivo_nome text,
  pasta text, -- {auth.uid}/{id}: pasta dos pedaços no bucket "atendimentos"
  segmentos int not null default 0,
  partes int not null default 0,
  tamanho_bytes bigint not null default 0,
  duracao_seg int,
  status text not null default 'gravando' check (status in ('gravando', 'aguardando', 'processando', 'pronta', 'erro')),
  enviado_em timestamptz,
  -- Fase 2
  transcricao jsonb,
  analise jsonb,
  nota numeric(4, 1),
  erro text,
  analisado_em timestamptz,
  auditoria_id uuid,
  constraint atd_resultado_do_tipo check (
    resultado is null
    or (tipo = 'atendimento' and resultado in ('documentacao', 'sem_documentacao'))
    or (tipo = 'fechamento' and resultado in ('vendeu', 'nao_fechou')))
);
create index if not exists atendimentos_gravacoes_vendedor_idx on public.atendimentos_gravacoes (vendedor, criado_em desc);
create index if not exists atendimentos_gravacoes_status_idx on public.atendimentos_gravacoes (status);

alter table public.atendimentos_gravacoes enable row level security;
drop policy if exists "atd: quem pode ver" on public.atendimentos_gravacoes;
create policy "atd: quem pode ver" on public.atendimentos_gravacoes for select to authenticated using (
  vendedor = private.vendedor_logado()
  or (equipe is not null and equipe = private.supervisor_equipe())
  or private.is_allowed_user()
);
grant select on public.atendimentos_gravacoes to authenticated;

-- dono da gravação (o vendedor logado), com a linha travada
create or replace function private.atd_minha(p_id uuid)
returns public.atendimentos_gravacoes language plpgsql security definer set search_path to 'public' as $$
declare g public.atendimentos_gravacoes;
begin
  select * into g from atendimentos_gravacoes where id = p_id for update;
  if not found then raise exception 'Gravação não encontrada.'; end if;
  if g.vendedor is distinct from private.vendedor_logado() then raise exception 'Essa gravação não é sua.'; end if;
  return g;
end $$;

-- começa uma gravação (ou o envio de um arquivo) do vendedor logado
create or replace function public.atd_criar(p_origem text, p_mime text default null, p_extensao text default null,
  p_canais text default null, p_arquivo_nome text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v text := private.vendedor_logado(); v_id uuid := gen_random_uuid();
begin
  if v is null then raise exception 'Seu login não está ligado a um vendedor.'; end if;
  insert into atendimentos_gravacoes (id, pasta, vendedor, equipe, origem, mime, extensao, canais, arquivo_nome)
  values (v_id, auth.uid()::text || '/' || v_id::text, v, private.equipe_na_data(v, current_date), p_origem,
          left(p_mime, 120), left(p_extensao, 10), left(p_canais, 40), left(p_arquivo_nome, 200));
  return v_id;
end $$;

-- progresso do envio (chamado a cada pedaço enviado), só enquanto não terminou
create or replace function public.atd_progresso(p_id uuid, p_segmentos int, p_partes int, p_tamanho bigint, p_duracao int default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare g public.atendimentos_gravacoes := private.atd_minha(p_id);
begin
  if g.status not in ('gravando', 'aguardando') then raise exception 'Essa gravação já foi para análise.'; end if;
  update atendimentos_gravacoes set segmentos = greatest(segmentos, p_segmentos), partes = greatest(partes, p_partes),
    tamanho_bytes = greatest(tamanho_bytes, p_tamanho), duracao_seg = coalesce(p_duracao, duracao_seg), atualizado_em = now()
  where id = p_id;
end $$;

-- finaliza (ou corrige, enquanto aguarda análise) cliente, tipo e resultado
create or replace function public.atd_finalizar(p_id uuid, p_cliente text, p_tipo text, p_resultado text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare g public.atendimentos_gravacoes := private.atd_minha(p_id);
begin
  if g.status not in ('gravando', 'aguardando') then raise exception 'Essa gravação já foi para análise e não pode mais ser alterada.'; end if;
  if coalesce(trim(p_cliente), '') = '' then raise exception 'Informe o nome do cliente.'; end if;
  if p_tipo not in ('atendimento', 'fechamento') then raise exception 'Escolha se foi atendimento ou fechamento.'; end if;
  if not ((p_tipo = 'atendimento' and p_resultado in ('documentacao', 'sem_documentacao'))
       or (p_tipo = 'fechamento' and p_resultado in ('vendeu', 'nao_fechou'))) then
    raise exception 'Escolha o resultado.'; end if;
  if g.partes < 1 then raise exception 'O áudio ainda não foi enviado.'; end if;
  update atendimentos_gravacoes set cliente = left(trim(p_cliente), 120), tipo = p_tipo, resultado = p_resultado,
    status = 'aguardando', enviado_em = coalesce(enviado_em, now()), atualizado_em = now()
  where id = p_id;
end $$;

-- descarta uma gravação que ainda não foi para análise (os arquivos são apagados pela tela antes)
create or replace function public.atd_descartar(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare g public.atendimentos_gravacoes := private.atd_minha(p_id);
begin
  if g.status not in ('gravando', 'aguardando') then raise exception 'Essa gravação já foi para análise.'; end if;
  delete from atendimentos_gravacoes where id = p_id;
end $$;

revoke all on function private.atd_minha(uuid) from public;
grant execute on function public.atd_criar(text, text, text, text, text) to authenticated;
grant execute on function public.atd_progresso(uuid, int, int, bigint, int) to authenticated;
grant execute on function public.atd_finalizar(uuid, text, text, text) to authenticated;
grant execute on function public.atd_descartar(uuid) to authenticated;

-- bucket privado; pedaços de até 10 MB
insert into storage.buckets (id, name, public, file_size_limit) values ('atendimentos', 'atendimentos', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "atendimentos: ver" on storage.objects;
drop policy if exists "atendimentos: enviar" on storage.objects;
drop policy if exists "atendimentos: reenviar" on storage.objects;
drop policy if exists "atendimentos: apagar" on storage.objects;
-- ouvir: quem pode ver a linha da gravação (a RLS da tabela vale dentro do exists)
create policy "atendimentos: ver" on storage.objects for select to authenticated using (
  bucket_id = 'atendimentos'
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]));
-- enviar/reenviar/apagar: só o dono, na pasta do próprio login, enquanto não foi para análise
create policy "atendimentos: enviar" on storage.objects for insert to authenticated with check (
  bucket_id = 'atendimentos' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]
              and g.vendedor = private.vendedor_logado() and g.status in ('gravando', 'aguardando')));
create policy "atendimentos: reenviar" on storage.objects for update to authenticated using (
  bucket_id = 'atendimentos' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]
              and g.vendedor = private.vendedor_logado() and g.status in ('gravando', 'aguardando')));
create policy "atendimentos: apagar" on storage.objects for delete to authenticated using (
  bucket_id = 'atendimentos' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]
              and g.vendedor = private.vendedor_logado() and g.status in ('gravando', 'aguardando')));

-- lista ao vivo (status muda quando o n8n analisar, na Fase 2)
do $$ begin
  alter publication supabase_realtime add table public.atendimentos_gravacoes;
exception when duplicate_object then null; end $$;
