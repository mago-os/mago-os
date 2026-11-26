/**
 * Webhooks de saída (M7-03, decisão 0048), com a API inteira montada e o envio falso: o aviso assinado com a hora e o
 * número único, só os eventos escolhidos, a nota interna fora, a nova tentativa com o mesmo número, o desligamento
 * depois de 3 dias com aviso ao administrador, o teste, e que uma empresa nunca recebe evento de outra.
 */
import { createHmac } from "node:crypto";
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { modelosFalsos } from "@mago-os/nucleo/contas-de-ia";
import { cuidarDosWebhooks } from "@mago-os/nucleo/webhooks";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";
import { type ApiDeTeste, montarApiDeTeste, SITE } from "./vazamento/montar-api.ts";

const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("webhooks de saída", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let api: ApiDeTeste;
  let ip = 0;
  const E: Record<string, string> = {};
  const P: Record<string, { id: string; cookie: string }> = {};
  const W: Record<string, { id: string; segredo: string }> = {};

  async function criarPessoa(empresaId: string, rotulo: string, perfil: string) {
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
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, 'ativo', now(), now())`,
      [empresaId, id, perfil],
    );
    ip += 1;
    const r = await api.app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.73.${ip}` },
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

  const naTela = (metodo: "GET" | "POST" | "DELETE", url: string, cookie: string, corpo?: unknown) =>
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

  const entregar = () => cuidarDosWebhooks(api.interno.webhooks as NonNullable<typeof api.interno.webhooks>);

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    api = await montarApiDeTeste(banco, { modelos: modelosFalsos([]) });
    for (const sigla of ["A", "B"]) {
      const e = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
        `Empresa ${sigla}`,
      ]);
      E[sigla] = e.rows[0]?.id as string;
      P[`admin${sigla}`] = await criarPessoa(
        E[sigla] as string,
        `wh-admin-${sigla.toLowerCase()}`,
        "administrador",
      );
    }
    P.func = await criarPessoa(E.A as string, "wh-func-a", "funcionario");
  }, 120_000);

  afterAll(async () => {
    await api?.fechar();
    await dono?.end();
    await banco?.apagar();
  });

  it("só o administrador cadastra; endereço de rede interna é recusado; o segredo vem uma vez", async () => {
    expect((await naTela("GET", "/empresa/webhooks", P.func?.cookie ?? "")).statusCode).toBe(403);
    const interno = await naTela("POST", "/empresa/webhooks", P.adminA?.cookie ?? "", {
      nome: "rede interna",
      url: "https://10.0.0.5/x",
      eventos: ["tarefa.criada"],
    });
    expect(interno.statusCode).toBe(400);
    for (const sigla of ["A", "B"]) {
      const r = await naTela("POST", "/empresa/webhooks", P[`admin${sigla}`]?.cookie ?? "", {
        nome: `n8n ${sigla}`,
        url: `https://n8n-${sigla.toLowerCase()}.exemplo.com.br/webhook/mago`,
        eventos: ["tarefa.criada", "tarefa.concluida", "tarefa.comentada", "contato.criado"],
      });
      expect(r.statusCode, r.body).toBe(201);
      W[sigla] = { id: r.json().webhook.id, segredo: r.json().segredo };
      expect(W[sigla]?.segredo).toMatch(/^whsec_/);
    }
    const lista = (await naTela("GET", "/empresa/webhooks", P.adminA?.cookie ?? "")).json();
    expect(JSON.stringify(lista)).not.toContain(W.A?.segredo);
  });

  it("o aviso sai assinado, com o número único, só para a empresa da mudança e só os eventos escolhidos", async () => {
    api.webhooks.length = 0;
    const t = await naTela("POST", "/tarefas", P.adminA?.cookie ?? "", { titulo: "Proposta" });
    const tarefaId = t.json().id as string;
    await naTela("POST", `/tarefas/${tarefaId}/comentarios`, P.adminA?.cookie ?? "", { texto: "Oi" });
    await naTela("POST", `/tarefas/${tarefaId}/comentarios`, P.adminA?.cookie ?? "", {
      texto: "Só da equipe",
      interna: true,
    });
    const concluiu = await naTela("POST", `/tarefas/${tarefaId}/status`, P.adminA?.cookie ?? "", {
      status: "concluida",
    });
    expect(concluiu.statusCode, concluiu.body).toBe(200);
    await naTela("POST", "/contatos", P.adminA?.cookie ?? "", { tipo: "pessoa", nome: "Beatriz" });
    await entregar();
    const eventos = api.webhooks.map((w) => w.cabecalhos["mago-evento"]);
    expect(eventos.sort()).toEqual([
      "contato.criado",
      "tarefa.comentada",
      "tarefa.concluida",
      "tarefa.criada",
    ]);
    expect(api.webhooks.every((w) => w.url.includes("n8n-a."))).toBe(true);
    for (const w of api.webhooks) {
      const [t1, v1] = (w.cabecalhos["mago-assinatura"] ?? "").split(",");
      const segundos = t1?.slice(2) ?? "";
      const esperado = createHmac("sha256", W.A?.segredo ?? "")
        .update(`${segundos}.${w.corpo}`)
        .digest("hex");
      expect(v1).toBe(`v1=${esperado}`);
      const corpo = JSON.parse(w.corpo);
      expect(corpo.id).toBe(w.cabecalhos["mago-entrega"]);
      expect(corpo.empresaId).toBe(E.A);
      // Só ids: nunca o título nem o texto do comentário.
      expect(w.corpo).not.toContain("Proposta");
      expect(w.corpo).not.toContain("Oi");
    }
  });

  it("falhou: tenta de novo mais tarde com o mesmo número; 3 dias falhando desliga e avisa o administrador", async () => {
    api.webhooks.length = 0;
    api.respostaDosWebhooks.codigo = 500;
    await naTela("POST", "/tarefas", P.adminA?.cookie ?? "", { titulo: "Outra" });
    await entregar();
    expect(api.webhooks).toHaveLength(1);
    const entregaId = api.webhooks[0]?.cabecalhos["mago-entrega"] as string;
    const e = await dono.query<{ situacao: string; tentativas: number; adiante: boolean }>(
      "select situacao, tentativas, proxima_em > now() as adiante from entregas_de_webhook where id = $1",
      [entregaId],
    );
    expect(e.rows[0]).toMatchObject({ situacao: "falhou", tentativas: 1, adiante: true });
    // Tentar de novo pela tela: o mesmo número.
    api.respostaDosWebhooks.codigo = 200;
    const r = await naTela(
      "POST",
      `/empresa/webhooks/${W.A?.id}/entregas/${entregaId}/reenviar`,
      P.adminA?.cookie ?? "",
      {},
    );
    expect(r.statusCode).toBe(202);
    await entregar();
    expect(api.webhooks[1]?.cabecalhos["mago-entrega"]).toBe(entregaId);
    const historico = (
      await naTela("GET", `/empresa/webhooks/${W.A?.id}/entregas`, P.adminA?.cookie ?? "")
    ).json();
    expect(historico.entregas.find((x: { id: string }) => x.id === entregaId)).toMatchObject({
      situacao: "entregue",
      tentativas: 2,
      ultimoCodigo: 200,
    });
    // 3 dias sem acertar: desliga e avisa.
    await dono.query("update webhooks set falhando_desde = now() - interval '4 days' where id = $1", [
      W.A?.id,
    ]);
    await entregar();
    const w = await dono.query<{ situacao: string; desligado_porque: string }>(
      "select situacao, desligado_porque from webhooks where id = $1",
      [W.A?.id],
    );
    expect(w.rows[0]).toEqual({ situacao: "desligado", desligado_porque: "falhas" });
    const aviso = await dono.query(
      "select 1 from avisos where pessoa_id = $1 and tipo = 'webhook_desligado'",
      [P.adminA?.id],
    );
    expect(aviso.rowCount).toBe(1);
    // Desligado: a mudança não gera aviso. Ligar de novo zera a contagem.
    api.webhooks.length = 0;
    await naTela("POST", "/tarefas", P.adminA?.cookie ?? "", { titulo: "Desligado" });
    await entregar();
    expect(api.webhooks).toHaveLength(0);
    const ligou = await naTela("POST", `/empresa/webhooks/${W.A?.id}`, P.adminA?.cookie ?? "", {
      situacao: "ligado",
    });
    expect(ligou.json()).toMatchObject({ situacao: "ligado", desligadoPorque: null, falhandoDesde: null });
  });

  it("mandar teste e trocar o segredo", async () => {
    api.webhooks.length = 0;
    expect(
      (await naTela("POST", `/empresa/webhooks/${W.A?.id}/teste`, P.adminA?.cookie ?? "", {})).statusCode,
    ).toBe(202);
    await entregar();
    expect(api.webhooks.map((w) => w.cabecalhos["mago-evento"])).toEqual(["webhook.teste"]);
    const troca = await naTela(
      "POST",
      `/empresa/webhooks/${W.A?.id}/trocar-segredo`,
      P.adminA?.cookie ?? "",
      {},
    );
    expect(troca.statusCode).toBe(201);
    expect(troca.json().segredo).not.toBe(W.A?.segredo);
  });

  it("a empresa B não vê nem mexe no webhook da A", async () => {
    const b = P.adminB?.cookie ?? "";
    expect((await naTela("GET", `/empresa/webhooks/${W.A?.id}/entregas`, b)).statusCode).toBe(404);
    expect((await naTela("POST", `/empresa/webhooks/${W.A?.id}/teste`, b, {})).statusCode).toBe(404);
    expect((await naTela("DELETE", `/empresa/webhooks/${W.A?.id}`, b)).statusCode).toBe(404);
    const daB = (await naTela("GET", "/empresa/webhooks", b)).json().webhooks as { id: string }[];
    expect(daB.map((w) => w.id)).toEqual([W.B?.id]);
  });

  it("aviso imediato ao agente externo (M7-04): tarefa recebida e menção vão só para o endereço dele", async () => {
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Hermes', $2) returning id",
      [E.A, P.adminA?.id],
    );
    const agenteId = a.rows[0]?.id as string;
    const ligou = await naTela("POST", `/agentes/${agenteId}/aviso`, P.adminA?.cookie ?? "", {
      url: "https://hermes.exemplo.com.br/mago",
    });
    expect(ligou.statusCode, ligou.body).toBe(201);
    const segredo = ligou.json().segredo as string;
    // Não aparece na tela Webhooks.
    const daEmpresa = (await naTela("GET", "/empresa/webhooks", P.adminA?.cookie ?? "")).json().webhooks as {
      id: string;
    }[];
    expect(daEmpresa.map((w) => w.id)).not.toContain(ligou.json().aviso.webhookId);
    api.webhooks.length = 0;
    const t = await naTela("POST", "/tarefas", P.adminA?.cookie ?? "", {
      titulo: "Para o Hermes",
      responsavel: { tipo: "agente", agenteId },
    });
    expect(t.statusCode, t.body).toBe(201);
    await naTela("POST", `/tarefas/${t.json().id}/comentarios`, P.adminA?.cookie ?? "", {
      texto: "@Hermes olha isso",
      mencoes: [{ tipo: "agente", agenteId }],
    });
    await entregar();
    const doHermes = api.webhooks.filter((w) => w.url.includes("hermes."));
    expect(doHermes.map((w) => w.cabecalhos["mago-evento"]).sort()).toEqual([
      "agente.mencionado",
      "agente.tarefa_recebida",
    ]);
    for (const w of doHermes) {
      const [t1, v1] = (w.cabecalhos["mago-assinatura"] ?? "").split(",");
      const esperado = createHmac("sha256", segredo)
        .update(`${t1?.slice(2)}.${w.corpo}`)
        .digest("hex");
      expect(v1).toBe(`v1=${esperado}`);
      expect(JSON.parse(w.corpo).dados.agenteId).toBe(agenteId);
    }
    // O webhook da empresa nunca recebe os eventos do agente.
    expect(
      api.webhooks
        .filter((w) => !w.url.includes("hermes."))
        .some((w) => w.cabecalhos["mago-evento"]?.startsWith("agente.")),
    ).toBe(false);
    // A empresa B não alcança o aviso do agente da A.
    expect((await naTela("GET", `/agentes/${agenteId}/aviso`, P.adminB?.cookie ?? "")).statusCode).toBe(404);
    // Desligado: volta a só perguntar.
    expect((await naTela("DELETE", `/agentes/${agenteId}/aviso`, P.adminA?.cookie ?? "")).statusCode).toBe(
      200,
    );
    api.webhooks.length = 0;
    await naTela("POST", "/tarefas", P.adminA?.cookie ?? "", {
      titulo: "Outra",
      responsavel: { tipo: "agente", agenteId },
    });
    await entregar();
    expect(api.webhooks.filter((w) => w.url.includes("hermes."))).toHaveLength(0);
  });
});
