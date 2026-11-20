-- M4-10: conta de IA por plano de assinatura (contrato em contratos/src/agentes/contas-de-ia.ts, decisão 0022).
--
-- 1. credencial: chave_de_api (o de antes) ou assinatura. O provedor diz quais aceita (chatgpt é novo, só assinatura).
-- 2. A assinatura guarda quem aceitou o aviso dos termos, quando e a versão do aviso; não tem teto em dólar.
-- 3. limite_do_plano_ate: o provedor avisou que o plano acabou até esta hora (os agentes usam o reserva até lá).
-- 4. O texto cifrado cresce para caber o arquivo de login do Codex (até 20 mil caracteres, de até 4 bytes cada).
-- Explicado em docs/banco/decisoes.md, seção 33.

-- Up Migration

ALTER TABLE public.contas_de_ia
  DROP CONSTRAINT contas_de_ia_provedor_check,
  DROP CONSTRAINT contas_de_ia_chave_cifrada_check,
  DROP CONSTRAINT contas_de_ia_endereco_do_provedor,
  ADD COLUMN credencial text NOT NULL DEFAULT 'chave_de_api' CHECK (credencial IN ('chave_de_api', 'assinatura')),
  ADD COLUMN termos_aceitos_por uuid,
  ADD COLUMN termos_aceitos_em timestamptz,
  ADD COLUMN versao_do_aviso integer CHECK (versao_do_aviso >= 1),
  ADD COLUMN limite_do_plano_ate timestamptz,
  ADD CONSTRAINT contas_de_ia_provedor_check CHECK (provedor IN ('anthropic', 'compativel_openai', 'chatgpt')),
  ADD CONSTRAINT contas_de_ia_chave_cifrada_check CHECK (octet_length(chave_cifrada) BETWEEN 36 AND 80100),
  ADD CONSTRAINT contas_de_ia_endereco_do_provedor CHECK ((provedor = 'compativel_openai') = (endereco IS NOT NULL)),
  ADD CONSTRAINT contas_de_ia_credencial_do_provedor CHECK (
    (provedor = 'anthropic')
    OR (provedor = 'compativel_openai' AND credencial = 'chave_de_api')
    OR (provedor = 'chatgpt' AND credencial = 'assinatura')
  ),
  ADD CONSTRAINT contas_de_ia_aceite_da_assinatura CHECK (
    CASE WHEN credencial = 'assinatura'
      THEN termos_aceitos_por IS NOT NULL AND termos_aceitos_em IS NOT NULL AND versao_do_aviso IS NOT NULL
           AND teto_mensal IS NULL
      ELSE termos_aceitos_por IS NULL AND termos_aceitos_em IS NULL AND versao_do_aviso IS NULL
           AND limite_do_plano_ate IS NULL
    END
  ),
  ADD CONSTRAINT contas_de_ia_quem_aceitou FOREIGN KEY (empresa_id, termos_aceitos_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id);
COMMENT ON COLUMN public.contas_de_ia.credencial IS '[empresa] chave_de_api (cobrada por uso) ou assinatura (o login de um plano, M4-10).';
COMMENT ON COLUMN public.contas_de_ia.termos_aceitos_por IS '[sistema] Assinatura: quem aceitou o aviso dos termos do provedor.';
COMMENT ON COLUMN public.contas_de_ia.termos_aceitos_em IS '[sistema] Assinatura: quando o aviso foi aceito.';
COMMENT ON COLUMN public.contas_de_ia.versao_do_aviso IS '[sistema] Assinatura: a versão do aviso que foi aceita.';
COMMENT ON COLUMN public.contas_de_ia.limite_do_plano_ate IS '[sistema] Assinatura: o limite do plano acabou e volta nesta hora.';

-- Down Migration

UPDATE public.agentes SET modelo_principal_conta_id = NULL, modelo_principal = NULL
  WHERE modelo_principal_conta_id IN (SELECT id FROM public.contas_de_ia WHERE credencial = 'assinatura');
UPDATE public.agentes SET modelo_reserva_conta_id = NULL, modelo_reserva = NULL
  WHERE modelo_reserva_conta_id IN (SELECT id FROM public.contas_de_ia WHERE credencial = 'assinatura');
DELETE FROM public.contas_de_ia WHERE credencial = 'assinatura';
ALTER TABLE public.contas_de_ia
  DROP CONSTRAINT contas_de_ia_quem_aceitou,
  DROP CONSTRAINT contas_de_ia_aceite_da_assinatura,
  DROP CONSTRAINT contas_de_ia_credencial_do_provedor,
  DROP CONSTRAINT contas_de_ia_endereco_do_provedor,
  DROP CONSTRAINT contas_de_ia_chave_cifrada_check,
  DROP CONSTRAINT contas_de_ia_provedor_check,
  DROP COLUMN limite_do_plano_ate,
  DROP COLUMN versao_do_aviso,
  DROP COLUMN termos_aceitos_em,
  DROP COLUMN termos_aceitos_por,
  DROP COLUMN credencial,
  ADD CONSTRAINT contas_de_ia_provedor_check CHECK (provedor IN ('anthropic', 'compativel_openai')),
  ADD CONSTRAINT contas_de_ia_chave_cifrada_check CHECK (octet_length(chave_cifrada) BETWEEN 36 AND 430),
  ADD CONSTRAINT contas_de_ia_endereco_do_provedor CHECK ((provedor = 'compativel_openai') = (endereco IS NOT NULL));
