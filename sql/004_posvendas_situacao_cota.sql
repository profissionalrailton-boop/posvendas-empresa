-- Situação da cota separada em 4 opções (antes era só ativo sim/não = "cancelada/quitada"):
--   ativa       → conta na adimplência normalmente
--   contemplada → continua contando na adimplência normalmente
--   quitada     → sai da adimplência e dos alertas
--   cancelada   → continua contando como INADIMPLENTE
alter table public.posvendas_cobranca
  add column if not exists situacao text not null default 'ativa'
  check (situacao in ('ativa', 'contemplada', 'quitada', 'cancelada'));

-- cotas já marcadas como "cancelada/quitada" no modelo antigo
-- (só havia a Raniely Quaresma Cardoso, informada como cancelada)
update public.posvendas_cobranca set situacao = 'cancelada' where not ativo;
