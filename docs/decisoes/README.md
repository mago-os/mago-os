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
| [0005](0005-main-sem-trava-por-enquanto.md) | Main sem trava do GitHub por enquanto, com regra escrita (rever antes de novos agentes ou do M6) | Substituída pela 0038 |
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
| [0032](0032-bot-do-telegram-e-vinculo.md) | Um bot do Telegram por ambiente, webhook conferido por segredo e vínculo da conta por código de uso único | Aceita |
| [0033](0033-conversa-pelo-telegram.md) | Conversa com o coordenador pelo Telegram: a mesma conversa e o mesmo motor, conversa nova depois de 6 horas ou /nova, resposta pelo canal da última mensagem | Aceita |
| [0034](0034-arquivos-pelo-telegram.md) | Arquivos pelo Telegram: esperam a tarefa por 24 horas sem baixar, o coordenador anexa, e o anexo passa pelo antivírus como no app | Aceita |
| [0035](0035-aprovar-pelo-telegram.md) | Aprovar pelo Telegram: botões, código do app autenticador (sem PIN), trava em 3 erros, e a mesma decisão do app pela conferência mostrada | Aceita |
| [0036](0036-descricao-do-anexo.md) | Descrição do anexo (quem enviou ou quem edita a tarefa), o canal por onde entrou, e anexos na busca | Aceita |
| [0037](0037-avisos-e-resumo-pelo-telegram.md) | Avisos pelo Telegram (só o urgente por padrão, com silêncio) e resumo do dia às 8h | Aceita |
| [0038](0038-main-protegida-pelo-github.md) | Main protegida pelo GitHub: só por PR, verificação verde e em dia com a main, sem apagar nem reescrever; o "ok" do Sandro continua no chat | Aceita |
| [0039](0039-rotinas-por-horario.md) | Rotinas por horário: as três ações, só o dono faz a rotina agir, limites, falhas sem repetir o que o agente já fez, e ferramentas dos agentes | Aceita |
| [0040](0040-rotinas-por-eventos.md) | Rotinas por eventos: os sete eventos e os filtros, só o que o dono vê, a tarefa que disparou na ação, sem rotina em círculo e eventos gravados na mesma transação | Aceita |
| [0041](0041-agenda-simples.md) | Agenda simples: eventos com participantes, recorrência (só este, este e os seguintes, todos), convite com resposta, alertas por tela, push e Telegram, e "ocupado" para o funcionário | Aceita |
| [0042](0042-teste-de-vazamento.md) | Teste de vazamento em todas as partes: a empresa B usa tudo e a A repete com os ids da B; rota nova e função que passa por cima do isolamento precisam de cobertura | Aceita |
| [0043](0043-rastreio-de-ponta-a-ponta.md) | Rastreio de ponta a ponta: o número segue a fila, os agentes e o Telegram; registros sem dado pessoal; Grafana Cloud por OTLP; número com Copiar no erro do sistema | Aceita |
| [0044](0044-producao-na-vps02.md) | Produção na VPS02 separada do teste (pasta, compose, Infisical e buckets próprios), publicação só com a aprovação do Sandro, backup antes e migrações compatíveis com a versão anterior | Aceita |
| [0045](0045-contatos.md) | Contatos: pessoa e organização, identificadores repetidos só avisam, juntar só na tela, etiquetas da empresa e ferramentas dos agentes | Aceita |
| [0046](0046-email-pelo-agregador.md) | E-mail dos clientes só por um agregador (Composio ou concorrente), com o app verificado dele; app próprio no Google no centésimo cliente pagante | Aceita |
| [0047](0047-api-publica.md) | API pública em /api/v1: chave de API da empresa em nome de uma pessoa, escopo por módulo, validade de 1 ano, troca com 24 horas, IPs e limites por chave e por empresa | Aceita |
| [0048](0048-webhooks-de-saida.md) | Webhooks de saída: só o administrador, endereço público, segredo gerado e cifrado, aviso só com ids, assinatura HMAC com a hora, 7 tentativas em 20 horas e desligar após 3 dias falhando | Aceita |
| [0049](0049-aviso-imediato-aos-agentes.md) | Aviso imediato aos agentes externos pelo mesmo caminho dos webhooks (um por agente, na tela do agente), três eventos e a pergunta a cada minuto como reserva | Aceita |
| [0050](0050-seletor-de-empresas.md) | Seletor completo de empresas: avisos e aprovações esperando em cada uma, "Todas as empresas" no sino e o nome da empresa no push e no e-mail | Aceita |
| [0051](0051-conversas-com-contatos.md) | Conversas com contatos: canais com equipe, uma conversa aberta por contato e canal, resolvida não reabre (com a folga de 1 hora), achar o contato pelo telefone com e sem o nono dígito, módulos conversas e canais, e ferramentas de leitura | Aceita |
| [0052](0052-evolution-api.md) | Evolution API na VPS02: versão fixa 2.3.8 (a 2.4 pede ativação de fora), uma por ambiente sem porta para fora, banco próprio, avisos pela rede interna com segredo e pela fila, aviso de uso na tela | Aceita |
| [0053](0053-mensagens-pela-evolution.md) | Mensagens pela Evolution: cada tipo, pelo celular sem repetir, LID, grupos fora, arquivos com antivírus e prazo de 180 dias, envio pela fila com o ritmo de 20 por minuto e 300 por hora e tentar de novo | Aceita |
| [0054](0054-caixa-unica.md) | Caixa única: lista com filtros, busca e visões, assumir, passar, devolver, resolver e reabrir, nota com @, respostas prontas, tempo real com "está respondendo" e os avisos de conversa nova e de mensagem nova (um a cada 5 minutos) | Aceita |
| [0055](0055-agente-na-conversa.md) | Agente na conversa: papel "atendimento" que só alcança a conversa e o contato, modos (só pessoas, sugere, sozinho), horário com a mensagem fixa, parada caindo para as pessoas e a autonomia gradual (aviso depois de 20 sugestões sem edição) | Aceita |
