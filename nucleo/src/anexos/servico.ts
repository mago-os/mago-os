/**
 * Anexos (M3-08): o registro no banco e o trabalho da fila (antivírus, envio parado, arquivos para apagar).
 * Caminhos no depósito, sempre separados por empresa:
 *   quarentena/<empresa>/<sorteado>       enquanto espera o antivírus
 *   empresas/<empresa>/anexos/<anexo>     depois de liberado
 */
import { randomUUID } from "node:crypto";
import type { Anexo, Autor, SituacaoDoAnexo } from "@mago-os/contratos";
import type pg from "pg";
import { auditar } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa } from "../empresa.ts";
import type { Antivirus } from "./antivirus.ts";
import type { Deposito } from "./deposito.ts";

interface LinhaDoAnexo {
  id: string;
  empresa_id: string;
  tarefa_id: string;
  comentario_id: string | null;
  nome: string;
  tipo: string;
  tamanho: string;
  situacao: SituacaoDoAnexo;
  caminho: string;
  enviado_por_pessoa_id: string | null;
  enviado_por_agente_id: string | null;
  enviado_em: Date;
  verificado_em: Date | null;
}

const COLUNAS = `id, empresa_id, tarefa_id, comentario_id, nome, tipo, tamanho, situacao, caminho,
  enviado_por_pessoa_id, enviado_por_agente_id, enviado_em, verificado_em`;

export interface AnexoComCaminho extends Anexo {
  caminho: string;
}

function paraAnexo(l: LinhaDoAnexo): AnexoComCaminho {
  const enviadoPor: Autor = l.enviado_por_pessoa_id
    ? { tipo: "pessoa", pessoaId: l.enviado_por_pessoa_id }
    : l.enviado_por_agente_id
      ? { tipo: "agente", agenteId: l.enviado_por_agente_id }
      : { tipo: "sistema" };
  return {
    id: l.id,
    empresaId: l.empresa_id,
    tarefaId: l.tarefa_id,
    comentarioId: l.comentario_id,
    nome: l.nome,
    tipo: l.tipo,
    tamanho: Number(l.tamanho),
    situacao: l.situacao,
    enviadoPor,
    enviadoEm: l.enviado_em.toISOString(),
    verificadoEm: l.verificado_em ? l.verificado_em.toISOString() : null,
    caminho: l.caminho,
  };
}

/** O anexo como sai para a tela e para o agente (sem o caminho no depósito). */
export function semCaminho({ caminho: _c, ...anexo }: AnexoComCaminho): Anexo {
  return anexo;
}

/** Anexo que o agente pode ver: liberado, e não de uma nota interna (que o agente não recebe, M3-05). */
const PARA_AGENTE = `situacao = 'disponivel' and (comentario_id is null or exists (
  select 1 from comentarios_de_tarefa cm where cm.id = anexos.comentario_id and cm.empresa_id = anexos.empresa_id
    and cm.tipo = 'comentario' and cm.apagado_em is null))`;

/** Os anexos da tarefa, do mais antigo para o mais novo. "paraAgente": só os que o agente pode ver. */
export async function listarAnexos(
  c: pg.PoolClient,
  tarefaId: string,
  paraAgente = false,
): Promise<AnexoComCaminho[]> {
  const r = await c.query<LinhaDoAnexo>(
    `select ${COLUNAS} from anexos where empresa_id = empresa_ativa() and tarefa_id = $1
       and ${paraAgente ? PARA_AGENTE : "situacao <> 'enviando'"}
      order by enviado_em limit 200`,
    [tarefaId],
  );
  return r.rows.map(paraAnexo);
}

export async function buscarAnexo(
  c: pg.PoolClient,
  tarefaId: string,
  anexoId: string,
  opcoes: { paraMudar?: boolean; paraAgente?: boolean } = {},
): Promise<AnexoComCaminho | null> {
  if (!/^[0-9a-f-]{36}$/i.test(anexoId)) return null;
  const r = await c.query<LinhaDoAnexo>(
    `select ${COLUNAS} from anexos where empresa_id = empresa_ativa() and tarefa_id = $1 and id = $2
      ${opcoes.paraAgente ? `and ${PARA_AGENTE}` : ""} ${opcoes.paraMudar ? "for update" : ""}`,
    [tarefaId, anexoId],
  );
  const l = r.rows[0];
  return l ? paraAnexo(l) : null;
}

/** Cria o anexo em "enviando", com o caminho na quarentena. */
export async function criarAnexo(
  c: pg.PoolClient,
  d: {
    tarefaId: string;
    comentarioId: string | null;
    nome: string;
    tipo: string;
    tamanho: number;
    pessoaId: string;
  },
): Promise<AnexoComCaminho> {
  const r = await c.query<LinhaDoAnexo>(
    `insert into anexos (empresa_id, tarefa_id, comentario_id, nome, tipo, tamanho, caminho, enviado_por_pessoa_id)
     values (empresa_ativa(), $1, $2, $3, $4, $5, 'quarentena/' || empresa_ativa() || '/' || $6, $7)
     returning ${COLUNAS}`,
    [d.tarefaId, d.comentarioId, d.nome.trim(), d.tipo, d.tamanho, randomUUID(), d.pessoaId],
  );
  return paraAnexo(r.rows[0] as LinhaDoAnexo);
}

/** O arquivo chegou inteiro: vai para o antivírus. */
export async function marcarVerificando(c: pg.PoolClient, anexoId: string): Promise<void> {
  await c.query(
    "update anexos set situacao = 'verificando' where id = $1 and empresa_id = empresa_ativa() and situacao = 'enviando'",
    [anexoId],
  );
}

export async function excluirAnexo(c: pg.PoolClient, anexoId: string): Promise<void> {
  await c.query("delete from anexos where id = $1 and empresa_id = empresa_ativa()", [anexoId]);
}

/** Bytes ocupados pelos anexos da empresa ativa (os que estão ou vão ficar no depósito). */
export async function espacoDaEmpresa(c: pg.PoolClient): Promise<number> {
  const r = await c.query<{ total: string }>(
    "select coalesce(sum(tamanho), 0) as total from anexos where empresa_id = empresa_ativa() and situacao in ('verificando', 'disponivel')",
  );
  return Number(r.rows[0]?.total ?? "0");
}

export interface ServicosDosAnexos {
  deposito: Deposito;
  antivirus: Antivirus;
}

type Log = { warn(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void };

/**
 * Trabalho da fila: passa os anexos da quarentena pelo antivírus (o limpo vai para o lugar definitivo; o infectado é
 * apagado e avisado), apaga os envios parados há mais de uma hora e os arquivos que sobraram de anexos excluídos.
 * O arquivo é lido e conferido fora de transação; uma empresa com erro não para as outras.
 */
export async function cuidarDosAnexos(
  poolApp: pg.Pool,
  s: ServicosDosAnexos,
  log: Log,
): Promise<{ liberados: number; bloqueados: number; apagados: number }> {
  const total = { liberados: 0, bloqueados: 0, apagados: 0 };
  const empresas = await poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_anexos_para_cuidar()",
  );
  for (const { empresa_id } of empresas.rows) {
    try {
      const naEmpresa = <T>(t: (c: pg.PoolClient) => Promise<T>) => comEmpresa(poolApp, empresa_id, t);
      const esperando = await naEmpresa(async (c) => {
        // Envio parado há mais de uma hora: some (o gatilho deixa o arquivo, se chegou algo, para apagar).
        await c.query(
          "delete from anexos where empresa_id = empresa_ativa() and situacao = 'enviando' and enviado_em < now() - interval '1 hour'",
        );
        const r = await c.query<LinhaDoAnexo>(
          `select ${COLUNAS} from anexos where empresa_id = empresa_ativa() and situacao = 'verificando'
            order by enviado_em limit 20`,
        );
        return r.rows.map(paraAnexo);
      });
      /** Apaga do depósito; se falhar, deixa para a fila tentar de novo (nada fica perdido no bucket). */
      const apagarOuDeixar = async (caminho: string) => {
        try {
          await s.deposito.apagar(caminho);
        } catch {
          await naEmpresa((c) =>
            c.query("insert into arquivos_para_apagar (empresa_id, caminho) values (empresa_ativa(), $1)", [
              caminho,
            ]),
          );
        }
      };
      /** Bloqueia, avisa quem enviou e os administradores, e registra. */
      const bloquear = async (anexo: AnexoComCaminho, achado: string) => {
        const avisou = await naEmpresa(async (c) => {
          const r = await c.query(
            `update anexos set situacao = 'bloqueado', verificado_em = now(), achado_do_antivirus = $2
              where id = $1 and empresa_id = empresa_ativa() and situacao = 'verificando'`,
            [anexo.id, achado.slice(0, 200)],
          );
          if ((r.rowCount ?? 0) === 0) return false;
          const pessoas = await c.query<{ pessoa_id: string }>(
            `select pessoa_id from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
               and (perfil = 'administrador' or pessoa_id = $1)`,
            [anexo.enviadoPor.tipo === "pessoa" ? anexo.enviadoPor.pessoaId : null],
          );
          for (const p of pessoas.rows) {
            await criarAviso(c, {
              pessoaId: p.pessoa_id,
              tipo: "anexo_bloqueado",
              texto: `O antivírus bloqueou o anexo "${anexo.nome}" e o arquivo foi apagado.`,
              link: `/tarefas/${anexo.tarefaId}`,
            });
          }
          return true;
        });
        if (avisou) {
          await auditar(
            poolApp,
            {
              empresaId: empresa_id,
              ator: { tipo: "sistema", servico: "antivirus" },
              acao: "anexo.bloqueou",
              alvo: { tipo: "tarefa", id: anexo.tarefaId },
              origem: { canal: "sistema", ip: null, aparelho: null },
              detalhes: { anexoId: anexo.id, achado: achado.slice(0, 200) },
            },
            log,
          );
        }
        return avisou;
      };
      /** Confere um anexo. O lugar definitivo recebe exatamente os bytes conferidos (não uma cópia da quarentena). */
      const conferirUm = async (anexo: AnexoComCaminho): Promise<"liberado" | "bloqueado" | "nada"> => {
        const dados = await s.deposito.ler(anexo.caminho);
        if (dados.length !== anexo.tamanho) throw new Error("O arquivo da quarentena mudou de tamanho");
        const resultado = await s.antivirus.conferir(dados);
        if (!resultado.limpo) {
          await apagarOuDeixar(anexo.caminho);
          return (await bloquear(anexo, resultado.achado)) ? "bloqueado" : "nada";
        }
        const final = `empresas/${empresa_id}/anexos/${anexo.id}`;
        await s.deposito.gravar(final, dados, anexo.tipo);
        const mudou = await naEmpresa(async (c) => {
          const r = await c.query(
            `update anexos set situacao = 'disponivel', caminho = $2, verificado_em = now()
              where id = $1 and empresa_id = empresa_ativa() and situacao = 'verificando'`,
            [anexo.id, final],
          );
          return (r.rowCount ?? 0) > 0;
        });
        // Se o anexo foi excluído no meio, o arquivo novo também sai.
        await apagarOuDeixar(mudou ? anexo.caminho : final);
        return mudou ? "liberado" : "nada";
      };
      for (const anexo of esperando) {
        try {
          const resultado = await conferirUm(anexo);
          if (resultado === "liberado") total.liberados += 1;
          if (resultado === "bloqueado") total.bloqueados += 1;
        } catch (erro) {
          log.error(
            { erro, evento: "anexos.antivirus_falhou", anexoId: anexo.id },
            "Anexo não foi conferido",
          );
          // Um dia tentando sem conseguir: o anexo não é liberado nunca sem a conferência; sai como bloqueado.
          if (Date.now() - new Date(anexo.enviadoEm).getTime() > 24 * 60 * 60 * 1000) {
            await apagarOuDeixar(anexo.caminho);
            await bloquear(anexo, "Não foi possível conferir o arquivo");
          }
        }
      }
      // Arquivos de anexos excluídos (ou que sobraram de envios parados).
      const paraApagar = await naEmpresa(async (c) => {
        const r = await c.query<{ id: string; caminho: string }>(
          "select id, caminho from arquivos_para_apagar where empresa_id = empresa_ativa() order by desde limit 100",
        );
        return r.rows;
      });
      for (const a of paraApagar) {
        try {
          await s.deposito.apagar(a.caminho);
          await naEmpresa((c) => c.query("delete from arquivos_para_apagar where id = $1", [a.id]));
          total.apagados += 1;
        } catch (erro) {
          log.warn(
            { erro, evento: "anexos.apagar_falhou" },
            "Arquivo não foi apagado do depósito (tenta de novo)",
          );
        }
      }
    } catch (erro) {
      log.error({ erro, evento: "anexos.empresa_falhou" }, "Anexos de uma empresa não foram cuidados");
    }
  }
  return total;
}

/** Espaço de todos os anexos, para o aviso de espaço (5 GB na conta gratuita do Backblaze). */
export async function espacoTotal(poolApp: pg.Pool): Promise<number> {
  const r = await poolApp.query<{ total: string }>("select espaco_total_dos_anexos() as total");
  return Number(r.rows[0]?.total ?? "0");
}
