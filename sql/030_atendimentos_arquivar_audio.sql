-- 030 — Meus atendimentos: o áudio é apagado do Supabase 7 dias depois da análise (rotina diária do n8n
-- "Sistema Infinity - Meus atendimentos (apagar áudios antigos)"). A análise, a nota e a transcrição ficam.
-- Fechamento + Vendeu só é apagado depois de salvo no Google Drive (analises_fechamento.drive_arquivos).

alter table public.atendimentos_gravacoes add column if not exists audio_apagado_em timestamptz;

-- gravações cujo áudio já pode ser apagado, com a lista de arquivos no bucket "atendimentos"
create or replace function public.atd_n8n_para_arquivar(p_dias int default 7, p_limite int default 50)
returns table (id uuid, arquivos text[])
language sql security definer set search_path to 'public' as $$
  select g.id,
         array(select o.name from storage.objects o where o.bucket_id = 'atendimentos' and o.name like g.pasta || '/%')
  from atendimentos_gravacoes g
  left join analises_fechamento a on a.id = g.auditoria_id
  where g.status = 'pronta' and g.audio_apagado_em is null
    and g.analisado_em < now() - make_interval(days => p_dias)
    and not (g.tipo = 'fechamento' and g.resultado = 'vendeu' and coalesce(jsonb_array_length(a.drive_arquivos), 0) = 0)
  order by g.analisado_em
  limit p_limite;
$$;

create or replace function public.atd_n8n_arquivado(p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update atendimentos_gravacoes set audio_apagado_em = now() where id = p_id;
$$;

revoke all on function public.atd_n8n_para_arquivar(int, int) from public, anon, authenticated;
revoke all on function public.atd_n8n_arquivado(uuid) from public, anon, authenticated;
grant execute on function public.atd_n8n_para_arquivar(int, int) to service_role;
grant execute on function public.atd_n8n_arquivado(uuid) to service_role;
