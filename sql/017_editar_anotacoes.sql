-- 017 — Editar anotações do histórico do cliente (pós-vendas).
--   * pós-vendas (acesso completo): edita qualquer anotação (já coberto pela policy "posvendas full access");
--   * vendedor: edita só as anotações que ele mesmo escreveu, das vendas dele (tipo "contato").
-- Quem editou e quando ficam registrados (editado_em / editado_por), preenchidos pelo banco.

alter table public.posvendas_anotacoes
  add column if not exists editado_em timestamptz,
  add column if not exists editado_por text;

create policy "vendedor edita o proprio contato" on public.posvendas_anotacoes
  for update to authenticated
  using (private.venda_do_vendedor(venda_id) and lower(created_by) = lower(auth.jwt() ->> 'email'))
  with check (private.venda_do_vendedor(venda_id) and tipo = 'contato' and lower(created_by) = lower(auth.jwt() ->> 'email'));
grant update on public.posvendas_anotacoes to authenticated;

create or replace function private.marcar_anotacao_editada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.texto is distinct from old.texto then
    new.editado_em := now();
    new.editado_por := auth.jwt() ->> 'email';
  end if;
  -- quem não é do pós-vendas (vendedor) só pode mudar o texto
  if not private.is_posvendas_user() then
    new.venda_id := old.venda_id; new.tipo := old.tipo; new.created_by := old.created_by; new.created_at := old.created_at;
    new.promessa_data := old.promessa_data; new.resolvido_em := old.resolvido_em;
  end if;
  return new;
end $$;
drop trigger if exists anotacao_editada on public.posvendas_anotacoes;
create trigger anotacao_editada before update on public.posvendas_anotacoes
  for each row execute function private.marcar_anotacao_editada();

notify pgrst, 'reload schema';
