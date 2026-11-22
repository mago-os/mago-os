# Spec da Fase 1: M5 Telegram e rotinas

Parte da [spec da Fase 1](README.md). Estado em 22/11/2026: **aprovado** pelo Sandro, com todas as 16 recomendações.

**Pronto quando:** o Sandro vincula o Telegram dele por código e escreve ao bot "cria uma tarefa para revisar o contrato da DFO até sexta". O coordenador cria a tarefa, que aparece no app, e a conversa fica também no app. Ele manda uma foto pelo Telegram e ela vira anexo da tarefa, depois de passar pelo antivírus. O Gerente de projetos pede uma aprovação, o pedido chega no Telegram com botões, e o Sandro aprova com o código do app autenticador. Uma rotina "toda segunda às 8h, o Gerente de projetos resume as tarefas atrasadas" roda sozinha no horário e o resumo chega no Telegram. Uma rotina por evento ("quando uma tarefa do projeto Blog for concluída, criar a tarefa de revisão") dispara sozinha. Um evento da agenda avisa 10 minutos antes no app e no Telegram. Os testes provam que uma conta do Telegram só fala pela pessoa vinculada, que uma empresa não vê o Telegram nem as rotinas da outra, e que uma rotina não faz o que o dono dela não poderia fazer.

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M5-01 | Bot do Telegram e vincular a conta por código | M4 | M |
| M5-02 | Falar com o coordenador e criar tarefas pelo Telegram | M5-01 | M |
| M5-03 | Enviar arquivos pelo Telegram | M5-02 | P |
| M5-04 | Aprovar com botões e código do app autenticador | M5-01 | M |
| M5-08 | Avisos e resumo do dia pelo Telegram (proposta nova, decisão 8) | M5-01 | P |
| M5-05 | Rotinas por horário | M4 | M |
| M5-06 | Rotinas por eventos do próprio sistema | M5-05 | M |
| M5-07 | Agenda simples: eventos e alertas no app e no Telegram (entrou pela decisão 8 do M3) | M5-08 | M |

A ordem da tabela é a ordem de construção. A M5-07 cumpre o que foi aprovado em 19/11/2026 (decisão 8 do M3: os eventos da agenda simples vêm no M5). A M5-08 é proposta nova: hoje os avisos chegam só no sino e no push, e o plano pede que o urgente também chegue no Telegram, com o resto num resumo do dia. As rotinas (M5-05 e M5-06) não dependem do Telegram e podem ir antes, se for útil.

**O que não entra no M5** (como já está no plano): WhatsApp, e-mail, SMS e redes sociais como canais (Fase 2); um bot por empresa ou com a marca do revendedor (Fase 2); grupos do Telegram (só conversa individual com o bot); transcrição de áudio e leitura do conteúdo de arquivos pelos agentes (Fase 2, decisão 5); eventos externos nas rotinas (e-mail recebido, arquivo novo no Drive, aviso de outro sistema) e rotinas com indicadores (Fase 2, com as integrações e o painel); editor visual de automações com condições livres e modo de simulação completo (decisão 10); montar rotina por conversa com o coordenador (Fase 2); pular feriados nas recorrências (Fase 2, com a lista do Brasil); sincronização com Google Agenda e Outlook, convites a clientes, link de agendamento e alertas por WhatsApp, e-mail ou SMS (agenda completa da Fase 2); voz e ligação.

### M5-01 Bot do Telegram e vincular a conta por código

Precisa da aprovação do Sandro (contratos novos e segurança: identidade por um canal de fora).

- [ ] Um bot do Mago OS para a plataforma toda (decisão 1), com um bot separado para o ambiente de testes. O token do bot fica no Infisical, como os outros segredos, e nunca vai para o banco nem para a tela
- [ ] O Telegram entrega as mensagens por webhook (decisão 2) num endereço próprio do Mago OS, conferido pelo cabeçalho secreto que o Telegram manda em cada chamada. Mensagem sem o segredo é recusada sem resposta. Cada mensagem é tratada uma vez só (o número da atualização fica guardado)
- [ ] Vínculo (decisão 3): em Meu perfil › Telegram, a pessoa gera um código de uso único que vale 10 minutos e abre o bot por um link que já leva o código. O bot confere o código e responde com o nome da pessoa e da empresa. Uma conta do Telegram fica ligada a uma pessoa só, e uma pessoa tem uma conta do Telegram só (vincular outra troca a anterior)
- [ ] Empresa do Telegram: a conversa vale para a empresa em que o código foi gerado. Quem trabalha em mais de uma empresa troca pelo comando /empresa, que lista só as empresas dela
- [ ] Desvincular pelo app (Meu perfil) ou pelo comando /sair no bot. O desligamento da pessoa na empresa (M1-07) e a troca do Telegram cortam o vínculo na hora
- [ ] Só conversa individual com o bot. Mensagem de grupo, de canal ou de conta não vinculada recebe só "Para usar o Mago OS pelo Telegram, vincule a conta em Meu perfil" e nada mais, sem dizer se a conta existe
- [ ] Limite de mensagens por conta (30 por minuto) e trava de 5 códigos errados em 15 minutos, como no login
- [ ] Tabelas `vinculos_do_telegram` (pessoa, empresa, número da conta e do chat do Telegram, nome de usuário, marcadas `[pessoal]`) e `codigos_do_telegram` (só o resumo do código, nunca o código em si), com `empresa_id` e RLS
- [ ] Eventos de auditoria: `telegram.vinculou`, `telegram.desvinculou`, `telegram.trocou_empresa`, `telegram.codigo_errado`
- [ ] Testes: código vencido, usado ou de outra pessoa é recusado; mensagem sem o segredo do webhook é recusada; a conta desvinculada não fala mais; o funcionário desligado perde o vínculo

Pronto quando: o Sandro gera o código no app, abre o bot pelo link e o bot responde "Pronto, Sandro. Você está na 4xpert".

### M5-02 Falar com o coordenador e criar tarefas pelo Telegram

Precisa da aprovação do Sandro (o que os agentes fazem por um canal de fora).

- [ ] O texto que a pessoa manda ao bot entra na mesma conversa do app (decisão 4): o mesmo motor, as mesmas ferramentas, regras, aprovações, tetos e limites do M4, e a resposta do coordenador volta pelo Telegram. A conversa aparece também no app, marcada com o ícone do Telegram
- [ ] O Telegram é contínuo, então o núcleo divide em conversas: nova conversa depois de 6 horas sem mensagem ou pelo comando /nova
- [ ] A mensagem vinda do Telegram vinculado conta como da própria pessoa (não é "texto de outros" da M4-04). As ações de alto risco continuam só no app, e o coordenador responde com o link da tela certa
- [ ] Falar direto com um especialista pela menção (exemplo: "@gerente planeja o lançamento"), com a mesma permissão do app (padrão: administrador e gestor)
- [ ] Enquanto o agente trabalha, o bot mostra "digitando". Respostas longas são divididas no limite do Telegram; tarefas criadas ou citadas vão com o link para abrir no app
- [ ] O texto do agente vai como texto simples, sem formatação que o Telegram interprete (como o "só texto" do M2)
- [ ] Comandos: /nova, /tarefas (as prioridades de hoje, como a central), /empresa, /sair e /ajuda
- [ ] Durante a parada dos agentes (M4-09), o bot responde que os agentes estão parados, com o motivo
- [ ] Testes com o Telegram falso e o provedor de IA falso: pedido pelo Telegram cria a tarefa, a resposta volta ao chat certo, a conversa aparece no app, e a pessoa não alcança pelo Telegram nada que não alcança no app

Pronto quando: o Sandro escreve ao bot "cria uma tarefa para revisar o contrato da DFO até sexta", a tarefa aparece no app com o prazo, e a conversa está no app.

### M5-03 Enviar arquivos pelo Telegram

- [ ] Foto, documento, áudio e vídeo até 20 MB (o limite do Telegram para um bot baixar), com os mesmos tipos bloqueados dos anexos da M3-08
- [ ] O arquivo passa pelo antivírus e vira anexo (decisão 5): da tarefa que a pessoa disser na legenda ou na conversa ("anexa na tarefa do contrato"), ou da tarefa criada naquela conversa. Sem tarefa clara, o coordenador pergunta onde anexar e o arquivo espera até 24 horas
- [ ] Na Fase 1 o agente vê só o nome, o tipo e o tamanho do arquivo, não o conteúdo; a legenda conta como texto da pessoa
- [ ] Ferramenta nova do coordenador: `anexar_arquivo` (padrão "executa" nas tarefas que a pessoa pode editar)
- [ ] Arquivo bloqueado pelo antivírus: o bot avisa e o arquivo é apagado, como no app
- [ ] Testes: arquivo acima do limite é recusado com aviso, arquivo infectado não vira anexo, e o anexo só entra em tarefa que a pessoa pode editar

Pronto quando: o Sandro manda uma foto ao bot com a legenda "anexa na tarefa do contrato da DFO" e a foto aparece na tarefa.

### M5-04 Aprovar com botões e código do app autenticador

Precisa da aprovação do Sandro (segurança).

- [ ] A aprovação pedida por um agente (M4-03) chega no Telegram de quem pode aprovar, com o que o agente quer fazer, por quê, os parâmetros e os botões Aprovar, Recusar e Abrir no app
- [ ] Aprovar pede o código de 6 dígitos do app autenticador (decisão 6). A mensagem com o código é apagada do chat logo depois de conferida. Quem não tem app autenticador (só passkey) vê só Recusar e Abrir no app
- [ ] Recusar pede o motivo numa resposta curta (ou "sem motivo")
- [ ] Três códigos errados bloqueiam as aprovações pelo Telegram dessa pessoa por 15 minutos e avisam no app
- [ ] O bot só pede código dentro de uma aprovação que a pessoa abriu pelo botão. Ele nunca pede o código em outra hora, e a ajuda do bot diz isso
- [ ] Editar os parâmetros antes de aprovar fica só no app. A conferência dos parâmetros (o resumo da M4-03) vale igual: aprovar pelo Telegram aprova exatamente o que foi mostrado
- [ ] Toda aprovação ou recusa pelo Telegram avisa no app a própria pessoa e os outros administradores, e fica na auditoria com o canal (`aprovacao.aprovou` e `aprovacao.recusou` ganham "canal: telegram")
- [ ] As ações de segurança (Parar todos os agentes, retomar, mexer em pessoas e permissões) continuam fora do Telegram
- [ ] Testes: código errado não aprova, código de outra pessoa não aprova, código repetido no mesmo intervalo de 30 segundos é recusado, aprovação vencida não aprova, botão de uma aprovação já decidida só mostra a decisão

Pronto quando: o Gerente de projetos pede aprovação para atribuir uma subtarefa, o pedido chega no Telegram do Sandro, ele aperta Aprovar, manda o código do autenticador e a subtarefa é atribuída.

### M5-08 Avisos e resumo do dia pelo Telegram

- [ ] As preferências de notificação (M3-06) ganham o canal Telegram, ao lado da tela e do push
- [ ] Padrão (decisão 7): pelo Telegram chega na hora só o urgente (aprovação pedida, menção, precisa de ajuda, prazo vencido, agentes parados), e o resto entra no resumo do dia
- [ ] Resumo do dia às 8h no fuso da pessoa, com as prioridades de hoje (a mesma lista da central), ligado por padrão e com hora ajustável
- [ ] Respeita o horário de silêncio: o urgente espera o fim do silêncio, como o push
- [ ] O aviso pelo Telegram leva o link para abrir no app. Falha no envio tenta de novo e, se continuar, o sino continua valendo
- [ ] Testes: o aviso de outra empresa não chega, o silêncio segura o envio, e quem desvinculou não recebe mais

Pronto quando: uma menção ao Sandro chega no Telegram na hora, e às 8h chega o resumo do dia.

### M5-05 Rotinas por horário

Precisa da aprovação do Sandro (contratos novos e o que roda sozinho em nome de alguém).

- [ ] Uma rotina tem nome, gatilho, ação, dono e situação (ligada ou desligada). O dono é quem criou, e a rotina age com a permissão dele, como numa conversa (a menor das duas permissões, M4-04)
- [ ] Gatilho por horário: as mesmas repetições da recorrência das tarefas (todo dia, a cada N dias, dias da semana escolhidos, todo mês num dia, todo ano), com hora e fuso, e fim numa data ou depois de N vezes (decisão 9)
- [ ] Ações da Fase 1 (decisão 10): criar uma tarefa (título, descrição, responsável pessoa ou agente, projeto, prioridade e prazo relativo, como "em 2 dias"); pedir a um agente interno (o pedido em texto e uma skill opcional), com o resultado numa tarefa nova ou numa mensagem ao dono (app e Telegram); mandar um aviso a pessoas da empresa
- [ ] A rotina nasce desligada. O botão "Rodar agora" roda uma vez de verdade e mostra o resultado, para testar antes de ligar
- [ ] Limites: no máximo 24 execuções por dia por rotina e teto de gasto mensal opcional por rotina, somado aos tetos da M4-06
- [ ] Cada execução fica registrada (quando, o que fez, o custo, o link do passo a passo do agente). Falha tenta de novo duas vezes (depois de 5 e de 15 minutos) e, se continuar, vai para a central de prioridades do dono
- [ ] A rotina roda pela fila que já existe (pg-boss), conferida a cada minuto. Se o servidor ficou fora do ar, ao voltar roda uma vez só a última que perdeu, sem acumular
- [ ] Durante a parada dos agentes, a rotina que chama agente espera; a que só cria tarefa ou avisa continua
- [ ] Dono desligado: as rotinas dele ficam desligadas e o administrador recebe o aviso
- [ ] Quem cria (decisão 11): módulo de permissão novo "rotinas". O administrador cria e edita todas; o gestor e o funcionário criam as próprias, e o gestor vê as da equipe
- [ ] Tabelas `rotinas` e `execucoes_de_rotina` (com `empresa_id`, RLS e marcas). Eventos de auditoria: `rotina.criou`, `rotina.editou`, `rotina.ligou`, `rotina.desligou`, `rotina.apagou`, `rotina.falhou`
- [ ] Tela em Rotinas (no menu): lista, criar e editar, ligar e desligar, Rodar agora e o histórico de execuções
- [ ] Testes com o relógio falso e o provedor de IA falso: roda no horário certo no fuso certo (inclusive em mudança de horário de verão de outro país), não roda desligada, não passa do limite por dia, não acumula depois de ficar fora, e não faz o que o dono não poderia fazer

Pronto quando: o Sandro cria a rotina "toda segunda às 8h, o Gerente de projetos resume as tarefas atrasadas e me manda", aperta Rodar agora, liga, e na segunda às 8h o resumo chega no Telegram.

### M5-06 Rotinas por eventos do próprio sistema

Precisa da aprovação do Sandro (o que roda sozinho em nome de alguém).

- [ ] Gatilhos de eventos do sistema (decisão 12): tarefa criada, tarefa concluída, tarefa mudou de status, tarefa atrasada (o prazo passou), tarefa precisa de ajuda, comentário numa tarefa e aprovação pedida
- [ ] Filtros opcionais em cada gatilho: projeto, lista, etiqueta, prioridade, responsável e status. Sem condições livres na Fase 1
- [ ] As mesmas ações e os mesmos limites da M5-05. A ação recebe a tarefa que disparou (exemplo: "criar uma tarefa de revisão ligada à tarefa concluída" ou "pedir ao Gerente de projetos que replaneje a tarefa atrasada")
- [ ] A rotina só vê o evento de uma tarefa que o dono dela pode ver. Comentário de outra pessoa que chega a um agente pela rotina conta como "texto de outros" (M4-04)
- [ ] Sem rotina em círculo (decisão 13): um evento causado por uma rotina não dispara outra rotina. Além disso valem o limite de 24 execuções por dia e um limite de 3 disparos por minuto por rotina
- [ ] Os eventos entram pela mesma fila, gravados na mesma transação da mudança, para nenhum se perder nem rodar duas vezes
- [ ] Testes: o evento de uma empresa não dispara rotina da outra, o filtro de projeto funciona, uma rotina que cria tarefa não dispara a rotina de "tarefa criada", e o evento de tarefa que o dono não vê não dispara nada

Pronto quando: a rotina "quando uma tarefa do projeto Blog for concluída, criar a tarefa de revisão para a Ana" dispara sozinha quando o Sandro conclui uma tarefa do Blog.

### M5-07 Agenda simples: eventos e alertas no app e no Telegram

Precisa da aprovação do Sandro (contratos novos).

- [ ] Eventos com título, descrição, início e fim (ou dia inteiro), fuso, local ou link, participantes da empresa (pessoas) e, se quiser, uma tarefa ou projeto ligado
- [ ] Recorrência com as mesmas regras das tarefas, e editar ou cancelar "só este", "este e os seguintes" ou "todos", com o evento alterado ligado à série (decisão 14)
- [ ] Convite aos participantes: aparece no sino, e cada um responde Vou, Não vou ou Talvez, no app ou pelos botões do Telegram
- [ ] Alertas: vários por evento (padrão: 10 minutos antes), por tela, push e Telegram, com padrão por pessoa e ajuste no evento. Respeita o horário de silêncio e não avisa evento cancelado ou mudado
- [ ] O calendário da M3-04 passa a mostrar os eventos ao lado dos prazos das tarefas, com dia, semana e mês, e as agendas da equipe lado a lado (quem pode ver)
- [ ] Quem vê: o evento é visível para quem criou, os participantes e os administradores; o funcionário vê só "ocupado" na agenda de um colega, sem o título (decisão 15)
- [ ] Ferramentas novas dos agentes internos: `ver_agenda` (executa) e `criar_evento` (pede aprovação por padrão). O coordenador marca "reunião com a Ana quinta às 15h" pelo app ou pelo Telegram
- [ ] Tabelas `eventos`, `participantes_de_evento` e `alertas_de_evento` (com `empresa_id`, RLS e marcas). Eventos de auditoria: `evento.criou`, `evento.editou`, `evento.cancelou`
- [ ] Testes: o alerta chega no horário no fuso certo, não chega para evento cancelado, o funcionário não vê o título de evento alheio, e uma empresa não vê os eventos da outra

Pronto quando: o Sandro pede ao coordenador pelo Telegram "marca uma reunião com a Ana quinta às 15h", aprova, o evento aparece no calendário dos dois, e o alerta chega 10 minutos antes no app e no Telegram.

## Decisões para o Sandro

1. **Um bot ou um por empresa.** Recomendado: um bot do Mago OS para a plataforma toda (cada pessoa vincula a própria conta e fala com a empresa dela), e um bot separado só para o ambiente de testes. Você cria os dois no BotFather do Telegram (é uma conta sua) e cola o token de cada um no Infisical, como fez com o Google. O bot de produção é criado no M6, junto com o app.osmago.com. Alternativa: um bot por empresa, que é o caminho da marca própria do revendedor, e fica para a Fase 2.
2. **Como as mensagens chegam.** Recomendado: webhook, ou seja, o Telegram chama o Mago OS a cada mensagem, num endereço novo em teste.osmago.com, conferido por um segredo que só o Telegram e o Mago OS sabem. É instantâneo e não precisa de DNS novo, só de uma rota no Caddy da VPS02. Alternativa: o Mago OS perguntar ao Telegram a cada poucos segundos (mais simples, mas fica um processo sempre ligado e responde mais devagar).
3. **Vínculo e várias empresas.** Recomendado: código de uso único que vale 10 minutos, gerado em Meu perfil e levado ao bot por um link; uma conta do Telegram por pessoa; a conversa vale para a empresa em que o código foi gerado, e quem está em mais de uma troca com /empresa. Alternativa: um vínculo por empresa, com a pessoa escolhendo a empresa a cada conversa (mais perguntas no dia a dia).
4. **A conversa do Telegram.** Recomendado: a mesma conversa do app, com o mesmo coordenador, as mesmas regras e o mesmo histórico, dividida em conversas novas depois de 6 horas sem mensagem ou por /nova. A mensagem do Telegram vinculado conta como da própria pessoa; por isso as ações de alto risco continuam só no app e as aprovações pedem o código do autenticador, para o caso de alguém pegar o celular.
5. **Arquivos pelo Telegram.** Recomendado: o arquivo vira anexo com antivírus, até 20 MB (limite do Telegram), e na Fase 1 o agente não lê o conteúdo (só o nome, o tipo e o tamanho). Ler PDFs e fotos e transcrever áudio pedem um leitor isolado e custo de IA, e ficam para a Fase 2 junto com a nota por áudio do plano. Alternativa: transcrever áudio já no M5 (precisa de um provedor de transcrição e entra no teto de gasto).
6. **Aprovar pelo Telegram.** Recomendado: botão Aprovar mais o código do app autenticador, sem PIN fixo na Fase 1 (o plano já prefere o autenticador, porque o PIN fica escrito no chat). Três erros bloqueiam por 15 minutos. Quem só tem passkey aprova no app. Toda aprovação pelo Telegram avisa no app você e os outros administradores. Sem "desfazer" na Fase 1: a ação aprovada já aconteceu, e o aviso deixa claro o que foi feito. Alternativa: aceitar o PIN fixo para quem não usa autenticador.
7. **O que chega pelo Telegram.** Recomendado: na hora, só o urgente (aprovações, menções, precisa de ajuda, prazo vencido e agentes parados), e o resto no resumo do dia às 8h, para não virar ruído, como o plano pede. Cada pessoa ajusta nas preferências. Alternativa: tudo o que vai para o push vai também para o Telegram.
8. **Duas tarefas a mais no M5.** Recomendado: a M5-07 (agenda simples, que já foi aprovada para o M5 em 19/11/2026) e a M5-08 (avisos e resumo do dia pelo Telegram, que não estava na tabela, mas o plano pede para a Fase 1). Alternativa: deixar a M5-08 dentro da M5-04 (as aprovações) e o resto dos avisos para a Fase 2.
9. **Horários das rotinas.** Recomendado: as mesmas repetições da recorrência das tarefas, com hora e fuso, sem "a cada X minutos" (o mínimo é uma vez por dia em cada horário marcado; dá para escolher mais de um horário no dia, até 24). Pular feriados vem na Fase 2, com a lista do Brasil. Alternativa: aceitar "a cada hora" já no M5.
10. **O que uma rotina faz na Fase 1.** Recomendado: três ações (criar tarefa, pedir a um agente interno e mandar aviso), sem e-mail nem mensagem para fora, que dependem dos canais da Fase 2. No lugar do modo de simulação completo, a rotina nasce desligada e tem o botão "Rodar agora", que roda uma vez de verdade para você ver o resultado antes de ligar. Alternativa: fazer o modo de simulação já no M5 (bem mais trabalho, porque o agente teria que fingir cada ferramenta).
11. **Quem cria rotinas.** Recomendado: módulo de permissão novo "rotinas": o administrador cria e edita todas; gestor e funcionário criam as próprias (que rodam com a permissão deles), e o gestor vê as da equipe. Alternativa: só o administrador cria rotinas na Fase 1.
12. **Eventos que disparam rotinas.** Recomendado: os de tarefas (criada, concluída, mudou de status, atrasada, precisa de ajuda, comentário) e "aprovação pedida", com filtros simples (projeto, lista, etiqueta, prioridade, responsável, status). Eventos de outros módulos entram com eles na Fase 2.
13. **Rotina em círculo.** Recomendado: um evento causado por uma rotina não dispara outra rotina, além do limite de 24 execuções por dia e de 3 por minuto. É a regra mais simples que impede uma rotina de chamar a outra sem fim. Alternativa: permitir uma corrente de até 3 rotinas.
14. **Agenda simples.** Recomendado: eventos com participantes da empresa, recorrência com "só este, este e os seguintes ou todos", convite com resposta, vários alertas (padrão 10 minutos antes) por tela, push e Telegram, e o calendário juntando eventos e prazos. Ficam para a Fase 2: clientes como participantes, Google Agenda e Outlook, link de agendamento, a linha do tempo dos fusos dos participantes e as sugestões de horário.
15. **Privacidade da agenda.** Recomendado: o evento é visto por quem criou, pelos participantes e pelos administradores; o funcionário vê só "ocupado" na agenda de um colega. Alternativa: toda a equipe vê os títulos de todos.
16. **Teste com o Telegram de verdade.** Os testes automáticos usam um Telegram falso, sem rede. Para o "pronto" de cada tarefa, você cria o bot de teste no BotFather e cola o token no Infisical (o token não passa pelo chat); eu configuro o webhook e a rota no Caddy da VPS02, sem tocar em nada da Ratoeira.
