/**
 * Rotas do login na API: tudo em /acesso/* vai para o Better Auth (na VPS, /api/acesso/*).
 * Antes de conferir a senha, olha a trava do e-mail; depois, conta o erro ou zera a contagem.
 */
import { normalizarEmail } from "@mago-os/contratos";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
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

export function registrarRotasDoLogin(app: FastifyInstance, login: Login, pool: pg.Pool): void {
  const baseURL = String(login.options.baseURL);
  app.route({
    method: ["GET", "POST"],
    url: "/acesso/*",
    async handler(pedido, resposta) {
      const entrando = pedido.method === "POST" && pedido.url.split("?")[0] === "/acesso/sign-in/email";
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
      if (pedido.url.startsWith("/acesso/sign-out") && respostaDoLogin.ok) {
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
