-- 019 — Minha área: quanto o vendedor já recebeu nos últimos 12 meses, pela folha de pagamento do financeiro.
-- employees.vendedor liga o funcionário da folha ao nome do vendedor (os nomes da folha são diferentes,
-- ex.: "IAGO LUIZ" → "Iago Luis"); sem o vínculo, tenta pelo nome igual (ignorando maiúsculas).
-- Folha paga (payment_date até hoje, ou mês anterior sem data) = salário + comissões + bônus;
-- folha do mês ainda em aberto não entra. Descontos (vales) nunca são considerados.

alter table public.employees add column if not exists vendedor text;
update public.employees e set vendedor = m.v from (values
 ('ANA CAROLINA','Ana Carolina'),('CIBELLY ALMEIDA','Cibelly Almeida'),('Diego Ferreira','Diego Ferreira'),
 ('FELIPE CAVALCANTE','Felipe Cavalcante'),('IAGO LUIZ','Iago Luis'),('INIGLY DA SILVA','Inigly Silva'),
 ('LUCAS GOMES','Lucas Gomes'),('MATHEUS ARAUJO','Matheus Araújo'),('REYNALDO GALDINO','Reinaldo Galdino'),
 ('TATIELLY DAVID','Tatielly David'),('Walisson Bezerra','Walisson Souza'),('YARINE SANTOS','Yarine Santos')
) m(n, v) where e.name = m.n;

create or replace function public.meus_recebimentos()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v text := private.vendedor_logado(); ini date := (date_trunc('month', current_date) - interval '11 months')::date;
begin
  if v is null then return null; end if;
  return (
    with f as (
      select p.month,
             (p.payment_date is not null and p.payment_date <= current_date) or (p.payment_date is null and p.month < date_trunc('month', current_date)) as pago,
             coalesce(p.salario, 0)
               + coalesce((select sum(comissao) from payroll_sales s where s.payroll_entry_id = p.id), 0)
               + coalesce((select sum(amount) from payroll_adjustments a where a.payroll_entry_id = p.id and a.type = 'bonus'), 0) as bruto,
             coalesce((select sum(amount) from payroll_adjustments a where a.payroll_entry_id = p.id and a.type = 'vale'), 0) as vales
      from payroll_entries p join employees e on e.id = p.employee_id
      where (e.vendedor = v or (e.vendedor is null and lower(e.name) = lower(v))) and p.month >= ini
    )
    select jsonb_build_object(
      'desde', ini,
      'total', coalesce(sum(bruto) filter (where pago), 0),
      'meses', coalesce(jsonb_agg(jsonb_build_object('mes', month, 'pago', pago, 'valor', bruto) order by month) filter (where pago), '[]'::jsonb))
    from f);
end $$;
grant execute on function public.meus_recebimentos() to authenticated;
notify pgrst, 'reload schema';

-- (06/11) Painel geral: salários de todos os vendedores ativos (só diretoria/admin), mesma regra (folhas pagas, sem descontos)
create or replace function public.recebimentos_equipe()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare ini date := (date_trunc('month', current_date) - interval '11 months')::date;
begin
  if not (private.is_allowed_user() or private.is_admin_allowed_user()) then return null; end if;
  return coalesce((
    with f as (
      select v.nome, p.month,
             coalesce(p.salario, 0)
               + coalesce((select sum(comissao) from payroll_sales s where s.payroll_entry_id = p.id), 0)
               + coalesce((select sum(amount) from payroll_adjustments a where a.payroll_entry_id = p.id and a.type = 'bonus'), 0) as bruto
      from administrativo_vendedores v
      join employees e on e.vendedor = v.nome or (e.vendedor is null and lower(e.name) = lower(v.nome))
      join payroll_entries p on p.employee_id = e.id
      where v.ativo and p.month >= ini
        and ((p.payment_date is not null and p.payment_date <= current_date) or (p.payment_date is null and p.month < date_trunc('month', current_date)))
    )
    select jsonb_agg(x order by x.total desc) from (
      select nome, sum(bruto) as total, count(*) as folhas,
             jsonb_agg(jsonb_build_object('mes', month, 'valor', bruto) order by month) as meses
      from f group by nome) x
  ), '[]'::jsonb);
end $$;
grant execute on function public.recebimentos_equipe() to authenticated;
