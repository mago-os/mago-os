# Mago OS

Sistema operacional de agentes para empresas: pessoas e agentes de IA trabalhando juntos em tarefas, projetos e rotinas, com login, permissões, auditoria e isolamento total entre empresas.

> Em construção. Fase 1, marco M0 (fundação). Ambiente de testes: https://teste.osmago.com

## Instalar

Precisa de **Node 26** e **pnpm 11** (`corepack enable` instala o pnpm certo, lido do `package.json`).

```bash
pnpm install
pnpm verificar
```

O `pnpm verificar` confere os tipos, o estilo e roda os testes.

## Organização

| Pasta | O que guarda |
| --- | --- |
| `nucleo/` | API, login, permissões, tarefas, agentes, fila e auditoria |
| `contratos/` | Formatos de dados e ações que cada módulo declara |
| `modulos/` | Um pacote por módulo |
| `telas/` | Frontend React |
| `testes/` | Testes que cruzam pacotes |
| `infra/` | Containers, publicação e a configuração da VPS de testes |
| `docs/` | Spec, decisões técnicas e manual de operação |

As regras do projeto, para pessoas e agentes, estão no [AGENTS.md](AGENTS.md).

## Documentação

- [Spec da Fase 1](docs/spec/README.md): tarefas, subtarefas e critérios de aceite.
- [Decisões técnicas](docs/decisoes/README.md): o que foi decidido e por quê.
- [Manual de operação](docs/operacao/README.md): publicar, voltar versão, backup.
