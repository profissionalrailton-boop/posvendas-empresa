-- 020 — Gestão redefine a senha de um vendedor que esqueceu (o servidor de login não envia e-mail).
-- Só quem tem o Administrativo (admin_allowed_users) e só para logins de vendedor
-- (posvendas_vendedor_acesso). A gestão digita uma senha provisória na tela; o vendedor entra e troca
-- em "Trocar senha". Fica registrado quem redefiniu e quando.

create table if not exists public.senha_redefinicoes (
  id bigserial primary key,
  vendedor text not null,
  email text not null,
  redefinido_por text not null default (auth.jwt() ->> 'email'),
  redefinido_em timestamptz not null default now()
);
alter table public.senha_redefinicoes enable row level security;
create policy "admin le redefinicoes" on public.senha_redefinicoes for select to authenticated using (private.is_admin_allowed_user());
grant select on public.senha_redefinicoes to authenticated;

create or replace function public.admin_redefinir_senha_vendedor(p_vendedor text, p_senha text)
returns text language plpgsql volatile security definer set search_path to 'public' as $$
declare v_email text; n int;
begin
  if not private.is_admin_allowed_user() then raise exception 'Sem permissão.'; end if;
  if p_senha is null or length(p_senha) < 6 then raise exception 'A senha provisória precisa ter pelo menos 6 caracteres.'; end if;
  select email into v_email from posvendas_vendedor_acesso where vendedor = p_vendedor limit 1;
  if v_email is null then raise exception 'Esse vendedor ainda não tem login no sistema.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now()
   where lower(email) = lower(v_email);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Login % não encontrado.', v_email; end if;
  insert into senha_redefinicoes (vendedor, email) values (p_vendedor, v_email);
  return v_email;
end $$;
revoke all on function public.admin_redefinir_senha_vendedor(text, text) from public, anon;
grant execute on function public.admin_redefinir_senha_vendedor(text, text) to authenticated;

notify pgrst, 'reload schema';
