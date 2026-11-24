# 0041 Agenda simples

- **Data:** 24/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 24/11/2026)
- **Tarefa:** M5-07

## Contexto

A decisão 8 do M3 (19/11/2026) passou os eventos da agenda simples para o M5. As decisões 14 e 15 da spec do M5, aprovadas em 22/11/2026, deram o desenho: eventos com participantes da empresa, recorrência com "só este, este e os seguintes ou todos", convite com resposta, vários alertas (padrão 10 minutos antes) por tela, push e Telegram, o calendário juntando eventos e prazos, e a privacidade ("ocupado" para o funcionário). Esta nota acerta o que falta para construir, com dois pontos que pedem o olho do Sandro (marcados com **pede o seu olho**).

## Decisão

1. **O evento.** Título, descrição, começo e fim (com hora ou de dia inteiro, até 14 dias), fuso (o de quem cria, já preenchido), local ou link (https), participantes da empresa (pessoas, até 50) e, se quiser, uma tarefa ou projeto ligado. Quem cria já entra como participante, com a resposta "Vou". O começo e o fim ficam como dia e hora no fuso do evento, como o prazo das tarefas, e o banco calcula o momento com o horário de verão de cada lugar.
2. **Recorrência.** As mesmas regras das tarefas, contadas a partir do dia do começo, com fim numa data ou depois de N vezes. Editar ou cancelar:
   - **Só este:** vira um evento próprio, ligado à série e à ocorrência que substitui (cancelar "só este" marca aquela ocorrência como cancelada).
   - **Este e os seguintes:** a série original acaba no dia anterior, e nasce uma série nova a partir desta ocorrência, com a mudança.
   - **Todos:** muda a série inteira. As ocorrências que já tinham sido mudadas sozinhas continuam como estão.
3. **Convite.** Cada participante recebe o aviso "convite para um evento" no sino, no push e, por padrão, no Telegram, com os botões **Vou**, **Não vou** e **Talvez**. Responde também na tela do evento. Quem criou vê as respostas. Mudar o horário ou o local avisa os participantes (aviso "evento mudou") e volta as respostas para "sem resposta"; cancelar também avisa.
4. **Alertas.** Até 5 por evento, de 0 a 7 dias antes. O evento pode ter os próprios alertas, que valem para todos os participantes; sem eles, cada pessoa usa o padrão dela (10 minutos antes), que ela muda em Meu perfil › Notificações. O alerta chega no sino, no push e no Telegram (por padrão, como urgente), respeitando o horário de silêncio de cada pessoa. Não chega para quem respondeu "Não vou" nem para evento cancelado, e uma mudança de horário recalcula os alertas. Cada alerta vai uma vez só, pela verificação a cada minuto que já existe.
5. **Quem vê (decisão 15).** Quem criou, os participantes e o administrador veem o evento inteiro. **Pede o seu olho:** o gestor de área também vê os eventos inteiros das pessoas da equipe dele, como já acontece com as tarefas da equipe. O funcionário, na agenda de um colega, vê só "ocupado", sem título, local, link nem participantes.
6. **Quem mexe.** Criar: todos. Editar e cancelar: quem criou e o administrador. Os participantes só respondem ao convite. Módulo de permissão novo "agenda" (padrão: todos veem e criam; editar e cancelar todos, só o administrador).
7. **Calendário.** O calendário da M3-04 passa a mostrar os eventos ao lado dos prazos das tarefas, com dia, semana e mês. Dá para pôr a agenda de colegas lado a lado (até 10 pessoas), cada um com o que quem olha pode ver. Uma tela própria "Agenda" no menu abre direto no calendário com os eventos, e a página do evento mostra os detalhes, as respostas e os botões.
8. **Ferramentas dos agentes** (regra 12 do projeto). `ver_agenda` (executa): a agenda de quem pediu entre dois dias (até 62), com os eventos e os prazos, e a de colegas com o que quem pediu pode ver. `criar_evento` (pede aprovação por padrão, porque manda convite a outras pessoas). O evento criado por um agente é de quem pediu e fica marcado com o nome do agente. **Pede o seu olho:** na Fase 1, os agentes não editam nem cancelam eventos (fica no app); é a forma mais segura enquanto não há aprovação para mudanças de agenda.
9. **Auditoria.** `evento.criou`, `evento.editou`, `evento.cancelou` e, além da spec, `evento.respondeu`. Nos detalhes vão ids, o alcance e a resposta, nunca o título.
10. **Isolamento.** Tabelas `eventos`, `participantes_de_evento` e `alertas_de_evento` com `empresa_id`, RLS e marcas. Uma empresa não vê os eventos da outra.

## O que foi descartado

- **Clientes como participantes, Google Agenda, Outlook e link de agendamento:** Fase 2 (decisão 14).
- **Toda a equipe vê os títulos de todos:** alternativa da decisão 15, recusada.
- **Agentes como participantes:** um agente não vai a reunião; ele marca e consulta a agenda pelas ferramentas.

## Consequências

- Contratos: `contratos/src/agenda/eventos.ts` (evento, ocorrência no calendário, pedidos de criar, editar, cancelar e responder, o alcance da mudança e os limites); avisos novos `convite_de_evento`, `evento_mudou` e `alerta_de_evento` (os três vão ao Telegram por padrão); `alertasDaAgenda` nas preferências; o botão do convite no Telegram (`ev:vou|nao|talvez:<id>`); as ferramentas `ver_agenda` e `criar_evento`, com as regras no catálogo.
- Banco: `eventos`, `participantes_de_evento` e `alertas_de_evento`, com o momento calculado no fuso do evento.
- Pronto quando: o Sandro pede ao coordenador pelo Telegram "marca uma reunião com a Ana quinta às 15h", aprova, o evento aparece no calendário dos dois, e o alerta chega 10 minutos antes no app e no Telegram.
