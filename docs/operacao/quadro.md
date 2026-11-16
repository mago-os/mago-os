# Quadro de tarefas (GitHub Projects)

Endereço: https://github.com/orgs/mago-os/projects/1 (abre no navegador e no app do GitHub no celular). Criado em 16/11/2026 na tarefa M0-02.

## Colunas (campo Status)

| Coluna | Significa |
| --- | --- |
| A fazer | Ideia registrada, ainda sem detalhe |
| Pronto para começar | Detalhada e aprovada pelo Sandro |
| Em andamento | Claude trabalhando |
| Em revisão | PR aberto, testes rodando, esperando aprovação |
| Em teste | Publicada em teste.osmago.com para o Sandro conferir |
| Feito | Aprovada e no código principal |

## Campos

- **Marco:** M0 a M6.
- **Prioridade:** Alta, Média, Baixa.
- **Tamanho:** P (até meio dia) ou M (cerca de um dia).
- **Responsável:** Claude, Sandro ou Hermes (a pessoa ou o agente que faz a tarefa).

Etiquetas nas issues: `tarefa`, `ideia`, o marco (`M0`, `M1`...) e `precisa do Sandro` nas partes sensíveis.

## Automações (fluxos do próprio GitHub Projects)

| Quando | O cartão vai para |
| --- | --- |
| A issue entra no quadro | A fazer |
| Um PR é ligado à issue (`Fecha #N` no texto do PR) | Em revisão |
| O PR é aprovado e entra na main | Feito |
| A issue é fechada | Feito |

A coluna "Em teste" passa a ser usada quando a publicação automática no teste existir (M0-10).

## Cartões de um marco novo

Os cartões do M0 e do M1 foram criados a partir da spec (`docs/spec/`). Ao detalhar um marco novo, criar uma issue por tarefa com o modelo "Tarefa", colocar no quadro e preencher marco, prioridade, tamanho e responsável.
