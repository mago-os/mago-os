-- M1-06: perfis e permissões por módulo.
--
-- 1. O funcionário pode ter área (a equipe dele); o administrador não tem área (vê a empresa toda).
-- 2. Ajustes de permissão por pessoa e por módulo, feitos pelo administrador, isolados por empresa como o resto.
--    O cálculo (perfil + ajustes) e a verificação ficam no núcleo (nucleo/src/permissoes), usados por toda rota.
-- Explicado em docs/banco/decisoes.md, seção 11, e na decisão 0012.

-- Up Migration

ALTER TABLE public.vinculos DROP CONSTRAINT vinculos_area_do_gestor;
ALTER TABLE public.vinculos ADD CONSTRAINT vinculos_area_do_perfil CHECK (
  (perfil <> 'gestor_area' OR area IS NOT NULL) AND (perfil <> 'administrador' OR area IS NULL)
);
COMMENT ON COLUMN public.vinculos.area IS
  '[empresa] Área da pessoa (ex.: comercial). O gestor cuida dela; o funcionário faz parte dela (a equipe); o administrador não tem.';

CREATE TABLE public.ajustes_de_permissao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  vinculo_id uuid NOT NULL REFERENCES public.vinculos (id) ON DELETE CASCADE,
  modulo text NOT NULL CHECK (modulo ~ '^[a-z][a-z0-9_]{1,39}$'),
  acao text NOT NULL CHECK (acao IN ('ver', 'criar', 'editar', 'aprovar', 'excluir', 'ver_sensiveis')),
  alcance text NOT NULL CHECK (alcance IN ('nada', 'meus', 'equipe', 'tudo')),
  feito_por uuid NOT NULL REFERENCES public.pessoas (id),
  feito_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ajustes_um_por_acao UNIQUE (vinculo_id, modulo, acao),
  CONSTRAINT ajustes_sensiveis_tudo_ou_nada CHECK (acao <> 'ver_sensiveis' OR alcance IN ('nada', 'tudo'))
);
CREATE INDEX ajustes_da_empresa ON public.ajustes_de_permissao (empresa_id, vinculo_id);
COMMENT ON TABLE public.ajustes_de_permissao IS
  'Ajustes que o administrador faz nas permissões de uma pessoa, por módulo e ação, por cima do perfil dela.';
COMMENT ON COLUMN public.ajustes_de_permissao.id IS '[sistema] Identificador do ajuste (UUID v7).';
COMMENT ON COLUMN public.ajustes_de_permissao.empresa_id IS '[sistema] Empresa do ajuste.';
COMMENT ON COLUMN public.ajustes_de_permissao.vinculo_id IS '[sistema] Vínculo (pessoa na empresa) ajustado.';
COMMENT ON COLUMN public.ajustes_de_permissao.modulo IS '[empresa] Módulo ajustado (ex.: crm, pessoas).';
COMMENT ON COLUMN public.ajustes_de_permissao.acao IS '[empresa] Ação ajustada: ver, criar, editar, aprovar, excluir ou ver_sensiveis.';
COMMENT ON COLUMN public.ajustes_de_permissao.alcance IS '[empresa] Alcance dado: nada, meus (itens), equipe ou tudo.';
COMMENT ON COLUMN public.ajustes_de_permissao.feito_por IS '[sistema] Pessoa que fez o ajuste.';
COMMENT ON COLUMN public.ajustes_de_permissao.feito_em IS '[sistema] Quando o ajuste foi feito.';

ALTER TABLE public.ajustes_de_permissao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ajustes_de_permissao FORCE ROW LEVEL SECURITY;
-- Isolados por empresa. Quem pode mudar (o administrador) é conferido pelo núcleo, na verificação central.
CREATE POLICY ajustes_da_empresa_ativa ON public.ajustes_de_permissao
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Down Migration

DROP TABLE public.ajustes_de_permissao;
ALTER TABLE public.vinculos DROP CONSTRAINT vinculos_area_do_perfil;
UPDATE public.vinculos SET area = NULL WHERE perfil <> 'gestor_area';
ALTER TABLE public.vinculos ADD CONSTRAINT vinculos_area_do_gestor CHECK ((perfil = 'gestor_area') = (area IS NOT NULL));
COMMENT ON COLUMN public.vinculos.area IS '[empresa] Área que o gestor cuida (ex.: comercial). Só o gestor de área tem.';
