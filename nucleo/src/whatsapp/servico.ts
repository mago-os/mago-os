/**
 * O WhatsApp oficial da plataforma para a equipe (M8-09, decisão 0059): o que o Mago OS faz com cada mensagem que a
 * Meta entrega no número da plataforma. É o mesmo que o bot do Telegram faz (M5): vincular pelo código, reconhecer a
 * pessoa, as palavras nova, tarefas, empresa, sair e ajuda, a conversa com o coordenador (o mesmo motor e a mesma
 * conversa do app) e as aprovações com os botões e o código do autenticador. As regras que não dependem do canal são
 * as do Telegram (o código e o resumo dele, as prioridades, o autenticador e as travas das aprovações, por pessoa).
 *
 * Toda mensagem passa primeiro pelas travas (mensagens por minuto, códigos errados). Quem não tem vínculo recebe
 * sempre a mesma resposta fixa, que não diz se o número ou o código existem. Por aqui, por enquanto, só texto.
 */
import {
  type Aprovacao,
  type AvisoDaMeta,
  CODIGOS_ERRADOS_DO_TELEGRAM,
  COMANDOS_DO_WHATSAPP,
  type DeclaracaoDeModulo,
  ERROS_DE_CODIGO_NA_APROVACAO,
  HORAS_DA_JANELA_DO_WHATSAPP,
  HORAS_PARA_CONVERSA_NOVA_NO_TELEGRAM,
  MENSAGENS_POR_MINUTO_DO_TELEGRAM,
  type MensagemDaMeta,
  MINUTOS_DA_TRAVA_DAS_APROVACOES,
  MINUTOS_DA_TRAVA_DO_TELEGRAM,
  MINUTOS_PARA_MANDAR_O_CODIGO,
  mencaoNoComeco,
  RESPOSTAS_DO_TELEGRAM,
  RESPOSTAS_DO_WHATSAPP,
  respostaDeAgentePausado,
  respostaDeAgentesParados,
  respostaDeCodigoErrado,
  respostaDePedidoJaDecidido,
  respostaPedindoCodigoNoWhatsapp,
} from "@mago-os/contratos";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { buscarAprovacao, podeDecidir } from "../agentes/regras.ts";
import { decidirAprovacao, type OpcoesDeDecidir } from "../agentes-internos/aprovacoes.ts";
import { quemPediu } from "../agentes-internos/ferramentas.ts";
import { podeFalarComEspecialista, receberMensagemDaPessoa } from "../agentes-internos/mensagem-da-pessoa.ts";
import { auditar, type DadosDoEvento } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { paraBusca } from "../busca/index.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { listarPrioridades } from "../tarefas/prioridades.ts";
import type { Autenticador } from "../telegram/autenticador.ts";
import { partesDoTexto, textoDasPrioridades } from "../telegram/conversa.ts";
import { codigoDaMensagem, resumoDoCodigo } from "../telegram/servico.ts";
import type { CarteiroDaMeta } from "./carteiro.ts";

export interface Registro {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface OpcoesDoWhatsapp {
  poolApp: pg.Pool;
  carteiro: CarteiroDaMeta;
  /** O id do número da plataforma na Meta: o aviso de outro número (o de uma empresa, M8-10) não é daqui. */
  numeroId: string;
  log: Registro;
  /** A conversa com o coordenador e as aprovações. */
  conversa?: {
    catalogo: Map<string, DeclaracaoDeModulo>;
    acordar(empresaId: string, execucaoId: string): void;
    urlPublica: string;
    aprovacoes?: { decidir: OpcoesDeDecidir; autenticador: Autenticador };
  };
}

export const ORIGEM_WHATSAPP: DadosDoEvento["origem"] = { canal: "whatsapp", ip: null, aparelho: "WhatsApp" };

export interface PessoaDoWhatsapp {
  pessoaId: string;
  empresaId: string;
  numero: string;
  pessoaNome: string;
  empresaNome: string;
}

/** Quem é o número (só vínculos ativos), ou nulo. */
export async function reconhecerWhatsapp(pool: pg.Pool, numero: string): Promise<PessoaDoWhatsapp | null> {
  const r = await pool.query<{
    pessoa_id: string;
    empresa_id: string;
    pessoa_nome: string;
    empresa_nome: string;
  }>("select * from reconhecer_whatsapp($1)", [numero]);
  const l = r.rows[0];
  return l
    ? {
        pessoaId: l.pessoa_id,
        empresaId: l.empresa_id,
        numero,
        pessoaNome: l.pessoa_nome,
        empresaNome: l.empresa_nome,
      }
    : null;
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

export function textoDaAjudaNoWhatsapp(p: Pick<PessoaDoWhatsapp, "pessoaNome" | "empresaNome">): string {
  return [
    `Oi, ${primeiroNome(p.pessoaNome)}. Você está na ${p.empresaNome}.`,
    "",
    "Escreva o pedido para o coordenador, ou uma destas palavras:",
    ...COMANDOS_DO_WHATSAPP.map((c) => `${c.comando}: ${c.descricao}`),
    "",
    "O Mago OS nunca pede senha nem código por aqui fora de uma aprovação que você mesmo abriu.",
  ].join("\n");
}

/** A palavra de comando no começo da mensagem (nova, tarefas, empresa, sair, ajuda), e o resto. */
export function comandoDoWhatsapp(texto: string): { comando: string; resto: string } | null {
  const m = /^\/?([a-zà-ú]+)(?:\s+([\s\S]*))?$/i.exec(texto.trim());
  const palavra = m?.[1]?.toLowerCase();
  if (!palavra || !COMANDOS_DO_WHATSAPP.some((c) => c.comando === palavra)) return null;
  const resto = (m?.[2] ?? "").trim();
  // "sair", "ajuda" e "tarefas" só valem sozinhos (uma frase que começa com "ajuda" é pedido ao coordenador).
  if (resto && palavra !== "nova" && palavra !== "empresa") return null;
  return { comando: palavra, resto };
}

/** A mensagem de botão, de texto ou de resposta rápida de modelo: o que interessa dela. */
function lerMensagem(m: MensagemDaMeta): { texto: string; botao: string | null; soTexto: boolean } {
  if (m.type === "interactive" && m.interactive?.button_reply)
    return { texto: m.interactive.button_reply.title, botao: m.interactive.button_reply.id, soTexto: true };
  if (m.type === "button" && m.button)
    return { texto: m.button.text, botao: m.button.payload ?? null, soTexto: true };
  if (m.type === "text") return { texto: m.text?.body ?? "", botao: null, soTexto: true };
  return { texto: "", botao: null, soTexto: false };
}

/**
 * Trata um aviso da Meta (trabalho da fila). Só os avisos do número da plataforma; cada mensagem uma vez só. Nunca
 * lança por causa do conteúdo nem do envio: o pior caso é a resposta não chegar.
 */
export async function tratarAvisoDaMeta(opcoes: OpcoesDoWhatsapp, aviso: AvisoDaMeta): Promise<void> {
  const carteiro = opcoes.carteiro;
  const engolir =
    (f: (...a: never[]) => Promise<string>) =>
    (...a: never[]) =>
      f(...a).catch((erro) => {
        opcoes.log.warn({ erro: (erro as Error).message }, "WhatsApp: a resposta não foi enviada");
        return "";
      });
  const o: OpcoesDoWhatsapp = {
    ...opcoes,
    carteiro: {
      numero: carteiro.numero,
      descobrirNumero: () => carteiro.descobrirNumero(),
      enviarTexto: engolir(carteiro.enviarTexto as never),
      enviarBotoes: engolir(carteiro.enviarBotoes as never),
      enviarModelo: engolir(carteiro.enviarModelo as never),
    },
  };
  for (const entrada of aviso.entry)
    for (const mudanca of entrada.changes) {
      if (mudanca.field !== "messages" || mudanca.value.metadata?.phone_number_id !== o.numeroId) continue;
      const nomes = new Map(
        (mudanca.value.contacts ?? []).map((k) => [k.wa_id ?? "", k.profile?.name ?? ""]),
      );
      for (const m of mudanca.value.messages ?? []) {
        const nova = await o.poolApp.query<{ nova: boolean }>(
          "select mensagem_nova_do_whatsapp($1) as nova",
          [m.id],
        );
        if (!nova.rows[0]?.nova) continue;
        await tratarMensagem(o, m, nomes.get(m.from) || "Sem nome").catch((erro) =>
          o.log.error({ erro: (erro as Error).message }, "WhatsApp: a mensagem não foi tratada"),
        );
      }
    }
}

async function tratarMensagem(o: OpcoesDoWhatsapp, m: MensagemDaMeta, nome: string): Promise<void> {
  const numero = m.from;
  const n = await o.poolApp.query<{ n: number }>("select contar_mensagem_do_whatsapp($1) as n", [numero]);
  if ((n.rows[0]?.n ?? 0) > MENSAGENS_POR_MINUTO_DO_TELEGRAM) return;
  const lida = lerMensagem(m);
  const codigo = lida.soTexto && !lida.botao ? codigoDaMensagem(lida.texto) : null;
  if (codigo) return vincular(o, numero, nome, codigo.codigo);
  const pessoa = await reconhecerWhatsapp(o.poolApp, numero);
  if (!pessoa) {
    await o.carteiro.enviarTexto(numero, RESPOSTAS_DO_WHATSAPP.semVinculo);
    return;
  }
  // A mensagem da pessoa abre (ou renova) a janela de 24 horas da Meta.
  await comPessoa(o.poolApp, pessoa.pessoaId, pessoa.empresaId, (c) =>
    c.query("update vinculos_do_whatsapp set ultima_mensagem_em = now() where pessoa_id = pessoa_ativa()"),
  );
  if (lida.botao) {
    const empresa = /^em:([0-9a-f-]{36})$/.exec(lida.botao);
    if (empresa) return trocarEmpresa(o, pessoa, empresa[1] as string);
    if (await tocarBotaoDeAprovacao(o, pessoa, lida.botao)) return;
  }
  if (!lida.soTexto) {
    await o.carteiro.enviarTexto(numero, RESPOSTAS_DO_WHATSAPP.soTexto);
    return;
  }
  if (await receberCodigoOuMotivo(o, pessoa, lida.texto)) return;
  if (!lida.texto.trim()) return;
  const cmd = comandoDoWhatsapp(lida.texto);
  if (cmd?.comando === "sair") return sair(o, pessoa);
  if (cmd?.comando === "empresa") return trocarEmpresa(o, pessoa, cmd.resto);
  if (cmd?.comando === "ajuda") {
    await o.carteiro.enviarTexto(numero, textoDaAjudaNoWhatsapp(pessoa));
    return;
  }
  return conversar(o, pessoa, lida.texto, cmd);
}

async function vincular(o: OpcoesDoWhatsapp, numero: string, nome: string, codigo: string): Promise<void> {
  const errados = async (errou: boolean) =>
    (
      await o.poolApp.query<{ n: number }>("select codigos_errados_do_whatsapp($1, $2, $3) as n", [
        numero,
        errou,
        MINUTOS_DA_TRAVA_DO_TELEGRAM,
      ])
    ).rows[0]?.n ?? 0;
  if ((await errados(false)) >= CODIGOS_ERRADOS_DO_TELEGRAM) {
    await o.carteiro.enviarTexto(numero, RESPOSTAS_DO_WHATSAPP.travado);
    return;
  }
  const r = await o.poolApp.query<{
    pessoa_id: string;
    empresa_id: string;
    pessoa_nome: string;
    empresa_nome: string;
    tirada_de: string | null;
    tirada_de_empresa: string | null;
    trocou_numero: boolean;
  }>("select * from vincular_whatsapp($1, $2, $3)", [resumoDoCodigo(codigo), numero, nome.slice(0, 200)]);
  const v = r.rows[0];
  if (!v) {
    if ((await errados(true)) >= CODIGOS_ERRADOS_DO_TELEGRAM) {
      await auditar(
        o.poolApp,
        {
          empresaId: null,
          ator: { tipo: "sistema", servico: "whatsapp" },
          acao: "whatsapp.codigo_errado",
          origem: ORIGEM_WHATSAPP,
          detalhes: { travouPorMinutos: MINUTOS_DA_TRAVA_DO_TELEGRAM },
        },
        o.log,
      );
      await o.carteiro.enviarTexto(numero, RESPOSTAS_DO_WHATSAPP.travado);
    } else await o.carteiro.enviarTexto(numero, RESPOSTAS_DO_WHATSAPP.codigoInvalido);
    return;
  }
  await auditar(
    o.poolApp,
    {
      empresaId: v.empresa_id,
      ator: { tipo: "pessoa", pessoaId: v.pessoa_id },
      acao: "whatsapp.vinculou",
      alvo: { tipo: "pessoa", id: v.pessoa_id },
      origem: ORIGEM_WHATSAPP,
      detalhes: { trocouNumero: v.trocou_numero },
    },
    o.log,
  );
  if (v.tirada_de && v.tirada_de_empresa) {
    const tirada = v.tirada_de;
    const empresa = v.tirada_de_empresa;
    await comEmpresa(o.poolApp, empresa, (c) =>
      criarAviso(c, {
        pessoaId: tirada,
        tipo: "whatsapp_desvinculado",
        texto:
          "O WhatsApp ligado a você foi vinculado a outra pessoa. Vincule de novo em Meu perfil se o número for seu.",
        link: "/perfil",
      }),
    ).catch((erro) => o.log.warn({ erro }, "Aviso de WhatsApp desvinculado não foi criado"));
    await auditar(
      o.poolApp,
      {
        empresaId: empresa,
        ator: { tipo: "sistema", servico: "whatsapp" },
        acao: "whatsapp.desvinculou",
        alvo: { tipo: "pessoa", id: tirada },
        origem: ORIGEM_WHATSAPP,
        detalhes: { motivo: "outra_pessoa" },
      },
      o.log,
    );
  }
  await o.carteiro.enviarTexto(
    numero,
    `Pronto, ${primeiroNome(v.pessoa_nome)}. Você está na ${v.empresa_nome}.\n\nMande "ajuda" para ver o que dá para fazer por aqui.`,
  );
}

async function sair(o: OpcoesDoWhatsapp, p: PessoaDoWhatsapp): Promise<void> {
  await comPessoa(o.poolApp, p.pessoaId, p.empresaId, (c) =>
    c.query("delete from vinculos_do_whatsapp where pessoa_id = pessoa_ativa()"),
  );
  await auditar(
    o.poolApp,
    {
      empresaId: p.empresaId,
      ator: { tipo: "pessoa", pessoaId: p.pessoaId },
      acao: "whatsapp.desvinculou",
      alvo: { tipo: "pessoa", id: p.pessoaId },
      origem: ORIGEM_WHATSAPP,
      detalhes: { motivo: "sair" },
    },
    o.log,
  );
  await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.desvinculado);
}

/** "empresa" lista as empresas da pessoa (com botões, até 3); "empresa 2" (ou o botão) troca. */
async function trocarEmpresa(o: OpcoesDoWhatsapp, p: PessoaDoWhatsapp, resto: string): Promise<void> {
  const empresas = await comPessoa(o.poolApp, p.pessoaId, null, async (c) => {
    const r = await c.query<{ id: string; nome: string }>(
      `select e.id, e.nome from empresas e
         join vinculos v on v.empresa_id = e.id and v.pessoa_id = pessoa_ativa() and v.situacao = 'ativo'
        where e.situacao = 'ativa' order by e.nome, e.id`,
    );
    return r.rows;
  });
  if (empresas.length <= 1) {
    await o.carteiro.enviarTexto(p.numero, `Você só está na ${p.empresaNome}.`);
    return;
  }
  const escolha = /^\d{1,3}$/.test(resto)
    ? empresas[Number(resto) - 1]
    : empresas.find((e) => e.id === resto);
  if (!escolha) {
    const lista = empresas.map((e, i) => `${i + 1}. ${e.nome}${e.id === p.empresaId ? " (agora)" : ""}`);
    const texto = ['Em qual empresa você quer conversar? Mande "empresa" e o número.', "", ...lista].join(
      "\n",
    );
    if (empresas.length <= 3)
      await o.carteiro.enviarBotoes(
        p.numero,
        texto,
        empresas.map((e) => ({ id: `em:${e.id}`, titulo: e.nome })),
      );
    else await o.carteiro.enviarTexto(p.numero, texto);
    return;
  }
  if (escolha.id === p.empresaId) {
    await o.carteiro.enviarTexto(p.numero, `Você já está na ${escolha.nome}.`);
    return;
  }
  await comPessoa(o.poolApp, p.pessoaId, null, (c) =>
    c.query(
      "update vinculos_do_whatsapp set empresa_id = $1, conversa_id = null where pessoa_id = pessoa_ativa()",
      [escolha.id],
    ),
  );
  await auditar(
    o.poolApp,
    {
      empresaId: escolha.id,
      ator: { tipo: "pessoa", pessoaId: p.pessoaId },
      acao: "whatsapp.trocou_empresa",
      alvo: { tipo: "pessoa", id: p.pessoaId },
      origem: ORIGEM_WHATSAPP,
      detalhes: { de: p.empresaId },
    },
    o.log,
  );
  await o.carteiro.enviarTexto(p.numero, `Pronto. Agora você está na ${escolha.nome}.`);
}

/** Texto, "nova", "tarefas" e a menção a um especialista: o mesmo caminho da conversa no app e no Telegram. */
async function conversar(
  o: OpcoesDoWhatsapp,
  p: PessoaDoWhatsapp,
  texto: string,
  comando: { comando: string; resto: string } | null,
): Promise<void> {
  const conv = o.conversa;
  if (!conv) {
    await o.carteiro.enviarTexto(p.numero, "A conversa pelo WhatsApp ainda não está ligada neste ambiente.");
    return;
  }
  const permissoes = await permissoesNaEmpresa(o.poolApp, p.pessoaId, p.empresaId, conv.catalogo);
  if (!permissoes) {
    await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.semVinculo);
    return;
  }
  if (comando?.comando === "tarefas") {
    const quem = quemPediu(permissoes, p.pessoaId, "ver");
    const itens =
      quem?.tipo === "pessoa"
        ? await comPessoa(o.poolApp, p.pessoaId, p.empresaId, (c) => listarPrioridades(c, quem))
        : [];
    if (itens.length === 0) {
      await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_TELEGRAM.semPrioridades);
      return;
    }
    for (const parte of partesDoTexto(
      `Prioridades de hoje:\n\n${textoDasPrioridades(itens, conv.urlPublica)}`,
    ))
      await o.carteiro.enviarTexto(p.numero, parte);
    return;
  }
  if ((permissoes.modulos.get("agentes")?.acoes.ver ?? "nada") === "nada") {
    await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_TELEGRAM.semAcessoAosAgentes);
    return;
  }
  if (comando?.comando === "nova") {
    await comPessoa(o.poolApp, p.pessoaId, p.empresaId, (c) =>
      c.query("update vinculos_do_whatsapp set conversa_id = null where pessoa_id = pessoa_ativa()"),
    );
    await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_TELEGRAM.conversaNova);
    if (!comando.resto) return;
    texto = comando.resto;
  }
  const mencao = mencaoNoComeco(texto);
  let agenteId: string | undefined;
  if (mencao) {
    const agentes = await comPessoa(o.poolApp, p.pessoaId, p.empresaId, async (c) => {
      const r = await c.query<{ id: string; nome: string; papel: string }>(
        `select id, nome, papel from agentes where empresa_id = empresa_ativa() and tipo = 'interno'
            and situacao <> 'desligado' order by papel, lower(nome)`,
      );
      return r.rows;
    });
    const procurado = paraBusca(mencao.mencao);
    const achado = agentes.find((a) =>
      paraBusca(a.nome)
        .split(/[\s_-]+/)
        .some((w) => w.startsWith(procurado)),
    );
    if (achado?.papel === "coordenador") texto = mencao.resto;
    else if (achado && achado.papel !== "atendimento") {
      if (!podeFalarComEspecialista(permissoes.perfil)) {
        await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_TELEGRAM.semPermissaoDeEspecialista);
        return;
      }
      agenteId = achado.id;
      texto = mencao.resto;
    }
  }
  const feito = await comPessoa(o.poolApp, p.pessoaId, p.empresaId, async (c) => {
    const v = await c.query<{ conversa_id: string | null; recente: boolean | null }>(
      `select w.conversa_id, v.atualizada_em > now() - make_interval(hours => $1) as recente
         from vinculos_do_whatsapp w
         left join conversas v on v.id = w.conversa_id and v.empresa_id = w.empresa_id
        where w.pessoa_id = pessoa_ativa() and w.empresa_id = empresa_ativa()
          for update of w`,
      [HORAS_PARA_CONVERSA_NOVA_NO_TELEGRAM],
    );
    const atual = !agenteId && v.rows[0]?.recente ? v.rows[0].conversa_id : null;
    const pedido = {
      pessoaId: p.pessoaId,
      perfil: permissoes.perfil,
      texto: texto.slice(0, 4000),
      agenteId,
      canal: "whatsapp" as const,
    };
    let r = await receberMensagemDaPessoa(c, { ...pedido, conversaId: atual ?? undefined });
    if (atual && "erro" in r && (r.erro === "nao_encontrada" || r.erro === "sem_coordenador"))
      r = await receberMensagemDaPessoa(c, pedido);
    if ("conversa" in r && r.conversa.id !== atual)
      await c.query("update vinculos_do_whatsapp set conversa_id = $1 where pessoa_id = pessoa_ativa()", [
        r.conversa.id,
      ]);
    return r;
  });
  if ("erro" in feito) {
    const resposta =
      feito.erro === "ocupado"
        ? RESPOSTAS_DO_TELEGRAM.ocupado
        : feito.erro === "parados"
          ? respostaDeAgentesParados(feito.motivo)
          : feito.erro === "pausado"
            ? respostaDeAgentePausado(feito.nome)
            : feito.erro === "sem_permissao"
              ? RESPOSTAS_DO_TELEGRAM.semPermissaoDeEspecialista
              : feito.erro === "nao_encontrada"
                ? RESPOSTAS_DO_TELEGRAM.especialistaNaoEncontrado
                : "Esta empresa ainda não tem coordenador.";
    await o.carteiro.enviarTexto(p.numero, resposta);
    return;
  }
  conv.acordar(p.empresaId, feito.execucaoId);
}

// Aprovações (como no Telegram, M5-04) -----------------------------------------------------------------------------

const SITUACAO_EM_TEXTO: Record<string, string> = {
  aprovada: "aprovado",
  recusada: "recusado",
  vencida: "vencida",
  falhou: "aprovado, mas a ação não deu certo",
  pendente: "pendente",
};

/** A janela de 24 horas da Meta está aberta para a pessoa (a última mensagem dela foi há menos de 24 horas). */
export const DENTRO_DA_JANELA = `ultima_mensagem_em > now() - make_interval(hours => ${HORAS_DA_JANELA_DO_WHATSAPP})`;

/** Travado: 3 códigos errados (no WhatsApp ou no Telegram), ou o 2FA do login travado. */
async function travado(poolApp: pg.Pool, pessoaId: string): Promise<boolean> {
  const r = await poolApp.query<{ t: boolean }>("select aprovacoes_travadas_no_telegram($1) as t", [
    pessoaId,
  ]);
  return r.rows[0]?.t === true;
}

async function administra(c: pg.PoolClient): Promise<boolean> {
  const v = await c.query<{ perfil: string }>(
    "select perfil from vinculos where empresa_id = empresa_ativa() and pessoa_id = pessoa_ativa() and situacao = 'ativo'",
  );
  return v.rows[0]?.perfil === "administrador";
}

/** O toque em Aprovar ou Recusar (o id do botão é ap:a:<pedido> ou ap:r:<pedido>). */
export async function tocarBotaoDeAprovacao(
  o: OpcoesDoWhatsapp,
  p: PessoaDoWhatsapp,
  botao: string,
): Promise<boolean> {
  const m = /^ap:(a|r):([0-9a-f-]{36})$/.exec(botao);
  if (!m) return false;
  const aprovar = m[1] === "a";
  const aprovacaoId = m[2] as string;
  const ap = o.conversa?.aprovacoes;
  if (!ap) {
    await o.carteiro.enviarTexto(
      p.numero,
      "As aprovações pelo WhatsApp ainda não estão ligadas neste ambiente.",
    );
    return true;
  }
  const empresaId =
    (
      await comPessoa(o.poolApp, p.pessoaId, null, (c) =>
        c.query<{ empresa_id: string }>(
          "select empresa_id from aprovacoes_no_whatsapp where aprovacao_id = $1 and pessoa_id = pessoa_ativa()",
          [aprovacaoId],
        ),
      )
    ).rows[0]?.empresa_id ?? p.empresaId;
  const visto = await comPessoa(o.poolApp, p.pessoaId, empresaId, async (c) => {
    const a = await buscarAprovacao(c, aprovacaoId);
    if (!a || !(await podeDecidir(c, a, p.pessoaId, await administra(c)))) return null;
    const enviado = await c.query<{ conferencia: string }>(
      "select conferencia from aprovacoes_no_whatsapp where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = pessoa_ativa()",
      [aprovacaoId],
    );
    return { aprovacao: a, conferencia: enviado.rows[0]?.conferencia ?? a.conferencia };
  });
  if (!visto) {
    await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_TELEGRAM.pedidoNaoEncontrado);
    return true;
  }
  const a: Aprovacao = visto.aprovacao;
  if (a.situacao !== "pendente" || Date.parse(a.venceEm) <= Date.now()) {
    await o.carteiro.enviarTexto(
      p.numero,
      respostaDePedidoJaDecidido(
        a.situacao === "pendente" ? "vencida" : (SITUACAO_EM_TEXTO[a.situacao] ?? a.situacao),
      ),
    );
    return true;
  }
  if (aprovar) {
    if (await travado(o.poolApp, p.pessoaId)) {
      await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.aprovacoesTravadas);
      return true;
    }
    if (!(await ap.autenticador.tem(p.pessoaId))) {
      await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.semAutenticador);
      return true;
    }
  }
  await comPessoa(o.poolApp, p.pessoaId, null, (c) =>
    c.query("delete from pedidos_de_codigo_no_whatsapp where pessoa_id = pessoa_ativa()"),
  );
  await comPessoa(o.poolApp, p.pessoaId, empresaId, (c) =>
    c.query(
      `insert into pedidos_de_codigo_no_whatsapp (empresa_id, pessoa_id, aprovacao_id, acao, conferencia, vale_ate)
       values (empresa_ativa(), pessoa_ativa(), $1, $2, $3, now() + make_interval(mins => $4))`,
      [aprovacaoId, aprovar ? "aprovar" : "recusar", visto.conferencia, MINUTOS_PARA_MANDAR_O_CODIGO],
    ),
  );
  await o.carteiro.enviarTexto(
    p.numero,
    aprovar ? respostaPedindoCodigoNoWhatsapp(a.resumo) : RESPOSTAS_DO_TELEGRAM.pecaOMotivo,
  );
  return true;
}

/** A mensagem que chega com um toque em Aprovar ou Recusar aberto: o código ou o motivo. */
async function receberCodigoOuMotivo(
  o: OpcoesDoWhatsapp,
  p: PessoaDoWhatsapp,
  bruto: string,
): Promise<boolean> {
  const ap = o.conversa?.aprovacoes;
  if (!ap) return false;
  const pedido = await comPessoa(o.poolApp, p.pessoaId, null, async (c) => {
    const r = await c.query<{
      empresa_id: string;
      aprovacao_id: string;
      acao: "aprovar" | "recusar";
      conferencia: string;
      vale: boolean;
    }>(
      `select empresa_id, aprovacao_id, acao, conferencia, vale_ate > now() as vale from pedidos_de_codigo_no_whatsapp
        where pessoa_id = pessoa_ativa()`,
    );
    return r.rows[0] ?? null;
  });
  if (!pedido) return false;
  const texto = bruto.trim();
  const fechar = () =>
    comPessoa(o.poolApp, p.pessoaId, null, (c) =>
      c.query("delete from pedidos_de_codigo_no_whatsapp where pessoa_id = pessoa_ativa()"),
    );
  const pareceCodigo = /^\d{6}$/.test(texto.replace(/\s/g, ""));
  if (!pedido.vale) {
    await fechar();
    if (pedido.acao === "aprovar" && pareceCodigo) {
      await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.foraDoTempo);
      return true;
    }
    return false;
  }
  const log = o.log as unknown as FastifyBaseLogger;
  const decidir = (decisao: "aprovar" | "recusar", motivo?: string) =>
    comPessoa(o.poolApp, p.pessoaId, pedido.empresa_id, administra).then((administrador) =>
      decidirAprovacao(ap.decidir, {
        empresaId: pedido.empresa_id,
        pessoaId: p.pessoaId,
        administrador,
        aprovacaoId: pedido.aprovacao_id,
        conferencia: pedido.conferencia,
        decisao,
        motivo,
        origem: ORIGEM_WHATSAPP,
        rastreio: null,
        log,
      }),
    );
  const contar = async (r: Awaited<ReturnType<typeof decidir>>, feito: string) => {
    if ("erro" in r) {
      await o.carteiro.enviarTexto(
        p.numero,
        r.erro === "mudou"
          ? (r.message ?? "Esse pedido já foi decidido ou venceu.")
          : r.erro === "nao_encontrado"
            ? RESPOSTAS_DO_TELEGRAM.pedidoNaoEncontrado
            : r.message,
      );
      return;
    }
    // A decisão já foi avisada aqui: a verificação não repete.
    await comEmpresa(o.poolApp, pedido.empresa_id, (c) =>
      c.query(
        "update aprovacoes_no_whatsapp set atualizada_em = now() where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = $2",
        [pedido.aprovacao_id, p.pessoaId],
      ),
    );
    await o.carteiro.enviarTexto(
      p.numero,
      r.aprovacao.situacao === "falhou"
        ? `Aprovado, mas não deu certo: ${r.aprovacao.resumo}. ${r.aprovacao.observacao ?? ""}`.trim()
        : `${feito}: ${r.aprovacao.resumo}`,
    );
  };
  if (pedido.acao === "recusar") {
    await fechar();
    if (!texto || comandoDoWhatsapp(texto)) return false;
    const motivo = /^sem motivo\.?$/i.test(texto) ? "Sem motivo." : texto.slice(0, 1000);
    await contar(await decidir("recusar", motivo), "Recusado");
    return true;
  }
  if (!pareceCodigo) {
    await fechar();
    return false;
  }
  if (await travado(o.poolApp, p.pessoaId)) {
    await fechar();
    await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.aprovacoesTravadas);
    return true;
  }
  const conferido = await ap.autenticador.conferir(p.pessoaId, texto.replace(/\s/g, ""));
  if (conferido === "sem_autenticador") {
    await fechar();
    await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.semAutenticador);
    return true;
  }
  if (conferido !== "certo") {
    // As mesmas travas do Telegram (por pessoa): errar por aqui conta lá também.
    const r = await o.poolApp.query<{ n: number }>(
      "select erros_de_codigo_no_telegram($1, true, $2, $3) as n",
      [p.pessoaId, MINUTOS_DA_TRAVA_DAS_APROVACOES, ERROS_DE_CODIGO_NA_APROVACAO],
    );
    const erros = r.rows[0]?.n ?? 0;
    if (erros >= ERROS_DE_CODIGO_NA_APROVACAO) {
      await fechar();
      await comEmpresa(o.poolApp, pedido.empresa_id, (c) =>
        criarAviso(c, {
          pessoaId: p.pessoaId,
          tipo: "telegram_aprovacoes_travadas",
          texto:
            "Três códigos errados ao aprovar pelo WhatsApp: as aprovações pelo WhatsApp e pelo Telegram ficam travadas por 15 minutos. Se não foi você, troque a senha e confira os aparelhos.",
          link: "/aprovacoes",
        }),
      ).catch(() => {});
      await o.carteiro.enviarTexto(p.numero, RESPOSTAS_DO_WHATSAPP.aprovacoesTravadas);
    } else
      await o.carteiro.enviarTexto(p.numero, respostaDeCodigoErrado(ERROS_DE_CODIGO_NA_APROVACAO - erros));
    return true;
  }
  await fechar();
  await contar(await decidir("aprovar"), "Aprovado");
  return true;
}
