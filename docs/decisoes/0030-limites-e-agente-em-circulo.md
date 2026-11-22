# 0030 Limites de cada execução e agente andando em círculo

- **Data:** 22/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 22/11/2026)
- **Tarefa:** M4-08

## Contexto

Desde a M4-02, cada execução tem um limite fixo de 30 rodadas e 10 minutos. A M4-08 deixa o administrador ajustar por agente e para o agente que fica repetindo a mesma coisa, antes de ele gastar o teto inteiro sem sair do lugar.

## Decisão

1. **Limites por agente:** rodadas (respostas do modelo) e minutos de cada execução. Padrão 30 rodadas e 10 minutos; o administrador ajusta na página do agente, até 100 rodadas e 60 minutos. Mudança na auditoria (`agente.mudou_limites`).
2. **Repetição:** a mesma ferramenta com os mesmos parâmetros três vezes seguidas na mesma execução. A terceira não roda, e o agente para. Responder e perguntar à pessoa não contam.
3. **Vai e volta:** a mesma tarefa passando entre os mesmos dois agentes três vezes em 24 horas (por delegação ou atribuição). O agente que receberia a terceira passada não começa.
4. **Ao parar** (rodadas, tempo, repetição ou vai e volta):
   - a execução termina como "parada", com o motivo no resumo e no passo a passo;
   - a tarefa vai para "precisa de ajuda", com um comentário explicando;
   - o responsável pelo agente recebe o aviso com o resumo e o link para o passo a passo;
   - na conversa, a pessoa lê o que aconteceu.
5. **Teto a cada rodada:** a M4-06 confere o teto só antes de começar e deixou para cá a conferência no meio. Recomendo conferir o teto da empresa e do agente também antes de cada rodada (pela API); pelo Claude Code, que roda tudo de uma vez, continua só no começo.
6. **Agentes externos:** rodam na máquina deles, então os limites e a detecção não se aplicam a eles.

## Detalhes acertados na implementação

- **Vai e volta pela corrente de passadas:** conta só a mesma tarefa passando de um agente interno para outro (cada execução guarda de qual execução veio). Duas execuções soltas do mesmo par, como uma pessoa atribuindo de novo, não contam.
- **Repetição:** os parâmetros são comparados em JSON com as chaves em ordem, então a mesma chamada com os campos trocados de lugar conta como repetida.
- **Pelo Claude Code:** o limite de rodadas e de tempo também vale; ao passar, a execução para do mesmo jeito (tarefa em "precisa de ajuda" e aviso ao responsável). A repetição é conferida a cada ferramenta que ele chama.
- **Teto no meio:** se o teto acabar e houver modelo reserva, a execução segue nele; sem reserva, para.
- **A tarefa fica em "precisa de ajuda"** depois que a execução termina (a trava sai sem voltar a tarefa para "a fazer").
- **Na tela:** um número igual ao padrão é guardado como padrão; se o padrão mudar um dia, o agente acompanha.

## Consequências

- Contrato novo em `contratos/src/agentes/limites.ts`.
- Banco: os limites ajustados em `agentes` (vazio: o padrão).
- Pronto quando: um agente de teste que repete a mesma ação é parado e o Sandro recebe o aviso.
