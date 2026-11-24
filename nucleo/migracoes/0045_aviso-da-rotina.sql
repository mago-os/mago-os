-- Rotinas (M5-05/M5-06, pedido do Sandro em 24/11/2026): o dono pode pedir um aviso cada vez que a rotina roda.
-- 1. rotinas.avisar_ao_rodar (desligado por padrão).
-- 2. Tipo de aviso novo: rotina_rodou.
-- Explicado em docs/banco/decisoes.md, seção 50.

-- Up Migration

ALTER TABLE public.rotinas ADD COLUMN avisar_ao_rodar boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.rotinas.avisar_ao_rodar IS
  '[empresa] O dono recebe um aviso cada vez que a rotina roda e termina bem (a falha avisa sempre).';

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'rotina_rodou';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada'));
ALTER TABLE public.rotinas DROP COLUMN avisar_ao_rodar;
