/**
 * Conversas na API pública, no MCP e nos webhooks (M8-11, decisão 0060), com a API inteira montada: o escopo
 * "conversas" da chave, mandar mensagem pela API (só texto, só em conversa aberta, marcada "pela API", até 60 por hora
 * por chave), a equipe do canal valendo para a chave, mandar mensagem pelo agente pedindo aprovação (e saindo o texto
 * editado na aprovação), nota, atribuir e resolver pelo MCP, e os 4 eventos dos webhooks só com os ids.
 */

import { LIMITES_DA_API } from "@mago-os/contratos";
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { gerarChave } from "@mago-os/nucleo/agentes";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { modelosFalsos } from "@mago-os/nucleo/contas-de-ia";
import { criarCanal, receberMensagem } from "@mago-os/nucleo/conversas";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";
import { type ApiDeTeste, montarApiDeTeste, SITE } from "./vazamento/montar-api.ts";

const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("conversas na API, no MCP e nos webhooks", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let api: ApiDeTeste;
  let ip = 0;
  let n = 0;
  const ids: Record<string, string> = {};
  const P: Record<string, { id: string; cookie: string }> = {};

  async function criarPessoa(rotulo: string, perfil: string, area: string | null) {
    const email = `${rotulo}@teste.invalid`;
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
      [`Pessoa ${rotulo}`, email],
    );
    const id = p.rows[0]?.id as string;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now())`,
      [ids.empresa, id, perfil, area],
    );
    ip += 1;
    const r = await api.app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.81.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode, r.body).toBe(200);
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = $1",
      [id],
    );
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) values ($1, 'c', $2, 'multiDevice')",
      [id, email],
    );
    const cookie = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    return { id, cookie };
  }

  const naTela = (metodo: "GET" | "POST", url: string, cookie: string, corpo?: unknown) =>
    api.app.inject({
      method: metodo,
      url,
      headers: {
        cookie,
        origin: SITE,
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}),
    });

  const pelaApi = (metodo: "GET" | "POST", url: string, chave: string, corpo?: unknown) =>
    api.app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${chave}`,
        "x-forwarded-for": "203.0.113.20",
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}),
    });

  async function criarChave(pessoa: string, escopo: Record<string, string>) {
    const r = await naTela("POST", "/empresa/chaves-de-api", P.admin?.cookie ?? "", {
      nome: `Chave ${Object.keys(escopo).join(" ")} ${pessoa}`,
      escopo,
      pessoaId: P[pessoa]?.id,
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as { chave: { id: string }; segredo: string };
  }

  const chegou = (canalId: string, texto: string, identificador: string) => {
    n += 1;
    return comEmpresa(api.poolApp, ids.empresa as string, (c) =>
      receberMensagem(c, {
        canalId,
        identificador,
        nomeDoPerfil: "Bia Cliente",
        idNoProvedor: `api-${n}`,
        tipo: "texto",
        texto,
      }),
    );
  };

  async function mcp(chave: string, nome: string, args: Record<string, unknown>) {
    const r = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${chave}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: nome, arguments: args },
      }),
    });
    expect(r.statusCode, r.body).toBe(200);
    return (
      r.json() as {
        result: {
          isError?: boolean;
          structuredContent?: Record<string, unknown>;
          content: { text: string }[];
        };
      }
    ).result;
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    api = await montarApiDeTeste(banco, { modelos: modelosFalsos([]) });
    ids.empresa = (
      await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id")
    ).rows[0]?.id as string;
    P.admin = await criarPessoa("admin", "administrador", null);
    P.vendas = await criarPessoa("vendas", "funcionario", "comercial");
    P.suporte = await criarPessoa("suporte", "funcionario", "suporte");
    ids.canal = (
      await comEmpresa(api.poolApp, ids.empresa, (c) =>
        criarCanal(c, P.admin?.id as string, {
          nome: "WhatsApp comercial",
          provedor: "evolution",
          identificador: "+5511966661111",
          area: "comercial",
        }),
      )
    ).id;
    // O webhook com os 4 eventos das conversas, antes da primeira mensagem.
    const w = await naTela("POST", "/empresa/webhooks", P.admin?.cookie ?? "", {
      nome: "n8n",
      url: "https://n8n.exemplo.com.br/webhook",
      eventos: [
        "conversa.aberta",
        "conversa.mensagem_recebida",
        "conversa.passada_para_pessoa",
        "conversa.resolvida",
      ],
    });
    expect(w.statusCode, w.body).toBe(201);
    ids.webhook = (w.json() as { webhook: { id: string } }).webhook.id;
    ids.conversa = (await chegou(ids.canal, "Quero saber do meu pedido 123", "5511988881111")).conversaId;
  }, 120_000);

  afterAll(async () => {
    await api?.fechar();
    await dono?.end();
    await banco?.apagar();
  });

  it("a chave só alcança as conversas com o escopo, e o escopo de leitura não manda", async () => {
    const semConversas = await criarChave("admin", { tarefas: "ler" });
    const fora = await pelaApi("GET", "/v1/conversas", semConversas.segredo);
    expect(fora.statusCode).toBe(403);
    expect(fora.json().code).toBe("FORA_DO_ESCOPO");
    const leitura = await criarChave("admin", { conversas: "ler" });
    const lista = await pelaApi("GET", `/v1/conversas?canalId=${ids.canal}`, leitura.segredo);
    expect(lista.statusCode, lista.body).toBe(200);
    expect((lista.json().conversas as { conversa: { id: string } }[]).map((c) => c.conversa.id)).toEqual([
      ids.conversa,
    ]);
    const vista = await pelaApi("GET", `/v1/conversas/${ids.conversa}`, leitura.segredo);
    expect(vista.statusCode).toBe(200);
    expect(vista.json().mensagens.at(-1).texto).toBe("Quero saber do meu pedido 123");
    const manda = await pelaApi("POST", `/v1/conversas/${ids.conversa}/mensagens`, leitura.segredo, {
      texto: "Oi",
    });
    expect(manda.statusCode).toBe(403);
    expect(manda.json().code).toBe("FORA_DO_ESCOPO");
  });

  it("a chave vê só o que a pessoa dela vê: a equipe do canal", async () => {
    const doSuporte = await criarChave("suporte", { conversas: "escrever" });
    const lista = await pelaApi("GET", "/v1/conversas", doSuporte.segredo);
    expect(lista.statusCode).toBe(200);
    expect(lista.json().conversas).toEqual([]);
    expect((await pelaApi("GET", `/v1/conversas/${ids.conversa}`, doSuporte.segredo)).statusCode).toBe(404);
    const manda = await pelaApi("POST", `/v1/conversas/${ids.conversa}/mensagens`, doSuporte.segredo, {
      texto: "Oi",
    });
    expect(manda.statusCode).toBe(404);
  });

  it("manda pela API só texto, marcado na caixa, auditado e com o limite por hora", async () => {
    const k = await criarChave("vendas", { conversas: "escrever" });
    ids.chaveDeVendas = k.chave.id;
    const comArquivo = await pelaApi("POST", `/v1/conversas/${ids.conversa}/mensagens`, k.segredo, {
      texto: "Segue",
      arquivo: { nome: "a.pdf", tipo: "application/pdf", base64: "JVBERi0=" },
    });
    expect(comArquivo.statusCode).toBe(400);
    const antes = api.enviados.length;
    const r = await pelaApi("POST", `/v1/conversas/${ids.conversa}/mensagens`, k.segredo, {
      texto: "Seu pedido saiu para entrega.",
    });
    expect(r.statusCode, r.body).toBe(201);
    const mensagemId = r.json().mensagemId as string;
    expect(
      api.enviados.slice(antes).some((e) => (e.dados as { mensagemId?: string }).mensagemId === mensagemId),
    ).toBe(true);
    const naCaixa = await naTela("GET", `/conversas-com-contatos/${ids.conversa}`, P.vendas?.cookie ?? "");
    const m = (naCaixa.json().mensagens as { id: string; pelaApi?: boolean; autorPessoaId: string }[]).find(
      (x) => x.id === mensagemId,
    );
    expect(m).toMatchObject({ pelaApi: true, autorPessoaId: P.vendas?.id });
    const audit = await dono.query<{ detalhes: Record<string, unknown>; origem_canal: string }>(
      "select detalhes, origem->>'canal' as origem_canal from auditoria.eventos where acao = 'conversa.enviou' and alvo->>'id' = $1 order by sequencia desc limit 1",
      [ids.conversa],
    );
    expect(audit.rows[0]?.origem_canal).toBe("api");
    expect(audit.rows[0]?.detalhes).toMatchObject({ mensagemId, chaveDeApiId: k.chave.id });
    expect(JSON.stringify(audit.rows[0]?.detalhes)).not.toContain("entrega");

    // O limite: 60 mensagens na última hora por chave.
    await dono.query(
      `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, autor_pessoa_id, tipo,
                                           texto, entrega, chave_de_api_id)
       select $1, $2, $3, 'saiu', 'pessoa', $4, 'texto', 'Em massa ' || g, 'enviada', $5
         from generate_series(1, $6::int) g`,
      [
        ids.empresa,
        ids.conversa,
        ids.canal,
        P.vendas?.id,
        k.chave.id,
        LIMITES_DA_API.mensagensPorHoraPorChave - 1,
      ],
    );
    const passou = await pelaApi("POST", `/v1/conversas/${ids.conversa}/mensagens`, k.segredo, {
      texto: "Mais uma",
    });
    expect(passou.statusCode).toBe(400);
    expect(passou.json().message).toContain("60 mensagens");
  });

  it("nota, atribuir e resolver pela API; resolvida não recebe mensagem", async () => {
    const k = await criarChave("admin", { conversas: "escrever" });
    const nota = await pelaApi("POST", `/v1/conversas/${ids.conversa}/notas`, k.segredo, {
      texto: "Cliente quer a segunda via",
      mencoes: [P.vendas?.id],
    });
    expect(nota.statusCode).toBe(400);
    expect(
      (
        await pelaApi("POST", `/v1/conversas/${ids.conversa}/notas`, k.segredo, {
          texto: "Cliente quer a segunda via",
        })
      ).statusCode,
    ).toBe(201);
    const paraSuporte = await pelaApi("POST", `/v1/conversas/${ids.conversa}/atribuir`, k.segredo, {
      pessoaId: P.suporte?.id,
    });
    expect(paraSuporte.statusCode).toBe(400);
    const atribuida = await pelaApi("POST", `/v1/conversas/${ids.conversa}/atribuir`, k.segredo, {
      pessoaId: P.vendas?.id,
    });
    expect(atribuida.statusCode, atribuida.body).toBe(200);
    expect(atribuida.json().conversa.donoId).toBe(P.vendas?.id);
    const resolvida = await pelaApi("POST", `/v1/conversas/${ids.conversa}/resolver`, k.segredo, {});
    expect(resolvida.statusCode).toBe(200);
    expect(resolvida.json().conversa.situacao).toBe("resolvida");
    const depois = await pelaApi("POST", `/v1/conversas/${ids.conversa}/mensagens`, k.segredo, {
      texto: "Oi?",
    });
    expect(depois.statusCode).toBe(400);
    expect(depois.json().message).toContain("Reabra");
  });

  it("os webhooks recebem aberta, mensagem recebida, passada e resolvida, só com os ids", async () => {
    const e = await dono.query<{ evento: string; corpo: { dados: Record<string, unknown> } }>(
      "select evento, corpo from entregas_de_webhook where webhook_id = $1 order by criada_em, id",
      [ids.webhook],
    );
    const eventos = e.rows.map((x) => x.evento);
    expect(eventos).toEqual(
      expect.arrayContaining([
        "conversa.aberta",
        "conversa.mensagem_recebida",
        "conversa.passada_para_pessoa",
        "conversa.resolvida",
      ]),
    );
    // A mensagem que saiu não gera evento: só a que chegou.
    expect(eventos.filter((x) => x === "conversa.mensagem_recebida")).toHaveLength(1);
    const passada = e.rows.find((x) => x.evento === "conversa.passada_para_pessoa");
    expect(passada?.corpo.dados).toMatchObject({
      id: ids.conversa,
      motivo: "atribuida",
      donoId: P.vendas?.id,
    });
    const tudo = JSON.stringify(e.rows);
    expect(tudo).not.toContain("pedido 123");
    expect(tudo).not.toContain("segunda via");
  });

  it("pelo agente: mandar mensagem pede aprovação e sai o texto aprovado (editado); nota e atribuir executam", async () => {
    // Outro telefone: a mensagem do mesmo contato na folga de 1 hora cairia na conversa resolvida.
    const nova = (await chegou(ids.canal as string, "Ainda não chegou", "5511988882222")).conversaId;
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Robô', $2) returning id",
      [ids.empresa, P.admin?.id],
    );
    const agenteId = a.rows[0]?.id as string;
    const chave = gerarChave();
    await dono.query(
      `insert into chaves_de_agente (empresa_id, agente_id, nome, prefixo, resumo, criada_por)
       values ($1, $2, 'teste', $3, $4, $5)`,
      [ids.empresa, agenteId, chave.prefixo, chave.resumo, P.admin?.id],
    );
    const pediu = await mcp(chave.chave, "mandar_mensagem_ao_contato", {
      conversaId: nova,
      texto: "Vou conferir e te aviso",
    });
    expect(pediu.isError).toBe(true);
    expect(pediu.content[0]?.text).toContain("precisa de aprovação");
    const saidas = await dono.query(
      "select 1 from mensagens_com_contatos where conversa_id = $1 and direcao = 'saiu'",
      [nova],
    );
    expect(saidas.rowCount).toBe(0);
    const pedido = await dono.query<{ id: string; conferencia: string; resumo: string }>(
      "select id, conferencia, resumo from aprovacoes where agente_id = $1 and acao = 'mandar_mensagem_ao_contato'",
      [agenteId],
    );
    expect(pedido.rows[0]?.resumo).toBe("Mandar a “Bia Cliente”: “Vou conferir e te aviso”");
    const antes = api.enviados.length;
    const aprovada = await naTela(
      "POST",
      `/aprovacoes/${pedido.rows[0]?.id}/decidir`,
      P.admin?.cookie ?? "",
      {
        decisao: "aprovar",
        conferencia: pedido.rows[0]?.conferencia,
        parametros: { conversaId: nova, texto: "Vou conferir com a transportadora e te aviso hoje." },
      },
    );
    expect(aprovada.statusCode, aprovada.body).toBe(200);
    const saiu = await dono.query<{ id: string; texto: string; autor: string; autor_agente_id: string }>(
      "select id, texto, autor, autor_agente_id from mensagens_com_contatos where conversa_id = $1 and direcao = 'saiu'",
      [nova],
    );
    expect(saiu.rows).toEqual([
      expect.objectContaining({
        texto: "Vou conferir com a transportadora e te aviso hoje.",
        autor: "agente",
        autor_agente_id: agenteId,
      }),
    ]);
    expect(
      api.enviados
        .slice(antes)
        .some((e) => (e.dados as { mensagemId?: string }).mensagemId === saiu.rows[0]?.id),
    ).toBe(true);

    const nota = await mcp(chave.chave, "escrever_nota_na_conversa", {
      conversaId: nova,
      texto: "Cliente ansioso",
    });
    expect(nota.isError, nota.content[0]?.text).toBeFalsy();
    const atribuida = await mcp(chave.chave, "atribuir_conversa", {
      conversaId: nova,
      pessoaId: P.vendas?.id,
    });
    expect(atribuida.isError, atribuida.content[0]?.text).toBeFalsy();
    expect((atribuida.structuredContent?.conversa as { donoId: string } | undefined)?.donoId).toBe(
      P.vendas?.id,
    );
    const aviso = await dono.query<{ texto: string }>(
      "select texto from avisos where pessoa_id = $1 and tipo = 'mensagem_na_conversa' order by criado_em desc limit 1",
      [P.vendas?.id],
    );
    expect(aviso.rows[0]?.texto).toBe('Robô passou para você a conversa de "Bia Cliente".');
    const resolvida = await mcp(chave.chave, "resolver_conversa", { conversaId: nova });
    expect(resolvida.isError, resolvida.content[0]?.text).toBeFalsy();
    expect((resolvida.structuredContent?.conversa as { situacao: string } | undefined)?.situacao).toBe(
      "resolvida",
    );
    const autores = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 and ator->>'tipo' = 'agente' order by sequencia",
      [nova],
    );
    expect(autores.rows.map((x) => x.acao)).toEqual(
      expect.arrayContaining(["conversa.enviou", "conversa.anotou", "conversa.passou", "conversa.resolveu"]),
    );
  });
});
