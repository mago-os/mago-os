# 0008 Contratos com TypeBox, e o formato dos contratos de identidade

- **Data:** 17/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat, "aprovado", em 17/11/2026)
- **Tarefa:** M1-01

## Contexto

Os contratos (`@mago-os/contratos`) são a única forma de um módulo falar com outro (AGENTS.md, regra 1). Eles precisam servir para três coisas ao mesmo tempo: dar os tipos ao TypeScript, conferir os dados que chegam (da tela, da API, de um agente) e virar a descrição das rotas e ações, que o Fastify usa e que gera a documentação da API e do MCP no M2-05.

## Decisão

1. **TypeBox** (pacote `typebox`, versão 1.x). Cada contrato é um esquema TypeBox: o mesmo objeto é JSON Schema puro (o formato que o Fastify entende), dá o tipo com `Static<>` e confere os dados com `conferir()`, que devolve todos os problemas de uma vez, com o caminho de cada um.
2. **Regras extras** que o JSON Schema não expressa bem (gestor de área precisa de área; as datas seguem a ordem; aparelho confiável por até 30 dias) ficam em funções `regrasDo...` ao lado do esquema, e `conferirX()` aplica as duas coisas.
3. **Contratos de identidade** (proposta aprovada):
   - **Pessoa:** um e-mail (em minúsculas) é uma pessoa só no sistema inteiro. Situação ativa ou bloqueada.
   - **Empresa:** nome e situação ativa ou suspensa. Planos e cobrança na Fase 2.
   - **Vínculo:** pessoa numa empresa, com perfil `administrador`, `gestor_area` (com área) ou `funcionario`, e situação `convidado`, `ativo` ou `desligado`, com datas. Um convite cancelado vira `desligado` sem data de entrada.
   - **Papel na plataforma:** `dono`, acima das empresas e fora do vínculo. O revendedor entra aqui na Fase 2.
   - **Sessão:** um aparelho conectado, com a empresa ativa (nula antes de escolher), IP, datas e o 2FA. O token nunca faz parte do contrato.
   - **Evento de auditoria:** ator (pessoa, agente ou sistema), ação `assunto.verbo`, alvo, origem (canal, IP e aparelho), quando, rastreio e detalhes. Detalhes com nomes como senha, token, segredo, código de 2FA, cartão ou CPF são recusados.
4. **Corrente da auditoria:** cada evento guarda o SHA-256 do anterior. Há uma corrente por empresa e uma da plataforma (empresa nula), cada uma com a própria sequência começando em 1, para cada empresa conferir a sua sem ver as outras. O hash é calculado sobre o texto canônico do evento (JSON sem espaços, chaves em ordem alfabética, sem o próprio hash), com o Web Crypto, que existe no Node e no navegador. Mudar esse texto quebra as correntes gravadas: só com nota nova e subindo `VERSAO_CONTRATOS`.
5. **Canal `sistema`** na origem, além de painel, API, Telegram e MCP, para o que o próprio sistema faz (fila, expiração de sessões), que não tem IP nem aparelho.

## Descartado

- **Zod:** muito usado, mas o JSON Schema dele é uma conversão à parte, e o Fastify trabalha nativamente com JSON Schema.
- **Tipos TypeScript puros com validação escrita à mão:** dois lugares para manter em sincronia, e sem a descrição automática da API.
- **`@sinclair/typebox` 0.34:** é a linha antiga; o mesmo autor publica agora o pacote `typebox` 1.x.
- **Uma corrente única para todas as empresas:** obrigaria quem confere a ver eventos de outras empresas, o que vai contra o isolamento.

## Consequências

- As tarefas seguintes do M1 usam só estes formatos. Ação nova de auditoria entra em `ACOES_IDENTIDADE` (ou na lista do módulo) junto com a tarefa que a usa.
- Ligar o TypeBox às rotas do Fastify (type provider) fica para a primeira tarefa que criar uma rota de identidade.
- Permissões por módulo (M1-06), chaves dos agentes (M2), revendedor e planos (Fase 2) ficam de fora deste contrato.
