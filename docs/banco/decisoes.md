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

- `empresas` ganha `tipo` (pj ou pf), `documento` (único, sem pontuação), `nome_legal`, `fuso_horario`, `idioma` e `telefone`. As contas antigas ficam sem documento; uma regra garante que tipo e documento andam juntos e com o tamanho certo.
- `acesso.convites_de_empresa` guarda os convites do Dono (só a impressão digital do código). Só o login (`mago_acesso`) lê e grava.
- Funções que rodam como dono: `acesso.empresas_da_plataforma` (lista só o cadastro, só para o Dono), `acesso.abrir_convite_de_empresa`, `acesso.pessoa_do_convite_de_empresa` (cria a pessoa se ainda não existe) e `acesso.criar_empresa_pelo_convite` (cria a conta e o vínculo de administrador, só para o e-mail do convite). Ver [decisão 0016](../decisoes/0016-convite-para-criar-empresa.md).
