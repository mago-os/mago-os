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
