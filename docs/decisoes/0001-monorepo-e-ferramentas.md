# 0001 Monorepo com pnpm, versões num catálogo único, Biome e Vitest

- **Data:** 16/11/2026
- **Situação:** aceita
- **Tarefa:** M0-01

## Contexto

O processo de desenvolvimento aprovado pede um repositório só (mago-os) dividido em pastas que não se misturam: núcleo, contratos, módulos, telas, testes e infraestrutura. A spec fixa Node 26, TypeScript 7, Fastify 5.12, React 19.3 e Vite 8.3. Hoje só o Claude programa, mas outros agentes e desenvolvedores vão entrar sem refazer nada.

## Decisão

1. **Monorepo com pnpm workspaces.** Cada pasta é um pacote (`@mago-os/nucleo`, `@mago-os/contratos`, `@mago-os/telas`, `@mago-os/testes` e `@mago-os/modulo-<nome>` em `modulos/`). A infraestrutura (`infra/`) não é pacote, só arquivos de configuração.
2. **Versões num catálogo único** (`catalog:` no `pnpm-workspace.yaml`). Nenhum pacote escreve versão: todos usam `catalog:`. Mudar uma versão é mudar uma linha, numa tarefa própria.
3. **Versões exatas e "idade mínima" de 1 dia.** O pnpm só instala versões publicadas há pelo menos 24 horas (`minimumReleaseAge`). Protege contra pacote adulterado recém-publicado; os alertas do Dependabot avisam das versões novas.
4. **Node 26 roda TypeScript direto** (remoção de tipos nativa), então o código não precisa de etapa de compilação para rodar nem para testar. O `tsc` (TypeScript 7, o compilador nativo, muito mais rápido) só confere os tipos. Por isso o código usa só TypeScript "apagável" (`erasableSyntaxOnly`: sem `enum` nem `namespace`) e importa arquivos com a extensão `.ts`.
5. **Biome** para estilo e erros comuns (uma ferramenta só, rápida, no lugar de ESLint + Prettier).
6. **Vitest** para os testes de unidade, rodando de uma vez em todos os pacotes a partir da raiz.
7. **Nomes em português** para pastas, comandos (`pnpm verificar`, `pnpm testes`) e regras de negócio no código, como pede o resto do projeto. Nomes técnicos de bibliotecas continuam em inglês.

## Descartado

- **Turborepo ou Nx:** ainda não há etapa de compilação pesada que justifique cache de tarefas. Reavaliar quando os testes ficarem lentos.
- **npm ou Yarn workspaces:** o pnpm é mais rápido, economiza disco e tem o catálogo de versões e a idade mínima prontos.
- **ESLint + Prettier:** duas ferramentas e mais configuração para o mesmo resultado.
- **Repositórios separados por pasta:** mais trabalho para manter os contratos alinhados; um só repositório deixa uma mudança de contrato e seus usos no mesmo PR.

## Consequências

- `pnpm install` instala tudo; `pnpm verificar` roda tipos, estilo e testes.
- A pasta `testes/` guarda os testes que cruzam pacotes (banco real, isolamento entre empresas e telas). Os testes de unidade ficam ao lado do código (`*.test.ts`).
- Se uma versão nova for publicada há menos de 1 dia, a instalação recusa. Foi o que aconteceu com o Biome 2.6.8 no dia desta decisão; ficou o 2.6.7.
