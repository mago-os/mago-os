# Spec da Fase 2: M8 Conversas

Segundo marco da Fase 2 (ordem aprovada pelo Sandro em 25/11/2026). Estado: **aprovada pelo Sandro em 27/11/2026**, com as
recomendações das 11 decisões. Faltam os números das decisões 5 e 6.

O M8 traz para dentro do Mago OS as conversas com quem é de fora da empresa: o WhatsApp (primeiro pela Evolution API,
a oficial da Meta quando o app for aprovado) e o chat no site, todos numa caixa única, atendidos por um agente com
passagem para um humano, e cada conversa ligada ao contato certo (o cadastro do M7). É a base que o CRM e o SDR (M9)
e o atendimento (M11) vão usar. Também liga o WhatsApp oficial da própria plataforma, para a equipe receber os avisos
e falar com o coordenador como já faz pelo Telegram.

**Pronto quando:** a 4xpert conecta um número de WhatsApp lendo o QR code na tela; um cliente manda mensagem, a
conversa aparece na caixa única ligada ao contato (ou a um contato novo "não identificado"), e o agente de
atendimento responde conforme o modo escolhido para aquele número; o cliente pede para falar com uma pessoa, alguém da
equipe é avisado, assume, responde pela caixa e devolve a conversa ao agente com um botão; um visitante do site
conversa pelo balão, deixa o WhatsApp e continua por lá sem perder o histórico; e o Sandro recebe um aviso de tarefa
pelo WhatsApp oficial do Mago OS (com o número de teste da Meta, se o app ainda não estiver aprovado).

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M8-01 | Base das conversas com contatos: canais, conversas, mensagens e a linha do tempo do contato | M7 | G |
| M8-02 | Evolution API no servidor e conectar um número pelo QR code | M8-01 | M |
| M8-03 | Receber e enviar mensagens pela Evolution (texto, foto, documento e áudio) | M8-02 | G |
| M8-04 | Caixa única: a tela das conversas, com dono, situação, nota interna e tempo real | M8-01 | G |
| M8-05 | Agente na conversa: quem atende cada canal, modo de resposta e horário | M8-03, M8-04 | M |
| M8-06 | Passagem para humano: sinais, aviso com resumo, prazo, silêncio do agente e devolver | M8-05 | M |
| M8-07 | Chat no site: o balão, o contexto da página e "continuar no WhatsApp" | M8-05 | G |
| M8-08 | Áudio: transcrição do que chega e gravar áudio pela caixa | M8-03 | P |
| M8-09 | WhatsApp oficial da plataforma: vincular o número da pessoa, avisos e conversa com o coordenador | M8-01 | M |
| M8-10 | WhatsApp oficial para os números das empresas (conexão pela Meta, janela de 24 horas e modelos) | M8-03, aprovação da Meta | M |
| M8-11 | Conversas na API pública, no MCP e nos webhooks | M8-04 | P |

A ordem da tabela é a de construção. A M8-10 só começa quando a Meta aprovar o app (M7-06). Se a aprovação não chegar
até o fim das outras tarefas, ela passa para o M9 e não segura o marco. A M8-09 começa com o número de teste da Meta,
que já funciona hoje para até 5 números cadastrados.

**O que não entra no M8:** CRM, funil, cadências do SDR, disparos em massa e fluxos multicanal (M9); chamados e
service desk (M11); memória de relacionamento e o agente respondendo em áudio (M12); Instagram, Messenger, TikTok, SMS
e e-mail na caixa única (M13, pelos agregadores); chat interno da equipe (decisão 10). Juntar contatos continua só à
mão, como no M7.

### M8-01 Base das conversas com contatos: canais, conversas, mensagens e a linha do tempo do contato

Precisa da aprovação do Sandro (estrutura do banco que mexe no isolamento entre empresas).

- [ ] Banco: **canais** da empresa (um número de WhatsApp, um balão de site), cada um com o provedor (Evolution,
  oficial da Meta ou chat do site), a situação (conectado, desconectado, pausado), a equipe que atende e o agente.
  **Conversas com contatos** separadas das conversas internas da equipe com os agentes (decisão 1), com o contato, o
  canal, o dono (pessoa da equipe ou o agente), a situação (aberta, esperando o cliente, esperando a equipe,
  resolvida) e quem respondeu por último. **Mensagens** com a direção (chegou ou saiu), quem escreveu (contato,
  agente ou pessoa da equipe), o tipo (texto, foto, documento, áudio, nota interna), o número da mensagem no provedor
  (para não gravar duas vezes) e a situação da entrega (enviada, entregue, lida, falhou). Tudo com `empresa_id`, RLS e
  as marcas (`[pessoal]` no texto, no nome do perfil e no telefone)
- [ ] **Achar o contato** pelo identificador do canal (telefone no formato internacional, como no M7). Sem
  correspondência, cria um contato "não identificado" com o nome do perfil do WhatsApp e o canal de origem. Telefone
  repetido em mais de um contato (recepção, família): liga ao principal e mostra na conversa "este número está em
  mais de um contato", com a troca à mão
- [ ] **Conversa nova ou a mesma:** a mensagem que chega continua a conversa aberta do contato naquele canal. Depois
  de resolvida, uma mensagem nova abre outra conversa (decisão 1)
- [ ] A ficha do contato ganha a **linha do tempo** das conversas, de todos os canais, com o link para abrir cada uma
- [ ] Permissões (módulo novo `conversas`: ver, responder, atribuir, configurar canais e apagar) e o alcance da
  decisão 2. Auditoria das ações importantes, sem o texto das mensagens
- [ ] Testes de banco (isolamento), de unidade e o teste de vazamento da M6-01 cobrindo as rotas novas

### M8-02 Evolution API no servidor e conectar um número pelo QR code

Precisa da aprovação do Sandro (servidor e segurança).

- [ ] Uma Evolution API por ambiente (teste e produção) na VPS02, em container próprio, com limite de memória, banco
  próprio dentro do PostgreSQL de cada ambiente (usuário separado, sem acesso às tabelas do Mago OS), e **sem porta
  aberta para a internet**: só o núcleo fala com ela, pela rede interna (decisão 4). A chave dela fica no Infisical.
  No começo da tarefa eu confiro a versão atual e a licença
- [ ] Os avisos da Evolution (mensagem chegou, entregue, lida, número desconectado) vêm pela rede interna para um
  endereço do núcleo com um segredo próprio, e passam pela fila para nunca se perderem
- [ ] Tela Configurações > Canais > "Conectar WhatsApp": nome do canal, equipe que atende, QR code para ler no
  celular (atualiza sozinho), situação da conexão e "desconectar". Cada número fica preso a uma empresa só
- [ ] Número desconectado (celular sem internet, sessão encerrada no aparelho): aviso ao administrador e à equipe do
  canal, e o canal aparece em vermelho na caixa
- [ ] Na tela, o aviso claro do risco: a Evolution não é oficial e o WhatsApp pode bloquear o número, principalmente
  com envio em volume ou para quem não autorizou
- [ ] Remontagem e backup: o ensaio de desastre (M6-03) passa a incluir a Evolution, e o manual de operação explica
  como reconectar os números depois de uma remontagem
- [ ] Testes com a Evolution falsa (QR, conexão, queda) e conferência de que uma empresa nunca vê o canal da outra

### M8-03 Receber e enviar mensagens pela Evolution (texto, foto, documento e áudio)

- [ ] Receber: texto, foto, documento, áudio, localização e contato compartilhado. Os arquivos passam pelo antivírus,
  como os anexos, e ficam no bucket de anexos, com o prazo da decisão 7. Figurinha, enquete e outros tipos aparecem
  como "tipo de mensagem ainda não mostrado aqui", sem perder o aviso
- [ ] Enviar pela caixa e pelo agente: texto, foto e documento, com a situação da entrega (enviada, entregue, lida,
  falhou) e uma nova tentativa à mão quando falhar
- [ ] Mensagens que o próprio celular manda (alguém respondeu direto no aparelho) também entram na conversa,
  marcadas "pelo celular"
- [ ] Ritmo de envio por número (limite por minuto e por hora) para diminuir o risco de bloqueio, com aviso ao
  administrador quando o limite segura mensagens
- [ ] Mensagem repetida do provedor não grava duas vezes; mensagem fora de ordem fica na ordem certa
- [ ] Grupos de WhatsApp ficam de fora por padrão (decisão 11)
- [ ] Testes com a Evolution falsa: chegou, saiu, repetida, falhou, arquivo com vírus, e o isolamento entre empresas

### M8-04 Caixa única: a tela das conversas, com dono, situação, nota interna e tempo real

- [ ] Tela **Conversas** (no menu, com o contador das que esperam a equipe): lista com os filtros "minhas", "sem
  dono", "esperando a equipe", "com o agente", "resolvidas", por canal e por pessoa, e busca pelo nome, telefone e
  texto. Visões salvas como nas tarefas e nos contatos
- [ ] A conversa aberta: histórico com o ícone do canal, quem escreveu (contato, agente ou pessoa, cada um bem
  diferente), situação da entrega, a ficha resumida do contato ao lado (no celular, num botão) e as tarefas ligadas
- [ ] Responder (texto, foto, documento e emojis), **nota interna** (só a equipe vê, com uma cor bem diferente para
  não haver engano, e com @pessoa para chamar um colega), assumir, passar para outra pessoa, devolver ao agente,
  resolver e reabrir
- [ ] Respostas prontas da empresa (atalho "/" na caixa), com nome e texto
- [ ] Criar uma tarefa a partir da conversa, já ligada ao contato e com o link da conversa
- [ ] Tempo real (como as tarefas): mensagem nova aparece na hora, e "fulano está respondendo" evita duas pessoas
  respondendo juntas
- [ ] Avisos: conversa nova sem dono vai para a equipe do canal; mensagem nova numa conversa minha vai para mim (tela,
  push e Telegram, com o silêncio de cada pessoa)
- [ ] Mobile-first: a caixa inteira funciona bem no celular
- [ ] Testes de tela, de permissão (o funcionário não vê conversa fora do seu alcance) e de isolamento

### M8-05 Agente na conversa: quem atende cada canal, modo de resposta e horário

Precisa da aprovação do Sandro (o que os agentes fazem com gente de fora).

- [ ] Em cada canal, o agente que atende (padrão: um agente interno novo, "Atendimento", criado a partir de um modelo
  pronto, que a empresa ajusta com as instruções e skills do M4) e o **modo** (decisão 3): "só pessoas", "o agente
  sugere e a pessoa envia" ou "o agente responde sozinho"
- [ ] O texto do contato é sempre "texto de outros" (M4-04): é dado, nunca ordem. O agente age com as permissões do
  canal (não com as de quem configurou) e, por padrão, só lê contatos, cria tarefa e responde. O resto (por exemplo
  mudar um cadastro ou mandar um arquivo da empresa) pede aprovação
- [ ] Contexto do agente: a conversa, a ficha do contato e as tarefas ligadas, as instruções do canal e o horário de
  atendimento. Conversas longas são resumidas, como no plano
- [ ] O agente tenta, de forma natural, saber o nome do contato "não identificado" e completa a ficha (o nome e o
  e-mail só entram com a regra de repetidos do M7: se já existe, sugere juntar, nunca junta sozinho)
- [ ] **Horário de atendimento** por canal (padrão: segunda a sexta, 9h às 18h, no fuso da empresa) e a mensagem de
  fora do horário, dizendo quando terá retorno
- [ ] Os tetos de custo, os limites e a parada dos agentes (M4) valem aqui; durante a parada, o canal cai para "só
  pessoas" e a equipe é avisada
- [ ] Autonomia gradual: no modo "sugere", o sistema conta as sugestões enviadas sem edição e avisa o administrador
  quando o agente chega ao número combinado (padrão 20, como no plano). Liberar é sempre uma pessoa
- [ ] Testes com o provedor de IA falso: responde no modo certo, não obedece ordem vinda do contato, respeita o
  horário e a parada

### M8-06 Passagem para humano: sinais, aviso com resumo, prazo, silêncio do agente e devolver

- [ ] Sinais que passam para uma pessoa: o contato pede uma pessoa, está irritado, repete a mesma pergunta duas
  vezes ou a conversa anda em círculos, o agente não sabe responder, e os **assuntos que sempre vão para uma pessoa**
  (configuráveis por canal: por exemplo desconto, reclamação grave, jurídico)
- [ ] Ao passar: a conversa vai para "esperando a equipe", com um resumo curto do agente (o que o contato quer, o que
  já foi dito e uma sugestão de resposta), e o pedido entra na central de prioridades para a equipe do canal (ou o
  responsável pelo contato, se houver)
- [ ] **Prazo e escalonamento:** se ninguém assumir no tempo do canal (padrão 10 minutos no horário de atendimento),
  o aviso sobe para o gestor e chega pelo Telegram e pelo WhatsApp da M8-09
- [ ] O contato é avisado de que agora fala com uma pessoa, no mesmo número ou no mesmo balão
- [ ] **Silêncio do agente:** com uma pessoa na conversa, o agente não responde mais; só mostra sugestões na caixa,
  que a pessoa usa, edita ou ignora
- [ ] **Devolver ao agente** com um botão; o agente continua sabendo o que foi combinado. Conversa resolvida e
  reaberta pelo contato volta ao modo do canal
- [ ] Testes: cada sinal, o prazo e o escalonamento, o silêncio e a devolução

### M8-07 Chat no site: o balão, o contexto da página e "continuar no WhatsApp"

Precisa da aprovação do Sandro (segurança: código do Mago OS rodando no site de fora).

- [ ] Tela Configurações > Canais > "Chat no site": nome, sites onde pode aparecer (lista de domínios), cor e posição
  do balão, mensagem de boas-vindas, agente e modo (como na M8-05), e se mostra "continuar no WhatsApp" (com qual
  número). Gera **uma linha de código** para colar no site
- [ ] O balão roda isolado do site (dentro de um quadro do Mago OS), só nos domínios da lista, leve e bom no
  celular, com as duas opções do plano: "conversar aqui" e "continuar no WhatsApp"
- [ ] **Contexto da página:** o agente sabe em que página o visitante está (endereço e título) e responde com isso
- [ ] **Visitante:** começa anônimo, lembrado pelo navegador por 30 dias (decisão 9). O agente tenta, de forma
  natural, pegar o e-mail ou o WhatsApp; com o dado, a conversa liga ao contato (ou cria um) e pode seguir no
  WhatsApp com o mesmo histórico na linha do tempo
- [ ] Proteções: limite de mensagens por visitante e por site, bloqueio de robôs sem atrapalhar pessoas, tamanho
  máximo das mensagens, e o aviso de privacidade com o link da política da empresa
- [ ] Na caixa, a conversa do site aparece com o ícone próprio, a página de onde veio e "visitante" até se
  identificar. A pessoa da equipe que assume responde pelo próprio balão
- [ ] Testes: domínio fora da lista não carrega, limite, passagem para o WhatsApp sem perder o histórico, e o
  isolamento entre empresas

### M8-08 Áudio: transcrição do que chega e gravar áudio pela caixa

- [ ] Áudio recebido é transcrito pela conta de IA da empresa que tiver transcrição (custo do cliente, decisão 8). A
  transcrição aparece junto do áudio e é o que o agente lê. Sem essa conta, o áudio fica sem transcrição e a conversa
  vai para uma pessoa
- [ ] Botão de microfone na caixa: a pessoa grava e o áudio vai como mensagem de voz do WhatsApp
- [ ] Testes com o transcritor falso

### M8-09 WhatsApp oficial da plataforma: vincular o número da pessoa, avisos e conversa com o coordenador

Precisa da aprovação do Sandro (o que os agentes fazem por um canal de fora).

- [ ] O número oficial do Mago OS (o app "Mago OS" da Nolask na Meta; no começo, o número de teste) faz pela equipe
  o mesmo que o bot do Telegram: vincular a conta por código, falar com o coordenador (o mesmo motor, a mesma conversa
  do app, conversa nova depois de 6 horas ou "nova"), aprovar com botões e o código do app autenticador, e receber os
  avisos urgentes e o resumo do dia
- [ ] Avisos fora da janela de 24 horas da Meta vão pelos modelos aprovados (`lembrete_de_tarefa` e
  `tarefa_atribuida`, mais os que forem precisando, sempre com o seu ok antes de mandar para a Meta). O custo da Meta
  por aviso é da plataforma (decisão 6)
- [ ] Nas preferências, cada pessoa escolhe por onde recebe: tela, Telegram, WhatsApp ou os dois
- [ ] O endereço que recebe os avisos da Meta confere a assinatura de cada aviso
- [ ] Testes com a Meta falsa, como os do Telegram

### M8-10 WhatsApp oficial para os números das empresas (conexão pela Meta, janela de 24 horas e modelos)

Só começa quando a Meta aprovar o app. Precisa da aprovação do Sandro (contas e segurança).

- [ ] "Conectar WhatsApp oficial" na tela de canais, pelo cadastro guiado da Meta, com a conta e o pagamento no nome
  do cliente (regra do plano: integração sempre no nome do cliente)
- [ ] A mesma caixa, o mesmo agente e a mesma passagem para humano da Evolution; o canal só muda o provedor
- [ ] **Janela de 24 horas:** fora dela, a caixa e o agente só mandam modelos aprovados pela Meta, e a tela avisa
  antes. Tela de modelos da empresa: criar, mandar para aprovação e ver a situação
- [ ] Testes com a Meta falsa: janela, modelo, entrega e isolamento

### M8-11 Conversas na API pública, no MCP e nos webhooks

- [ ] Endereços da API e ferramentas do MCP e dos agentes internos (regra 12): listar e ver conversas, mandar
  mensagem, nota interna, atribuir e resolver. **Mandar mensagem a um contato pede aprovação por padrão** para os
  agentes externos, porque sai da empresa
- [ ] Eventos novos nos webhooks: conversa aberta, mensagem recebida, conversa passada para pessoa e resolvida (só
  com ids, como no M7)
- [ ] Documentação da API em dia e o teste de vazamento cobrindo as rotas novas

## Decisões para o Sandro

1. **Conversas com contatos separadas.** Recomendado: as conversas com clientes ficam numa estrutura própria, porque
   pertencem à empresa (a equipe toda do canal vê), enquanto as conversas da pessoa com o coordenador são dela (o
   plano diz que o administrador não lê). Misturar as duas arrisca mostrar conversa privada para a equipe. Uma
   conversa resolvida não reabre: a mensagem nova abre outra, e todas ficam na linha do tempo do contato.
2. **Quem vê as conversas.** Recomendado: cada canal tem uma equipe. O funcionário vê as conversas dos canais da sua
   equipe e as que forem passadas para ele; o gestor e o administrador veem todas. Alternativa: todo mundo vê tudo
   (mais simples, mas um vendedor vê o cliente do outro).
3. **Modo do agente num canal novo.** Recomendado: "o agente sugere e a pessoa envia" no começo, até a 4xpert confiar
   nas respostas, e o administrador muda para "responde sozinho" quando quiser. Alternativa: já começar respondendo
   sozinho.
4. **Onde roda a Evolution.** Recomendado: na própria VPS02, uma por ambiente, com limite de 512 MB de memória cada,
   sem porta aberta para a internet. Antes de subir eu confiro a memória livre da VPS02 (o aviso de memória baixa da
   M6 já vigia). Alternativa: uma VPS pequena só para ela (custo novo).
5. **Número para os testes.** Preciso de um número de WhatsApp para conectar no teste.osmago.com. Recomendado: um chip
   novo ou um número que não seja o principal da 4xpert, porque a Evolution não é oficial e o número pode ser
   bloqueado. Qual número você prefere usar?
6. **WhatsApp oficial da plataforma.** Recomendado: o número oficial do Mago OS serve à equipe (avisos e coordenador,
   como o Telegram) e a Nolask paga os avisos por modelo (poucos centavos cada; eu confiro o preço atual da Meta antes),
   só para o urgente, como no Telegram. Para a produção é preciso um número próprio da Nolask registrado na Meta (o de
   teste só fala com 5 números). Qual número a Nolask vai usar?
7. **Fotos, documentos e áudios das conversas.** Recomendado: ficam 180 dias e depois são apagados sozinhos (o texto e
   a transcrição ficam), porque a conta grátis do Backblaze tem 10 GB para tudo. O administrador pode mudar o prazo, e
   o uso já aparece no admin. Alternativa: guardar sempre (o espaço acaba mais rápido).
8. **Transcrição de áudio.** Recomendado: pela conta de IA da própria empresa (custo do cliente, como no plano). Sem
   conta com transcrição, o áudio vai para uma pessoa. O agente respondendo em áudio fica para o M12.
9. **Visitante do chat no site.** Recomendado: lembrado pelo navegador por 30 dias; se não deixar contato, a conversa
   é apagada depois de 90 dias (LGPD: não guardar sem motivo).
10. **Chat interno da equipe.** Recomendado: fica fora do M8, para o M8 ficar só nas conversas com clientes; entra num
    marco seguinte (proponho no M14 Organização). Alternativa: entrar no M8 (mais uma tarefa G).
11. **Grupos de WhatsApp.** Recomendado: ficam de fora no começo (o número conectado ignora grupos), porque o agente
    respondendo em grupo é arriscado. O administrador pode ligar por canal depois, e aí só pessoas respondem neles.
