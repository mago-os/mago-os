# Spec da Fase 2: M7 Base

Primeiro marco da Fase 2. Ordem dos marcos aprovada pelo Sandro em 25/11/2026 (M7 Base, M8 Conversas, M9 Vendas, M10
Financeiro do dia a dia, M11 Atendimento, M12 Agentes mais fortes, M13 Integrações e agenda, M14 Organização, M15
Plataforma), podendo mudar conforme o uso da 4xpert. Estado em 25/11/2026: **aprovado** pelo Sandro, com
todas as 7 recomendações.

O M7 constrói o que os marcos seguintes usam: o cadastro único de contatos (WhatsApp, CRM, atendimento e portal
ligam tudo a um contato), a API pública com chaves e os webhooks (integrações, n8n e agentes que não falam MCP), o
aviso imediato aos agentes e o seletor completo de empresas. E já pede as aprovações de fora que demoram semanas (Meta
para o WhatsApp oficial, Google para o Gmail), para elas estarem prontas quando o M8 e o M13 chegarem.

**Pronto quando:** a 4xpert cadastra os contatos dela (pessoas e organizações) e liga tarefas a eles; um sistema de
fora (por exemplo o n8n) lista e cria tarefas e contatos pela API com uma chave própria e recebe um webhook assinado
quando uma tarefa é concluída; o Hermes recebe a tarefa nova na hora, pelo aviso por webhook, sem esperar a pergunta
de cada minuto; o Sandro troca de empresa pelo seletor vendo os avisos de todas; e o pedido de aprovação do app na
Meta está enviado.

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M7-01 | Contatos: pessoas e organizações, com vários e-mails e telefones | Fase 1 | G |
| M7-02 | API pública: endereços a partir dos contratos, chaves com escopo e documentação | M7-01 | M |
| M7-03 | Webhooks de saída: avisos assinados quando algo acontece | M7-02 | M |
| M7-04 | Aviso imediato aos agentes externos por webhook | M7-03 | P |
| M7-05 | Seletor completo de empresas, com os avisos de todas num lugar só | Fase 1 | M |
| M7-06 | Pedidos de aprovação de fora: app na Meta (WhatsApp) e plano do Gmail no Google | Fase 1 | P |

Cartões no quadro: issues #196 (M7-01) a #201 (M7-06).

A ordem da tabela é a de construção, com a M7-06 começando já no primeiro dia, em paralelo (é quase toda do Sandro,
com o meu passo a passo), porque a Meta e o Google levam semanas para responder.

**O que não entra no M7:** WhatsApp, chat no site e caixa única (M8); CRM, funil e SDR (M9); memória de
relacionamento e ficha viva do contato (M12); importação de contatos de planilhas e outras ferramentas (M13; no M7, só
a criação pela tela, pela API e pelos agentes); juntar contatos duplicados automaticamente (nunca: o sistema só
sugere, a decisão é humana, como no plano).

### M7-01 Contatos: pessoas e organizações, com vários e-mails e telefones

- [ ] Banco: contatos do tipo **pessoa** ou **organização** (a pessoa pode estar ligada a uma ou mais organizações,
  com o cargo), com o papel (lead, cliente, fornecedor, parceiro ou outro, mais de um ao mesmo tempo), etiquetas,
  responsável (pessoa da equipe), fuso horário, observações e situação (ativo ou arquivado). Tudo com `empresa_id` e
  RLS, colunas marcadas (`[pessoal]` para nome, e-mails, telefones e documentos)
- [ ] Vários **identificadores** por contato (e-mails, telefones em formato internacional, @ de redes), cada um
  marcado como principal ou não. Um identificador repetido na mesma empresa não bloqueia o cadastro (recepção,
  família, contato@): mostra o aviso "já existe em outro contato" e sugere juntar
- [ ] **Juntar contatos** à mão (escolher o que fica), com auditoria e sem perder nada: identificadores, tarefas e
  notas vão para o que fica
- [ ] Tarefas e projetos ligados a contatos (uma tarefa pode citar vários), e a ficha do contato mostra as tarefas
  abertas e fechadas ligadas a ele
- [ ] Telas: lista de contatos (busca, filtros por papel, etiqueta e responsável, visões salvas como nas tarefas),
  ficha do contato e escolha do contato na tarefa. Entra na busca geral do sistema
- [ ] Permissões (módulo `contatos`: ver, criar, editar, juntar, arquivar e apagar), auditoria das ações
  importantes e o alcance (funcionário vê os contatos de que é responsável ou ligados a projetos dele; administrador e
  gestor veem todos, como nos projetos)
- [ ] Ferramentas dos agentes internos e do MCP (regra 12): listar, ver, criar e atualizar contatos, ligar contato a
  tarefa. Juntar e apagar são de alto risco e ficam só na tela
- [ ] Testes de banco (isolamento), de unidade, de tela e o teste de vazamento da M6-01 cobrindo as rotas novas

### M7-02 API pública: endereços a partir dos contratos, chaves com escopo e documentação

- [ ] Os endereços da API pública saem dos contratos que cada módulo já declara (como o MCP), num lugar só: tarefas,
  projetos, comentários, contatos e agentes no começo. Mesma conferência de permissão, mesmo alcance e mesma
  auditoria da tela e do MCP
- [ ] **Chaves de API** da empresa (tela Configurações › API): nome, escopo (quais módulos e se lê ou também
  escreve), validade, limite opcional por IP, criar, trocar e revogar. A chave aparece uma vez só. Agentes externos
  usam a própria chave nos dois caminhos, e o administrador escolhe na tela do agente "só MCP", "só API" ou "os
  dois" (padrão)
- [ ] Limites: pedidos por minuto por chave e por empresa (uma empresa não derruba as outras) e o limite de registros
  lidos por hora de cada agente (padrão 500, como no plano), que pausa o agente e avisa o administrador
- [ ] Documentação gerada dos contratos (OpenAPI), pública em app.osmago.com/api/docs, sem nenhum dado, com exemplos
  em português, e o teste que confere que ela está em dia
- [ ] Testes: escopo e validade da chave, IP, limites, e o teste de vazamento cobrindo a API pública

### M7-03 Webhooks de saída: avisos assinados quando algo acontece

- [ ] Tela Configurações › Webhooks: endereço (https), eventos escolhidos e um segredo por webhook
- [ ] Eventos do começo: tarefa criada, atualizada, concluída e comentada; contato criado e atualizado; aprovação
  pedida e respondida
- [ ] Cada aviso sai assinado (HMAC com o segredo e a hora, para o outro lado conferir e recusar repetição), com um
  número único (o outro lado ignora se já recebeu)
- [ ] Entrega pela fila: novas tentativas com espera crescente por até 24 horas; depois de 3 dias falhando, o
  webhook é desligado e o administrador avisado. Histórico das entregas na tela (código, tempo, nova tentativa à mão)
- [ ] O aviso não leva dado sensível nem o texto inteiro: leva o que mudou e o id, e quem precisar busca pela API
- [ ] Testes: assinatura, repetição, falha e desligamento, e que uma empresa nunca recebe evento de outra

### M7-04 Aviso imediato aos agentes externos por webhook

- [ ] Na tela do agente externo, um endereço de aviso opcional. Quando o agente recebe uma tarefa, é mencionado ou
  tem uma aprovação respondida, o núcleo avisa na hora (pelos webhooks da M7-03)
- [ ] A pergunta a cada minuto continua funcionando como reserva (um aviso perdido não perde a tarefa)
- [ ] Guia dos agentes (`docs/operacao/agentes.md`) e o do Hermes atualizados, com o exemplo de como conferir a
  assinatura

### M7-05 Seletor completo de empresas, com os avisos de todas num lugar só

- [ ] Seletor no topo com todas as empresas da pessoa e, ao lado de cada uma, quantos avisos e aprovações estão
  esperando
- [ ] Central de avisos com a opção "todas as empresas", cada aviso marcado com a empresa; abrir um aviso de outra
  empresa troca para ela
- [ ] Push e e-mail dizem de qual empresa é o aviso
- [ ] Testes de tela e de isolamento (o contador e a lista não mostram nada além do que a pessoa já pode ver em cada
  empresa)

### M7-06 Pedidos de aprovação de fora: app na Meta (WhatsApp) e plano do Gmail no Google

- [ ] Meta: verificação da empresa (Nolask) no portfólio de negócios da Meta, app "Mago OS" com o produto WhatsApp,
  número de teste e o pedido das permissões do WhatsApp Business. Passo a passo para o Sandro, que faz com a conta
  dele; eu preparo os textos, a política (já no ar) e o vídeo de demonstração quando a Meta pedir
- [ ] Google (Gmail): levantamento do que o Google exige para ler e-mails de outras empresas (escopos restritos,
  verificação e a avaliação de segurança), com custo e prazo, para o Sandro decidir antes do M13
- [ ] Logo no Branding do Google e a conferência do domínio osmago.com (registro TXT só com o ok escrito do Sandro),
  que ficaram de fora na M6-05c

## Decisões para o Sandro

1. **Pessoa e organização.** Recomendado: dois tipos de contato, com a pessoa ligada a uma ou mais organizações (com
   o cargo). É o que o CRM, o atendimento e o portal vão precisar. Alternativa: só pessoas, com a empresa como texto
   (mais simples agora, mas dá retrabalho no M9).
2. **Duplicados.** Recomendado: o sistema só avisa e sugere juntar; quem decide é uma pessoa (como já está no plano).
3. **Endereço da API.** Recomendado: `app.osmago.com/api` por enquanto, sem DNS novo. O plano fala em
   `api.osmago.com`; ele pode entrar depois, apontando para o mesmo lugar, sem quebrar nada. Alternativa: criar o
   `api.osmago.com` já no M7 (precisa do seu ok para o DNS).
4. **Documentação da API.** Recomendado: pública (não tem dado nenhum, e facilita ligar n8n e outros). Alternativa:
   só para quem está logado.
5. **Webhooks que falham.** Recomendado: tentar por 24 horas com espera crescente e desligar depois de 3 dias de
   falha, avisando o administrador.
6. **Limite de leitura dos agentes.** Recomendado: 500 registros por hora por agente, como no plano, que o
   administrador aumenta quando precisar (por exemplo numa migração).
7. **Meta.** Recomendado: fazer o pedido pelo portfólio de negócios da Nolask que já existe (o mesmo do Instagram
   da EngExpose), com a verificação da empresa pelo CNPJ. Começa no primeiro dia do M7.
