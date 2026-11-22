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

Ligada em 22/11/2026 ([decisão 0038](../decisoes/0038-main-protegida-pelo-github.md)), na regra do GitHub "Proteção da main" (Settings › Rules › Rulesets do repositório). Ela exige:

- entrar só por PR (nada de envio direto, nem dos agentes);
- os três trabalhos acima verdes ("Tipos, estilo e testes", "Testes de tela" e "Segurança") e o PR atualizado com a main (se a main andou: `gh pr update-branch <número>` e esperar a verificação de novo);
- nada de apagar a main nem reescrever o histórico dela.

Não exige aprovação no GitHub: o "ok" do Sandro no chat é a aprovação. Os administradores da organização podem passar por cima só dentro de um PR, numa emergência e a pedido do Sandro. Para conferir a regra: `gh api repos/mago-os/mago-os/rules/branches/main`.
