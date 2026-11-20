# 0022 Plano de assinatura nas contas de IA

- **Data:** 20/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 20/11/2026)
- **Tarefa:** M4-10

## Contexto

A M4-01 só aceita chave de API. O Sandro decidiu em 20/11/2026 (caminho 2 dos três propostos) que qualquer agente interno também pode usar um plano de assinatura, para servir à empresa de uma pessoa só e ao autônomo com CPF. Cada provedor tem uma regra diferente sobre usar o plano fora dos apps dele, e por isso **a responsabilidade é do administrador**: o sistema informa e registra, e não decide nem bloqueia.

## Decisão

1. **Tipo de credencial na conta:** `chave_de_api` (o de hoje) ou `assinatura`. O provedor diz quais aceita: Anthropic aceita os dois; compatível com OpenAI, só chave; `chatgpt` (provedor novo), só assinatura. Provedor e tipo não mudam depois: para trocar, conecta-se outra conta.
2. **O que entra:** na Anthropic, o token de longa duração do `claude setup-token`; no ChatGPT, o conteúdo do arquivo de login do Codex (`auth.json`, com o token de renovação). Os dois vão para o mesmo cofre da decisão 0021, com as mesmas regras: só entram, nunca saem. No ChatGPT, o núcleo renova o acesso sozinho e guarda a renovação no cofre.
3. **Aceite dos termos:** ao conectar uma assinatura, o administrador marca o aviso `AVISO_DA_ASSINATURA` (texto e versão no contrato). A conta guarda quem aceitou e quando, e a auditoria recebe `ia.aceitou_termos` com o provedor e a versão do aviso. Sem o aceite, o pedido é recusado. Nenhuma outra trava.
4. **Custo e limite:** a execução pela assinatura registra os tokens com custo zero, e a conta não tem teto em dólar. Quando o provedor avisa que o limite do plano acabou, a conta guarda até quando (`limiteDoPlanoAte`), a auditoria recebe `ia.chegou_no_limite_do_plano`, e os agentes passam para o modelo reserva até lá.
5. **Teste ao conectar:** a assinatura nem sempre lista modelos, então o teste é uma chamada mínima ao modelo. Os modelos conhecidos do plano entram desligados, como na chave de API.

## Descartado

- **O sistema decidir, por provedor, se a assinatura pode ser usada:** cada provedor tem uma regra, e ela muda; a decisão é do administrador (Sandro, 20/11/2026).
- **Executor no computador da pessoa (caminho 1):** mais conforme aos termos, mas só funciona com o computador ligado. Pode voltar como opção depois.

## Consequências

- Contrato em `contratos/src/agentes/contas-de-ia.ts` (tipo de credencial, provedor `chatgpt`, aviso, aceite e limite do plano).
- Migração nova em `contas_de_ia` (colunas do aceite, do limite e do tipo; texto cifrado maior para o JSON do Codex).
- A tela de conectar ganha a escolha "Chave de API" ou "Assinatura", com o aviso para marcar.
