/**
 * Notificações (M3-06): o sino na tela, o push no celular e no computador e as preferências de cada pessoa.
 * O aviso em si é o contrato Aviso (contratos/src/agentes/chave.ts), que passa a valer para tarefas também.
 *
 * Decisão 12 do Sandro (19/11/2026): push pelo próprio app instalável (Web Push, com chaves VAPID no Infisical),
 * sem serviço pago. No iPhone, só com o app instalado na tela de início (limite da Apple).
 */
import { type Static, Type } from "typebox";
import { TIPOS_DE_AVISO } from "../agentes/chave.ts";
import { DataHora, Id, OuNulo } from "../comum.ts";
import { Hora } from "../tarefas/prazos.ts";

/** A assinatura de push que o navegador entrega (padrão Web Push). Uma por aparelho. */
export const PedidoDeAssinaturaDePush = Type.Object(
  {
    endpoint: Type.String({ format: "uri", pattern: "^https://", maxLength: 1000 }),
    chaves: Type.Object(
      {
        p256dh: Type.String({ minLength: 1, maxLength: 200 }),
        auth: Type.String({ minLength: 1, maxLength: 100 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false, description: "Assinatura de push do navegador deste aparelho." },
);
export type PedidoDeAssinaturaDePush = Static<typeof PedidoDeAssinaturaDePush>;

export const AssinaturaDePush = Type.Object(
  { id: Id, criadaEm: DataHora, ultimoEnvioEm: OuNulo(DataHora) },
  {
    additionalProperties: false,
    description: "Aparelho com o push ligado (sem as chaves, que ficam no servidor).",
  },
);
export type AssinaturaDePush = Static<typeof AssinaturaDePush>;

/** Por onde cada tipo de aviso chega: no sino (tela) e no celular ou computador (push). */
export const CanaisDoAviso = Type.Object(
  { tela: Type.Boolean(), push: Type.Boolean() },
  { additionalProperties: false },
);
export type CanaisDoAviso = Static<typeof CanaisDoAviso>;

export const PreferenciasDeNotificacao = Type.Object(
  {
    /** Só os tipos que a pessoa mudou; os outros valem tela e push ligados. */
    porTipo: Type.Partial(
      Type.Object(
        Object.fromEntries(TIPOS_DE_AVISO.map((t) => [t, CanaisDoAviso])) as Record<
          (typeof TIPOS_DE_AVISO)[number],
          typeof CanaisDoAviso
        >,
      ),
      { additionalProperties: false },
    ),
    /** Horário de silêncio, no fuso da pessoa: o push espera; o sino recebe na hora. */
    silencio: OuNulo(Type.Object({ de: Hora, ate: Hora }, { additionalProperties: false })),
  },
  { additionalProperties: false, description: "O que chega por onde, e o horário de silêncio." },
);
export type PreferenciasDeNotificacao = Static<typeof PreferenciasDeNotificacao>;

/** Ações de auditoria da M3-06 (o push ligado e desligado por aparelho). */
export const ACOES_NOTIFICACOES = ["push.ligou", "push.desligou", "notificacoes.mudou_preferencias"] as const;
