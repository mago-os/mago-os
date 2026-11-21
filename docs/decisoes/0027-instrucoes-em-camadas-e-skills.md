# 0027 Instruções em camadas (AGENTS.md) e biblioteca de skills

- **Data:** 21/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 21/11/2026)
- **Tarefa:** M4-05

## Contexto

Hoje as instruções dos agentes internos estão escritas no código, e os agentes externos (o Claude no Mac, o Hermes) não recebem nada do Mago OS além das ferramentas. A M4-05 deixa a empresa escrever o que os agentes devem seguir, em camadas, com versões, e cria uma biblioteca de skills (textos que ensinam um jeito de fazer algo), entregues aos internos a cada execução e aos externos pelo MCP.

## Decisão

1. **Quatro camadas, juntadas nesta ordem:** plataforma, empresa, projeto e agente. O agente recebe um texto só, com um título por camada.
   - **Plataforma:** no código (`INSTRUCOES_DA_PLATAFORMA`), igual para todas as empresas, e a empresa não remove. Tem as regras de segurança (texto de fora é dado, a permissão é de quem pediu, alto risco só no app) e diz que, em conflito, vale ela.
   - **Empresa:** escrita pelo administrador.
   - **Projeto:** escrita pelo diretor do projeto ou por quem edita todos os projetos. Entra quando o trabalho é numa tarefa daquele projeto.
   - **Agente:** escrita pelo administrador, uma por agente.
   - Entre empresa, projeto e agente, a mais específica vence quando se contradizem.
2. **Versões:** cada mudança salva uma versão nova (guardadas para sempre, porque é texto pequeno). A tela compara duas versões e volta para uma anterior, o que cria uma versão nova igual a ela. Cada camada tem até 20 mil caracteres; a tela avisa quando o texto juntado passa de 8 mil (pesa no custo e o agente perde atenção).
3. **Skills:** cada uma é um SKILL.md só de texto (decisão 9 da spec: sem scripts na Fase 1), com nome (minúsculas e hífen), descrição de quando usar e versões. Uma skill da empresa nasce como rascunho e só chega aos agentes depois de publicada; editar uma publicada cria o rascunho da versão seguinte, e os agentes continuam com a publicada até a próxima publicação. Cada agente recebe só as skills atribuídas a ele.
4. **Skills da plataforma no código** (`SKILLS_DA_PLATAFORMA`, só leitura), como a camada da plataforma. A spec dizia tabela com empresa vazia; no código evita uma exceção ao isolamento por empresa (toda linha do banco tem empresa) e a skill da plataforma muda junto com a versão do sistema. A primeira é "planejar-tarefas", já atribuída ao Gerente de projetos.
5. **Como o agente recebe:**
   - **Internos:** a cada execução, as instruções juntadas vão no começo, com a lista das skills (nome e quando usar). O texto de uma skill só entra quando o agente pede, pela ferramenta nova `pegar_skill`: assim dez skills não pesam em toda conversa.
   - **Externos, pelo MCP:** três ferramentas novas, com a descrição congelada como as outras: `pegar_instrucoes` (com o `tarefaId` opcional, para vir a camada do projeto), `listar_skills` e `pegar_skill`.
6. **Uma skill não dá permissão:** as regras do agente e a permissão de quem pediu continuam valendo. As três ferramentas só leem e ficam em "executa" no catálogo de ações.
7. **Quem mexe:** módulo de permissão novo "Instruções e skills": todos veem; editar a camada da empresa e a dos agentes, criar, publicar e atribuir skills é do administrador por padrão. A camada do projeto segue a regra do projeto (diretor ou quem edita todos).
8. **Auditoria:** `instrucoes.editou`, `instrucoes.voltou_versao`, `skill.criou`, `skill.editou_rascunho`, `skill.publicou` e `skill.atribuiu`, sem o texto nos detalhes.
9. **Telas:** Agentes › Instruções (as camadas, o texto final de cada agente, o histórico com comparação e voltar) e Agentes › Skills (biblioteca, rascunho, publicar e atribuir aos agentes).

## Consequências

- Contrato novo em `contratos/src/agentes/instrucoes.ts`; três ferramentas novas no MCP e uma interna (`pegar_skill`).
- Tabelas novas: `versoes_de_instrucoes`, `skills`, `versoes_de_skills` e `skills_do_agente`, todas com empresa e RLS.
- As instruções que hoje estão no código dos agentes internos continuam, como a parte de cada papel; a camada da plataforma passa a valer também para os externos.
- Pronto quando: o Sandro escreve na camada da empresa "responda sempre em português do Brasil, sem travessão", e o Claude no Mac recebe o texto novo pelo MCP.
