/**
 * Conta da própria pessoa (M1-10): meu perfil, minhas empresas e trocar a empresa ativa.
 * Só com a sessão completa (com o 2FA, quando ele vale). A pessoa só mexe nela mesma.
 */
import { conferir, FusoHorario, Idioma, MAXIMO_DO_CONTADOR, Texto } from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Login } from "../acesso/login.ts";
import { origemDoPedido, type SessaoDoPedido, sessaoDoPedido } from "../acesso/rotas.ts";
import { listarAprovacoes } from "../agentes/regras.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisosVisiveis } from "../avisos/index.ts";
import { comPessoa } from "../empresa.ts";

const Nome = Texto(200, "Nome");

export function registrarRotasDaConta(
  app: FastifyInstance,
  login: Login,
  poolAcesso: pg.Pool,
  poolApp: pg.Pool,
): void {
  const exigirCompleta = async (
    pedido: FastifyRequest,
    resposta: FastifyReply,
  ): Promise<SessaoDoPedido | null> => {
    const sessao = await sessaoDoPedido(login, poolAcesso, pedido);
    if (!sessao) {
      resposta.code(401).send({ code: "SEM_SESSAO", message: "Entre no Mago OS para continuar." });
      return null;
    }
    if (!sessao.estado.completa) {
      resposta
        .code(403)
        .send({ code: "DOIS_FATORES_CONFIRMAR", message: "Confirme a autenticação em 2 fatores." });
      return null;
    }
    return sessao;
  };

  const eDono = async (pessoaId: string) =>
    (await poolAcesso.query<{ e: boolean }>("select acesso.e_dono_da_plataforma($1) as e", [pessoaId]))
      .rows[0]?.e === true;

  // Piso de segurança da plataforma (M1-05), só para o Dono: as funções do banco conferem de novo.
  app.get("/plataforma/regras", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    if (!(await eDono(sessao.pessoa.id)))
      return resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Só o Dono da plataforma." });
    const r = await poolAcesso.query<{ exigir_passkey_administradores: boolean }>(
      "select * from acesso.regras_da_plataforma_para($1)",
      [sessao.pessoa.id],
    );
    return { exigirPasskeyAdministradores: r.rows[0]?.exigir_passkey_administradores ?? false };
  });

  app.put("/plataforma/regras", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const valor = (pedido.body as { exigirPasskeyAdministradores?: unknown } | undefined)
      ?.exigirPasskeyAdministradores;
    if (typeof valor !== "boolean") return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
    if (!(await eDono(sessao.pessoa.id)))
      return resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Só o Dono da plataforma." });
    await poolAcesso.query("select acesso.mudar_regras_da_plataforma($1, $2)", [sessao.pessoa.id, valor]);
    await auditar(
      poolAcesso,
      {
        empresaId: null,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "plataforma.alterou_regras",
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { exigirPasskeyAdministradores: valor },
      },
      pedido.log,
    );
    return { ok: true };
  });

  app.get("/conta/perfil", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const r = await poolAcesso.query<{
      nome: string;
      email: string;
      foto: string | null;
      idioma: string;
      fuso_horario: string;
    }>("select nome, email, foto, idioma, fuso_horario from pessoas where id = $1", [sessao.pessoa.id]);
    const p = r.rows[0];
    const tem = await poolAcesso.query<{ senha: boolean; google: boolean }>(
      `select exists (select 1 from acesso.credenciais where pessoa_id = $1 and provedor = 'credential' and senha is not null) as senha,
              exists (select 1 from acesso.credenciais where pessoa_id = $1 and provedor = 'google') as google`,
      [sessao.pessoa.id],
    );
    return {
      nome: p?.nome,
      email: p?.email,
      foto: p?.foto ?? null,
      idioma: p?.idioma,
      fusoHorario: p?.fuso_horario,
      temSenha: tem.rows[0]?.senha ?? false,
      googleLigado: tem.rows[0]?.google ?? false,
      doisFatores: sessao.estado.dois,
      donoDaPlataforma: await eDono(sessao.pessoa.id),
    };
  });

  app.put("/conta/perfil", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const corpo = (pedido.body ?? {}) as { nome?: unknown; idioma?: unknown; fusoHorario?: unknown };
    const problemas = [
      ...(conferir(Nome, typeof corpo.nome === "string" ? corpo.nome.trim() : corpo.nome).ok ? [] : ["nome"]),
      ...(conferir(Idioma, corpo.idioma).ok ? [] : ["idioma"]),
      ...(conferir(FusoHorario, corpo.fusoHorario).ok ? [] : ["fusoHorario"]),
    ];
    if (problemas.length > 0) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", campos: problemas });
    await poolAcesso.query(
      "update pessoas set nome = $2, idioma = $3, fuso_horario = $4, atualizada_em = now() where id = $1",
      [sessao.pessoa.id, String(corpo.nome).trim(), corpo.idioma, corpo.fusoHorario],
    );
    await auditar(
      poolAcesso,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "pessoa.alterou",
        alvo: { tipo: "pessoa", id: sessao.pessoa.id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { campos: ["nome", "idioma", "fusoHorario"] },
      },
      pedido.log,
    );
    return { ok: true };
  });

  // Empresas onde a pessoa tem vínculo ativo (o banco só mostra essas), para o seletor no topo. Com cada uma, o que
  // está esperando nela (M7-05): os avisos não lidos que ela ainda vê e as aprovações pendentes que ela pode decidir,
  // contados empresa por empresa, com a pessoa e o vínculo dela em cada uma.
  const minhasEmpresas = (pessoaId: string) =>
    comPessoa(poolApp, pessoaId, null, async (c) => {
      const r = await c.query<{ id: string; nome: string; perfil: string; area: string | null }>(
        `select e.id, e.nome, v.perfil, v.area from empresas e
           join vinculos v on v.empresa_id = e.id and v.pessoa_id = $1 and v.situacao = 'ativo'
          where e.situacao = 'ativa' order by e.nome`,
        [pessoaId],
      );
      return r.rows;
    });
  const LIMITE = MAXIMO_DO_CONTADOR + 1;

  app.get("/conta/empresas", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const empresas = await minhasEmpresas(sessao.pessoa.id);
    const comNumeros = [];
    for (const e of empresas) {
      const numeros = await comPessoa(poolApp, sessao.pessoa.id, e.id, async (c) => ({
        avisos: (await avisosVisiveis(c, sessao.pessoa.id, LIMITE)).length,
        aprovacoes: Math.min(
          LIMITE,
          (await listarAprovacoes(c, sessao.pessoa.id, e.perfil === "administrador", "pendente")).length,
        ),
      })).catch(() => ({ avisos: 0, aprovacoes: 0 }));
      comNumeros.push({ ...e, ativa: e.id === sessao.empresaId, ...numeros });
    }
    return comNumeros;
  });

  // Os avisos não lidos de todas as empresas da pessoa (o sino em "Todas as empresas", M7-05), com o nome de cada uma.
  app.get("/conta/avisos", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const empresas = await minhasEmpresas(sessao.pessoa.id);
    const todos = [];
    for (const e of empresas) {
      const avisos = await comPessoa(poolApp, sessao.pessoa.id, e.id, (c) =>
        avisosVisiveis(c, sessao.pessoa.id),
      );
      for (const aviso of avisos) todos.push({ aviso, empresaNome: e.nome });
    }
    todos.sort((a, b) => b.aviso.criadoEm.localeCompare(a.aviso.criadoEm));
    return { avisos: todos.slice(0, 50) };
  });

  app.post("/conta/empresa-ativa", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const empresaId = (pedido.body as { empresaId?: unknown } | undefined)?.empresaId;
    if (typeof empresaId !== "string" || !/^[0-9a-f-]{36}$/i.test(empresaId)) {
      return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
    }
    // O próprio banco confere: empresa_ativa() só devolve a empresa se a pessoa tiver vínculo ativo nela.
    const pode = await comPessoa(poolApp, sessao.pessoa.id, empresaId, async (c) => {
      const r = await c.query<{ e: string | null }>("select empresa_ativa() as e");
      return r.rows[0]?.e === empresaId;
    });
    if (!pode)
      return resposta.code(403).send({ code: "SEM_VINCULO", message: "Você não tem acesso a essa empresa." });
    await poolAcesso.query("update acesso.sessoes set empresa_id = $2 where id = $1", [
      sessao.sessaoId,
      empresaId,
    ]);
    await auditar(
      poolAcesso,
      {
        empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "empresa.trocou_ativa",
        alvo: { tipo: "empresa", id: empresaId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
      },
      pedido.log,
    );
    return { ok: true };
  });
}
