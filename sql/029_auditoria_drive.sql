-- 029 — Auditoria: links dos arquivos salvos no Google Drive (pasta PARA ANALISE) pelo n8n
-- (workflow "Administrativo Infinity - Salvar gravação de fechamento no Drive"): [{id, nome, link}]
alter table public.analises_fechamento add column if not exists drive_arquivos jsonb;
