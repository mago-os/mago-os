-- M1-10: a própria pessoa muda idioma e fuso horário na tela "Meu perfil" (o login já mudava nome e foto).

-- Up Migration

GRANT UPDATE (idioma, fuso_horario) ON public.pessoas TO mago_acesso;

-- Down Migration

REVOKE UPDATE (idioma, fuso_horario) ON public.pessoas FROM mago_acesso;
