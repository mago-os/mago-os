# 0014 Auditoria à prova de alteração

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat em 17/11/2026, com trava de 1 ano)
- **Tarefa:** M1-09

## Contexto

A spec pede o registro de quem fez o quê, quando e de onde (inclusive agentes), cada registro encadeado ao anterior para que qualquer alteração seja percebida, uma cópia fora do alcance de quem administra o sistema e uma consulta simples para o administrador. "Pronto quando": alterar um registro à mão no banco é detectado pela verificação.

## Decisão

1. **Formato e corrente do contrato** (`contratos/src/auditoria.ts`, M1-01): ator, ação `assunto.verbo`, alvo, origem, rastreio, detalhes sem dado sensível; uma corrente por empresa e uma da plataforma (empresa nula), cada evento com o SHA-256 do anterior.
2. **Esquema `auditoria`, que só acrescenta:** a API (`mago_app`) e o login (`mago_acesso`) gravam só pelas funções `auditoria.reservar` (trava a ponta da corrente até o fim da transação) e `auditoria.gravar` (confere que o evento continua a corrente). Um gatilho barra `UPDATE`, `DELETE` e `TRUNCATE` até para o dono do banco; a única mudança aceita é marcar `copiado_em`, uma vez. Cada empresa lê só os próprios eventos; a corrente da plataforma não aparece para nenhuma empresa.
3. **Gravação no núcleo** (`nucleo/src/auditoria`): `registrarEvento` monta o evento, calcula a impressão digital pelo contrato e grava; `auditar` faz o mesmo sem derrubar o pedido se a auditoria falhar (vai para o log como erro, e a verificação mostra a corrente como ficou).
4. **O que já é registrado:** entrada (com o método), senha errada, trava, saída, 2FA confirmado ou ativado, aparelho novo, desconexões e "não fui eu", troca de senha pelo link e mudança de permissão. Os módulos novos registram as próprias ações com `auditar`.
5. **Cópia travada:** a cada 5 minutos (`mago-os-auditoria-copia.timer`), os eventos novos vão em arquivo JSONL para o depósito `mago-os-auditoria` no Backblaze, com Object Lock em modo compliance por 365 dias e chave própria, que só alcança esse depósito. Nem o Sandro, nem o Claude, nem quem invadir o servidor apaga ou altera essa cópia antes do prazo.
6. **Verificação diária** (05:00 UTC, `auditoria-verificar.sh`): confere cada corrente no banco e compara com a cópia travada. A cópia pega até quem reescrevesse a corrente inteira recalculando as impressões digitais. O resultado vai para o monitoramento (`avisar.sh auditoria`).
7. **Consulta do administrador:** `GET /api/empresa/auditoria`, com filtro por pessoa, ação (ou grupo, como `permissao`) e período, protegida por `auditoria.ver` (padrão: só o administrador). A tela vem na M1-10.

## Descartado

- **Calcular a impressão digital no banco:** reproduzir o texto canônico do contrato em SQL seria frágil; o núcleo calcula e o banco confere a ordem.
- **Só a corrente, sem cópia externa:** quem tem acesso total ao banco poderia reescrever a corrente inteira.
- **Bloquear o login quando a auditoria falha:** um problema na auditoria tiraria todo mundo do sistema; o erro fica no log e na verificação.

## Consequências

- O prazo de 1 ano de trava pode ser aumentado, nunca diminuído.
- O depósito e a chave foram criados pelo Sandro (a chave do backup é presa ao depósito do backup); os segredos `B2_AUDITORIA_KEY_ID` e `B2_AUDITORIA_APPLICATION_KEY` ficam no Infisical.
- O monitoramento precisa de um vigia novo no Uptime Kuma para a verificação diária (`MAGO_AVISO_AUDITORIA`); sem ele, o resultado só vai para o log.
