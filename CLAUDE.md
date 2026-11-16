# Mago OS: regras do projeto

Leia este arquivo inteiro antes de mexer em qualquer coisa. Vale para qualquer agente (Claude, Hermes ou outro) e para qualquer pessoa desenvolvedora. Existe um `CLAUDE.md` com o mesmo conteúdo: ao editar um, atualize o outro no mesmo PR.

## O que é

O Mago OS é um sistema operacional de agentes para empresas: pessoas e agentes de IA trabalhando juntos em tarefas, projetos e rotinas, com login, permissões, auditoria e isolamento total entre empresas. Este repositório é o núcleo (um dia vira código aberto). A parte fechada (multiempresa, revenda e cobrança) fica no repositório `mago-os-cloud`.

- **O que o sistema faz:** plano "Agentic OS: funcionalidades e arquitetura".
- **Em que ordem construir:** [docs/spec](docs/spec/README.md). Cada tarefa tem um número (M0-01, M1-03...) igual ao do cartão no quadro.
- **Quadro de tarefas:** [GitHub Projects "Mago OS"](https://github.com/orgs/mago-os/projects/1). Cada cartão é uma issue com o modelo "Tarefa".
- **Por que as escolhas técnicas:** [docs/decisoes](docs/decisoes/README.md).

## Pastas

| Pasta | O que guarda | Quem pode mexer |
| --- | --- | --- |
| `nucleo/` | API (Fastify), login, permissões, tarefas, agentes, fila e auditoria | Uma tarefa por vez, com aprovação do Sandro nas partes sensíveis |
| `contratos/` | Formatos de dados e ações que cada módulo declara | Sempre antes das outras mudanças, com aprovação do Sandro |
| `modulos/<nome>/` | Um pacote por módulo (CRM, financeiro etc.) | Só a tarefa daquele módulo |
| `telas/` | Frontend React com os painéis encaixáveis | Tarefas de tela |
| `testes/` | Testes que cruzam pacotes: banco real, isolamento entre empresas, telas (Playwright) | Tarefas de teste e de infraestrutura |
| `infra/` | Containers, publicação e a cópia da configuração da VPS02 | Tarefas de infraestrutura |
| `docs/` | Spec, decisões técnicas, operação e (gerados) banco e histórico de versões | Junto com a tarefa que muda o assunto |

## Regras de código

1. **Um módulo só conversa com outro pelos contratos** (`@mago-os/contratos`), nunca importando o código do outro.
2. **Todo dado leva a empresa**, e o banco isola as empresas com Row Level Security desde a primeira tabela. Toda tabela nova tem teste provando que uma empresa não vê a outra.
3. **Mudanças no banco são migrações numeradas e versionadas, sempre com o caminho de volta.** Cada tabela e coluna tem descrição em português e a marca: dado da empresa, dado pessoal (LGPD) ou dado sensível.
4. **Código e testes juntos.** Teste de unidade ao lado do código (`arquivo.test.ts`); teste que cruza pacotes em `testes/`.
5. **Versões só no catálogo** do `pnpm-workspace.yaml`. Nos pacotes, escreva `"catalog:"`, nunca o número. Mudar versão é tarefa própria.
6. **TypeScript que o Node roda direto:** importe com a extensão `.ts` e não use `enum` nem `namespace` (a verificação de tipos barra).
7. **Português** nos nomes de pastas, comandos, regras de negócio e textos. Nomes de bibliotecas e termos técnicos consagrados ficam em inglês.
8. **Textos que o usuário final vê** (telas, mensagens, e-mails) não usam o travessão (—).
9. **Sem estado no servidor:** a API pode ser reiniciada ou duplicada a qualquer momento. Sessão, fila e arquivos ficam no banco ou no depósito.

## Segredos e segurança

- **Nunca** escreva senha, token ou chave em arquivo versionado, em commit ou em PR. Segredos ficam no Infisical (projeto `mago-os`), separados por ambiente. Arquivos `.env` estão no `.gitignore`; só os modelos `*.env.example`, sem valor, entram no Git.
- Dados reais de clientes nunca saem da produção. Local e teste usam só dados falsos.
- Mudança de DNS só com aprovação escrita do Sandro.
- A VPS02 é dividida com a Ratoeira (que roda fora de container). Nunca derrube, reinicie ou altere nada dela. Ver [docs/operacao](docs/operacao/README.md).

## Como trabalhar uma tarefa

1. Pegue a próxima tarefa de "Pronto para começar" no quadro e mova para "Em andamento".
2. Crie uma branch só para ela a partir da `main` atualizada, com o nome `<numero>-<assunto>` (ex.: `m0-04-api`). Com mais de um agente ao mesmo tempo, cada um trabalha na sua cópia (git worktree), com banco de teste próprio.
3. Escreva o código e os testes juntos, mexendo só nas pastas da tarefa.
4. Rode `pnpm verificar` antes de abrir o PR.
5. Abra um PR por tarefa, ligado ao cartão (escreva `Closes #<número da issue>` no texto do PR: o GitHub só reconhece a palavra em inglês), com um resumo simples do que mudou e como conferir. O modelo de PR já traz essa estrutura.
6. Os testes automáticos rodam; se algo falhar, corrija e volte ao passo 4.
7. Uma revisão automática separada olha a mudança; corrija o que ela encontrar.
8. O Sandro aprova o que é sensível. Ninguém aprova a própria mudança nem publica em produção.

**Precisa da aprovação do Sandro:** contratos entre módulos, estrutura do banco que mexe no isolamento entre empresas, segurança e login, pagamentos, publicação em produção e qualquer mudança de escopo. Todo o resto entra com testes verdes e revisão automática.

**Commits:** no formato `Data: DD/MM/AAAA - Hora PT: HH:MM - Descrição: <número da tarefa>: <o que mudou>`, com a hora de Lisboa (`TZ=Europe/Lisbon date`) e a descrição em português simples. Ex.: `Data: 16/11/2026 - Hora PT: 14:30 - Descrição: M0-04: rota de saúde da API e do banco`.

**Spec:** correção pequena (detalhe, situação, texto) entra junto com a tarefa e é avisada. Mudança de escopo só com aprovação do Sandro. Decisão técnica importante vira uma nota nova em `docs/decisoes/`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm install` | Instala tudo (Node 26 e pnpm 11) |
| `pnpm verificar` | Tipos, estilo e testes, na ordem |
| `pnpm tipos` | Confere os tipos de todos os pacotes (TypeScript 7) |
| `pnpm estilo` | Confere estilo e erros comuns (Biome); `pnpm estilo:corrigir` arruma sozinho |
| `pnpm testes` | Roda os testes (Vitest) |
