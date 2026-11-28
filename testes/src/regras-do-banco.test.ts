/**
 * Regras que toda migração precisa cumprir (M0-05). Se uma tabela nova quebrar alguma, o teste barra.
 */
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { type Coluna, lerEstrutura, separarMarca, type Tabela } from "@mago-os/nucleo/documentar-banco";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

/**
 * Tabelas sem empresa_id (docs/banco/decisoes.md, seções 3 e 8): empresas é a própria empresa; pessoas e
 * papeis_plataforma valem para o sistema inteiro. A lista é fechada: tabela nova aqui só com aprovação do Sandro.
 */
const SEM_EMPRESA_ID = new Set(["empresas", "pessoas", "papeis_plataforma"]);

/**
 * Funções que rodam como dono do banco (SECURITY DEFINER), uma por uma, com o motivo (M6-01). Elas passam por cima do
 * isolamento por empresa, então cada uma foi conferida: ou só devolve o que é da própria pessoa ou empresa, ou é um
 * trabalho do sistema que percorre as empresas e devolve só ids para o trabalho continuar com a empresa ativa.
 * Função nova aqui só com revisão (e, se mexer no isolamento, com a aprovação do Sandro).
 */
const FUNCOES_COMO_DONO: Record<string, string> = {
  // Login e convites (esquema acesso): antes de existir empresa ativa, pelo código de uso único ou pela pessoa.
  "acesso.abrir_convite": "abre o convite pelo resumo do código, antes do login",
  "acesso.abrir_convite_de_empresa": "abre o convite de empresa pelo resumo do código, antes do login",
  "acesso.aceitar_convite": "aceita o convite da própria pessoa, pelo resumo do código",
  "acesso.criar_empresa_pelo_convite": "cria a empresa do convite de empresa, pelo resumo do código",
  "acesso.dois_fatores_obrigatorio": "regra de 2FA da própria pessoa",
  "acesso.e_dono_da_plataforma": "diz se a própria pessoa é Dono da plataforma",
  "acesso.empresa_inicial": "a empresa em que a própria pessoa entra",
  "acesso.empresas_da_plataforma": "lista de empresas, só para o Dono da plataforma (confere quem pede)",
  "acesso.exige_passkey": "regra de passkey da própria pessoa",
  "acesso.mudar_regras_da_plataforma": "regras da plataforma, só o Dono (confere quem pede)",
  "acesso.pessoa_do_convite": "a pessoa do convite, pelo resumo do código",
  "acesso.pessoa_do_convite_de_empresa": "a pessoa do convite de empresa, pelo resumo do código",
  "acesso.regras_da_plataforma_para": "as regras da plataforma que valem para a própria pessoa",
  // Auditoria: grava na corrente da empresa do evento, sem ler nada de volta.
  "auditoria.gravar": "grava o evento na corrente da empresa dele",
  "auditoria.reservar": "reserva o número seguinte da corrente da empresa",
  // Trabalhos do sistema (a cada minuto): percorrem as empresas e devolvem só ids ou contagens.
  "public.agentes_sem_sinal": "verificação de agente vivo, todas as empresas",
  "public.apagar_passos_antigos": "limpeza dos passos com mais de 90 dias",
  "public.aprovacoes_vencidas": "pedidos de aprovação vencidos, todas as empresas",
  "public.empresas_com_agenda": "empresas com alertas de agenda a cuidar (só ids)",
  "public.empresas_com_anexos_para_cuidar": "empresas com anexos na quarentena (só ids)",
  "public.empresas_com_arquivos_de_conversa_vencidos":
    "empresas com arquivo de conversa vencido (M8-03, só ids)",
  "public.canal_do_balao": "a empresa e o canal da chave pública do balão do site (M8-07, só ids)",
  "public.empresas_com_visitantes_vencidos":
    "empresas com visitante do site vencido, pedidos antigos ou conversa sem contato de 90 dias (M8-07, só ids)",
  "public.mensagem_nova_do_whatsapp":
    "o webhook da Meta: grava o id da mensagem já tratada (M8-09, sem dado de negócio)",
  "public.esquecer_mensagem_do_whatsapp": "o webhook da Meta: esquece o id que não chegou à fila (M8-09)",
  "public.contar_mensagem_do_whatsapp": "a trava de mensagens por minuto de um número do WhatsApp (M8-09)",
  "public.codigos_errados_do_whatsapp":
    "a trava dos códigos de vínculo errados de um número do WhatsApp (M8-09)",
  "public.reconhecer_whatsapp":
    "a pessoa e a empresa de um número do WhatsApp vinculado (M8-09, só ids e nomes)",
  "public.vincular_whatsapp": "usa o código de vínculo do WhatsApp e liga o número à pessoa (M8-09)",
  "public.marcar_resumo_do_dia_no_whatsapp":
    "marca o dia do resumo do WhatsApp na verificação do sistema (M8-09)",
  "public.reservar_modelo_do_whatsapp":
    "conta os modelos pagos do WhatsApp de uma pessoa no dia, até 10 (M8-09)",
  "public.empresas_com_whatsapp": "as empresas com alguém no WhatsApp, para o resumo do dia (M8-09, só ids)",
  "public.empresas_com_whatsapp_pendente":
    "as empresas com algo esperando para ir pelo WhatsApp (M8-09, só ids)",
  "public.empresas_com_passagens_vencidas":
    "empresas com conversa passada para a equipe e ninguém assumiu no prazo (M8-06, só ids)",
  "public.empresas_com_prazo_para_avisar": "empresas com prazos a avisar (só ids)",
  "public.empresas_com_push_pendente": "empresas com push a mandar (só ids)",
  "public.empresas_com_rotinas_a_cuidar": "empresas com rotinas na hora (só ids)",
  "public.empresas_com_telegram": "empresas com Telegram vinculado (só ids)",
  "public.empresas_com_telegram_pendente": "empresas com mensagens a entregar no Telegram (só ids)",
  "public.espaco_total_dos_anexos": "soma do espaço de todos os anexos (o aviso da conta grátis)",
  "public.execucoes_esquecidas": "execuções dos agentes que pararam no meio, todas as empresas",
  "public.limpar_contadores_de_agente": "limpeza dos contadores de passos dos agentes",
  // Gatilhos: gravam na mesma empresa da linha que mudou.
  "public.anexo_deixa_arquivo":
    "gatilho: o arquivo do anexo apagado entra na lista para apagar, na mesma empresa",
  "public.conferir_empresa_do_telegram": "gatilho: o vínculo do Telegram é da empresa da pessoa",
  "public.desligar_rotinas_do_vinculo":
    "gatilho: quem sai da empresa tem as rotinas desligadas, na mesma empresa",
  "public.desligar_telegram_do_vinculo": "gatilho: quem sai da empresa perde o Telegram, na mesma empresa",
  "public.eventos_da_aprovacao_para_rotinas":
    "gatilho: o evento da aprovação vai para a fila das rotinas da empresa",
  "public.eventos_da_tarefa_para_rotinas":
    "gatilho: o evento da tarefa vai para a fila das rotinas da empresa",
  "public.eventos_do_comentario_para_rotinas":
    "gatilho: o evento do comentário vai para a fila das rotinas da empresa",
  "public.gravar_evento_para_rotinas": "grava o evento para as rotinas, na empresa da linha que mudou",
  // Pessoas, convites e aparelhos: só da própria pessoa, ou na empresa ativa.
  "public.aparelho_conectado": "o aparelho é da própria pessoa",
  "public.cancelar_convite": "cancela o convite na empresa ativa",
  "public.convidar": "convida para a empresa ativa",
  "public.desligar_vinculo": "desliga um vínculo da empresa ativa",
  "public.empresa_ativa": "lê a empresa ativa da transação (a base do isolamento)",
  // Telegram e chaves: reconhecem quem fala pelo número da conta ou pelo começo da chave, antes da empresa ativa.
  "public.aprovacoes_travadas_no_telegram": "trava de códigos errados da própria pessoa",
  "public.atualizacao_nova_do_telegram": "cada mensagem do Telegram tratada uma vez",
  "public.codigos_errados_do_telegram": "trava de códigos de vínculo errados por conta do Telegram",
  "public.contar_mensagem_do_telegram": "limite de mensagens por conta do Telegram",
  "public.erros_de_codigo_no_telegram": "trava de códigos do autenticador da própria pessoa",
  "public.esquecer_atualizacao_do_telegram": "devolve a mensagem do Telegram para tratar de novo",
  "public.marcar_resumo_do_dia_no_telegram": "o resumo do dia da própria pessoa, uma vez por dia",
  "public.reconhecer_chave": "reconhece o agente pelo começo da chave (a chave inteira é conferida depois)",
  "public.reconhecer_chave_de_api":
    "reconhece a chave de API pelo começo, antes de saber a empresa (a chave inteira é conferida depois)",
  "public.empresas_com_entregas_de_webhook": "empresas com entrega de webhook na hora ou a desligar (só ids)",
  "public.chaves_de_api_vencendo": "chaves de API que vencem em até 30 dias, sem aviso ainda (só ids)",
  "public.reconhecer_telegram": "reconhece a pessoa e a empresa pela conta do Telegram vinculada",
  "public.usar_passo_do_autenticador": "o código do autenticador da própria pessoa não vale duas vezes",
  "public.vincular_telegram": "vincula a conta do Telegram pelo resumo do código de uso único",
};

describe.skipIf(!bancoDisponivel)("regras do banco", () => {
  let banco: BancoTemporario;
  let cliente: pg.Client;
  let tabelas: Tabela[];
  let colunas: Coluna[];
  let tabelasDasEmpresas: Tabela[];

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    cliente = new pg.Client({ connectionString: banco.urlDono });
    await cliente.connect();
    ({ tabelas, colunas } = await lerEstrutura(cliente));
    // As regras de isolamento por empresa valem para o esquema public. O esquema acesso (login) tem regras próprias.
    tabelasDasEmpresas = tabelas.filter((t) => !t.tabela.includes("."));
  });

  afterAll(async () => {
    await cliente?.end();
    await banco?.apagar();
  });

  it("toda tabela tem descrição em português", () => {
    const semDescricao = tabelas.filter((t) => !t.descricao?.trim()).map((t) => t.tabela);
    expect(semDescricao, "tabelas sem COMMENT ON TABLE").toEqual([]);
  });

  it("toda coluna tem descrição e uma das marcas [empresa], [pessoal], [sensivel] ou [sistema]", () => {
    const problemas = colunas
      .filter((c) => {
        const { marca, texto } = separarMarca(c.descricao);
        return marca === null || texto.trim().length < 3;
      })
      .map((c) => `${c.tabela}.${c.coluna}`);
    expect(problemas, "colunas sem descrição ou sem marca (ver docs/banco/decisoes.md)").toEqual([]);
  });

  it("toda tabela tem o isolamento por empresa ligado e forçado", () => {
    const semIsolamento = tabelasDasEmpresas.filter((t) => !t.rls || !t.rlsForcado).map((t) => t.tabela);
    expect(semIsolamento, "use ENABLE e FORCE ROW LEVEL SECURITY").toEqual([]);
  });

  it("todo dado leva a empresa: coluna empresa_id obrigatória apontando para empresas", () => {
    const problemas = tabelasDasEmpresas
      .filter((t) => !SEM_EMPRESA_ID.has(t.tabela))
      .filter((t) => {
        const c = colunas.find((x) => x.tabela === t.tabela && x.coluna === "empresa_id");
        return !c?.obrigatoria || c.tipo !== "uuid" || c.referencia !== "empresas.id";
      })
      .map((t) => t.tabela);
    expect(problemas).toEqual([]);
  });

  it("toda tabela tem política de acesso que usa a empresa ativa (ou a pessoa, nas tabelas sem empresa)", async () => {
    const r = await cliente.query<{ tabela: string; empresa: boolean; pessoa: boolean }>(`
      select c.relname as tabela,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                       and p.qual like '%empresa_ativa()%') as empresa,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                       and p.qual like '%pessoa_ativa()%') as pessoa
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p')`);
    const problemas = r.rows
      .filter((x) => !(x.empresa || (SEM_EMPRESA_ID.has(x.tabela) && x.pessoa)))
      .map((x) => x.tabela);
    expect(problemas).toEqual([]);
  });

  it("o papel da API não enxerga o esquema do login, e o do login não enxerga as empresas", async () => {
    const r = await cliente.query(`
      select has_schema_privilege('mago_app', 'acesso', 'USAGE') as app_no_acesso,
             has_table_privilege('mago_acesso', 'public.empresas', 'SELECT') as login_nas_empresas,
             has_table_privilege('mago_acesso', 'public.vinculos', 'SELECT') as login_nos_vinculos,
             has_table_privilege('mago_acesso', 'public.pessoas', 'INSERT') as login_cria_pessoas,
             has_table_privilege('mago_acesso', 'public.pessoas', 'DELETE') as login_apaga_pessoas`);
    expect(r.rows[0]).toEqual({
      app_no_acesso: false,
      login_nas_empresas: false,
      login_nos_vinculos: false,
      login_cria_pessoas: false,
      login_apaga_pessoas: false,
    });
    const papel = await cliente.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = 'mago_acesso'",
    );
    expect(papel.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("funções que rodam como dono do banco fixam o search_path", async () => {
    const r = await cliente.query<{ funcao: string }>(`
      select p.proname as funcao from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'acesso', 'auditoria') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(r.rows.map((x) => x.funcao)).toEqual([]);
  });

  it("cada função que roda como dono do banco está na lista conferida, com o motivo", async () => {
    const r = await cliente.query<{ funcao: string }>(`
      select n.nspname || '.' || p.proname as funcao from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'acesso', 'auditoria') and p.prosecdef order by 1`);
    const existentes = r.rows.map((x) => x.funcao);
    expect(
      existentes.filter((f) => !(f in FUNCOES_COMO_DONO)),
      "função nova que passa por cima do isolamento: confira e ponha em FUNCOES_COMO_DONO com o motivo",
    ).toEqual([]);
    expect(Object.keys(FUNCOES_COMO_DONO).filter((f) => !existentes.includes(f))).toEqual([]);
  });

  it("o papel da API não é dono de nenhuma tabela e não pode ignorar o isolamento", async () => {
    const papel = await cliente.query(
      "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'mago_app'",
    );
    expect(papel.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const donas = await cliente.query(
      "select tablename from pg_tables where schemaname = 'public' and tableowner = 'mago_app'",
    );
    expect(donas.rows).toEqual([]);
  });
});
