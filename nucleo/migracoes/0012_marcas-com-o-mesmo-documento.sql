-- M1-11 (ajuste de 17/11/2026, decisão do Sandro): várias contas podem ter o mesmo CNPJ ou CPF.
--
-- Uma empresa com várias marcas (ou uma pessoa física com várias marcas) abre uma conta por marca, cada uma
-- com as próprias equipes e dados, todas com o mesmo documento. A trava "um documento, uma conta" sai; o índice
-- fica, sem ser único, para achar as contas do mesmo documento (fatura única na cobrança, Fase 2).
-- Explicado em docs/banco/decisoes.md, seção 16, e na decisão 0016.

-- Up Migration

ALTER TABLE public.empresas DROP CONSTRAINT empresas_documento_unico;
CREATE INDEX empresas_por_documento ON public.empresas (documento) WHERE documento IS NOT NULL;
COMMENT ON COLUMN public.empresas.documento IS '[pessoal] CNPJ ou CPF, sem pontuação. Várias contas (marcas) podem ter o mesmo documento. O CPF é dado pessoal: aparece mascarado para quem não é administrador nem Dono.';

-- Down Migration

DROP INDEX public.empresas_por_documento;
ALTER TABLE public.empresas ADD CONSTRAINT empresas_documento_unico UNIQUE (documento);
COMMENT ON COLUMN public.empresas.documento IS '[pessoal] CNPJ ou CPF, sem pontuação. Um documento, uma conta. O CPF é dado pessoal: aparece mascarado para quem não é administrador nem Dono.';
