-- Vendedores liberados (e-mail de login → nome EXATO do vendedor nas vendas)
-- Lista atualizada em 2026-10-06 (12 vendedores). Nomes da lista do usuário ligados ao cadastro:
--   "Walisson Bezerra" → Walisson Souza · "Reynaldo Galdino" → Reinaldo Galdino
-- Tatielly trocou de e-mail: o antigo (tatiellydavidd1@gmail.com) foi removido.
-- Djalma Neto ainda sem e-mail.
delete from public.posvendas_vendedor_acesso where email = 'tatiellydavidd1@gmail.com';
insert into public.posvendas_vendedor_acesso (email, vendedor) values
  ('felipeconsultor123@gmail.com', 'Felipe Cavalcante'),
  ('mathewz1202@gmail.com',        'Matheus Araújo'),
  ('dg.senaigt@gmail.com',         'Diego Ferreira'),
  ('mturhappy@gmail.com',          'Walisson Souza'),
  ('iniglysilva550@gmail.com',     'Inigly Silva'),
  ('tatiellysilvad1@gmail.com',    'Tatielly David'),
  ('reynaldo619alves@gmail.com',   'Reinaldo Galdino'),
  ('iagoluis092004@gmail.com',     'Iago Luis'),
  ('ganacarolina743@gmail.com',    'Ana Carolina'),
  ('yarinesantoss26@gmail.com',    'Yarine Santos'),
  ('lucasgomes347976@gmail.com',   'Lucas Gomes'),
  ('cibellyalmeidaisi@gmail.com',  'Cibelly Almeida')
on conflict (email) do update set vendedor = excluded.vendedor;
