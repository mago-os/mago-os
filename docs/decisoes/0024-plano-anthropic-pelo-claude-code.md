# 0024 Plano de assinatura da Anthropic pelo Claude Code oficial

- **Data:** 20/11/2026
- **Situação:** aceita (pedido do Sandro no chat em 20/11/2026: "preciso que você resolva isso")
- **Tarefa:** M4-10 (ajuste)

## Contexto

Na M4-10 o Mago OS passou a aceitar o token do plano da Anthropic (`claude setup-token`) e chamava a API direto com ele. No teste do Sandro, a Anthropic listou os modelos, mas recusou toda conversa com `429 rate_limit_error` ("Error"), com o plano em dia. A Ratoeira e o Hermes usam o mesmo plano sem problema porque rodam o **próprio Claude Code** com o token (variável `CLAUDE_CODE_OAUTH_TOKEN`): é o único cliente em que a Anthropic aceita o token do plano.

## Decisão

1. Quando a conta do modelo principal é "assinatura" da Anthropic, a execução do agente interno roda dentro do Claude Code oficial, pelo **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, que traz o Claude Code). O Mago OS não imita o Claude Code: ele roda o Claude Code de verdade.
2. O Claude Code roda sem as ferramentas dele (arquivos, terminal, internet: `tools: []`) e com um servidor MCP dentro do próprio processo, que só tem as ferramentas do Mago OS. Cada ferramenta volta para o núcleo, com as mesmas permissões e auditoria. O que não está na lista é negado sem perguntar.
3. O processo do Claude Code recebe só o necessário (PATH, uma pasta temporária como HOME, o token), nunca as variáveis da API (senhas do banco, chave mestra). A pasta é apagada no fim: nada fica guardado no servidor.
4. O Claude Code cuida das rodadas (até o mesmo limite de 30 e 10 minutos). Se falhar antes de qualquer ferramenta, entra o modelo reserva; depois de uma ferramenta, a execução falha, para não duplicar trabalho.
5. O "Testar" de uma conta de assinatura da Anthropic faz uma conversa mínima pelo Claude Code com o modelo mais leve, além de listar os modelos. Assim a conta só aparece "Funcionando" se conversar de verdade.
6. Cumprir os termos da Anthropic continua sendo responsabilidade do administrador (decisão 0022).

## Descartado

- **Imitar o Claude Code nas chamadas à API** (cabeçalhos ou texto de sistema dele): seria burlar uma trava do provedor.
- **Executor no computador da pessoa:** funciona só com o computador ligado; o Claude Code no servidor resolve o caso do Sandro.

## Consequências

- Dependência nova: `@anthropic-ai/claude-agent-sdk` (com o binário do Claude Code da plataforma, cerca de 360 MB na imagem).
- Código em `nucleo/src/contas-de-ia/claude-code.ts`; o motor (`nucleo/src/agentes-internos/motor.ts`) escolhe o caminho pela conta do modelo principal.
- O plano do ChatGPT continua pela API do Codex (decisão 0022).
