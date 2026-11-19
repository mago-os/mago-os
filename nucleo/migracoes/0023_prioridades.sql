-- M3-07: central de prioridades (contrato em contratos/src/tarefas/prioridades.ts).
--
-- A lista é calculada na hora a partir das tarefas, menções e avisos. Aqui fica só o que a pessoa fez com cada item:
-- adiou (até um momento) ou resolveu. É pessoal: além do isolamento por empresa, o banco só mostra a cada pessoa os
-- itens dela (pessoa_ativa()). A chave do item já muda quando a situação muda (o prazo entra na chave da tarefa).
-- Explicado em docs/banco/decisoes.md, seção 27.

-- Up Migration

CREATE TABLE public.estados_de_prioridade (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  chave text NOT NULL CHECK (length(chave) BETWEEN 1 AND 160),
  adiado_ate timestamptz,
  resolvido_em timestamptz,
  mudou_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, pessoa_id, chave),
  CONSTRAINT estado_adiado_ou_resolvido CHECK ((adiado_ate IS NULL) <> (resolvido_em IS NULL)),
  CONSTRAINT estados_da_pessoa_na_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.estados_de_prioridade IS 'O que cada pessoa fez com os itens da central de prioridades: adiou ou resolveu. Só a dona vê.';
COMMENT ON COLUMN public.estados_de_prioridade.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.estados_de_prioridade.pessoa_id IS '[sistema] Pessoa dona do item.';
COMMENT ON COLUMN public.estados_de_prioridade.chave IS '[sistema] Chave do item (tarefa e prazo, menção ou aviso).';
COMMENT ON COLUMN public.estados_de_prioridade.adiado_ate IS '[pessoal] Até quando o item fica escondido (volta nesse momento).';
COMMENT ON COLUMN public.estados_de_prioridade.resolvido_em IS '[pessoal] Quando a pessoa marcou como resolvido.';
COMMENT ON COLUMN public.estados_de_prioridade.mudou_em IS '[sistema] Quando a pessoa adiou ou resolveu.';

ALTER TABLE public.estados_de_prioridade ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_de_prioridade FORCE ROW LEVEL SECURITY;
CREATE POLICY estados_da_pessoa_ativa ON public.estados_de_prioridade
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa());

-- Aviso lido (no sino ou na central) também avisa as telas da pessoa, para as duas ficarem iguais sem recarregar.
CREATE TRIGGER avisos_lidos_avisam AFTER UPDATE OF lido_em ON public.avisos
  FOR EACH ROW WHEN (old.lido_em IS DISTINCT FROM new.lido_em) EXECUTE FUNCTION public.avisar_mudanca();

-- Down Migration

DROP TRIGGER avisos_lidos_avisam ON public.avisos;
DROP TABLE public.estados_de_prioridade;
