# Spec da Fase 1: M2 a M6

Parte da [spec da Fase 1](README.md). Estado em 16/11/2026: não iniciado.

As tarefas abaixo vêm da seção "Escopo da Fase 1 e ordem de construção" do plano. As subtarefas e os critérios de cada uma são escritos antes de começar o marco e aprovados pelo Sandro.

## M2 Prova de ponta a ponta

Detalhado em [M2-prova.md](M2-prova.md) (18/11/2026).

## M3 Projetos e tarefas completos

Detalhado em [M3-projetos.md](M3-projetos.md) (aprovado em 19/11/2026). A M3-02 original virou duas, e entrou a proposta da M3-11 (tela "Dados da empresa").

## M4 Agentes internos e regras

Detalhado em [M4-agentes.md](M4-agentes.md) (proposta de 20/11/2026).

Pronto quando: o coordenador recebe um pedido, passa ao especialista e pede aprovação quando a regra manda.

| Número | Tarefa |
| --- | --- |
| M4-01 | Contas de IA da empresa no cofre, com modelo por agente e modelo reserva |
| M4-02 | Coordenador e um especialista |
| M4-03 | Regras por ação: executa sozinho, pede aprovação ou bloqueado |
| M4-04 | O agente age com a permissão de quem pediu; ações de alto risco só no app |
| M4-05 | AGENTS.md em camadas e biblioteca de skills com versões, entregues pelo MCP |
| M4-06 | Teto de gasto e custo de cada execução |
| M4-07 | Ver cada execução do agente passo a passo |
| M4-08 | Limite de passos por tarefa e detecção de agente andando em círculo |
| M4-09 | Botão "Parar todos os agentes", com 2FA, motivo e retomada |

## M5 Telegram e rotinas

Aprovado em 19/11/2026 (decisão 8 do M3): os eventos da agenda simples da Fase 1 (eventos, prazos das tarefas e alertas no app e no Telegram) entram neste marco, numa tarefa a numerar quando o M5 for detalhado.

Pronto quando: o Sandro cria uma tarefa e aprova um pedido pelo Telegram, e uma rotina roda sozinha no horário.

| Número | Tarefa |
| --- | --- |
| M5-01 | Vincular a conta do Telegram por código |
| M5-02 | Falar com o coordenador e criar tarefas pelo Telegram |
| M5-03 | Enviar arquivos pelo Telegram |
| M5-04 | Aprovar com botões e código do app autenticador |
| M5-05 | Rotinas por horário |
| M5-06 | Rotinas por eventos do próprio sistema |

## M6 Endurecimento e uso real

Pronto quando: a Nolask usa o Mago OS no dia a dia em app.osmago.com.

| Número | Tarefa |
| --- | --- |
| M6-01 | Testes de vazamento entre empresas em todas as partes |
| M6-02 | Rastreio técnico completo, com número de rastreio de ponta a ponta |
| M6-03 | Teste de restauração do backup |
| M6-04 | Revisão de segurança da Fase 1 e plano de incidente |
| M6-05 | Ambiente de produção em app.osmago.com (DNS só com aprovação escrita do Sandro) |
| M6-06 | Início do uso pela Nolask e ajustes |
