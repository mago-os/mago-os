/**
 * Contas de IA (M4-01): leitura, gravação e os modelos de cada conta. Cada função roda dentro da transação de quem
 * chamou (comPessoa ou comEmpresa), então o banco já isola a empresa. A coluna chave_cifrada só sai daqui para o
 * cofre: as funções que devolvem contas para fora nunca a selecionam.
 */
import type {
  ContaDeIa,
  ContaDeIaNaLista,
  ModeloDaConta,
  ModeloEscolhido,
  ModelosDoAgente,
} from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";

const COLUNAS = `id, empresa_id, nome, provedor, endereco, final_da_chave, situacao, ultimo_erro, teto_mensal,
  testada_em, criada_por, criada_em, atualizada_em`;

interface LinhaDaConta {
  id: string;
  empresa_id: string;
  nome: string;
  provedor: ContaDeIa["provedor"];
  endereco: string | null;
  final_da_chave: string;
  situacao: ContaDeIa["situacao"];
  ultimo_erro: string | null;
  teto_mensal: number | null;
  testada_em: Date | null;
  criada_por: string;
  criada_em: Date;
  atualizada_em: Date;
}

function paraConta(l: LinhaDaConta): ContaDeIa {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    nome: l.nome,
    provedor: l.provedor,
    endereco: l.endereco,
    // Até a migração da M4-10, toda conta é por chave de API.
    credencial: "chave_de_api",
    termosAceitosPor: null,
    termosAceitosEm: null,
    limiteDoPlanoAte: null,
    finalDaChave: l.final_da_chave,
    situacao: l.situacao,
    ultimoErro: l.ultimo_erro,
    tetoMensal: l.teto_mensal,
    testadaEm: l.testada_em?.toISOString() ?? null,
    criadaPor: l.criada_por,
    criadaEm: l.criada_em.toISOString(),
    atualizadaEm: l.atualizada_em.toISOString(),
  };
}

export type ContaNaLista = ContaDeIaNaLista;

export async function listarContas(c: pg.PoolClient): Promise<ContaNaLista[]> {
  const r = await c.query<LinhaDaConta & { modelos: number; liberados: number }>(
    `select ${COLUNAS},
            (select count(*)::int from modelos_de_conta_de_ia m where m.conta_id = contas_de_ia.id) as modelos,
            (select count(*)::int from modelos_de_conta_de_ia m
              where m.conta_id = contas_de_ia.id and m.liberado and not m.sumiu) as liberados
       from contas_de_ia where empresa_id = empresa_ativa() order by lower(nome)`,
  );
  return r.rows.map((l) => ({ ...paraConta(l), modelos: l.modelos, liberados: l.liberados }));
}

export async function buscarConta(
  c: pg.PoolClient,
  id: string,
  paraMudar = false,
): Promise<ContaDeIa | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDaConta>(
    `select ${COLUNAS} from contas_de_ia where id = $1 and empresa_id = empresa_ativa() ${paraMudar ? "for update" : ""}`,
    [id],
  );
  return r.rows[0] ? paraConta(r.rows[0]) : null;
}

/** Só para o cofre abrir a chave na hora de chamar o provedor. */
export async function chaveCifradaDaConta(c: pg.PoolClient, id: string): Promise<Buffer | null> {
  const r = await c.query<{ chave_cifrada: Buffer }>(
    "select chave_cifrada from contas_de_ia where id = $1 and empresa_id = empresa_ativa()",
    [id],
  );
  return r.rows[0]?.chave_cifrada ?? null;
}

export async function novoId(c: pg.PoolClient): Promise<string> {
  const r = await c.query<{ id: string }>("select uuidv7() as id");
  return r.rows[0]?.id as string;
}

export interface DadosDaNovaConta {
  id: string;
  nome: string;
  provedor: ContaDeIa["provedor"];
  endereco: string | null;
  chaveCifrada: Buffer;
  finalDaChave: string;
  tetoMensal: number | null;
  criadaPor: string;
}

export async function gravarConta(c: pg.PoolClient, d: DadosDaNovaConta): Promise<ContaDeIa> {
  const r = await c.query<LinhaDaConta>(
    `insert into contas_de_ia (id, empresa_id, nome, provedor, endereco, chave_cifrada, final_da_chave, teto_mensal,
       testada_em, criada_por)
     values ($1, empresa_ativa(), $2, $3, $4, $5, $6, $7, now(), $8) returning ${COLUNAS}`,
    [d.id, d.nome.trim(), d.provedor, d.endereco, d.chaveCifrada, d.finalDaChave, d.tetoMensal, d.criadaPor],
  );
  return paraConta(r.rows[0] as LinhaDaConta);
}

export async function mudarConta(
  c: pg.PoolClient,
  id: string,
  m: { nome?: string; tetoMensal?: number | null; chaveCifrada?: Buffer; finalDaChave?: string },
): Promise<ContaDeIa> {
  const r = await c.query<LinhaDaConta>(
    `update contas_de_ia set
        nome = coalesce($2, nome),
        teto_mensal = case when $3::boolean then $4::integer else teto_mensal end,
        chave_cifrada = coalesce($5, chave_cifrada),
        final_da_chave = coalesce($6, final_da_chave),
        situacao = case when $5::bytea is null then situacao else 'ativa' end,
        ultimo_erro = case when $5::bytea is null then ultimo_erro else null end,
        testada_em = case when $5::bytea is null then testada_em else now() end,
        atualizada_em = now()
      where id = $1 and empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [
      id,
      m.nome?.trim() ?? null,
      m.tetoMensal !== undefined,
      m.tetoMensal ?? null,
      m.chaveCifrada ?? null,
      m.finalDaChave ?? null,
    ],
  );
  return paraConta(r.rows[0] as LinhaDaConta);
}

export async function marcarTeste(c: pg.PoolClient, id: string, erro: string | null): Promise<ContaDeIa> {
  const r = await c.query<LinhaDaConta>(
    `update contas_de_ia set situacao = $2, ultimo_erro = $3, testada_em = now(), atualizada_em = now()
      where id = $1 and empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [id, erro === null ? "ativa" : "com_erro", erro],
  );
  return paraConta(r.rows[0] as LinhaDaConta);
}

export async function apagarConta(c: pg.PoolClient, id: string): Promise<void> {
  await c.query("delete from contas_de_ia where id = $1 and empresa_id = empresa_ativa()", [id]);
}

interface LinhaDoModelo {
  conta_id: string;
  modelo: string;
  liberado: boolean;
  sumiu: boolean;
  descoberto_em: Date;
}

const paraModelo = (l: LinhaDoModelo): ModeloDaConta => ({
  contaId: l.conta_id,
  modelo: l.modelo,
  liberado: l.liberado,
  sumiu: l.sumiu,
  descobertoEm: l.descoberto_em.toISOString(),
});

export async function listarModelos(c: pg.PoolClient, contaId: string): Promise<ModeloDaConta[]> {
  const r = await c.query<LinhaDoModelo>(
    `select conta_id, modelo, liberado, sumiu, descoberto_em from modelos_de_conta_de_ia
      where conta_id = $1 and empresa_id = empresa_ativa() order by sumiu, liberado desc, modelo`,
    [contaId],
  );
  return r.rows.map(paraModelo);
}

/**
 * Acerta os modelos da conta com a lista que o provedor devolveu: os novos entram desligados, os que sumiram ficam
 * marcados (e não podem ser escolhidos), os que voltaram deixam de estar marcados. Devolve quantos são novos.
 */
export async function acertarModelos(c: pg.PoolClient, contaId: string, modelos: string[]): Promise<number> {
  // Lista vazia (formato que não conhecemos, ou o provedor com problema): não marca tudo como "saiu", senão os
  // agentes perderiam o modelo com a conta funcionando.
  if (modelos.length === 0) return 0;
  const novos = await c.query(
    `insert into modelos_de_conta_de_ia (empresa_id, conta_id, modelo)
     select empresa_ativa(), $1, m from unnest($2::text[]) as m
     on conflict (conta_id, modelo) do nothing`,
    [contaId, modelos],
  );
  await c.query(
    `update modelos_de_conta_de_ia set sumiu = not (modelo = any($2::text[]))
      where conta_id = $1 and empresa_id = empresa_ativa()`,
    [contaId, modelos],
  );
  return novos.rowCount ?? 0;
}

/** Agentes que usam um modelo (principal ou reserva). */
export async function agentesQueUsam(
  c: pg.PoolClient,
  contaId: string,
  modelos: string[],
): Promise<string[]> {
  const r = await c.query<{ nome: string }>(
    `select nome from agentes where empresa_id = empresa_ativa()
        and ((modelo_principal_conta_id = $1 and modelo_principal = any($2::text[]))
          or (modelo_reserva_conta_id = $1 and modelo_reserva = any($2::text[])))
      order by lower(nome)`,
    [contaId, modelos],
  );
  return r.rows.map((l) => l.nome);
}

export async function liberarModelos(
  c: pg.PoolClient,
  contaId: string,
  mudancas: { modelo: string; liberado: boolean }[],
): Promise<{ liberados: string[]; desligados: string[] }> {
  const liberados: string[] = [];
  const desligados: string[] = [];
  for (const m of mudancas) {
    const r = await c.query(
      `update modelos_de_conta_de_ia set liberado = $3
        where conta_id = $1 and modelo = $2 and empresa_id = empresa_ativa() and liberado <> $3
          and (not $3 or not sumiu)`,
      [contaId, m.modelo, m.liberado],
    );
    if ((r.rowCount ?? 0) > 0) (m.liberado ? liberados : desligados).push(m.modelo);
  }
  return { liberados, desligados };
}

export async function modelosDoAgente(c: pg.PoolClient, agenteId: string): Promise<ModelosDoAgente | null> {
  if (!FORMATO_UUID.test(agenteId)) return null;
  const r = await c.query<{
    pc: string | null;
    pm: string | null;
    rc: string | null;
    rm: string | null;
  }>(
    `select modelo_principal_conta_id as pc, modelo_principal as pm, modelo_reserva_conta_id as rc,
            modelo_reserva as rm
       from agentes where id = $1 and empresa_id = empresa_ativa()`,
    [agenteId],
  );
  const l = r.rows[0];
  if (!l?.pc || !l.pm) return null;
  return {
    principal: { contaId: l.pc, modelo: l.pm },
    reserva: l.rc && l.rm ? { contaId: l.rc, modelo: l.rm } : null,
  };
}

/** Por que um modelo não pode ser usado agora (null: pode). O teto de gasto entra na M4-06. */
export async function modeloIndisponivel(c: pg.PoolClient, m: ModeloEscolhido): Promise<string | null> {
  const r = await c.query<{ situacao: string; liberado: boolean; sumiu: boolean }>(
    `select ct.situacao, mo.liberado, mo.sumiu
       from modelos_de_conta_de_ia mo join contas_de_ia ct on ct.id = mo.conta_id
      where mo.conta_id = $1 and mo.modelo = $2 and mo.empresa_id = empresa_ativa()`,
    [m.contaId, m.modelo],
  );
  const l = r.rows[0];
  if (!l) return "o modelo não existe mais na conta";
  if (l.situacao !== "ativa") return "a conta de IA está com erro";
  if (!l.liberado) return "o modelo foi desligado";
  if (l.sumiu) return "o provedor não oferece mais o modelo";
  return null;
}

export async function escolherModelos(
  c: pg.PoolClient,
  agenteId: string,
  m: ModelosDoAgente | null,
): Promise<void> {
  await c.query(
    `update agentes set modelo_principal_conta_id = $2, modelo_principal = $3, modelo_reserva_conta_id = $4,
            modelo_reserva = $5, atualizado_em = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [
      agenteId,
      m?.principal.contaId ?? null,
      m?.principal.modelo ?? null,
      m?.reserva?.contaId ?? null,
      m?.reserva?.modelo ?? null,
    ],
  );
}
