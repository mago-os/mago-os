/**
 * Anexos (M3-08): arquivos na tarefa e nos comentários, guardados no Backblaze B2 (decisão do Sandro em 19/11/2026,
 * o mesmo serviço do backup e da auditoria), com um bucket por ambiente e o caminho separado por empresa.
 *
 * O navegador envia direto para o depósito por um link temporário, numa área de quarentena. O núcleo só dá o link
 * depois de conferir permissão, tipo e tamanho (decisão 14). O antivírus (ClamAV, num container próprio) confere cada
 * arquivo pela fila: só o limpo fica disponível; o infectado é apagado e o envio aparece como bloqueado.
 * Baixar e ver é sempre por link temporário de 5 minutos, gerado depois da checagem de permissão.
 */
import { type Static, Type } from "typebox";
import { DataHora, Id, OuNulo, Texto } from "../comum.ts";
import { Autor } from "./tarefa.ts";

/** Decisão 14: até 25 MB por arquivo. */
export const TAMANHO_MAXIMO_DO_ANEXO = 25 * 1024 * 1024;

/** Decisão 14: tipos que rodam programa ficam de fora (pela extensão do nome, sem diferença de maiúsculas). */
export const EXTENSOES_BLOQUEADAS = [
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "msp",
  "scr",
  "pif",
  "cpl",
  "js",
  "jse",
  "vbs",
  "vbe",
  "wsf",
  "wsh",
  "ps1",
  "psm1",
  "hta",
  "jar",
  "lnk",
  "reg",
  "sh",
  "app",
  "dmg",
  "pkg",
  "apk",
  "iso",
  "dll",
  "sys",
] as const;

/** Minutos que vale o link para enviar e o link para baixar. */
export const MINUTOS_DO_LINK_DE_ANEXO = 5;

/**
 * enviando: link entregue, esperando o arquivo; verificando: na quarentena, com o antivírus; disponivel: limpo, pode
 * baixar; bloqueado: o antivírus achou algo (o arquivo já foi apagado).
 */
export const SITUACOES_DO_ANEXO = ["enviando", "verificando", "disponivel", "bloqueado"] as const;
export const SituacaoDoAnexo = Type.Enum(SITUACOES_DO_ANEXO, {
  description: "enviando, verificando (antivírus), disponivel ou bloqueado (pelo antivírus).",
});
export type SituacaoDoAnexo = Static<typeof SituacaoDoAnexo>;

const NomeDoArquivo = Texto(200, "Nome do arquivo, como veio do aparelho.");
const TipoDoArquivo = Type.String({
  pattern: "^[a-z0-9.+-]+/[a-z0-9.+-]+$",
  maxLength: 120,
  description: "Tipo do arquivo (MIME), ex.: application/pdf.",
});

/** M5-03b: descrição opcional do anexo (o que é o arquivo), até 500 caracteres, só texto. */
export const MAXIMO_DA_DESCRICAO_DO_ANEXO = 500;
const DescricaoDoAnexo = Texto(MAXIMO_DA_DESCRICAO_DO_ANEXO, "O que é o arquivo, numa frase.");

/** Por onde o anexo entrou (M5-03b): pelo app ou pelo Telegram. */
export const CANAIS_DO_ANEXO = ["app", "telegram"] as const;
export const CanalDoAnexo = Type.Enum(CANAIS_DO_ANEXO, { description: "app ou telegram." });
export type CanalDoAnexo = Static<typeof CanalDoAnexo>;

export const Anexo = Type.Object(
  {
    id: Id,
    empresaId: Id,
    tarefaId: Id,
    /** Anexo de um comentário (ou da própria tarefa, quando nulo). */
    comentarioId: OuNulo(Id),
    nome: NomeDoArquivo,
    tipo: TipoDoArquivo,
    tamanho: Type.Integer({ minimum: 1, maximum: TAMANHO_MAXIMO_DO_ANEXO, description: "Bytes." }),
    situacao: SituacaoDoAnexo,
    /** O que é o arquivo (M5-03b). Quem mandou, ou quem pode editar a tarefa, escreve e muda. */
    descricao: OuNulo(DescricaoDoAnexo),
    canal: CanalDoAnexo,
    enviadoPor: Autor,
    enviadoEm: DataHora,
    verificadoEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Arquivo anexado a uma tarefa ou comentário." },
);
export type Anexo = Static<typeof Anexo>;

export const PedidoDeEnvioDeAnexo = Type.Object(
  {
    nome: NomeDoArquivo,
    tipo: TipoDoArquivo,
    tamanho: Type.Integer({ minimum: 1, maximum: TAMANHO_MAXIMO_DO_ANEXO }),
    comentarioId: Type.Optional(OuNulo(Id)),
    descricao: Type.Optional(OuNulo(DescricaoDoAnexo)),
  },
  { additionalProperties: false },
);
export type PedidoDeEnvioDeAnexo = Static<typeof PedidoDeEnvioDeAnexo>;

/** Escrever, trocar ou tirar (nulo) a descrição do anexo (M5-03b). */
export const PedidoDeDescricaoDoAnexo = Type.Object(
  { descricao: OuNulo(DescricaoDoAnexo) },
  { additionalProperties: false },
);
export type PedidoDeDescricaoDoAnexo = Static<typeof PedidoDeDescricaoDoAnexo>;

/** O link para o navegador mandar o arquivo (PUT, com o content-type pedido), direto para a quarentena. */
export const LinkDeEnvioDeAnexo = Type.Object(
  {
    anexo: Anexo,
    url: Texto(4000, "Link temporário para enviar (PUT)."),
    expiraEm: DataHora,
  },
  { additionalProperties: false },
);
export type LinkDeEnvioDeAnexo = Static<typeof LinkDeEnvioDeAnexo>;

/** O link para baixar ou ver (5 minutos), só de anexo disponível. */
export const LinkDoAnexo = Type.Object(
  {
    url: Texto(4000, "Link temporário para baixar."),
    expiraEm: DataHora,
  },
  { additionalProperties: false },
);
export type LinkDoAnexo = Static<typeof LinkDoAnexo>;

/** Ações de auditoria dos anexos (sem o nome do arquivo nos detalhes: só id, tipo e tamanho). */
export const ACOES_ANEXOS = [
  "anexo.enviou",
  "anexo.bloqueou",
  "anexo.baixou",
  "anexo.excluiu",
  // M5-03b: a descrição mudou (sem o texto nos detalhes).
  "anexo.descreveu",
] as const;

/** A extensão do nome é bloqueada (decisão 14)? */
export function extensaoBloqueada(nome: string): boolean {
  const ext = /\.([^./\\]+)$/.exec(nome.trim().toLowerCase())?.[1];
  return ext !== undefined && (EXTENSOES_BLOQUEADAS as readonly string[]).includes(ext);
}
