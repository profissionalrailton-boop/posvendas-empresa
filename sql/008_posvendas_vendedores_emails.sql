-- Vendedores liberados (e-mail de login → nome EXATO do vendedor nas vendas)
-- Lote 1 (2026-10-06). Nomes da lista do usuário ligados ao cadastro:
--   "Francisco Diego" → Diego Ferreira · "Walisson Bezerra" → Walisson Souza · "Reynaldo" → Reinaldo Galdino
insert into public.posvendas_vendedor_acesso (email, vendedor) values
  ('felipeconsultor123@gmail.com', 'Felipe Cavalcante'),
  ('mathewz1202@gmail.com',        'Matheus Araújo'),
  ('dg.senaigt@gmail.com',         'Diego Ferreira'),
  ('mturhappy@gmail.com',          'Walisson Souza'),
  ('iniglysilva550@gmail.com',     'Inigly Silva'),
  ('tatiellydavidd1@gmail.com',    'Tatielly David'),
  ('reynaldo619alves@gmail.com',   'Reinaldo Galdino'),
  ('iagoluis092004@gmail.com',     'Iago Luis'),
  ('ganacarolina743@gmail.com',    'Ana Carolina')
on conflict (email) do update set vendedor = excluded.vendedor;
