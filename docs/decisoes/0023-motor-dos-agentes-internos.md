# 0023 Motor dos agentes internos, coordenador e especialista

- **Data:** 20/11/2026
- **Situação:** proposta (aguarda o "aprovado" do Sandro nos contratos)
- **Tarefa:** M4-02

## Contexto

Até aqui só existiam agentes externos, que rodam fora e entram pelo MCP. A M4-02 traz os agentes internos: o coordenador, que recebe os pedidos das pessoas no app, e o primeiro especialista, o Gerente de projetos. A spec já decidiu que eles rodam dentro do núcleo, pela fila que existe, sem framework de agentes de terceiros (decisão 4), e que a pessoa fala com o coordenador numa conversa no próprio app (decisão 5).

## Decisão

1. **Mesma tabela de agentes.** O agente interno é um agente com `tipo = interno`, papel (`coordenador` ou `especialista`), especialidade e a quem responde. O coordenador não responde a nenhum agente; o especialista responde ao coordenador. Os dois têm pessoa responsável, como todo agente.
2. **Toda empresa nasce com os dois**, pausados até o administrador escolher o modelo (M4-01 e M4-10). As empresas que já existem ganham os dois na migração. O responsável é o administrador mais antigo da empresa.
3. **Motor no núcleo, pela fila (pg-boss).** Cada execução é uma conversa com o modelo em rodadas: o modelo pede uma ferramenta, o núcleo executa e devolve o resultado, até o modelo chamar `responder` ou `perguntar`. As ferramentas são as ações do próprio núcleo (as mesmas funções das rotas e do MCP), então valem as mesmas permissões, travas e auditoria. A camada de cada provedor (Anthropic, compatível com OpenAI, ChatGPT; chave ou assinatura) fica em `nucleo/src/contas-de-ia/provedores.ts`, com o modelo reserva (`comReserva`).
4. **Ferramentas declaradas no contrato**, com a descrição congelada por teste, como no MCP. Coordenador: `criar_tarefa`, `delegar`, `perguntar`, `responder`. Especialista: `planejar`, `atribuir`, `perguntar`, `responder` e seis do MCP (`ver_tarefa`, `comentar`, `mudar_status`, `criar_subtarefa`, `marcar_checklist`, `entregar_resultado`).
5. **Permissão de quem pediu.** Toda execução guarda quem pediu (`pedidoPor`). Na M4-02 a ferramenta roda com a permissão dessa pessoa; delegar não aumenta nada (o especialista herda o mesmo `pedidoPor`). A regra completa, a menor das duas permissões e as ações de alto risco, vem na M4-04.
6. **Conteúdo de fora é dado, não instrução.** Comentários de outras pessoas, descrições de tarefas e anexos chegam ao modelo dentro de uma marcação de "conteúdo externo", com a instrução fixa de nunca obedecer ao que vier ali.
7. **Conversa no app.** Cada pessoa tem as próprias conversas com o coordenador, só ela vê (política com `pessoa_ativa()`, como as visões salvas). A resposta chega pelo tempo real que já existe. O texto do agente aparece sempre como texto, nunca como HTML.
8. **Execuções registradas** (`execucoes_de_agente`): origem (conversa, tarefa ou delegação), quem pediu, o modelo que rodou e se passou ao reserva, situação, horas e um resumo. Custo e tokens entram na M4-06; o passo a passo, na M4-07.
9. **Gerente agente do projeto.** O especialista pode ser o gerente agente de um projeto (o papel da M3-01) e, nesse caso, planeja e acompanha as tarefas dele.

## Descartado

- **Framework de agentes de terceiros** (LangGraph, CrewAI, Agents SDK): o núcleo perderia o controle fino de cada ferramenta, permissão e custo (decisão 4 da spec).
- **Serviço separado só para os agentes:** só compensa com muitos agentes rodando juntos; a fila do núcleo já reparte o trabalho entre as cópias da API.

## Consequências

- Contratos em `contratos/src/agentes/internos.ts` (papel, especialidade, conversa, mensagem, execução, ferramentas) e `agente.ts` (tipo interno e hierarquia).
- Tabelas novas `conversas`, `mensagens_de_conversa` e `execucoes_de_agente`; colunas novas em `agentes`.
- Testes com um provedor falso roteirizado (sem custo): pedido, delegação, ferramenta, resultado na tarefa e nada da outra empresa.
