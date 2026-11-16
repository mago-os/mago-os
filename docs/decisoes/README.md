# Decisões técnicas

Uma nota curta por decisão importante: o que foi decidido, por quê e o que foi descartado. As decisões do banco também entram aqui.

- Uma nota nova por decisão, numerada em ordem (`0003-nome-curto.md`). Nota antiga não é apagada: se a decisão mudar, escreva uma nota nova e marque a antiga como "substituída pela 00XX".
- Formato: **Data**, **Situação** (proposta, aceita, substituída), **Contexto**, **Decisão**, **Descartado**, **Consequências**.

| Nota | Decisão | Situação |
| --- | --- | --- |
| [0001](0001-monorepo-e-ferramentas.md) | Monorepo com pnpm, versões num catálogo único, Biome e Vitest | Aceita |
| [0002](0002-backup-no-backblaze-b2.md) | Backup do banco no Backblaze B2 em vez do Cloudflare R2 | Aceita |
