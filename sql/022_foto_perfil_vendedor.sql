-- 022 — Foto de perfil do vendedor: o próprio vendedor coloca (Minha área ou Rouba prêmio) e o Railton
-- também pode trocar. Usada na Minha área e no Rouba prêmio. Substitui a rp_fotos da 021 (estava vazia).

alter table public.rp_fotos rename to vendedor_fotos;
drop policy if exists "rp: todos leem" on public.vendedor_fotos;
drop policy if exists "rp: editor grava fotos" on public.vendedor_fotos;
create policy "fotos: todos leem" on public.vendedor_fotos for select to authenticated using (true);
create policy "fotos: editor grava" on public.vendedor_fotos for all to authenticated
  using (private.rp_editor()) with check (private.rp_editor());
create policy "fotos: vendedor grava a propria" on public.vendedor_fotos for all to authenticated
  using (vendedor = private.vendedor_logado()) with check (vendedor = private.vendedor_logado());

-- bucket público "perfis": o vendedor grava na pasta do próprio login; o editor grava em qualquer pasta
insert into storage.buckets (id, name, public) values ('perfis', 'perfis', true) on conflict (id) do nothing;
create policy "perfis: leitura" on storage.objects for select to authenticated using (bucket_id = 'perfis');
create policy "perfis: grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'perfis' and ((storage.foldername(name))[1] = auth.uid()::text or private.rp_editor()));
create policy "perfis: troca" on storage.objects for update to authenticated
  using (bucket_id = 'perfis' and ((storage.foldername(name))[1] = auth.uid()::text or private.rp_editor()));
create policy "perfis: apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'perfis' and ((storage.foldername(name))[1] = auth.uid()::text or private.rp_editor()));

-- o bucket rouba-premio da 021 deixou de ser usado
drop policy if exists "rouba-premio: leitura" on storage.objects;
drop policy if exists "rouba-premio: editor grava" on storage.objects;
drop policy if exists "rouba-premio: editor troca" on storage.objects;
drop policy if exists "rouba-premio: editor apaga" on storage.objects;
