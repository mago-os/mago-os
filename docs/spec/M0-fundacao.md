# Spec da Fase 1: M0 Fundação

Parte da [spec da Fase 1](README.md). Concluído em 17/11/2026.

**Pronto quando:** teste.osmago.com mostra a tela inicial do Mago OS, publicada sozinha depois de uma mudança aprovada no GitHub, com o banco fazendo backup no Backblaze B2 e uma restauração de teste feita com sucesso.

| Número | Tarefa | Depende de | Tamanho | Situação |
| --- | --- | --- | --- | --- |
| M0-01 | Repositório e estrutura de pastas | nada | M | Feito |
| M0-02 | Quadro Kanban e modelos de tarefa | M0-01 | P | Feito |
| M0-03 | Ambiente local com containers | M0-01 | M | Feito |
| M0-04 | Núcleo mínimo da API | M0-01 | M | Feito |
| M0-05 | Banco, migrações e isolamento por empresa | M0-03, M0-04 | M | Feito |
| M0-06 | Tela inicial com o design aprovado | M0-01 | M | Feito |
| M0-07 | Testes automáticos e proteção da main | M0-04, M0-06 | M | Feito |
| M0-08 | Segredos no Infisical | M0-04 | P | Feito |
| M0-09 | Preparação e segurança da VPS | nada | M | Feito |
| M0-10 | Pacote e publicação automática no teste | M0-07, M0-08, M0-09 | M | Feito |
| M0-11 | Backup do banco no Backblaze B2 | M0-10 | M | Feito |
| M0-12 | Monitoramento | M0-10 | P | Feito |

## M0-01 Repositório e estrutura de pastas

- [x] Clonar mago-os e mago-os-cloud na pasta de trabalho do Mac
- [x] Montar o monorepo em TypeScript com as pastas: núcleo, contratos, módulos, telas, testes e infraestrutura
- [x] Fixar as versões aprovadas (Node 26, TypeScript 7, Fastify 5.12, React 19.3, Vite 8.3) e ligar os alertas de dependência
- [x] Escrever o AGENTS.md com as regras do projeto e o README
- [x] Criar a pasta docs (spec, decisões técnicas e operação), passar esta spec para lá e escrever a primeira nota de decisão

Pronto quando: o repositório instala com um comando e o AGENTS.md explica as regras.

## M0-02 Quadro Kanban e modelos de tarefa

- [x] Criar o quadro "Mago OS" no GitHub Projects com as 6 colunas e os campos marco, prioridade, tamanho e responsável
- [x] Criar os modelos de tarefa (issue) e de mudança (PR)
- [x] Ligar as automações que movem o cartão quando o PR abre e quando é aprovado
- [x] Criar os cartões do M0 e do M1 a partir desta spec

Pronto quando: o Sandro abre o quadro no computador e no celular e vê as tarefas do M0 e do M1.

## M0-03 Ambiente local com containers

- [x] Docker Compose com PostgreSQL 18 e pgvector e a API (a API entrou na M0-04; a tela roda direto no Mac com `pnpm dev`, ver decisão 0004)
- [x] Um comando para subir tudo e outro para zerar (`pnpm local:subir` e `pnpm local:zerar`)
- [x] Dados falsos para testar (nunca dados reais): pasta `infra/local/dados-falsos`, com as empresas falsas chegando na M0-05

Pronto quando: o sistema sobe no Mac com um comando.

## M0-04 Núcleo mínimo da API

- [x] Servidor Fastify com configuração por variáveis de ambiente e sem guardar estado no servidor
- [x] Rota de saúde que diz se a API e o banco estão bem
- [x] Registros padronizados e a base do rastreio técnico (OpenTelemetry), com número de rastreio em cada pedido
- [x] Fila pg-boss instalada

Pronto quando: a rota de saúde responde e cada pedido aparece nos registros com seu número de rastreio.

## M0-05 Banco, migrações e isolamento por empresa

- [x] Ferramenta de migrações versionadas, sempre com o caminho de volta
- [x] Primeira tabela de empresas e a regra de que todo dado leva a empresa
- [x] Isolamento no próprio banco (Row Level Security) ligado desde a primeira tabela
- [x] Teste automático que tenta ler dados de outra empresa e precisa falhar
- [x] Descrição em português de cada tabela e coluna dentro das migrações, com as marcas dado da empresa, dado pessoal (LGPD) e dado sensível
- [x] Documentação do banco gerada sozinha em docs/banco a cada mudança aprovada: diagrama das tabelas (Mermaid) e dicionário de dados (gerada por `pnpm banco:documentar`; um teste barra o PR se o arquivo não estiver atualizado)
- [x] Teste que barra tabela ou coluna sem descrição ou sem a marca de dado pessoal
- [x] Arquivo "decisões do banco" escrito à mão, explicando o porquê das escolhas importantes

Pronto quando: o teste de vazamento prova que uma empresa não vê a outra, e docs/banco mostra o diagrama e o dicionário da primeira tabela, gerados sozinhos.

## M0-06 Tela inicial com o design aprovado

- [x] React, Vite, Tailwind e shadcn com o estilo monocromático e o mago meio-tom
- [x] Tema claro e escuro, pensado primeiro para o celular
- [x] App instalável (PWA) básico
- [x] Página inicial que mostra o estado da API

Pronto quando: a tela abre no celular e no computador, nos dois temas, e pode ser instalada.

## M0-07 Testes automáticos e proteção da main

- [x] GitHub Actions rodando a cada mudança: tipos, estilo, testes de unidade, testes com PostgreSQL real e testes de tela com Playwright
- [x] Verificação de segurança: bibliotecas com falhas conhecidas e senhas esquecidas no código
- [x] Proteção da main: só entra por PR, com testes verdes (ligada em 22/11/2026, depois de o repositório ficar público; a aprovação é o "ok" do Sandro no chat, ver decisão 0038, que substitui a 0005)

Pronto quando: uma mudança com teste quebrado é barrada sozinha.

## M0-08 Segredos no Infisical

- [x] Criar a conta no Infisical Cloud junto com o Sandro e o projeto do Mago OS (feito em 16/11/2026: projeto `mago-os`, ambiente Staging, identidade `vps02` só leitura)
- [x] Ambientes local e produção no projeto (Development, Staging e Production já existiam)
- [x] API e publicação lendo os segredos de lá (`infra/vps02/bin/segredos.sh` gera `.env`, `backup.env` e `api.env`; a API passa a usar o `api.env` na M0-10)
- [x] Nenhum segredo no repositório (a verificação do M0-07 confere)

Pronto quando: o sistema sobe no teste sem nenhum segredo escrito em arquivo do repositório.

## M0-09 Preparação e segurança da VPS

- [x] Levantar o que a Ratoeira usa (ela roda direto na VPS, fora de container): portas, serviços e configuração do Caddy, para não tocar em nada dela
- [x] Usuário próprio para o Mago OS, com o root só para emergências (`mago-admin`, só chave, 16/11/2026)
- [x] Pasta e rede de containers do Mago OS separadas da Ratoeira, com limite de memória e processador (feito em 16/11/2026: `/opt/mago-os`, redes `mago_db`, `mago_backup` e `mago_edge`; banco limitado a 1,5 GiB e 1 CPU)
- [x] Acesso de administração como pede o plano: SSH só por chave, pela rede privada (Tailscale). A porta 22 segue aberta na internet, só com chave, porque a Ratoeira depende dela (decisão 0006)
- [x] 2FA na conta da Hostinger (feito pelo Sandro em 16/11/2026)
- [x] Firewall só com o necessário, sem fechar nada que a Ratoeira usa (revisto: só 22 com chave, 80 e 443; containers do Mago OS sem portas publicadas)

Pronto quando: o Mago OS tem o próprio espaço na VPS02 sem afetar a Ratoeira.

## M0-10 Pacote e publicação automática no teste

- [x] Imagem Docker montada pelo GitHub a cada mudança aprovada e guardada de forma privada no GitHub
- [x] A VPS busca a versão nova assim que o GitHub toca a campainha (com conferência a cada minuto como reserva), baixa, roda as migrações e liga a versão nova ao lado da antiga
- [x] Verificação de saúde antes de trocar; se falhar, a antiga continua e o Sandro recebe aviso
- [x] Caddy apontando teste.osmago.com para o Mago OS; histórico de versões gerado sozinho e manual de como publicar e voltar uma versão

Pronto quando: aprovar um PR faz a versão nova aparecer em teste.osmago.com sem ninguém mexer na VPS.

## M0-11 Backup do banco no Backblaze B2

O Backblaze B2 substituiu o Cloudflare R2 em 16/11/2026 (grátis até 10 GB, sem cartão). Ver a [decisão 0002](../decisoes/0002-backup-no-backblaze-b2.md).

- [x] Criar o bucket no Backblaze B2 e guardar a chave no Infisical (bucket privado `mago-os-backup`, com Object Lock)
- [x] pgBackRest com cópia completa diária e registro contínuo das alterações, criptografados
- [x] Guardar por 30 dias, 3 meses e 1 ano, como no plano (três depósitos, decisão 0007)
- [x] Fazer uma restauração de teste completa (feita em 16/11/2026, num container separado)
- [x] Escrever o passo a passo da restauração no manual de operação (`docs/operacao/backup.md`)
- [x] Teste de restauração automático (semanal) e aviso se um backup falhar (o aviso chega ao Sandro pelo monitoramento da M0-12)
- [x] Prazo de trava do Object Lock (compliance, 30 dias, ligada em 17/11/2026)

Pronto quando: o banco é restaurado a partir do B2 num ambiente separado.

## M0-12 Monitoramento

- [x] Uptime Kuma vigiando teste.osmago.com e a rota de saúde (o Kuma que já existia na VPS01, mais os avisos do backup e da restauração)
- [x] Aviso ao Sandro quando cair (Telegram; testado derrubando a API em 16/11/2026)

Pronto quando: derrubar a API de propósito gera um aviso.
