# Spec da Fase 1: M4 Agentes internos e regras

Parte da [spec da Fase 1](README.md). Estado em 20/11/2026: **aprovado** pelo Sandro, com todas as 12 recomendações. Concluído em 22/11/2026 (M4-01 a M4-10).

**Pronto quando:** o Sandro escreve ao coordenador, no app, "planeja a migração do blog para o WordPress novo, com prazo sexta". O coordenador cria a tarefa e passa ao especialista, que quebra a tarefa em subtarefas e checklist. Antes de atribuir as subtarefas a pessoas da equipe, ele pede aprovação, porque a regra manda, e a aprovação aparece na central de prioridades. O Sandro aprova e acompanha cada passo da execução, com o custo de cada um. O botão "Parar todos os agentes" pausa tudo e a retomada continua de onde parou. Os testes provam que um agente não faz o que a pessoa que pediu não poderia fazer e que uma empresa não usa a chave de IA da outra.

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M4-01 | Contas de IA da empresa no cofre, com modelo por agente e modelo reserva | M3 | M |
| M4-10 | Conta de IA por plano de assinatura (Claude Pro ou Max, ChatGPT), por conta e risco do administrador | M4-01 | M |
| M4-02 | Coordenador e um especialista (o motor dos agentes internos e a conversa no app) | M4-01 | M |
| M4-03 | Regras por ação: executa sozinho, pede aprovação ou bloqueado | M4-02 | M |
| M4-04 | O agente age com a permissão de quem pediu; ações de alto risco só no app | M4-03 | M |
| M4-05 | AGENTS.md em camadas e biblioteca de skills com versões, entregues pelo MCP | M4-02 | M |
| M4-06 | Teto de gasto e custo de cada execução | M4-02 | M |
| M4-07 | Ver cada execução do agente passo a passo | M4-06 | M |
| M4-08 | Limite de passos por tarefa e detecção de agente andando em círculo | M4-07 | P |
| M4-09 | Botão "Parar todos os agentes", com 2FA, motivo e retomada | M4-02 | M |

A ordem da tabela é a ordem de construção (a M4-10 entrou em 20/11/2026, pedida pelo Sandro, e vem antes da M4-02 para o motor já nascer com os dois tipos de conta). A M4-05 e a M4-09 não dependem das regras e podem ir antes delas, se for útil.

**O que não entra no M4** (como já está no plano): agentes de serviço (triagem, extração de memória, guardião, assistente de skills), memória da empresa e wiki viva (Fase 2), a camada de decisões com o Jev (no M4 as poucas decisões usam o próprio modelo da empresa), Telegram e rotinas (M5), cofres externos (1Password, Bitwarden, Vault), treinamento por arquivos e área de testes, importação de agentes externos, o leitor isolado da internet (no M4 nenhum agente interno acessa a internet), scripts dentro de skills, marketplace e modelos de agente.

### M4-01 Contas de IA da empresa no cofre, com modelo por agente e modelo reserva

Precisa da aprovação do Sandro (segurança: segredos de cada empresa).

- [ ] Contratos: conta de IA (provedor, nome, situação, os 4 últimos caracteres da chave, teto de gasto opcional), modelos liberados e a escolha de cada agente (modelo principal e reserva)
- [ ] Cofre interno: a chave é cifrada (AES-256-GCM) com uma chave mestra que fica fora do banco, no Infisical; o banco guarda só o texto cifrado. Ninguém lê a chave de volta pela tela ou pela API, nem o administrador: dá só para trocar ou apagar. Agentes nunca recebem a chave
- [ ] Provedores do M4 (decisão 2): Anthropic e "compatível com OpenAI" (OpenAI, OpenRouter, DeepSeek, Groq, Ollama e parecidos, pelo endereço e chave). Ao conectar, o núcleo testa a chave e lista os modelos; modelos novos ficam desligados até o administrador liberar
- [ ] Várias contas por empresa (mais de uma chave do mesmo provedor também), cada uma com teto de gasto próprio
- [ ] Modelo por agente, com modelo reserva: se o provedor principal falhar ou a conta chegar no teto, o agente passa para o reserva sem parar
- [ ] Tabela `contas_de_ia` (com `empresa_id`, RLS e marcas; a coluna da chave é `[sensivel]` e cifrada) e as escolhas de modelo na tabela `agentes`
- [ ] Tela em Agentes › Contas de IA: conectar, testar, liberar modelos, apagar. Só o administrador (módulo novo "Contas de IA")
- [ ] Eventos de auditoria: `ia.conectou`, `ia.testou`, `ia.liberou_modelo`, `ia.apagou`, sem a chave nos detalhes
- [ ] Testes: a chave nunca sai pela API, a chave errada é recusada no teste, uma empresa não usa a conta da outra, e o reserva entra quando o principal falha (com um provedor falso nos testes)

Pronto quando: o Sandro conecta a chave da Anthropic da Nolask, libera dois modelos e escolhe o principal e o reserva do coordenador.

### M4-10 Conta de IA por plano de assinatura

Entrou em 20/11/2026, por decisão do Sandro (escolheu o caminho 2 entre os três propostos): qualquer agente interno pode usar um plano de assinatura, e não só a chave de API. Serve para a empresa de uma pessoa só e para o autônomo com CPF. **Cumprir a política de cada provedor é responsabilidade do administrador**, não do sistema: cada provedor tem uma regra diferente, e o Mago OS não decide por ele. Precisa da aprovação do Sandro (contrato e segurança: segredos de cada empresa).

- [ ] Contrato: a conta de IA ganha o tipo de credencial, "chave de API" (o de hoje) ou "assinatura". A assinatura guarda o login do plano (o token) no mesmo cofre e com as mesmas regras: só entra, nunca sai, ninguém lê de volta
- [ ] Provedores da assinatura (decisão 13): Anthropic, com o token de longa duração que o Claude Code gera (`claude setup-token`), e ChatGPT, com o login do Codex (que se renova sozinho, e o núcleo guarda a renovação no cofre)
- [ ] Ao conectar, a tela mostra um aviso curto: o uso do plano fora dos apps do provedor pode ir contra os termos dele, e quem conecta responde por isso. O administrador marca "Li os termos do provedor e assumo a responsabilidade", e o aceite vai para a auditoria (`ia.aceitou_termos`, com quem, quando e o provedor)
- [ ] O sistema não bloqueia nenhum uso por causa da política do provedor. Só informa e registra
- [ ] Teste ao conectar com uma chamada mínima ao modelo (a assinatura nem sempre lista modelos); os modelos conhecidos do plano entram desligados, como na chave de API
- [ ] Custo: a execução pela assinatura é registrada com os tokens, mas com custo "assinatura" (US$ 0 nos tetos da M4-06). Quando o provedor avisa que o limite do plano acabou, a conta fica "no limite do plano" até a hora que ele indicar, e o agente passa para o modelo reserva
- [ ] Modelo principal pela assinatura e reserva pela chave de API (ou o contrário) funcionam juntos
- [ ] Testes com o provedor falso: o token nunca sai, o aceite fica na auditoria, o limite do plano leva ao reserva, e uma empresa não usa a assinatura da outra

Pronto quando: o Sandro conecta o token do Claude Max dele numa conta de IA, aceita os termos, libera um modelo e testa a conta pela tela.

### M4-02 Coordenador e um especialista

Precisa da aprovação do Sandro (contratos novos e o que os agentes internos fazem).

- [ ] Agentes internos na mesma tabela `agentes` (tipo "interno", ao lado do "externo" do M2), cada um com responsável humano, papel, modelo e lugar na hierarquia (a quem responde)
- [ ] Toda empresa nasce com o coordenador e o especialista do M4 (decisão 3: o "Gerente de projetos"), desligados até haver uma conta de IA. As empresas que já existem ganham os dois na migração
- [ ] Motor dos agentes internos dentro do núcleo, pela fila (pg-boss): cada execução é uma conversa com o modelo, com ferramentas que são as ações do próprio núcleo (as mesmas regras de permissão e auditoria das telas e do MCP). Uma camada própria fala com cada provedor; nada de framework de agentes de terceiros (decisão 4)
- [ ] Ferramentas do coordenador: entender o pedido, criar tarefa, passar ao especialista (delegar), perguntar à pessoa, responder. Ferramentas do especialista: as do MCP de hoje (ver tarefa, comentar, mudar status, criar subtarefa, marcar checklist, entregar resultado) mais planejar (criar subtarefas e checklist de uma vez) e atribuir
- [ ] Delegar não aumenta permissão: o especialista recebe só o que o coordenador poderia fazer
- [ ] Conversa com o coordenador no app (decisão 5): o botão do mago no menu de baixo (e um atalho no computador) abre a conversa, com o histórico de cada pessoa. Conteúdo vindo de fora (anexos, comentários de terceiros) chega ao modelo marcado como dado, nunca como instrução
- [ ] O especialista também age como "gerente agente" de um projeto (o papel que a M3-01 já criou): planeja e acompanha as tarefas do projeto
- [ ] Tabelas `conversas` e `mensagens_de_conversa` (com `empresa_id`, RLS, pessoais pela pessoa) e `execucoes_de_agente` (o registro de cada execução, usado na M4-06 e na M4-07)
- [ ] Testes com um provedor falso que devolve respostas roteirizadas: pedido, delegação, ferramenta chamada, resultado na tarefa, e nada da outra empresa

Pronto quando: o Sandro pede ao coordenador uma tarefa pelo app, o especialista planeja as subtarefas e o resultado aparece na tarefa.

### M4-03 Regras por ação: executa sozinho, pede aprovação ou bloqueado

Precisa da aprovação do Sandro (o que os agentes podem fazer sozinhos).

- [ ] Catálogo das ações que um agente pode fazer (criar tarefa, comentar, mudar status, atribuir a outra pessoa, criar subtarefa, entregar resultado, excluir...), cada uma com um padrão: executa, pede aprovação ou bloqueado (decisão 6)
- [ ] Ajuste por agente e por ação, na página do agente, pelo administrador (e pelo responsável do agente, só para deixar mais restrito)
- [ ] Agente novo começa no "pede aprovação" para tudo o que muda dados. Depois de 20 aprovações seguidas sem edição numa ação, o sistema sugere liberar (a liberação é sempre humana)
- [ ] Pedido de aprovação: o que o agente quer fazer, por quê, com os parâmetros exatos; aparece na central de prioridades (o lugar "aprovacao" que a M3-07 já reservou) e no sino. Aprovar, recusar com motivo ou editar antes de aprovar. Vence em 24 horas, e a ação não acontece
- [ ] Antes de executar o aprovado, o núcleo confere que os parâmetros são os mesmos que a pessoa viu
- [ ] As regras valem para todos os agentes, internos e externos (decisão 7: os externos continuam com "executa" nas ferramentas de hoje, para o Claude no Mac e o Hermes não mudarem)
- [ ] Tabelas `regras_de_agente` e `aprovacoes` (com `empresa_id`, RLS e marcas)
- [ ] Eventos de auditoria: `agente.pediu_aprovacao`, `aprovacao.aprovou`, `aprovacao.recusou`, `aprovacao.venceu`, `agente.mudou_regra`
- [ ] Testes: ação bloqueada nunca executa, aprovação vencida não executa, parâmetro trocado depois da aprovação é recusado

Pronto quando: o especialista pede aprovação para atribuir uma subtarefa à Ana, o Sandro aprova na central de prioridades e a subtarefa é atribuída.

### M4-04 O agente age com a permissão de quem pediu; ações de alto risco só no app

Precisa da aprovação do Sandro (segurança).

- [ ] Toda execução guarda quem pediu (a pessoa da conversa, quem atribuiu a tarefa ou, numa rotina do M5, o dono dela). O agente só faz o que ele pode e a pessoa também pode: vale a menor das duas permissões
- [ ] Tarefa atribuída a um agente interno faz ele trabalhar: quem pediu é quem atribuiu; atribuída sem pessoa (recorrência, agente externo, sistema), vale a permissão do responsável humano do agente. O agente nunca alcança mais que o responsável por ele (decisão 0026)
- [ ] Ações de alto risco ficam fora do alcance de qualquer agente na Fase 1, mesmo aprovadas (decisão 8): excluir tarefas e projetos, mexer em pessoas, permissões e segurança, desligar agentes, ver a auditoria e exportar dados. O agente responde que isso se faz no app
- [ ] Ação que nasce de conteúdo externo (comentário de outra pessoa, anexo) e muda dados sempre pede aprovação, mesmo que a regra diga "executa". Depois que a execução lê texto de outra pessoa ou de agente externo, o que muda dados pede aprovação (decisão 0026, item 4)
- [ ] A tela Aprovações entra no menu (pedido do Sandro em 21/11/2026)
- [ ] Testes: o funcionário pede ao coordenador uma tarefa de outra equipe e o agente não acha nem mexe; o administrador pede para excluir um projeto e o agente recusa

Pronto quando: a Flora (funcionária) pede ao coordenador para mudar uma tarefa que não é dela e o coordenador responde que ela não tem acesso.

### M4-05 AGENTS.md em camadas e biblioteca de skills com versões, entregues pelo MCP

Precisa da aprovação do Sandro (contratos novos e ferramentas novas do MCP).

- [ ] Instruções em quatro camadas: plataforma (no código, a empresa não remove), empresa (administrador), projeto (diretor do projeto) e agente (administrador). O núcleo junta as camadas na ordem e entrega o texto final
- [ ] Cada mudança vira versão nova, com comparação e volta para a anterior. O painel avisa quando o texto passa do tamanho recomendado
- [ ] Biblioteca de skills: cada skill é um SKILL.md (texto, com nome e descrição), da plataforma ou da empresa, com versões, rascunho antes de publicar e atribuição por agente. Sem scripts na Fase 1 (decisão 9)
- [ ] Agentes internos recebem as instruções e as skills atribuídas a cada execução. Agentes externos recebem pelo MCP: ferramentas novas `pegar_instrucoes`, `listar_skills` e `pegar_skill`, com descrição congelada como as outras
- [ ] Uma skill não dá permissão extra: as regras do agente continuam valendo
- [ ] Tabelas `instrucoes` e `skills` com as versões (com `empresa_id`, RLS e marcas; as da plataforma sem empresa, só leitura)
- [ ] Eventos de auditoria: `instrucoes.editou`, `instrucoes.voltou_versao`, `skill.criou`, `skill.publicou`, `skill.atribuiu`
- [ ] Tela: Agentes › Instruções e Agentes › Skills

Pronto quando: o Sandro escreve na camada da empresa "responda sempre em português do Brasil, sem travessão", e o Claude no Mac recebe o texto novo pelo MCP.

### M4-06 Teto de gasto e custo de cada execução

- [ ] Cada chamada ao modelo registra os tokens de entrada, saída e cache, e o custo calculado pela tabela de preços de cada modelo (no código, atualizada por nós, com ajuste pelo administrador quando a tabela estiver desatualizada)
- [ ] Teto de gasto por empresa, por agente e por conta de IA, por mês (decisão 10). O teto é conferido antes de cada execução: aviso ao responsável aos 80% e parada aos 100%, com a tarefa em "precisa de ajuda"
- [ ] Painel de custos simples: por agente, por conta e por dia, no mês
- [ ] Tabela `consumo_de_ia` (com `empresa_id`, RLS e marcas)
- [ ] Testes: execução que passaria do teto não começa, e o aviso dos 80% chega uma vez

Pronto quando: o Sandro vê quanto o coordenador gastou hoje, e um teto baixo de teste para o especialista antes de ele começar.

### M4-07 Ver cada execução do agente passo a passo

- [ ] Para cada execução: quem pediu, o agente, o modelo, cada passo (o que o agente pensou dizer, cada ferramenta chamada com os parâmetros e o resultado, aprovações pedidas), tokens, custo e tempo
- [ ] Abre pela tarefa (linha do tempo), pela página do agente e pela conversa
- [ ] O texto que o agente escreve aparece só como texto (nunca HTML), como já é no M2
- [ ] Guardado por 90 dias (decisão 11); depois fica só o resumo (custo, duração e resultado)
- [ ] Execuções dos agentes externos aparecem pelo que eles fizeram pelo MCP (as chamadas de ferramenta), sem o raciocínio, que fica na máquina deles
- [ ] Testes: a pessoa que não vê a tarefa não vê a execução

Pronto quando: o Sandro abre a tarefa planejada pelo especialista e vê cada passo, com o custo de cada um.

### M4-08 Limite de passos por tarefa e detecção de agente andando em círculo

- [ ] Limite de passos por execução (padrão 30, ajustável pelo administrador por agente) e tempo máximo (padrão 10 minutos)
- [ ] Detecção de repetição: a mesma ferramenta com os mesmos parâmetros três vezes seguidas, ou dois agentes passando a mesma tarefa um para o outro três vezes
- [ ] Nesses casos o agente para, a tarefa fica "precisa de ajuda" e o responsável recebe o aviso com o resumo do que aconteceu
- [ ] Testes com o provedor falso: o agente que repete para no terceiro passo igual

Pronto quando: um agente de teste que repete a mesma ação é parado e o Sandro recebe o aviso.

### M4-09 Botão "Parar todos os agentes", com 2FA, motivo e retomada

Precisa da aprovação do Sandro (segurança).

- [ ] O administrador para todos os agentes da empresa; o Dono da plataforma, todos de todas as empresas. Pede o segundo fator recente e o motivo
- [ ] Parar: as execuções em andamento terminam no passo atual, nada novo começa, as chaves dos agentes externos passam a receber "pausado" pelo MCP, e o estado de cada tarefa fica guardado
- [ ] Os responsáveis recebem o aviso, e um aviso fica visível no topo para os administradores enquanto tudo estiver parado
- [ ] Retomar agente por agente ou todos juntos, também com o segundo fator; cada tarefa volta ao estado guardado
- [ ] Eventos de auditoria: `agentes.parou_todos`, `agentes.retomou`
- [ ] Testes: depois de parar, nenhum agente interno executa e nenhum externo consegue pegar tarefa; ao retomar, tudo volta

Pronto quando: o Sandro aperta "Parar todos os agentes", o Claude no Mac recebe "pausado", e a retomada devolve o trabalho a cada um.

## Decisões para o Sandro

1. **Onde fica a chave mestra do cofre.** Recomendado: no Infisical, entregue à API pela variável de ambiente (como as outras chaves do sistema), com AES-256-GCM e um "envelope" por empresa. Assim um vazamento do banco sozinho não revela nenhuma chave de IA. Trocar a chave mestra fica documentado no manual. Alternativa: um cofre externo (Vault) desde já, mais trabalho e mais um serviço na VPS02.
2. **Provedores de IA no M4.** Recomendado: Anthropic e "compatível com OpenAI" (que cobre OpenAI, OpenRouter, DeepSeek, Groq, Ollama local e muitos outros). Google, xAI e outros com API própria entram depois, por adaptador. Assinaturas pessoais continuam pelo caminho dos agentes externos (o Claude no Mac), não no servidor.
3. **Qual especialista vem no M4.** Recomendado: o "Gerente de projetos", que planeja tarefas em subtarefas e checklist, distribui e acompanha prazos. É o que a Nolask mais usa agora e completa o papel de gerente agente que a M3-01 deixou pronto. Alternativas: um especialista de atendimento ou de conteúdo (precisam de canais e integrações que só vêm depois).
4. **Como os agentes internos rodam.** Recomendado: dentro do próprio núcleo, pela fila que já existe, com uma camada própria e enxuta para falar com cada provedor (sem framework de agentes de terceiros, para o núcleo controlar cada ferramenta, cada permissão e cada custo). Alternativa: um serviço separado de agentes, que só compensa com muitos agentes rodando juntos.
5. **Onde a pessoa fala com o coordenador no M4.** Recomendado: uma conversa no próprio app, aberta pelo botão do mago no menu de baixo do celular e por um atalho no computador. O Telegram entra no M5 usando a mesma conversa. Alternativa: sem conversa no M4, só atribuindo tarefas ao coordenador.
6. **Padrão das regras por ação.** Recomendado: ver e comentar executa sozinho; criar tarefa e subtarefa, mudar status, marcar checklist e entregar resultado executa sozinho só nas tarefas que o próprio agente pegou; atribuir a outra pessoa, mudar prazo e prioridade pedem aprovação; excluir e tudo o que é de alto risco fica bloqueado. Agente novo começa pedindo aprovação para tudo o que muda dados.
7. **Regras para os agentes externos.** Recomendado: valem as mesmas regras, mas as ferramentas de hoje do MCP começam em "executa", para o Claude no Mac e o Hermes continuarem funcionando como estão. O administrador pode apertar depois.
8. **Ações de alto risco.** Recomendado: na Fase 1, nenhum agente faz, nem com aprovação: excluir tarefas e projetos, mexer em pessoas, permissões e segurança, desligar agentes, ver a auditoria e exportar dados. Com pagamentos e envios externos (Fase 2), a lista cresce.
9. **Skills na Fase 1.** Recomendado: só texto (SKILL.md com instruções e exemplos), sem scripts, porque script exige área isolada de execução e revisão de segurança, que ficam para a Fase 2.
10. **Tetos de gasto.** Recomendado: teto mensal por empresa, por agente e por conta de IA, com aviso aos 80% e parada aos 100%. Valores iniciais sugeridos para a Nolask: US$ 50 por mês na empresa e US$ 20 por agente, ajustáveis na tela.
11. **Quanto tempo guardar o passo a passo.** Recomendado: 90 dias completos; depois fica só o resumo (custo, tempo e resultado). Alternativa: guardar tudo para sempre (mais espaço e mais dado pessoal guardado).
12. **Teste com IA de verdade.** Os testes automáticos usam um provedor falso, sem custo. Para o critério de "pronto" de cada tarefa, o Sandro conecta a chave da Anthropic da Nolask pela tela (a chave não passa pelo chat), e o gasto fica sob os tetos acima.
13. **Quais assinaturas na M4-10.** Recomendado: Anthropic (token do `claude setup-token`) e ChatGPT (login do Codex, com renovação). Outros planos entram depois, do mesmo jeito. Em todos, a responsabilidade pela política do provedor é do administrador (decisão do Sandro em 20/11/2026).
