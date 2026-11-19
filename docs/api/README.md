# API do Mago OS

> Gerado por `pnpm api:documentar` a partir dos contratos (`@mago-os/contratos`). Não edite à mão: mude o contrato e gere de novo. O teste `testes/src/documentacao-api.test.ts` confere que está em dia.

## Servidor MCP

Endereço: `https://teste.osmago.com/mcp` (transporte HTTP do MCP, sem sessão). Cabeçalho: `Authorization: Bearer mago_ag_...` (a chave criada na página do agente). O agente só alcança as tarefas atribuídas a ele ou que pegou, da empresa dele. Ver a [decisão 0019](../decisoes/0019-servidor-mcp.md).

### `minhas_tarefas`

Lista as tarefas atribuídas a você ou que você pegou, as mais recentes primeiro. Sem filtro, traz só as abertas (A fazer, Em andamento e Precisa de ajuda). Chame a cada minuto para saber se há trabalho novo.

Recebe:

- `status` (lista de "a_fazer" | "em_andamento" | "precisa_de_ajuda" | "concluida" | "cancelada"): Filtrar por estes status.

Devolve:

- `tarefas` (lista de objeto, obrigatório)

### `ver_tarefa`

Mostra uma tarefa sua com todos os comentários, do mais antigo para o mais novo.

Recebe:

- `tarefaId` (id, obrigatório): Identificador (UUID).

Devolve:

- `tarefa` (objeto, obrigatório): Tarefa de uma empresa.
- `comentarios` (lista de objeto, obrigatório)

### `pegar_tarefa`

Pega a tarefa para você: ela fica Em andamento e travada no seu nome, e só você muda o status até soltar ou entregar. Se outro já pegou, a resposta diz que não está disponível. Pegue antes de começar o trabalho.

Recebe:

- `tarefaId` (id, obrigatório): Identificador (UUID).

Devolve:

- `id` (id, obrigatório): Identificador (UUID).
- `empresaId` (id, obrigatório): Identificador (UUID).
- `titulo` (string, obrigatório): O que precisa ser feito, numa linha.
- `descricao` (string ou null, obrigatório)
- `projetoId` (id ou null, obrigatório)
- `status` ("a_fazer" | "em_andamento" | "precisa_de_ajuda" | "concluida" | "cancelada", obrigatório): a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada. Concluída e cancelada encerram a tarefa.
- `responsavel` (objeto ou objeto ou null, obrigatório)
- `criadaPor` (objeto ou objeto ou objeto, obrigatório): Pessoa, agente ou o próprio sistema.
- `trava` (objeto ou null, obrigatório)
- `resultado` (string ou null, obrigatório)
- `resultadoPor` (objeto ou objeto ou objeto ou null, obrigatório)
- `criadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `atualizadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `encerradaEm` (data e hora ou null, obrigatório)

### `soltar_tarefa`

Solta uma tarefa que você pegou: ela volta para A fazer, sem resultado. Use quando não souber ou não puder fazer, e explique o motivo para a pessoa responsável entender.

Recebe:

- `tarefaId` (id, obrigatório): Identificador (UUID).
- `motivo` (string): Por que está soltando (vira comentário).

Devolve:

- `id` (id, obrigatório): Identificador (UUID).
- `empresaId` (id, obrigatório): Identificador (UUID).
- `titulo` (string, obrigatório): O que precisa ser feito, numa linha.
- `descricao` (string ou null, obrigatório)
- `projetoId` (id ou null, obrigatório)
- `status` ("a_fazer" | "em_andamento" | "precisa_de_ajuda" | "concluida" | "cancelada", obrigatório): a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada. Concluída e cancelada encerram a tarefa.
- `responsavel` (objeto ou objeto ou null, obrigatório)
- `criadaPor` (objeto ou objeto ou objeto, obrigatório): Pessoa, agente ou o próprio sistema.
- `trava` (objeto ou null, obrigatório)
- `resultado` (string ou null, obrigatório)
- `resultadoPor` (objeto ou objeto ou objeto ou null, obrigatório)
- `criadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `atualizadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `encerradaEm` (data e hora ou null, obrigatório)

### `comentar`

Escreve um comentário numa tarefa sua, em texto simples. Use para contar o andamento ou fazer uma pergunta à pessoa responsável.

Recebe:

- `tarefaId` (id, obrigatório): Identificador (UUID).
- `texto` (string, obrigatório): O comentário, em texto simples.

Devolve:

- `id` (id, obrigatório): Identificador (UUID).
- `empresaId` (id, obrigatório): Identificador (UUID).
- `tarefaId` (id, obrigatório): Identificador (UUID).
- `autor` (objeto ou objeto ou objeto, obrigatório): Pessoa, agente ou o próprio sistema.
- `texto` (string, obrigatório): O comentário, em texto simples.
- `criadoEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.

### `mudar_status`

Muda o status de uma tarefa que você pegou para Em andamento ou Precisa de ajuda. Para concluir, use entregar_resultado; para desistir, use soltar_tarefa.

Recebe:

- `tarefaId` (id, obrigatório): Identificador (UUID).
- `status` ("em_andamento" | "precisa_de_ajuda", obrigatório)
- `motivo` (string): O que aconteceu (vira comentário).

Devolve:

- `id` (id, obrigatório): Identificador (UUID).
- `empresaId` (id, obrigatório): Identificador (UUID).
- `titulo` (string, obrigatório): O que precisa ser feito, numa linha.
- `descricao` (string ou null, obrigatório)
- `projetoId` (id ou null, obrigatório)
- `status` ("a_fazer" | "em_andamento" | "precisa_de_ajuda" | "concluida" | "cancelada", obrigatório): a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada. Concluída e cancelada encerram a tarefa.
- `responsavel` (objeto ou objeto ou null, obrigatório)
- `criadaPor` (objeto ou objeto ou objeto, obrigatório): Pessoa, agente ou o próprio sistema.
- `trava` (objeto ou null, obrigatório)
- `resultado` (string ou null, obrigatório)
- `resultadoPor` (objeto ou objeto ou objeto ou null, obrigatório)
- `criadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `atualizadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `encerradaEm` (data e hora ou null, obrigatório)

### `entregar_resultado`

Conclui uma tarefa que você pegou e entrega o resultado: o texto que a pessoa responsável vai ler na tela. Escreva o que foi feito e o que foi encontrado.

Recebe:

- `tarefaId` (id, obrigatório): Identificador (UUID).
- `resultado` (string, obrigatório): O que foi feito e encontrado.

Devolve:

- `id` (id, obrigatório): Identificador (UUID).
- `empresaId` (id, obrigatório): Identificador (UUID).
- `titulo` (string, obrigatório): O que precisa ser feito, numa linha.
- `descricao` (string ou null, obrigatório)
- `projetoId` (id ou null, obrigatório)
- `status` ("a_fazer" | "em_andamento" | "precisa_de_ajuda" | "concluida" | "cancelada", obrigatório): a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada. Concluída e cancelada encerram a tarefa.
- `responsavel` (objeto ou objeto ou null, obrigatório)
- `criadaPor` (objeto ou objeto ou objeto, obrigatório): Pessoa, agente ou o próprio sistema.
- `trava` (objeto ou null, obrigatório)
- `resultado` (string ou null, obrigatório)
- `resultadoPor` (objeto ou objeto ou objeto ou null, obrigatório)
- `criadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `atualizadaEm` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.
- `encerradaEm` (data e hora ou null, obrigatório)

### `estou_vivo`

Avisa que você continua trabalhando. Todo pedido já conta como sinal de vida; use esta só quando ficar mais de alguns minutos sem chamar outra ferramenta, para a tarefa não voltar para a fila.

Recebe:

- (nada)

Devolve:

- `ok` (true, obrigatório)
- `agora` (data e hora, obrigatório): Data e hora ISO 8601 com fuso.

## Rotas

Todas com o prefixo `/api` no site, menos `/mcp`, que fica em `https://teste.osmago.com/mcp`. As rotas da tela pedem a sessão da pessoa e passam pela verificação central de permissões.

| Método | Caminho | Permissão | O que faz |
| --- | --- | --- | --- |
| GET | `/tarefas` | tarefas.ver | Lista as tarefas que a pessoa alcança (query: minhas=1, status=a,b). |
| POST | `/tarefas` | tarefas.criar | Cria uma tarefa. Sem responsável, fica com quem criou. |
| GET | `/tarefas/:id` | tarefas.ver | Mostra a tarefa com os comentários e os nomes citados. |
| POST | `/tarefas/:id/status` | tarefas.editar | Muda o status (concluir pode trazer o resultado; em andamento é pegar). |
| POST | `/tarefas/:id/responsavel` | tarefas.editar | Troca o responsável (pessoa ou agente ativo). |
| POST | `/tarefas/:id/comentarios` | tarefas.ver | Comenta (mesmo travada por outro). |
| POST | `/tarefas/:id/pegar` | tarefas.editar | Pega a tarefa: em andamento e travada para quem pegou. |
| POST | `/tarefas/:id/soltar` | tarefas.editar | Solta a tarefa que pegou: volta para A fazer. |
| POST | `/tarefas/:id/destravar` | tarefas.aprovar | Tira a trava de outro, com motivo. |
| DELETE | `/tarefas/:id` | tarefas.excluir | Exclui a tarefa e os comentários (não se estiver com outro). |
| GET | `/agentes` | agentes.ver | Lista os agentes, com responsável, tarefas abertas e último sinal. |
| GET | `/agentes/:id` | agentes.ver | Mostra um agente. |
| POST | `/agentes` | agentes.criar | Cadastra um agente externo. |
| POST | `/agentes/:id` | agentes.editar | Edita o cadastro do agente. |
| POST | `/agentes/:id/pausar` | agentes.editar | Pausa (não recebe tarefa nova; as chaves ficam). |
| POST | `/agentes/:id/retomar` | agentes.editar | Retoma o agente pausado. |
| POST | `/agentes/:id/desligar` | agentes.excluir | Desliga na hora: as tarefas voltam e o responsável é avisado. |
| GET | `/agentes/:id/chaves` | agentes.editar | Lista as chaves (só o começo de cada uma). |
| POST | `/agentes/:id/chaves` | agentes.editar | Cria uma chave; a chave inteira vem só nesta resposta. |
| POST | `/agentes/:id/chaves/:chaveId/revogar` | agentes.editar | Revoga a chave (vale no pedido seguinte). |
| GET | `/avisos` | agentes.ver | Avisos não lidos da própria pessoa. |
| POST | `/avisos/:id/lido` | agentes.ver | Marca o aviso como lido. |
| POST | `/agente/estou-vivo` | chave do agente | Sinal de vida do agente (Authorization: Bearer mago_ag_...). |
| POST | `/mcp` | chave do agente | Servidor MCP (transporte HTTP, sem sessão). Ferramentas abaixo. |

### GET `/tarefas`

Recebe:

- `minhas` (boolean)
- `status` (lista de "a_fazer" | "em_andamento" | "precisa_de_ajuda" | "concluida" | "cancelada")
- `projetoId` (id ou "sem")

### POST `/tarefas`

Recebe:

- `titulo` (string, obrigatório): O que precisa ser feito, numa linha.
- `descricao` (string ou null)
- `responsavel` (objeto ou objeto ou null)
- `projetoId` (id ou null)

### POST `/tarefas/:id/status`

Recebe:

- `status` ("a_fazer" | "em_andamento" | "precisa_de_ajuda" | "concluida" | "cancelada", obrigatório): a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada. Concluída e cancelada encerram a tarefa.
- `resultado` (string): O que o responsável entrega ao concluir.
- `motivo` (string): Por que mudou (vira comentário).

### POST `/tarefas/:id/responsavel`

Recebe:

- `responsavel` (objeto ou objeto ou null, obrigatório)

### POST `/tarefas/:id/comentarios`

Recebe:

- `texto` (string, obrigatório): O comentário, em texto simples.

### POST `/tarefas/:id/destravar`

Recebe:

- `motivo` (string, obrigatório): Por que destravou.

### POST `/agentes`

Recebe:

- `nome` (string, obrigatório): Nome do agente como aparece nas telas (ex.: Claude no Mac).
- `descricao` (string ou null)
- `ondeRoda` (string ou null)
- `responsavelId` (id, obrigatório): Identificador (UUID).
- `minutosSemSinal` (integer): Minutos sem sinal até a tarefa voltar para a fila (padrão 15).

### POST `/agentes/:id`

Recebe:

- `nome` (string): Nome do agente como aparece nas telas (ex.: Claude no Mac).
- `descricao` (string ou null)
- `ondeRoda` (string ou null)
- `responsavelId` (id): Identificador (UUID).
- `minutosSemSinal` (integer): Minutos sem sinal até a tarefa voltar para a fila (padrão 15).

### POST `/agentes/:id/chaves`

Recebe:

- `nome` (string, obrigatório): Para que serve a chave.
- `validaAte` (data e hora ou null)
