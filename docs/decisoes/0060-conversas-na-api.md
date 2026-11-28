# 0060 Conversas na API pública, no MCP e nos webhooks

- **Data:** 28/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 28/11/2026, com os 5 pontos como propostos)
- **Tarefa:** M8-11

## Contexto

A spec do M8, aprovada em 27/11/2026, pede na M8-11:

- endereços da API pública e ferramentas do MCP e dos agentes internos (regra 12) para listar e ver conversas, mandar
  mensagem, escrever nota interna, atribuir e resolver;
- que **mandar mensagem a um contato peça aprovação por padrão** para os agentes externos, porque sai da empresa;
- eventos novos nos webhooks (conversa aberta, mensagem recebida, conversa passada para uma pessoa e resolvida), só
  com ids, como no M7;
- a documentação da API em dia e o teste de vazamento cobrindo as rotas novas.

O que já existe:

- **No app:** a caixa de conversas (M8-04), com as permissões `conversas.ver`, `conversas.criar` (mandar mensagem e
  nota) e `conversas.editar` (assumir, passar, devolver, resolver, reabrir e trocar o contato).
- **Para os agentes:** `listar_conversas` e `ver_conversa` (M8-01), que só leem e executam sempre. O texto do cliente
  já é tratado como texto de outros (decisão 0026). Depois de ler, o que muda dados pede aprovação.
- **A API pública (decisão 0047):** a chave age em nome de uma pessoa, com escopo por módulo (ler ou escrever), IPs,
  validade e limites (120 pedidos por minuto por chave, 600 por empresa; 500 leituras por hora por agente).
- **Os webhooks (decisão 0048):** avisos assinados, com número único, novas tentativas por 24 horas e só os ids.

## Decisão

### 1. Módulo novo "conversas" na chave de API (pede o seu olho)

- O escopo da chave ganha `conversas: ler | escrever`, como os outros módulos. As chaves que já existem não
  alcançam as conversas até o administrador marcar.
- A chave vê só o que a pessoa dela vê. A equipe do canal vale como no app (decisão 2 da spec): o funcionário vê as
  conversas dos canais da sua equipe e as passadas para ele; o gestor e o administrador veem todas.

### 2. Endereços da API (`/v1/conversas`)

| Endereço | O que faz | Escopo e permissão |
| --- | --- | --- |
| `GET /v1/conversas` | Lista as conversas (até 100), com os filtros do app (situação, canal, contato, dono, com o agente) | ler, `conversas.ver` |
| `GET /v1/conversas/{id}` | Uma conversa com as últimas 50 mensagens e notas | ler, `conversas.ver` |
| `POST /v1/conversas/{id}/mensagens` | Manda uma mensagem de texto ao contato | escrever, `conversas.criar` |
| `POST /v1/conversas/{id}/notas` | Escreve uma nota interna, que o contato não vê | escrever, `conversas.criar` |
| `POST /v1/conversas/{id}/atribuir` | Passa a conversa para uma pessoa da equipe do canal, ou de volta para a equipe | escrever, `conversas.editar` |
| `POST /v1/conversas/{id}/resolver` | Resolve a conversa (a mensagem nova do contato abre outra, como no app) | escrever, `conversas.editar` |

As leituras contam no limite de 500 por hora, como as outras.

### 3. Mandar mensagem pela API (pede o seu olho)

A chave de API não é um agente: é um sistema da empresa (n8n, Make, o site) agindo em nome de uma pessoa. Recomendo
que, com o escopo `conversas: escrever`, ela **mande direto, sem aprovação**, como a pessoa mandaria pela caixa, mas
com estas travas:

- **Só numa conversa que já existe e não está resolvida.** Pela API não dá para abrir conversa nova nem escrever para
  um número qualquer. Disparo para listas fica no M9 (cadências), com as regras da Meta.
- **Só texto, até 4.096 letras.** Arquivos e áudio ficam para depois.
- **No máximo 60 mensagens por hora por chave**, além dos limites de pedidos.
- A mensagem sai marcada como "enviada pela API" na caixa e vai para a auditoria (chave, pessoa e conversa, sem o
  texto).

A alternativa é a API mandar só com aprovação de uma pessoa no app. É mais segura se uma chave vazar, mas atrapalha a
automação, que é o motivo de existir a API.

### 4. Ferramentas dos agentes (MCP e internos, regra 12)

| Ferramenta | Agente interno | Agente externo (MCP) |
| --- | --- | --- |
| `listar_conversas`, `ver_conversa` | já existem: executa | já existem: executa |
| `mandar_mensagem_ao_contato` | **pede aprovação** | **pede aprovação** (spec) |
| `escrever_nota_na_conversa` | executa | executa |
| `atribuir_conversa` | executa | executa |
| `resolver_conversa` | executa | executa |

- As três que mudam dados (nota, atribuir e resolver) já passam a pedir aprovação quando o agente leu texto de cliente
  antes, pela regra do texto de outros, que existe desde o M4 (decisão 0026). Na prática, num pedido que começa pela leitura da conversa,
  elas pedem aprovação também.
- A aprovação de `mandar_mensagem_ao_contato` mostra a conversa, o contato e o texto exato. A pessoa pode editar antes
  de aprovar, e o texto aprovado é o que sai.
- O agente "atendimento" do canal (M8-05) continua com `responder_ao_cliente`, que só alcança a própria conversa.
  Ele não ganha estas ferramentas novas.
- O administrador ajusta o modo por agente, como hoje. Liberar `mandar_mensagem_ao_contato` para executar sozinho
  fica possível, mas o padrão é pedir aprovação.
- As descrições entram congeladas pelo teste (regra 14), como as outras.

### 5. Eventos novos dos webhooks (pede o seu olho)

| Evento | Quando | O que leva |
| --- | --- | --- |
| `conversa.aberta` | Uma conversa nova começou (o contato escreveu, ou "continuar no WhatsApp") | conversa, canal e contato |
| `conversa.mensagem_recebida` | Chegou mensagem do contato | conversa, canal, contato e mensagem |
| `conversa.passada_para_pessoa` | A conversa foi passada para uma pessoa (pelo sistema, pelo agente ou à mão) | conversa, canal, contato e o motivo (código fixo, sem o texto) |
| `conversa.resolvida` | A conversa foi resolvida | conversa, canal e contato |

- Só os ids, como no M7. O texto do cliente nunca vai no aviso: quem precisar busca pela API, com a própria chave e
  o próprio escopo.
- Mensagem que sai (da equipe ou do agente) não gera evento, para não repetir o que o próprio sistema fez.
- Os webhooks que já existem não recebem os eventos novos até o administrador marcar.

### 6. O que fica de fora da M8-11

- Arquivos pela API: a lista de mensagens diz o tipo e o nome do arquivo, mas não baixa. Fica para depois.
- Abrir conversa nova pela API ou pelo agente: fica no M9, com as cadências.
- Apagar conversa pela API ou pelo agente: não entra. Apagar continua só no app (é dado de cliente, LGPD).
- O WhatsApp oficial das empresas (janela de 24 horas e modelos) é da M8-10. Quando ela entrar, mandar pela API fora
  da janela devolve um erro claro, em vez de tentar.

## Ajustes ao construir (28/11/2026)

- **Atribuir é só para uma pessoa.** A caixa não tem "devolver para a equipe" (só "devolver ao agente", que continua no app), então `POST /v1/conversas/{id}/atribuir` e `atribuir_conversa` pedem a pessoa, que precisa ver as conversas do canal.
- **A API confere o corpo pelo próprio contrato** nas conversas: a rota da caixa aceita arquivo, voz e menções, que pela API ficam de fora (400).
- **Quem age pelo agente:** a mensagem e a nota ficam com o agente como autor, e a auditoria leva o agente como ator e quem pediu nos detalhes. A aprovação mostra "Mandar a “contato”: “texto”", e o texto editado na aprovação é o que sai.
- **O evento "passada para uma pessoa"** também sai quando alguém assume ou reabre (a conversa ganha um dono), com o motivo `atribuida`; a passagem pelo agente ou pelo sistema leva o motivo dela (ex.: `pediu_pessoa`).
- **"Aplicar a todas" das regras do agente aceita até 100 ações** (eram 50): com as 4 ações novas, o catálogo passou de 50 e a tela de regras recusava.
- **Mensagem na mesma hora depois de resolver** cai na conversa resolvida (a folga de 1 hora do M8-04), sem gerar "conversa aberta" de novo.

## O que foi descartado

- **Uma ferramenta só, "mexer na conversa", com o tipo de ação como parâmetro:** fica mais difícil dar modos
  diferentes para mandar mensagem (que sai da empresa) e para nota ou atribuir (que ficam dentro).
- **Mandar o texto da mensagem no webhook:** mais prático para quem recebe, mas o texto do cliente sairia para um
  sistema de fora sem passar pelo escopo da chave nem pelas permissões.
- **Agente interno mandando mensagem sem aprovação por padrão:** um texto adulterado na conversa poderia fazer o
  agente escrever para o cliente.

## Consequências

- Contratos: `contratos/src/api/publica.ts` (módulo, escopo e as 6 rotas novas), `contratos/src/api/webhooks.ts` (4
  eventos), `contratos/src/mcp/ferramentas.ts` e `contratos/src/agentes/internos.ts` (4 ferramentas novas, com as
  descrições congeladas) e `contratos/src/agentes/regras.ts` (o catálogo). Precisa da sua aprovação, porque mexe
  nos contratos.
- Banco: uma coluna para marcar a mensagem enviada pela API, numa migração com volta. Nenhuma tabela nova, e nada muda no
  isolamento entre empresas.
- Testes: rotas novas no teste de vazamento e na tabela da documentação da API; aprovação de
  `mandar_mensagem_ao_contato` (pedido, edição e envio do texto aprovado); travas da API (conversa resolvida,
  conversa de outra equipe, limite de 60 por hora); os 4 eventos com só os ids.
- Documentação: a API (`docs/api`), esta nota e `docs/banco/decisoes.md`.
