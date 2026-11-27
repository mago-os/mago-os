/**
 * Mago OS como servidor MCP (M2-05), de ponta a ponta com um cliente MCP de verdade (o SDK oficial) falando HTTP com
 * o núcleo: lista as ferramentas, faz o ciclo da tarefa (listar, pegar, comentar, entregar), respeita a trava e
 * a revogação da chave, e a chave de uma empresa não vê nada da outra.
 */
import { gerarChave } from "@mago-os/nucleo/agentes";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarServidorMcp } from "@mago-os/nucleo/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { umaVolta } from "../../infra/ferramentas/agente-de-teste.ts";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";

describe.skipIf(!bancoDisponivel)("servidor MCP", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let endereco = "";
  const empresas: Record<string, string> = {};
  const agentes: Record<string, string> = {};
  const chaves: Record<string, { chave: string; id: string }> = {};

  async function criarEmpresaComAgente(nome: string, agente: string) {
    const e = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
      nome,
    ]);
    const empresaId = e.rows[0]?.id as string;
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
      [`Dona da ${nome}`, `dona-${nome.toLowerCase()}@teste.invalid`],
    );
    const pessoaId = p.rows[0]?.id as string;
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
       values ($1, $2, 'administrador', 'ativo', now(), now())`,
      [empresaId, pessoaId],
    );
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, $2, $3) returning id",
      [empresaId, agente, pessoaId],
    );
    const agenteId = a.rows[0]?.id as string;
    const nova = gerarChave();
    const k = await dono.query<{ id: string }>(
      `insert into chaves_de_agente (empresa_id, agente_id, nome, prefixo, resumo, criada_por)
       values ($1, $2, 'teste', $3, $4, $5) returning id`,
      [empresaId, agenteId, nova.prefixo, nova.resumo, pessoaId],
    );
    empresas[nome] = empresaId;
    agentes[nome] = agenteId;
    chaves[nome] = { chave: nova.chave, id: k.rows[0]?.id as string };
  }

  async function conectar(chave: string): Promise<Client> {
    const cliente = new Client({ name: "teste", version: "1.0.0" });
    const transporte = new StreamableHTTPClientTransport(new URL(`${endereco}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${chave}` } },
    });
    await cliente.connect(transporte);
    return cliente;
  }

  type Resposta = {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { text: string }[];
  };
  const chamar = async (cliente: Client, nome: string, args: Record<string, unknown> = {}) =>
    (await cliente.callTool({ name: nome, arguments: args })) as unknown as Resposta;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    await criarEmpresaComAgente("Um", "Claude no Mac");
    await criarEmpresaComAgente("Dois", "Agente da Dois");
    app = Fastify();
    registrarServidorMcp(app, {
      poolApp,
      urlPublica: SITE,
      carteiro: { async enviarLinkDeSenha() {} },
    });
    endereco = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app?.close();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("lista as vinte e uma ferramentas, com descrição e esquema de entrada", async () => {
    const cliente = await conectar(chaves.Um?.chave ?? "");
    const { tools } = await cliente.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "minhas_tarefas",
      "ver_tarefa",
      "pegar_tarefa",
      "soltar_tarefa",
      "comentar",
      "mudar_status",
      "entregar_resultado",
      "criar_subtarefa",
      "marcar_checklist",
      "baixar_anexo",
      "estou_vivo",
      "pegar_instrucoes",
      "listar_skills",
      "pegar_skill",
      "listar_contatos",
      "ver_contato",
      "criar_contato",
      "atualizar_contato",
      "ligar_contato",
      "listar_conversas",
      "ver_conversa",
    ]);
    expect(tools.every((t) => (t.description ?? "").length > 20 && t.inputSchema.type === "object")).toBe(
      true,
    );
    await cliente.close();
  });

  it("instruções e skills pelo MCP (M4-05): o texto da empresa chega ao agente, e só as skills dele", async () => {
    await dono.query(
      `insert into versoes_de_instrucoes (empresa_id, camada, versao, texto)
       values ($1, 'empresa', 1, 'Responda sempre em português do Brasil, sem travessão.')`,
      [empresas.Um],
    );
    const s = await dono.query<{ id: string }>(
      "insert into skills (empresa_id, nome) values ($1, 'responder-clientes') returning id",
      [empresas.Um],
    );
    const skillId = s.rows[0]?.id as string;
    await dono.query(
      `insert into versoes_de_skills (empresa_id, skill_id, versao, situacao, descricao, texto, publicada_em)
       values ($1, $2, 1, 'publicada', 'Use ao responder um cliente.', 'Seja cordial.', now())`,
      [empresas.Um, skillId],
    );
    await dono.query("insert into skills_do_agente (empresa_id, agente_id, skill_id) values ($1, $2, $3)", [
      empresas.Um,
      agentes.Um,
      skillId,
    ]);
    const cliente = await conectar(chaves.Um?.chave ?? "");
    const instrucoes = await chamar(cliente, "pegar_instrucoes");
    expect(String(instrucoes.structuredContent?.texto)).toContain("português do Brasil, sem travessão");
    expect(String(instrucoes.structuredContent?.texto)).toContain("Instruções da plataforma");
    const lista = await chamar(cliente, "listar_skills");
    expect(lista.structuredContent?.skills).toEqual([
      { id: skillId, nome: "responder-clientes", descricao: "Use ao responder um cliente.", versao: 1 },
    ]);
    const skill = await chamar(cliente, "pegar_skill", { skillId });
    expect(skill.structuredContent?.texto).toBe("Seja cordial.");
    expect((await chamar(cliente, "pegar_skill", { skillId: "plataforma:planejar-tarefas" })).isError).toBe(
      true,
    );
    // A outra empresa não recebe nada desta.
    const outro = await conectar(chaves.Dois?.chave ?? "");
    expect(String((await chamar(outro, "pegar_instrucoes")).structuredContent?.texto)).not.toContain(
      "travessão",
    );
    expect((await chamar(outro, "listar_skills")).structuredContent?.skills).toEqual([]);
    await outro.close();
    await cliente.close();
  });

  it("contatos pelo MCP (M7-01): cadastra, avisa o repetido, liga à tarefa dele, e a outra empresa não vê", async () => {
    const cliente = await conectar(chaves.Um?.chave ?? "");
    const criado = await chamar(cliente, "criar_contato", {
      tipo: "pessoa",
      nome: "Ana da Acme",
      identificadores: [{ tipo: "email", valor: "ana@acme.invalid", principal: true }],
    });
    expect(criado.isError).toBeFalsy();
    const contatoId = (criado.structuredContent?.contato as { id: string } | undefined)?.id ?? "";
    const repetido = await chamar(cliente, "criar_contato", {
      tipo: "pessoa",
      nome: "Ana Souza",
      identificadores: [{ tipo: "email", valor: "ana@acme.invalid", principal: true }],
    });
    expect(repetido.structuredContent?.repetidos).toMatchObject([{ contatoId, nome: "Ana da Acme" }]);
    const lista = await chamar(cliente, "listar_contatos", { texto: "acme" });
    expect(((lista.structuredContent?.contatos ?? []) as { id: string }[]).map((k) => k.id)).toContain(
      contatoId,
    );
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'Ligar para a Ana', $2) returning id",
      [empresas.Um, agentes.Um],
    );
    const tarefaId = t.rows[0]?.id as string;
    const ligou = await chamar(cliente, "ligar_contato", { tarefaId, contatos: [contatoId] });
    expect(ligou.structuredContent).toEqual({ tarefaId, contatos: [contatoId] });
    const ver = await chamar(cliente, "ver_contato", { contatoId });
    expect(ver.structuredContent?.tarefas).toEqual([tarefaId]);
    // Tarefa que não é dele: recusa.
    const alheia = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo) values ($1, 'De outra pessoa') returning id",
      [empresas.Um],
    );
    expect(
      (await chamar(cliente, "ligar_contato", { tarefaId: alheia.rows[0]?.id, contatos: [contatoId] }))
        .isError,
    ).toBe(true);
    await cliente.close();
    const outro = await conectar(chaves.Dois?.chave ?? "");
    expect((await chamar(outro, "ver_contato", { contatoId })).isError).toBe(true);
    expect((await chamar(outro, "listar_contatos", { texto: "acme" })).structuredContent?.contatos).toEqual(
      [],
    );
    await outro.close();
    // As tarefas deste teste saem, para não entrarem na lista dos próximos.
    await dono.query("delete from tarefas where id = any($1::uuid[])", [[tarefaId, alheia.rows[0]?.id]]);
  });

  it("sem chave válida, nem conecta", async () => {
    await expect(conectar("mago_ag_xxxxxxxxxx_".padEnd(62, "A"))).rejects.toThrow();
    await expect(conectar("qualquer")).rejects.toThrow();
  });

  it("faz o ciclo: lista, pega, comenta e entrega, e tudo vai para a auditoria com o agente como ator", async () => {
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'Listar arquivos do Mac', $2) returning id",
      [empresas.Um, agentes.Um],
    );
    const tarefaId = t.rows[0]?.id as string;
    const cliente = await conectar(chaves.Um?.chave ?? "");
    const lista = await chamar(cliente, "minhas_tarefas");
    expect(((lista.structuredContent?.tarefas ?? []) as { id: string }[]).map((x) => x.id)).toEqual([
      tarefaId,
    ]);

    const antes = await chamar(cliente, "entregar_resultado", { tarefaId, resultado: "cedo demais" });
    expect(antes.isError).toBe(true);
    expect(antes.content[0]?.text).toContain("Pegue a tarefa");

    const pegou = await chamar(cliente, "pegar_tarefa", { tarefaId });
    expect(pegou.structuredContent).toMatchObject({
      status: "em_andamento",
      trava: { por: { tipo: "agente" } },
    });
    const comentou = await chamar(cliente, "comentar", { tarefaId, texto: "<script>x</script> começando" });
    expect(comentou.structuredContent).toMatchObject({ autor: { tipo: "agente", agenteId: agentes.Um } });
    const entregou = await chamar(cliente, "entregar_resultado", {
      tarefaId,
      resultado: "12 arquivos encontrados.",
    });
    expect(entregou.structuredContent).toMatchObject({
      status: "concluida",
      resultado: "12 arquivos encontrados.",
      resultadoPor: { tipo: "agente", agenteId: agentes.Um },
      trava: null,
    });
    const vivo = await chamar(cliente, "estou_vivo");
    expect(vivo.structuredContent?.ok).toBe(true);

    const ev = await dono.query<{ acao: string; ator: { tipo: string }; origem: { canal: string } }>(
      "select acao, ator, origem from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [tarefaId],
    );
    expect(ev.rows.map((l) => l.acao)).toEqual(["tarefa.pegou", "tarefa.comentou", "tarefa.mudou_status"]);
    expect(ev.rows.every((l) => l.ator.tipo === "agente" && l.origem.canal === "mcp")).toBe(true);
    // O que o agente externo fez na tarefa vira passo (M4-07), sem raciocínio.
    const passos = await dono.query<{ ferramenta: string; erro: boolean }>(
      "select ferramenta, erro from passos_de_execucao where tarefa_id = $1 and execucao_id is null order by criado_em",
      [tarefaId],
    );
    expect(passos.rows.map((p) => p.ferramenta)).toEqual(
      expect.arrayContaining(["pegar_tarefa", "comentar", "entregar_resultado"]),
    );
    expect(passos.rows.find((p) => p.ferramenta === "entregar_resultado")?.erro).toBe(true);
    await cliente.close();
  });

  it("divide a tarefa em subtarefas e marca o checklist (M3-02), só depois de pegar", async () => {
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'Organizar o backup', $2) returning id",
      [empresas.Um, agentes.Um],
    );
    const tarefaId = t.rows[0]?.id as string;
    const i = await dono.query<{ id: string }>(
      "insert into itens_de_checklist (empresa_id, tarefa_id, texto) values ($1, $2, 'Conferir o disco') returning id",
      [empresas.Um, tarefaId],
    );
    const itemId = i.rows[0]?.id as string;
    const cliente = await conectar(chaves.Um?.chave ?? "");
    const cedo = await chamar(cliente, "criar_subtarefa", { tarefaId, titulo: "Passo 1" });
    expect(cedo.isError).toBe(true);
    expect(cedo.content[0]?.text).toContain("Pegue a tarefa");

    await chamar(cliente, "pegar_tarefa", { tarefaId });
    for (const titulo of ["Listar as pastas", "Copiar", "Conferir"]) {
      const r = await chamar(cliente, "criar_subtarefa", { tarefaId, titulo });
      expect(r.structuredContent).toMatchObject({
        tarefaMaeId: tarefaId,
        responsavel: { tipo: "agente", agenteId: agentes.Um },
        criadaPor: { tipo: "agente", agenteId: agentes.Um },
      });
    }
    const marcou = await chamar(cliente, "marcar_checklist", { tarefaId, itemId, marcado: true });
    expect(marcou.structuredContent).toMatchObject({
      marcado: true,
      marcadoPor: { tipo: "agente", agenteId: agentes.Um },
    });
    const vista = await chamar(cliente, "ver_tarefa", { tarefaId });
    const subtarefas = (vista.structuredContent?.subtarefas ?? []) as { id: string }[];
    expect(subtarefas.length).toBe(3);
    expect(vista.structuredContent?.checklist).toMatchObject([{ id: itemId, marcado: true }]);

    // Subtarefa não tem subtarefas.
    const sub = subtarefas[0]?.id as string;
    await chamar(cliente, "pegar_tarefa", { tarefaId: sub });
    expect((await chamar(cliente, "criar_subtarefa", { tarefaId: sub, titulo: "Neta" })).isError).toBe(true);

    const ev = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [tarefaId],
    );
    expect(ev.rows.map((l) => l.acao)).toEqual([
      "tarefa.pegou",
      "tarefa.criou_subtarefa",
      "tarefa.criou_subtarefa",
      "tarefa.criou_subtarefa",
      "checklist.marcou",
    ]);
    await cliente.close();
  });

  it("minhas_tarefas vem das mais urgentes para as menos (prioridade, depois o prazo)", async () => {
    await dono.query(
      `insert into tarefas (empresa_id, titulo, responsavel_agente_id, prioridade, prazo_dia, prazo_fuso) values
         ($1, 'Z baixa', $2, 'baixa', null, null),
         ($1, 'Y urgente mais tarde', $2, 'urgente', '2026-12-20', 'UTC'),
         ($1, 'X urgente antes', $2, 'urgente', '2026-12-01', 'UTC'),
         ($1, 'W sem prioridade', $2, null, null, null)`,
      [empresas.Dois, agentes.Dois],
    );
    const cliente = await conectar(chaves.Dois?.chave ?? "");
    const lista = await chamar(cliente, "minhas_tarefas");
    expect(((lista.structuredContent?.tarefas ?? []) as { titulo: string }[]).map((t) => t.titulo)).toEqual([
      "X urgente antes",
      "Y urgente mais tarde",
      "Z baixa",
      "W sem prioridade",
    ]);
    await dono.query("delete from tarefas where empresa_id = $1", [empresas.Dois]);
    await cliente.close();
  });

  it("mencionado com @ (M3-05): vê a tarefa e a menção, não vê a nota interna, responde e não pega", async () => {
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo) values ($1, 'Revisar o contrato') returning id",
      [empresas.Um],
    );
    const tarefaId = t.rows[0]?.id as string;
    const c = await dono.query<{ id: string }>(
      "insert into comentarios_de_tarefa (empresa_id, tarefa_id, texto) values ($1, $2, 'Olha isso') returning id",
      [empresas.Um, tarefaId],
    );
    await dono.query(
      "insert into mencoes_de_comentario (empresa_id, comentario_id, tarefa_id, agente_id) values ($1, $2, $3, $4)",
      [empresas.Um, c.rows[0]?.id, tarefaId, agentes.Um],
    );
    await dono.query(
      "insert into comentarios_de_tarefa (empresa_id, tarefa_id, texto, tipo) values ($1, $2, 'Segredo', 'nota_interna')",
      [empresas.Um, tarefaId],
    );
    const cliente = await conectar(chaves.Um?.chave ?? "");
    expect((await chamar(cliente, "minhas_tarefas")).structuredContent?.mencionado).toEqual([tarefaId]);
    const vista = await chamar(cliente, "ver_tarefa", { tarefaId });
    const textos = ((vista.structuredContent?.comentarios ?? []) as { texto: string }[]).map((x) => x.texto);
    expect(textos).toEqual(["Olha isso"]);
    expect((await chamar(cliente, "pegar_tarefa", { tarefaId })).isError).toBe(true);
    expect((await chamar(cliente, "comentar", { tarefaId, texto: "Vi, vou olhar." })).isError).toBeFalsy();
    expect((await chamar(cliente, "minhas_tarefas")).structuredContent?.mencionado).toEqual([]);
    await cliente.close();
  });

  it("a chave de uma empresa não vê nem mexe em tarefa da outra", async () => {
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'Segredo da Um', $2) returning id",
      [empresas.Um, agentes.Um],
    );
    const tarefaId = t.rows[0]?.id as string;
    const daDois = await conectar(chaves.Dois?.chave ?? "");
    expect((await chamar(daDois, "minhas_tarefas")).structuredContent?.tarefas).toEqual([]);
    expect((await chamar(daDois, "ver_tarefa", { tarefaId })).isError).toBe(true);
    expect((await chamar(daDois, "pegar_tarefa", { tarefaId })).isError).toBe(true);
    expect((await chamar(daDois, "comentar", { tarefaId, texto: "oi" })).isError).toBe(true);
    const c = await dono.query("select count(*)::int as n from comentarios_de_tarefa where tarefa_id = $1", [
      tarefaId,
    ]);
    expect(c.rows[0].n).toBe(0);
    await daDois.close();
  });

  it("soltar devolve a tarefa para a pessoa responsável pelo agente, e ela sai da lista dele", async () => {
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'Difícil demais', $2) returning id",
      [empresas.Um, agentes.Um],
    );
    const tarefaId = t.rows[0]?.id as string;
    const cliente = await conectar(chaves.Um?.chave ?? "");
    await chamar(cliente, "pegar_tarefa", { tarefaId });
    const solta = await chamar(cliente, "soltar_tarefa", { tarefaId, motivo: "Não tenho acesso a isso." });
    expect(solta.structuredContent).toMatchObject({
      status: "a_fazer",
      trava: null,
      responsavel: { tipo: "pessoa" },
    });
    const lista = await chamar(cliente, "minhas_tarefas");
    expect(((lista.structuredContent?.tarefas ?? []) as { id: string }[]).map((x) => x.id)).not.toContain(
      tarefaId,
    );
    await cliente.close();
  });

  it("o agente de teste genérico (M2-07) faz o ciclo completo sozinho", async () => {
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'Tarefa para o agente de teste', $2) returning id",
      [empresas.Dois, agentes.Dois],
    );
    const feita = await umaVolta({
      url: `${endereco}/mcp`,
      chave: chaves.Dois?.chave ?? "",
      registrar: () => {},
    });
    expect(feita).toBe(t.rows[0]?.id);
    const r = await dono.query("select status, resultado from tarefas where id = $1", [feita]);
    expect(r.rows[0].status).toBe("concluida");
    expect(r.rows[0].resultado).toContain("Tarefa para o agente de teste");
    expect(
      await umaVolta({ url: `${endereco}/mcp`, chave: chaves.Dois?.chave ?? "", registrar: () => {} }),
    ).toBeNull();
  });

  it("entrada fora do contrato é recusada", async () => {
    const cliente = await conectar(chaves.Um?.chave ?? "");
    expect((await chamar(cliente, "ver_tarefa", { tarefaId: "nao-e-uuid" })).isError).toBe(true);
    expect(
      (await chamar(cliente, "mudar_status", { tarefaId: agentes.Um, status: "concluida" })).isError,
    ).toBe(true);
    await cliente.close();
  });

  it("chave revogada para de valer no pedido seguinte", async () => {
    const cliente = await conectar(chaves.Um?.chave ?? "");
    expect((await chamar(cliente, "estou_vivo")).isError).toBeFalsy();
    await dono.query(
      "update chaves_de_agente set revogada_em = now(), revogada_por = (select responsavel_id from agentes where id = $2) where id = $1",
      [chaves.Um?.id, agentes.Um],
    );
    await expect(chamar(cliente, "estou_vivo")).rejects.toThrow();
  });
});
