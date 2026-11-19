# Decisões do banco

Escrito à mão. Explica o porquê das escolhas importantes do banco de dados. O que o banco tem (tabelas e colunas) está em [README.md](README.md), gerado sozinho. Uma decisão nova entra como seção nova, com data; uma decisão trocada fica marcada como substituída, sem apagar.

## 1. Isolamento por empresa dentro do próprio banco (16/11/2026, M0-05)

**Decisão:** o isolamento entre empresas é feito pelo PostgreSQL (Row Level Security), não só pelo código da API.

**Por quê:** se um dia uma consulta esquecer o filtro da empresa, o banco continua escondendo os dados das outras. Um erro de código não vira vazamento.

**Como funciona:**

1. A API se conecta com o papel `mago_app`. Ele não é dono de nenhuma tabela, não é superusuário e não pode ignorar o Row Level Security (`NOBYPASSRLS`).
2. Cada pedido roda numa transação que começa informando a empresa ativa: `set_config('mago.empresa_id', '<id>', true)`. No código, isso é a função `comEmpresa` (`nucleo/src/empresa.ts`). O `true` faz a informação valer só até o fim da transação, então a conexão volta limpa para o pool.
3. A função `empresa_ativa()` devolve a empresa informada, ou nulo.
4. Toda tabela tem `ENABLE` e `FORCE ROW LEVEL SECURITY` e uma política que compara `empresa_id` com `empresa_ativa()`. Sem empresa informada, nenhuma linha aparece.

**Descartado:**

- *Um banco ou um esquema por empresa:* isola mais, mas multiplica migrações, backups e conexões. Fica como opção para um cliente grande que exija, na parte fechada (mago-os-cloud).
- *Só filtrar no código:* um esquecimento vira vazamento.

## 2. Dois papéis: dono e API (16/11/2026, M0-05)

- `mago` (dono): cria e altera as tabelas. Usado só pelas migrações, pelos dados falsos e pela manutenção.
- `mago_app` (API): só lê e grava dados, sempre sujeito ao isolamento. Não cria tabelas no esquema `public`.

O papel `mago_app` é criado pela migração 0001 se ainda não existir; a senha dele em teste e produção é definida fora das migrações, a partir do Infisical (M0-08 e M0-10). No ambiente local não há senha, porque o banco só aceita conexões do próprio computador.

## 3. Tabela de empresas sem coluna empresa_id (16/11/2026, M0-05)

A tabela `empresas` é a única sem `empresa_id`: a política dela compara o próprio `id` com a empresa ativa. A API pode ver e alterar só a própria empresa; criar e apagar empresas fica com o dono do banco até o M1-02 definir como a plataforma faz isso.

## 4. Marcas de cada coluna (16/11/2026, M0-05)

Toda coluna tem descrição em português (`COMMENT ON COLUMN`), começando por uma marca:

| Marca | Quando usar |
| --- | --- |
| `[empresa]` | Dado de negócio da empresa, que não identifica uma pessoa (nome da empresa, valor de um contrato) |
| `[pessoal]` | Dado que identifica ou pode identificar uma pessoa (nome, e-mail, telefone, IP) |
| `[sensivel]` | Dado pessoal sensível da LGPD, art. 5º, II (saúde, religião, biometria, origem racial, opinião política...) |
| `[sistema]` | Controle técnico, sem dado de negócio (identificadores, datas de criação) |

Toda tabela também tem descrição (`COMMENT ON TABLE`). Um teste barra tabela ou coluna sem descrição ou sem marca. Na dúvida entre `[empresa]` e `[pessoal]`, use `[pessoal]`. As marcas alimentam a documentação gerada e, mais tarde, os pedidos de dados e exclusão da LGPD.

## 5. Identificadores em UUID v7 (16/11/2026, M0-05)

Chaves primárias são `uuid` com `uuidv7()`, nativo do PostgreSQL 18. São difíceis de adivinhar (não dá para "chutar" o próximo número) e, por serem em ordem de criação, não prejudicam os índices como o UUID v4.

## 6. Migrações em SQL puro, sempre com volta (16/11/2026, M0-05)

Ferramenta: node-pg-migrate, com arquivos `.sql` numerados em `nucleo/migracoes`, cada um com `-- Up Migration` e `-- Down Migration`. SQL puro deixa as políticas de isolamento e as descrições legíveis, sem tradução. Cada execução roda numa transação só: se uma migração falhar, nada fica pela metade. O controle de quais já rodaram fica no esquema `mago_controle`, fora do `public`. Um teste sobe todas, volta todas e sobe de novo.

## 7. Fila no esquema pgboss (16/11/2026, M0-05)

O pg-boss guarda a fila no esquema `pgboss`, criado pela migração 0001 com o `mago_app` como dono. A fila não tem dados de empresa por enquanto; quando um trabalho levar dados de uma empresa, ele leva o `empresa_id` e o trabalho roda dentro de `comEmpresa`.

## 8. Pessoas em várias empresas e a pessoa do pedido (17/11/2026, M1-02)

**Decisão:** além da empresa ativa, a API informa ao banco a pessoa do pedido (`set_config('mago.pessoa_id', '<id>', true)`, função `pessoa_ativa()`). No código, isso é `comPessoa` (`nucleo/src/empresa.ts`); trabalhos do próprio sistema continuam com `comEmpresa`, sem pessoa.

**Como funciona:**

1. `pessoas` e `papeis_plataforma` não têm `empresa_id`: uma pessoa vale para o sistema inteiro (um e-mail, um login) e a ligação com cada empresa fica em `vinculos`, que tem `empresa_id` como as outras tabelas. A lista de tabelas sem `empresa_id` é fechada no teste `regras-do-banco` e só cresce com aprovação do Sandro.
2. Com uma pessoa no pedido, `empresa_ativa()` só devolve a empresa se a pessoa tiver vínculo **ativo** nela, a pessoa estiver ativa e a empresa não estiver suspensa. Se o código errar a empresa, ou se a pessoa tiver sido desligada no meio do caminho, o banco não mostra nada daquela empresa. A função roda como dono do banco (`SECURITY DEFINER`, com `search_path` fixo) para poder olhar vínculos sem cair nas políticas que dependem dela.
3. O que cada pessoa vê:
   - `pessoas`: ela mesma e quem tem vínculo com a empresa ativa.
   - `vinculos`: os da empresa ativa e os dela mesma (para saber em que empresas está).
   - `empresas`: a ativa e aquelas onde ela tem vínculo ativo (é o que permite escolher a empresa).
   - `papeis_plataforma`: só o próprio papel. Uma empresa nunca vê quem são os donos da plataforma.
4. Ser Dono da plataforma **não** abre os dados de nenhuma empresa: o Sandro vê os dados de uma empresa porque tem vínculo nela, como qualquer pessoa. Entrar numa empresa para dar suporte fica para a Fase 2, com registro na auditoria.
5. Nesta tarefa a API só lê pessoas, vínculos e papéis. Criar e alterar chega com o login (M1-03) e os convites (M1-07). Até lá, só o dono do banco grava, pelo comando `pnpm plataforma:iniciar`, que cria o Dono da plataforma e uma empresa onde ele é administrador, e pode rodar de novo para cada empresa nova. Nome e e-mail reais entram só pelo comando, nunca no código.

**Descartado:**

- *Copiar a pessoa em cada empresa (uma linha por empresa):* o mesmo login viraria vários cadastros, com senha e 2FA separados.
- *Confiar só no código para conferir o vínculo:* um esquecimento abriria a empresa errada. O banco confere de novo.
- *Dono da plataforma enxergar todas as empresas:* abriria dados de clientes sem registro nem motivo.

## 9. Esquema do login e o papel mago_acesso (17/11/2026, M1-03)

**Decisão:** senhas, sessões, links de uso único, limites por minuto e travas ficam no esquema `acesso`, fora do isolamento por empresa, e só o papel `mago_acesso` (usado pelo Better Auth) mexe nele. Detalhes na [decisão 0009](../decisoes/0009-login-com-better-auth.md).

**Como funciona:**

1. `mago_acesso` não é dono, não é superusuário e não ignora o Row Level Security. Ele lê todas as pessoas (o login precisa achar a pessoa pelo e-mail antes de saber quem ela é) e altera só nome, foto, e-mail verificado e data de alteração. Não cria nem apaga pessoas, e não vê empresas nem vínculos.
2. `mago_app` (a API das empresas) não tem acesso ao esquema `acesso`: nenhum pedido de empresa consegue ler senha ou sessão.
3. A empresa ativa de uma sessão nova vem de `acesso.empresa_inicial(pessoa)`, que roda como dono e devolve só o identificador da única empresa onde a pessoa tem vínculo ativo (ou nulo se houver várias).
4. A documentação gerada e o teste de descrições e marcas passam a cobrir também o esquema `acesso` (tabelas aparecem como `acesso.nome`). As regras de `empresa_id` e Row Level Security continuam valendo só para o esquema `public`; um teste próprio confere a separação entre os dois papéis.

## 10. Segundo fator na sessão (17/11/2026, M1-05)

**Decisão:** cada sessão guarda quando passou pelo segundo fator (`acesso.sessoes.dois_fatores_em`), e a API só libera os dados para quem precisa de 2FA depois disso. Detalhes na [decisão 0011](../decisoes/0011-dois-fatores.md).

- `acesso.dois_fatores` (segredo do app e códigos de recuperação, criptografados) e `acesso.passkeys` (só a chave pública) ficam no esquema do login, como as senhas.
- `pessoas.dois_fatores_ativo` marca quem ativou o app; `empresas.exigir_dois_fatores` marca a empresa que exige de todos. O papel `mago_acesso` altera só a primeira.
- Quem tem o 2FA obrigatório vem de `acesso.dois_fatores_obrigatorio(pessoa)`, que roda como dono e devolve só sim ou não: o login continua sem enxergar empresas nem vínculos. Do mesmo jeito, `acesso.exige_passkey(pessoa)` diz se só a passkey vale.
- O piso da plataforma fica em `acesso.regras_da_plataforma` (uma linha só, decidida pelo Dono); as empresas só apertam (`exigir_dois_fatores`, `exigir_passkey`). Cada sessão guarda também o método do segundo fator (`dois_fatores_metodo`).

## 11. Permissões por cima do isolamento (17/11/2026, M1-06)

**Decisão:** as permissões (perfil, ajustes e dados sensíveis) são calculadas e conferidas no núcleo, numa verificação central; o banco continua cuidando do isolamento entre empresas. Detalhes na [decisão 0012](../decisoes/0012-permissoes.md).

- `ajustes_de_permissao` guarda os ajustes que o administrador faz para cada pessoa, por módulo e ação, isolada por empresa como as outras tabelas. Quem pode mudar (o administrador, por padrão) é conferido pelo núcleo.
- `vinculos.area` passa a valer também para o funcionário (a equipe dele); o administrador nunca tem área.

## 12. Aparelhos e avisos (17/11/2026, M1-08)

**Decisão:** o login reconhece cada aparelho por uma etiqueta guardada num cookie, e o banco guarda só a impressão digital dela (`acesso.aparelhos`). Cada sessão aponta para o aparelho e registra o último uso; acessos por aparelho novo viram avisos (`acesso.avisos`). Tudo no esquema `acesso`, só com o papel `mago_acesso`. Detalhes na [decisão 0013](../decisoes/0013-sessoes-e-aparelhos.md).

## 13. Esquema da auditoria (17/11/2026, M1-09)

**Decisão:** os eventos de auditoria ficam no esquema `auditoria`, que só acrescenta. Detalhes na [decisão 0014](../decisoes/0014-auditoria.md).

- `auditoria.eventos` (uma corrente por empresa, mais a da plataforma) e `auditoria.correntes` (a ponta de cada uma). Ninguém escreve direto: só as funções `auditoria.reservar` e `auditoria.gravar`, que rodam como dono e mantêm a ordem.
- Um gatilho barra alteração e exclusão até para o dono; a única mudança aceita é marcar `copiado_em` (cópia travada no Backblaze), uma vez.
- A API das empresas lê só os eventos da empresa ativa (Row Level Security); a corrente da plataforma não aparece para nenhuma empresa.
- A documentação gerada e o teste de descrições e marcas cobrem também o esquema `auditoria`.

## 14. Regras e papéis pelo app (17/11/2026, M1-10)

O login (`mago_acesso`) não lê papéis nem as regras da plataforma direto. As telas usam funções que rodam como dono e conferem quem pede: `acesso.e_dono_da_plataforma`, `acesso.regras_da_plataforma_para` e `acesso.mudar_regras_da_plataforma` (só o Dono). A pessoa também passa a mudar idioma e fuso do próprio perfil. A segurança da empresa (`exigir_dois_fatores`, `exigir_passkey`) é mudada pela API das empresas, só com a permissão `seguranca.editar` (padrão: o administrador).

## 15. Convites e desligamento (17/11/2026, M1-07)

- `acesso.convites` guarda os convites (só a impressão digital do código, validade de 7 dias, uso único). Só o login (`mago_acesso`) lê e grava.
- A API das empresas não grava direto em pessoas e vínculos: `convidar`, `cancelar_convite` e `desligar_vinculo` rodam como dono e só agem na empresa ativa do pedido. Quem pode chamar cada uma é conferido pelo núcleo (`pessoas.criar` e `pessoas.excluir`).
- `desligar_vinculo` recusa desligar a si mesmo e o último administrador ativo, e devolve se a pessoa ainda tem outra empresa (para o núcleo decidir entre apagar as sessões e só tirar a empresa delas).
- Aceitar passa por `acesso.abrir_convite`, `acesso.aceitar_convite` e `acesso.pessoa_do_convite`, que conferem código, validade e pessoa. Ver [decisão 0015](../decisoes/0015-convites.md).

## 16. Conta com CNPJ ou CPF e convite para criar empresa (17/11/2026, M1-11)

- `empresas` ganha `tipo` (pj ou pf), `documento` (sem pontuação; várias contas, uma por marca, podem ter o mesmo documento desde a migração 0012), `nome_legal`, `fuso_horario`, `idioma` e `telefone`. As contas antigas ficam sem documento; uma regra garante que tipo e documento andam juntos e com o tamanho certo.
- `acesso.convites_de_empresa` guarda os convites do Dono (só a impressão digital do código). Só o login (`mago_acesso`) lê e grava.
- Funções que rodam como dono: `acesso.empresas_da_plataforma` (lista só o cadastro, só para o Dono), `acesso.abrir_convite_de_empresa`, `acesso.pessoa_do_convite_de_empresa` (cria a pessoa se ainda não existe) e `acesso.criar_empresa_pelo_convite` (cria a conta e o vínculo de administrador, só para o e-mail do convite). Ver [decisão 0016](../decisoes/0016-convite-para-criar-empresa.md).

## 17. Tarefas e comentários (18/11/2026, M2-01)

- `tarefas` e `comentarios_de_tarefa` seguem o contrato de `contratos/src/tarefas/tarefa.ts`, com `empresa_id`, RLS forçado e a política de `empresa_ativa()`.
- Responsável, quem criou, quem pegou (a trava da M2-02) e quem entregou o resultado são uma pessoa ou um agente: duas colunas para cada um, no máximo uma preenchida (as duas vazias, nos autores, quer dizer o sistema). A pessoa precisa ter vínculo na mesma empresa (chave composta com `vinculos`), então não dá para pôr alguém de outra empresa numa tarefa nem por erro do código. A referência para `agentes` entra na M2-03.
- As regras do contrato estão também no banco: tarefa encerrada (concluída ou cancelada) tem data, resultado só em tarefa concluída e sempre com quem entregou, trava só em andamento ou precisando de ajuda.
- Comentários só se acrescentam: a API (`mago_app`) não tem UPDATE nem DELETE neles. Saem junto só quando a tarefa é excluída.

## 18. Agentes (18/11/2026, M2-03)

- `agentes` segue o contrato de `contratos/src/agentes/agente.ts`, com `empresa_id`, RLS forçado e a política de `empresa_ativa()`. A pessoa responsável precisa ter vínculo na mesma empresa (chave composta com `vinculos`).
- Agente não se apaga (a API não tem DELETE): desliga-se, com data. Dois agentes vivos da mesma empresa não podem ter o mesmo nome.
- As colunas de agente de `tarefas` e `comentarios_de_tarefa` passam a apontar para `agentes` da mesma empresa (chave composta), então uma tarefa nunca fica com um agente de outra empresa.

## 19. Tempo real pelo próprio banco (18/11/2026, M2-06)

- A função `avisar_mudanca()` e os gatilhos em `tarefas`, `comentarios_de_tarefa` e `agentes` mandam um aviso no canal `mago_mudancas` (LISTEN/NOTIFY) a cada mudança. O aviso leva só a empresa, o tipo (tarefa ou agente), o id e a operação: nada de título, texto ou nome.
- Cada cópia da API escuta o canal com uma conexão própria e repassa o aviso só às telas da mesma empresa. A tela busca de novo pela rota normal, então a permissão continua valendo. Funciona com mais de uma cópia e na troca azul e verde.

## 20. Chaves, limites e avisos dos agentes (18/11/2026, M2-04)

- `chaves_de_agente` guarda só o começo da chave (único) e o resumo SHA-256 da chave inteira, nunca a chave. A API não apaga chaves: revoga. Ver [decisão 0017](../decisoes/0017-chave-do-agente.md).
- Antes de saber a empresa, o pedido do agente acha a chave pelo começo com `reconhecer_chave` (dono): devolve uma linha só, com o começo exato. A conferência do resumo é feita na API, em tempo constante.
- `contadores_de_agente`: pedidos por minuto (por chave) e leituras por hora (por agente), no banco, para valer com várias cópias da API. `limpar_contadores_de_agente` apaga os com mais de 2 horas.
- `avisos`: avisos para uma pessoa dentro do Mago OS, só para quem tem vínculo na empresa, com link sempre interno.
- `agentes_sem_sinal` (dono): para a verificação a cada minuto, devolve só os ids dos agentes com tarefa pegada e sem sinal; o trabalho em cada empresa roda com a empresa dela.

## 21. Espaços e projetos (19/11/2026, M3-01)

- `espacos`, `projetos` e `membros_de_projeto` seguem o contrato de `contratos/src/projetos/projeto.ts`, com `empresa_id`, RLS forçado e a política de `empresa_ativa()`. Espaço não se apaga (a API não tem DELETE): arquiva-se.
- O diretor fica no próprio projeto e é sempre uma pessoa com vínculo na mesma empresa; o gerente é uma pessoa ou um agente da mesma empresa, ou ninguém (chaves compostas). O banco recusa o diretor como gerente, e "o gerente recebe as tarefas sem responsável" sem gerente.
- `membros_de_projeto` guarda só os membros comuns (pessoa ou agente, sem repetir). A função `membro_do_projeto(projeto, pessoa)` diz se a pessoa é diretora, gerente ou membro, e roda com a permissão de quem chama, então o RLS continua valendo.
- A tarefa ganha `projeto_id`, opcional ("Sem projeto"), sempre de um projeto da mesma empresa. Projeto com tarefas não se exclui: arquiva-se.
- Os gatilhos do tempo real (seção 19) passam a avisar também espaços, projetos e membros, com o tipo "projeto".

## 22. Listas, status do projeto, subtarefas e checklist (19/11/2026, M3-02)

- `listas`, `status_de_projeto` e `itens_de_checklist` seguem os contratos de `contratos/src/projetos/lista.ts` e `contratos/src/tarefas/checklist.ts`, com `empresa_id`, RLS forçado e a política de `empresa_ativa()`.
- Cada status do projeto pertence a um dos cinco tipos fixos, que continua em `tarefas.status`. O tipo não muda depois de criado (a API só atualiza nome, cor e ordem), e a chave composta `(empresa_id, projeto_id, status_do_projeto_id, status)` garante que a tarefa está sempre num status do mesmo tipo.
- O gatilho `acertar_tarefa`, antes de gravar a tarefa, escolhe a primeira lista do projeto e o primeiro status do tipo quando faltam ou não servem. Assim nenhum caminho (tela, MCP, agente sem sinal, desligamento) precisa lembrar disso. Tarefa de projeto sempre tem lista e status; sem projeto, nenhum dos dois (regra conferida pelo banco).
- Subtarefa: um nível só e sempre no projeto e na lista da mãe (gatilho `acertar_tarefa`). Quando a mãe muda de projeto ou de lista, o gatilho `levar_subtarefas` leva as subtarefas junto. Excluir a mãe exclui as subtarefas.
- Projetos que já existiam ganharam a lista "Geral" e os cinco status padrão na própria migração.
- Os gatilhos do tempo real avisam listas e status como "projeto" e o checklist como "tarefa".

## 23. Prioridade, prazo, etiquetas e recorrência (19/11/2026, M3-03)

- O prazo é guardado como dia (`prazo_dia`), hora opcional (`prazo_hora`) e o fuso em que foi marcado (`prazo_fuso`). O gatilho `calcular_prazo` calcula `prazo_em` no próprio banco, no fuso do prazo (sem hora, 23:59), então a mudança de horário de verão de cada lugar já entra na conta. `prazo_em` serve para ordenar e para os avisos de prazo (M3-06).
- `etiquetas` (nome único na empresa, sem diferença de maiúsculas) e `etiquetas_de_tarefa` têm `empresa_id`, RLS forçado e a política de `empresa_ativa()`, com chaves compostas: a tarefa só recebe etiqueta da própria empresa.
- A regra da recorrência fica na tarefa (`recorrencia`, jsonb conferido pelo contrato na API). Ao concluir, a próxima nasce com `recorrente_de_id` apontando para a anterior; o índice único em `recorrente_de_id` garante uma próxima só, mesmo com conclusão repetida ou dois pedidos ao mesmo tempo. Apagar a anterior só limpa a referência (`ON DELETE SET NULL` só nessa coluna).
- O banco confere: prazo completo (dia, fuso e momento juntos; hora só com dia), recorrência só com prazo e início antes do prazo.

## 24. Visões salvas (19/11/2026, M3-04)

- `visoes_salvas` é pessoal (decisão 9 do Sandro): além do isolamento por empresa, a política usa `pessoa_ativa()`, então o próprio banco só mostra e só deixa mexer nas visões de quem está pedindo. A pessoa precisa ter vínculo com a empresa (chave composta com `vinculos`), e a visão some se o vínculo for apagado.
- Os filtros ficam em jsonb, conferidos pelo contrato `FiltroDeTarefas` na API. O "hoje" e o calendário usam o fuso da pessoa.

## 25. Linha do tempo: notas internas, menções e acontecimentos (19/11/2026, M3-05)

- `comentarios_de_tarefa` ganha o tipo (comentário ou nota interna). A nota interna só vai para pessoas: a API não a entrega aos agentes pelo MCP (decisão 10 do Sandro). Editar e apagar passam a existir, mas a API só muda o texto e as datas de edição e exclusão (permissão por coluna); apagado fica sem texto, no mesmo lugar.
- `mencoes_de_comentario` guarda quem foi mencionado (pessoa ou agente da mesma empresa, por chave composta). O agente mencionado num comentário (não nota) passa a ver aquela tarefa e a poder comentar nela, sem poder pegá-la nem mudá-la. A menção a uma pessoa não abre a tarefa para quem não a vê.
- `acontecimentos_de_tarefa` guarda o que aconteceu (status, responsável, prazo, prioridade, projeto, lista, entrega, pegou, soltou), com ids e valores fixos, só acrescentando. É gravado junto com a auditoria, mas é da tarefa: quem vê a tarefa vê a linha do tempo, sem precisar ver a auditoria.

## 26. Notificações (19/11/2026, M3-06)

- `avisos` (da M2-04) passa a valer para as tarefas: novos tipos, a tarefa do aviso (some junto com ela) e `push_pendente`. Aviso novo avisa só as telas da própria pessoa pelo tempo real (tipo "aviso").
- `seguidores_de_tarefa`: quem cria, o responsável e quem é mencionado seguem sozinhos; dá para seguir e deixar de seguir.
- `assinaturas_de_push`: uma por aparelho do login, com as chaves do navegador marcadas como sensíveis. O push só sai para aparelho com sessão aberta (`aparelho_conectado`, dono, porque a API não lê `acesso.sessoes`); assinatura que o serviço diz não existir mais é apagada.
- `preferencias_de_notificacao`: o que chega por onde e o horário de silêncio. No silêncio, o push espera; o sino recebe na hora.
- Verificação a cada minuto (pg-boss): `empresas_com_prazo_para_avisar` e `empresas_com_push_pendente` (dono, só ids) acham o trabalho; cada empresa roda com a empresa dela. `tarefas.avisou_prazo_hoje_em` e `avisou_prazo_vencido_em` garantem um aviso por prazo; mudar o prazo apaga as marcas.
- O aviso de tarefa só vai, e só aparece no sino, para quem vê a tarefa, pela permissão real da pessoa (perfil, ajustes e alcance, a mesma consulta das rotas). Seguir não dá acesso, e quem não vê não vira seguidor. O texto do push é genérico, sem dado da tarefa.
- O envio do push marca os avisos numa transação curta (por pessoa, fora do silêncio dela) e chama o serviço de push fora da transação: o banco não fica preso esperando a internet, e um erro no meio não manda o mesmo push duas vezes.
