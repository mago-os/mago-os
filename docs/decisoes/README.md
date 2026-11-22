# Decisões técnicas

Uma nota curta por decisão importante: o que foi decidido, por quê e o que foi descartado. As decisões do banco também entram aqui.

- Uma nota nova por decisão, numerada em ordem (`0003-nome-curto.md`). Nota antiga não é apagada: se a decisão mudar, escreva uma nota nova e marque a antiga como "substituída pela 00XX".
- Formato: **Data**, **Situação** (proposta, aceita, substituída), **Contexto**, **Decisão**, **Descartado**, **Consequências**.

| Nota | Decisão | Situação |
| --- | --- | --- |
| [0001](0001-monorepo-e-ferramentas.md) | Monorepo com pnpm, versões num catálogo único, Biome e Vitest | Aceita |
| [0002](0002-backup-no-backblaze-b2.md) | Backup do banco no Backblaze B2 em vez do Cloudflare R2 | Aceita |
| [0003](0003-api-registros-e-rastreio.md) | API: configuração, registros, número de rastreio e fila | Aceita |
| [0004](0004-telas.md) | Telas: React, Tailwind, shadcn, app instalável e o mago | Aceita |
| [0005](0005-main-sem-trava-por-enquanto.md) | Main sem trava do GitHub por enquanto, com regra escrita (rever antes de novos agentes ou do M6) | Aceita |
| [0006](0006-ssh-da-vps02.md) | SSH da VPS02 só com chave, porta 22 aberta enquanto dividir com a Ratoeira | Aceita |
| [0007](0007-backup-em-tres-depositos.md) | Backup em três depósitos (30 dias, 3 meses e 1 ano), teste de restauração mensal | Aceita |
| [0008](0008-contratos-com-typebox.md) | Contratos com TypeBox; formatos de pessoa, empresa, vínculo, sessão e auditoria encadeada | Aceita |
| [0009](0009-login-com-better-auth.md) | Login por e-mail e senha com o Better Auth, papel mago_acesso, trava e senhas vazadas | Aceita |
| [0010](0010-login-com-google.md) | Login com Google: sem cadastro, ligação só com o mesmo e-mail confirmado dos dois lados | Aceita |
| [0011](0011-dois-fatores.md) | 2FA: app autenticador, passkey e códigos; obrigatório para Dono e administradores; confirmação nas ações perigosas | Aceita |
| [0012](0012-permissoes.md) | Perfis e permissões por módulo: padrão do perfil, ajustes por pessoa, dados sensíveis e verificação central | Aceita |
| [0013](0013-sessoes-e-aparelhos.md) | Sessões e aparelhos: etiqueta do aparelho, aviso de aparelho novo, 3 dias de inatividade e 30 de máximo | Aceita |
| [0014](0014-auditoria.md) | Auditoria: correntes que só acrescentam, cópia travada no Backblaze e verificação diária | Aceita |
| [0015](0015-convites.md) | Convites e desligamento: link de 7 dias e uso único, e-mail pelo Resend, desligar corta as sessões na hora | Aceita |
| [0016](0016-convite-para-criar-empresa.md) | Convite para criar empresa: o Dono convida, quem cria (CNPJ ou CPF) vira administrador e o Dono não entra | Aceita |
| [0017](0017-chave-do-agente.md) | Chave do agente: só o resumo no banco, várias por agente, limites no banco e tarefa devolvida após 15 min sem sinal | Aceita |
| [0018](0018-tempo-real.md) | Tempo real: avisos por gatilho no PostgreSQL (LISTEN/NOTIFY) e WebSocket autenticado pela sessão | Aceita |
| [0019](0019-servidor-mcp.md) | Servidor MCP no núcleo: HTTP sem sessão, chave do agente, oito ferramentas de tarefas com descrição congelada e documentação gerada | Aceita |
| [0020](0020-anexos.md) | Anexos no Backblaze B2, com envio direto pela quarentena e antivírus ClamAV | Aceita |
| [0021](0021-cofre-e-contas-de-ia.md) | Cofre interno com envelope por empresa (AES-256-GCM, chave mestra no Infisical) e contas de IA com modelo principal e reserva | Aceita |
| [0022](0022-assinatura-nas-contas-de-ia.md) | Plano de assinatura nas contas de IA (Claude Pro/Max e ChatGPT), por conta e risco do administrador, com o aceite na auditoria | Aceita |
| [0023](0023-motor-dos-agentes-internos.md) | Motor dos agentes internos no núcleo (fila e ferramentas do próprio núcleo), coordenador e Gerente de projetos, conversa no app | Aceita |
| [0024](0024-plano-anthropic-pelo-claude-code.md) | Plano de assinatura da Anthropic pelo Claude Code oficial (Claude Agent SDK), só com as ferramentas do Mago OS | Aceita |
| [0025](0025-regras-e-aprovacoes.md) | Regras por ação dos agentes (executa, executa nas dele, pede aprovação, bloqueado) e aprovações com conferência dos parâmetros | Aceita |
| [0026](0026-permissao-de-quem-pediu-e-alto-risco.md) | O agente age com a permissão de quem pediu e do responsável por ele; alto risco só no app; texto de outros pede aprovação | Aceita |
| [0027](0027-instrucoes-em-camadas-e-skills.md) | Instruções em camadas (plataforma, empresa, projeto, agente) com versões e biblioteca de skills, entregues aos internos e pelo MCP | Aceita |
| [0028](0028-custo-e-teto-de-gasto.md) | Custo de cada chamada ao modelo (tabela de preços no código, ajuste do administrador) e tetos por mês (empresa, agente, conta) conferidos antes de cada execução | Aceita |
| [0029](0029-passo-a-passo-das-execucoes.md) | Passo a passo de cada execução (modelo, ferramentas, avisos, tokens, custo e tempo), por 90 dias, e quem vê os detalhes | Aceita |
| [0030](0030-limites-e-agente-em-circulo.md) | Limites de rodadas e tempo por agente, parada por repetição e por vai e volta entre agentes, e teto a cada rodada | Aceita |
| [0031](0031-parar-todos-os-agentes.md) | Parar todos os agentes, com segundo fator, motivo e retomada que devolve o trabalho a cada um | Aceita |
