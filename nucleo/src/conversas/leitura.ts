/**
 * Ler os avisos de mensagem da Evolution 2.3 (M8-03, decisão 0053): `messages.upsert` (mensagem nova, do contato ou
 * do próprio número) e `messages.update` (a entrega). A Evolution não é nossa: tudo é lido com cuidado, e o que não
 * se entende vira "tipo de mensagem ainda não mostrado aqui" ou é ignorado, nunca erro.
 */
import type { MensagemQueChegou, SituacaoDeEntrega } from "@mago-os/contratos";
import { numeroDoJid } from "./evolution.ts";

export type MensagemLida =
  | {
      ignorar: false;
      mensagem: Omit<MensagemQueChegou, "canalId">;
      /** Foto, documento ou áudio: o núcleo baixa da Evolution pelo número da mensagem. */
      arquivo: { nome: string; mime: string | null; segundos?: number | null } | null;
    }
  | { ignorar: true; motivo: string };

const objeto = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const texto = (v: unknown, maximo = 20000): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, maximo) : null;

/** O nome do arquivo que vem de fora, sem caminho nem caracteres que atrapalhem. */
export function nomeLimpo(nome: string | null, padrao: string): string {
  const base = (nome ?? "").split(/[\\/]/).pop() ?? "";
  const limpo = base
    .split("")
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || '<>:"|?*'.includes(ch) ? "_" : ch))
    .join("")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);
  return limpo || padrao;
}

/** O nome e o telefone do cartão de contato (vCard), sem criar contato nenhum. */
function textoDoCartao(nome: unknown, vcard: unknown): string {
  const n = texto(nome, 200) ?? "Contato";
  const tel =
    typeof vcard === "string" ? /TEL[^:]*:([+\d\s().-]{6,30})/i.exec(vcard)?.[1]?.trim() : undefined;
  return `Contato compartilhado: ${n}${tel ? `, ${tel}` : ""}`;
}

export function lerMensagemDaEvolution(dataBruta: unknown): MensagemLida {
  const data = objeto(dataBruta);
  const key = objeto(data.key);
  const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (!jid) return { ignorar: true, motivo: "sem remetente" };
  if (jid.endsWith("@g.us")) return { ignorar: true, motivo: "grupo" };
  if (jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter"))
    return { ignorar: true, motivo: "status ou canal" };

  // O endereço LID esconde o telefone; a Evolution manda o telefone em remoteJidAlt quando sabe.
  let identificador: string | null = null;
  if (jid.endsWith("@lid")) {
    identificador = numeroDoJid(key.remoteJidAlt);
    if (!identificador) {
      const lid = /^(\d{5,40})@lid$/.exec(jid)?.[1];
      identificador = lid ? `lid:${lid}` : null;
    }
  } else {
    identificador = numeroDoJid(jid);
  }
  if (!identificador) return { ignorar: true, motivo: "remetente fora do formato" };

  const doCelular = key.fromMe === true;
  const id = texto(key.id, 200);
  const segundos =
    typeof data.messageTimestamp === "number" ? data.messageTimestamp : Number(data.messageTimestamp);
  const enviadaEm =
    Number.isFinite(segundos) && segundos > 1_000_000_000
      ? new Date(segundos * 1000).toISOString()
      : undefined;
  const msg = objeto(data.message);
  // Apagar, editar, reagir à mensagem: não são mensagens novas.
  if ("protocolMessage" in msg || "reactionMessage" in msg || "senderKeyDistributionMessage" in msg)
    return { ignorar: true, motivo: "controle do WhatsApp" };

  const base = {
    identificador,
    nomeDoPerfil: doCelular ? null : texto(data.pushName, 200),
    idNoProvedor: id,
    ...(enviadaEm ? { enviadaEm } : {}),
    ...(doCelular ? { doCelular: true } : {}),
  };
  const lida = (
    tipo: MensagemQueChegou["tipo"],
    t: string | null,
    arquivo: { nome: string; mime: string | null; segundos?: number | null } | null = null,
  ): MensagemLida => ({ ignorar: false, mensagem: { ...base, tipo, texto: t }, arquivo });

  if (typeof msg.conversation === "string") return lida("texto", texto(msg.conversation));
  const estendida = objeto(msg.extendedTextMessage);
  if (texto(estendida.text)) return lida("texto", texto(estendida.text));
  const imagem = objeto(msg.imageMessage);
  if (Object.keys(imagem).length > 0)
    return lida("foto", texto(imagem.caption), { nome: "foto.jpg", mime: texto(imagem.mimetype, 120) });
  const documento = objeto(
    msg.documentMessage ?? objeto(objeto(msg.documentWithCaptionMessage).message).documentMessage,
  );
  if (Object.keys(documento).length > 0)
    return lida("documento", texto(documento.caption), {
      nome: nomeLimpo(texto(documento.fileName, 300), "documento"),
      mime: texto(documento.mimetype, 120),
    });
  const audio = objeto(msg.audioMessage);
  if (Object.keys(audio).length > 0)
    return lida("audio", null, {
      nome: "audio.ogg",
      mime: texto(audio.mimetype, 120),
      // A duração que o WhatsApp informa (M8-08): o limite e o custo da transcrição.
      segundos:
        typeof audio.seconds === "number" && audio.seconds >= 0
          ? Math.min(86400, Math.round(audio.seconds))
          : null,
    });
  const local = objeto(msg.locationMessage ?? msg.liveLocationMessage);
  if (typeof local.degreesLatitude === "number" && typeof local.degreesLongitude === "number") {
    const lat = local.degreesLatitude.toFixed(6);
    const lon = local.degreesLongitude.toFixed(6);
    const nome = texto(local.name, 200);
    return lida(
      "localizacao",
      `Localização${nome ? `: ${nome}` : ""} (${lat}, ${lon}) https://www.google.com/maps?q=${lat},${lon}`,
    );
  }
  const cartao = objeto(msg.contactMessage);
  if (Object.keys(cartao).length > 0) return lida("contato", textoDoCartao(cartao.displayName, cartao.vcard));
  const cartoes = objeto(msg.contactsArrayMessage);
  if (Array.isArray(cartoes.contacts) && cartoes.contacts.length > 0) {
    const c0 = objeto(cartoes.contacts[0]);
    return lida("contato", textoDoCartao(c0.displayName, c0.vcard));
  }
  // Vídeo, figurinha, enquete e o resto: aparecem como "ainda não mostrado aqui" (a legenda, se houver, fica).
  const legenda = texto(objeto(msg.videoMessage).caption);
  return lida("outro", legenda);
}

const ENTREGAS: Record<string, SituacaoDeEntrega> = {
  SERVER_ACK: "enviada",
  DELIVERY_ACK: "entregue",
  READ: "lida",
  PLAYED: "lida",
  ERROR: "falhou",
};

/** O aviso de entrega: o número da mensagem e a situação nova (ou nulo, se não se entende). */
export function lerEntregaDaEvolution(dataBruta: unknown): { id: string; entrega: SituacaoDeEntrega } | null {
  const data = objeto(dataBruta);
  const id = texto(data.keyId, 200) ?? texto(objeto(data.key).id, 200);
  const status =
    typeof data.status === "string"
      ? data.status
      : typeof data.status === "number"
        ? String(data.status)
        : "";
  const porNumero: Record<string, string> = {
    "0": "ERROR",
    "2": "SERVER_ACK",
    "3": "DELIVERY_ACK",
    "4": "READ",
    "5": "PLAYED",
  };
  const entrega = ENTREGAS[porNumero[status] ?? status];
  return id && entrega ? { id, entrega } : null;
}

/** Para mandar: o telefone sem o + ou o endereço LID. */
export function destinoDoIdentificador(identificador: string): string | null {
  if (/^\+[1-9][0-9]{7,14}$/.test(identificador)) return identificador.slice(1);
  const lid = /^lid:([0-9]{5,40})$/.exec(identificador)?.[1];
  return lid ? `${lid}@lid` : null;
}
