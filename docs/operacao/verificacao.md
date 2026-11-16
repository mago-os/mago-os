# Verificação automática (GitHub Actions)

Fluxo `.github/workflows/verificacao.yml`, criado na M0-07. Roda em todo PR, em toda mudança na main, toda segunda-feira às 06:00 de Brasília e quando alguém pede em Actions › Verificação › Run workflow.

| Trabalho | O que confere | Se falhar |
| --- | --- | --- |
| Tipos, estilo e testes | TypeScript, Biome, testes de unidade e testes com PostgreSQL 18 de verdade (isolamento entre empresas, regras do banco, migrações, documentação do banco) | Rodar no Mac `pnpm local:subir` e `pnpm verificar`. Se for a documentação do banco: `pnpm banco:documentar` |
| Testes de tela | Playwright no tamanho de celular e de computador, contra a API e a versão construída da tela | `pnpm telas:testes` no Mac. No GitHub, o relatório fica em "Artifacts" por 7 dias |
| Segurança | `pnpm audit` (falhas graves ou críticas em bibliotecas) e gitleaks (senhas e chaves em todo o histórico) | Atualizar a biblioteca numa tarefa própria. Senha vazada: trocar a senha **antes** de qualquer outra coisa, depois limpar |

## Provado na prática

Em 16/11/2026, um PR com um teste quebrado de propósito (#30) foi barrado: "Tipos, estilo e testes" falhou e os outros dois passaram. O PR foi fechado sem merge.

## Proteção da main

O GitHub só permite proteger a main de um repositório privado com plano pago. Quando estiver disponível, a proteção exige: entrar só por PR, os três trabalhos acima verdes e o PR atualizado com a main. Enquanto isso, a regra é combinada: nenhum merge sem a verificação verde.
