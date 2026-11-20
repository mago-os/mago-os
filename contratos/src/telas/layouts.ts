/**
 * Painéis encaixáveis (M3-10): a pessoa monta a tela com vários painéis lado a lado (dockview, decisão 16), salva o
 * jeito com um nome ("Meu dia", "Projetos") e troca com um clique. O layout do computador e o do celular ficam
 * separados: no computador, a divisão da tela; no celular, os painéis em abas, na ordem que a pessoa escolher.
 * Os layouts são pessoais (só a dona vê) e de cada empresa.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, Texto } from "../comum.ts";

export const APARELHOS_DO_LAYOUT = ["computador", "celular"] as const;
export const AparelhoDoLayout = Type.Enum(APARELHOS_DO_LAYOUT, { description: "computador ou celular." });
export type AparelhoDoLayout = Static<typeof AparelhoDoLayout>;

/** Os painéis do M3. Módulos novos acrescentam os seus. */
export const TIPOS_DE_PAINEL = [
  "inicio",
  "tarefas",
  "projeto",
  "prioridades",
  "notificacoes",
  "agentes",
] as const;
export const TipoDePainel = Type.Enum(TIPOS_DE_PAINEL, {
  description: "inicio, tarefas (com as três visões), projeto, prioridades, notificacoes ou agentes.",
});
export type TipoDePainel = Static<typeof TipoDePainel>;

/** Layouts no máximo, por pessoa e aparelho. */
export const LAYOUTS_POR_APARELHO = 20;
/** Tamanho máximo da divisão salva (o JSON do dockview), em bytes. */
export const TAMANHO_MAXIMO_DO_LAYOUT = 64 * 1024;

/** Um painel: o tipo e, quando precisa, o que ele mostra (o projeto, a visão salva das tarefas). */
export const PainelDoLayout = Type.Object(
  {
    id: Texto(60, "Identificador do painel dentro do layout."),
    tipo: TipoDePainel,
    projetoId: Type.Optional(Id),
    visaoId: Type.Optional(Id),
  },
  { additionalProperties: false },
);
export type PainelDoLayout = Static<typeof PainelDoLayout>;

export const EstruturaDoLayout = Type.Object(
  {
    /** Os painéis (no celular, nesta ordem, como abas). */
    paineis: Type.Array(PainelDoLayout, { minItems: 1, maxItems: 12 }),
    /** No celular: os painéis favoritos, que aparecem primeiro. */
    favoritos: Type.Optional(Type.Array(Texto(60, "Id do painel."), { maxItems: 12 })),
    /**
     * No computador: a divisão da tela como o dockview salva (grade, tamanhos, abas). O núcleo confere o tamanho e que
     * só cita os painéis acima; o resto é da tela.
     */
    divisao: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);
export type EstruturaDoLayout = Static<typeof EstruturaDoLayout>;

export const LayoutDeTela = Type.Object(
  {
    id: Id,
    empresaId: Id,
    pessoaId: Id,
    nome: Texto(80, "Nome do layout (ex.: Meu dia)."),
    aparelho: AparelhoDoLayout,
    estrutura: EstruturaDoLayout,
    /** O último usado em cada aparelho abre sozinho. */
    usadoEm: OuNulo(DataHora),
    criadoEm: DataHora,
  },
  { additionalProperties: false, description: "Layout de painéis salvo por uma pessoa, só dela." },
);
export type LayoutDeTela = Static<typeof LayoutDeTela>;

export function conferirLayoutDeTela(valor: unknown) {
  return conferir(LayoutDeTela, valor);
}

export const PedidoDeLayout = Type.Object(
  {
    nome: Texto(80, "Nome do layout."),
    aparelho: AparelhoDoLayout,
    estrutura: EstruturaDoLayout,
  },
  { additionalProperties: false },
);
export type PedidoDeLayout = Static<typeof PedidoDeLayout>;
