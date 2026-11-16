-- 033 — Meus atendimentos: falha passageira da transcrição/análise (tempo esgotado, serviço fora do ar) volta para a fila
-- sozinha, até 3 tentativas, em vez de aparecer como erro para o vendedor. Erro definitivo (formato inválido etc.) continua
-- indo direto para "erro".

create or replace function public.atd_n8n_erro(p_id uuid, p_erro text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update atendimentos_gravacoes set
    status = case when tentativas < 3 and p_erro ~* '(timeout|timed out|tempor|overloaded|rate limit|econnreset|socket hang up|bad gateway|service unavailable|internal server error|\m50[0234]\M)'
                  then 'aguardando' else 'erro' end,
    erro = left(p_erro, 500), processando_desde = null, atualizado_em = now()
  where id = p_id;
end $$;
