# Spec da Fase 1: M3 Projetos e tarefas completos

Parte da [spec da Fase 1](README.md). Estado em 19/11/2026: **aprovado** pelo Sandro, com todas as recomendações (inclusive a M3-11 e os eventos da agenda simples no M5). Em construção: M3-01 a M3-07 prontas em 19/11/2026.

**Pronto quando:** a Nolask organiza um projeto real no Mago OS (sugestão: a própria construção do Mago OS, com as tarefas do M4), com espaço, projeto, diretor e gerente, listas, subtarefas, prazos e etiquetas, e acompanha pelo Kanban, pela lista e pelo calendário. Uma menção a uma pessoa chega no sino e no celular, um anexo passa pelo antivírus antes de abrir, a central de prioridades mostra o que vence hoje e o Ctrl+K acha a tarefa pelo nome. Os testes provam que uma empresa não vê projetos, anexos, notificações nem resultados de busca da outra.

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M3-01 | Espaços e projetos, com diretor e gerente | M2 | M |
| M3-02 | Listas, status por projeto, subtarefas e checklist | M3-01 | M |
| M3-03 | Prioridade, prazo, etiquetas e recorrência | M3-02 | M |
| M3-04 | Visões em lista, Kanban e calendário, com filtros salvos | M3-03 | M |
| M3-05 | Linha do tempo: comentários, notas internas e menções | M3-01 | M |
| M3-06 | Notificações: sino, push e e-mail de aparelho novo | M3-05 | M |
| M3-07 | Central de prioridades básica | M3-03, M3-06 | M |
| M3-08 | Anexos no Backblaze B2, com antivírus ClamAV | M3-05 | M |
| M3-09 | Busca Ctrl+K | M3-02 | M |
| M3-10 | Painéis encaixáveis com layout salvo por usuário | M3-04, M3-07 | M |
| M3-11 | Tela "Dados da empresa" (entrou no M3, decisão 11) | M1 | P |

A ordem da tabela é a ordem de construção. A M3-02 da tabela original ("Listas, subtarefas, checklist, prioridade, prazo, etiquetas e recorrência") era grande demais e virou duas (M3-02 e M3-03), e por isso os números seguintes andaram uma casa em relação a [M2-a-M6.md](M2-a-M6.md). A M3-08 (anexos) não depende das visões e pode ser feita em paralelo depois da M3-05, assim que o bucket estiver criado com o Sandro (no B2, decisão de 19/11/2026). A M3-11 pode entrar a qualquer momento.

**O que não entra no M3** (como já está no plano): Gantt, carga de trabalho, horas, dependências entre tarefas, campos personalizados, modelos de projeto, portal do cliente e tarefa por e-mail (Fase 2); o gerente agente que planeja e acompanha sozinho (precisa dos agentes internos do M4); aprovações pedidas por agentes (a central já nasce com o lugar delas, mas elas vêm na M4-03); prioridades por WhatsApp e Telegram (M5 e Fase 2); compartilhar visões e layouts com a equipe e layouts por perfil (Fase 2).

**Pendências do M2 que continuam pendentes:** os três passos do Hermes "quando estiver em produção" (cadastrar, guardar a chave e configurar o MCP) seguem fora dos critérios do M3 e entram no dia em que o Hermes estiver pronto, sem esperar marco.

### M3-01 Espaços e projetos, com diretor e gerente

Precisa da aprovação do Sandro (contratos novos e quem vê o quê).

- [x] Contratos de espaço e de projeto (nome, descrição, cor, situação ativo ou arquivado; no projeto, diretor, gerente, membros e datas opcionais de início e fim)
- [x] Tabelas `espacos`, `projetos` e `membros_de_projeto`, com `empresa_id`, RLS e marcas de coluna
- [x] Diretor do projeto: sempre uma pessoa da empresa, obrigatório. Gerente: uma pessoa ou um agente, opcional. Os dois entram como membros automaticamente
- [x] Quem vê o quê (decisão 1): administrador e gestor veem todos os projetos e as tarefas deles; o funcionário vê os projetos em que é membro e as tarefas deles, além das próprias tarefas como hoje. Ser membro também deixa mexer nas tarefas do projeto (não excluir nem destravar)
- [x] Espaço e projeto entram no catálogo de permissões (ajuste na codificação: dois módulos, "espacos" com ver, criar e editar, e "projetos" com ver, criar, editar e excluir; arquivar fica dentro de editar). Criar espaço é do administrador; criar e editar projeto, do administrador e do gestor; o diretor edita o próprio projeto e os membros dele; trocar o diretor, só quem edita todos os projetos
- [x] A tarefa ganha o projeto, que é opcional (decisão 2): as tarefas do M2 continuam valendo como "Sem projeto", e mudar a tarefa de projeto vai para a auditoria
- [x] O gerente agente, no M3, é só o papel: recebe as tarefas do projeto que ninguém pegou, se o diretor quiser (opção no projeto), e vê todas as tarefas do projeto pelo MCP (em `ver_tarefa`; a lista `minhas_tarefas` continua só com as dele, e ele não mexe nas tarefas dos outros). Planejar e acompanhar sozinho vem com os agentes internos (M4)
- [x] Arquivar espaço ou projeto esconde das listas sem apagar nada; excluir de vez só o administrador, e só projeto sem tarefas
- [x] Eventos de auditoria: `espaco.criou`, `espaco.editou`, `espaco.arquivou`, `projeto.criou`, `projeto.editou`, `projeto.arquivou`, `projeto.trocou_diretor`, `projeto.trocou_gerente`, `projeto.mudou_membros`, `tarefa.mudou_projeto`
- [x] Tela Projetos: espaços com os projetos dentro, página do projeto com diretor, gerente, membros e tarefas, pensada primeiro para o celular
- [x] Testes de vazamento: uma empresa não vê espaços, projetos nem membros da outra, e o funcionário não vê projeto em que não é membro

Pronto quando: o Sandro cria o espaço "Operações" e o projeto "Construção do Mago OS", com ele de diretor e o Claude no Mac de gerente, põe uma pessoa de teste como membro, e o funcionário de teste fora do projeto não vê as tarefas dele.

### M3-02 Listas, status por projeto, subtarefas e checklist

Precisa da aprovação do Sandro (contrato da tarefa e ferramentas novas do MCP).

- [x] Listas dentro do projeto (Planejamento, Execução, Entrega...), com ordem; todo projeto nasce com uma lista "Geral", e a tarefa de projeto fica sempre numa lista. Excluir uma lista passa as tarefas dela para a primeira outra; a última não se exclui
- [x] Status por projeto (decisão 3): cada projeto define os próprios status, com nome, cor e ordem, e cada um pertence a um dos cinco tipos fixos do M2 (A fazer, Em andamento, Precisa de ajuda, Concluída, Cancelada). A trava, o agente vivo e o MCP continuam olhando o tipo, então nada do M2 muda. Projeto novo nasce com os cinco status padrão. O tipo de um status não muda depois de criado; apagar um status passa as tarefas para o primeiro do mesmo tipo
- [x] Subtarefas com um nível só (decisão 4): a subtarefa é uma tarefa completa (responsável pessoa ou agente, status, prazo, trava), ligada à tarefa-mãe, e a mãe mostra quantas estão prontas
- [x] Concluir a tarefa-mãe com subtarefas abertas pede confirmação na tela (não é proibido)
- [x] Checklist dentro da tarefa: itens de texto com marcar e desmarcar, ordem e quem marcou. Como o status, com a tarefa travada só quem pegou mexe no checklist (decidido na codificação)
- [x] MCP (decisão 5): ferramentas novas `criar_subtarefa` e `marcar_checklist`, para o agente transformar o plano dele em passos e marcar cada um, e `minhas_tarefas` e `ver_tarefa` passam a trazer projeto, lista, subtarefas e checklist. Descrições congeladas pelo teste, como as oito do M2
- [x] Eventos de auditoria: `lista.criou`, `lista.editou`, `lista.excluiu`, `status.editou`, `tarefa.criou_subtarefa`, `tarefa.mudou_lista`, `checklist.marcou`
- [x] Na tela da tarefa: lista, status do projeto, subtarefas e checklist, com tudo atualizando em tempo real (M2-06)
- [x] Testes de vazamento: subtarefa e checklist seguem a empresa e a permissão da tarefa-mãe

Pronto quando: o Claude no Mac recebe uma tarefa, cria três subtarefas pelo MCP e marca o checklist de uma delas, e o Sandro vê os passos aparecerem na tela sem recarregar.

### M3-03 Prioridade, prazo, etiquetas e recorrência

- [x] Prioridade (decisão 6): Urgente, Alta, Normal, Baixa ou sem prioridade
- [x] Prazo com data e, se quiser, hora, sempre guardado com fuso; a tela mostra no fuso de quem vê. Data de início opcional, para o calendário
- [x] Etiquetas da empresa (nome e cor), várias por tarefa; quem pode criar etiqueta é quem pode editar tarefas, e só o administrador apaga
- [x] Recorrência (decisão 7): ao concluir uma tarefa recorrente, o sistema cria a próxima com o próximo prazo, copiando título, descrição, responsável, lista, etiquetas e checklist (desmarcado). Regras: todo dia, dias da semana escolhidos, todo mês num dia, todo ano, a cada N dias; parar numa data ou depois de N vezes. Fuso do prazo (o da empresa, se ninguém escolher). Na mensal sem dia do mês, fica guardado o dia do prazo, para o 31 voltar ao 31 depois de um mês curto; o responsável que não está mais ativo não recebe a próxima (fica sem responsável). Concluída com atraso, a próxima vai para a primeira data da série a partir de hoje (não nasce atrasada); subtarefa não se repete (decidido na codificação)
- [x] Prazo vencido não muda o status: a tarefa só aparece como atrasada (cor e filtro), e o aviso fica para a M3-06
- [x] MCP: `minhas_tarefas` e `ver_tarefa` trazem prioridade, prazo e etiquetas; `minhas_tarefas` vem ordenada por prioridade e prazo
- [x] Eventos de auditoria: `tarefa.mudou_prioridade`, `tarefa.mudou_prazo`, `tarefa.mudou_etiquetas`, `tarefa.mudou_recorrencia` (acrescentado na codificação), `tarefa.recorreu`, `etiqueta.criou`, `etiqueta.excluiu`
- [x] Testes: recorrência na virada do mês, no dia 31, no horário de verão de Lisboa e de São Paulo, e uma recorrência criada duas vezes por engano (só uma tarefa nasce, garantido no banco)

Pronto quando: o Sandro cria a tarefa "Conferir o backup" toda segunda às 9h, conclui, e a da semana seguinte aparece sozinha com o prazo certo.

### M3-04 Visões em lista, Kanban e calendário, com filtros salvos

- [x] Lista: agrupar por status, lista, responsável, prioridade ou prazo; ordenar; marcar várias e mudar de uma vez (status, responsável e prazo; a tela chama as rotas de sempre, uma por tarefa, e mostra quantas foram recusadas). Etiqueta em massa ficou de fora (decidido na codificação: as etiquetas se marcam na tarefa)
- [x] Kanban: uma coluna por status do projeto, arrastar muda o status (passando pela trava do M2: pôr em andamento é pegar a tarefa); no celular, colunas lado a lado com rolagem e um toque para mudar
- [x] Calendário: mês e semana, com as tarefas no dia do prazo; arrastar muda o prazo; tarefas sem prazo numa faixa ao lado. Mostra só prazos de tarefas (decisão 8)
- [x] As três visões valem para um projeto, um espaço ou "todas as minhas tarefas", sempre com a mesma consulta e a mesma permissão por trás
- [x] Filtros: responsável (pessoa ou agente), status, prioridade, etiqueta, prazo (atrasadas, hoje, esta semana, sem prazo), projeto e "o que roda num agente"
- [x] Filtros salvos (decisão 9): cada pessoa salva a visão com os filtros e dá nome ("Minhas tarefas desta semana"), aparecem no menu e só ela vê
- [x] Tabela `visoes_salvas` (pessoal), com `empresa_id`, RLS e marcas de coluna
- [x] Tudo atualiza em tempo real, com o mesmo destaque curto do M2-06
- [x] Teste de tela (Playwright) do arrastar no Kanban e no calendário, no computador e no celular

Pronto quando: o Sandro abre o projeto "Construção do Mago OS" no Kanban, arrasta uma tarefa para Em andamento, troca para o calendário, muda um prazo arrastando e salva a visão "Atrasadas do Mago OS".

### M3-05 Linha do tempo: comentários, notas internas e menções

Precisa da aprovação do Sandro (o que os agentes recebem pelo MCP).

- [x] Linha do tempo única na tarefa: comentários, notas internas e os acontecimentos (mudou status, responsável, prazo, projeto, entregou resultado), em ordem, com quem fez. Os acontecimentos vêm de uma tabela própria da tarefa, não da auditoria (que continua só para o administrador)
- [x] Nota interna (decisão 10): visível só para as pessoas da empresa; não vai para os agentes pelo MCP nem, no futuro, para o cliente no portal. Na tela, com fundo próprio e o aviso "nota interna"
- [x] Comentário pode ser editado por quem escreveu em até 15 minutos, mostrando "editado"; apagar deixa "comentário apagado" no lugar (quem escreveu, ou quem exclui qualquer tarefa, decidido na codificação). As duas coisas vão para a auditoria (no M2 comentário só se acrescentava)
- [x] Menções com @ a pessoas e agentes da empresa, com a lista sugerida ao digitar. Ajuste na codificação: a lista sugere as pessoas e agentes ativos da empresa; a menção não abre a tarefa para uma pessoa que não a vê (o aviso da menção, na M3-06, só vai para quem vê)
- [x] Menção a um agente: a tarefa aparece para ele em `minhas_tarefas` marcada como "mencionado", até ele comentar; a menção não passa a tarefa para ele
- [x] Texto com formatação simples (negrito, lista, link, código) guardado como Markdown e mostrado com limpeza, nunca como HTML cru; o que vem de agente continua marcado e mostrado só como texto (regra do M2-05)
- [x] Eventos de auditoria: `tarefa.editou_comentario`, `tarefa.apagou_comentario`, `tarefa.mencionou`
- [x] Testes de vazamento: menção não chega para quem não vê a tarefa, e nota interna não sai pelo MCP

Pronto quando: o Sandro escreve "@Claude no Mac olha isso" num comentário e uma nota interna na mesma tarefa, o Claude vê a menção pelo MCP e responde, e a nota interna não aparece para ele.

### M3-06 Notificações: sino, push e e-mail de aparelho novo

Precisa da aprovação do Sandro (o e-mail de aparelho novo é segurança).

- [x] Os avisos do M2-04 viram as notificações do sistema: uma tabela só, com tipo, texto, link, lida ou não, para uma pessoa da empresa
- [x] O que gera notificação: tarefa atribuída a mim, menção, comentário em tarefa que eu sigo, resultado entregue numa tarefa que eu criei, tarefa que entrou em "Precisa de ajuda", prazo vencendo hoje e prazo vencido (verificação pela fila pg-boss a cada minuto, no fuso de quem recebe; com um agente responsável, recebe a pessoa responsável por ele), e os avisos de agentes do M2-04
- [x] Seguidores: quem cria, o responsável e quem é mencionado passam a seguir a tarefa (só quem vê a tarefa; seguir não dá acesso); botão Seguir e Deixar de seguir
- [x] Sino no topo com contador e lista, marcar como lida e marcar todas; aviso rápido no canto quando chega algo com o sistema aberto (pelo tempo real do M2-06)
- [x] Push (decisão 12): Web Push pelo service worker que o app instalável já tem, com as chaves VAPID no Infisical; a pessoa liga por aparelho, e o aparelho desconectado deixa de receber. No iPhone, só com o app instalado na tela de início (limite da Apple), e a tela explica isso
- [x] Preferências em "Meu perfil": o que chega no sino e o que chega no celular, por tipo, e horário de silêncio (o push espera, o sino recebe na hora)
- [x] E-mail de aparelho novo (pendência do M1): quando alguém entra num aparelho novo, além do aviso "Foi você?" nos outros aparelhos, vai um e-mail com aparelho, IP e horário (a cidade aproximada ficou de fora: não há serviço de localização por IP no Mago OS), e um link "Não fui eu" que leva à tela Aparelhos. Sem link que faça login
- [x] Notificação nunca leva dado sensível no texto do push (só "Nova menção em uma tarefa"); o detalhe aparece ao abrir, depois da checagem de permissão
- [x] Testes de vazamento: uma pessoa só recebe notificações da empresa ativa, e perder acesso à tarefa tira do sino as notificações dela daquela tarefa (ajuste na codificação: elas deixam de aparecer na hora, pela mesma checagem de permissão das telas, sem precisar apagar)

Pronto quando: o Sandro é mencionado numa tarefa pelo computador e o celular dele toca com o app fechado; e entrar com a conta de teste num navegador novo manda o e-mail de aparelho novo.

### M3-07 Central de prioridades básica

- [x] Uma lista por pessoa, calculada na hora a partir do que já existe (sem tabela própria, além do estado "adiado" e "resolvido"), com: tarefas minhas atrasadas e vencendo hoje, menções sem resposta, tarefas minhas em "Precisa de ajuda", avisos de agentes e, desde já, o lugar das aprovações que vêm na M4-03
- [x] Ordem por regras fixas, sem IA (decisão 13), e cada item diz em uma linha por que está ali ("vence hoje às 14h", "mencionado por Ana há 2 dias")
- [x] Ações sem sair da lista: abrir, responder (comentar), mudar status, passar para outra pessoa ou agente, adiar (até amanhã, até segunda, escolher a data) e marcar como resolvido
- [x] É a primeira tela do celular e entra como cartão no Início. Ajuste na codificação: no celular, a central é a primeira coisa do Início (com os 5 primeiros itens e "Ver todas"); no computador, é um cartão no Início e tem a tela própria Prioridades no menu
- [x] Tempo real: item novo entra na lista sem recarregar (aviso lido no sino também some da central, e vice-versa). Decidido com o Sandro: "minha tarefa" é a que tenho como responsável ou cujo responsável é um agente meu, desde que eu a veja; mudar o prazo traz a tarefa de volta; a menção sai quando comento depois dela; resolver um aviso de agente o marca como lido; adiar e resolver são só da pessoa, sem auditoria
- [x] Teste: cada tipo de item aparece só para quem deve, e um item adiado volta na data

Pronto quando: o Sandro abre o Mago OS de manhã no celular e vê, em ordem, a tarefa atrasada, a que vence hoje e a menção de ontem, adia uma e resolve outra sem sair da lista.

### M3-08 Anexos no Backblaze B2, com antivírus ClamAV

Precisa da aprovação do Sandro (segurança e container novo na VPS02). Decisão do Sandro em 19/11/2026: os anexos vão para o Backblaze B2, o mesmo serviço do backup e da auditoria, e não para o Cloudflare R2 (a decisão 0002 tinha deixado essa escolha para o M3).

- [x] Criar com o Sandro o bucket do B2 (um por ambiente: `mago-os-anexos-teste` criado em 19/11/2026 e, no M6, o de produção), privado, com criptografia, só a última versão de cada arquivo, chave só daquele bucket no Infisical (`B2_ANEXOS_*`) e CORS só para o endereço do app. Sem mudança de DNS
- [ ] No ambiente local e nos testes, armazenamento compatível com S3 em container (Garage, o mesmo que o plano prevê para a edição instalável)
- [ ] Envio direto do navegador para o B2 por link temporário, numa área de quarentena; o núcleo só autoriza depois de conferir permissão, tipo e tamanho (decisão 14: até 25 MB por arquivo, tipos perigosos como .exe, .bat, .js e .msi bloqueados)
- [ ] ClamAV num container próprio na VPS02, com atualização automática das assinaturas, sem porta para fora e sem tocar na Ratoeira; a fila pg-boss passa cada arquivo da quarentena pelo antivírus e só o limpo fica disponível. Infectado é apagado, o envio aparece como "bloqueado pelo antivírus" e o administrador é avisado
- [ ] Baixar e ver por link temporário de 5 minutos, gerado depois da checagem de permissão; imagens e PDFs com prévia na tela
- [ ] Tabela `anexos` (com `empresa_id`, RLS e marcas), caminho no bucket separado por empresa, e o arquivo some do bucket quando a tarefa é excluída
- [ ] Anexos na tarefa e nos comentários, pelo botão e arrastando; no celular, tirar foto direto
- [ ] Agente pelo MCP: vê a lista de anexos em `ver_tarefa` e baixa por link temporário (ferramenta `baixar_anexo`); enviar anexo pelo agente fica para a Fase 2
- [ ] Eventos de auditoria: `anexo.enviou`, `anexo.bloqueou`, `anexo.baixou`, `anexo.excluiu`
- [ ] Testes: o arquivo de teste EICAR é bloqueado, uma empresa não baixa anexo da outra mesmo com o caminho, e o link expira
- [ ] Nota de decisão em `docs/decisoes` sobre armazenamento e antivírus, e manual em `docs/operacao`

Pronto quando: o Sandro anexa um PDF pelo celular e ele abre com prévia depois do antivírus, e o arquivo EICAR é bloqueado com o aviso na tela.

### M3-09 Busca Ctrl+K

- [ ] Busca de texto do PostgreSQL em português, sem acento e tolerante a erro de digitação (pg_trgm), em tarefas, comentários, projetos, espaços, pessoas e agentes; a busca por significado (pgvector) entra junto com a memória da empresa, na Fase 2 (decisão 15)
- [ ] Sempre com a permissão de quem busca: a mesma regra das listas, testada com o funcionário
- [ ] Atalho Ctrl+K (Cmd+K no Mac) no computador e lupa no celular; resultados agrupados por tipo, navegação só pelo teclado
- [ ] Comandos rápidos na mesma caixa: "nova tarefa", "novo projeto", "abrir agentes", "abrir central de prioridades", "minhas tarefas"
- [ ] Teste de vazamento: a busca de uma empresa não acha nada da outra, nem pelo título exato

Pronto quando: o Sandro aperta Ctrl+K, digita "bakup" e acha a tarefa "Conferir o backup".

### M3-10 Painéis encaixáveis com layout salvo por usuário

- [ ] Biblioteca de painéis (decisão 16: dockview): dividir a tela em duas ou três partes, redimensionar, empilhar como abas, maximizar e fechar; janela solta só como opção
- [ ] Painéis do M3: Tarefas (com as três visões), Projeto, Central de prioridades, Notificações, Agentes e Início
- [ ] Cada painel baixa o código só quando entra na tela, e painel escondido não atualiza até voltar a aparecer
- [ ] Layouts salvos por pessoa, com nome ("Meu dia", "Projetos"), trocados com um clique; o do computador e o do celular ficam separados
- [ ] Tabela `layouts_de_tela` (pessoal), com `empresa_id`, RLS e marcas
- [ ] No celular, os painéis viram abas em sequência, com ordem e favoritos escolhidos pela pessoa
- [ ] Uso completo pelo teclado e leitor de tela (acessibilidade desde o início, como no plano)
- [ ] Teste de tela: montar um layout, recarregar e ver o mesmo layout

Pronto quando: o Sandro monta no computador as tarefas do projeto ao lado da central de prioridades, salva como "Meu dia", fecha o navegador e o layout volta igual; no celular, as mesmas partes aparecem como abas.

### M3-11 Tela "Dados da empresa"

Entrou no M3 com a aprovação do Sandro em 19/11/2026 (decisão 11).

- [ ] Tela para o administrador ver e mudar os dados da conta: nome, nome legal, tipo e documento (CNPJ ou CPF), telefone, fuso e idioma; o fuso passa a valer para a recorrência e os prazos (M3-03)
- [ ] Mudar o documento pede o segundo fator de novo, como as outras ações perigosas, e o CPF continua mascarado para quem não é administrador nem Dono
- [ ] Evento de auditoria: `empresa.editou`, com os campos que mudaram e sem o documento nos detalhes

Pronto quando: o Sandro muda o fuso da Nolask pela tela, e a mudança aparece na auditoria.

## Decisões para o Sandro

Aprovadas pelo Sandro em 19/11/2026, todas com a recomendação.

1. **Quem vê as tarefas de um projeto.** Recomendado: administrador e gestor veem todos os projetos; o funcionário vê só os projetos em que é membro (mais as próprias tarefas, como hoje). Alternativa: todo mundo da empresa vê todos os projetos, e só os marcados "privado" ficam restritos.
2. **Tarefa sem projeto.** Recomendado: o projeto é opcional. As tarefas do M2, as criadas pelo Telegram (M5) e as rápidas continuam valendo como "Sem projeto", e dá para mover depois. Alternativa: toda tarefa num projeto, com um projeto "Geral" criado sozinho em cada empresa.
3. **Status por projeto.** Recomendado: cada projeto define os próprios status, cada um ligado a um dos cinco tipos fixos do M2, para a trava, o agente vivo e o MCP não mudarem. Alternativa: manter os cinco status fixos em tudo até a Fase 2.
4. **Subtarefas.** Recomendado: um nível só, e a subtarefa é uma tarefa completa (pode ser de um agente). Alternativa: subtarefas dentro de subtarefas, sem limite (mais difícil de mostrar no celular).
5. **Ferramentas novas do MCP no M3.** Recomendado: `criar_subtarefa`, `marcar_checklist` e `baixar_anexo`, e mais campos em `minhas_tarefas` e `ver_tarefa` (projeto, prioridade, prazo, etiquetas, subtarefas, checklist, menções e anexos). Assim o agente faz o que o plano pede: transformar o plano em subtarefas e marcar cada passo. Alternativa: manter só as oito do M2 até o M4.
6. **Prioridades.** Recomendado: Urgente, Alta, Normal, Baixa ou sem prioridade.
7. **Como a recorrência cria a próxima tarefa.** Recomendado: ao concluir a atual, nasce a próxima com o próximo prazo (não acumula tarefas se uma atrasar). Alternativa: criar no horário, mesmo que a anterior não tenha terminado (fica para as rotinas do M5).
8. **Calendário e agenda.** Recomendado: o calendário do M3 mostra só os prazos das tarefas. Os eventos da agenda simples, que o plano põe na Fase 1, não estão em nenhuma tarefa do M3 ao M6: proponho que entrem no M5, junto com os alertas pelo Telegram. Alternativa: incluir eventos simples já no M3, como tarefa nova.
9. **Filtros salvos.** Recomendado: pessoais no M3; compartilhar uma visão com a equipe vem com o botão "Compartilhar" da Fase 2.
10. **O que é nota interna.** Recomendado: só as pessoas da empresa veem; não vai para os agentes pelo MCP nem para o cliente no portal (Fase 2). Alternativa: só esconder do cliente, e os agentes leem.
11. **Tela "Dados da empresa".** Recomendado: entrar no M3 como tarefa pequena (M3-11), porque o fuso da empresa passa a valer para prazos e recorrência e hoje só dá para mudar pelo banco. Alternativa: deixar para o M6.
12. **Push.** Recomendado: Web Push pelo próprio app instalável, sem serviço pago (no iPhone só com o app na tela de início). Alternativa: um serviço como OneSignal (mais simples no iPhone, mas manda dados para fora).
13. **Ordem da central de prioridades.** Recomendado: regras fixas, sem IA: atrasadas, depois o que vence hoje, "Precisa de ajuda", menções e avisos, desempatando pela mais antiga. A ordem por IA, que aprende com o uso, é da Fase 2.
14. **Limites dos anexos.** Recomendado: até 25 MB por arquivo e bloqueio de tipos que rodam programa (.exe, .bat, .cmd, .js, .msi, .scr e parecidos); cota por plano fica para quando houver planos (Fase 3).
15. **Busca.** Recomendado: busca de texto do PostgreSQL agora; a busca por significado (pgvector) junto com a memória da empresa, na Fase 2.
16. **Biblioteca dos painéis.** Recomendado: dockview (React, sem dependências, já tem abas, divisão, janela solta e salvar o layout). Descartadas: react-grid-layout (grade de cartões, sem abas nem divisão) e FlexLayout (menos ativa).
