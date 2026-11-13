-- 026 — Meus atendimentos: a diretoria (allowed_users) também pode gravar, como vendedor de TESTE.
-- Quem não está ligado a um vendedor mas é da diretoria grava como "Teste (<login>)" — fácil de
-- separar depois (vendedor like 'Teste (%') para não entrar nos padrões/indicadores dos vendedores.

create or replace function private.atd_vendedor()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(private.vendedor_logado(),
    case when private.is_allowed_user() then 'Teste (' || split_part(lower(auth.jwt() ->> 'email'), '@', 1) || ')' end);
$$;
revoke all on function private.atd_vendedor() from public;

-- quem eu sou nesta aba (a tela usa para mostrar os botões de gravar)
create or replace function public.atd_eu()
returns text language sql stable security definer set search_path to 'public' as $$
  select private.atd_vendedor();
$$;
grant execute on function public.atd_eu() to authenticated;

create or replace function private.atd_minha(p_id uuid)
returns public.atendimentos_gravacoes language plpgsql security definer set search_path to 'public' as $$
declare g public.atendimentos_gravacoes;
begin
  select * into g from atendimentos_gravacoes where id = p_id for update;
  if not found then raise exception 'Gravação não encontrada.'; end if;
  if g.vendedor is distinct from private.atd_vendedor() then raise exception 'Essa gravação não é sua.'; end if;
  return g;
end $$;

create or replace function public.atd_criar(p_origem text, p_mime text default null, p_extensao text default null,
  p_canais text default null, p_arquivo_nome text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v text := private.atd_vendedor(); v_id uuid := gen_random_uuid();
begin
  if v is null then raise exception 'Seu login não está ligado a um vendedor.'; end if;
  insert into atendimentos_gravacoes (id, pasta, vendedor, equipe, origem, mime, extensao, canais, arquivo_nome)
  values (v_id, auth.uid()::text || '/' || v_id::text, v,
          case when v like 'Teste (%' then null else private.equipe_na_data(v, current_date) end, p_origem,
          left(p_mime, 120), left(p_extensao, 10), left(p_canais, 40), left(p_arquivo_nome, 200));
  return v_id;
end $$;

drop policy if exists "atendimentos: enviar" on storage.objects;
drop policy if exists "atendimentos: reenviar" on storage.objects;
drop policy if exists "atendimentos: apagar" on storage.objects;
create policy "atendimentos: enviar" on storage.objects for insert to authenticated with check (
  bucket_id = 'atendimentos' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]
              and g.vendedor = private.atd_vendedor() and g.status in ('gravando', 'aguardando')));
create policy "atendimentos: reenviar" on storage.objects for update to authenticated using (
  bucket_id = 'atendimentos' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]
              and g.vendedor = private.atd_vendedor() and g.status in ('gravando', 'aguardando')));
create policy "atendimentos: apagar" on storage.objects for delete to authenticated using (
  bucket_id = 'atendimentos' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]
              and g.vendedor = private.atd_vendedor() and g.status in ('gravando', 'aguardando')));
