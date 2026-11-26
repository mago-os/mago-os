# 0049 Aviso imediato aos agentes externos

- **Data:** 26/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 26/11/2026, com os dois pontos recomendados)
- **Tarefa:** M7-04

## Contexto

Hoje o agente externo (Hermes, Claude no Mac) pergunta a cada minuto (`minhas_tarefas`) se há trabalho novo. A spec
do M7 pede o aviso na hora, por webhook, com a pergunta de cada minuto como reserva. Os webhooks de saída (M7-03,
decisão 0048) já fazem a entrega assinada, com número único e novas tentativas. Esta nota acerta como reaproveitar. Os
pontos que pedem o olho do Sandro estão marcados com **pede o seu olho**.

## Decisão

1. **O mesmo caminho dos webhooks.** O endereço de aviso do agente é um webhook ligado a ele: a mesma assinatura
   (`mago-assinatura`), o número único, as novas tentativas por cerca de 20 horas, o histórico de 30 dias e o
   desligamento depois de 3 dias falhando. Ele não aparece na tela Webhooks: fica na tela do agente.
2. **Na tela do agente externo.** Um campo opcional "Endereço de aviso" (https público), com o segredo mostrado uma
   vez, os botões Mandar teste, Trocar segredo e Desligar, e as últimas entregas. Quem edita o agente cuida do aviso
   dele (padrão: o administrador). Cada agente tem o próprio segredo.
3. **Os três eventos.**
   - `agente.tarefa_recebida`: o agente ficou como responsável por uma tarefa (criada já com ele ou passada a ele).
   - `agente.mencionado`: alguém mencionou o agente com @ num comentário.
   - `agente.aprovacao_respondida`: uma pessoa aprovou ou recusou uma ação que o agente pediu.
4. **O que vai no aviso.** Só os ids (tarefa, comentário ou aprovação) e o id do agente, como nos webhooks. O agente
   busca o resto pelas ferramentas de sempre (`ver_tarefa`, `minhas_tarefas`), com a chave dele e o alcance dele.
5. **A reserva.** A pergunta a cada minuto continua igual. **Pede o seu olho:** recomendo deixar o guia dos agentes
   dizendo "com o aviso ligado, pergunte a cada 5 minutos em vez de a cada minuto", para economizar pedidos sem
   perder nada se um aviso sumir.
6. **Quando o aviso desliga sozinho.** Depois de 3 dias falhando, além dos administradores, a **pessoa responsável
   pelo agente** também recebe o aviso "webhook desligado".
7. **Agente interno.** Não precisa: o coordenador e os especialistas já são acordados na hora pela fila do próprio
   núcleo (M4-04). O campo só aparece no agente externo.
8. **Guias.** `docs/operacao/agentes.md` e o guia do Hermes ganham o passo a passo: ligar o endereço, guardar o
   segredo e conferir a assinatura (com o exemplo em Node.js e em Python).

## O que foi descartado

- **Um canal próprio (WebSocket ou fila) para os agentes:** mais rápido, mas o agente teria que ficar conectado o tempo
  todo; o webhook funciona com o que o Hermes já tem (um servidor HTTP).
- **Mandar o texto da tarefa no aviso:** pela mesma razão da decisão 0048 (um endereço vazado vazaria o conteúdo).

## Consequências

- Contratos: os eventos `agente.*`, o pedido do endereço de aviso e o resumo na tela do agente, em
  `contratos/src/api/webhooks.ts`.
- Banco: `webhooks.agente_id` (o webhook de aviso de um agente, um por agente) e os gatilhos dos três eventos.
- Telas: a parte "Aviso imediato" na página do agente externo.
- Pronto quando: o Hermes recebe o aviso assinado em segundos quando uma tarefa é passada a ele, e uma tarefa
  passada enquanto o endereço dele estava fora do ar chega mesmo assim pela pergunta de reserva.
