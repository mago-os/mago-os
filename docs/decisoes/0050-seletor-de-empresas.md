# 0050 Seletor completo de empresas

- **Data:** 26/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 26/11/2026)
- **Tarefa:** M7-05

## Contexto

Quem trabalha em mais de uma empresa (o Sandro na Nolask e na 4xpert, e mais tarde nos clientes) só vê os avisos e as
aprovações da empresa aberta. A spec do M7 pede o seletor com o que está esperando em cada empresa, a central de
avisos com "Todas as empresas" e o nome da empresa no push e no e-mail. Os pontos que pedem o olho do Sandro estão
marcados com **pede o seu olho**.

## Decisão

1. **O seletor do topo** mostra, ao lado de cada empresa, um número: os **avisos não lidos** que a pessoa ainda pode
   ver ali (o aviso de uma tarefa só conta enquanto ela vê a tarefa, como no sino) mais as **aprovações pendentes**
   que ela pode decidir ali. Acima de 99, aparece "99+". A empresa aberta também mostra o número.
2. **A central de avisos (o sino)** ganha a opção **"Todas as empresas"**, que só aparece para quem está em mais de
   uma. Cada aviso mostra o nome da empresa. Abrir um aviso de outra empresa troca para ela e abre o link, sem pedir
   nada. "Marcar todos como lidos" continua valendo só para a empresa aberta.
3. **Cada empresa conta à parte, com as regras dela.** O número e a lista são calculados empresa por empresa, com a
   pessoa e o vínculo ativo dela em cada uma (o mesmo isolamento de sempre). Uma empresa onde ela foi desligada ou que
   foi suspensa some do seletor.
4. **Push e e-mail.** **Pede o seu olho:** o título do push passa a ser **"Mago OS · 4xpert"** (com o nome da empresa
   do aviso), e o assunto do e-mail começa com **"[4xpert]"**, sempre, mesmo para quem está numa empresa só. É mais
   simples e já fica pronto quando a pessoa entrar na segunda empresa.
5. **Atualização.** O número no seletor se atualiza junto com o sino (quando chega aviso pelo tempo real da empresa
   aberta) e a cada minuto para as outras empresas, sem segurar a tela.

## O que foi descartado

- **Uma lista única de avisos guardada fora das empresas:** quebraria o isolamento (cada aviso é da empresa dele).
- **Trocar de empresa sozinho quando chega aviso de outra:** atrapalharia quem está trabalhando.

## Consequências

- Contratos: `EmpresaNoSeletor` e `AvisoDeQualquerEmpresa` em `contratos/src/avisos/notificacoes.ts`.
- Núcleo: `/conta/empresas` com os números de cada empresa e `/conta/avisos` com os avisos de todas.
- Telas: o seletor com o número e a opção "Todas as empresas" no sino.
- Pronto quando: o Sandro, na Nolask, vê "4xpert (3)" no seletor, abre o sino em "Todas as empresas", clica num
  aviso da 4xpert e cai nele já dentro da 4xpert; o push chega com "Mago OS · 4xpert".
