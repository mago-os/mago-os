/**
 * Instruções em camadas e skills (M4-05, decisão 0027). Cada função roda na transação do chamador, que já conferiu a
 * permissão. A camada e as skills da plataforma vêm do contrato (código); as da empresa, do banco, com versões.
 */
import {
  CARACTERES_RECOMENDADOS,
  type CamadaDaEmpresa,
  INSTRUCOES_DA_PLATAFORMA,
  type InstrucoesMontadas,
  SKILLS_DA_PLATAFORMA,
  type Skill,
  type VersaoDeInstrucoes,
  type VersaoDeSkill,
} from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";

// Instruções -----------------------------------------------------------------------------------------------------

interface LinhaDaVersao {
  id: string;
  empresa_id: string;
  camada: CamadaDaEmpresa;
  projeto_id: string | null;
  agente_id: string | null;
  versao: number;
  texto: string;
  autor_id: string | null;
  voltou_de: number | null;
  criada_em: Date;
}

const paraVersao = (l: LinhaDaVersao): VersaoDeInstrucoes => ({
  id: l.id,
  empresaId: l.empresa_id,
  camada: l.camada,
  alvoId: l.projeto_id ?? l.agente_id,
  versao: l.versao,
  texto: l.texto,
  autorId: l.autor_id,
  voltouDe: l.voltou_de,
  criadaEm: l.criada_em.toISOString(),
});

function alvoDaCamada(camada: CamadaDaEmpresa, alvoId: string | null) {
  return {
    projeto: camada === "projeto" ? alvoId : null,
    agente: camada === "agente" ? alvoId : null,
  };
}

/** As versões de uma camada, da mais nova para a mais antiga (até 100). */
export async function listarVersoes(
  c: pg.PoolClient,
  camada: CamadaDaEmpresa,
  alvoId: string | null,
): Promise<VersaoDeInstrucoes[]> {
  const a = alvoDaCamada(camada, alvoId);
  const r = await c.query<LinhaDaVersao>(
    `select * from versoes_de_instrucoes
      where empresa_id = empresa_ativa() and camada = $1
        and projeto_id is not distinct from $2 and agente_id is not distinct from $3
      order by versao desc limit 100`,
    [camada, a.projeto, a.agente],
  );
  return r.rows.map(paraVersao);
}

/** Salva uma versão nova da camada (a numeração segue, mesmo com dois salvando ao mesmo tempo). */
export async function salvarInstrucoes(
  c: pg.PoolClient,
  camada: CamadaDaEmpresa,
  alvoId: string | null,
  texto: string,
  autorId: string,
  voltouDe: number | null = null,
): Promise<VersaoDeInstrucoes> {
  const a = alvoDaCamada(camada, alvoId);
  await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `instrucoes:${camada}:${alvoId ?? "empresa"}`,
  ]);
  const r = await c.query<LinhaDaVersao>(
    `insert into versoes_de_instrucoes (empresa_id, camada, projeto_id, agente_id, versao, texto, autor_id, voltou_de)
     values (empresa_ativa(), $1, $2, $3,
             coalesce((select max(versao) from versoes_de_instrucoes where empresa_id = empresa_ativa()
                        and camada = $1 and projeto_id is not distinct from $2 and agente_id is not distinct from $3),
                      0) + 1,
             $4, $5, $6)
     returning *`,
    [camada, a.projeto, a.agente, texto, autorId, voltouDe],
  );
  return paraVersao(r.rows[0] as LinhaDaVersao);
}

async function textoAtual(c: pg.PoolClient, camada: CamadaDaEmpresa, alvoId: string | null) {
  return (await listarVersoes(c, camada, alvoId))[0] ?? null;
}

/**
 * O texto final que um agente recebe: plataforma, empresa, projeto (o da tarefa, se houver) e o do agente, nessa
 * ordem, com um título por camada. As camadas vazias não entram (a da plataforma sempre entra).
 */
export async function montarInstrucoes(
  c: pg.PoolClient,
  agenteId: string,
  tarefaId: string | null,
): Promise<InstrucoesMontadas> {
  const agente = await c.query<{ nome: string }>(
    "select nome from agentes where id = $1 and empresa_id = empresa_ativa()",
    [agenteId],
  );
  const projeto =
    tarefaId && FORMATO_UUID.test(tarefaId)
      ? (
          await c.query<{ id: string; nome: string }>(
            `select p.id, p.nome from tarefas t join projetos p on p.id = t.projeto_id and p.empresa_id = t.empresa_id
              where t.id = $1 and t.empresa_id = empresa_ativa()`,
            [tarefaId],
          )
        ).rows[0]
      : undefined;
  const camadas: InstrucoesMontadas["camadas"] = [];
  const partes: string[] = [];
  const juntar = (
    camada: InstrucoesMontadas["camadas"][number]["camada"],
    nome: string,
    titulo: string,
    versao: number | null,
    texto: string,
  ) => {
    const limpo = texto.trim();
    if (!limpo && camada !== "plataforma") return;
    camadas.push({ camada, nome, versao, caracteres: limpo.length });
    partes.push(`# ${titulo}\n\n${limpo}`);
  };
  juntar(
    "plataforma",
    "Plataforma",
    "Instruções da plataforma (valem sempre)",
    null,
    INSTRUCOES_DA_PLATAFORMA,
  );
  const daEmpresa = await textoAtual(c, "empresa", null);
  if (daEmpresa) juntar("empresa", "Empresa", "Instruções da empresa", daEmpresa.versao, daEmpresa.texto);
  if (projeto) {
    const doProjeto = await textoAtual(c, "projeto", projeto.id);
    if (doProjeto)
      juntar(
        "projeto",
        projeto.nome,
        `Instruções do projeto ${projeto.nome}`,
        doProjeto.versao,
        doProjeto.texto,
      );
  }
  const doAgente = await textoAtual(c, "agente", agenteId);
  const nomeDoAgente = agente.rows[0]?.nome ?? "Agente";
  if (doAgente)
    juntar("agente", nomeDoAgente, `Instruções para você (${nomeDoAgente})`, doAgente.versao, doAgente.texto);
  const texto = partes.join("\n\n");
  return {
    texto,
    camadas,
    caracteres: texto.length,
    passouDoRecomendado: texto.length > CARACTERES_RECOMENDADOS,
  };
}

// Skills ---------------------------------------------------------------------------------------------------------

const PREFIXO = "plataforma:";
const daPlataforma = (nome: string) => SKILLS_DA_PLATAFORMA.find((s) => s.nome === nome);

interface LinhaDaVersaoDeSkill {
  skill_id: string;
  versao: number;
  situacao: "rascunho" | "publicada";
  descricao: string;
  texto: string;
  autor_id: string | null;
  criada_em: Date;
}

const paraVersaoDeSkill = (l: LinhaDaVersaoDeSkill): VersaoDeSkill => ({
  skillId: l.skill_id,
  versao: l.versao,
  situacao: l.situacao,
  descricao: l.descricao,
  texto: l.texto,
  autorId: l.autor_id,
  criadaEm: l.criada_em.toISOString(),
});

/** As skills da biblioteca (plataforma e empresa), com a versão publicada e os agentes de cada uma. */
export async function listarSkills(c: pg.PoolClient): Promise<Skill[]> {
  const atribuicoes = await c.query<{
    agente_id: string;
    skill_id: string | null;
    skill_da_plataforma: string | null;
  }>(
    `select a.agente_id, a.skill_id, a.skill_da_plataforma from skills_do_agente a
       join agentes g on g.id = a.agente_id and g.empresa_id = a.empresa_id
      where a.empresa_id = empresa_ativa() and g.situacao <> 'desligado'`,
  );
  const agentesDe = (id: string) =>
    atribuicoes.rows
      .filter((a) => (a.skill_id ?? `${PREFIXO}${a.skill_da_plataforma}`) === id)
      .map((a) => a.agente_id);
  const daEmpresa = await c.query<{
    id: string;
    nome: string;
    atualizada_em: Date;
    publicada: number | null;
    descricao: string | null;
    rascunho: boolean;
  }>(
    `select s.id, s.nome, s.atualizada_em,
            (select max(v.versao) from versoes_de_skills v where v.skill_id = s.id and v.situacao = 'publicada') as publicada,
            (select v.descricao from versoes_de_skills v where v.skill_id = s.id order by v.versao desc limit 1) as descricao,
            exists (select 1 from versoes_de_skills v where v.skill_id = s.id and v.situacao = 'rascunho') as rascunho
       from skills s where s.empresa_id = empresa_ativa() order by s.nome`,
  );
  return [
    ...SKILLS_DA_PLATAFORMA.map((s) => ({
      id: `${PREFIXO}${s.nome}`,
      origem: "plataforma" as const,
      nome: s.nome,
      descricao: s.descricao,
      versaoPublicada: 1,
      temRascunho: false,
      agentes: agentesDe(`${PREFIXO}${s.nome}`),
      atualizadaEm: null,
    })),
    ...daEmpresa.rows.map((s) => ({
      id: s.id,
      origem: "empresa" as const,
      nome: s.nome,
      descricao: s.descricao ?? "",
      versaoPublicada: s.publicada,
      temRascunho: s.rascunho,
      agentes: agentesDe(s.id),
      atualizadaEm: s.atualizada_em.toISOString(),
    })),
  ];
}

/** As versões de uma skill (as da plataforma têm uma só, a do código). */
export async function versoesDaSkill(c: pg.PoolClient, skillId: string): Promise<VersaoDeSkill[] | null> {
  if (skillId.startsWith(PREFIXO)) {
    const s = daPlataforma(skillId.slice(PREFIXO.length));
    return s
      ? [
          {
            skillId,
            versao: 1,
            situacao: "publicada",
            descricao: s.descricao,
            texto: s.texto,
            autorId: null,
            criadaEm: new Date(0).toISOString(),
          },
        ]
      : null;
  }
  if (!FORMATO_UUID.test(skillId)) return null;
  const existe = await c.query("select 1 from skills where id = $1 and empresa_id = empresa_ativa()", [
    skillId,
  ]);
  if ((existe.rowCount ?? 0) === 0) return null;
  const r = await c.query<LinhaDaVersaoDeSkill>(
    `select skill_id, versao, situacao, descricao, texto, autor_id, criada_em from versoes_de_skills
      where skill_id = $1 and empresa_id = empresa_ativa() order by versao desc limit 100`,
    [skillId],
  );
  return r.rows.map(paraVersaoDeSkill);
}

/** Cria uma skill da empresa, com a primeira versão em rascunho. Nome repetido (ou de uma da plataforma): null. */
export async function criarSkill(
  c: pg.PoolClient,
  d: { nome: string; descricao: string; texto: string },
  autorId: string,
): Promise<string | null> {
  if (daPlataforma(d.nome)) return null;
  const s = await c.query<{ id: string }>(
    "insert into skills (empresa_id, nome) values (empresa_ativa(), $1) on conflict (empresa_id, nome) do nothing returning id",
    [d.nome],
  );
  const id = s.rows[0]?.id;
  if (!id) return null;
  await c.query(
    `insert into versoes_de_skills (empresa_id, skill_id, versao, descricao, texto, autor_id)
     values (empresa_ativa(), $1, 1, $2, $3, $4)`,
    [id, d.descricao.trim(), d.texto, autorId],
  );
  return id;
}

/** Salva o rascunho (cria o da versão seguinte se só houver publicadas). */
export async function salvarRascunho(
  c: pg.PoolClient,
  skillId: string,
  d: { descricao: string; texto: string },
  autorId: string,
): Promise<boolean> {
  if (!FORMATO_UUID.test(skillId)) return false;
  const s = await c.query("select 1 from skills where id = $1 and empresa_id = empresa_ativa() for update", [
    skillId,
  ]);
  if ((s.rowCount ?? 0) === 0) return false;
  const mudou = await c.query(
    `update versoes_de_skills set descricao = $2, texto = $3, autor_id = $4, criada_em = now()
      where skill_id = $1 and empresa_id = empresa_ativa() and situacao = 'rascunho'`,
    [skillId, d.descricao.trim(), d.texto, autorId],
  );
  if ((mudou.rowCount ?? 0) === 0)
    await c.query(
      `insert into versoes_de_skills (empresa_id, skill_id, versao, descricao, texto, autor_id)
       values (empresa_ativa(), $1,
               (select max(versao) + 1 from versoes_de_skills where skill_id = $1 and empresa_id = empresa_ativa()),
               $2, $3, $4)`,
      [skillId, d.descricao.trim(), d.texto, autorId],
    );
  await c.query("update skills set atualizada_em = now() where id = $1 and empresa_id = empresa_ativa()", [
    skillId,
  ]);
  return true;
}

/** Publica o rascunho: daí em diante os agentes recebem essa versão. Sem rascunho: null. */
export async function publicarSkill(c: pg.PoolClient, skillId: string): Promise<number | null> {
  if (!FORMATO_UUID.test(skillId)) return null;
  const r = await c.query<{ versao: number }>(
    `update versoes_de_skills set situacao = 'publicada', publicada_em = now()
      where skill_id = $1 and empresa_id = empresa_ativa() and situacao = 'rascunho' returning versao`,
    [skillId],
  );
  if (!r.rows[0]) return null;
  await c.query("update skills set atualizada_em = now() where id = $1 and empresa_id = empresa_ativa()", [
    skillId,
  ]);
  return r.rows[0].versao;
}

/** As skills (publicadas) de um agente, com o texto. */
export async function skillsDoAgente(
  c: pg.PoolClient,
  agenteId: string,
): Promise<{ id: string; nome: string; descricao: string; versao: number; texto: string }[]> {
  const r = await c.query<{ skill_id: string | null; skill_da_plataforma: string | null }>(
    "select skill_id, skill_da_plataforma from skills_do_agente where agente_id = $1 and empresa_id = empresa_ativa()",
    [agenteId],
  );
  const lista: { id: string; nome: string; descricao: string; versao: number; texto: string }[] = [];
  for (const a of r.rows) {
    if (a.skill_da_plataforma) {
      const s = daPlataforma(a.skill_da_plataforma);
      if (s)
        lista.push({
          id: `${PREFIXO}${s.nome}`,
          nome: s.nome,
          descricao: s.descricao,
          versao: 1,
          texto: s.texto,
        });
      continue;
    }
    const v = await c.query<{ nome: string; descricao: string; versao: number; texto: string }>(
      `select s.nome, v.descricao, v.versao, v.texto from skills s
         join versoes_de_skills v on v.skill_id = s.id and v.situacao = 'publicada'
        where s.id = $1 and s.empresa_id = empresa_ativa() order by v.versao desc limit 1`,
      [a.skill_id],
    );
    const s = v.rows[0];
    if (s) lista.push({ id: a.skill_id as string, ...s });
  }
  return lista.sort((x, y) => x.nome.localeCompare(y.nome));
}

/** Troca a lista de skills de um agente. Uma skill que não existe: devolve o id dela, e nada muda. */
export async function definirSkillsDoAgente(
  c: pg.PoolClient,
  agenteId: string,
  ids: string[],
  pessoaId: string | null,
): Promise<{ desconhecida: string } | { antes: string[]; depois: string[] }> {
  for (const id of ids) {
    if (id.startsWith(PREFIXO) ? !daPlataforma(id.slice(PREFIXO.length)) : !FORMATO_UUID.test(id))
      return { desconhecida: id };
    if (!id.startsWith(PREFIXO)) {
      const e = await c.query("select 1 from skills where id = $1 and empresa_id = empresa_ativa()", [id]);
      if ((e.rowCount ?? 0) === 0) return { desconhecida: id };
    }
  }
  const antes = await c.query<{ id: string }>(
    `select coalesce(skill_id::text, 'plataforma:' || skill_da_plataforma) as id from skills_do_agente
      where agente_id = $1 and empresa_id = empresa_ativa()`,
    [agenteId],
  );
  await c.query("delete from skills_do_agente where agente_id = $1 and empresa_id = empresa_ativa()", [
    agenteId,
  ]);
  for (const id of ids)
    await c.query(
      `insert into skills_do_agente (empresa_id, agente_id, skill_id, skill_da_plataforma, atribuida_por)
       values (empresa_ativa(), $1, $2, $3, $4)`,
      [
        agenteId,
        id.startsWith(PREFIXO) ? null : id,
        id.startsWith(PREFIXO) ? id.slice(PREFIXO.length) : null,
        pessoaId,
      ],
    );
  return { antes: antes.rows.map((l) => l.id).sort(), depois: [...ids].sort() };
}
