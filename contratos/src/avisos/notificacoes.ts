/**
 * Notificações (M3-06): o sino na tela, o push no celular e no computador e as preferências de cada pessoa.
 * O aviso em si é o contrato Aviso (contratos/src/agentes/chave.ts), que passa a valer para tarefas também.
 *
 * Decisão 12 do Sandro (19/11/2026): push pelo próprio app instalável (Web Push, com chaves VAPID no Infisical),
 * sem serviço pago. No iPhone, só com o app instalado na tela de início (limite da Apple).
 */
import { type Static, Type } from "typebox";
import { TIPOS_DE_AVISO, type TipoDeAviso } from "../agentes/chave.ts";
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

/**
 * Por onde cada tipo de aviso chega: no sino (tela), no celular ou computador (push) e, desde a M5-08, no Telegram
 * (quando a pessoa tem o Telegram vinculado nesta empresa). Sem o campo telegram, vale o padrão do tipo.
 */
export const CanaisDoAviso = Type.Object(
  { tela: Type.Boolean(), push: Type.Boolean(), telegram: Type.Optional(Type.Boolean()) },
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
    /** Horário de silêncio, no fuso da pessoa: o push e o Telegram esperam; o sino recebe na hora. */
    silencio: OuNulo(Type.Object({ de: Hora, ate: Hora }, { additionalProperties: false })),
    /**
     * Resumo do dia pelo Telegram (M5-08), na hora escolhida, no fuso da pessoa. Sem o campo, ligado às 8h; nulo,
     * desligado.
     */
    resumoDoDia: Type.Optional(OuNulo(Type.Object({ hora: Hora }, { additionalProperties: false }))),
  },
  { additionalProperties: false, description: "O que chega por onde, e o horário de silêncio." },
);
export type PreferenciasDeNotificacao = Static<typeof PreferenciasDeNotificacao>;

// Avisos pelo Telegram (M5-08, decisão 0037).

/** Pelo Telegram chega na hora só o urgente; o resto entra no resumo do dia (decisão 7 da spec do M5). */
export const AVISOS_URGENTES_NO_TELEGRAM = [
  "mencao",
  "precisa_de_ajuda",
  "prazo_vencido",
  "agentes_parados",
  // M5-05: o aviso de uma rotina é um lembrete que alguém marcou de propósito.
  "aviso_de_rotina",
] as const satisfies readonly TipoDeAviso[];

/**
 * Tipos que o Telegram não repete como aviso: o pedido de aprovação já chega lá com os botões (M5-04), e os avisos
 * sobre o próprio Telegram não fazem sentido por ele.
 */
export const AVISOS_FORA_DO_TELEGRAM = [
  "aprovacao_pedida",
  "telegram_desvinculado",
  "telegram_aprovacoes_travadas",
] as const satisfies readonly TipoDeAviso[];

/** A hora do resumo do dia quando a pessoa não escolheu. */
export const HORA_PADRAO_DO_RESUMO = "08:00";

/** Os canais de um tipo de aviso para a pessoa, com os padrões (tela e push ligados; Telegram, só o urgente). */
export function canaisDoTipo(p: PreferenciasDeNotificacao, tipo: TipoDeAviso): Required<CanaisDoAviso> {
  const escolhido = p.porTipo[tipo];
  const foraDoTelegram = (AVISOS_FORA_DO_TELEGRAM as readonly string[]).includes(tipo);
  const urgente = (AVISOS_URGENTES_NO_TELEGRAM as readonly string[]).includes(tipo);
  // Quem desligou o sino e o push de um tipo antes de existir o Telegram não quer o tipo em lugar nenhum.
  const desligouTudo = escolhido?.tela === false && escolhido?.push === false;
  return {
    tela: escolhido?.tela ?? true,
    push: escolhido?.push ?? true,
    telegram: !foraDoTelegram && (escolhido?.telegram ?? (urgente && !desligouTudo)),
  };
}

/** A hora do resumo do dia, ou nula se a pessoa desligou. */
export function horaDoResumo(p: PreferenciasDeNotificacao): string | null {
  if (p.resumoDoDia === null) return null;
  return p.resumoDoDia?.hora ?? HORA_PADRAO_DO_RESUMO;
}

/** Ações de auditoria da M3-06 (o push ligado e desligado por aparelho). */
export const ACOES_NOTIFICACOES = ["push.ligou", "push.desligou", "notificacoes.mudou_preferencias"] as const;
