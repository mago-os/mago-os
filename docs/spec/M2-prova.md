# Spec da Fase 1: M2 Prova de ponta a ponta

Parte da [spec da Fase 1](README.md). Estado em 18/11/2026: **aprovado pelo Sandro** (com as cinco decisões abaixo), a construção começa pela M2-01.

**Pronto quando:** o Sandro cria em teste.osmago.com uma tarefa para o Claude no Mac. O Claude pega a tarefa pelo MCP, faz o trabalho e entrega o resultado, que aparece na tela do Sandro sem recarregar. O caminho do Hermes fica pronto e documentado, e o teste com ele vem quando o Hermes estiver em produção (ajuste do Sandro em 18/11/2026). O Sandro desliga um agente e a chave dele para de funcionar na hora. Cada passo aparece na auditoria, e os testes provam que um agente de uma empresa não vê nada da outra.

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M2-01 | Tarefas simples | M1 | M |
| M2-03 | Central de agentes básica | M2-01 | M |
| M2-02 | Tarefa travada para quem a pegou | M2-01, M2-03 | P |
| M2-04 | Chave do agente revogável e agente vivo | M2-03 | M |
| M2-05 | Mago OS como servidor MCP, com a documentação gerada | M2-02, M2-04 | M |
| M2-06 | Tempo real (WebSocket) | M2-01 | M |
| M2-07 | Deixar pronto o caminho do Hermes (teste depois) | M2-05 | P |
| M2-08 | Ligar o Claude no Mac pelo MCP (o teste do marco) | M2-05 | P |

A ordem da tabela é a ordem de construção: a M2-03 vem antes da M2-02 porque a trava precisa saber quem é o agente. A M2-06 não depende do MCP e pode ser feita em paralelo, depois da M2-01.

**O que não entra no M2** (vem no M3 e no M4, como já está no plano): espaços, projetos e listas, subtarefas, prazos, etiquetas, visões em Kanban e calendário, anexos, menções, notificações push, agentes internos, chaves de IA, regras de aprovação por ação e teto de gasto. As ferramentas "descobrir ações" e "executar ação" do MCP entram quando houver o primeiro módulo de negócio.

### M2-01 Tarefas simples

- [x] Contratos de tarefa e de agente (formato da tarefa, do comentário, do responsável pessoa ou agente e do agente), numa aprovação só do Sandro, porque são contratos
- [x] Tabelas `tarefas` e `comentarios_de_tarefa` com `empresa_id`, RLS e marcas de coluna; o responsável é uma pessoa ou um agente (o agente passa a valer quando a M2-03 entrar)
- [x] Status fixos no M2: A fazer, Em andamento, Precisa de ajuda, Concluída e Cancelada (status por projeto vem no M3)
- [x] Campo "resultado" da tarefa: o texto que o responsável entrega ao concluir
- [x] Módulo "tarefas" no catálogo de permissões (ver, criar, editar, excluir); o funcionário vê e edita as próprias tarefas e as que criou
- [x] Rotas: criar, listar (com filtro "minhas" e por status), ver, mudar status, trocar responsável, comentar
- [x] Eventos de auditoria: `tarefa.criou`, `tarefa.mudou_status`, `tarefa.trocou_responsavel`, `tarefa.comentou`
- [x] Tela Tarefas, pensada para o celular: lista com "Nova tarefa", e a página da tarefa com status, responsável, comentários e resultado
- [x] Testes de vazamento: uma empresa não vê tarefas nem comentários da outra

Pronto quando: o Sandro cria uma tarefa pelo celular, troca o status, comenta e vê tudo na auditoria, e o funcionário de teste não vê tarefas dos outros.

### M2-03 Central de agentes básica

- [x] Tabela `agentes`: nome, descrição, tipo (no M2 só "externo"), onde roda (texto livre, ex.: "VPS01", "Mac do Sandro"), responsável humano obrigatório e situação (ativo, pausado, desligado)
- [x] O agente aparece como ator na auditoria (o formato já existe desde a M1-09)
- [x] O agente tem permissão própria e mínima no M2: só ver e mexer nas tarefas atribuídas a ele e comentar nelas (agir com a permissão de quem pediu vem na M4-04)
- [x] Botão Desligar: o agente para na hora, as chaves dele deixam de valer e as tarefas que ele tinha pegado voltam para A fazer, com o responsável humano avisado
- [x] Botão Pausar e Retomar (para de receber tarefas, sem perder as chaves)
- [x] Tela Agentes: lista com situação, responsável, último sinal de vida e tarefas abertas, e a página do agente; só o administrador cadastra e desliga
- [x] Na tela da tarefa, dá para escolher um agente como responsável
- [x] Eventos de auditoria: `agente.cadastrou`, `agente.editou`, `agente.pausou`, `agente.retomou`, `agente.desligou`

Pronto quando: o Sandro cadastra o Claude no Mac, com ele mesmo de responsável, atribui uma tarefa a ele e desliga o agente pela tela.

### M2-02 Tarefa travada para quem a pegou

- [ ] Ação "pegar a tarefa": muda para Em andamento e trava a tarefa para quem pegou (pessoa ou agente), com o horário
- [ ] Enquanto travada, só quem pegou muda o status e entrega o resultado; os outros veem "em andamento com Claude no Mac" e ainda podem comentar
- [ ] Dois pedidos ao mesmo tempo: só um consegue pegar (garantido no banco, não no código)
- [ ] O administrador pode destravar, com motivo, e isso vai para a auditoria
- [ ] Ação "soltar a tarefa": volta para A fazer sem resultado
- [ ] Eventos de auditoria: `tarefa.pegou`, `tarefa.soltou`, `tarefa.destravou`

Pronto quando: dois agentes de teste tentam pegar a mesma tarefa ao mesmo tempo e só um consegue, e o administrador consegue destravar.

### M2-04 Chave do agente revogável e agente vivo

Precisa da aprovação do Sandro (é segurança).

- [ ] Chave própria por agente, mostrada uma vez só na tela; no banco fica só o resumo (hash) e o começo da chave, para reconhecer na lista
- [ ] Mais de uma chave por agente (para trocar sem parar), cada uma com nome, validade opcional, último uso e botão Revogar; revogar vale no pedido seguinte
- [ ] A chave só vale para a empresa e o agente dela; agente pausado ou desligado é recusado
- [ ] Limite de pedidos por minuto por chave e limite de leitura por hora (padrão 500 registros, como no plano): passou, o agente é pausado e o responsável é avisado
- [ ] Sinal de vida: todo pedido do agente atualiza o "último sinal"; existe também uma ação só para dizer "estou vivo"
- [ ] Verificação a cada minuto (pg-boss): tarefa pegada por um agente sem sinal há mais de 15 minutos (alterável por agente) volta para A fazer, com comentário do sistema, e o responsável humano recebe aviso no Mago OS e por e-mail
- [ ] Eventos de auditoria: `chave.criou`, `chave.revogou`, `chave.recusou` (com o motivo, sem a chave), `agente.sem_sinal`, `agente.passou_do_limite`
- [ ] Nota de decisão em `docs/decisoes` sobre o formato da chave e o sinal de vida

Pronto quando: a chave revogada é recusada no pedido seguinte, e um agente de teste que para de responder perde a tarefa em até 16 minutos, com o responsável avisado.

### M2-05 Mago OS como servidor MCP, com a documentação gerada

Precisa da aprovação do Sandro (contrato das ferramentas e porta de entrada dos agentes).

- [ ] Servidor MCP no próprio núcleo, em `teste.osmago.com/mcp` (sem DNS novo; `api.osmago.com` fica para quando houver a API pública), pelo transporte HTTP do MCP, com a chave do agente no cabeçalho `Authorization`
- [ ] Ferramentas de tarefas: `minhas_tarefas`, `ver_tarefa`, `pegar_tarefa`, `soltar_tarefa`, `comentar`, `mudar_status`, `entregar_resultado` (conclui com o resultado) e `estou_vivo`
- [ ] Cada ferramenta nasce de uma ação declarada no contrato (nome, descrição, o que recebe e o que devolve), e passa pela mesma verificação de permissão e auditoria das rotas da tela
- [ ] Descrição das ferramentas congelada: um teste guarda a assinatura de cada uma, e mudar a descrição exige atualizar o teste no PR (aprovação humana), como pede a regra 14 da segurança dos agentes
- [ ] Tudo o que vem do agente (comentário, resultado) é guardado marcado como "vindo de agente" e mostrado como texto, nunca como código na tela
- [ ] Documentação gerada sozinha a partir das ações: `docs/api/README.md` (cada ação, o que recebe e o que devolve, para MCP e rotas) por um comando `pnpm api:documentar`, conferido no CI para nunca ficar desatualizado
- [ ] Teste de ponta a ponta com um cliente MCP de verdade (o SDK oficial), incluindo o isolamento: a chave de uma empresa não vê tarefa da outra
- [ ] Nota de decisão em `docs/decisoes` sobre o servidor MCP

Pronto quando: um cliente MCP de teste lista as tarefas dele, pega uma, comenta e entrega o resultado, e a documentação gerada mostra as oito ferramentas.

### M2-06 Tempo real (WebSocket)

- [ ] Conexão WebSocket da tela com o núcleo, autenticada pela sessão da pessoa, uma por aba
- [ ] Avisos entre as cópias da API pelo próprio PostgreSQL (LISTEN/NOTIFY), para funcionar na troca azul e verde e com mais de uma cópia, sem estado no servidor (regra 9)
- [ ] O aviso leva só o que mudou ("a tarefa X mudou") e a tela busca de novo pela rota normal, então a permissão continua valendo
- [ ] A pessoa só recebe avisos da empresa ativa dela; teste de vazamento entre empresas também aqui
- [ ] Reconexão sozinha quando a internet cai ou o celular volta do segundo plano, buscando o que mudou no meio tempo
- [ ] Conferir que o Caddy e a Cloudflare deixam o WebSocket passar no teste.osmago.com
- [ ] Na tela: lista e página da tarefa se atualizam sozinhas, com um destaque curto no que mudou

Pronto quando: com o Mago OS aberto no celular e no computador, um comentário feito num aparece no outro em menos de 2 segundos, sem recarregar.

### M2-07 Deixar pronto o caminho do Hermes (teste depois)

O Hermes ainda não está em produção (Sandro, 18/11/2026). No M2 fica tudo preparado para ligá-lo quando estiver: ele roda hoje na VPS01 (Hermes Agent v0.23, em Docker) e vai entrar no Mago OS de fora para dentro, como qualquer agente externo, sem porta nova e sem tocar na Ratoeira. Os passos abaixo marcados "quando o Hermes estiver em produção" não seguram o fim do M2.

- [ ] Agente de teste genérico (um script pequeno em `infra/ferramentas/`) que faz o mesmo ciclo que o Hermes vai fazer: pergunta a cada minuto, pega, comenta e entrega; serve de modelo e de teste para qualquer agente externo

- [ ] Quando o Hermes estiver em produção: cadastrar o Hermes na Central de agentes da 4xpert, com o Sandro como responsável, e criar a chave
- [ ] Quando o Hermes estiver em produção: guardar a chave no Infisical e colocar no Hermes só pela configuração do servidor MCP dele (nunca em arquivo versionado)
- [ ] Quando o Hermes estiver em produção: configurar o Mago OS como servidor MCP no Hermes
- [ ] Rotina pronta (configuração e instruções escritas) para o Hermes que, a cada minuto, chama `minhas_tarefas` e trabalha a próxima (é ele que pergunta; o aviso do Mago OS para o agente, por webhook, é da Fase 2)
- [ ] Instruções curtas para o Hermes: pegar, comentar o andamento, entregar o resultado e soltar a tarefa quando não souber fazer
- [ ] Guia em `docs/operacao/agentes.md`: como ligar qualquer agente externo, com a seção do Hermes passo a passo, trocar a chave e desligar

Pronto quando: o agente de teste genérico faz o ciclo completo em teste.osmago.com, e o guia do Hermes está escrito. Depois do M2, quando o Hermes estiver em produção: o Sandro cria a tarefa "verificar backup e espaço em disco da VPS01" para o Hermes, e o relatório aparece na tela.

### M2-08 Ligar o Claude no Mac pelo MCP

- [ ] Cadastrar o "Claude no Mac" na Central de agentes, com o Sandro como responsável, e criar a chave
- [ ] Guardar a chave no Keychain do Mac e entregar ao Claude Code por um pequeno script que lê do Keychain na hora (a chave não fica no arquivo de configuração do Claude)
- [ ] Configurar o servidor MCP do Mago OS no Claude Code e testar as ferramentas
- [ ] Guia no mesmo `docs/operacao/agentes.md`
- [ ] O Mac dormindo: a tarefa pegada volta para a fila pela verificação de agente vivo (M2-04)

Pronto quando: o Sandro pede no Claude Code do Mac "pega minhas tarefas no Mago OS", o Claude faz uma tarefa que precisa de um arquivo do Mac e o resultado aparece na tela.

## Decisões para o Sandro

Aprovadas pelo Sandro em 18/11/2026:

1. **Como um agente externo descobre que tem tarefa:** ele pergunta a cada minuto (recomendado: simples, sem porta aberta e sem nada novo no Mago OS). A alternativa é o Mago OS avisar o agente, que precisa de webhooks (Fase 2).
2. **Status fixos no M2:** A fazer, Em andamento, Precisa de ajuda, Concluída e Cancelada.
3. **Endereço do MCP:** `teste.osmago.com/mcp`, sem mudança de DNS agora.
4. **Tempo sem sinal de vida:** 15 minutos para a tarefa voltar à fila, alterável por agente.
5. **Teste do marco com o Claude no Mac** (ajustado em 18/11/2026); o Hermes fica pronto e é testado quando estiver em produção, com a tarefa "verificar backup e espaço em disco da VPS01".
