# 0025 Regras por ação e aprovações dos agentes

- **Data:** 21/11/2026
- **Situação:** proposta (aguarda o "aprovado" do Sandro nos contratos)
- **Tarefa:** M4-03

## Contexto

Até aqui, um agente fazia tudo o que a ferramenta e a permissão de quem pediu deixavam. A M4-03 dá ao administrador o controle de cada ação: o que o agente faz sozinho, o que pede aprovação e o que fica bloqueado (decisões 6 e 7 da spec do M4).

## Decisão

1. **Ação = ferramenta.** Cada ferramenta que um agente usa (as internas e as do MCP) é uma ação do catálogo (`CATALOGO_DE_ACOES`), com padrão para agente interno e para externo. Um teste barra ferramenta nova sem regra.
2. **Quatro modos**, do mais solto ao mais restrito: `executa`, `executa_nas_dele` (executa nas tarefas que o agente pegou ou de que é responsável, e nas subtarefas delas; nas outras, pede aprovação), `pede_aprovacao` e `bloqueado`.
3. **Padrões (decisão 6):** ler e conversar executam (e nunca pedem aprovação, só podem ser bloqueados); comentar, criar tarefa e passar a um especialista executam; pegar, soltar, mudar status, entregar, criar subtarefa, marcar checklist e planejar executam só nas tarefas do agente; atribuir a outra pessoa pede aprovação. **Externos (decisão 7):** as ferramentas do MCP de hoje executam, para o Claude no Mac e o Hermes não mudarem.
4. **Quem ajusta:** o administrador muda qualquer regra de qualquer agente (Agentes › o agente › Regras); o responsável do agente só deixa mais restrito. Cada mudança vira `agente.mudou_regra`.
5. **Pedido de aprovação:** o agente não executa; o núcleo grava o pedido com os parâmetros exatos, um resumo montado pelo próprio núcleo ("Atribuir 'Exportar os posts' a Ana") e o motivo nas palavras do agente (mostrado só como texto). O agente recebe "pedido de aprovação enviado" e segue o trabalho. O pedido aparece na central de prioridades (o lugar "aprovacao" da M3-07) e no sino de quem pode aprovar.
6. **Quem aprova:** a pessoa em nome de quem o agente agia, a pessoa responsável pelo agente e os administradores. Aprovar (podendo editar os parâmetros, conferidos pelo formato da ferramenta) ou recusar com motivo. A decisão leva o resumo SHA-256 dos parâmetros que a pessoa viu, e o núcleo recusa se não bater.
7. **Execução do aprovado:** o núcleo executa a ferramenta como o agente, com a permissão de quem pediu conferida de novo naquela hora. O resultado (ou o erro, "falhou") fica no pedido, e a conversa de origem recebe a notícia.
8. **Vence em 24 horas** sem decisão (verificação a cada minuto, `aprovacao.venceu`); a ação não acontece.
9. **Sugestão de liberar:** depois de 20 aprovações seguidas sem edição numa ação, a tela sugere passar para "executa". A mudança é sempre humana.
10. **"Agente novo começa pedindo aprovação para tudo o que muda dados"** (spec): recomendo valer só para os agentes criados a partir de modelos ou importados (Fase 2). Os dois agentes de nascença são da plataforma e já testados, e um agente externo novo pedindo aprovação a cada mudança de status deixaria o Claude no Mac impraticável. Fica para o Sandro decidir.

## Consequências

- Contrato em `contratos/src/agentes/regras.ts`; avisos novos `aprovacao_pedida` e `aprovacao_decidida`.
- Tabelas novas `regras_de_agente` (só os ajustes e o contador de aprovações) e `aprovacoes`.
- A M4-04 soma as ações de alto risco, bloqueadas para todos, por cima destas regras.
