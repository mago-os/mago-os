-- Pessoas falsas (M1-02): uma em cada empresa e uma nas duas, que também é a Dona da plataforma local.
-- E-mails no domínio .invalid, que nunca existe na internet.
INSERT INTO public.pessoas (id, nome, email) VALUES
  ('00000000-0000-7000-8000-0000000000a1', 'Ana Teste', 'ana@teste.invalid'),
  ('00000000-0000-7000-8000-0000000000b1', 'Bia Teste', 'bia@teste.invalid'),
  ('00000000-0000-7000-8000-0000000000d1', 'Duda Teste', 'duda@teste.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em) VALUES
  ('00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1', 'funcionario', 'ativo', now(), now()),
  ('00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-0000000000b1', 'funcionario', 'ativo', now(), now()),
  ('00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000d1', 'administrador', 'ativo', now(), now()),
  ('00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-0000000000d1', 'administrador', 'ativo', now(), now())
ON CONFLICT (empresa_id, pessoa_id) DO NOTHING;

INSERT INTO public.papeis_plataforma (pessoa_id, papel) VALUES ('00000000-0000-7000-8000-0000000000d1', 'dono')
ON CONFLICT (pessoa_id) DO NOTHING;
