/**
 * O que gera aviso nas tarefas (M3-06), igual para as rotas da tela e para o MCP. Roda depois da mudança, numa
 * transação da empresa: falhar aqui não desfaz a mudança, só registra.
 */
import type { Autor, ComentarioDeTarefa, StatusTarefa, Tarefa } from "@mago-os/contratos";
import type pg from "pg";
import { comEmpresa } from "../empresa.ts";
import { notificarTarefa, seguidores, seguir } from "./notificacoes.ts";

export type EventoDeTarefa =
  | { tipo: "criou"; tarefa: Tarefa }
  | { tipo: "trocou_responsavel"; tarefa: Tarefa }
  | { tipo: "pegou"; tarefa: Tarefa }
  | { tipo: "comentou"; tarefa: Tarefa; comentario: ComentarioDeTarefa }
  | { tipo: "mudou_status"; tarefa: Tarefa; de: StatusTarefa };

const pessoaDe = (a: Autor | null | undefined): string | null => (a?.tipo === "pessoa" ? a.pessoaId : null);

/** Gera os avisos e acerta os seguidores de um acontecimento numa tarefa. */
export async function avisarSobreTarefa(c: pg.PoolClient, autor: Autor, e: EventoDeTarefa): Promise<void> {
  const t = e.tarefa;
  const quemFez = pessoaDe(autor);
  const responsavel = pessoaDe(t.responsavel);
  switch (e.tipo) {
    case "criou":
      await seguir(
        c,
        t.id,
        [pessoaDe(t.criadaPor), responsavel].filter((x): x is string => !!x),
      );
      await notificarTarefa(c, {
        tipo: "tarefa_atribuida",
        tarefaId: t.id,
        texto: `A tarefa "${t.titulo}" foi passada para você.`,
        para: [responsavel],
        exceto: quemFez,
      });
      return;
    case "trocou_responsavel":
      if (responsavel) await seguir(c, t.id, [responsavel]);
      await notificarTarefa(c, {
        tipo: "tarefa_atribuida",
        tarefaId: t.id,
        texto: `A tarefa "${t.titulo}" foi passada para você.`,
        para: [responsavel],
        exceto: quemFez,
      });
      return;
    case "pegou":
      if (quemFez) await seguir(c, t.id, [quemFez]);
      return;
    case "comentou": {
      const mencionados = e.comentario.mencoes.flatMap((m) => (m.tipo === "pessoa" ? [m.pessoaId] : []));
      if (quemFez) await seguir(c, t.id, [quemFez]);
      // Quem é mencionado e vê a tarefa passa a segui-la (notificarTarefa já confere quem vê).
      await notificarTarefa(c, {
        tipo: "mencao",
        tarefaId: t.id,
        texto: `Você foi mencionado na tarefa "${t.titulo}".`,
        para: mencionados,
        exceto: quemFez,
      });
      await seguir(c, t.id, mencionados);
      const seguem = (await seguidores(c, t.id)).filter((p) => !mencionados.includes(p));
      await notificarTarefa(c, {
        tipo: "comentario",
        tarefaId: t.id,
        texto: `Novo comentário na tarefa "${t.titulo}".`,
        para: seguem,
        exceto: quemFez,
      });
      return;
    }
    case "mudou_status":
      if (t.status === "precisa_de_ajuda" && e.de !== "precisa_de_ajuda") {
        await notificarTarefa(c, {
          tipo: "precisa_de_ajuda",
          tarefaId: t.id,
          texto: `A tarefa "${t.titulo}" precisa de ajuda.`,
          para: await seguidores(c, t.id),
          exceto: quemFez,
        });
      }
      if (t.status === "concluida" && e.de !== "concluida" && t.resultado !== null) {
        await notificarTarefa(c, {
          tipo: "resultado_entregue",
          tarefaId: t.id,
          texto: `Resultado entregue na tarefa "${t.titulo}".`,
          para: [pessoaDe(t.criadaPor)],
          exceto: quemFez,
        });
      }
      return;
  }
}

/** O mesmo, numa transação própria da empresa, depois da mudança. Erro só vai para o registro. */
export async function avisarDepois(
  poolApp: pg.Pool,
  empresaId: string,
  autor: Autor,
  e: EventoDeTarefa,
  log: { error(obj: unknown, msg?: string): void },
): Promise<void> {
  try {
    await comEmpresa(poolApp, empresaId, (c) => avisarSobreTarefa(c, autor, e));
  } catch (erro) {
    log.error({ erro, evento: "aviso.falhou" }, "Os avisos da tarefa não saíram");
  }
}
