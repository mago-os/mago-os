# 0012 Perfis e permissões por módulo

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat em 17/11/2026)
- **Tarefa:** M1-06

## Contexto

O plano define três camadas de permissão: perfil (administrador, gestor de área, funcionário), ajuste por módulo com alcance ("tudo", "da minha equipe", "só meus itens") e dados sensíveis só com liberação explícita. A spec pede uma verificação central no núcleo, usada por todas as rotas, e testes para cada perfil.

## Decisão

1. **Contrato** (`contratos/src/permissoes.ts`): ações `ver`, `criar`, `editar`, `aprovar`, `excluir`; alcances `nada` < `meus` < `equipe` < `tudo`; `ver_sensiveis` (tudo ou nada); cada módulo declara as ações que tem, se tem dados sensíveis e a área a que pertence (nula para os módulos do núcleo).
2. **Padrão do perfil:** administrador pode tudo, inclusive dados sensíveis, e ajustes não o limitam (assim ninguém tranca a empresa fora dela mesma). Gestor de área: todas as ações com alcance "equipe" nos módulos da área dele; nada nas outras. Funcionário: ver, criar e editar só os próprios itens nos módulos da área dele; aprovar e excluir, não. Nos módulos do núcleo: o gestor vê as pessoas da equipe e o funcionário vê só a si mesmo; permissões e auditoria são só do administrador.
3. **Ajustes por pessoa** (`ajustes_de_permissao`, isolada por empresa): o administrador muda uma ação ou libera os dados sensíveis de um módulo para uma pessoa. Ação que o módulo não declara é ignorada.
4. **Equipe = área:** o funcionário passa a poder ter área (mudança no contrato do vínculo da M1-01, aprovada junto). A equipe de um gestor são as pessoas da mesma área. O administrador não tem área.
5. **Verificação central** (`nucleo/src/permissoes`): `verificador.exigir(modulo, acao)` é o preHandler de toda rota de dados. Ele confere sessão, 2FA, empresa escolhida e permissão, e entrega à rota o alcance já transformado em filtro de consulta, e se ela pode mostrar dados sensíveis. O cálculo é uma função pura, a mesma que os agentes e o MCP vão usar (M2).
6. **O isolamento entre empresas continua no banco** (Row Level Security), por baixo das permissões. Uma regra de permissão errada nunca mostra outra empresa.
7. **Rotas do núcleo já protegidas:** `GET /empresa/pessoas` (cada um vê conforme o alcance; e-mail só com dados sensíveis), `GET /empresa/minhas-permissoes` e `PUT /empresa/permissoes` (ajuste, só com "permissoes.editar").

## Descartado

- **Permissões dentro do banco (Row Level Security por perfil):** cada módulo teria políticas complexas e difíceis de testar; o alcance como filtro no núcleo é mais simples, e o banco segue garantindo o principal, que é o isolamento entre empresas.
- **Lista de permissões solta por pessoa, sem perfil:** o plano pede o perfil como ponto de partida; sem ele, cada pessoa nova daria trabalho para configurar.
- **Ajustes também para o administrador:** abriria o risco de a empresa ficar sem ninguém que possa administrar.

## Consequências

- Todo módulo novo declara as próprias ações e a área no catálogo (`nucleo/src/permissoes/modulos.ts`), e toda rota dele usa `verificador.exigir`.
- O perfil dos agentes e a regra "o agente age com as permissões de quem pede" (interseção das duas) entram no M2. Limites de aprovação por valor, no módulo financeiro. As telas de permissão, na M1-10.
- Mudanças de permissão vão para o log (`permissao.alterou`) e, na M1-09, para a auditoria encadeada.
