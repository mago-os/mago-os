/**
 * Rotas do login na API: tudo em /acesso/* vai para o Better Auth (na VPS, /api/acesso/*).
 * Antes de conferir a senha, olha a trava do e-mail; depois, conta o erro ou zera a contagem.
 */
import { normalizarEmail } from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
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

export interface SessaoDoPedido {
  sessaoId: string;
  pessoa: { id: string; nome: string; email: string };
  empresaId: string | null;
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
  };
  const dois = await situacaoDosDoisFatores(pool, dados.user.id);
  const confirmadoEm = sessao.doisFatoresEm ? new Date(sessao.doisFatoresEm) : null;
  return {
    sessaoId: sessao.id,
    pessoa: { id: dados.user.id, nome: dados.user.name, email: dados.user.email },
    empresaId: sessao.empresaId ?? null,
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

  app.route({
    method: ["GET", "POST"],
    url: "/acesso/*",
    async handler(pedido, resposta) {
      const caminho = (pedido.url.split("?")[0] ?? "").replace(/^\/acesso/, "");
      const entrando = pedido.method === "POST" && caminho === "/sign-in/email";

      // Ações perigosas (trocar senha, mexer no 2FA ou nas passkeys) pedem o segundo fator recente.
      const confirmandoCodigo =
        caminho === "/two-factor/verify-totp" || caminho === "/two-factor/verify-backup-code";
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
        } else if (respostaDoLogin.ok) {
          await registrarAcerto(pool, email);
          pedido.log.info({ evento: "acesso.entrou" }, "Pessoa entrou");
        }
      }
      // Código certo numa sessão já aberta (ativar o app, ou confirmar depois do Google): a sessão fica confirmada.
      if (sessao && confirmandoCodigo && respostaDoLogin.ok) {
        await marcarConfirmacao(pool, sessao.sessaoId, CAMINHOS_QUE_CONFIRMAM.get(caminho) ?? "app");
        pedido.log.info({ evento: "dois_fatores.verificou" }, "Segundo fator confirmado");
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
