-- Duas empresas falsas, para testar o isolamento: uma nunca pode ver a outra.
INSERT INTO public.empresas (id, nome) VALUES
  ('00000000-0000-7000-8000-00000000000a', 'Empresa Teste A'),
  ('00000000-0000-7000-8000-00000000000b', 'Empresa Teste B')
ON CONFLICT (id) DO NOTHING;
