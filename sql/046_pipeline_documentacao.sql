-- 046: card que entra na etapa Documentação do Pipeline cria a documentação (doc_corrida) já com o vendedor do card
-- — conta na Corrida e aparece em Documentações, igual às que vinham do Convex.
-- Não duplica: o card guarda a documentação criada (doc_id) e, se o mesmo vendedor já tem documentação
-- do mesmo telefone nos últimos 30 dias (ex.: veio do Convex), só liga o card a ela.

alter table public.doc_corrida drop constraint if exists doc_corrida_origem_check;
alter table public.doc_corrida add constraint doc_corrida_origem_check check (origem in ('manual', 'crm', 'pipeline'));
alter table public.pipe_cards add column if not exists doc_id bigint references public.doc_corrida(id) on delete set null;

create or replace function private.pipe_card_documentacao()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_doc bigint; v_tel text := private.doc_digitos(new.telefone);
begin
  if new.etapa <> 'documentacao' or new.vendedor is null then return new; end if;
  if tg_op = 'UPDATE' and old.etapa = 'documentacao' then return new; end if;   -- só na entrada da etapa
  if new.doc_id is not null and exists (select 1 from doc_corrida where id = new.doc_id) then return new; end if; -- já gerou antes (saiu e voltou)

  if length(v_tel) >= 8 then
    select d.id into v_doc from doc_corrida d join doc_corrida_detalhes x on x.doc_id = d.id
     where d.vendedor = new.vendedor and d.em > now() - interval '30 days'
       and right(private.doc_digitos(x.telefone), 8) = right(v_tel, 8)
     order by d.em desc limit 1;
  end if;

  if v_doc is null then
    insert into doc_corrida (vendedor, cliente, em, origem, negocio_id, criado_por, vinculado_em, vinculado_por)
    values (new.vendedor, new.nome, now(), 'pipeline', 'pipe:' || new.id,
            lower(coalesce(nullif(auth.jwt() ->> 'email', ''), 'pipeline')), now(), 'pipeline')
    returning id into v_doc;
    insert into doc_corrida_detalhes (doc_id, telefone, email, cidade, estado, tipo, valor, payload)
    values (v_doc, new.telefone, new.email, new.cidade, new.estado,
            case new.tipo_bem when 'Imóvel' then 'IMOVEL' when 'Automóvel' then 'CARRO' when 'Moto' then 'MOTO'
                              when 'Pesados' then 'CAMINHAO' when 'Outro' then 'OUTRO' end,
            new.valor_credito, jsonb_build_object('pipe_card', new.id, 'origem', new.origem));
  end if;
  new.doc_id := v_doc;
  return new;
end $$;

drop trigger if exists pipe_card_documentacao on public.pipe_cards;
create trigger pipe_card_documentacao before insert or update of etapa on public.pipe_cards
  for each row execute function private.pipe_card_documentacao();
