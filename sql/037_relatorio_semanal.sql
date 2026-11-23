-- 037: Relatório semanal da equipe (domingo a sábado, America/Fortaleza).
-- relatorio_semanal(p_inicio date) -> jsonb com todos os números do relatório.
-- p_inicio = domingo da semana; null = última semana completa.
-- Acesso: gestão (aba "Relatório semanal") e service_role (n8n, envio de segunda-feira).

create or replace function public.relatorio_semanal(p_inicio date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Fortaleza')::date;
  ini date;
  fim date;
  t0 timestamptz;
  t1 timestamptz;
  r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not private.doc_gestor() then
    raise exception 'sem permissão';
  end if;
  ini := coalesce(p_inicio, hoje - extract(dow from hoje)::int - 7);
  ini := ini - extract(dow from ini)::int;           -- garante domingo
  fim := ini + 6;
  t0 := (ini::timestamp) at time zone 'America/Fortaleza';
  t1 := ((fim + 1)::timestamp) at time zone 'America/Fortaleza';

  select jsonb_build_object(
    'inicio', ini, 'fim', fim, 'gerado_em', now(),
    'vendas', (select jsonb_build_object(
        'total', coalesce(sum(valor_venda) filter (where data_venda between ini and fim), 0),
        'contratos', count(*) filter (where data_venda between ini and fim),
        'ant_total', coalesce(sum(valor_venda) filter (where data_venda between ini - 7 and fim - 7), 0),
        'ant_contratos', count(*) filter (where data_venda between ini - 7 and fim - 7),
        'mes_total', coalesce(sum(valor_venda) filter (where data_venda between date_trunc('month', fim)::date and fim), 0),
        'mes_contratos', count(*) filter (where data_venda between date_trunc('month', fim)::date and fim))
      from administrativo_vendas where data_venda between least(ini - 7, date_trunc('month', fim)::date) and fim),
    'ranking', coalesce((select jsonb_agg(x order by x.total desc, x.contratos desc) from (
        select vendedor, sum(valor_venda) total, count(*) contratos from administrativo_vendas
         where data_venda between ini and fim group by vendedor) x), '[]'::jsonb),
    'mix', coalesce((select jsonb_agg(x order by x.total desc) from (
        select coalesce(administradora, '—') administradora, coalesce(tipo_plano, '') tipo, sum(valor_venda) total, count(*) contratos
          from administrativo_vendas where data_venda between ini and fim group by 1, 2) x), '[]'::jsonb),
    'docs', jsonb_build_object(
        'total', (select count(*) from doc_corrida where vendedor is not null and em >= t0 and em < t1),
        'ant_total', (select count(*) from doc_corrida where vendedor is not null and em >= t0 - interval '7 days' and em < t0),
        'lista', coalesce((select jsonb_agg(x order by x.n desc, x.vendedor) from (
            select vendedor, count(*) n from doc_corrida where vendedor is not null and em >= t0 and em < t1 group by 1) x), '[]'::jsonb)),
    'qualidade', (select jsonb_build_object('n', count(*), 'media', round(avg(nota), 1))
        from atendimentos_gravacoes where status = 'pronta' and nota is not null and criado_em >= t0 and criado_em < t1)
      || jsonb_build_object('top', coalesce((select jsonb_agg(x order by x.media desc, x.n desc) from (
            select vendedor, count(*) n, round(avg(nota), 1) media from atendimentos_gravacoes
             where status = 'pronta' and nota is not null and criado_em >= t0 and criado_em < t1
             group by 1 order by 3 desc, 2 desc limit 5) x), '[]'::jsonb)),
    'rouba_premio', (select jsonb_build_object(
        'vendedor', d.vendedor, 'metas', d.n,
        'premios_agora', (select count(*) from rp_premios where dono = d.vendedor),
        'premios', coalesce((select jsonb_agg(jsonb_build_object('emoji', emoji, 'nome', nome, 'qtd', q) order by q desc, nome)
            from (select emoji, nome, count(*) q from rp_premios where dono = d.vendedor group by 1, 2) p), '[]'::jsonb))
      from (select vendedor, count(*) n from rp_eventos where em >= t0 and em < t1 group by 1 order by 2 desc limit 1) d),
    'fotos', coalesce((select jsonb_object_agg(vendedor, foto_url) from vendedor_fotos where foto_url is not null), '{}'::jsonb)
  ) into r;
  return r;
end $$;

revoke all on function public.relatorio_semanal(date) from public, anon;
grant execute on function public.relatorio_semanal(date) to authenticated, service_role;
