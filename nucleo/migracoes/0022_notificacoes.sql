-- M3-06: notificações. Os avisos da M2-04 passam a valer para as tarefas; seguidores; assinaturas de push;
-- preferências; e as marcas de prazo já avisado. Contrato em contratos/src/avisos/notificacoes.ts.
--
-- 1. avisos ganha os tipos de tarefa e a tarefa do aviso (some junto com ela). Aviso novo avisa a tela pelo tempo real.
-- 2. seguidores_de_tarefa: quem segue a tarefa (recebe os comentários dela).
-- 3. assinaturas_de_push: o push de cada aparelho (padrão Web Push), ligado ao aparelho do login: aparelho
--    desconectado ou apagado deixa de receber. As chaves do navegador são sensíveis e nunca saem do servidor.
-- 4. preferencias_de_notificacao: o que chega por onde e o horário de silêncio, por pessoa e empresa.
-- 5. tarefas: quando o aviso de "vence hoje" e o de "venceu" já foram mandados (mudar o prazo apaga as marcas).
-- Explicado em docs/banco/decisoes.md, seção 26.

-- Up Migration

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos
  ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
    'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
    'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido')),
  ADD COLUMN tarefa_id uuid,
  ADD COLUMN push_pendente boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT avisos_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE;
CREATE INDEX avisos_com_push_pendente ON public.avisos (empresa_id) WHERE push_pendente;
COMMENT ON COLUMN public.avisos.push_pendente IS '[sistema] O push deste aviso ainda vai sair (a verificação a cada minuto manda, fora do horário de silêncio).';
CREATE INDEX avisos_por_tarefa ON public.avisos (empresa_id, tarefa_id) WHERE tarefa_id IS NOT NULL;
COMMENT ON TABLE public.avisos IS 'Avisos (notificações) para uma pessoa: no sino e, se ela quiser, no push.';
COMMENT ON COLUMN public.avisos.tipo IS '[sistema] Tipo do aviso (agente_*, tarefa_atribuida, mencao, comentario, resultado_entregue, precisa_de_ajuda, prazo_hoje, prazo_vencido).';
COMMENT ON COLUMN public.avisos.tarefa_id IS '[sistema] Tarefa do aviso, quando é de uma tarefa (o aviso some junto com ela).';
CREATE TRIGGER avisos_avisam AFTER INSERT ON public.avisos FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();

CREATE TABLE public.seguidores_de_tarefa (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  desde timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tarefa_id, pessoa_id),
  CONSTRAINT seguidores_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT seguidores_da_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
CREATE INDEX seguidores_por_pessoa ON public.seguidores_de_tarefa (empresa_id, pessoa_id);
COMMENT ON TABLE public.seguidores_de_tarefa IS 'Quem segue cada tarefa (recebe aviso dos comentários). Quem cria, o responsável e quem é mencionado seguem sozinhos.';
COMMENT ON COLUMN public.seguidores_de_tarefa.empresa_id IS '[sistema] Empresa (a mesma da tarefa).';
COMMENT ON COLUMN public.seguidores_de_tarefa.tarefa_id IS '[sistema] Tarefa seguida.';
COMMENT ON COLUMN public.seguidores_de_tarefa.pessoa_id IS '[sistema] Pessoa que segue.';
COMMENT ON COLUMN public.seguidores_de_tarefa.desde IS '[sistema] Desde quando segue.';
ALTER TABLE public.seguidores_de_tarefa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguidores_de_tarefa FORCE ROW LEVEL SECURITY;
CREATE POLICY seguidores_da_empresa_ativa ON public.seguidores_de_tarefa
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE ON public.seguidores_de_tarefa FROM mago_app;

CREATE TABLE public.assinaturas_de_push (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  aparelho_id uuid NOT NULL REFERENCES acesso.aparelhos (id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 200),
  auth text NOT NULL CHECK (length(auth) BETWEEN 1 AND 100),
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_envio_em timestamptz,
  CONSTRAINT assinaturas_da_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT assinaturas_uma_por_aparelho UNIQUE (empresa_id, pessoa_id, aparelho_id)
);
COMMENT ON TABLE public.assinaturas_de_push IS 'Push ligado em cada aparelho (Web Push). Desconectar ou apagar o aparelho apaga a assinatura.';
COMMENT ON COLUMN public.assinaturas_de_push.id IS '[sistema] Identificador da assinatura (UUID v7).';
COMMENT ON COLUMN public.assinaturas_de_push.empresa_id IS '[sistema] Empresa cujos avisos vão para este aparelho.';
COMMENT ON COLUMN public.assinaturas_de_push.pessoa_id IS '[sistema] Pessoa dona do aparelho.';
COMMENT ON COLUMN public.assinaturas_de_push.aparelho_id IS '[sistema] Aparelho do login (o mesmo da tela Meus aparelhos).';
COMMENT ON COLUMN public.assinaturas_de_push.endpoint IS '[sensivel] Endereço de entrega do serviço de push do navegador.';
COMMENT ON COLUMN public.assinaturas_de_push.p256dh IS '[sensivel] Chave pública do navegador para cifrar a mensagem.';
COMMENT ON COLUMN public.assinaturas_de_push.auth IS '[sensivel] Segredo de autenticação do navegador.';
COMMENT ON COLUMN public.assinaturas_de_push.criada_em IS '[sistema] Quando o push foi ligado neste aparelho.';
COMMENT ON COLUMN public.assinaturas_de_push.ultimo_envio_em IS '[sistema] Último push entregue.';
ALTER TABLE public.assinaturas_de_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas_de_push FORCE ROW LEVEL SECURITY;
CREATE POLICY assinaturas_da_empresa_ativa ON public.assinaturas_de_push
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.preferencias_de_notificacao (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  preferencias jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(preferencias) = 'object'),
  atualizadas_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, pessoa_id),
  CONSTRAINT preferencias_da_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.preferencias_de_notificacao IS 'O que chega por onde (sino, push) e o horário de silêncio de cada pessoa na empresa.';
COMMENT ON COLUMN public.preferencias_de_notificacao.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.preferencias_de_notificacao.pessoa_id IS '[sistema] Pessoa.';
COMMENT ON COLUMN public.preferencias_de_notificacao.preferencias IS '[pessoal] Preferências (contrato PreferenciasDeNotificacao).';
COMMENT ON COLUMN public.preferencias_de_notificacao.atualizadas_em IS '[sistema] Última mudança.';
ALTER TABLE public.preferencias_de_notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preferencias_de_notificacao FORCE ROW LEVEL SECURITY;
CREATE POLICY preferencias_da_empresa_ativa ON public.preferencias_de_notificacao
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

ALTER TABLE public.tarefas
  ADD COLUMN avisou_prazo_hoje_em timestamptz,
  ADD COLUMN avisou_prazo_vencido_em timestamptz;
COMMENT ON COLUMN public.tarefas.avisou_prazo_hoje_em IS '[sistema] Quando o aviso de "vence hoje" foi mandado (mudar o prazo apaga).';
COMMENT ON COLUMN public.tarefas.avisou_prazo_vencido_em IS '[sistema] Quando o aviso de "venceu" foi mandado (mudar o prazo apaga).';

-- Para as verificações a cada minuto: as empresas com push para mandar e as tarefas com prazo para avisar
-- (vence hoje no fuso do responsável, ou já venceu). Devolvem só ids; o trabalho em cada empresa roda com a
-- empresa dela.
CREATE FUNCTION public.empresas_com_push_pendente()
  RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT a.empresa_id FROM public.avisos a WHERE a.push_pendente
  $$;
COMMENT ON FUNCTION public.empresas_com_push_pendente() IS 'Para a verificação a cada minuto: empresas com push para mandar. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_push_pendente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_push_pendente() TO mago_app;

CREATE FUNCTION public.empresas_com_prazo_para_avisar()
  RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT t.empresa_id FROM public.tarefas t
     WHERE t.prazo_em IS NOT NULL AND t.status NOT IN ('concluida', 'cancelada')
       AND ((t.avisou_prazo_vencido_em IS NULL AND t.prazo_em < now())
            OR (t.avisou_prazo_hoje_em IS NULL AND t.prazo_em < now() + interval '1 day'))
  $$;
COMMENT ON FUNCTION public.empresas_com_prazo_para_avisar() IS 'Para a verificação de prazos: empresas com tarefa vencendo ou vencida sem aviso. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_prazo_para_avisar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_prazo_para_avisar() TO mago_app;

-- O aparelho ainda tem uma sessão aberta da pessoa (desconectado não recebe push). A API não lê acesso.sessoes.
CREATE FUNCTION public.aparelho_conectado(aparelho uuid, pessoa uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM acesso.sessoes s WHERE s.aparelho_id = aparelho AND s.pessoa_id = pessoa)
  $$;
COMMENT ON FUNCTION public.aparelho_conectado(uuid, uuid) IS 'O aparelho tem sessão aberta da pessoa (para o push não ir a aparelho desconectado).';
REVOKE EXECUTE ON FUNCTION public.aparelho_conectado(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aparelho_conectado(uuid, uuid) TO mago_app;

-- Mudou o prazo: os avisos de prazo valem de novo.
CREATE OR REPLACE FUNCTION public.calcular_prazo() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.prazo_dia IS NULL THEN
      NEW.prazo_hora := NULL;
      NEW.prazo_fuso := NULL;
      NEW.prazo_em := NULL;
    ELSE
      NEW.prazo_em := (NEW.prazo_dia + coalesce(NEW.prazo_hora, time '23:59')) AT TIME ZONE NEW.prazo_fuso;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.prazo_em IS DISTINCT FROM OLD.prazo_em THEN
      NEW.avisou_prazo_hoje_em := NULL;
      NEW.avisou_prazo_vencido_em := NULL;
    END IF;
    RETURN NEW;
  END
  $$;

-- Tempo real: o aviso novo avisa a tela da pessoa (tipo "aviso"; a tela busca os avisos dela pela rota).
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME IN ('comentarios_de_tarefa', 'itens_de_checklist', 'etiquetas_de_tarefa', 'acontecimentos_de_tarefa') THEN
      tipo := 'tarefa';
      id := linha.tarefa_id;
    ELSIF TG_TABLE_NAME = 'tarefas' THEN
      tipo := 'tarefa';
      id := linha.id;
    ELSIF TG_TABLE_NAME IN ('membros_de_projeto', 'listas', 'status_de_projeto') THEN
      tipo := 'projeto';
      id := linha.projeto_id;
    ELSIF TG_TABLE_NAME IN ('projetos', 'espacos') THEN
      tipo := 'projeto';
      id := linha.id;
    ELSIF TG_TABLE_NAME = 'avisos' THEN
      tipo := 'aviso';
      id := linha.pessoa_id;
    ELSE
      tipo := 'agente';
      id := linha.id;
    END IF;
    PERFORM pg_notify('mago_mudancas',
      json_build_object('empresaId', linha.empresa_id, 'tipo', tipo, 'id', id, 'operacao', lower(TG_OP))::text);
    RETURN NULL;
  END
  $$;

-- Down Migration

DROP FUNCTION public.aparelho_conectado(uuid, uuid);
DROP FUNCTION public.empresas_com_prazo_para_avisar();
DROP FUNCTION public.empresas_com_push_pendente();
CREATE OR REPLACE FUNCTION public.calcular_prazo() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.prazo_dia IS NULL THEN
      NEW.prazo_hora := NULL;
      NEW.prazo_fuso := NULL;
      NEW.prazo_em := NULL;
    ELSE
      NEW.prazo_em := (NEW.prazo_dia + coalesce(NEW.prazo_hora, time '23:59')) AT TIME ZONE NEW.prazo_fuso;
    END IF;
    RETURN NEW;
  END
  $$;
ALTER TABLE public.tarefas DROP COLUMN avisou_prazo_vencido_em, DROP COLUMN avisou_prazo_hoje_em;
DROP TABLE public.preferencias_de_notificacao;
DROP TABLE public.assinaturas_de_push;
DROP TABLE public.seguidores_de_tarefa;
DROP TRIGGER avisos_avisam ON public.avisos;
DROP INDEX public.avisos_por_tarefa;
DROP INDEX public.avisos_com_push_pendente;
DELETE FROM public.avisos WHERE tipo NOT IN ('agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado');
ALTER TABLE public.avisos
  DROP CONSTRAINT avisos_da_tarefa,
  DROP COLUMN tarefa_id,
  DROP COLUMN push_pendente,
  DROP CONSTRAINT avisos_tipo_check,
  ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN ('agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado'));
COMMENT ON TABLE public.avisos IS 'Avisos para uma pessoa dentro do Mago OS, mostrados no Início até ela marcar como lido.';
COMMENT ON COLUMN public.avisos.tipo IS '[sistema] agente_sem_sinal, agente_passou_do_limite ou agente_desligado.';
