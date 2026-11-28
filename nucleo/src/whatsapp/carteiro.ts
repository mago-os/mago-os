/**
 * Carteiro da Meta (M8-09, decisão 0059): as chamadas da Cloud API do WhatsApp que o Mago OS usa para a equipe, sem
 * biblioteca de terceiros. Texto sempre simples (o texto de um agente nunca vira formatação nem prévia de link).
 * Nos testes, o carteiroFalsoDaMeta guarda o que seria enviado, sem rede.
 *
 * O token nunca aparece no log: os erros levam só o tipo do envio e o código que a Meta devolveu.
 */
import { MAXIMO_DA_MENSAGEM_DO_WHATSAPP } from "@mago-os/contratos";

/** Um botão de resposta (a Meta aceita até 3, com até 20 letras). */
export interface BotaoDoWhatsapp {
  id: string;
  titulo: string;
}

export interface CarteiroDaMeta {
  /** O número do Mago OS (só dígitos), para o link do wa.me. Vazio até a Meta responder (descobrirNumero). */
  numero: string;
  /** Pergunta à Meta o número do id configurado (ao subir a API). */
  descobrirNumero(): Promise<string>;
  /** Texto simples. Devolve o id da mensagem na Meta. */
  enviarTexto(para: string, texto: string): Promise<string>;
  /** Texto com até 3 botões de resposta. */
  enviarBotoes(para: string, texto: string, botoes: BotaoDoWhatsapp[]): Promise<string>;
  /** Mensagem por modelo aprovado (fora da janela de 24 horas), em pt_BR, com os valores do corpo. */
  enviarModelo(para: string, modelo: string, valores: string[]): Promise<string>;
}

/** Erro de uma chamada à Meta, sem o token. foraDaJanela: a Meta recusou porque a janela de 24 horas fechou. */
export class ErroDaMeta extends Error {
  override name = "ErroDaMeta";
  readonly codigo: number | null;
  readonly foraDaJanela: boolean;
  constructor(tipo: string, status: number, codigo: number | null) {
    super(`Meta ${tipo}: ${status}${codigo ? ` (${codigo})` : ""}`);
    this.codigo = codigo;
    this.foraDaJanela = codigo === 131047;
  }
}

const VERSAO_DA_API = "v21.0";

export function carteiroDaMeta(c: { token: string; numeroId: string }): CarteiroDaMeta {
  const mandar = async (tipo: string, corpo: Record<string, unknown>): Promise<string> => {
    let r: Response;
    try {
      r = await fetch(
        `https://graph.facebook.com/${VERSAO_DA_API}/${encodeURIComponent(c.numeroId)}/messages`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...corpo }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new ErroDaMeta(tipo, 0, null);
    }
    const json = (await r.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { code?: number };
    } | null;
    if (!r.ok || !json?.messages?.[0]?.id) throw new ErroDaMeta(tipo, r.status, json?.error?.code ?? null);
    return json.messages[0].id;
  };
  const carteiro: CarteiroDaMeta = {
    numero: "",
    async descobrirNumero() {
      const r = await fetch(
        `https://graph.facebook.com/${VERSAO_DA_API}/${encodeURIComponent(c.numeroId)}?fields=display_phone_number`,
        { headers: { authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(15_000) },
      ).catch(() => null);
      if (!r?.ok) throw new ErroDaMeta("número", r?.status ?? 0, null);
      const json = (await r.json().catch(() => null)) as { display_phone_number?: string } | null;
      const numero = (json?.display_phone_number ?? "").replace(/\D/g, "");
      if (!/^[0-9]{8,15}$/.test(numero)) throw new ErroDaMeta("número", r.status, null);
      carteiro.numero = numero;
      return numero;
    },
    enviarTexto: (para, texto) =>
      mandar("texto", {
        to: para,
        type: "text",
        text: { body: texto.slice(0, MAXIMO_DA_MENSAGEM_DO_WHATSAPP), preview_url: false },
      }),
    enviarBotoes: (para, texto, botoes) =>
      mandar("botões", {
        to: para,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: texto.slice(0, 1024) },
          action: {
            buttons: botoes
              .slice(0, 3)
              .map((b) => ({ type: "reply", reply: { id: b.id, title: b.titulo.slice(0, 20) } })),
          },
        },
      }),
    enviarModelo: (para, modelo, valores) =>
      mandar("modelo", {
        to: para,
        type: "template",
        template: {
          name: modelo,
          language: { code: "pt_BR" },
          components: [
            { type: "body", parameters: valores.map((v) => ({ type: "text", text: v.slice(0, 1000) })) },
          ],
        },
      }),
  };
  return carteiro;
}

export interface EnvioFalsoDaMeta {
  para: string;
  id: string;
  texto?: string;
  botoes?: BotaoDoWhatsapp[];
  modelo?: { nome: string; valores: string[] };
}

export interface CarteiroFalsoDaMeta extends CarteiroDaMeta {
  enviados: EnvioFalsoDaMeta[];
  /** Os números com a janela fechada: texto e botões são recusados como a Meta faz (131047). */
  janelaFechada: Set<string>;
  foraDoAr: boolean;
}

export function carteiroFalsoDaMeta(numero = "15551536171"): CarteiroFalsoDaMeta {
  let n = 0;
  const falso: CarteiroFalsoDaMeta = {
    numero,
    async descobrirNumero() {
      return numero;
    },
    enviados: [],
    janelaFechada: new Set(),
    foraDoAr: false,
    async enviarTexto(para, texto) {
      if (falso.foraDoAr) throw new ErroDaMeta("texto", 0, null);
      if (falso.janelaFechada.has(para)) throw new ErroDaMeta("texto", 400, 131047);
      n += 1;
      falso.enviados.push({ para, id: `wamid.FALSO${n}`, texto });
      return `wamid.FALSO${n}`;
    },
    async enviarBotoes(para, texto, botoes) {
      if (falso.foraDoAr) throw new ErroDaMeta("botões", 0, null);
      if (falso.janelaFechada.has(para)) throw new ErroDaMeta("botões", 400, 131047);
      n += 1;
      falso.enviados.push({ para, id: `wamid.FALSO${n}`, texto, botoes });
      return `wamid.FALSO${n}`;
    },
    async enviarModelo(para, modelo, valores) {
      if (falso.foraDoAr) throw new ErroDaMeta("modelo", 0, null);
      n += 1;
      falso.enviados.push({ para, id: `wamid.FALSO${n}`, modelo: { nome: modelo, valores } });
      return `wamid.FALSO${n}`;
    },
  };
  return falso;
}
