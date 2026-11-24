/**
 * Limite de pedidos por endereço de internet nas rotas públicas que aceitam um código (M6-04): abrir e aceitar
 * convite e criar empresa pelo convite. O login, o 2FA e os códigos do Telegram já têm os limites e as travas deles.
 *
 * A contagem fica no banco (acesso.limites, a mesma tabela do limite do login), para valer com várias cópias da API
 * (sem estado no servidor). A janela recomeça depois de "janela" segundos sem pedido.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "./rotas.ts";

export interface LimiteDePedidos {
  /** Nome do limite (vai na chave da contagem, junto com o IP). */
  nome: string;
  janelaEmSegundos: number;
  maximo: number;
}

/** Um preHandler que recusa com 429 quem passou do limite. */
export function limitarPedidos(poolAcesso: pg.Pool, limite: LimiteDePedidos) {
  return async (pedido: FastifyRequest, resposta: FastifyReply) => {
    const ip = origemDoPedido(pedido).ip ?? "sem-ip";
    const agora = Date.now();
    const r = await poolAcesso.query<{ pedidos: number }>(
      `insert into acesso.limites (chave, pedidos, ultimo_pedido) values ($1, 1, $2)
       on conflict (chave) do update set
         pedidos = case when acesso.limites.ultimo_pedido < $2 - $3 then 1 else acesso.limites.pedidos + 1 end,
         ultimo_pedido = $2
       returning pedidos`,
      [`mago:${limite.nome}:${ip}`, agora, limite.janelaEmSegundos * 1000],
    );
    if ((r.rows[0]?.pedidos ?? 0) > limite.maximo) {
      return resposta
        .code(429)
        .header("retry-after", String(limite.janelaEmSegundos))
        .send({ code: "MUITOS_PEDIDOS", message: "Muitas tentativas. Espere um minuto e tente de novo." });
    }
  };
}

/** O limite das rotas de convite: 20 pedidos por minuto por endereço. */
export const LIMITE_DOS_CONVITES: LimiteDePedidos = { nome: "convite", janelaEmSegundos: 60, maximo: 20 };
