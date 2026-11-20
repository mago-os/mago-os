# 0021 Cofre interno e contas de IA da empresa

- **Data:** 20/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 20/11/2026)
- **Tarefa:** M4-01

## Contexto

No M4 os agentes internos (coordenador e especialista) chamam modelos de IA com as chaves da própria empresa. Uma chave de IA é dinheiro: quem a tiver gasta na conta da empresa. Diferente da chave do agente (decisão 0017), que o Mago OS só precisa conferir, a chave de IA precisa ser usada de volta, então não dá para guardar só o resumo: ela precisa ficar cifrada e ser decifrada na hora da chamada.

## Decisão

1. **Cifra com envelope.** Cada empresa tem a própria chave de dados (32 bytes aleatórios), guardada no banco cifrada pela chave mestra. Cada chave de IA é cifrada com a chave de dados da empresa. Os dois níveis usam AES-256-GCM (do `node:crypto`), com um número aleatório novo de 12 bytes a cada cifra e a empresa e a conta como dado autenticado, para um texto cifrado não poder ser copiado para outra empresa ou outra conta.
2. **A chave mestra fica fora do banco**, no Infisical (`MAGO_COFRE_CHAVE_MESTRA`, um por ambiente), e chega à API pela variável de ambiente como as outras. Um vazamento só do banco (ou de um backup) não revela nenhuma chave de IA. A chave mestra tem número de versão: trocar é gerar a nova, cifrar de novo só as chaves de dados das empresas (as chaves de IA não mudam) e apagar a velha. O passo a passo fica em `docs/operacao/cofre.md`.
3. **A chave só entra.** Nenhuma rota, tela ou ferramenta do MCP devolve a chave, nem para o administrador ou o Dono: dá para testar, trocar ou apagar. O contrato marca o campo como `writeOnly` e a conta devolvida não tem o campo. A tela mostra os 4 últimos caracteres. A chave decifrada só existe na memória durante a chamada ao provedor e nunca vai para o registro, a auditoria, o rastreio ou para o agente.
4. **Ao conectar, o núcleo testa** (lista os modelos do provedor) antes de gravar. Chave recusada não é gravada. Os modelos descobertos chegam desligados e o administrador libera; só modelo liberado pode ser escolhido para um agente. O teste refeito marca quais modelos sumiram.
5. **Provedores do M4:** `anthropic` (endereço oficial, fixo no código) e `compativel_openai` (endereço informado, sempre https; http só para localhost, para um Ollama na mesma máquina). O endereço não aceita parâmetros, para a chave não ir parar numa URL.
6. **Várias contas por empresa**, cada uma com teto mensal opcional em centavos de dólar (o teto é conferido na M4-06). Cada agente interno escolhe um modelo principal e um reserva (de outra conta ou outro modelo); se o principal falha ou chega no teto, a execução passa para o reserva e isso fica registrado.
7. **Permissão:** módulo novo "Contas de IA" (`contas_de_ia`), com ver, criar, editar e excluir só para o administrador por padrão. Marcado como dado sensível.
8. **Banco:** tabela `contas_de_ia` (com `empresa_id`, RLS e marcas; a coluna do texto cifrado é `[sensivel]`), `modelos_de_conta_de_ia` e `chaves_de_dados` (uma por empresa, cifrada pela mestra). A escolha de modelo fica em `agentes`.
9. **Auditoria:** `ia.conectou`, `ia.testou`, `ia.trocou_chave`, `ia.editou`, `ia.liberou_modelo`, `ia.apagou` e `agente.escolheu_modelo`, com o nome da conta e o final da chave, nunca a chave.

## Descartado

- **Cofre externo (HashiCorp Vault, OpenBao) desde já:** mais um serviço na VPS02 para manter e copiar no backup. O envelope deixa a troca para um cofre externo simples depois, porque só a chave mestra muda de lugar.
- **pgcrypto no próprio banco:** a chave de cifra passaria pelo SQL e poderia aparecer em registros de consulta.
- **Uma chave só para todas as empresas, sem envelope:** trocar a chave mestra exigiria decifrar e cifrar de novo todas as chaves de IA, e não haveria como apagar o cofre de uma empresa sozinha.

## Consequências

- Contrato em `contratos/src/agentes/contas-de-ia.ts`.
- Os testes usam um provedor falso; a chave mestra de teste é gerada no próprio teste.
- Apagar uma empresa (M6) apaga a chave de dados dela, o que torna inúteis as cópias cifradas que ficarem nos backups.
