# 0047 API pública

- **Data:** 25/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 25/11/2026, com os quatro pontos recomendados)
- **Tarefa:** M7-02

## Contexto

A spec do M7, aprovada em 25/11/2026, pede uma API pública para sistemas de fora (n8n, Make, o site da empresa) e
para agentes que não falam MCP. As decisões 3 (endereço em app.osmago.com/api, sem DNS novo), 4 (documentação
pública) e 6 (500 leituras por hora por agente) já estão aprovadas. Esta nota acerta o resto, com os pontos que
pedem o olho do Sandro marcados com **pede o seu olho**.

## Decisão

1. **Endereço e versão.** `https://app.osmago.com/api/v1/...`. O "v1" deixa mudar a API no futuro sem quebrar quem
   já usa. A documentação fica em `app.osmago.com/api/docs` (página) e `app.osmago.com/api/openapi.json` (o
   arquivo que ferramentas como o n8n importam), públicas e sem nenhum dado.
2. **Endereços do começo** (14), declarados no contrato `contratos/src/api/publica.ts`: tarefas (listar, ver, criar,
   mudar status, comentários), ligar contatos a uma tarefa, projetos (listar, ver), contatos (listar, ver,
   cadastrar, mudar) e agentes (listar). Apagar e juntar não entram (alto risco, só na tela). Cada endereço usa a
   mesma conferência de permissão, o mesmo alcance e a mesma auditoria da tela, com o canal "api".
3. **Chave de API da empresa** (tela Configurações › API, só o administrador): `mago_api_...`, mostrada uma vez só,
   guardada só como resumo (como a chave do agente). Cada chave tem nome, escopo por módulo (tarefas, projetos,
   contatos, agentes: "ler" ou "escrever"), validade e, se quiser, a lista de IPs ou faixas de onde pode ser usada.
4. **Em nome de quem a chave age.** **Pede o seu olho:** cada chave age em nome de uma pessoa da empresa (padrão:
   o administrador que criou) e nunca passa do que essa pessoa pode, nem do escopo da chave. O que ela cria fica
   com o nome dessa pessoa, marcado como vindo da API. Se a pessoa sair da empresa, a chave para na hora. Assim
   a API nunca vê mais do que alguém de dentro veria.
5. **Validade.** **Pede o seu olho:** padrão e máximo de 1 ano. Perto de vencer (30 dias antes), o administrador
   recebe um aviso. Uma chave sem validade é recusada, para nenhuma chave esquecida valer para sempre.
6. **Trocar e revogar.** **Pede o seu olho:** "Trocar" cria uma chave nova e deixa a antiga valer mais 24 horas,
   para dar tempo de atualizar o sistema de fora. "Revogar" corta na hora.
7. **Agentes externos.** O agente usa a própria chave (`mago_ag_`) nos dois caminhos, com o mesmo alcance do MCP: nas
   tarefas, só as dele; nos contatos, o que o responsável por ele vê. Na tela do agente, o administrador escolhe
   "só MCP", "só API" ou "os dois" (padrão).
8. **Limites.** **Pede o seu olho:** 120 pedidos por minuto por chave e 600 por minuto por empresa (uma empresa não
   derruba as outras). Passou: o pedido é recusado com o código 429 e o tempo para tentar de novo. O agente
   continua com o limite de 500 registros lidos por hora (decisão 6), que pausa o agente e avisa o responsável; o
   administrador aumenta na tela de limites.
9. **Erros.** Sempre com um código fixo e a explicação em português (`{"code":"FORA_DO_ESCOPO","message":"..."}`).
   Uma chave recusada vira evento de auditoria (`chave_api.recusou`), com o motivo e sem a chave.
10. **Auditoria.** `chave_api.criou`, `chave_api.trocou`, `chave_api.revogou` e `chave_api.recusou`. As ações feitas
    pela API entram com o ator (a pessoa da chave ou o agente) e o canal "api".
11. **Documentação gerada.** O OpenAPI sai do mesmo contrato das rotas, com os exemplos em português, e um teste
    confere que a documentação, as rotas e o contrato estão iguais.

## O que foi descartado

- **api.osmago.com agora:** decisão 3 da spec (pode vir depois, apontando para o mesmo lugar).
- **Chave sem pessoa, com permissão própria:** daria um "super usuário" fora das regras de perfil.
- **Chave sem validade:** recusada pelo risco de chave esquecida.

## Consequências

- Contratos: `contratos/src/api/publica.ts` (chave de API, escopo, IPs, limites, motivos de recusa, erro e as 14
  rotas); `canais` no agente ("mcp", "api" ou "os_dois").
- Banco: `chaves_de_api` (com `empresa_id` e RLS) e `agentes.canais`.
- Telas: Configurações › API (criar, trocar, revogar, ver o último uso) e a escolha do canal na tela do agente.
- Pronto quando: o n8n lista e cria tarefas e contatos com uma chave própria, a chave de outra empresa não vê nada,
  e a documentação em app.osmago.com/api/docs mostra todos os endereços com exemplos.
