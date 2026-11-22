# 0039 Rotinas por horário

- **Data:** 22/11/2026
- **Situação:** proposta (aguardando o "aprovado" do Sandro)
- **Tarefa:** M5-05

## Contexto

O plano pede rotinas: "quando chegar a hora, faça isto em meu nome", como o resumo das tarefas atrasadas toda segunda às 8h. As decisões 9, 10 e 11 da spec do M5, aprovadas em 22/11/2026, deram o desenho geral: as repetições da recorrência das tarefas com hora e fuso, três ações na Fase 1, a rotina nascendo desligada com "Rodar agora", e o módulo de permissão "rotinas". Esta nota acerta o que falta para construir, e três pontos que mudam um pouco a spec (marcados com **muda a spec**).

## Decisão

1. **O que é uma rotina.** Nome, gatilho, ação, dono e situação (ligada ou desligada). O dono é quem criou. A rotina age em nome dele, com a permissão que ele tem na hora em que ela roda: se ele perdeu uma permissão, a rotina falha com o motivo, em vez de fazer o que ele já não pode.
2. **Quando roda.** As mesmas repetições da recorrência das tarefas (todo dia, a cada N dias, dias da semana, todo mês num dia, todo ano), contadas a partir de um dia de início, com um ou mais horários no dia (até 24), num fuso escolhido (o da pessoa, já preenchido), com o horário de verão de cada lugar. Para numa data ou depois de tantas execuções, o que vier primeiro, e aí se desliga sozinha ("terminou").
3. **Criar tarefa.** Título, descrição, responsável (pessoa ou agente; sem ninguém, fica com o dono), projeto, prioridade e prazo relativo ("em 2 dias", com hora opcional, no fuso da rotina). É como se o dono criasse pela tela. Um agente interno como responsável começa a trabalhar em nome do dono, como já acontece (M4-04).
4. **Pedir a um agente interno.** O dono escolhe um agente com quem ele poderia conversar (o coordenador ou, para quem pode falar direto, um especialista), escreve o pedido e escolhe, se quiser, uma das skills do agente. O pedido conta como mensagem do próprio dono (são as palavras dele), e não como "texto de outros". O resultado vai de um destes dois jeitos:
   - **Mensagem:** uma conversa nova do dono com o agente, marcada como aberta pela rotina. A resposta aparece no app e vai também pelo Telegram, se ele tiver vinculado. É o jeito do "Pronto quando".
   - **Tarefa:** uma tarefa nova com o agente como responsável. Ele trabalha nela em nome do dono, e o resultado fica na tarefa.
5. **Mandar aviso.** O texto (até 300 caracteres) e, se quiser, a tela a abrir, para pessoas que o dono pode ver em Pessoas: o funcionário avisa só a si mesmo, o gestor a equipe, o administrador qualquer pessoa da empresa. O aviso diz de quem é a rotina. **Muda a spec:** o tipo novo "aviso de rotina" vai também pelo Telegram por padrão, como o urgente, porque é um lembrete que alguém marcou de propósito. Cada pessoa pode desligar em Notificações.
6. **Só o dono faz a rotina agir.** **Muda a spec**, que dizia que o administrador cria e edita todas. Editar, ligar e "Rodar agora" são só do dono. O administrador vê todas, desliga e apaga qualquer uma; o gestor vê as da equipe. Motivo: a rotina age em nome do dono e com as palavras dele; se outra pessoa mudasse o pedido, o dono passaria a agir com palavras que não escreveu. Padrão do módulo "rotinas": administrador vê, edita (desliga) e apaga todas; gestor vê as da equipe e cria, edita e apaga as próprias; funcionário cria, vê, edita e apaga as próprias.
7. **Nasce desligada, com "Rodar agora".** Roda uma vez de verdade e mostra o resultado, para testar antes de ligar. Conta no limite do dia.
8. **Limites.**
   - No máximo 24 execuções por dia em cada rotina (no fuso dela), contando o "Rodar agora". Passou, a execução fica "pulada", com o motivo.
   - Até 50 rotinas por pessoa em cada empresa.
   - Teto de gasto do mês opcional por rotina, além dos tetos da M4-06 (empresa, agente e conta de IA). No teto, a execução que chamaria o agente fica pulada e o dono é avisado uma vez no mês.
   - Uma execução por rotina de cada vez: se a anterior ainda está rodando, a nova fica pulada.
9. **Fila e servidor fora do ar.** A fila que já existe (pg-boss) confere as rotinas a cada minuto. Se o servidor ficou fora do ar, ao voltar roda uma vez só a última vez perdida, sem acumular, e marca a próxima.
10. **Falhas.** Tenta de novo depois de 5 e de 15 minutos.
    - Criar tarefa e mandar aviso são tudo ou nada, então tentar de novo é seguro.
    - Pedir ao agente só tenta de novo se o agente não mudou nada na tentativa que falhou. Se ele já tinha feito alguma coisa, vai direto para o dono, para não fazer duas vezes.
    - Falha que não melhora tentando de novo (sem permissão, agente pausado ou desligado, projeto que não existe mais) não tenta de novo.
    - Depois da última falha, o dono recebe o aviso "rotina falhou", que fica na central de prioridades, e a falha vai para a auditoria.
11. **Parada dos agentes (M4-09).** A rotina que chama agente fica "esperando" e roda uma vez quando os agentes voltarem (só a mais recente; as outras ficam puladas). A que só cria tarefa ou avisa continua.
12. **Dono que sai da empresa.** As rotinas dele naquela empresa se desligam ("dono desligado") e os administradores recebem o aviso. Como só o dono faz a rotina agir, ninguém religa: o administrador apaga ou cria uma parecida em nome próprio.
13. **Histórico.** Cada execução guarda quando foi, se foi pelo horário ou pelo "Rodar agora", o que fez (a tarefa, a conversa, o passo a passo do agente, quantos foram avisados), o custo e, se falhou ou foi pulada, o motivo. A tela mostra os últimos 90 dias.
14. **Ferramentas dos agentes** (regra 12 do projeto). Listar e ver rotinas executam. Criar e ligar uma rotina pedem aprovação por padrão, porque a rotina age sozinha depois. Desligar executa. Uma rotina criada por um agente é sempre de quem pediu, nasce desligada e fica marcada com o nome do agente. Apagar fica só no app. Os agentes externos (MCP) não ganham ferramentas de rotina na Fase 1.
15. **Auditoria.** `rotina.criou`, `rotina.editou`, `rotina.ligou`, `rotina.desligou`, `rotina.apagou`, `rotina.falhou` e, além da spec, `rotina.rodou_agora`. Nos detalhes vão ids, o tipo de ação e o motivo fixo, nunca o texto.
16. **Tela Rotinas, no menu.** A lista mostra o nome, o que a rotina faz, quando roda, a próxima vez e um botão de ligar e desligar. O formulário pergunta "quando" e "o que fazer". A página da rotina tem "Rodar agora" e o histórico. No celular, a tela fica no menu, não na barra de baixo.

## O que foi descartado

- **Modo de simulação completo:** o agente teria que fingir cada ferramenta (decisão 10 da spec). "Rodar agora" com a rotina desligada cumpre o papel.
- **"A cada X minutos" ou "a cada hora":** o mínimo é uma vez por horário marcado, até 24 por dia (decisão 9).
- **O administrador edita a rotina dos outros:** a rotina passaria a falar em nome do dono com palavras de outra pessoa.
- **Tentar de novo sempre:** um agente que já criou uma tarefa e falhou depois criaria a tarefa duas vezes.

## Consequências

- Contratos: `contratos/src/rotinas/rotinas.ts` (gatilho, as três ações, rotina, execução, limites e auditoria). Nos agentes, o canal de conversa "rotina" e as ferramentas `listar_rotinas`, `ver_rotina`, `criar_rotina`, `ligar_rotina` e `parar_rotina`, com as regras no catálogo. Avisos novos: `aviso_de_rotina` (urgente no Telegram), `rotina_falhou` e `rotina_desligada`.
- Banco: tabelas `rotinas` e `execucoes_de_rotina`, com `empresa_id`, RLS e marcas, e o desligamento das rotinas quando o dono é desligado.
- Pronto quando: o Sandro cria a rotina "toda segunda às 8h, o Gerente de projetos resume as tarefas atrasadas e me manda", aperta "Rodar agora", liga, e na segunda às 8h o resumo chega no Telegram.
