/**
 * Rotas do login na API: tudo em /acesso/* vai para o Better Auth (na VPS, /api/acesso/*).
 * Antes de conferir a senha, olha a trava do e-mail; depois, conta o erro ou zera a contagem.
 */
import { normalizarEmail } from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { auditar, type DadosDoEvento } from "../auditoria/registrar.ts";
import { nomeDoAparelho, sessaoAindaVale } from "./aparelhos.ts";
import {
  ACOES_PERIGOSAS,
  CAMINHOS_QUE_CONFIRMAM,
  type EstadoDaSessao,
  estadoDaSessao,
  type MetodoDoSegundoFator,
  marcarConfirmacao,
  podeFazerAcaoPerigosa,
  situacaoDosDoisFatores,
} from "./dois-fatores.ts";
import type { Login } from "./login.ts";
import { registrarAcerto, registrarFalha, travadoAte } from "./trava.ts";

/**
 * Monta o pedido no formato que o Better Auth entende. O Caddy tira o /api do caminho antes de chegar aqui;
 * o Better Auth espera o endereço público completo (https://site/api/acesso/...), então ele volta.
 */
function paraRequest(pedido: FastifyRequest, baseURL: string): Request {
  const url = new URL(`${baseURL}/api${pedido.url}`);
  const cabecalhos = new Headers();
  for (const [nome, valor] of Object.entries(pedido.headers)) {
    if (valor === undefined) continue;
    cabecalhos.set(nome, Array.isArray(valor) ? valor.join(", ") : String(valor));
  }
  const temCorpo = pedido.method !== "GET" && pedido.method !== "HEAD" && pedido.body !== undefined;
  return new Request(url, {
    method: pedido.method,
    headers: cabecalhos,
    ...(temCorpo ? { body: JSON.stringify(pedido.body) } : {}),
  });
}

function emailDoPedido(pedido: FastifyRequest): string | null {
  const corpo = pedido.body as { email?: unknown } | undefined;
  return typeof corpo?.email === "string" ? normalizarEmail(corpo.email) : null;
}

/** De onde veio o pedido, para a auditoria. */
export function origemDoPedido(pedido: FastifyRequest): DadosDoEvento["origem"] {
  const encaminhado = pedido.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(encaminhado) ? encaminhado[0] : encaminhado)?.split(",")[0]?.trim() || pedido.ip || null;
  return { canal: "painel", ip, aparelho: nomeDoAparelho(pedido.headers["user-agent"]) };
}

export interface SessaoDoPedido {
  sessaoId: string;
  pessoa: { id: string; nome: string; email: string };
  empresaId: string | null;
  aparelhoId: string | null;
  metodo: MetodoDoSegundoFator | null;
  estado: EstadoDaSessao;
}

/** Quem está pedindo, e se a sessão já pode ver dados (2FA). Nulo sem sessão. */
export async function sessaoDoPedido(
  login: Login,
  pool: pg.Pool,
  pedido: FastifyRequest,
): Promise<SessaoDoPedido | null> {
  const baseURL = String(login.options.baseURL);
  const dados = await login.api.getSession({ headers: paraRequest(pedido, baseURL).headers });
  if (!dados) return null;
  const sessao = dados.session as typeof dados.session & {
    empresaId?: string | null;
    doisFatoresEm?: Date | string | null;
    doisFatoresMetodo?: MetodoDoSegundoFator | null;
    aparelhoId?: string | null;
  };
  // Regras do Mago OS por cima do Better Auth: inatividade, máximo de 30 dias e o registro do último uso.
  if (!(await sessaoAindaVale(pool, sessao.id))) return null;
  const dois = await situacaoDosDoisFatores(pool, dados.user.id);
  const confirmadoEm = sessao.doisFatoresEm ? new Date(sessao.doisFatoresEm) : null;
  return {
    sessaoId: sessao.id,
    pessoa: { id: dados.user.id, nome: dados.user.name, email: dados.user.email },
    empresaId: sessao.empresaId ?? null,
    aparelhoId: sessao.aparelhoId ?? null,
    metodo: sessao.doisFatoresMetodo ?? null,
    estado: estadoDaSessao(dois, confirmadoEm, sessao.doisFatoresMetodo ?? null),
  };
}

/**
 * Proteção para as rotas de dados: sem sessão, 401; sessão que ainda precisa do 2FA, 403.
 * Toda rota que mostra ou muda dados de empresa usa esta verificação (M1-06 em diante).
 */
export function exigirSessaoCompleta(login: Login, pool: pg.Pool) {
  return async (pedido: FastifyRequest, resposta: FastifyReply) => {
    const sessao = await sessaoDoPedido(login, pool, pedido);
    if (!sessao)
      return resposta.code(401).send({ code: "SEM_SESSAO", message: "Entre no Mago OS para continuar." });
    if (!sessao.estado.completa) {
      return resposta.code(403).send({
        code: sessao.estado.falta === "ativar" ? "DOIS_FATORES_ATIVAR" : "DOIS_FATORES_CONFIRMAR",
        message:
          sessao.estado.falta === "ativar"
            ? "Ative a autenticação em 2 fatores para continuar."
            : "Confirme com o código do app ou com a passkey para continuar.",
      });
    }
    (pedido as FastifyRequest & { sessao?: SessaoDoPedido }).sessao = sessao;
  };
}

export function registrarRotasDoLogin(app: FastifyInstance, login: Login, pool: pg.Pool): void {
  const baseURL = String(login.options.baseURL);

  // Estado do acesso para a tela: quem está conectado e o que falta do 2FA.
  app.get("/acesso/estado", async (pedido) => {
    const sessao = await sessaoDoPedido(login, pool, pedido);
    if (!sessao) return null;
    const { estado } = sessao;
    return {
      pessoa: sessao.pessoa,
      empresaId: sessao.empresaId,
      doisFatores: {
        obrigatorio: estado.dois.obrigatorio,
        appAutenticador: estado.dois.appAutenticador,
        passkeys: estado.dois.passkeys,
        exigePasskey: estado.dois.exigePasskey,
        precisa: estado.precisa,
        confirmadoEm: estado.confirmadoEm,
      },
      completa: estado.completa,
      falta: estado.falta,
    };
  });

  // Meus aparelhos (M1-08): só com a sessão completa (com o 2FA, quando ele vale).
  const exigirCompleta = async (pedido: FastifyRequest, resposta: FastifyReply) => {
    const sessao = await sessaoDoPedido(login, pool, pedido);
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

  app.get("/acesso/aparelhos", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const r = await pool.query<{
      id: string;
      aparelho: string | null;
      ip: string | null;
      entrou_em: Date;
      ultimo_uso_em: Date;
    }>(
      `select s.id, a.nome as aparelho, s.ip, s.criada_em as entrou_em, s.ultimo_uso_em
         from acesso.sessoes s left join acesso.aparelhos a on a.id = s.aparelho_id
        where s.pessoa_id = $1 and s.expira_em > now()
        order by s.ultimo_uso_em desc`,
      [sessao.pessoa.id],
    );
    return r.rows.map((l) => ({
      sessaoId: l.id,
      aparelho: l.aparelho ?? "Aparelho desconhecido",
      ip: l.ip,
      entrouEm: l.entrou_em,
      ultimoUsoEm: l.ultimo_uso_em,
      esteAparelho: l.id === sessao.sessaoId,
    }));
  });

  app.post("/acesso/aparelhos/desconectar", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const sessaoId = (pedido.body as { sessaoId?: unknown } | undefined)?.sessaoId;
    if (typeof sessaoId !== "string") return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
    // Só as sessões da própria pessoa: a de outra pessoa simplesmente não é encontrada.
    const r = await pool
      .query("delete from acesso.sessoes where id = $1 and pessoa_id = $2", [sessaoId, sessao.pessoa.id])
      .catch(() => ({ rowCount: 0 }));
    if (r.rowCount === 0) return resposta.code(404).send({ code: "SESSAO_NAO_ENCONTRADA" });
    pedido.log.info({ evento: "sessao.encerrou", motivo: "desconectado" }, "Aparelho desconectado");
    await auditar(
      pool,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "sessao.encerrou",
        alvo: { tipo: "sessao", id: sessaoId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { motivo: "desconectado" },
      },
      pedido.log,
    );
    return { ok: true };
  });

  app.post("/acesso/aparelhos/desconectar-outros", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const r = await pool.query("delete from acesso.sessoes where pessoa_id = $1 and id <> $2", [
      sessao.pessoa.id,
      sessao.sessaoId,
    ]);
    pedido.log.info(
      { evento: "sessao.encerrou", motivo: "outros", quantos: r.rowCount },
      "Outros aparelhos desconectados",
    );
    await auditar(
      pool,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "sessao.encerrou",
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { motivo: "outros_aparelhos", quantos: r.rowCount ?? 0 },
      },
      pedido.log,
    );
    return { ok: true, desconectados: r.rowCount };
  });

  // Avisos de aparelho novo: mostrados nos outros aparelhos (o próprio aparelho novo não se avisa).
  app.get("/acesso/avisos", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const r = await pool.query<{ id: string; aparelho_nome: string; ip: string | null; criado_em: Date }>(
      `select id, aparelho_nome, ip, criado_em from acesso.avisos
        where pessoa_id = $1 and respondido_em is null and aparelho_id is distinct from $2
        order by criado_em desc`,
      [sessao.pessoa.id, sessao.aparelhoId],
    );
    return r.rows.map((l) => ({
      avisoId: l.id,
      tipo: "aparelho_novo",
      aparelho: l.aparelho_nome,
      ip: l.ip,
      em: l.criado_em,
    }));
  });

  app.post("/acesso/avisos/responder", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const corpo = pedido.body as { avisoId?: unknown; resposta?: unknown } | undefined;
    if (
      typeof corpo?.avisoId !== "string" ||
      (corpo.resposta !== "foi_eu" && corpo.resposta !== "nao_fui_eu")
    ) {
      return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
    }
    const aviso = await pool
      .query<{ aparelho_id: string | null }>(
        `update acesso.avisos set respondido_em = now(), resposta = $3
          where id = $1 and pessoa_id = $2 and respondido_em is null returning aparelho_id`,
        [corpo.avisoId, sessao.pessoa.id, corpo.resposta],
      )
      .catch(() => ({ rows: [] as { aparelho_id: string | null }[] }));
    const linha = aviso.rows[0];
    if (!linha) return resposta.code(404).send({ code: "AVISO_NAO_ENCONTRADO" });
    if (corpo.resposta === "nao_fui_eu" && linha.aparelho_id) {
      // Desconecta o aparelho e esquece ele: se alguém voltar a entrar por lá, o aviso aparece de novo.
      await pool.query("delete from acesso.sessoes where aparelho_id = $1", [linha.aparelho_id]);
      await pool.query("delete from acesso.aparelhos where id = $1", [linha.aparelho_id]);
      pedido.log.warn(
        { evento: "sessao.encerrou", motivo: "nao_fui_eu" },
        "Acesso não reconhecido desconectado",
      );
      await auditar(
        pool,
        {
          empresaId: sessao.empresaId,
          ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
          acao: "sessao.encerrou",
          alvo: { tipo: "aparelho", id: linha.aparelho_id },
          origem: origemDoPedido(pedido),
          rastreio: pedido.id,
          detalhes: { motivo: "nao_fui_eu" },
        },
        pedido.log,
      );
      return {
        ok: true,
        mensagem: "Desconectamos esse aparelho. Por segurança, troque a sua senha agora.",
      };
    }
    return { ok: true };
  });

  app.route({
    method: ["GET", "POST"],
    url: "/acesso/*",
    async handler(pedido, resposta) {
      const caminho = (pedido.url.split("?")[0] ?? "").replace(/^\/acesso/, "");
      const origem = origemDoPedido(pedido);
      const saindo = pedido.method === "POST" && caminho.startsWith("/sign-out");
      const quemSai = saindo ? await sessaoDoPedido(login, pool, pedido) : null;
      const entrando = pedido.method === "POST" && caminho === "/sign-in/email";

      // Ações perigosas (trocar senha, mexer no 2FA ou nas passkeys) pedem o segundo fator recente.
      // Código certo, código de recuperação ou passkey cadastrada na hora (o aparelho conferiu o dedo ou o rosto)
      // numa sessão já aberta: a sessão fica confirmada. A entrada com passkey cria sessão nova já confirmada.
      const confirmandoCodigo =
        CAMINHOS_QUE_CONFIRMAM.has(caminho) && caminho !== "/passkey/verify-authentication";
      const sessao =
        pedido.method === "POST" && (ACOES_PERIGOSAS.has(caminho) || confirmandoCodigo)
          ? await sessaoDoPedido(login, pool, pedido)
          : null;
      if (sessao && ACOES_PERIGOSAS.has(caminho)) {
        const { dois, confirmadoEm } = sessao.estado;
        if (caminho === "/two-factor/disable" && dois.obrigatorio) {
          return resposta.code(403).send({
            code: "DOIS_FATORES_OBRIGATORIO",
            message: "Para o seu perfil, a autenticação em 2 fatores é obrigatória e não pode ser desligada.",
          });
        }
        if (
          caminho === "/passkey/delete-passkey" &&
          dois.obrigatorio &&
          !dois.appAutenticador &&
          dois.passkeys <= 1
        ) {
          return resposta.code(403).send({
            code: "DOIS_FATORES_OBRIGATORIO",
            message: dois.exigePasskey
              ? "Essa é a sua única passkey. Cadastre outra antes de apagar esta."
              : "Essa é a sua única forma de 2FA. Ative o app autenticador antes de apagar a passkey.",
          });
        }
        if (!podeFazerAcaoPerigosa(dois, confirmadoEm, sessao.metodo)) {
          return resposta.code(403).send({
            code: "CONFIRMACAO_NECESSARIA",
            message: "Por segurança, confirme com o código do app ou com a passkey antes de continuar.",
          });
        }
      }
      const email = entrando ? emailDoPedido(pedido) : null;

      if (email !== null) {
        const ate = await travadoAte(pool, email);
        if (ate !== null) {
          const minutos = Math.max(1, Math.ceil((ate.getTime() - Date.now()) / 60_000));
          pedido.log.warn({ evento: "acesso.travou" }, "Tentativa num e-mail travado");
          return resposta.code(429).send({
            code: "ACESSO_TRAVADO",
            message: `Muitas tentativas erradas. Tente de novo em ${minutos} minuto${minutos === 1 ? "" : "s"}.`,
          });
        }
      }

      const respostaDoLogin = await login.handler(paraRequest(pedido, baseURL));

      if (email !== null) {
        if (respostaDoLogin.status === 401) {
          const travou = await registrarFalha(pool, email);
          pedido.log.warn({ evento: travou ? "acesso.travou" : "acesso.falhou" }, "Senha errada no login");
          await auditar(
            pool,
            {
              empresaId: null,
              ator: { tipo: "sistema", servico: "login" },
              acao: travou ? "acesso.travou" : "acesso.falhou",
              origem,
              rastreio: pedido.id,
              detalhes: { email },
            },
            pedido.log,
          );
        } else if (respostaDoLogin.ok) {
          await registrarAcerto(pool, email);
          pedido.log.info({ evento: "acesso.entrou" }, "Pessoa entrou");
        }
      }
      // Código certo numa sessão já aberta (ativar o app, ou confirmar depois do Google): a sessão fica confirmada.
      if (sessao && confirmandoCodigo && respostaDoLogin.ok) {
        const metodo = CAMINHOS_QUE_CONFIRMAM.get(caminho) ?? "app";
        await marcarConfirmacao(pool, sessao.sessaoId, metodo);
        pedido.log.info({ evento: "dois_fatores.verificou" }, "Segundo fator confirmado");
        await auditar(
          pool,
          {
            empresaId: sessao.empresaId,
            ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
            acao:
              caminho === "/passkey/verify-registration" ? "dois_fatores.ativou" : "dois_fatores.verificou",
            origem,
            rastreio: pedido.id,
            detalhes: { metodo },
          },
          pedido.log,
        );
      }
      if (quemSai && respostaDoLogin.ok) {
        await auditar(
          pool,
          {
            empresaId: quemSai.empresaId,
            ator: { tipo: "pessoa", pessoaId: quemSai.pessoa.id },
            acao: "acesso.saiu",
            alvo: { tipo: "sessao", id: quemSai.sessaoId },
            origem,
            rastreio: pedido.id,
          },
          pedido.log,
        );
      }
      if (caminho.startsWith("/sign-out") && respostaDoLogin.ok) {
        pedido.log.info({ evento: "acesso.saiu" }, "Pessoa saiu");
      }

      resposta.code(respostaDoLogin.status);
      for (const [nome, valor] of respostaDoLogin.headers) {
        if (nome.toLowerCase() === "set-cookie") continue;
        resposta.header(nome, valor);
      }
      const cookies = respostaDoLogin.headers.getSetCookie();
      if (cookies.length > 0) resposta.header("set-cookie", cookies);
      return resposta.send(
        respostaDoLogin.body === null ? null : Buffer.from(await respostaDoLogin.arrayBuffer()),
      );
    },
  });
}
