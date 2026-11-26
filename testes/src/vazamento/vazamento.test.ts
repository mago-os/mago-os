/**
 * Teste de vazamento entre empresas em todas as partes (M6-01, decisão 1 da spec do M6).
 *
 * Duas empresas com os mesmos perfis. A empresa B usa o sistema inteiro pela API de verdade (todas as rotas, as
 * ferramentas dos agentes internos e do MCP, o Telegram), e cada pedido dela fica gravado. Depois a empresa A repete
 * cada pedido, com os mesmos ids da B, pelo administrador (e, nas consultas, também pelo gestor e pelo funcionário).
 * Nada do que a A recebe pode ter um id ou um texto da B, e as linhas da B não podem mudar. Os canais (Telegram,
 * tempo real, push e e-mail) e os trabalhos da fila são conferidos do mesmo jeito, e no fim nenhuma linha de uma
 * empresa aponta para um id da outra.
 *
 * Rota nova: entra no roteiro da empresa B (função usarTudo) ou na lista FORA, com o motivo. Sem isso, o primeiro
 * teste fica vermelho.
 */
import type { AtualizacaoDoTelegram } from "@mago-os/contratos";
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { cuidarDosAlertasDaAgenda } from "@mago-os/nucleo/agenda";
import { rodarExecucao, verificarAprovacoesVencidas } from "@mago-os/nucleo/agentes-internos";
import { cuidarDosAnexos } from "@mago-os/nucleo/anexos/servico";
import { enviarPushPendentes, verificarPrazos } from "@mago-os/nucleo/avisos/notificacoes";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { type ChamadaDeFerramenta, modelosFalsos } from "@mago-os/nucleo/contas-de-ia";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { cuidarDasRotinas } from "@mago-os/nucleo/rotinas";
import {
  avisarNoTelegram,
  cuidarDasAprovacoesNoTelegram,
  entregarPendentesNoTelegram,
  resumoDoDiaNoTelegram,
  tratarAtualizacao,
} from "@mago-os/nucleo/telegram";
import { cuidarDosWebhooks } from "@mago-os/nucleo/webhooks";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "../preparar-banco.ts";
import { idsDasEmpresas, referenciasCruzadas, retratoDaEmpresa, vazamentosNoTexto } from "./marcas.ts";
import { type ApiDeTeste, CHAVE_DE_IA, montarApiDeTeste, SITE, TOKEN_DO_PLANO } from "./montar-api.ts";

const SENHA = "uma frase longa e boa para entrar";
const SILENCIO = { info() {}, warn() {}, error() {} };
type Sigla = "A" | "B";
const MARCA: Record<Sigla, string> = { A: "Azq7", B: "Bzq7" };
/** Conta do Telegram de cada administrador. */
const TELEGRAM: Record<Sigla, number> = { A: 7101, B: 7102 };
const TELEGRAM_DO_FUNCIONARIO: Record<Sigla, number> = { A: 7201, B: 7202 };

/**
 * Rotas fora do roteiro, com o motivo. Cada uma é coberta de outro jeito (nesta mesma suíte ou num teste próprio).
 */
const FORA: Record<string, string> = {
  "GET /saude": "pública, sem dado de empresa (a saúde da API e do banco)",
  "GET /acesso/estado": "da pessoa, não da empresa (esquema acesso); testada no login",
  "GET /acesso/aparelhos": "aparelhos da própria pessoa (esquema acesso); testada em aparelhos.test",
  "POST /acesso/aparelhos/desconectar": "aparelhos da própria pessoa; testada em aparelhos.test",
  "POST /acesso/aparelhos/desconectar-outros": "aparelhos da própria pessoa; testada em aparelhos.test",
  "GET /acesso/avisos": "avisos de aparelho novo da própria pessoa; testada em aparelhos.test",
  "POST /acesso/avisos/responder": "avisos de aparelho novo da própria pessoa; testada em aparelhos.test",
  "GET /acesso/*": "o login (Better Auth), antes de existir empresa ativa",
  "POST /acesso/*": "o login (Better Auth), antes de existir empresa ativa",
  "GET /acesso/convite/:codigo": "pública, pelo código de uso único do convite; testada em convites.test",
  "POST /acesso/convite/aceitar": "pública, pelo código de uso único do convite; testada em convites.test",
  "POST /acesso/convite-de-empresa/preparar-google":
    "pública, pelo código do convite de empresa; contas.test",
  "GET /acesso/convite-de-empresa/:codigo": "pública, pelo código do convite de empresa; contas.test",
  "POST /acesso/convite-de-empresa/criar": "pública, pelo código do convite de empresa; contas.test",
  "GET /plataforma/regras": "só o Dono da plataforma, que cuida de todas as empresas por definição",
  "PUT /plataforma/regras": "só o Dono da plataforma",
  "GET /plataforma/agentes/paradas": "só o Dono da plataforma",
  "POST /plataforma/agentes/parar-todos": "só o Dono da plataforma",
  "POST /plataforma/agentes/retomar-todos": "só o Dono da plataforma",
  "GET /plataforma/empresas": "só o Dono da plataforma",
  "POST /plataforma/empresas/convites": "só o Dono da plataforma",
  "POST /plataforma/empresas/convites/:id/reenviar": "só o Dono da plataforma",
  "POST /plataforma/empresas/convites/:id/cancelar": "só o Dono da plataforma",
  "GET /openapi.json": "pública, sem nenhum dado (a documentação da API, M7-02)",
  "GET /docs": "pública, sem nenhum dado (a documentação da API, M7-02)",
  "GET /mcp": "o MCP sem sessão só responde que não aceita; o POST /mcp está no roteiro",
  "DELETE /mcp": "o MCP sem sessão só responde que não aceita; o POST /mcp está no roteiro",
  "PUT /deposito-local":
    "link assinado de 5 minutos (é a própria permissão) e só existe no Mac; o S3 é igual",
  "GET /deposito-local":
    "link assinado de 5 minutos (é a própria permissão) e só existe no Mac; o S3 é igual",
  "GET /tempo-real":
    "WebSocket: a conexão da empresa A fica aberta durante todo o roteiro da B (teste dos canais)",
  "POST /telegram/webhook":
    "o Telegram chama com o segredo; o roteiro usa o mesmo tratamento (tratarAtualizacao)",
};

interface Pessoa {
  id: string;
  email: string;
  vinculoId: string;
  cookie: string;
}
interface Empresa {
  sigla: Sigla;
  id: string;
  admin: Pessoa;
  gestor: Pessoa;
  func: Pessoa;
  /** Desligada no fim do roteiro (a ação de desligar alguém). */
  extra: Pessoa;
  ids: Record<string, string>;
  chaveDoAgente: string;
  /** A chave de API da empresa (M7-02), em nome do administrador, com todos os módulos. */
  chaveDeApi?: string;
}
interface Pedido {
  metodo: string;
  url: string;
  corpo?: unknown;
  rota: string;
  /** Pedido feito pela chave do agente (MCP e estou-vivo), não por uma pessoa. */
  peloAgente?: boolean;
  /** Pedido feito pela chave de API da empresa (M7-02). */
  pelaApi?: boolean;
  /** Ação que apaga ou encerra: a B só a faz depois que a A tentou. */
  destrutivo?: boolean;
}

describe.skipIf(!bancoDisponivel)("vazamento entre empresas em todas as partes (M6-01)", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let api: ApiDeTeste;
  let ip = 0;
  let numero = 50_000;
  const roteiro: Parameters<typeof modelosFalsos>[0] = [];
  const modelos = modelosFalsos(roteiro);
  const E = {} as Record<Sigla, Empresa>;
  /** Pedidos da empresa B, na ordem. */
  const pedidosDaB: Pedido[] = [];
  /** Ferramentas internas que a empresa B usou (pelo coordenador), com a entrada de cada uma. */
  const ferramentasDaB: {
    nome: string;
    entrada: Record<string, unknown>;
    papel: "coordenador" | "especialista";
  }[] = [];
  const avisosDoTempoReal: string[] = [];
  const pushes: { endpoint: string; texto: string }[] = [];

  // ---------------------------------------------------------------------------------------------- ajudantes

  async function criarPessoa(
    empresaId: string,
    nome: string,
    email: string,
    perfil: string,
    area: string | null,
  ) {
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
      [nome, email],
    );
    const id = p.rows[0]?.id as string;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    const v = await dono.query<{ id: string }>(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now()) returning id`,
      [empresaId, id, perfil, area],
    );
    ip += 1;
    const r = await api.app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.61.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode, r.body).toBe(200);
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = $1",
      [id],
    );
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) values ($1, 'c', $2, 'multiDevice')",
      [id, email],
    );
    const cookie = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    return { id, email, vinculoId: v.rows[0]?.id as string, cookie };
  }

  /** A rota registrada que atende o pedido (a mais específica). */
  function rotaDe(metodo: string, url: string): string {
    const caminho = url.split("?")[0] as string;
    const candidatas = api.rotas
      .filter((r) => r.metodo === metodo)
      .filter((r) => {
        const rx = new RegExp(
          `^${r.url
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/:[A-Za-z]+/g, "[^/]+")}$`,
        );
        return rx.test(caminho);
      })
      .sort((a, b) => (a.url.match(/[:*]/g)?.length ?? 0) - (b.url.match(/[:*]/g)?.length ?? 0));
    return candidatas[0] ? `${metodo} ${candidatas[0].url}` : `${metodo} ${caminho} (sem rota)`;
  }

  function injetar(metodo: string, url: string, quem: { cookie?: string; chave?: string }, corpo?: unknown) {
    const mcp = url === "/mcp";
    return api.app.inject({
      method: metodo as "GET",
      url,
      headers: {
        origin: SITE,
        ...(quem.cookie ? { cookie: quem.cookie } : {}),
        ...(quem.chave ? { authorization: `Bearer ${quem.chave}` } : {}),
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
        ...(mcp ? { accept: "application/json, text/event-stream" } : {}),
      },
      ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  /**
   * Um pedido do roteiro. Na B fica gravado. O destrutivo só é gravado (a B o faz depois que a A tentou); na A ele
   * nem acontece.
   */
  async function usar(
    x: Empresa,
    quem: Pessoa | { chave: string },
    metodo: string,
    url: string,
    corpo?: unknown,
    opcoes: { destrutivo?: boolean } = {},
    // biome-ignore lint/suspicious/noExplicitAny: as respostas variam por rota; o roteiro lê só o que precisa.
  ): Promise<any> {
    const pelaApi = "chave" in quem && quem.chave.startsWith("mago_api_");
    const peloAgente = "chave" in quem && !pelaApi;
    if (x.sigla === "B")
      pedidosDaB.push({
        metodo,
        url,
        ...(corpo !== undefined ? { corpo } : {}),
        rota: rotaDe(metodo, url),
        ...(peloAgente ? { peloAgente } : {}),
        ...(pelaApi ? { pelaApi } : {}),
        ...(opcoes.destrutivo ? { destrutivo: true } : {}),
      });
    if (opcoes.destrutivo) return null;
    const r = await injetar(metodo, url, quem, corpo);
    expect(r.statusCode, `${x.sigla}: ${metodo} ${url}: ${r.body}`).toBeLessThan(300);
    const tipo = String(r.headers["content-type"] ?? "");
    if (tipo.includes("event-stream")) {
      const dados = /data: (.*)/.exec(r.body)?.[1];
      return dados ? JSON.parse(dados) : null;
    }
    return r.body && tipo.includes("json") ? r.json() : null;
  }

  async function mandarNoTelegram(conta: number, texto: string | null, extra: Record<string, unknown> = {}) {
    numero += 1;
    await tratarAtualizacao(
      api.interno.bot as NonNullable<typeof api.interno.bot>,
      {
        update_id: numero,
        message: {
          message_id: numero,
          date: Math.floor(Date.now() / 1000),
          chat: { id: conta, type: "private" },
          from: { id: conta, is_bot: false, first_name: `Conta ${conta}` },
          ...(texto === null ? {} : { text: texto }),
          ...extra,
        },
      } as AtualizacaoDoTelegram,
    );
  }

  /** Roda as execuções dos agentes que estão na fila (e as que elas criam). */
  async function rodarAgentes() {
    for (let i = 0; i < 50; i++) {
      const t = api.enviados.findIndex((x) => x.fila === "agentes-internos");
      if (t < 0) return;
      const [trabalho] = api.enviados.splice(t, 1);
      const d = trabalho?.dados as { empresaId: string; execucaoId: string };
      await rodarExecucao(api.interno.motor, d.empresaId, d.execucaoId);
    }
  }

  /** O coordenador da empresa usa uma ferramenta (pela conversa) e responde. Devolve o que a ferramenta devolveu. */
  async function coordenadorUsa(x: Empresa, nome: string, entrada: Record<string, unknown>) {
    if (x.sigla === "B") ferramentasDaB.push({ nome, entrada, papel: "coordenador" });
    roteiro.push(
      () => ({ chamadas: [{ id: `f-${nome}`, nome, entrada } as ChamadaDeFerramenta] }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Feito." } }] }),
    );
    const antes = modelos.pedidos.length;
    const r = await injetar("POST", "/conversas/mensagens", x.admin, {
      texto: `Use ${nome} ${MARCA[x.sigla]}`,
    });
    expect(r.statusCode, r.body).toBeLessThan(300);
    await rodarAgentes();
    roteiro.length = 0;
    return resultadosDasFerramentas(antes);
  }

  /** Os resultados de ferramenta que os modelos receberam a partir do pedido "antes". */
  function resultadosDasFerramentas(antes: number): string[] {
    return modelos.pedidos
      .slice(antes)
      .flatMap((p) => p.partes)
      .filter((p) => p.papel === "resultado")
      .map((p) => (p as { conteudo: string }).conteudo);
  }

  // ---------------------------------------------------------------------------------------------- o roteiro

  /** A empresa usa todas as rotas do sistema. Na B, cada pedido fica gravado para a A repetir. */
  async function usarTudo(x: Empresa) {
    const M = MARCA[x.sigla];
    const m = x.sigla.toLowerCase();
    const { admin, gestor, func } = x;
    const ids = x.ids;

    // Pessoas, permissões, segurança e dados da empresa.
    await usar(x, admin, "GET", "/empresa/pessoas");
    await usar(x, func, "GET", "/empresa/minhas-permissoes");
    await usar(x, admin, "GET", `/empresa/pessoas/${func.vinculoId}/permissoes`);
    await usar(x, admin, "PUT", "/empresa/permissoes", {
      vinculoId: func.vinculoId,
      modulo: "pessoas",
      acao: "ver",
      alcance: "equipe",
    });
    await usar(x, admin, "GET", "/empresa/seguranca");
    await usar(x, admin, "PUT", "/empresa/seguranca", { exigirDoisFatores: false, exigirPasskey: false });
    await usar(x, admin, "GET", "/empresa/dados");
    await usar(x, admin, "POST", "/empresa/dados", {
      nome: `Empresa ${M}`,
      tipo: null,
      documento: null,
      nomeLegal: null,
      fusoHorario: "America/Sao_Paulo",
      idioma: "pt-BR",
      telefone: null,
    });
    await usar(x, admin, "GET", "/conta/perfil");
    await usar(x, admin, "PUT", "/conta/perfil", {
      nome: `Admin ${M}`,
      idioma: "pt-BR",
      fusoHorario: "America/Sao_Paulo",
    });
    await usar(x, admin, "GET", "/conta/empresas");
    await usar(x, admin, "POST", "/conta/empresa-ativa", { empresaId: x.id });

    // Espaços, projetos, listas e status.
    ids.espaco = (await usar(x, admin, "POST", "/espacos", { nome: `Espaço ${M}` })).id;
    await usar(x, admin, "GET", "/espacos");
    await usar(x, admin, "POST", `/espacos/${ids.espaco}`, { nome: `Espaço ${M} 2` });
    ids.projeto = (
      await usar(x, admin, "POST", "/projetos", { espacoId: ids.espaco, nome: `Projeto ${M}` })
    ).id;
    ids.projeto2 = (
      await usar(x, admin, "POST", "/projetos", { espacoId: ids.espaco, nome: `Outro ${M}` })
    ).id;
    await usar(x, admin, "GET", "/projetos");
    const projeto = await usar(x, admin, "GET", `/projetos/${ids.projeto}`);
    await usar(x, admin, "POST", `/projetos/${ids.projeto}`, { nome: `Projeto ${M} 2` });
    ids.lista = (await usar(x, admin, "POST", `/projetos/${ids.projeto}/listas`, { nome: `Lista ${M}` })).id;
    ids.lista2 = (await usar(x, admin, "POST", `/projetos/${ids.projeto}/listas`, { nome: `Sobra ${M}` })).id;
    await usar(x, admin, "POST", `/listas/${ids.lista}`, { nome: `Lista ${M} 2` });
    const status = (projeto.status ?? projeto.projeto?.status) as {
      id: string;
      nome: string;
      cor: string;
      tipo: string;
    }[];
    await usar(x, admin, "POST", `/projetos/${ids.projeto}/status`, {
      status: [
        ...status.map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo })),
        { nome: `Revisão ${M}`, cor: "#8b5cf6", tipo: "em_andamento" },
      ],
    });

    // Etiquetas, tarefas e tudo dentro delas.
    ids.etiqueta = (await usar(x, admin, "POST", "/etiquetas", { nome: `Etiqueta ${M}`, cor: "#3b82f6" })).id;
    ids.etiqueta2 = (await usar(x, admin, "POST", "/etiquetas", { nome: `Sobra ${M}`, cor: "#3b82f6" })).id;
    await usar(x, admin, "GET", "/etiquetas");
    ids.tarefa = (
      await usar(x, admin, "POST", "/tarefas", { titulo: `Tarefa ${M}`, projetoId: ids.projeto })
    ).id;
    ids.tarefa2 = (await usar(x, admin, "POST", "/tarefas", { titulo: `Contrato ${M}` })).id;
    ids.tarefa3 = (await usar(x, admin, "POST", "/tarefas", { titulo: `Para apagar ${M}` })).id;
    await usar(x, admin, "GET", "/tarefas");
    await usar(x, gestor, "GET", `/tarefas?projeto=${ids.projeto}&espaco=${ids.espaco}`);
    await usar(x, admin, "GET", `/tarefas?etiquetas=${ids.etiqueta}&responsaveis=p:${func.id}`);
    await usar(x, admin, "GET", `/tarefas/${ids.tarefa}`);
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/status`, { status: "precisa_de_ajuda" });
    await usar(x, gestor, "POST", `/tarefas/${ids.tarefa}/seguir`);
    await usar(x, gestor, "DELETE", `/tarefas/${ids.tarefa}/seguir`);
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/lista`, { listaId: ids.lista });
    const item = await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/checklist`, { texto: `Item ${M}` });
    ids.item = item.id ?? item.item?.id;
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/checklist/${ids.item}`, { marcado: true });
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/planejamento`, { prazo: { dia: "2020-02-01" } });
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/responsavel`, {
      responsavel: { tipo: "pessoa", pessoaId: func.id },
    });
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa2}/projeto`, { projetoId: ids.projeto2 });
    const comentario = await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/comentarios`, {
      texto: `Comentário ${M} para @Func`,
    });
    ids.comentario = comentario.id ?? comentario.comentario?.id;
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/comentarios/${ids.comentario}`, {
      texto: `Comentário ${M} editado`,
    });
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa2}/pegar`);
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa2}/soltar`);
    await usar(x, func, "POST", `/tarefas/${ids.tarefa}/pegar`);
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/destravar`, { motivo: `Destravar ${M}` });

    // Prioridades, visões, busca e layouts.
    const prioridades = await usar(x, func, "GET", "/prioridades");
    const chave = (prioridades.itens ?? prioridades)[0]?.chave as string;
    expect(chave, "a tarefa atrasada aparece nas prioridades").toBeTruthy();
    await usar(x, func, "POST", "/prioridades/adiar", { chave, ate: "2031-01-01" });
    await usar(x, func, "POST", "/prioridades/resolver", { chave });
    ids.visao = (
      await usar(x, admin, "POST", "/visoes", {
        nome: `Visão ${M}`,
        tipo: "lista",
        filtro: { prazo: "atrasadas", projetoId: ids.projeto },
        agruparPor: "responsavel",
      })
    ).id;
    await usar(x, admin, "GET", "/visoes");
    await usar(x, admin, "GET", `/busca?texto=${M}`);
    await usar(x, func, "GET", `/busca?texto=${M}`);
    const layout = {
      nome: `Layout ${M}`,
      aparelho: "computador",
      estrutura: {
        paineis: [{ id: "t1", tipo: "tarefas" }],
        divisao: {
          grid: {},
          panels: {
            t1: { id: "t1", contentComponent: "tarefas", params: { painel: { id: "t1", tipo: "tarefas" } } },
          },
        },
      },
    };
    ids.layout = (await usar(x, admin, "POST", "/layouts", layout)).id;
    await usar(x, admin, "GET", "/layouts?aparelho=computador");
    await usar(x, admin, "POST", `/layouts/${ids.layout}`, { ...layout, nome: `Layout ${M} 2` });
    await usar(x, admin, "POST", `/layouts/${ids.layout}/usar`);

    // Agentes, chaves, contas de IA, modelos, regras, limites e custos.
    const agentes = (await usar(x, admin, "GET", "/agentes")) as { id: string; papel: string }[];
    ids.coordenador = agentes.find((a) => a.papel === "coordenador")?.id as string;
    ids.especialista = agentes.find((a) => a.papel === "especialista")?.id as string;
    expect(ids.coordenador && ids.especialista, "agentes padrão da empresa").toBeTruthy();
    ids.robo = (await usar(x, admin, "POST", "/agentes", { nome: `Robô ${M}`, responsavelId: admin.id })).id;
    await usar(x, admin, "GET", `/agentes/${ids.robo}`);
    await usar(x, admin, "POST", `/agentes/${ids.robo}`, { nome: `Robô ${M} 2` });
    await usar(x, admin, "POST", `/agentes/${ids.robo}/pausar`, {});
    await usar(x, admin, "POST", `/agentes/${ids.robo}/retomar`, {});
    const chave1 = await usar(x, admin, "POST", `/agentes/${ids.robo}/chaves`, { nome: `Chave ${M}` });
    x.chaveDoAgente = chave1.segredo;
    ids.chave2 = (
      await usar(x, admin, "POST", `/agentes/${ids.robo}/chaves`, { nome: `Sobra ${M}` })
    ).chave.id;
    await usar(x, admin, "GET", `/agentes/${ids.robo}/chaves`);
    ids.conta = (
      await usar(x, admin, "POST", "/ia/contas", {
        nome: `Conta ${M}`,
        provedor: "anthropic",
        chave: CHAVE_DE_IA,
      })
    ).id;
    ids.conta2 = (
      await usar(x, admin, "POST", "/ia/contas", {
        nome: `Sobra ${M}`,
        provedor: "anthropic",
        chave: CHAVE_DE_IA,
      })
    ).id;
    await usar(x, admin, "GET", "/ia/contas");
    await usar(x, admin, "POST", `/ia/contas/${ids.conta}`, { nome: `Conta ${M} 2` });
    await usar(x, admin, "POST", `/ia/contas/${ids.conta}/testar`, {});
    await usar(x, admin, "POST", `/ia/contas/${ids.conta}/modelos`, {
      modelos: [{ modelo: "modelo-bom", liberado: true }],
    });
    await usar(x, admin, "GET", `/ia/contas/${ids.conta}/modelos`);
    await usar(x, admin, "GET", "/ia/modelos");
    await usar(x, admin, "POST", `/ia/contas/${ids.conta}/precos`, {
      modelo: "modelo-bom",
      preco: { entrada: 300, saida: 1500, cache: 30 },
    });
    ids.plano = (
      await usar(x, admin, "POST", "/ia/contas", {
        nome: `Plano ${M}`,
        provedor: "anthropic",
        credencial: "assinatura",
        chave: TOKEN_DO_PLANO,
        aceitoOsTermos: true,
      })
    ).id;
    await usar(x, admin, "POST", `/ia/contas/${ids.plano}/limite-de-tokens`, {
      tokens: 5_000_000,
      aoChegar: "avisar",
    });
    for (const agente of [ids.coordenador, ids.especialista]) {
      await usar(x, admin, "POST", `/agentes/${agente}/modelos`, {
        modelos: { principal: { contaId: ids.conta, modelo: "modelo-bom" }, reserva: null },
      });
      await usar(x, admin, "POST", `/agentes/${agente}/retomar`, {});
    }
    await usar(x, admin, "GET", `/agentes/${ids.coordenador}/modelos`);
    await usar(x, admin, "GET", `/agentes/${ids.coordenador}/limites`);
    await usar(x, admin, "POST", `/agentes/${ids.coordenador}/limites`, { rodadas: 20, minutos: null });
    await usar(x, admin, "GET", `/agentes/${ids.coordenador}/regras`);
    await usar(x, admin, "POST", `/agentes/${ids.coordenador}/regras`, {
      regras: [
        { acao: "mudar_projeto", modo: "executa" },
        { acao: "acrescentar_checklist", modo: "executa" },
      ],
    });
    await usar(x, admin, "GET", "/custos");
    await usar(x, admin, "POST", "/custos/tetos/empresa", { teto: null });
    await usar(x, admin, "POST", `/custos/tetos/agente/${ids.coordenador}`, { teto: null });
    await usar(x, admin, "GET", "/agentes/parada");
    await usar(x, admin, "POST", "/agentes/parar-todos", { motivo: `Parada ${M}` });
    await usar(x, admin, "POST", "/agentes/retomar-todos", { agenteIds: null });

    // Instruções e skills.
    await usar(x, admin, "GET", "/instrucoes/empresa");
    await usar(x, admin, "POST", "/instrucoes/empresa", { texto: `Regra da empresa ${M}` });
    await usar(x, admin, "POST", "/instrucoes/empresa", { texto: `Regra da empresa ${M} v2` });
    await usar(x, admin, "POST", "/instrucoes/empresa/voltar", { versao: 1 });
    await usar(x, admin, "GET", `/instrucoes/projeto/${ids.projeto}`);
    await usar(x, admin, "POST", `/instrucoes/projeto/${ids.projeto}`, { texto: `Regra do projeto ${M}` });
    await usar(x, admin, "POST", `/instrucoes/projeto/${ids.projeto}`, { texto: `Regra do projeto ${M} v2` });
    await usar(x, admin, "POST", `/instrucoes/projeto/${ids.projeto}/voltar`, { versao: 1 });
    await usar(x, admin, "GET", `/agentes/${ids.coordenador}/instrucoes`);
    ids.skill = (
      await usar(x, admin, "POST", "/skills", {
        nome: `skill-${m}zq`,
        descricao: `Skill ${M}`,
        texto: `Texto ${M}`,
      })
    ).id;
    await usar(x, admin, "GET", "/skills");
    await usar(x, admin, "GET", `/skills/${ids.skill}`);
    await usar(x, admin, "POST", `/skills/${ids.skill}/rascunho`, {
      nome: `skill-${m}zq`,
      descricao: `Skill ${M} 2`,
      texto: `Texto ${M} 2`,
    });
    await usar(x, admin, "POST", `/skills/${ids.skill}/publicar`, {});
    await usar(x, admin, "GET", `/agentes/${ids.coordenador}/skills`);
    await usar(x, admin, "POST", `/agentes/${ids.coordenador}/skills`, { skills: [ids.skill] });
    await usar(x, admin, "POST", `/agentes/${ids.robo}/skills`, { skills: [ids.skill] });

    // Anexos (o depósito local do Mac e o conferente de teste no lugar do ClamAV).
    const conteudo = Buffer.from(`Arquivo ${M}`);
    const envio = await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/anexos`, {
      nome: `arquivo-${m}.txt`,
      tipo: "text/plain",
      tamanho: conteudo.length,
      descricao: `Anexo ${M}`,
    });
    ids.anexo = envio.anexo.id;
    const put = await api.app.inject({
      method: "PUT",
      url: (envio.url as string).replace(`${SITE}/api`, ""),
      headers: { "content-type": "text/plain" },
      payload: conteudo,
    });
    expect(put.statusCode, put.body).toBe(200);
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/anexos/${ids.anexo}/enviado`);
    await cuidarDosAnexos(
      api.poolApp,
      api.interno.anexos as NonNullable<typeof api.interno.anexos>,
      SILENCIO,
    );
    await usar(x, admin, "GET", `/tarefas/${ids.tarefa}/anexos`);
    await usar(x, admin, "GET", `/tarefas/${ids.tarefa}/anexos/${ids.anexo}/link`);
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/anexos/${ids.anexo}/descricao`, {
      descricao: `Anexo ${M} 2`,
    });
    await usar(x, admin, "GET", "/empresa/espaco-dos-anexos");

    // Avisos e notificações.
    await usar(x, func, "GET", "/notificacoes");
    await usar(x, func, "POST", "/notificacoes/push", {
      endpoint: `https://push.exemplo.invalid/${m}`,
      chaves: { p256dh: "chave", auth: "segredo" },
    });
    await usar(x, func, "POST", "/notificacoes/preferencias", {
      porTipo: { tarefa_atribuida: { tela: true, push: true } },
      silencio: null,
    });
    await usar(x, admin, "GET", "/avisos");
    const aviso = await dono.query<{ id: string; pessoa_id: string }>(
      "select id, pessoa_id from avisos where empresa_id = $1 and lido_em is null order by criado_em limit 1",
      [x.id],
    );
    const dono_ = [admin, gestor, func, x.extra].find((p) => p.id === aviso.rows[0]?.pessoa_id);
    expect(dono_, "um aviso no sino de alguém da empresa").toBeTruthy();
    await usar(x, dono_ as Pessoa, "POST", `/avisos/${aviso.rows[0]?.id}/lido`);
    await usar(x, admin, "POST", "/avisos/lidos");

    // Agenda.
    ids.evento = (
      await usar(x, admin, "POST", "/agenda/eventos", {
        titulo: `Reunião ${M}`,
        inicio: { dia: "2030-01-10", hora: "15:00" },
        fim: { dia: "2030-01-10", hora: "16:00" },
        participantes: [admin.id, func.id],
        tarefaId: ids.tarefa,
      })
    ).id;
    await usar(x, func, "GET", "/agenda?de=2030-01-01&ate=2030-01-31");
    await usar(x, gestor, "GET", `/agenda?de=2030-01-01&ate=2030-01-31&pessoas=${admin.id},${func.id}`);
    await usar(x, admin, "GET", `/agenda/eventos/${ids.evento}`);
    await usar(x, admin, "POST", `/agenda/eventos/${ids.evento}`, { titulo: `Reunião ${M} 2` });
    await usar(x, func, "POST", `/agenda/eventos/${ids.evento}/resposta`, { resposta: "vou" });

    // Contatos (M7-01): organização, pessoa ligada, repetido, tarefa, projeto, visão e juntar.
    ids.organizacao = (
      await usar(x, admin, "POST", "/contatos", {
        tipo: "organizacao",
        nome: `Organização ${M}`,
        papeis: ["cliente"],
        etiquetas: [ids.etiqueta],
        observacoes: `Observação ${M}`,
      })
    ).contato.id;
    ids.contato = (
      await usar(x, admin, "POST", "/contatos", {
        tipo: "pessoa",
        nome: `Contato ${M}`,
        identificadores: [
          { tipo: "email", valor: `contato.${x.sigla.toLowerCase()}@teste.invalid`, principal: true },
        ],
        organizacoes: [{ organizacaoId: ids.organizacao, cargo: `Cargo ${M}` }],
        responsavelId: func.id,
      })
    ).contato.id;
    ids.contato2 = (
      await usar(x, func, "POST", "/contatos", {
        tipo: "pessoa",
        nome: `Contato repetido ${M}`,
        identificadores: [
          { tipo: "email", valor: `contato.${x.sigla.toLowerCase()}@teste.invalid`, principal: true },
        ],
      })
    ).contato.id;
    await usar(x, func, "GET", `/contatos?texto=${encodeURIComponent(M)}&organizacao=${ids.organizacao}`);
    await usar(x, admin, "GET", `/contatos/${ids.organizacao}`);
    await usar(x, admin, "POST", `/contatos/${ids.contato}`, {
      observacoes: `Mudou ${M}`,
      etiquetas: [ids.etiqueta],
    });
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa}/contatos`, {
      contatos: [ids.contato, ids.organizacao],
    });
    await usar(x, admin, "GET", `/tarefas/${ids.tarefa}/contatos`);
    await usar(x, admin, "POST", `/projetos/${ids.projeto}/contatos`, { contatos: [ids.organizacao] });
    await usar(x, admin, "GET", `/projetos/${ids.projeto}/contatos`);
    ids.visaoDeContatos = (
      await usar(x, admin, "POST", "/contatos-visoes", {
        nome: `Visão ${M}`,
        filtro: { organizacaoId: ids.organizacao, etiquetas: [ids.etiqueta], responsaveis: [func.id] },
      })
    ).id;
    await usar(x, admin, "GET", "/contatos-visoes");
    await usar(x, gestor, "POST", "/contatos/juntar", { ficaId: ids.contato, saiId: ids.contato2 });

    // API pública (M7-02): a chave da empresa, os endereços /v1 e a troca.
    const criada = await usar(x, admin, "POST", "/empresa/chaves-de-api", {
      nome: `Chave ${M}`,
      escopo: { tarefas: "escrever", projetos: "ler", contatos: "escrever", agentes: "ler" },
      pessoaId: admin.id,
    });
    ids.chaveDeApi = criada.chave.id;
    x.chaveDeApi = criada.segredo;
    await usar(x, admin, "GET", "/empresa/chaves-de-api");
    const k = { chave: criada.segredo as string };
    await usar(x, k, "GET", `/v1/tarefas?projetoId=${ids.projeto}&texto=${encodeURIComponent(M)}`);
    await usar(x, k, "GET", `/v1/tarefas/${ids.tarefa}`);
    ids.tarefaDaApi = (
      await usar(x, k, "POST", "/v1/tarefas", { titulo: `Tarefa pela API ${M}`, projetoId: ids.projeto })
    ).id;
    await usar(x, k, "POST", `/v1/tarefas/${ids.tarefaDaApi}/status`, { status: "em_andamento" });
    await usar(x, k, "GET", `/v1/tarefas/${ids.tarefa}/comentarios`);
    await usar(x, k, "POST", `/v1/tarefas/${ids.tarefaDaApi}/comentarios`, { texto: `Pela API ${M}` });
    await usar(x, k, "POST", `/v1/tarefas/${ids.tarefaDaApi}/contatos`, { contatos: [ids.contato] });
    await usar(x, k, "GET", "/v1/projetos");
    await usar(x, k, "GET", `/v1/projetos/${ids.projeto}`);
    await usar(x, k, "GET", `/v1/contatos?organizacaoId=${ids.organizacao}`);
    await usar(x, k, "GET", `/v1/contatos/${ids.organizacao}`);
    ids.contatoDaApi = (
      await usar(x, k, "POST", "/v1/contatos", { tipo: "pessoa", nome: `Pela API ${M}` })
    ).contato.id;
    await usar(x, k, "POST", `/v1/contatos/${ids.contatoDaApi}`, {
      organizacoes: [{ organizacaoId: ids.organizacao }],
    });
    await usar(x, k, "GET", "/v1/agentes");
    ids.chaveDeApi2 = (
      await usar(x, admin, "POST", `/empresa/chaves-de-api/${ids.chaveDeApi}/trocar`, {})
    ).chave.id;

    // Webhooks de saída (M7-03): cadastrar, mudar, trocar o segredo, mandar teste, histórico e tentar de novo.
    const wh = await usar(x, admin, "POST", "/empresa/webhooks", {
      nome: `Webhook ${M}`,
      url: `https://n8n-${x.sigla.toLowerCase()}.exemplo.com.br/webhook`,
      eventos: ["tarefa.criada", "tarefa.comentada", "contato.criado"],
    });
    ids.webhook = wh.webhook.id;
    await usar(x, admin, "GET", "/empresa/webhooks");
    await usar(x, admin, "POST", `/empresa/webhooks/${ids.webhook}`, { nome: `Webhook ${M} 2` });
    await usar(x, admin, "POST", `/empresa/webhooks/${ids.webhook}/trocar-segredo`, {});
    ids.entregaDeWebhook = (
      await usar(x, admin, "POST", `/empresa/webhooks/${ids.webhook}/teste`, {})
    ).entregaId;
    await usar(x, admin, "GET", `/empresa/webhooks/${ids.webhook}/entregas`);
    await usar(
      x,
      admin,
      "POST",
      `/empresa/webhooks/${ids.webhook}/entregas/${ids.entregaDeWebhook}/reenviar`,
      {},
    );

    // Rotinas (por horário e por evento, com filtro de projeto).
    ids.rotina = (
      await usar(x, admin, "POST", "/rotinas", {
        nome: `Rotina ${M}`,
        gatilho: {
          tipo: "horario",
          regra: { frequencia: "semanal", intervalo: 1, diasDaSemana: [1] },
          horas: ["08:00"],
          fuso: "America/Sao_Paulo",
          inicio: "2030-01-01",
        },
        acao: {
          tipo: "pedir_ao_agente",
          agenteId: ids.coordenador,
          pedido: `Resuma as atrasadas ${M}`,
          resultado: "mensagem",
        },
      })
    ).id;
    ids.rotinaEvento = (
      await usar(x, admin, "POST", "/rotinas", {
        nome: `Quando concluir ${M}`,
        gatilho: { tipo: "evento", evento: "tarefa_concluida", filtros: { projetoId: ids.projeto } },
        acao: { tipo: "criar_tarefa", titulo: `Revisar {tarefa} ${M}`, projetoId: ids.projeto },
      })
    ).id;
    await usar(x, admin, "GET", "/rotinas");
    await usar(x, admin, "GET", `/rotinas/${ids.rotina}`);
    await usar(x, admin, "POST", `/rotinas/${ids.rotina}`, { nome: `Rotina ${M} 2` });
    await usar(x, admin, "POST", `/rotinas/${ids.rotinaEvento}/ligar`, {});
    await usar(x, admin, "POST", `/rotinas/${ids.rotina}/ligar`, {});
    await usar(x, admin, "POST", `/rotinas/${ids.rotina}/desligar`, {});
    await usar(x, admin, "POST", `/rotinas/${ids.rotina}/rodar`, {});

    // Convites.
    const convite = await usar(x, admin, "POST", "/empresa/convites", {
      email: `nina.${m}@teste.invalid`,
      nome: `Nina ${M}`,
      perfil: "funcionario",
      area: "comercial",
    });
    ids.convite = convite.vinculoId ?? convite.id ?? convite.vinculo?.id;
    await usar(x, admin, "POST", `/empresa/convites/${ids.convite}/reenviar`);

    // Telegram: o administrador e o funcionário vinculam a conta; o administrador conversa e manda um arquivo.
    for (const [pessoa, conta] of [
      [admin, TELEGRAM[x.sigla]],
      [func, TELEGRAM_DO_FUNCIONARIO[x.sigla]],
    ] as const) {
      const { codigo } = await usar(x, pessoa, "POST", "/conta/telegram/codigo");
      await mandarNoTelegram(conta, `/start ${codigo}`);
    }
    await usar(x, admin, "GET", "/conta/telegram");
    api.carteiro.arquivos.set(`doc-${m}`, Buffer.from(`Documento ${M}`));
    await mandarNoTelegram(TELEGRAM[x.sigla], null, {
      caption: `guarda este documento ${M}`,
      document: {
        file_id: `doc-${m}`,
        file_unique_id: `u-${m}`,
        file_size: 13,
        file_name: `documento-${m}.txt`,
        mime_type: "text/plain",
      },
    });
    await rodarAgentes();

    // Conversas e execuções.
    roteiro.push(() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: `Olá ${M}` } }] }));
    await usar(x, admin, "POST", "/conversas/mensagens", { texto: `Oi ${M}` });
    await rodarAgentes();
    roteiro.length = 0;
    const conversas = await usar(x, admin, "GET", "/conversas");
    ids.conversa = (conversas.conversas ?? conversas)[0]?.id;
    await usar(x, admin, "GET", `/conversas/${ids.conversa}`);
    const execucao = await dono.query<{ id: string }>(
      "select id from execucoes_de_agente where empresa_id = $1 order by criada_em desc limit 1",
      [x.id],
    );
    ids.execucao = execucao.rows[0]?.id as string;
    await usar(x, admin, "GET", `/execucoes/${ids.execucao}`);
    await usar(x, admin, "GET", `/tarefas/${ids.tarefa}/execucoes`);
    await usar(x, admin, "GET", `/agentes/${ids.coordenador}/execucoes`);

    // As ferramentas dos agentes internos, pelo coordenador e pelo especialista.
    await usarAsFerramentas(x);
    await usar(x, admin, "GET", "/aprovacoes");
    const aprovacao = await dono.query<{ id: string; conferencia: string }>(
      "select id, conferencia from aprovacoes where empresa_id = $1 and situacao = 'pendente' order by id limit 1",
      [x.id],
    );
    ids.aprovacao = aprovacao.rows[0]?.id as string;
    expect(ids.aprovacao, "um pedido de aprovação pendente").toBeTruthy();
    await usar(x, admin, "GET", `/aprovacoes/${ids.aprovacao}`);

    // O agente externo pelo MCP (a tarefa 2 é dele).
    await usar(x, admin, "POST", `/tarefas/${ids.tarefa2}/responsavel`, {
      responsavel: { tipo: "agente", agenteId: ids.robo },
    });
    await usarOMcp(x);

    // A auditoria de tudo isso.
    await usar(x, admin, "GET", "/empresa/auditoria");

    // O que apaga ou encerra (na B, só depois que a A tentou).
    const d = { destrutivo: true };
    await usar(
      x,
      admin,
      "POST",
      `/aprovacoes/${ids.aprovacao}/decidir`,
      {
        decisao: "recusar",
        motivo: `Não ${MARCA[x.sigla]}`,
        conferencia: aprovacao.rows[0]?.conferencia,
      },
      d,
    );
    await usar(x, admin, "DELETE", `/tarefas/${ids.tarefa}/checklist/${ids.item}`, undefined, d);
    await usar(x, admin, "DELETE", `/tarefas/${ids.tarefa}/comentarios/${ids.comentario}`, undefined, d);
    await usar(x, admin, "DELETE", `/tarefas/${ids.tarefa}/anexos/${ids.anexo}`, undefined, d);
    await usar(x, admin, "DELETE", `/visoes/${ids.visao}`, undefined, d);
    await usar(x, admin, "DELETE", `/etiquetas/${ids.etiqueta2}`, undefined, d);
    await usar(x, admin, "DELETE", `/layouts/${ids.layout}`, undefined, d);
    await usar(x, admin, "DELETE", `/listas/${ids.lista2}`, undefined, d);
    await usar(x, admin, "DELETE", `/tarefas/${ids.tarefa3}`, undefined, d);
    await usar(x, admin, "DELETE", `/projetos/${ids.projeto2}`, undefined, d);
    await usar(x, admin, "POST", `/agentes/${ids.robo}/chaves/${ids.chave2}/revogar`, undefined, d);
    await usar(x, admin, "DELETE", `/ia/contas/${ids.conta2}`, undefined, d);
    await usar(x, admin, "DELETE", `/conversas/${ids.conversa}`, undefined, d);
    await usar(x, admin, "POST", `/agenda/eventos/${ids.evento}/cancelar`, {}, d);
    await usar(x, admin, "DELETE", `/rotinas/${ids.rotina}`, undefined, d);
    await usar(x, admin, "DELETE", `/contatos-visoes/${ids.visaoDeContatos}`, undefined, d);
    await usar(x, admin, "DELETE", `/contatos/${ids.contato2}`, undefined, d);
    await usar(x, admin, "POST", `/empresa/chaves-de-api/${ids.chaveDeApi2}/revogar`, {}, d);
    await usar(x, admin, "POST", `/empresa/chaves-de-api/${ids.chaveDeApi2}/remover`, {}, d);
    await usar(x, admin, "DELETE", `/empresa/webhooks/${ids.webhook}`, undefined, d);
    await usar(x, admin, "POST", `/empresa/convites/${ids.convite}/cancelar`, undefined, d);
    await usar(x, admin, "POST", `/empresa/pessoas/${x.extra.vinculoId}/desligar`, undefined, d);
    await usar(x, func, "DELETE", "/conta/telegram", undefined, d);
    await usar(x, func, "DELETE", "/notificacoes/push", undefined, d);
    await usar(x, admin, "POST", `/agentes/${ids.robo}/desligar`, {}, d);
  }

  /** Cada ferramenta dos agentes internos, com os ids da própria empresa. */
  async function usarAsFerramentas(x: Empresa) {
    const M = MARCA[x.sigla];
    const ids = x.ids;
    const arquivo = await dono.query<{ id: string }>(
      "select id from arquivos_do_telegram where empresa_id = $1 order by id limit 1",
      [x.id],
    );
    ids.arquivo = arquivo.rows[0]?.id as string;
    const usos: [string, Record<string, unknown>][] = [
      ["ver_tarefa", { tarefaId: ids.tarefa }],
      ["comentar", { tarefaId: ids.tarefa, texto: `Comentário do agente ${M}` }],
      ["procurar_pessoa", { nome: `Admin ${M}` }],
      ["mudar_prazo", { tarefaId: ids.tarefa2, prazo: { dia: "2031-03-01" } }],
      ["mudar_projeto", { tarefaId: ids.tarefa2, projetoId: ids.projeto }],
      ["acrescentar_checklist", { tarefaId: ids.tarefa, itens: [`Passo ${M}`] }],
      ["minhas_prioridades", {}],
      ["buscar", { texto: M }],
      ["listar_tarefas", { projetoId: ids.projeto, texto: M }],
      ["procurar_projeto", { nome: `Projeto ${M}` }],
      ["arquivos_recebidos", {}],
      ["anexar_arquivo", { arquivoId: ids.arquivo, tarefaId: ids.tarefa, descricao: `Do Telegram ${M}` }],
      ["pegar_skill", { skillId: ids.skill }],
      ["ver_custos", {}],
      ["listar_rotinas", {}],
      ["ver_rotina", { rotinaId: ids.rotina }],
      ["ver_agenda", { de: "2030-01-01", ate: "2030-01-31", pessoas: [x.admin.id, x.func.id] }],
      [
        "criar_evento",
        {
          titulo: `Evento do agente ${M}`,
          inicio: { dia: "2030-01-12", hora: "10:00" },
          fim: { dia: "2030-01-12", hora: "11:00" },
          participantes: [x.func.id],
          tarefaId: ids.tarefa,
          projetoId: ids.projeto,
        },
      ],
      [
        "criar_rotina",
        {
          nome: `Rotina do agente ${M}`,
          gatilho: { tipo: "evento", evento: "tarefa_criada", filtros: { projetoId: ids.projeto } },
          acao: {
            tipo: "pedir_ao_agente",
            agenteId: ids.especialista,
            pedido: `Olhe ${M}`,
            resultado: "mensagem",
          },
        },
      ],
      ["listar_contatos", { texto: M, organizacaoId: ids.organizacao }],
      ["ver_contato", { contatoId: ids.organizacao }],
      [
        "criar_contato",
        {
          tipo: "pessoa",
          nome: `Contato do agente ${M}`,
          organizacoes: [{ organizacaoId: ids.organizacao }],
        },
      ],
      ["atualizar_contato", { contatoId: ids.contato, mudancas: { etiquetas: [ids.etiqueta] } }],
      ["ligar_contato", { tarefaId: ids.tarefa, contatos: [ids.contato] }],
      ["ligar_rotina", { rotinaId: ids.rotina }],
      ["parar_rotina", { rotinaId: ids.rotinaEvento }],
      ["criar_tarefa", { titulo: `Tarefa do agente ${M}`, projetoId: ids.projeto }],
      ["perguntar", { pergunta: `Pergunta ${M}?` }],
    ];
    for (const [nome, entrada] of usos) await coordenadorUsa(x, nome, entrada);
    // Delegar ao especialista, que planeja e atribui.
    if (x.sigla === "B") {
      ferramentasDaB.push(
        {
          nome: "delegar",
          entrada: { tarefaId: ids.tarefa, agenteId: ids.especialista, instrucoes: `Planeje ${M}` },
          papel: "coordenador",
        },
        {
          nome: "planejar",
          entrada: { tarefaId: ids.tarefa, subtarefas: [{ titulo: `Sub ${M}` }], checklist: [`Check ${M}`] },
          papel: "especialista",
        },
        {
          nome: "atribuir",
          entrada: { tarefaId: ids.tarefa, responsavel: { tipo: "pessoa", pessoaId: x.func.id } },
          papel: "especialista",
        },
      );
    }
    roteiro.push(
      () => ({
        chamadas: [
          {
            id: "d",
            nome: "delegar",
            entrada: { tarefaId: ids.tarefa, agenteId: ids.especialista, instrucoes: `Planeje ${M}` },
          },
        ],
      }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Passei ao especialista." } }] }),
      () => ({
        chamadas: [
          {
            id: "p",
            nome: "planejar",
            entrada: {
              tarefaId: ids.tarefa,
              subtarefas: [{ titulo: `Sub ${M}` }],
              checklist: [`Check ${M}`],
            },
          },
          {
            id: "a",
            nome: "atribuir",
            entrada: { tarefaId: ids.tarefa, responsavel: { tipo: "pessoa", pessoaId: x.func.id } },
          },
        ],
      }),
      () => ({ chamadas: [{ id: "r2", nome: "responder", entrada: { texto: "Planejado." } }] }),
    );
    const r = await injetar("POST", "/conversas/mensagens", x.admin, { texto: `Delegue ${M}` });
    expect(r.statusCode, r.body).toBeLessThan(300);
    await rodarAgentes();
    roteiro.length = 0;
  }

  /** Cada ferramenta do MCP, pela chave do agente externo, com os ids da própria empresa. */
  async function usarOMcp(x: Empresa) {
    const M = MARCA[x.sigla];
    const ids = x.ids;
    const chave = { chave: x.chaveDoAgente };
    await usar(x, chave, "POST", "/agente/estou-vivo");
    const chamar = (nome: string, args: Record<string, unknown>) =>
      usar(x, chave, "POST", "/mcp", {
        jsonrpc: "2.0",
        id: nome,
        method: "tools/call",
        params: { name: nome, arguments: args },
      });
    const item = await dono.query<{ id: string }>(
      "select id from itens_de_checklist where empresa_id = $1 and tarefa_id = $2 limit 1",
      [x.id, ids.tarefa2],
    );
    await chamar("minhas_tarefas", {});
    await chamar("ver_tarefa", { tarefaId: ids.tarefa2 });
    await chamar("pegar_tarefa", { tarefaId: ids.tarefa2 });
    await chamar("comentar", { tarefaId: ids.tarefa2, texto: `Comentário pelo MCP ${M}` });
    await chamar("mudar_status", { tarefaId: ids.tarefa2, status: "em_andamento" });
    await chamar("criar_subtarefa", { tarefaId: ids.tarefa2, titulo: `Subtarefa pelo MCP ${M}` });
    if (item.rows[0])
      await chamar("marcar_checklist", { tarefaId: ids.tarefa2, itemId: item.rows[0].id, marcado: true });
    await chamar("baixar_anexo", { tarefaId: ids.tarefa, anexoId: ids.anexo });
    await chamar("estou_vivo", {});
    await chamar("pegar_instrucoes", { tarefaId: ids.tarefa2 });
    await chamar("listar_skills", {});
    await chamar("pegar_skill", { skillId: ids.skill });
    await chamar("entregar_resultado", { tarefaId: ids.tarefa2, resultado: `Resultado ${M}` });
    await chamar("listar_contatos", { texto: M, organizacaoId: ids.organizacao });
    await chamar("ver_contato", { contatoId: ids.organizacao });
    await chamar("criar_contato", {
      tipo: "pessoa",
      nome: `Contato pelo MCP ${M}`,
      organizacoes: [{ organizacaoId: ids.organizacao }],
    });
    await chamar("atualizar_contato", { contatoId: ids.contato, mudancas: { etiquetas: [ids.etiqueta] } });
    await chamar("ligar_contato", { tarefaId: ids.tarefa2, contatos: [ids.contato] });
    await chamar("soltar_tarefa", { tarefaId: ids.tarefa2, motivo: `Soltei ${M}` });
  }

  // ---------------------------------------------------------------------------------------------- preparação

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    api = await montarApiDeTeste(banco, { modelos });
    for (const sigla of ["A", "B"] as const) {
      const M = MARCA[sigla];
      const e = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
        `Empresa ${M}`,
      ]);
      const id = e.rows[0]?.id as string;
      const m = sigla.toLowerCase();
      E[sigla] = {
        sigla,
        id,
        admin: await criarPessoa(id, `Admin ${M}`, `admin.${m}@teste.invalid`, "administrador", null),
        gestor: await criarPessoa(id, `Gestor ${M}`, `gestor.${m}@teste.invalid`, "gestor_area", "comercial"),
        func: await criarPessoa(id, `Func ${M}`, `func.${m}@teste.invalid`, "funcionario", "comercial"),
        extra: await criarPessoa(id, `Extra ${M}`, `extra.${m}@teste.invalid`, "funcionario", "comercial"),
        ids: {},
        chaveDoAgente: "",
      };
    }
    // O tempo real da empresa A fica aberto o roteiro inteiro da B.
    const ws = await api.app.injectWS("/tempo-real", { headers: { cookie: E.A.admin.cookie, origin: SITE } });
    ws.on("message", (dados: Buffer) => avisosDoTempoReal.push(dados.toString()));
    await usarTudo(E.A);
    await usarTudo(E.B);
  }, 300_000);

  afterAll(async () => {
    await api?.fechar();
    await dono?.end();
    await banco?.apagar();
  });

  /** Os ids e a marca da B, para procurar no que a A recebe. */
  async function daB() {
    const donoDoId = await idsDasEmpresas(dono);
    const ids = new Set([...donoDoId].filter(([, empresa]) => empresa === E.B.id).map(([id]) => id));
    return { ids, marca: MARCA.B };
  }

  // ---------------------------------------------------------------------------------------------- os testes

  it("toda rota da API está no roteiro ou na lista FORA, com o motivo", () => {
    const usadas = new Set([...pedidosDaB.map((p) => p.rota)]);
    const todas = api.rotas.map((r) => `${r.metodo} ${r.url}`);
    const semCobertura = todas.filter((r) => !usadas.has(r) && !(r in FORA));
    expect(semCobertura, "rota nova: ponha no roteiro (usarTudo) ou em FORA com o motivo").toEqual([]);
    const foraVelhas = Object.keys(FORA).filter((r) => !todas.includes(r));
    expect(foraVelhas, "rota que não existe mais na lista FORA").toEqual([]);
    const semRota = pedidosDaB.filter((p) => p.rota.endsWith("(sem rota)")).map((p) => p.rota);
    expect(semRota).toEqual([]);
  });

  it("a empresa A repete cada pedido da B (com os ids da B) e não vê nem muda nada dela", async () => {
    const outra = await daB();
    // O teste enxerga a B: a lista de tarefas dela, pedida por ela, tem a marca e os ids dela.
    const daPropriaB = await injetar("GET", "/tarefas", E.B.admin);
    expect(vazamentosNoTexto(daPropriaB.body, outra.ids, outra.marca).length).toBeGreaterThan(1);
    const antes = await retratoDaEmpresa(dono, E.B.id);
    const problemas: string[] = [];
    const semLogin: string[] = [];
    let respondidos = 0;
    for (const p of pedidosDaB) {
      // O texto que a A escreve leva a marca dela: a marca da B na resposta só pode ter vindo da B.
      const corpo =
        p.corpo === undefined ? undefined : JSON.parse(JSON.stringify(p.corpo).replaceAll(MARCA.B, "Xzq7"));
      const quem = p.pelaApi
        ? [{ chave: E.A.chaveDeApi as string }]
        : p.peloAgente
          ? [{ chave: E.A.chaveDoAgente }]
          : p.metodo === "GET"
            ? [E.A.admin, E.A.gestor, E.A.func]
            : [E.A.admin];
      for (const q of quem) {
        const r = await injetar(p.metodo, p.url, q, corpo);
        // A pessoa (ou a chave) da A entrou: a recusa veio da empresa, não da falta de login.
        if (r.statusCode === 401) semLogin.push(`${p.metodo} ${p.url}`);
        if (r.statusCode < 300) respondidos += 1;
        const achados = vazamentosNoTexto(r.body, outra.ids, outra.marca);
        if (achados.length > 0)
          problemas.push(`${p.metodo} ${p.url} (${r.statusCode}) mostrou à A: ${achados.join(", ")}`);
      }
    }
    // Os botões do Telegram da A, com os ids da B (convite, aprovação e troca de empresa).
    for (const dados of [
      `ev:vou:${E.B.ids.evento}`,
      `ev:nao:${E.B.ids.evento}`,
      `ap:a:${E.B.ids.aprovacao}`,
      `ap:r:${E.B.ids.aprovacao}`,
      `em:${E.B.id}`,
    ]) {
      numero += 1;
      await tratarAtualizacao(
        api.interno.bot as NonNullable<typeof api.interno.bot>,
        {
          update_id: numero,
          callback_query: {
            id: `q${numero}`,
            from: { id: TELEGRAM.A, is_bot: false, first_name: "Admin A" },
            message: { message_id: 1, chat: { id: TELEGRAM.A, type: "private" } },
            data: dados,
          },
        } as AtualizacaoDoTelegram,
      );
    }
    expect(semLogin).toEqual([]);
    expect(respondidos, "as listas e as ações sem id da B respondem à A normalmente").toBeGreaterThan(50);
    expect(problemas).toEqual([]);
    expect(await retratoDaEmpresa(dono, E.B.id), "as linhas da B não mudam").toEqual(antes);
  }, 300_000);

  it("as ferramentas dos agentes internos da A não alcançam nada da B", async () => {
    const outra = await daB();
    const antes = await retratoDaEmpresa(dono, E.B.id);
    const problemas: string[] = [];
    const ids = E.A.ids;
    for (const original of ferramentasDaB) {
      // Como nos pedidos: o texto que a A escreve leva a marca dela.
      const f = {
        ...original,
        entrada: JSON.parse(JSON.stringify(original.entrada).replaceAll(MARCA.B, "Xzq7")),
      };
      const antesDosPedidos = modelos.pedidos.length;
      if (f.papel === "coordenador") {
        roteiro.push(
          () => ({ chamadas: [{ id: `x-${f.nome}`, nome: f.nome, entrada: f.entrada }] }),
          () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Feito." } }] }),
        );
      } else {
        // A ferramenta do especialista: o coordenador da A delega a tarefa da A ao especialista da A, que tenta
        // com os ids da B.
        roteiro.push(
          () => ({
            chamadas: [
              {
                id: "d",
                nome: "delegar",
                entrada: { tarefaId: ids.tarefa, agenteId: ids.especialista, instrucoes: "x" },
              },
            ],
          }),
          () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Passei." } }] }),
          () => ({ chamadas: [{ id: `x-${f.nome}`, nome: f.nome, entrada: f.entrada }] }),
          () => ({ chamadas: [{ id: "r2", nome: "responder", entrada: { texto: "Feito." } }] }),
        );
      }
      const r = await injetar("POST", "/conversas/mensagens", E.A.admin, { texto: `Tente ${f.nome}` });
      expect(r.statusCode, r.body).toBeLessThan(300);
      await rodarAgentes();
      roteiro.length = 0;
      const resultados = resultadosDasFerramentas(antesDosPedidos);
      // "perguntar" encerra a execução: não volta resultado ao modelo.
      if (f.nome !== "perguntar")
        expect(resultados.length, `a ferramenta ${f.nome} rodou na A`).toBeGreaterThan(0);
      for (const conteudo of resultados) {
        const achados = vazamentosNoTexto(conteudo, outra.ids, outra.marca);
        if (achados.length > 0) problemas.push(`${f.nome} mostrou à A: ${achados.join(", ")}`);
      }
    }
    // As que pediram aprovação: o administrador da A aprova, e mesmo assim nada da B muda.
    const pendentes = await dono.query<{ id: string; conferencia: string }>(
      "select id, conferencia from aprovacoes where empresa_id = $1 and situacao = 'pendente'",
      [E.A.id],
    );
    for (const a of pendentes.rows) {
      const r = await injetar("POST", `/aprovacoes/${a.id}/decidir`, E.A.admin, {
        decisao: "aprovar",
        conferencia: a.conferencia,
      });
      const achados = vazamentosNoTexto(r.body, outra.ids, outra.marca);
      if (achados.length > 0) problemas.push(`aprovar ${a.id} mostrou à A: ${achados.join(", ")}`);
    }
    await rodarAgentes();
    expect(problemas).toEqual([]);
    expect(await retratoDaEmpresa(dono, E.B.id), "as linhas da B não mudam").toEqual(antes);
  }, 300_000);

  it("a empresa B faz as ações que apagam ou encerram (o roteiro vale), depois que a A tentou", async () => {
    for (const p of pedidosDaB.filter((x) => x.destrutivo)) {
      const quem = p.url === "/conta/telegram" || p.url === "/notificacoes/push" ? E.B.func : E.B.admin;
      const r = await injetar(p.metodo, p.url, quem, p.corpo);
      expect(r.statusCode, `${p.metodo} ${p.url}: ${r.body}`).toBeLessThan(300);
    }
  });

  it("os avisos dos webhooks (M7-03) da empresa A nunca levam nada da B", async () => {
    await cuidarDosWebhooks(api.interno.webhooks as NonNullable<typeof api.interno.webhooks>);
    const outra = await daB();
    const daA = api.webhooks.filter((w) => w.url.includes("n8n-a."));
    expect(daA.length).toBeGreaterThan(0);
    for (const w of daA) expect(vazamentosNoTexto(w.corpo, outra.ids, outra.marca)).toEqual([]);
  });

  it("os trabalhos da fila rodam para as duas empresas sem misturar", async () => {
    const bot = api.interno.bot as NonNullable<typeof api.interno.bot>;
    const agora = new Date();
    for (const e of [E.A, E.B]) {
      await avisarNoTelegram(bot, e.id, agora);
      await resumoDoDiaNoTelegram(bot, e.id, new Date("2030-01-07T11:05:00Z"));
      await cuidarDasAprovacoesNoTelegram(bot, e.id);
    }
    await cuidarDasRotinas(api.interno.rotinas, new Date("2030-01-07T11:00:30Z"));
    await cuidarDosAlertasDaAgenda(api.poolApp, SILENCIO, new Date("2030-01-10T17:51:00Z"));
    await verificarPrazos(api.poolApp);
    await verificarAprovacoesVencidas(api.poolApp, SILENCIO);
    await cuidarDosAnexos(
      api.poolApp,
      api.interno.anexos as NonNullable<typeof api.interno.anexos>,
      SILENCIO,
    );
    await enviarPushPendentes(
      api.poolApp,
      async (assinatura, conteudo) => {
        pushes.push({ endpoint: assinatura.endpoint, texto: conteudo });
        return { statusCode: 201 };
      },
      SILENCIO,
    );
    await entregarPendentesNoTelegram(bot);
    await rodarAgentes();
    // Nenhuma linha passou a apontar para a outra empresa.
    expect(await referenciasCruzadas(dono)).toEqual([]);
    // O que a fila e as rotinas escreveram em cada empresa é dela.
    for (const e of [E.A, E.B]) {
      const r = await comEmpresa(
        api.poolApp,
        e.id,
        async (c) =>
          (
            await c.query<{ n: string }>(
              "select count(*)::text as n from avisos where empresa_id <> empresa_ativa()",
            )
          ).rows[0]?.n,
      );
      expect(r).toBe("0");
    }
  }, 120_000);

  it("os canais da A (Telegram, tempo real, push e e-mail) nunca levaram nada da B", async () => {
    const outra = await daB();
    const contasDaA = [TELEGRAM.A, TELEGRAM_DO_FUNCIONARIO.A];
    const doTelegram = [
      ...api.carteiro.enviadas.filter((m) => contasDaA.includes(m.chatId)).map((m) => m.texto),
      ...api.carteiro.editadas.filter((m) => contasDaA.includes(m.chatId)).map((m) => m.texto),
      // Só a A tocou em botões (com os ids da B).
      ...api.carteiro.botoesRespondidos.map((b) => b.texto ?? ""),
    ];
    expect(doTelegram.length, "a A recebeu mensagens no Telegram").toBeGreaterThan(0);
    for (const t of doTelegram) expect(vazamentosNoTexto(t, outra.ids, outra.marca), t).toEqual([]);
    expect(avisosDoTempoReal.length, "a conexão da A recebeu os avisos dela").toBeGreaterThan(0);
    for (const aviso of avisosDoTempoReal)
      expect(vazamentosNoTexto(aviso, outra.ids, outra.marca), aviso).toEqual([]);
    for (const p of pushes.filter((x) => x.endpoint.endsWith("/a")))
      expect(vazamentosNoTexto(p.texto, outra.ids, outra.marca), p.texto).toEqual([]);
    const emailsDaA = api.emails.filter((m) => JSON.stringify(m.argumentos).includes(".a@teste.invalid"));
    for (const m of emailsDaA) {
      const texto = JSON.stringify(m.argumentos);
      expect(vazamentosNoTexto(texto, outra.ids, outra.marca), texto).toEqual([]);
    }
  });

  it("no fim, nenhuma linha de uma empresa aponta para um id da outra", async () => {
    expect(await referenciasCruzadas(dono)).toEqual([]);
  });
});
