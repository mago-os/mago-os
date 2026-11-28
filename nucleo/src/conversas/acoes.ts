/**
 * Ações nas conversas que a caixa (M8-04) e as ferramentas dos agentes (M8-11, decisão 0060) fazem do mesmo jeito.
 */
import type { ConversaComContato } from "@mago-os/contratos";
import type pg from "pg";
import { criarAviso } from "../avisos/index.ts";
import { catalogoDeModulos } from "../permissoes/modulos.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { type QuemOlhaConversas, quemOlhaConversas, RecusaDasConversas } from "./servico.ts";

/**
 * A pessoa vê as conversas do canal pelo alcance dela (sem contar as de que é dona): tudo; ou equipe, com o canal
 * sem equipe ou da área dela. Quem só vê as suas ("meus") não recebe conversa de canal que não vê.
 */
export async function vePeloCanal(c: pg.PoolClient, q: QuemOlhaConversas, canalId: string): Promise<boolean> {
  if (q.alcance === "tudo") return true;
  if (q.alcance !== "equipe") return false;
  const r = await c.query<{ area: string | null }>(
    "select area from canais_de_contato where id = $1 and empresa_id = empresa_ativa()",
    [canalId],
  );
  const area = r.rows[0]?.area;
  return area === null || (area !== undefined && area === q.area);
}

/**
 * Passa a conversa para uma pessoa ativa da empresa que vê as conversas do canal. Ela recebe um aviso (menos quando é
 * quem passou). Roda na transação da empresa.
 */
export async function passarConversaPara(
  c: pg.PoolClient,
  poolApp: pg.Pool,
  empresaId: string,
  conversa: ConversaComContato,
  pessoaId: string,
  quemPassou: { pessoaId: string | null; nome: string },
): Promise<void> {
  const permissoes = await permissoesNaEmpresa(poolApp, pessoaId, empresaId, catalogoDeModulos());
  if (!permissoes) throw new RecusaDasConversas("Escolha uma pessoa ativa da empresa.");
  if (!(await vePeloCanal(c, quemOlhaConversas(permissoes, pessoaId, "ver"), conversa.canal.id)))
    throw new RecusaDasConversas("Essa pessoa não vê as conversas deste canal.");
  await c.query(
    "update conversas_com_contatos set dono_id = $2, com_agente = false where id = $1 and empresa_id = empresa_ativa()",
    [conversa.id, pessoaId],
  );
  if (pessoaId !== quemPassou.pessoaId)
    await criarAviso(c, {
      pessoaId,
      tipo: "mensagem_na_conversa",
      texto: `${quemPassou.nome} passou para você a conversa de "${conversa.contatoNome}".`,
      link: `/conversas/${conversa.id}`,
    });
}
