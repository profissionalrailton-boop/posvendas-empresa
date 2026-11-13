-- 029 — Auditoria: links dos arquivos salvos no Google Drive (pasta PARA ANALISE) pelo n8n
-- (workflow "Administrativo Infinity - Salvar gravação de fechamento no Drive"): [{id, nome, link}]
alter table public.analises_fechamento add column if not exists drive_arquivos jsonb;
-- n8n (service_role) lê atendimentos_gravacoes para salvar no Drive (workflow "Salvar gravação de fechamento no Drive")
grant select on public.atendimentos_gravacoes to service_role;
