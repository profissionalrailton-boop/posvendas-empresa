-- 048: comentário do Pipeline mostra o NOME (e a foto) de quem escreveu, não o e-mail.
-- O nome sai do cadastro de acesso do vendedor, depois do de supervisores; o dono é "Railton Angelo".

alter table public.pipe_comentarios add column if not exists autor_nome text;

create or replace function private.nome_do_email(p_email text)
returns text language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select vendedor from posvendas_vendedor_acesso where lower(email) = lower(p_email) limit 1),
    (select nome from supervisores where lower(email) = lower(p_email) and nullif(nome, '') is not null limit 1),
    case lower(p_email) when 'profissionalrailton@gmail.com' then 'Railton Angelo' end,
    initcap(split_part(p_email, '@', 1)))
$$;

create or replace function private.pipe_comentario_nome()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  -- robôs (SDR, follow-up…) gravam o próprio nome em "autor", sem @
  new.autor_nome := case when position('@' in coalesce(new.autor, '')) > 0 then private.nome_do_email(new.autor) else new.autor end;
  return new;
end $$;
drop trigger if exists pipe_comentario_nome on public.pipe_comentarios;
create trigger pipe_comentario_nome before insert on public.pipe_comentarios for each row execute function private.pipe_comentario_nome();

update public.pipe_comentarios
   set autor_nome = case when position('@' in coalesce(autor, '')) > 0 then private.nome_do_email(autor) else autor end
 where autor_nome is null;
