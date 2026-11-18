# 0017 Chave do agente e agente vivo

- **Data:** 18/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 18/11/2026)
- **Tarefa:** M2-04

## Contexto

Na M2-05 os agentes externos (Claude no Mac, Hermes e outros) entram no Mago OS pelo MCP. Cada um precisa de uma credencial própria que o administrador possa revogar na hora, que só valha para a empresa e o agente dela, e que não vire risco se o banco vazar. Também precisamos saber se o agente está vivo: o Mac dorme, a VPS cai, e uma tarefa pegada não pode ficar presa para sempre.

## Decisão

1. **Formato da chave:** `mago_ag_<10 letras e números>_<43 caracteres>`. A parte do meio identifica a chave; o final são 32 bytes aleatórios (base64url). O prefixo `mago_ag_` deixa a chave fácil de reconhecer por ferramentas que procuram segredos vazados (como o GitHub).
2. **O que o banco guarda:** o começo (`mago_ag_` + identificação, único) e o resumo SHA-256 da chave inteira. Nunca a chave. Como o segredo tem 256 bits aleatórios, SHA-256 basta (senha de pessoa é que precisa de um embaralhamento lento). A comparação do resumo é de tempo constante. A chave inteira aparece uma vez só, na tela, na hora de criar.
3. **Várias chaves por agente:** cada uma com nome, validade opcional, último uso e Revogar. Trocar sem parar: cria a nova, troca no agente, revoga a velha. Revogar vale no pedido seguinte (a chave é conferida no banco a cada pedido, sem cache).
4. **Onde vale:** a chave leva à empresa e ao agente dela, e o pedido roda com a empresa do agente (o Row Level Security continua isolando). Agente pausado ou desligado é recusado; chave revogada ou vencida também. Toda recusa vira `chave.recusou` na auditoria, com o motivo e o começo da chave, nunca a chave inteira.
5. **Limites:** 60 pedidos por minuto por chave e 500 registros lidos por hora por agente (o padrão do plano). Os contadores ficam no banco, por minuto e por hora, então funcionam com mais de uma cópia da API (regra 9). Passou do limite: o pedido é recusado, o agente é pausado e a pessoa responsável recebe aviso (`agente.passou_do_limite`).
6. **Sinal de vida:** todo pedido aceito atualiza o "último sinal" do agente; existe também a ação `estou_vivo`, só para isso.
7. **Verificação a cada minuto (pg-boss):** tarefa pegada por um agente sem sinal há mais tempo que o limite dele (padrão 15 minutos, alterável por agente) volta para A fazer, com um comentário do sistema; a pessoa responsável recebe aviso no Mago OS e por e-mail (`agente.sem_sinal`). Pior caso: 15 minutos sem sinal mais 1 da verificação, os 16 da spec.
8. **Aviso no Mago OS:** tabela nova de avisos por pessoa, mostrados no Início até a pessoa marcar como lido (o mesmo jeito dos avisos de aparelho novo). O desligamento de agente (M2-03) também passa a gerar aviso. Notificação push fica para o M3.

## Descartado

- **Chave guardada no banco (ou cifrada):** quem lesse o banco, ou a chave de cifra, usaria a chave do agente. Com só o resumo, o vazamento do banco não dá acesso.
- **JWT assinado sem consulta ao banco:** revogar na hora exigiria uma lista de bloqueio de qualquer jeito; a consulta por pedido é simples e barata.
- **OAuth para os agentes:** os agentes externos de hoje (Claude Code, Hermes) aceitam bem um cabeçalho com chave; OAuth fica para quando houver a API pública.
- **Contadores na memória da API:** quebrariam com duas cópias e na troca azul e verde.

## Consequências

- A M2-05 usa esta chave no cabeçalho `Authorization: Bearer ...` do MCP.
- Contrato em `contratos/src/agentes/chave.ts`: chave, pedido, resposta de criar, motivos de recusa, limites e o aviso.
