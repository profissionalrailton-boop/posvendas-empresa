-- 027 — Meus atendimentos (Fase 2): funções usadas pelo n8n (service_role) para pegar uma gravação,
-- salvar a análise e ligar a cópia da auditoria; e "Analisar de novo" para o dono/diretoria.
--
-- Fila: o n8n chama atd_n8n_pegar() a cada 2 min. Pega 1 gravação "aguardando" (parada há 2+ min, para o
-- vendedor ainda poder corrigir o formulário) ou uma "processando" travada há 40+ min (nova tentativa).
-- Depois de 3 tentativas travadas, marca erro.

alter table public.atendimentos_gravacoes add column if not exists tentativas int not null default 0;
alter table public.atendimentos_gravacoes add column if not exists processando_desde timestamptz;

create or replace function public.atd_n8n_pegar()
returns table (id uuid, pasta text, vendedor text, cliente text, tipo text, resultado text, origem text,
               canais text, duracao_seg int, auditoria_id uuid)
language plpgsql security definer set search_path to 'public' as $$
begin
  update atendimentos_gravacoes g set status = 'erro', erro = 'A análise falhou 3 vezes. Use "Analisar de novo".',
    processando_desde = null, atualizado_em = now()
  where g.status = 'processando' and g.processando_desde < now() - interval '40 minutes' and g.tentativas >= 3;

  return query
  update atendimentos_gravacoes g set status = 'processando', processando_desde = now(), tentativas = g.tentativas + 1,
    erro = null, atualizado_em = now()
  where g.id = (
    select x.id from atendimentos_gravacoes x
    where (x.status = 'aguardando' and x.atualizado_em < now() - interval '2 minutes')
       or (x.status = 'processando' and x.processando_desde < now() - interval '40 minutes')
    order by x.enviado_em nulls last, x.criado_em
    limit 1 for update skip locked)
  returning g.id, g.pasta, g.vendedor, g.cliente, g.tipo, g.resultado, g.origem, g.canais, g.duracao_seg, g.auditoria_id;
end $$;

create or replace function public.atd_n8n_salvar(p_id uuid, p_transcricao jsonb, p_analise jsonb, p_nota numeric, p_duracao int default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update atendimentos_gravacoes set transcricao = p_transcricao, analise = p_analise, nota = p_nota,
    duracao_seg = coalesce(duracao_seg, p_duracao), status = 'pronta', erro = null, analisado_em = now(),
    processando_desde = null, atualizado_em = now()
  where id = p_id;
end $$;

create or replace function public.atd_n8n_erro(p_id uuid, p_erro text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update atendimentos_gravacoes set status = 'erro', erro = left(p_erro, 500), processando_desde = null, atualizado_em = now()
  where id = p_id;
end $$;

create or replace function public.atd_n8n_auditoria(p_id uuid, p_auditoria uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update atendimentos_gravacoes set auditoria_id = p_auditoria where id = p_id;
end $$;

revoke all on function public.atd_n8n_pegar() from public, anon, authenticated;
revoke all on function public.atd_n8n_salvar(uuid, jsonb, jsonb, numeric, int) from public, anon, authenticated;
revoke all on function public.atd_n8n_erro(uuid, text) from public, anon, authenticated;
revoke all on function public.atd_n8n_auditoria(uuid, uuid) from public, anon, authenticated;
grant execute on function public.atd_n8n_pegar() to service_role;
grant execute on function public.atd_n8n_salvar(uuid, jsonb, jsonb, numeric, int) to service_role;
grant execute on function public.atd_n8n_erro(uuid, text) to service_role;
grant execute on function public.atd_n8n_auditoria(uuid, uuid) to service_role;

-- "Analisar de novo" (gravação com erro): o dono ou a diretoria
create or replace function public.atd_reanalisar(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare g public.atendimentos_gravacoes;
begin
  select * into g from atendimentos_gravacoes where id = p_id for update;
  if not found then raise exception 'Gravação não encontrada.'; end if;
  if g.vendedor is distinct from private.atd_vendedor() and not private.is_allowed_user() then raise exception 'Sem permissão.'; end if;
  if g.status <> 'erro' then raise exception 'Essa gravação não está com erro.'; end if;
  update atendimentos_gravacoes set status = 'aguardando', erro = null, tentativas = 0,
    atualizado_em = now() - interval '5 minutes' where id = p_id;
end $$;
grant execute on function public.atd_reanalisar(uuid) to authenticated;
