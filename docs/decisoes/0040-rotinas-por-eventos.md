# 0040 Rotinas por eventos do sistema

- **Data:** 23/11/2026
- **Situação:** proposta (aguardando o "aprovado" do Sandro)
- **Tarefa:** M5-06

## Contexto

A M5-05 ([decisão 0039](0039-rotinas-por-horario.md)) trouxe as rotinas por horário. A M5-06 dispara a mesma rotina quando algo acontece no sistema, como "quando uma tarefa do projeto Blog for concluída, criar a tarefa de revisão para a Ana". As decisões 12 e 13 da spec do M5, aprovadas em 22/11/2026, deram os eventos, os filtros simples e a regra contra rotina em círculo. Esta nota acerta o que falta para construir.

## Decisão

1. **Os eventos.** Tarefa criada, tarefa concluída, tarefa mudou de status, tarefa atrasada (o prazo passou), tarefa precisa de ajuda, comentário numa tarefa e aprovação pedida por um agente. Tudo o que vale para a rotina por horário vale aqui: o dono, as três ações, "só o dono faz agir", os limites e as falhas.
2. **Filtros simples.** Projeto, lista, etiqueta, prioridade, responsável e status (o status depois do evento). Todos os informados precisam bater. Sem condições livres na Fase 1.
3. **Só o que o dono vê.** O evento só dispara a rotina se o dono pode ver a tarefa, pela permissão real dele na hora do evento. Isso vale também para a aprovação pedida: ela precisa ser de uma tarefa que o dono vê.
4. **A tarefa que disparou chega na ação.**
   - Nos textos (título e descrição da tarefa criada, pedido ao agente, aviso), o marcador `{tarefa}` vira o título da tarefa que disparou. Exemplo: "Revisar: {tarefa}".
   - Criar tarefa ganha a opção "como subtarefa da que disparou". Se a que disparou já for uma subtarefa, a nova fica ao lado dela, na mesma tarefa-mãe.
   - O pedido ao agente leva também o id da tarefa, para ele abrir com ver_tarefa. O aviso leva o link da tarefa.
5. **Texto de outros (M4-04).** O título e o comentário da tarefa que disparou são escritos por outras pessoas. Quando a ação pede a um agente, o pedido dele marca a execução como "leu texto de outros" se a tarefa ou o comentário não forem do dono. A partir daí, o que muda dados pede aprovação, como já acontece na conversa.
6. **Sem rotina em círculo.** Um evento causado por uma rotina (a tarefa que ela criou, o comentário do agente que ela chamou, o status que ele mudou) não dispara nenhuma rotina. Valem também o limite de 24 execuções por dia e o de 3 disparos por minuto por rotina. Passou do limite, a execução fica "pulada", com o motivo.
7. **Nenhum evento se perde nem roda duas vezes.** Os eventos são gravados pelo próprio banco, na mesma transação da mudança na tarefa, numa fila de eventos. A verificação a cada minuto (a mesma da M5-05) acha as rotinas que batem e cria uma execução por evento e rotina, uma vez só. A rotina ligada depois do evento não pega eventos antigos.
8. **Fila em vez de pulo.** Na rotina por evento, se a execução anterior da mesma rotina ainda está rodando, a nova espera na fila, em vez de ficar "pulada" como na rotina por horário. Cada evento é uma coisa diferente.
9. **Tarefa atrasada.** Dispara uma vez quando o prazo passa, na mesma verificação que já avisa os prazos vencidos. Se o prazo mudar e passar de novo, dispara de novo.
10. **"Rodar agora" na rotina por evento.** O dono escolhe com qual tarefa testar. Sem escolher, vale a mais recente que ele vê e que passa nos filtros. Sem nenhuma, a tela explica.
11. **Ferramentas dos agentes.** criar_rotina aceita também o gatilho por evento, com a mesma aprovação por padrão. A descrição da ferramenta mudou, e a assinatura congelada também.
12. **Tela.** No formulário, "Quando" ganha a escolha entre "No horário" e "Quando acontecer", com o evento e os filtros (projeto, prioridade, status, responsável). O histórico mostra a tarefa que disparou, com o link.

## O que foi descartado

- **Condições livres** ("se o título contém X"): ficam para a Fase 2.
- **Corrente de até 3 rotinas** (decisão 13): a regra "evento de rotina não dispara rotina" é mais simples e fecha o círculo de vez.
- **Disparar na hora, dentro da requisição:** deixaria a tela mais lenta e perderia o evento se o servidor caísse no meio. A fila no banco com a verificação a cada minuto garante a entrega, com até um minuto de atraso.

## Consequências

- Contratos: `GatilhoPorEvento`, `EVENTOS_DE_ROTINA`, `FiltrosDoEvento`, `MARCADOR_DA_TAREFA`, `MAXIMO_DE_DISPAROS_POR_MINUTO`, `comoSubtarefa` em criar tarefa, a origem "evento" com a tarefa e o evento na execução, e `PedidoParaRodarAgora`, em `contratos/src/rotinas/rotinas.ts`.
- Banco: a fila de eventos das rotinas (`eventos_para_rotinas`), alimentada por gatilhos nas tarefas, nos comentários e nas aprovações, com a marca do que foi causado por uma rotina; e os campos novos da execução.
- Pronto quando: a rotina "quando uma tarefa do projeto Blog for concluída, criar a tarefa de revisão para a Ana" dispara sozinha quando o Sandro conclui uma tarefa do Blog.
