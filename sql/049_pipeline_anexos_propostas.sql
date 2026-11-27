-- 049: PDFs de proposta comercial anexados ao card do Pipeline.
-- Arquivo no bucket privado "propostas", caminho <card_id>/<arquivo>.pdf; registro em pipe_anexos.
-- Dono vê tudo; vendedor liberado só anexa e baixa dos próprios cards.

insert into storage.buckets (id, name, public) values ('propostas', 'propostas', false) on conflict (id) do nothing;

create or replace function private.pipe_card_do_caminho(p_nome text)
returns bigint language sql immutable as $$
  select case when split_part(p_nome, '/', 1) ~ '^\d+$' then split_part(p_nome, '/', 1)::bigint end
$$;

drop policy if exists "propostas pipeline ler" on storage.objects;
create policy "propostas pipeline ler" on storage.objects for select to authenticated
  using (bucket_id = 'propostas' and (private.pipe_acesso() or private.pipe_card_meu(private.pipe_card_do_caminho(name))));
drop policy if exists "propostas pipeline enviar" on storage.objects;
create policy "propostas pipeline enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'propostas' and (private.pipe_acesso() or private.pipe_card_meu(private.pipe_card_do_caminho(name))));

create table if not exists public.pipe_anexos (
  id bigserial primary key,
  card_id bigint not null references public.pipe_cards(id) on delete cascade,
  tipo text not null default 'proposta',
  nome text not null,
  caminho text not null,
  resumo text,
  criado_por text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  criado_em timestamptz not null default now()
);
create index if not exists pipe_anexos_card on public.pipe_anexos (card_id, criado_em desc);
alter table public.pipe_anexos enable row level security;
drop policy if exists "pipe dono" on public.pipe_anexos;
create policy "pipe dono" on public.pipe_anexos for all to authenticated using (private.pipe_acesso()) with check (private.pipe_acesso());
drop policy if exists "pipe vendedor ve" on public.pipe_anexos;
create policy "pipe vendedor ve" on public.pipe_anexos for select to authenticated using (private.pipe_card_meu(card_id));
drop policy if exists "pipe vendedor cria" on public.pipe_anexos;
create policy "pipe vendedor cria" on public.pipe_anexos for insert to authenticated with check (private.pipe_card_meu(card_id));
revoke all on public.pipe_anexos from anon;
grant select, insert, delete on public.pipe_anexos to authenticated;
grant usage, select on sequence public.pipe_anexos_id_seq to authenticated;

-- anexou proposta: comentário no card + etiqueta PROPOSTA ENVIADA (zera o "parado" pelo comentário)
create or replace function private.pipe_anexo_registrar()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.tipo = 'proposta' then
    insert into pipe_comentarios (card_id, autor, texto)
    values (new.card_id, new.criado_por, '📄 Proposta comercial gerada em PDF' || coalesce(': ' || new.resumo, '') || '.');
    insert into pipe_card_etiquetas (card_id, etiqueta_id)
    select new.card_id, id from pipe_etiquetas where upper(nome) = 'PROPOSTA ENVIADA' limit 1
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists pipe_anexo_registrar on public.pipe_anexos;
create trigger pipe_anexo_registrar after insert on public.pipe_anexos for each row execute function private.pipe_anexo_registrar();
