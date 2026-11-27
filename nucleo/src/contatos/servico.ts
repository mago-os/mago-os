/**
 * Contatos (M7-01, decisão 0045): pessoas e organizações de fora da empresa. Quem vê e quem mexe vem do alcance do
 * módulo "contatos" (tudo, equipe ou meus); o banco isola as empresas. "Meus": sou o responsável, cadastrei, ou o
 * contato está ligado a um projeto de que sou membro. Cada função recebe uma lista de quem olha: na tela é a pessoa;
 * no agente, quem pediu e o responsável por ele (vale o menor dos dois, M4-04).
 */
import type {
  Alcance,
  AvisoDeRepetido,
  Contato,
  FiltroDeContatos,
  Identificador,
  PapelDeContato,
  PedidoDeContato,
  PedidoDeEditarContato,
  PedidoDeVisaoDeContatos,
  ResumoDoContato,
  SituacaoDeContato,
  TipoDeContato,
  VinculoComOrganizacao,
  VisaoDeContatos,
} from "@mago-os/contratos";
import type pg from "pg";
import { idsForaDaEmpresa, uuidsDe } from "../ids-da-empresa.ts";
import type { PermissoesNaEmpresa } from "../permissoes/verificar.ts";
import { pessoaAtivaNaEmpresa } from "../tarefas/servico.ts";

/** Recusa com texto para a tela e para o agente. */
export class RecusaDosContatos extends Error {}

/** Quem olha: a pessoa, o alcance da ação no módulo e a área dela. */
export interface QuemOlhaContatos {
  pessoaId: string;
  alcance: Alcance;
  area: string | null;
}

export type AcaoNosContatos = "ver" | "criar" | "editar" | "aprovar" | "excluir";

export function quemOlhaContatos(
  p: PermissoesNaEmpresa,
  pessoaId: string,
  acao: AcaoNosContatos,
): QuemOlhaContatos {
  return { pessoaId, alcance: p.modulos.get("contatos")?.acoes[acao] ?? "nada", area: p.area };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A condição SQL (sobre o apelido "k") dos contatos que todos os que olham alcançam. Acrescenta os valores em
 * "valores". Alguém com "nada": nenhum contato.
 */
export function condicaoDosContatos(olham: QuemOlhaContatos[], valores: unknown[], k = "k"): string {
  const v = (x: unknown) => {
    valores.push(x);
    return `$${valores.length}`;
  };
  const partes = olham.map((q) => {
    if (q.alcance === "nada") return "false";
    if (q.alcance === "tudo") return "true";
    const eu = v(q.pessoaId);
    const meus = `(${k}.responsavel_id = ${eu} or ${k}.criado_por = ${eu}
      or exists (select 1 from contatos_de_projeto cp where cp.contato_id = ${k}.id and cp.empresa_id = ${k}.empresa_id
                   and membro_do_projeto(cp.projeto_id, ${eu})))`;
    if (q.alcance === "equipe" && q.area !== null) {
      return `(${meus} or exists (select 1 from vinculos vv where vv.empresa_id = ${k}.empresa_id
                 and vv.pessoa_id = ${k}.responsavel_id and vv.area = ${v(q.area)}))`;
    }
    return meus;
  });
  return partes.length === 0 ? "false" : `(${partes.join(" and ")})`;
}

interface LinhaDoContato {
  id: string;
  empresa_id: string;
  tipo: TipoDeContato;
  nome: string;
  papeis: PapelDeContato[];
  documento: string | null;
  responsavel_id: string | null;
  fuso: string | null;
  observacoes: string | null;
  situacao: SituacaoDeContato;
  juntado_em_id: string | null;
  criado_por: string;
  criado_por_agente_id: string | null;
  criado_em: Date;
  atualizado_em: Date;
  identificadores: LinhaDoIdentificador[];
  organizacoes: { organizacao_id: string; cargo: string | null }[];
  etiquetas: string[];
}

interface LinhaDoIdentificador {
  tipo: "email" | "telefone" | "rede";
  rede: string | null;
  valor: string;
  principal: boolean;
  whatsapp: boolean;
  rotulo: string | null;
}

const COLUNAS = `k.id, k.empresa_id, k.tipo, k.nome, k.papeis, k.documento, k.responsavel_id, k.fuso, k.observacoes,
  k.situacao, k.juntado_em_id, k.criado_por, k.criado_por_agente_id, k.criado_em, k.atualizado_em,
  coalesce((select json_agg(json_build_object('tipo', i.tipo, 'rede', i.rede, 'valor', i.valor, 'principal',
            i.principal, 'whatsapp', i.whatsapp, 'rotulo', i.rotulo) order by i.ordem, i.id)
            from identificadores_de_contato i where i.contato_id = k.id and i.empresa_id = k.empresa_id), '[]')
    as identificadores,
  coalesce((select json_agg(json_build_object('organizacao_id', o.organizacao_id, 'cargo', o.cargo)
            order by o.ordem, o.organizacao_id)
            from contatos_em_organizacoes o where o.pessoa_id = k.id and o.empresa_id = k.empresa_id), '[]')
    as organizacoes,
  coalesce((select array_agg(e.etiqueta_id order by e.etiqueta_id) from etiquetas_de_contato e
            where e.contato_id = k.id and e.empresa_id = k.empresa_id), '{}') as etiquetas`;

function paraIdentificador(i: LinhaDoIdentificador): Identificador {
  if (i.tipo === "email") return { tipo: "email", valor: i.valor, principal: i.principal };
  if (i.tipo === "telefone")
    return {
      tipo: "telefone",
      valor: i.valor,
      principal: i.principal,
      whatsapp: i.whatsapp,
      rotulo: i.rotulo,
    };
  return { tipo: "rede", rede: i.rede as never, valor: i.valor, principal: i.principal };
}

function paraContato(l: LinhaDoContato): Contato {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    tipo: l.tipo,
    nome: l.nome,
    papeis: l.papeis,
    identificadores: l.identificadores.map(paraIdentificador),
    organizacoes: l.organizacoes.map(
      (o): VinculoComOrganizacao => ({ organizacaoId: o.organizacao_id, cargo: o.cargo }),
    ),
    documento: l.documento,
    etiquetas: l.etiquetas,
    responsavelId: l.responsavel_id,
    fuso: l.fuso,
    observacoes: l.observacoes,
    situacao: l.situacao,
    juntadoEmId: l.juntado_em_id,
    criadoPor: l.criado_por,
    criadoPorAgenteId: l.criado_por_agente_id,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

interface LinhaDoResumo {
  id: string;
  tipo: TipoDeContato;
  nome: string;
  papeis: PapelDeContato[];
  email: string | null;
  telefone: string | null;
  organizacao: string | null;
  etiquetas: string[];
  responsavel_id: string | null;
  situacao: SituacaoDeContato;
  repetido: boolean;
}

/**
 * A coluna "repetido" do resumo (pedido do Sandro em 27/11/2026): o contato tem e-mail, telefone ou rede igual ao de
 * outro contato ativo que todos os que olham veem. Só os que eles veem, para a lista não revelar o cadastro de outro.
 */
function colunaDeRepetido(olham: QuemOlhaContatos[], valores: unknown[]): string {
  const ve = condicaoDosContatos(olham, valores, "k2");
  return `exists (select 1 from identificadores_de_contato i
      join identificadores_de_contato j on j.empresa_id = i.empresa_id and j.tipo = i.tipo
       and lower(j.valor) = lower(i.valor) and j.contato_id <> i.contato_id
      join contatos k2 on k2.id = j.contato_id and k2.empresa_id = j.empresa_id and k2.situacao = 'ativo'
     where i.contato_id = k.id and i.empresa_id = k.empresa_id and coalesce(i.rede, '') <> 'site' and ${ve}) as repetido`;
}

const COLUNAS_DO_RESUMO = `k.id, k.tipo, k.nome, k.papeis, k.responsavel_id, k.situacao,
  (select i.valor from identificadores_de_contato i where i.contato_id = k.id and i.empresa_id = k.empresa_id
     and i.tipo = 'email' order by i.principal desc, i.ordem, i.id limit 1) as email,
  (select i.valor from identificadores_de_contato i where i.contato_id = k.id and i.empresa_id = k.empresa_id
     and i.tipo = 'telefone' order by i.principal desc, i.ordem, i.id limit 1) as telefone,
  (select org.nome from contatos_em_organizacoes o join contatos org on org.id = o.organizacao_id
     and org.empresa_id = o.empresa_id where o.pessoa_id = k.id and o.empresa_id = k.empresa_id
     order by o.ordem, o.organizacao_id limit 1) as organizacao,
  coalesce((select array_agg(e.etiqueta_id order by e.etiqueta_id) from etiquetas_de_contato e
            where e.contato_id = k.id and e.empresa_id = k.empresa_id), '{}') as etiquetas`;

const paraResumo = (l: LinhaDoResumo): ResumoDoContato => ({
  id: l.id,
  tipo: l.tipo,
  nome: l.nome,
  papeis: l.papeis,
  emailPrincipal: l.email,
  telefonePrincipal: l.telefone,
  organizacao: l.organizacao,
  etiquetas: l.etiquetas,
  responsavelId: l.responsavel_id,
  situacao: l.situacao,
  repetido: l.repetido,
});

/** Só os dígitos de um texto que parece telefone (para achar "+55 11 98765" e "11987"). */
function digitosDoTelefone(texto: string): string | null {
  const d = texto.replace(/[\s().-]/g, "").replace(/^\+/, "");
  return /^[0-9]{4,15}$/.test(d) ? d : null;
}

/** A lista de contatos que todos os que olham veem, em ordem de nome (até "limite"). */
export async function listarContatos(
  c: pg.PoolClient,
  olham: QuemOlhaContatos[],
  filtro: FiltroDeContatos,
  limite = 200,
): Promise<ResumoDoContato[]> {
  const valores: unknown[] = [];
  const v = (x: unknown) => {
    valores.push(x);
    return `$${valores.length}`;
  };
  const partes = [condicaoDosContatos(olham, valores), `k.situacao = ${v(filtro.situacao ?? "ativo")}`];
  if (filtro.tipo) partes.push(`k.tipo = ${v(filtro.tipo)}`);
  if (filtro.papeis) partes.push(`k.papeis && ${v(filtro.papeis)}::text[]`);
  if (filtro.etiquetas)
    partes.push(`exists (select 1 from etiquetas_de_contato e where e.contato_id = k.id
                  and e.empresa_id = k.empresa_id and e.etiqueta_id = any(${v(filtro.etiquetas)}::uuid[]))`);
  if (filtro.responsaveis) {
    const ids = filtro.responsaveis.filter((r) => r !== "sem");
    const sem = filtro.responsaveis.includes("sem");
    partes.push(`(k.responsavel_id = any(${v(ids)}::uuid[])${sem ? " or k.responsavel_id is null" : ""})`);
  }
  if (filtro.organizacaoId)
    partes.push(`exists (select 1 from contatos_em_organizacoes o where o.pessoa_id = k.id
                  and o.empresa_id = k.empresa_id and o.organizacao_id = ${v(filtro.organizacaoId)}::uuid)`);
  const repetido = colunaDeRepetido(olham, valores);
  if (filtro.repetidos) partes.push(repetido.replace(/ as repetido$/, ""));
  let ordem = "lower(k.nome), k.id";
  if (filtro.texto) {
    const Q = `para_busca(${v(filtro.texto)}::text)`;
    const contem = `('%' || replace(replace(replace(${Q}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
    const digitos = digitosDoTelefone(filtro.texto);
    const noTelefone = digitos
      ? ` or exists (select 1 from identificadores_de_contato i where i.contato_id = k.id
            and i.empresa_id = k.empresa_id and i.tipo = 'telefone' and i.valor like '%' || ${v(digitos)} || '%')`
      : "";
    partes.push(`(para_busca(k.nome) like ${contem} or ${Q} <% para_busca(k.nome)
       or para_busca(coalesce(k.observacoes, '')) like ${contem}
       or exists (select 1 from identificadores_de_contato i where i.contato_id = k.id
                    and i.empresa_id = k.empresa_id and para_busca(i.valor) like ${contem})${noTelefone})`);
    ordem = `(para_busca(k.nome) like ${contem}) desc, word_similarity(${Q}, para_busca(k.nome)) desc, ${ordem}`;
  }
  const r = await c.query<LinhaDoResumo>(
    `select ${COLUNAS_DO_RESUMO}, ${repetido} from contatos k
      where k.empresa_id = empresa_ativa() and ${partes.join(" and ")}
      order by ${ordem} limit ${Math.max(1, Math.min(limite, 500))}`,
    valores,
  );
  return r.rows.map(paraResumo);
}

/** O contato, se todos os que olham o alcançam. "Para mudar" trava a linha até o fim da transação. */
export async function buscarContato(
  c: pg.PoolClient,
  olham: QuemOlhaContatos[],
  id: string,
  paraMudar = false,
): Promise<Contato | null> {
  if (!UUID.test(id)) return null;
  const valores: unknown[] = [id];
  const alcance = condicaoDosContatos(olham, valores);
  const r = await c.query<LinhaDoContato>(
    `select ${COLUNAS} from contatos k where k.id = $1 and k.empresa_id = empresa_ativa() and ${alcance}
      ${paraMudar ? "for update of k" : ""}`,
    valores,
  );
  const l = r.rows[0];
  return l ? paraContato(l) : null;
}

/** Os resumos destes contatos que todos os que olham alcançam, na ordem dada. */
export async function resumosDe(
  c: pg.PoolClient,
  olham: QuemOlhaContatos[],
  ids: string[],
): Promise<ResumoDoContato[]> {
  if (ids.length === 0) return [];
  const valores: unknown[] = [ids];
  const alcance = condicaoDosContatos(olham, valores);
  const repetido = colunaDeRepetido(olham, valores);
  const r = await c.query<LinhaDoResumo>(
    `select ${COLUNAS_DO_RESUMO}, ${repetido} from contatos k
      where k.empresa_id = empresa_ativa() and k.id = any($1::uuid[]) and ${alcance}`,
    valores,
  );
  const porId = new Map(r.rows.map((l) => [l.id, paraResumo(l)]));
  return ids.flatMap((id) => porId.get(id) ?? []);
}

/** As pessoas ligadas a uma organização que os que olham veem. */
export async function pessoasDaOrganizacao(
  c: pg.PoolClient,
  olham: QuemOlhaContatos[],
  organizacaoId: string,
): Promise<ResumoDoContato[]> {
  return listarContatos(c, olham, { organizacaoId }, 200);
}

const chaveDoIdentificador = (i: Identificador) =>
  `${i.tipo}:${i.tipo === "rede" ? i.rede : ""}:${i.valor.toLowerCase()}`;

/**
 * Os identificadores que já estão em outro contato ativo da empresa (o aviso de repetido, decisão 0045). De um
 * contato que quem olha não vê, diz só que existe.
 */
export async function repetidosDe(
  c: pg.PoolClient,
  olham: QuemOlhaContatos[],
  contatoId: string,
  identificadores: Identificador[],
): Promise<AvisoDeRepetido[]> {
  const procurar = identificadores.filter((i) => i.tipo !== "rede" || i.rede !== "site");
  if (procurar.length === 0) return [];
  const valores: unknown[] = [
    contatoId,
    procurar.map((i) => i.tipo),
    procurar.map((i) => i.valor.toLowerCase()),
  ];
  const ve = condicaoDosContatos(olham, valores);
  const r = await c.query<{
    tipo: string;
    valor: string;
    rede: string | null;
    contato_id: string;
    nome: string;
    ve: boolean;
  }>(
    `select i.tipo, lower(i.valor) as valor, i.rede, k.id as contato_id, k.nome, ${ve} as ve
       from unnest($2::text[], $3::text[]) as q(tipo, valor)
       join identificadores_de_contato i on i.empresa_id = empresa_ativa() and i.tipo = q.tipo
        and lower(i.valor) = q.valor
       join contatos k on k.id = i.contato_id and k.empresa_id = i.empresa_id
      where k.id <> $1 and k.situacao = 'ativo'
      order by k.criado_em`,
    valores,
  );
  const avisos: AvisoDeRepetido[] = [];
  const vistos = new Set<string>();
  for (const l of r.rows) {
    const ident = procurar.find(
      (i) =>
        i.tipo === l.tipo && i.valor.toLowerCase() === l.valor && (i.tipo !== "rede" || i.rede === l.rede),
    );
    if (!ident) continue;
    const chave = `${chaveDoIdentificador(ident)}|${l.ve ? l.contato_id : "oculto"}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    avisos.push({
      identificador: ident,
      contatoId: l.ve ? l.contato_id : null,
      nome: l.ve ? l.nome : null,
    });
  }
  return avisos;
}

/** O que é citado (organizações, etiquetas, responsável) existe na empresa e pode ser usado. */
async function conferirCitados(
  c: pg.PoolClient,
  olham: QuemOlhaContatos[],
  dados: { organizacoes?: VinculoComOrganizacao[]; etiquetas?: string[]; responsavelId?: string | null },
  contatoId: string | null,
): Promise<void> {
  if ((await idsForaDaEmpresa(c, uuidsDe(dados))).length > 0)
    throw new RecusaDosContatos("Alguma organização, etiqueta ou pessoa citada não existe nesta empresa.");
  if (dados.responsavelId && !(await pessoaAtivaNaEmpresa(c, dados.responsavelId)))
    throw new RecusaDosContatos("O responsável precisa ser uma pessoa ativa da empresa.");
  const orgs = (dados.organizacoes ?? []).map((o) => o.organizacaoId);
  if (orgs.length === 0) return;
  if (contatoId && orgs.includes(contatoId))
    throw new RecusaDosContatos("Um contato não se liga a ele mesmo.");
  const vistas = await resumosDe(c, olham, orgs);
  if (
    vistas.length !== orgs.length ||
    vistas.some((o) => o.tipo !== "organizacao" || o.situacao === "juntado")
  )
    throw new RecusaDosContatos("Escolha organizações cadastradas que você pode ver.");
}

async function gravarIdentificadores(c: pg.PoolClient, contatoId: string, ids: Identificador[]) {
  await c.query(
    "delete from identificadores_de_contato where contato_id = $1 and empresa_id = empresa_ativa()",
    [contatoId],
  );
  for (const [ordem, i] of ids.entries()) {
    await c.query(
      `insert into identificadores_de_contato (empresa_id, contato_id, tipo, rede, valor, principal, whatsapp, rotulo, ordem)
       values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contatoId,
        i.tipo,
        i.tipo === "rede" ? i.rede : null,
        i.tipo === "email" ? i.valor.toLowerCase() : i.valor.trim(),
        i.principal,
        i.tipo === "telefone" ? i.whatsapp : false,
        i.tipo === "telefone" ? (i.rotulo ?? null) : null,
        ordem,
      ],
    );
  }
}

async function gravarOrganizacoes(c: pg.PoolClient, pessoaId: string, orgs: VinculoComOrganizacao[]) {
  await c.query(
    "delete from contatos_em_organizacoes where pessoa_id = $1 and empresa_id = empresa_ativa()",
    [pessoaId],
  );
  for (const [ordem, o] of orgs.entries()) {
    await c.query(
      `insert into contatos_em_organizacoes (empresa_id, pessoa_id, organizacao_id, cargo, ordem)
       values (empresa_ativa(), $1, $2, $3, $4)`,
      [pessoaId, o.organizacaoId, o.cargo ?? null, ordem],
    );
  }
}

async function gravarEtiquetas(c: pg.PoolClient, contatoId: string, etiquetas: string[]) {
  await c.query("delete from etiquetas_de_contato where contato_id = $1 and empresa_id = empresa_ativa()", [
    contatoId,
  ]);
  if (etiquetas.length > 0)
    await c.query(
      `insert into etiquetas_de_contato (empresa_id, contato_id, etiqueta_id)
       select empresa_ativa(), $1, unnest($2::uuid[])`,
      [contatoId, etiquetas],
    );
}

/** Cadastra o contato. Sem responsável, fica com quem criou. Devolve o contato e os avisos de repetidos. */
export async function criarContato(
  c: pg.PoolClient,
  olhamVer: QuemOlhaContatos[],
  autor: { pessoaId: string; agenteId?: string | null },
  pedido: PedidoDeContato,
): Promise<{ contato: Contato; repetidos: AvisoDeRepetido[] }> {
  const responsavelId = pedido.responsavelId === undefined ? autor.pessoaId : pedido.responsavelId;
  await conferirCitados(c, olhamVer, { ...pedido, responsavelId }, null);
  const papeis = pedido.papeis && pedido.papeis.length > 0 ? pedido.papeis : ["outro"];
  const r = await c.query<{ id: string }>(
    `insert into contatos (empresa_id, tipo, nome, papeis, documento, responsavel_id, fuso, observacoes,
                           criado_por, criado_por_agente_id)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      pedido.tipo,
      pedido.nome.trim(),
      papeis,
      pedido.documento ?? null,
      responsavelId,
      pedido.fuso ?? null,
      pedido.observacoes ?? null,
      autor.pessoaId,
      autor.agenteId ?? null,
    ],
  );
  const id = r.rows[0]?.id as string;
  await gravarIdentificadores(c, id, pedido.identificadores ?? []);
  if (pedido.tipo === "pessoa") await gravarOrganizacoes(c, id, pedido.organizacoes ?? []);
  await gravarEtiquetas(c, id, pedido.etiquetas ?? []);
  const contato = await buscarContato(c, [{ pessoaId: autor.pessoaId, alcance: "tudo", area: null }], id);
  if (!contato) throw new Error("Contato criado não encontrado");
  return { contato, repetidos: await repetidosDe(c, olhamVer, id, contato.identificadores) };
}

/** Os nomes dos campos que mudaram (para a auditoria, sem os valores). */
export function camposQueMudaram(antes: Contato, depois: Contato): string[] {
  const campos = [
    "nome",
    "papeis",
    "identificadores",
    "organizacoes",
    "documento",
    "etiquetas",
    "responsavelId",
    "fuso",
    "observacoes",
    "situacao",
  ] as const;
  return campos.filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
}

/**
 * Muda o contato (já conferido: quem edita alcança). Só o que veio muda; as listas vêm completas. O contato
 * juntado não muda mais.
 */
export async function editarContato(
  c: pg.PoolClient,
  olhamVer: QuemOlhaContatos[],
  antes: Contato,
  m: PedidoDeEditarContato,
): Promise<{ contato: Contato; repetidos: AvisoDeRepetido[]; campos: string[] }> {
  if (antes.situacao === "juntado")
    throw new RecusaDosContatos("Esse contato foi juntado em outro; edite o que ficou.");
  if (m.organizacoes && m.organizacoes.length > 0 && antes.tipo === "organizacao")
    throw new RecusaDosContatos("Só a pessoa se liga a organizações.");
  await conferirCitados(c, olhamVer, m, antes.id);
  const sets: string[] = [];
  const valores: unknown[] = [antes.id];
  const set = (coluna: string, valor: unknown) => {
    valores.push(valor);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (m.nome !== undefined) set("nome", m.nome.trim());
  if (m.papeis !== undefined) set("papeis", m.papeis.length > 0 ? m.papeis : ["outro"]);
  if (m.documento !== undefined) set("documento", m.documento);
  if (m.responsavelId !== undefined) set("responsavel_id", m.responsavelId);
  if (m.fuso !== undefined) set("fuso", m.fuso);
  if (m.observacoes !== undefined) set("observacoes", m.observacoes);
  if (m.situacao !== undefined) set("situacao", m.situacao);
  sets.push("atualizado_em = now()");
  await c.query(
    `update contatos set ${sets.join(", ")} where id = $1 and empresa_id = empresa_ativa()`,
    valores,
  );
  if (m.identificadores !== undefined) await gravarIdentificadores(c, antes.id, m.identificadores);
  if (m.organizacoes !== undefined) await gravarOrganizacoes(c, antes.id, m.organizacoes);
  if (m.etiquetas !== undefined) await gravarEtiquetas(c, antes.id, m.etiquetas);
  const contato = await buscarContato(
    c,
    [{ pessoaId: antes.criadoPor, alcance: "tudo", area: null }],
    antes.id,
  );
  if (!contato) throw new Error("Contato editado não encontrado");
  const repetidos =
    m.identificadores !== undefined ? await repetidosDe(c, olhamVer, antes.id, contato.identificadores) : [];
  return { contato, repetidos, campos: camposQueMudaram(antes, contato) };
}

/**
 * Junta o "sai" no "fica" (decisão 0045, item 4), numa transação: identificadores, organizações, pessoas ligadas,
 * papéis, etiquetas, tarefas e projetos passam para o que fica; as observações são somadas; nos campos que os dois
 * têm, vale o do que fica. O "sai" vira juntado.
 */
export async function juntarContatos(
  c: pg.PoolClient,
  fica: Contato,
  sai: Contato,
  nome?: string,
): Promise<Contato> {
  if (fica.situacao === "juntado" || sai.situacao === "juntado")
    throw new RecusaDosContatos("Um dos contatos já foi juntado em outro.");
  if (fica.tipo !== sai.tipo)
    throw new RecusaDosContatos("Só se juntam contatos do mesmo tipo (duas pessoas ou duas organizações).");
  const chaves = new Set(fica.identificadores.map(chaveDoIdentificador));
  const temPrincipal = (t: "email" | "telefone") =>
    fica.identificadores.some((i) => i.tipo === t && i.principal);
  const novos = sai.identificadores
    .filter((i) => !chaves.has(chaveDoIdentificador(i)))
    .map((i) => (i.tipo !== "rede" && temPrincipal(i.tipo) ? { ...i, principal: false } : i));
  await gravarIdentificadores(c, fica.id, [...fica.identificadores, ...novos]);
  if (fica.tipo === "pessoa") {
    const orgs = new Set(fica.organizacoes.map((o) => o.organizacaoId));
    const juntas = [
      ...fica.organizacoes,
      ...sai.organizacoes.filter((o) => !orgs.has(o.organizacaoId) && o.organizacaoId !== fica.id),
    ];
    await gravarOrganizacoes(c, fica.id, juntas);
  } else {
    // As pessoas ligadas ao "sai" passam para o "fica" (sem repetir quem já estava nos dois).
    await c.query(
      `insert into contatos_em_organizacoes (empresa_id, pessoa_id, organizacao_id, cargo, ordem)
       select empresa_id, pessoa_id, $1, cargo, ordem from contatos_em_organizacoes
        where organizacao_id = $2 and empresa_id = empresa_ativa()
       on conflict (pessoa_id, organizacao_id) do nothing`,
      [fica.id, sai.id],
    );
  }
  await gravarEtiquetas(c, fica.id, [...new Set([...fica.etiquetas, ...sai.etiquetas])]);
  for (const tabela of ["contatos_de_tarefa", "contatos_de_projeto"] as const) {
    const col = tabela === "contatos_de_tarefa" ? "tarefa_id" : "projeto_id";
    await c.query(
      `insert into ${tabela} (empresa_id, ${col}, contato_id, ordem)
       select empresa_id, ${col}, $1, ordem from ${tabela} where contato_id = $2 and empresa_id = empresa_ativa()
       on conflict (${col}, contato_id) do nothing`,
      [fica.id, sai.id],
    );
    await c.query(`delete from ${tabela} where contato_id = $1 and empresa_id = empresa_ativa()`, [sai.id]);
  }
  // Os contatos já juntados no "sai" passam a levar ao "fica".
  await c.query(
    "update contatos set juntado_em_id = $1 where juntado_em_id = $2 and empresa_id = empresa_ativa()",
    [fica.id, sai.id],
  );
  const observacoes = [fica.observacoes, sai.observacoes].filter((x): x is string => !!x).join("\n\n");
  const todos = [...new Set([...fica.papeis, ...sai.papeis])];
  const papeis =
    todos.filter((p) => p !== "outro").length > 0 ? todos.filter((p) => p !== "outro") : ["outro"];
  await c.query(
    `update contatos set papeis = $2, documento = coalesce(documento, $3), responsavel_id = coalesce(responsavel_id, $4),
                         fuso = coalesce(fuso, $5), observacoes = $6, nome = coalesce($7, nome), atualizado_em = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [
      fica.id,
      papeis,
      sai.documento,
      sai.responsavelId,
      sai.fuso,
      observacoes.slice(0, 10000) || null,
      nome?.trim() || null,
    ],
  );
  await c.query(
    `update contatos set situacao = 'juntado', juntado_em_id = $1, atualizado_em = now()
      where id = $2 and empresa_id = empresa_ativa()`,
    [fica.id, sai.id],
  );
  await c.query(
    "delete from identificadores_de_contato where contato_id = $1 and empresa_id = empresa_ativa()",
    [sai.id],
  );
  await c.query(
    "delete from contatos_em_organizacoes where (pessoa_id = $1 or organizacao_id = $1) and empresa_id = empresa_ativa()",
    [sai.id],
  );
  const depois = await buscarContato(c, [{ pessoaId: fica.criadoPor, alcance: "tudo", area: null }], fica.id);
  if (!depois) throw new Error("Contato juntado não encontrado");
  return depois;
}

/** Apaga o contato (e os juntados nele), tirando das tarefas e projetos (LGPD). */
export async function apagarContato(c: pg.PoolClient, id: string): Promise<boolean> {
  const r = await c.query("delete from contatos where id = $1 and empresa_id = empresa_ativa()", [id]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Troca os contatos citados numa tarefa ou num projeto (a lista completa). Só contatos ativos que quem olha vê;
 * os que já estavam e quem olha não vê continuam (não some o que outra pessoa ligou).
 */
export async function ligarContatos(
  c: pg.PoolClient,
  olhamVer: QuemOlhaContatos[],
  alvo: { tipo: "tarefa" | "projeto"; id: string },
  contatos: string[],
): Promise<string[]> {
  const tabela = alvo.tipo === "tarefa" ? "contatos_de_tarefa" : "contatos_de_projeto";
  const col = alvo.tipo === "tarefa" ? "tarefa_id" : "projeto_id";
  const vistos = await resumosDe(c, olhamVer, contatos);
  if (vistos.length !== contatos.length || vistos.some((k) => k.situacao !== "ativo"))
    throw new RecusaDosContatos("Escolha contatos ativos que você pode ver.");
  const atuais = await c.query<{ contato_id: string }>(
    `select contato_id from ${tabela} where ${col} = $1 and empresa_id = empresa_ativa() order by ordem`,
    [alvo.id],
  );
  const atuaisIds = atuais.rows.map((l) => l.contato_id);
  const veAtuais = new Set((await resumosDe(c, olhamVer, atuaisIds)).map((k) => k.id));
  const ocultos = atuaisIds.filter((id) => !veAtuais.has(id));
  const finais = [...contatos, ...ocultos.filter((id) => !contatos.includes(id))];
  if (finais.length > 20) throw new RecusaDosContatos("No máximo 20 contatos.");
  await c.query(`delete from ${tabela} where ${col} = $1 and empresa_id = empresa_ativa()`, [alvo.id]);
  for (const [ordem, contatoId] of finais.entries())
    await c.query(
      `insert into ${tabela} (empresa_id, ${col}, contato_id, ordem) values (empresa_ativa(), $1, $2, $3)`,
      [alvo.id, contatoId, ordem],
    );
  return finais;
}

/** Os contatos citados numa tarefa ou num projeto que quem olha vê, na ordem. */
export async function contatosLigados(
  c: pg.PoolClient,
  olhamVer: QuemOlhaContatos[],
  alvo: { tipo: "tarefa" | "projeto"; id: string },
): Promise<ResumoDoContato[]> {
  const tabela = alvo.tipo === "tarefa" ? "contatos_de_tarefa" : "contatos_de_projeto";
  const col = alvo.tipo === "tarefa" ? "tarefa_id" : "projeto_id";
  const r = await c.query<{ contato_id: string }>(
    `select contato_id from ${tabela} where ${col} = $1 and empresa_id = empresa_ativa() order by ordem`,
    [alvo.id],
  );
  return resumosDe(
    c,
    olhamVer,
    r.rows.map((l) => l.contato_id),
  );
}

// Visões salvas (como as das tarefas): o banco só mostra a cada pessoa as dela.

interface LinhaDaVisao {
  id: string;
  empresa_id: string;
  pessoa_id: string;
  nome: string;
  filtro: FiltroDeContatos;
  criada_em: Date;
}

const paraVisao = (l: LinhaDaVisao): VisaoDeContatos => ({
  id: l.id,
  empresaId: l.empresa_id,
  pessoaId: l.pessoa_id,
  nome: l.nome,
  filtro: l.filtro,
  criadaEm: l.criada_em.toISOString(),
});

export async function listarVisoesDeContatos(c: pg.PoolClient): Promise<VisaoDeContatos[]> {
  const r = await c.query<LinhaDaVisao>(
    `select id, empresa_id, pessoa_id, nome, filtro, criada_em from visoes_de_contatos
      where empresa_id = empresa_ativa() order by lower(nome), id`,
  );
  return r.rows.map(paraVisao);
}

export async function salvarVisaoDeContatos(
  c: pg.PoolClient,
  pedido: PedidoDeVisaoDeContatos,
): Promise<VisaoDeContatos> {
  if ((await idsForaDaEmpresa(c, uuidsDe(pedido.filtro))).length > 0)
    throw new RecusaDosContatos("O filtro cita uma etiqueta, organização ou pessoa que não existe aqui.");
  const r = await c.query<LinhaDaVisao>(
    `insert into visoes_de_contatos (empresa_id, pessoa_id, nome, filtro)
     values (empresa_ativa(), pessoa_ativa(), $1, $2)
     on conflict (empresa_id, pessoa_id, lower(nome)) do update set filtro = excluded.filtro
     returning id, empresa_id, pessoa_id, nome, filtro, criada_em`,
    [pedido.nome.trim(), JSON.stringify(pedido.filtro)],
  );
  return paraVisao(r.rows[0] as LinhaDaVisao);
}

export async function apagarVisaoDeContatos(c: pg.PoolClient, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const r = await c.query("delete from visoes_de_contatos where id = $1 and empresa_id = empresa_ativa()", [
    id,
  ]);
  return (r.rowCount ?? 0) > 0;
}
