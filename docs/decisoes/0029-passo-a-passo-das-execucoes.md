# 0029 Passo a passo de cada execução dos agentes

- **Data:** 21/11/2026
- **Situação:** proposta (esperando o aprovado do Sandro)
- **Tarefa:** M4-07

## Contexto

Hoje a execução guarda quem pediu, o modelo e um resumo, e a M4-06 passou a guardar o custo de cada chamada. Falta ver o que o agente fez no meio: o que o modelo respondeu, cada ferramenta com os parâmetros e o resultado, os pedidos de aprovação e quanto cada passo custou e demorou.

## Decisão

1. **O que vira passo** (tabela `passos_de_execucao`):
   - **modelo:** cada resposta do modelo: o texto que ele devolveu, as ferramentas que pediu, tokens, custo e tempo (ligado ao registro de consumo da M4-06);
   - **ferramenta:** cada ferramenta chamada: nome, parâmetros, resultado (ou a recusa), tempo e o pedido de aprovação, se virou um;
   - **sistema:** os avisos do núcleo (passou ao reserva, parou no teto, passou do tempo).
   Cada parâmetro e cada resultado guarda até 20 mil caracteres; acima disso, corta e marca "cortado".
2. **Pelo plano da Anthropic (Claude Code):** o Mago OS vê cada ferramenta chamada e a resposta final, mas não o texto do meio, e o custo vem num número só no fim. Os passos dessas execuções mostram as ferramentas e um passo de modelo com o total.
3. **Agentes externos (o Claude no Mac, o Hermes):** cada ferramenta que eles chamam pelo MCP vira um passo, ligado ao agente e à tarefa, sem o raciocínio, que fica na máquina deles. Aparece na tarefa como "o que o agente fez pelo MCP".
4. **Quem vê:** os parâmetros e os resultados podem mostrar coisas que só quem pediu alcança (outras tarefas, pessoas). Por isso:
   - **recomendado:** quem pediu, o responsável pelo agente e o administrador veem tudo; quem só vê a tarefa vê o resumo da execução e os nomes dos passos, sem parâmetros e resultados;
   - alternativa: quem vê a tarefa vê tudo (mais simples, mas um resultado pode mostrar dados que essa pessoa não alcança).
   Quem não vê a tarefa não vê a execução (nem o resumo). As execuções da conversa são vistas só por quem pediu, pelo responsável e pelo administrador.
5. **90 dias** (decisão 11 da spec): uma verificação diária apaga os passos com mais de 90 dias. O resumo da execução (quem, modelo, situação, resultado, duração, tokens e custo) continua, porque o custo vem do consumo, que fica.
6. **Onde abre:** a página da execução (`/execucoes/:id`), com o resumo em cima e os passos em ordem. Chega-se a ela pela tarefa (uma seção "Execuções de agentes" na linha do tempo), pela página do agente (as execuções recentes) e pela conversa (o link "Ver passo a passo" em cada resposta do agente).
7. **Texto do agente e resultados aparecem só como texto**, nunca como HTML, como já é desde o M2.

## Ponto para o Sandro decidir (item 4)

- **Recomendado:** detalhes só para quem pediu, o responsável pelo agente e o administrador; quem vê a tarefa vê o resumo e os nomes dos passos.
- **Alternativa:** quem vê a tarefa vê tudo.

## Consequências

- Contrato novo em `contratos/src/agentes/passos.ts`.
- Banco: `passos_de_execucao`, e uma função que apaga os passos com mais de 90 dias (verificação diária na fila).
- Pronto quando: o Sandro abre a tarefa planejada pelo especialista e vê cada passo, com o custo de cada um.
