-- Lembretes com hora e aviso sonoro
--   hora       → opcional; sem hora o lembrete vale para o dia inteiro (como antes)
--   avisar_min → minutos de antecedência do aviso: 0 = na hora, 5 ou 10; null = sem aviso
alter table public.posvendas_lembretes
  add column if not exists hora time,
  add column if not exists avisar_min smallint check (avisar_min is null or avisar_min in (0, 5, 10));
