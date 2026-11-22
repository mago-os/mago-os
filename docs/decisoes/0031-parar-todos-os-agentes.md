# 0031 Parar todos os agentes

- **Data:** 22/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 22/11/2026)
- **Tarefa:** M4-09

## Contexto

Um agente pode sair do controle (instrução errada, modelo com problema, chave vazada). A M4-09 dá ao administrador um freio de emergência: um botão que para todos os agentes da empresa de uma vez, e uma retomada que devolve cada um ao trabalho de onde parou.

## Decisão

1. **Quem para:** o administrador para todos os agentes da empresa (ação nova `parar_todos` no módulo Agentes, só do administrador por padrão). O Dono da plataforma para os de todas as empresas, pela tela Empresas. Os dois pedem o segundo fator recente e o motivo.
2. **O que acontece ao parar:**
   - os agentes ativos ficam pausados, e a parada guarda quais eram (os que já estavam pausados continuam pausados depois);
   - a execução que estava rodando termina no passo atual (o motor confere antes de cada rodada e de cada ferramenta), como "parada", e a conversa avisa;
   - nada novo começa: a fila de cada agente espera, e a conversa responde que os agentes estão parados, com o motivo;
   - os agentes externos recebem "pausado" pelo MCP em qualquer chamada;
   - as tarefas ficam como estavam (status, quem está com ela e o checklist). Nenhuma volta para "a fazer".
3. **Avisos:** os responsáveis pelos agentes e os administradores recebem o aviso com o motivo. Enquanto houver parada, um aviso fica no topo da tela para os administradores, com o motivo, quem parou e o botão Retomar.
4. **Retomar:** agente por agente ou todos juntos, também com o segundo fator. Retomar devolve só os agentes que a parada pausou, e cada um volta ao que fazia: a tarefa que estava rodando volta para a fila dele e recomeça, e a fila que esperou anda. A parada termina quando o último agente dela é retomado. Durante a parada, o botão Retomar de cada agente na página dele faz a mesma retomada (com o segundo fator).
5. **Parada da plataforma:** só o Dono da plataforma retoma (a empresa vê o aviso, mas não o botão).
6. **Agente novo durante a parada** nasce pausado.
7. **Auditoria:** `agentes.parou_todos` (com o motivo e quantos agentes) e `agentes.retomou` (quais agentes).
8. **Não é ferramenta de agente:** é ação de segurança, como as de alto risco. Nenhum agente para ou retoma.

## Detalhes acertados na implementação

- **Permissão:** parar e retomar todos usam a ação "excluir" do módulo Agentes (a mesma de desligar agentes) com alcance na empresa toda, em vez de uma ação nova. Por padrão, só o administrador.
- **Nenhuma ferramenta roda depois da parada:** o motor confere antes de cada rodada e de cada ferramenta (pela API e pelo Claude Code).
- **A tarefa que estava rodando** fica "em andamento", sem voltar para "a fazer"; a trava do agente sai, para uma pessoa poder assumir durante a parada.
- **Durante a parada**, uma tarefa nova não vai para agente (agente pausado não recebe tarefa), a conversa responde com o motivo, e nenhum agente pausado liga pela página dele, a não ser pela retomada da parada.
- **Parar de novo** com a parada aberta (depois de retomar só parte dos agentes) para outra vez os que voltaram.
- **Parada do Dono sobre uma parada da empresa:** a parada passa a ser dele (só ele retoma).
- **Retomada que encontra um agente interno sem modelo** (ou desligado no meio): ele sai da parada sem voltar a ativo, e a tarefa interrompida espera na fila dele até ser ligado (a do desligado não volta).
- **Na plataforma,** uma empresa com problema não impede as outras: a resposta diz quais falharam.

## Consequências

- Contrato novo em `contratos/src/agentes/parada.ts` e dois tipos de aviso (`agentes_parados`, `agentes_retomados`).
- Banco: tabelas `paradas_de_agentes` e `agentes_da_parada` (com RLS), e a execução guarda a parada que a interrompeu.
- Pronto quando: o Sandro aperta "Parar todos os agentes", o Claude no Mac recebe "pausado", e a retomada devolve o trabalho a cada um.
