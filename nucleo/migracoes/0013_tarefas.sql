-- M2-01: tarefas simples e comentários (contrato em contratos/src/tarefas/tarefa.ts).
--
-- 1. Cada tarefa é de uma empresa e fica isolada pelo Row Level Security, como o resto.
-- 2. Responsável, quem criou, quem pegou (trava, M2-02) e quem entregou o resultado são uma pessoa ou um agente.
--    Cada um vira duas colunas (pessoa e agente), no máximo uma preenchida, para o banco conferir as referências.
--    A pessoa precisa ter vínculo com a mesma empresa (chave composta com vinculos). A referência para agentes
--    entra na M2-03, junto com a tabela de agentes.
-- 3. As regras do contrato (encerrada tem data, resultado só ao concluir, trava só em andamento) ficam também no
--    banco, para nenhum caminho do código escapar delas.
-- 4. Comentários só se acrescentam: a API não muda nem apaga (sai junto só quando a tarefa é excluída).
-- Explicado em docs/banco/decisoes.md, seção 17.

-- Up Migration

CREATE TABLE public.tarefas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 200),
  descricao text CHECK (length(trim(descricao)) BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'a_fazer'
    CHECK (status IN ('a_fazer', 'em_andamento', 'precisa_de_ajuda', 'concluida', 'cancelada')),
  responsavel_pessoa_id uuid,
  responsavel_agente_id uuid,
  criada_por_pessoa_id uuid,
  criada_por_agente_id uuid,
  travada_por_pessoa_id uuid,
  travada_por_agente_id uuid,
  travada_em timestamptz,
  resultado text CHECK (length(trim(resultado)) BETWEEN 1 AND 50000),
  resultado_por_pessoa_id uuid,
  resultado_por_agente_id uuid,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  encerrada_em timestamptz,
  CONSTRAINT tarefas_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT tarefas_responsavel_da_empresa FOREIGN KEY (empresa_id, responsavel_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT tarefas_criador_da_empresa FOREIGN KEY (empresa_id, criada_por_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT tarefas_trava_da_empresa FOREIGN KEY (empresa_id, travada_por_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT tarefas_entrega_da_empresa FOREIGN KEY (empresa_id, resultado_por_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT tarefas_um_responsavel CHECK (num_nonnulls(responsavel_pessoa_id, responsavel_agente_id) <= 1),
  CONSTRAINT tarefas_um_criador CHECK (num_nonnulls(criada_por_pessoa_id, criada_por_agente_id) <= 1),
  CONSTRAINT tarefas_trava_completa CHECK (
    num_nonnulls(travada_por_pessoa_id, travada_por_agente_id) = (CASE WHEN travada_em IS NULL THEN 0 ELSE 1 END)),
  CONSTRAINT tarefas_trava_so_em_andamento CHECK (
    travada_em IS NULL OR status IN ('em_andamento', 'precisa_de_ajuda')),
  CONSTRAINT tarefas_resultado_diz_quem CHECK (
    num_nonnulls(resultado_por_pessoa_id, resultado_por_agente_id) = (CASE WHEN resultado IS NULL THEN 0 ELSE 1 END)),
  CONSTRAINT tarefas_resultado_so_concluida CHECK (resultado IS NULL OR status = 'concluida'),
  CONSTRAINT tarefas_data_de_encerramento CHECK (
    (status IN ('concluida', 'cancelada')) = (encerrada_em IS NOT NULL))
);
CREATE INDEX tarefas_por_status ON public.tarefas (empresa_id, status, atualizada_em DESC);
CREATE INDEX tarefas_por_responsavel ON public.tarefas (empresa_id, responsavel_pessoa_id);
CREATE INDEX tarefas_por_agente ON public.tarefas (empresa_id, responsavel_agente_id);
CREATE INDEX tarefas_por_criador ON public.tarefas (empresa_id, criada_por_pessoa_id);
COMMENT ON TABLE public.tarefas IS
  'Tarefas da empresa, feitas por pessoas ou agentes. Status fixos no M2; espaços, projetos e prazos vêm no M3.';
COMMENT ON COLUMN public.tarefas.id IS '[sistema] Identificador da tarefa (UUID v7).';
COMMENT ON COLUMN public.tarefas.empresa_id IS '[sistema] Empresa da tarefa.';
COMMENT ON COLUMN public.tarefas.titulo IS '[empresa] O que precisa ser feito, numa linha.';
COMMENT ON COLUMN public.tarefas.descricao IS '[empresa] Detalhes, contexto e o que se espera.';
COMMENT ON COLUMN public.tarefas.status IS '[empresa] a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada.';
COMMENT ON COLUMN public.tarefas.responsavel_pessoa_id IS '[sistema] Pessoa responsável (com vínculo na empresa), quando é uma pessoa.';
COMMENT ON COLUMN public.tarefas.responsavel_agente_id IS '[sistema] Agente responsável, quando é um agente (referência na M2-03).';
COMMENT ON COLUMN public.tarefas.criada_por_pessoa_id IS '[sistema] Pessoa que criou a tarefa.';
COMMENT ON COLUMN public.tarefas.criada_por_agente_id IS '[sistema] Agente que criou a tarefa. Os dois vazios: criada pelo sistema.';
COMMENT ON COLUMN public.tarefas.travada_por_pessoa_id IS '[sistema] Pessoa que pegou a tarefa (trava, M2-02).';
COMMENT ON COLUMN public.tarefas.travada_por_agente_id IS '[sistema] Agente que pegou a tarefa (trava, M2-02).';
COMMENT ON COLUMN public.tarefas.travada_em IS '[sistema] Desde quando a tarefa está pegada.';
COMMENT ON COLUMN public.tarefas.resultado IS '[empresa] O que o responsável entregou ao concluir. Se veio de agente, é mostrado só como texto.';
COMMENT ON COLUMN public.tarefas.resultado_por_pessoa_id IS '[sistema] Pessoa que entregou o resultado.';
COMMENT ON COLUMN public.tarefas.resultado_por_agente_id IS '[sistema] Agente que entregou o resultado.';
COMMENT ON COLUMN public.tarefas.criada_em IS '[sistema] Quando a tarefa foi criada.';
COMMENT ON COLUMN public.tarefas.atualizada_em IS '[sistema] Última mudança na tarefa (inclui comentários).';
COMMENT ON COLUMN public.tarefas.encerrada_em IS '[sistema] Quando foi concluída ou cancelada.';

ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefas FORCE ROW LEVEL SECURITY;
-- Isoladas por empresa. Quem vê e mexe em quais tarefas (as próprias, da equipe, todas) é a verificação central.
CREATE POLICY tarefas_da_empresa_ativa ON public.tarefas
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.comentarios_de_tarefa (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  autor_pessoa_id uuid,
  autor_agente_id uuid,
  texto text NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 10000),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comentarios_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT comentarios_autor_da_empresa FOREIGN KEY (empresa_id, autor_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT comentarios_um_autor CHECK (num_nonnulls(autor_pessoa_id, autor_agente_id) <= 1)
);
CREATE INDEX comentarios_por_tarefa ON public.comentarios_de_tarefa (empresa_id, tarefa_id, criado_em);
COMMENT ON TABLE public.comentarios_de_tarefa IS
  'Comentários nas tarefas. Só se acrescentam: não se editam nem se apagam no M2.';
COMMENT ON COLUMN public.comentarios_de_tarefa.id IS '[sistema] Identificador do comentário (UUID v7).';
COMMENT ON COLUMN public.comentarios_de_tarefa.empresa_id IS '[sistema] Empresa do comentário (a mesma da tarefa).';
COMMENT ON COLUMN public.comentarios_de_tarefa.tarefa_id IS '[sistema] Tarefa comentada.';
COMMENT ON COLUMN public.comentarios_de_tarefa.autor_pessoa_id IS '[sistema] Pessoa que comentou.';
COMMENT ON COLUMN public.comentarios_de_tarefa.autor_agente_id IS '[sistema] Agente que comentou. Os dois vazios: comentário do sistema.';
COMMENT ON COLUMN public.comentarios_de_tarefa.texto IS '[empresa] O comentário, em texto simples. Se veio de agente, é mostrado só como texto.';
COMMENT ON COLUMN public.comentarios_de_tarefa.criado_em IS '[sistema] Quando foi comentado.';

ALTER TABLE public.comentarios_de_tarefa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comentarios_de_tarefa FORCE ROW LEVEL SECURITY;
CREATE POLICY comentarios_da_empresa_ativa ON public.comentarios_de_tarefa
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE, DELETE ON public.comentarios_de_tarefa FROM mago_app;

-- Down Migration

DROP TABLE public.comentarios_de_tarefa;
DROP TABLE public.tarefas;
