# Spec da Fase 1: M0 Fundação

Parte da [spec da Fase 1](README.md). Estado em 16/11/2026: em andamento.

**Pronto quando:** teste.osmago.com mostra a tela inicial do Mago OS, publicada sozinha depois de uma mudança aprovada no GitHub, com o banco fazendo backup no Backblaze B2 e uma restauração de teste feita com sucesso.

| Número | Tarefa | Depende de | Tamanho | Situação |
| --- | --- | --- | --- | --- |
| M0-01 | Repositório e estrutura de pastas | nada | M | Feito |
| M0-02 | Quadro Kanban e modelos de tarefa | M0-01 | P | Em revisão |
| M0-03 | Ambiente local com containers | M0-01 | M | Em revisão |
| M0-04 | Núcleo mínimo da API | M0-01 | M | A fazer |
| M0-05 | Banco, migrações e isolamento por empresa | M0-03, M0-04 | M | A fazer |
| M0-06 | Tela inicial com o design aprovado | M0-01 | M | A fazer |
| M0-07 | Testes automáticos e proteção da main | M0-04, M0-06 | M | A fazer |
| M0-08 | Segredos no Infisical | M0-04 | P | Parte adiantada |
| M0-09 | Preparação e segurança da VPS | nada | M | Parte adiantada |
| M0-10 | Pacote e publicação automática no teste | M0-07, M0-08, M0-09 | M | A fazer |
| M0-11 | Backup do banco no Backblaze B2 | M0-10 | M | Primeira etapa feita |
| M0-12 | Monitoramento | M0-10 | P | A fazer |

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

- [x] Docker Compose com PostgreSQL 18 e pgvector (a API entra na M0-04 e a tela na M0-06, que ainda não existiam)
- [x] Um comando para subir tudo e outro para zerar (`pnpm local:subir` e `pnpm local:zerar`)
- [x] Dados falsos para testar (nunca dados reais): pasta `infra/local/dados-falsos`, com as empresas falsas chegando na M0-05

Pronto quando: o sistema sobe no Mac com um comando.

## M0-04 Núcleo mínimo da API

- [ ] Servidor Fastify com configuração por variáveis de ambiente e sem guardar estado no servidor
- [ ] Rota de saúde que diz se a API e o banco estão bem
- [ ] Registros padronizados e a base do rastreio técnico (OpenTelemetry), com número de rastreio em cada pedido
- [ ] Fila pg-boss instalada

Pronto quando: a rota de saúde responde e cada pedido aparece nos registros com seu número de rastreio.

## M0-05 Banco, migrações e isolamento por empresa

- [ ] Ferramenta de migrações versionadas, sempre com o caminho de volta
- [ ] Primeira tabela de empresas e a regra de que todo dado leva a empresa
- [ ] Isolamento no próprio banco (Row Level Security) ligado desde a primeira tabela
- [ ] Teste automático que tenta ler dados de outra empresa e precisa falhar
- [ ] Descrição em português de cada tabela e coluna dentro das migrações, com as marcas dado da empresa, dado pessoal (LGPD) e dado sensível
- [ ] Documentação do banco gerada sozinha em docs/banco a cada mudança aprovada: diagrama das tabelas (Mermaid) e dicionário de dados
- [ ] Teste que barra tabela ou coluna sem descrição ou sem a marca de dado pessoal
- [ ] Arquivo "decisões do banco" escrito à mão, explicando o porquê das escolhas importantes

Pronto quando: o teste de vazamento prova que uma empresa não vê a outra, e docs/banco mostra o diagrama e o dicionário da primeira tabela, gerados sozinhos.

## M0-06 Tela inicial com o design aprovado

- [ ] React, Vite, Tailwind e shadcn com o estilo monocromático e o mago meio-tom
- [ ] Tema claro e escuro, pensado primeiro para o celular
- [ ] App instalável (PWA) básico
- [ ] Página inicial que mostra o estado da API

Pronto quando: a tela abre no celular e no computador, nos dois temas, e pode ser instalada.

## M0-07 Testes automáticos e proteção da main

- [ ] GitHub Actions rodando a cada mudança: tipos, estilo, testes de unidade, testes com PostgreSQL real e testes de tela com Playwright
- [ ] Verificação de segurança: bibliotecas com falhas conhecidas e senhas esquecidas no código
- [ ] Proteção da main: só entra por PR, com testes verdes e aprovação

Pronto quando: uma mudança com teste quebrado é barrada sozinha.

## M0-08 Segredos no Infisical

- [x] Criar a conta no Infisical Cloud junto com o Sandro e o projeto do Mago OS (feito em 16/11/2026: projeto `mago-os`, ambiente Staging, identidade `vps02` só leitura)
- [ ] Ambientes local e produção no projeto
- [ ] API e publicação lendo os segredos de lá
- [ ] Nenhum segredo no repositório (a verificação do M0-07 confere)

Pronto quando: o sistema sobe no teste sem nenhum segredo escrito em arquivo do repositório.

## M0-09 Preparação e segurança da VPS

- [x] Levantar o que a Ratoeira usa (ela roda direto na VPS, fora de container): portas, serviços e configuração do Caddy, para não tocar em nada dela
- [ ] Usuário próprio para o Mago OS, com o root só para emergências
- [x] Pasta e rede de containers do Mago OS separadas da Ratoeira, com limite de memória e processador (feito em 16/11/2026: `/opt/mago-os`, redes `mago_db`, `mago_backup` e `mago_edge`; banco limitado a 1,5 GiB e 1 CPU)
- [ ] Acesso de administração como pede o plano: SSH só por chave, pela rede privada (Tailscale)
- [ ] 2FA na conta da Hostinger (feito pelo Sandro)
- [ ] Firewall só com o necessário, sem fechar nada que a Ratoeira usa (hoje o ufw já deixa só 22, 80 e 443; falta rever junto com o SSH pelo Tailscale)

Pronto quando: o Mago OS tem o próprio espaço na VPS02 sem afetar a Ratoeira.

## M0-10 Pacote e publicação automática no teste

- [ ] Imagem Docker montada pelo GitHub a cada mudança aprovada e guardada de forma privada no GitHub
- [ ] A VPS busca a versão nova assim que o GitHub toca a campainha (com conferência a cada minuto como reserva), baixa, roda as migrações e liga a versão nova ao lado da antiga
- [ ] Verificação de saúde antes de trocar; se falhar, a antiga continua e o Sandro recebe aviso
- [ ] Caddy apontando teste.osmago.com para o Mago OS; histórico de versões gerado sozinho e manual de como publicar e voltar uma versão

Pronto quando: aprovar um PR faz a versão nova aparecer em teste.osmago.com sem ninguém mexer na VPS.

## M0-11 Backup do banco no Backblaze B2

O Backblaze B2 substituiu o Cloudflare R2 em 16/11/2026 (grátis até 10 GB, sem cartão). Ver a [decisão 0002](../decisoes/0002-backup-no-backblaze-b2.md).

- [x] Criar o bucket no Backblaze B2 e guardar a chave no Infisical (bucket privado `mago-os-backup`, com Object Lock)
- [x] pgBackRest com cópia completa diária e registro contínuo das alterações, criptografados
- [ ] Guardar por 30 dias, 3 meses e 1 ano, como no plano (30 dias feito; faltam as cópias semanais e mensais)
- [x] Fazer uma restauração de teste completa (feita em 16/11/2026, num container separado)
- [ ] Escrever o passo a passo da restauração no manual de operação (docs/operacao)
- [ ] Segunda etapa: prazo de trava do Object Lock, teste de restauração automático mensal e aviso se um backup falhar

Pronto quando: o banco é restaurado a partir do B2 num ambiente separado.

## M0-12 Monitoramento

- [ ] Uptime Kuma vigiando teste.osmago.com e a rota de saúde
- [ ] Aviso ao Sandro quando cair

Pronto quando: derrubar a API de propósito gera um aviso.
