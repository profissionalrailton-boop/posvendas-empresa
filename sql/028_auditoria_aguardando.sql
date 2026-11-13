-- 028 — Auditoria (analises_fechamento): novo status 'aguardando' para as gravações de Fechamento+Vendeu
-- vindas de Meus atendimentos. O n8n só copia o áudio; a administração vincula o cliente na aba
-- Análise de gravação do administrativo e então dispara a análise.
alter table public.analises_fechamento drop constraint analises_fechamento_status_check;
alter table public.analises_fechamento add constraint analises_fechamento_status_check check (status = any (array['enviando','aguardando','processando','concluido','erro']));
