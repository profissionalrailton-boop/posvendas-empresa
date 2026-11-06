-- 018 — "Meu sonho" na Minha área do vendedor: foto + nome + valor (+ prazo e quanto já tem guardado).
-- Progresso = já tenho + comissão das vendas desde o cadastro do sonho. Visível para o próprio
-- vendedor e para a gestão (diretoria). Fotos no bucket público "sonhos", na pasta do próprio login.

create table if not exists public.vendedor_sonhos (
  vendedor text primary key,
  titulo text not null,
  valor numeric(14, 2) not null check (valor > 0),
  prazo date,
  ja_tenho numeric(14, 2) not null default 0 check (ja_tenho >= 0),
  foto_url text,
  desde date not null default current_date,
  updated_at timestamptz not null default now()
);
alter table public.vendedor_sonhos enable row level security;
create policy "vendedor le o proprio sonho" on public.vendedor_sonhos for select to authenticated
  using (vendedor = private.vendedor_logado() or private.is_allowed_user() or private.is_admin_allowed_user());
create policy "vendedor cria o proprio sonho" on public.vendedor_sonhos for insert to authenticated
  with check (vendedor = private.vendedor_logado());
create policy "vendedor muda o proprio sonho" on public.vendedor_sonhos for update to authenticated
  using (vendedor = private.vendedor_logado()) with check (vendedor = private.vendedor_logado());
create policy "vendedor apaga o proprio sonho" on public.vendedor_sonhos for delete to authenticated
  using (vendedor = private.vendedor_logado());
grant select, insert, update, delete on public.vendedor_sonhos to authenticated;

-- progresso de um vendedor: comissão das vendas desde o cadastro + comissão média por venda (últimos 6 meses)
create or replace function private.sonho_progresso(p_vendedor text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'sonho', to_jsonb(s),
    'comissao_desde', coalesce((select sum(v.comissao_vendedor_valor) from administrativo_vendas v
                                where v.vendedor = s.vendedor and v.data_venda >= s.desde), 0),
    'vendas_desde', (select count(*) from administrativo_vendas v where v.vendedor = s.vendedor and v.data_venda >= s.desde),
    'comissao_media', (select avg(v.comissao_vendedor_valor) from administrativo_vendas v
                       where v.vendedor = s.vendedor and v.data_venda >= current_date - interval '6 months'
                         and v.comissao_vendedor_valor > 0))
  from public.vendedor_sonhos s where s.vendedor = p_vendedor
$$;

create or replace function public.meu_sonho()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v text := private.vendedor_logado();
begin
  if v is null then return null; end if;
  return coalesce(private.sonho_progresso(v), jsonb_build_object('sonho', null, 'comissao_media',
    (select avg(comissao_vendedor_valor) from administrativo_vendas where vendedor = v
       and data_venda >= current_date - interval '6 months' and comissao_vendedor_valor > 0)));
end $$;
grant execute on function public.meu_sonho() to authenticated;

create or replace function public.sonhos_equipe()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (private.is_allowed_user() or private.is_admin_allowed_user()) then return null; end if;
  return coalesce((select jsonb_agg(private.sonho_progresso(s.vendedor) order by s.vendedor)
                   from public.vendedor_sonhos s
                   join public.administrativo_vendedores a on a.nome = s.vendedor and a.ativo), '[]'::jsonb);
end $$;
grant execute on function public.sonhos_equipe() to authenticated;

-- fotos: bucket público; cada login só grava na própria pasta (<auth.uid()>/...)
insert into storage.buckets (id, name, public) values ('sonhos', 'sonhos', true) on conflict (id) do nothing;
create policy "sonhos: grava na propria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'sonhos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "sonhos: troca na propria pasta" on storage.objects for update to authenticated
  using (bucket_id = 'sonhos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "sonhos: apaga na propria pasta" on storage.objects for delete to authenticated
  using (bucket_id = 'sonhos' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';

-- (correção 06/11) o upload com upsert precisa ler o arquivo de volta: sem SELECT dava
-- "new row violates row-level security policy" ao salvar a foto
create policy "sonhos: leitura" on storage.objects for select to authenticated using (bucket_id = 'sonhos');

-- (06/11) caixinha: o progresso deixa de contar a comissão das vendas; o vendedor guarda o valor que quiser
create table if not exists public.vendedor_sonho_depositos (
  id bigserial primary key, vendedor text not null, valor numeric(14,2) not null check (valor <> 0),
  criado_em timestamptz not null default now(), criado_por text default (auth.jwt() ->> 'email'));
-- RLS: vendedor lê/guarda/desfaz só na própria caixinha; diretoria/admin leem. sonho_progresso agora devolve
-- 'guardado' (soma dos lançamentos) e 'ultimos' (8 últimos), além de 'comissao_media'.
