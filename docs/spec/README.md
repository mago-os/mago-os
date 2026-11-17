# Mago OS: spec da Fase 1

Escrita em 15/11/2026 por Sandro Nolasco e Claude. Passou para cá em 16/11/2026 (tarefa M0-01): a partir de agora o GitHub é o original, e toda mudança na spec segue o mesmo caminho do código (branch, PR e aprovação).

## Partes

| Arquivo | Marco | Situação |
| --- | --- | --- |
| [M0-fundacao.md](M0-fundacao.md) | M0 Fundação | Concluído em 17/11/2026 |
| [M1-acesso.md](M1-acesso.md) | M1 Acesso | Em andamento |
| [M2-a-M6.md](M2-a-M6.md) | M2 a M6 | Não iniciado (subtarefas escritas antes de cada marco) |

## Como ler esta spec

Esta spec transforma os 7 marcos da Fase 1 do plano em tarefas. O M0 e o M1 estão detalhados com subtarefas; do M2 ao M6, só as tarefas, detalhadas antes de começar cada marco.

Cada tarefa traz:

- **Número:** M0-01, M0-02... É o mesmo número do cartão no Kanban.
- **Depende de:** o que precisa estar pronto antes.
- **Tamanho:** P (até meio dia), M (cerca de um dia). Tarefa maior é quebrada em duas.
- **Subtarefas:** os passos dentro da tarefa.
- **Pronto quando:** o critério de aceite. A tarefa só vai para "Feito" quando isso for verdade.

**Regras de atualização:** a spec é viva. Correção pequena (detalhe, status, texto) o Claude faz e avisa. Mudança de escopo (tarefa nova, removida, ou algo que muda o que o sistema faz) só entra com aprovação do Sandro.

## Ajustes feitos ao passar para cá (16/11/2026)

- Backup no **Backblaze B2** no lugar do Cloudflare R2 (decidido e feito em 16/11/2026, ver [decisão 0002](../decisoes/0002-backup-no-backblaze-b2.md)).
- Situação de cada tarefa do M0 na tabela, com o que já foi adiantado no M0-08, M0-09 e M0-11.
- O PostgreSQL 18 com pgvector já roda na VPS02 (container próprio, com backup ativo).

## Documentação do sistema

Toda documentação técnica mora na pasta docs do repositório, em Markdown, e uma cópia vai para a pasta Docs do Mac. O que dá para gerar a partir do código é gerado sozinho, para nunca ficar desatualizado.

| Documento | O que tem | Como é feito | Entra em |
| --- | --- | --- | --- |
| Spec | Tarefas, subtarefas e critérios | À mão, documento vivo | M0-01 |
| AGENTS.md e README | Regras do projeto e como instalar | À mão | M0-01 |
| Decisões técnicas | Uma nota curta por decisão importante: o que foi decidido, por quê e o que foi descartado (inclui as decisões do banco) | À mão, uma nota nova por decisão | M0-01 em diante |
| Banco de dados | Diagrama das tabelas, dicionário de dados, marcas de dado pessoal e sensível | Gerado sozinho | M0-05 |
| Histórico de versões | O que mudou em cada versão, em linguagem simples | Gerado das mudanças aprovadas | M0-10 |
| Manual de operação | Como publicar, voltar uma versão, restaurar o backup (B2), trocar chaves e o que fazer se cair | À mão, testado na prática | M0-10, M0-11 |
| API e MCP | Cada ação, o que recebe e o que devolve | Gerado das ações que cada módulo declara | M2-05 |
| Plano de incidente | Passo a passo para vazamento de dados e troca de chaves em massa (prazo da ANPD) | À mão | M6-04 |

Fica para a Fase 2: a central de ajuda para os usuários (gerada a partir das ações dos módulos) e a lista de subprocessadores da LGPD. Na Fase 1 entra só o "?" simples por tela, como está no plano.

## Decisões e perguntas

Respondidas pelo Sandro em 15/11/2026:

1. **Como a VPS recebe a versão nova (M0-10):** a VPS busca a versão nova sozinha, e o GitHub não guarda nenhuma chave de acesso à VPS. Para não esperar: o GitHub toca uma "campainha" assinada assim que a mudança é aprovada, e a VPS busca na hora. A campainha só faz a VPS conferir antes; ela não dá acesso a nada. A conferência a cada minuto continua como reserva, e o Sandro e o Claude também podem pedir "atualizar agora" pela própria VPS.
2. **Acesso à VPS02 (M0-09):** usuário próprio para o Mago OS, root só para emergências. Cuidado: a Ratoeira roda direto na VPS, fora de container. Antes de mexer em firewall, portas ou no Caddy, conferir o que a Ratoeira usa e não tocar em nada dela.
3. **E-mail do sistema (M1-03 e M1-07):** criar a conta no Resend durante o M1, junto com o Sandro. Feito em 17/11/2026: domínio `osmago.com`, remetente `nao-responda@osmago.com`, chave só de envio no Infisical.
4. **Login com Microsoft e Apple:** fica para a Fase 2.
5. **Infisical (M0-08):** conta criada em 16/11/2026. Foi criada no Infisical Cloud (plano grátis), para os segredos não ficarem no mesmo servidor do sistema. O bucket de backup foi criado no M0-11 (Backblaze B2 no lugar do R2, em 16/11/2026).
6. **Aprovação das mudanças:** o Claude faz o trabalho e o Sandro aprova o mínimo. Entra sozinho, com testes verdes e revisão automática: todo o resto. Precisa do Sandro: contratos entre módulos, estrutura do banco que mexe no isolamento entre empresas, segurança e login, pagamentos, publicação em produção e qualquer mudança de escopo.

Também decidido:

7. **Texto dos commits:** resolvido em 15/11/2026. O Claude define as descrições dos commits, em português simples, ligadas ao número da tarefa.
