-- 032 — Meus atendimentos: o vendedor também pode descartar a gravação que ficou com erro na análise
-- (ex.: arquivo em formato que a transcrição recusou), para enviar de novo.

create or replace function public.atd_descartar(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare g public.atendimentos_gravacoes := private.atd_minha(p_id);
begin
  if g.status not in ('gravando', 'aguardando', 'erro') then raise exception 'Essa gravação já foi para análise.'; end if;
  delete from atendimentos_gravacoes where id = p_id;
end $$;

drop policy if exists "atendimentos: apagar" on storage.objects;
create policy "atendimentos: apagar" on storage.objects for delete to authenticated using (
  bucket_id = 'atendimentos' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.atendimentos_gravacoes g where g.id::text = (storage.foldername(name))[2]
              and g.vendedor = private.atd_vendedor() and g.status in ('gravando', 'aguardando', 'erro')));
