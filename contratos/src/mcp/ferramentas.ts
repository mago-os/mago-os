/**
 * Ferramentas do Mago OS como servidor MCP (M2-05): o que um agente externo pode fazer com as tarefas dele.
 * Ver docs/decisoes/0019-servidor-mcp.md.
 *
 * Cada ferramenta é uma ação declarada aqui: nome, descrição (o texto que o agente lê para decidir o que usar),
 * o que recebe e o que devolve. O servidor MCP e a documentação (docs/api) nascem desta lista. A descrição é
 * congelada por um teste (regra 14 da segurança dos agentes): mudar o texto exige atualizar o teste no PR, com
 * aprovação humana, porque um texto adulterado pode mudar o que o agente faz.
 *
 * O agente só alcança as tarefas atribuídas a ele ou que ele pegou, só da empresa dele. Tudo o que ele escreve
 * (comentário, resultado) fica marcado como vindo de agente e aparece na tela só como texto.
 */
import { type Static, type TSchema, Type } from "typebox";
import { DataHora, Id, Texto } from "../comum.ts";
import { ItemDeChecklist } from "../tarefas/checklist.ts";
import { ComentarioDeTarefa, Responsavel, StatusTarefa, Tarefa } from "../tarefas/tarefa.ts";

export interface FerramentaMcp<E extends TSchema = TSchema, S extends TSchema = TSchema> {
  /** Nome da ferramenta, em minúsculas com _ (é o que o agente chama). */
  nome: string;
  /** Texto que o agente lê. Congelado pelo teste de assinatura. */
  descricao: string;
  entrada: E;
  saida: S;
}

const SoTarefa = Type.Object({ tarefaId: Id }, { additionalProperties: false });
/** A tarefa com comentários, subtarefas e checklist (M3-02). */
const TarefaComComentarios = Type.Object(
  {
    tarefa: Tarefa,
    comentarios: Type.Array(ComentarioDeTarefa),
    subtarefas: Type.Array(Tarefa),
    checklist: Type.Array(ItemDeChecklist),
  },
  { additionalProperties: false },
);

export const FERRAMENTAS_MCP = [
  {
    nome: "minhas_tarefas",
    descricao:
      'Lista as tarefas atribuídas a você ou que você pegou, das mais urgentes (prioridade e prazo) para as menos, e as tarefas em que alguém mencionou você com @ e você ainda não respondeu (em "mencionado": veja e responda com comentar). Sem filtro, traz só as abertas (A fazer, Em andamento e Precisa de ajuda). Chame a cada minuto para saber se há trabalho novo.',
    entrada: Type.Object(
      {
        status: Type.Optional(
          Type.Array(StatusTarefa, {
            minItems: 1,
            uniqueItems: true,
            description: "Filtrar por estes status.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    saida: Type.Object(
      {
        tarefas: Type.Array(Tarefa),
        /** Ids das tarefas em que você foi mencionado com @ e ainda não comentou (M3-05). */
        mencionado: Type.Array(Id),
      },
      { additionalProperties: false },
    ),
  },
  {
    nome: "ver_tarefa",
    descricao:
      "Mostra uma tarefa sua com todos os comentários (do mais antigo para o mais novo), as subtarefas e o checklist.",
    entrada: SoTarefa,
    saida: TarefaComComentarios,
  },
  {
    nome: "pegar_tarefa",
    descricao:
      "Pega a tarefa para você: ela fica Em andamento e travada no seu nome, e só você muda o status até soltar ou entregar. Se outro já pegou, a resposta diz que não está disponível. Pegue antes de começar o trabalho.",
    entrada: SoTarefa,
    saida: Tarefa,
  },
  {
    nome: "soltar_tarefa",
    descricao:
      "Solta uma tarefa que você pegou: ela volta para A fazer, sem resultado. Use quando não souber ou não puder fazer, e explique o motivo para a pessoa responsável entender.",
    entrada: Type.Object(
      { tarefaId: Id, motivo: Type.Optional(Texto(1000, "Por que está soltando (vira comentário).")) },
      { additionalProperties: false },
    ),
    saida: Tarefa,
  },
  {
    nome: "comentar",
    descricao:
      "Escreve um comentário numa tarefa sua ou em que você foi mencionado, em texto simples. Use para contar o andamento, responder a uma menção ou fazer uma pergunta à pessoa responsável.",
    entrada: Type.Object(
      { tarefaId: Id, texto: Texto(10000, "O comentário, em texto simples.") },
      { additionalProperties: false },
    ),
    saida: ComentarioDeTarefa,
  },
  {
    nome: "mudar_status",
    descricao:
      "Muda o status de uma tarefa que você pegou para Em andamento ou Precisa de ajuda. Para concluir, use entregar_resultado; para desistir, use soltar_tarefa.",
    entrada: Type.Object(
      {
        tarefaId: Id,
        status: Type.Enum(["em_andamento", "precisa_de_ajuda"] as const),
        motivo: Type.Optional(Texto(1000, "O que aconteceu (vira comentário).")),
      },
      { additionalProperties: false },
    ),
    saida: Tarefa,
  },
  {
    nome: "entregar_resultado",
    descricao:
      "Conclui uma tarefa que você pegou e entrega o resultado: o texto que a pessoa responsável vai ler na tela. Escreva o que foi feito e o que foi encontrado.",
    entrada: Type.Object(
      { tarefaId: Id, resultado: Texto(50000, "O que foi feito e encontrado.") },
      { additionalProperties: false },
    ),
    saida: Tarefa,
  },
  {
    nome: "criar_subtarefa",
    descricao:
      "Cria uma subtarefa numa tarefa que você pegou, para dividir o trabalho em passos. Sem responsável, a subtarefa fica com você. Ela fica no mesmo projeto e na mesma lista da tarefa-mãe.",
    entrada: Type.Object(
      {
        tarefaId: Id,
        titulo: Texto(200, "O passo, numa linha."),
        descricao: Type.Optional(Texto(20000, "Detalhes do passo.")),
        responsavel: Type.Optional(Responsavel),
      },
      { additionalProperties: false },
    ),
    saida: Tarefa,
  },
  {
    nome: "marcar_checklist",
    descricao:
      "Marca ou desmarca um item do checklist de uma tarefa que você pegou. Marque cada passo assim que terminar, para a pessoa responsável acompanhar.",
    entrada: Type.Object(
      { tarefaId: Id, itemId: Id, marcado: Type.Boolean({ description: "true marca; false desmarca." }) },
      { additionalProperties: false },
    ),
    saida: ItemDeChecklist,
  },
  {
    nome: "estou_vivo",
    descricao:
      "Avisa que você continua trabalhando. Todo pedido já conta como sinal de vida; use esta só quando ficar mais de alguns minutos sem chamar outra ferramenta, para a tarefa não voltar para a fila.",
    entrada: Type.Object({}, { additionalProperties: false }),
    saida: Type.Object({ ok: Type.Literal(true), agora: DataHora }, { additionalProperties: false }),
  },
] as const satisfies readonly FerramentaMcp[];

export type NomeDaFerramenta = (typeof FERRAMENTAS_MCP)[number]["nome"];
export type EntradaDa<N extends NomeDaFerramenta> = Static<
  Extract<(typeof FERRAMENTAS_MCP)[number], { nome: N }>["entrada"]
>;
