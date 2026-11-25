/**
 * Monta a API inteira (rotas e trabalhos da fila) sem ligar nada: o iniciar.ts liga a fila, os trabalhos e a porta.
 * Separado do iniciar.ts para os testes montarem a mesma API de verdade, com todas as rotas (M6-01: o teste de
 * vazamento percorre todas elas), trocando só o que fala com fora (Telegram, modelos e provedores de IA).
 */

import { symmetricDecrypt } from "better-auth/crypto";
import type { FastifyInstance, RouteOptions } from "fastify";
import type { PgBoss } from "pg-boss";
import { carteiroDoLog, carteiroResend } from "./acesso/carteiro.ts";
import { apagarLimitesAntigos } from "./acesso/limite-de-pedidos.ts";
import { criarLogin, type criarPoolDoLogin } from "./acesso/login.ts";
import { registrarRotasDoLogin } from "./acesso/rotas.ts";
import { cuidarDosAlertasDaAgenda, registrarRotasDaAgenda } from "./agenda/index.ts";
import { verificarAgentesVivos } from "./agentes/chaves.ts";
import { registrarRotasDoAgente, registrarRotasDosAgentes } from "./agentes/rotas.ts";
import { registrarRotasDaParada, registrarRotasDaParadaDaPlataforma } from "./agentes/rotas-da-parada.ts";
import {
  apagarPassosAntigos,
  type OpcoesDoMotor,
  registrarRotasDaConversa,
  registrarRotasDasAprovacoes,
  registrarRotasDosLimites,
  registrarRotasDosPassos,
  rodarExecucao,
  verificarAprovacoesVencidas,
  verificarExecucoesEsquecidas,
} from "./agentes-internos/index.ts";
import { antivirusDeTeste, criarClamav } from "./anexos/antivirus.ts";
import {
  criarDepositoEmDisco,
  criarDepositoS3,
  type DepositoEmDisco,
  regiaoDoEndpoint,
} from "./anexos/deposito.ts";
import { registrarDepositoLocal, registrarRotasDosAnexos } from "./anexos/index.ts";
import { cuidarDosAnexos, espacoTotal, type ServicosDosAnexos } from "./anexos/servico.ts";
import { registrarRotasDosAvisos } from "./avisos/index.ts";
import { enviadorWebPush, enviarPushPendentes, verificarPrazos } from "./avisos/notificacoes.ts";
import type { criarBanco } from "./banco.ts";
import { registrarRotaDaBusca } from "./busca/index.ts";
import type { Config } from "./config.ts";
import { registrarRotasDaConta } from "./conta/rotas.ts";
import { registrarRotasDasContas } from "./contas/rotas.ts";
import { rodarPeloClaudeCode, testarPeloClaudeCode } from "./contas-de-ia/claude-code.ts";
import { criarCofre } from "./contas-de-ia/cofre.ts";
import { modelosDeVerdade } from "./contas-de-ia/conversa.ts";
import { provedoresDeVerdade } from "./contas-de-ia/provedores.ts";
import { registrarRotasDasContasDeIa } from "./contas-de-ia/rotas.ts";
import { registrarRotasDosContatos } from "./contatos/rotas.ts";
import { registrarRotasDosConvites } from "./convites/rotas.ts";
import { registrarRotasDosCustos } from "./custos/index.ts";
import { registrarRotasDosDadosDaEmpresa } from "./dados-da-empresa/index.ts";
import { registrarRotasDasInstrucoes } from "./instrucoes/index.ts";
import { registrarRotasDosLayouts } from "./layouts/index.ts";
import { registrarServidorMcp } from "./mcp/index.ts";
import { catalogoDeModulos } from "./permissoes/modulos.ts";
import {
  registrarRotaDaAuditoria,
  registrarRotasDePermissoes,
  registrarRotasDoAdministrador,
} from "./permissoes/rotas.ts";
import { criarVerificador } from "./permissoes/verificar.ts";
import { registrarRotasDosProjetos } from "./projetos/rotas.ts";
import { continuarRastreio, levarRastreio, type RastreioLevado } from "./rastreio-dos-trabalhos.ts";
import {
  cuidarDaExecucao,
  cuidarDasRotinas,
  type OpcoesDoMotorDasRotinas,
  registrarRotasDasRotinas,
} from "./rotinas/index.ts";
import { criarServidor } from "./servidor.ts";
import { registrarRotasDasTarefas } from "./tarefas/rotas.ts";
import { cuidarDasAprovacoesNoTelegram } from "./telegram/aprovacoes.ts";
import { criarAutenticador } from "./telegram/autenticador.ts";
import { carteiroDoTelegram as carteiroDeVerdadeDoTelegram } from "./telegram/carteiro.ts";
import {
  digitandoNoTelegram,
  entregarNoTelegram,
  entregarPendentesNoTelegram,
  type OpcoesDaConversaPeloTelegram,
} from "./telegram/conversa.ts";
import { type BotLigado, registrarRotasDoTelegram } from "./telegram/rotas.ts";
import { COMANDOS_LIGADOS, type OpcoesDoTelegram, tratarAtualizacao } from "./telegram/servico.ts";
import { registrarTempoReal } from "./tempo-real/index.ts";

/** Fila da verificação de agente vivo (a cada minuto). */
const FILA_AGENTES_VIVOS = "agentes-vivos";
const FILA_NOTIFICACOES = "notificacoes";
/** Execuções dos agentes internos (M4-02): uma por trabalho, chegam na hora em que a pessoa manda a mensagem. */
const FILA_AGENTES_INTERNOS = "agentes-internos";
const FILA_EXECUCOES_ESQUECIDAS = "agentes-internos-esquecidas";
const FILA_APROVACOES_VENCIDAS = "aprovacoes-vencidas";
/** Rotinas (M5-05): a cada minuto, as que chegaram na hora e as execuções a acompanhar. */
const FILA_ROTINAS = "rotinas";
/** Agenda (M5-07): a cada minuto, os alertas dos eventos. */
const FILA_AGENDA = "agenda";
const FILA_PASSOS_ANTIGOS = "passos-antigos";
const FILA_LIMITES_ANTIGOS = "limites-antigos";
/** Fila dos anexos (M3-08): antivírus, envios parados e arquivos para apagar. A cada minuto, e na hora do envio. */
const FILA_ANEXOS = "anexos";
/** Aviso de espaço dos anexos (conta gratuita do Backblaze): uma vez por dia. */
const FILA_ESPACO = "anexos-espaco";
const LIMITE_DE_AVISO_DO_ESPACO = 5 * 1024 * 1024 * 1024;
/** Mensagens do Telegram (M5-01): o webhook responde na hora e a mensagem é tratada aqui. */
const FILA_TELEGRAM = "telegram";
const FILA_TELEGRAM_ENTREGAS = "telegram-entregas";

/** O que a API recebe pronto de quem a monta. */
export interface DependenciasDaApi {
  banco: ReturnType<typeof criarBanco>;
  /** A fila: a API manda trabalhos (send) e os trabalhos se registram nela quando ligados. */
  fila: Pick<PgBoss, "send" | "createQueue" | "schedule" | "work">;
  /** Conexão do login (esquema acesso); sem ela, o login fica desligado (só no Mac). */
  poolDoLogin: ReturnType<typeof criarPoolDoLogin> | null;
  /** Nos testes: o Telegram, os modelos e os provedores de IA falsos. Padrão: os de verdade. */
  carteiroDoTelegram?: typeof carteiroDeVerdadeDoTelegram;
  modelos?: OpcoesDoMotor["modelos"];
  provedores?: ReturnType<typeof provedoresDeVerdade>;
  /** Nos testes: cada rota registrada (o teste de vazamento confere que cobre todas). */
  aoRegistrarRota?: (rota: RouteOptions) => void;
  /** Nos testes: o carteiro dos e-mails (padrão: o Resend, ou o registro sem a chave). */
  carteiroDeEmail?: ReturnType<typeof carteiroDoLog>;
}

/** As peças de dentro, para os testes rodarem os trabalhos da fila com a mesma montagem (M6-01). */
export interface InternoDaApi {
  motor: OpcoesDoMotor;
  rotinas: OpcoesDoMotorDasRotinas;
  bot: OpcoesDoTelegram | null;
  anexos: ServicosDosAnexos | null;
}

export interface ApiMontada {
  app: FastifyInstance;
  /** Trabalhos da fila, para ligar depois que ela começar. */
  trabalhos: (() => Promise<void>)[];
  /** Nulo com o login desligado. */
  interno: InternoDaApi | null;
}

export async function montarApi(config: Config, deps: DependenciasDaApi): Promise<ApiMontada> {
  const { banco, fila, poolDoLogin } = deps;
  const app = criarServidor(
    config,
    banco,
    deps.aoRegistrarRota ? { aoRegistrarRota: deps.aoRegistrarRota } : {},
  );
  /** Trabalhos da fila, ligados depois que ela começa. */
  const trabalhos: (() => Promise<void>)[] = [];
  // Anexos (M3-08): bucket e ClamAV em teste e produção; pasta do computador e conferente de teste no Mac.
  const depositoLocal: DepositoEmDisco | null =
    config.anexos?.deposito.tipo === "disco"
      ? criarDepositoEmDisco(config.acesso?.urlPublica ?? `http://127.0.0.1:${config.porta}`)
      : null;
  const servicosDosAnexos: ServicosDosAnexos | null = (() => {
    const a = config.anexos;
    if (!a) return null;
    const deposito =
      a.deposito.tipo === "s3"
        ? criarDepositoS3({ ...a.deposito, regiao: regiaoDoEndpoint(a.deposito.endpoint) })
        : (depositoLocal as DepositoEmDisco);
    return { deposito, antivirus: a.clamav ? criarClamav(a.clamav) : antivirusDeTeste };
  })();
  if (!servicosDosAnexos) app.log.warn("Anexos desligados: o depósito não foi configurado");
  let interno: InternoDaApi | null = null;
  if (config.acesso && poolDoLogin) {
    const carteiro = deps.carteiroDeEmail
      ? deps.carteiroDeEmail
      : config.acesso.resend
        ? carteiroResend(config.acesso.resend)
        : carteiroDoLog(app.log, config.ambiente);
    const login = criarLogin({ ...config.acesso, ambiente: config.ambiente, carteiro }, poolDoLogin);
    registrarRotasDoLogin(app, login, poolDoLogin);
    const verificador = criarVerificador(login, poolDoLogin, banco.pool, catalogoDeModulos());
    registrarRotasDePermissoes(app, verificador, banco.pool);
    // Agentes internos (M4-02): a mensagem da pessoa, a delegação e a tarefa atribuída (M4-04) viram trabalho na fila; o motor roda cada um.
    const acordarAgente = (empresaId: string, execucaoId: string) => {
      void fila
        .send(FILA_AGENTES_INTERNOS, { empresaId, execucaoId, rastreio: levarRastreio() })
        .catch((erro) =>
          app.log.error({ erro, execucaoId }, "Fila dos agentes internos não recebeu o trabalho"),
        );
    };
    /** Acorda a fila dos anexos (o antivírus), do app e do Telegram. */
    const acordarFilaDosAnexos = () => {
      void fila
        .send(FILA_ANEXOS, { rastreio: levarRastreio() })
        .catch((erro) => app.log.warn({ erro }, "Fila dos anexos não acordou"));
    };
    registrarRotasDasTarefas(app, verificador, banco.pool, { acordarAgente });
    registrarRotasDosProjetos(app, verificador, banco.pool);
    registrarRotaDaBusca(app, verificador, banco.pool);
    registrarRotasDosLayouts(app, verificador, banco.pool);
    registrarRotasDasInstrucoes(app, verificador, banco.pool);
    registrarRotasDosCustos(app, verificador, banco.pool);
    registrarRotasDosDadosDaEmpresa(app, verificador, banco.pool);
    await registrarTempoReal(app, {
      login,
      poolAcesso: poolDoLogin,
      poolApp: banco.pool,
      verificador,
      bancoUrl: config.bancoUrl,
    });
    const opcoesDosAgentes = {
      verificador,
      poolApp: banco.pool,
      carteiro,
      urlPublica: config.acesso.urlPublica,
      acordar: acordarAgente,
    };
    registrarRotasDosAgentes(app, opcoesDosAgentes);
    // Parar todos os agentes (M4-09).
    registrarRotasDaParada(app, { verificador, poolApp: banco.pool, acordar: acordarAgente });
    // Contas de IA (M4-01): sem a chave mestra fora do Mac, ficam desligadas.
    if (!config.cofre) app.log.warn("Contas de IA desligadas: MAGO_COFRE_CHAVE_MESTRA não foi informada");
    else if (config.cofre.deTeste) app.log.warn("Cofre com a chave fixa do Mac: só para dados falsos");
    const cofre = config.cofre ? criarCofre(config.cofre) : null;
    registrarRotasDasContasDeIa(app, {
      verificador,
      poolApp: banco.pool,
      cofre,
      provedores:
        deps.provedores ??
        provedoresDeVerdade(config.ambiente, undefined, (token, modelo) =>
          testarPeloClaudeCode(rodarPeloClaudeCode, token, modelo),
        ),
      ambiente: config.ambiente,
    });
    // Telegram (M5-01, decisão 0032): sem o token, desligado.
    let usuarioDoBot: string | null = null;
    const bot: BotLigado | null = config.telegram
      ? {
          carteiro: (deps.carteiroDoTelegram ?? carteiroDeVerdadeDoTelegram)(config.telegram.token),
          segredo: config.telegram.segredo,
          usuario: () => usuarioDoBot,
        }
      : null;
    if (!bot) app.log.warn("Telegram desligado: MAGO_TELEGRAM_TOKEN não foi informado");
    // Usado só com o bot ligado (os pontos que chamam conferem "bot" antes).
    const opcoesDoBot = {
      poolApp: banco.pool,
      carteiro: bot?.carteiro as NonNullable<typeof bot>["carteiro"],
      log: app.log,
      conversa: {
        catalogo: verificador.catalogo,
        acordar: acordarAgente,
        urlPublica: config.acesso.urlPublica,
      },
    };
    const opcoesDoMotor: OpcoesDoMotor = {
      poolApp: banco.pool,
      cofre,
      modelos: deps.modelos ?? modelosDeVerdade(config.ambiente),
      claudeCode: rodarPeloClaudeCode,
      catalogo: verificador.catalogo,
      opcoesMcp: {
        poolApp: banco.pool,
        carteiro,
        urlPublica: config.acesso.urlPublica,
        log: app.log,
        origem: { canal: "sistema", ip: null, aparelho: null },
        anexos: servicosDosAnexos,
        // Arquivos mandados pelo Telegram (M5-03): a ferramenta anexar_arquivo baixa e acorda o antivírus.
        telegram: bot
          ? {
              baixar: (id: string) => bot.carteiro.baixarArquivo(id),
              acordarAnexos: acordarFilaDosAnexos,
            }
          : null,
      },
      log: app.log,
      acordar: acordarAgente,
      // Telegram (M5-02): "digitando" a cada rodada e as respostas mandadas ao fim de cada execução.
      ...(opcoesDoBot
        ? {
            canais: {
              aoRodar: (empresaId: string, conversaId: string) => {
                void digitandoNoTelegram(opcoesDoBot, empresaId, conversaId).catch(() => {});
              },
              aoTerminar: (empresaId: string) => {
                // As respostas e os pedidos de aprovação que a execução abriu (M5-04) vão logo, cada um por si.
                void Promise.allSettled([
                  entregarNoTelegram(opcoesDoBot, empresaId),
                  cuidarDasAprovacoesNoTelegram(opcoesDoBot, empresaId),
                ]).then((r) => {
                  for (const x of r)
                    if (x.status === "rejected")
                      app.log.warn({ erro: x.reason }, "Telegram: entrega ao fim da execução falhou");
                });
              },
            },
          }
        : {}),
    };
    registrarRotasDaConversa(app, { verificador, poolApp: banco.pool, acordar: acordarAgente });
    // Passo a passo das execuções (M4-07).
    registrarRotasDosPassos(app, verificador, banco.pool);
    registrarRotasDosLimites(app, verificador, banco.pool);
    // Regras por ação e aprovações (M4-03).
    registrarRotasDasAprovacoes(app, {
      verificador,
      poolApp: banco.pool,
      catalogo: verificador.catalogo,
      opcoesMcp: opcoesDoMotor.opcoesMcp,
      acordar: acordarAgente,
    });
    // Aprovar pelo Telegram (M5-04): o mesmo serviço de decidir do app e o código do app autenticador.
    const conversaDoBot: OpcoesDaConversaPeloTelegram | undefined = opcoesDoBot?.conversa;
    if (conversaDoBot) {
      const segredoDoLogin = (await login.$context).secretConfig;
      conversaDoBot.aprovacoes = {
        decidir: {
          poolApp: banco.pool,
          catalogo: verificador.catalogo,
          opcoesMcp: opcoesDoMotor.opcoesMcp,
          acordar: acordarAgente,
        },
        autenticador: criarAutenticador({
          poolAcesso: poolDoLogin,
          poolApp: banco.pool,
          abrir: (cifrado) => symmetricDecrypt({ key: segredoDoLogin, data: cifrado }),
        }),
      };
    }
    trabalhos.push(async () => {
      await fila.createQueue(FILA_AGENTES_INTERNOS);
      await fila.work<{ empresaId: string; execucaoId: string; rastreio?: RastreioLevado }>(
        FILA_AGENTES_INTERNOS,
        { batchSize: 1 },
        async (trabalhos) => {
          for (const t of trabalhos)
            await continuarRastreio(t.data.rastreio, "agentes-internos", () =>
              rodarExecucao(opcoesDoMotor, t.data.empresaId, t.data.execucaoId),
            );
        },
      );
      // Todo dia, às 4h (UTC): os passos com mais de 90 dias são apagados (M4-07).
      // Todo dia, às 4h10 (UTC): as contagens de pedidos com mais de um dia são apagadas (M6-04; a chave tem o IP).
      await fila.createQueue(FILA_LIMITES_ANTIGOS);
      await fila.schedule(FILA_LIMITES_ANTIGOS, "10 4 * * *");
      await fila.work(FILA_LIMITES_ANTIGOS, () =>
        continuarRastreio(null, FILA_LIMITES_ANTIGOS, async () => {
          const n = await apagarLimitesAntigos(poolDoLogin);
          if (n > 0) app.log.info({ evento: "limites.apagados", n }, "Contagens de pedidos antigas apagadas");
        }),
      );
      await fila.createQueue(FILA_PASSOS_ANTIGOS);
      await fila.schedule(FILA_PASSOS_ANTIGOS, "0 4 * * *");
      await fila.work(FILA_PASSOS_ANTIGOS, () =>
        continuarRastreio(null, FILA_PASSOS_ANTIGOS, async () => {
          const n = await apagarPassosAntigos(banco.pool);
          if (n > 0) app.log.info({ evento: "passos.apagados", n }, "Passos com mais de 90 dias apagados");
        }),
      );
      // A cada minuto: pedidos de aprovação de mais de 24 horas vencem (M4-03).
      await fila.createQueue(FILA_APROVACOES_VENCIDAS);
      await fila.schedule(FILA_APROVACOES_VENCIDAS, "* * * * *");
      await fila.work(FILA_APROVACOES_VENCIDAS, () =>
        continuarRastreio(null, FILA_APROVACOES_VENCIDAS, async () => {
          const n = await verificarAprovacoesVencidas(banco.pool, app.log);
          if (n > 0) app.log.info({ evento: "aprovacoes.vencidas", n }, "Pedidos de aprovação vencidos");
        }),
      );
      // A cada minuto: execuções esquecidas (reinício no meio, ou trabalho que não chegou à fila).
      await fila.createQueue(FILA_EXECUCOES_ESQUECIDAS);
      await fila.schedule(FILA_EXECUCOES_ESQUECIDAS, "* * * * *");
      await fila.work(FILA_EXECUCOES_ESQUECIDAS, () =>
        continuarRastreio(null, FILA_EXECUCOES_ESQUECIDAS, async () => {
          const n = await verificarExecucoesEsquecidas(opcoesDoMotor);
          if (n > 0)
            app.log.warn({ evento: "agentes_internos.esquecidas", n }, "Execuções esquecidas cuidadas");
        }),
      );
    });
    registrarRotasDoAgente(app, opcoesDosAgentes);
    registrarServidorMcp(app, { ...opcoesDosAgentes, anexos: servicosDosAnexos });
    registrarRotasDosAnexos(app, {
      verificador,
      poolApp: banco.pool,
      servicos: servicosDosAnexos,
      acordarFila: acordarFilaDosAnexos,
    });
    if (depositoLocal) await registrarDepositoLocal(app, depositoLocal);
    registrarRotasDosAvisos(app, verificador, banco.pool, config.acesso.vapid?.publica ?? null);
    // Agenda (M5-07): as rotas e os alertas, na verificação a cada minuto.
    registrarRotasDaAgenda(app, verificador, banco.pool);
    registrarRotasDosContatos(app, verificador, banco.pool);
    trabalhos.push(async () => {
      await fila.createQueue(FILA_AGENDA);
      await fila.schedule(FILA_AGENDA, "* * * * *");
      await fila.work(FILA_AGENDA, () =>
        continuarRastreio(null, FILA_AGENDA, async () => {
          const n = await cuidarDosAlertasDaAgenda(banco.pool, app.log);
          if (n > 0) app.log.info({ evento: "agenda.alertas", n }, "Alertas da agenda");
        }),
      );
    });
    // Rotinas (M5-05): a verificação a cada minuto roda as que chegaram na hora; o "Rodar agora" roda na hora.
    const opcoesDasRotinas: OpcoesDoMotorDasRotinas = {
      poolApp: banco.pool,
      catalogo: verificador.catalogo,
      log: app.log,
      acordar: acordarAgente,
    };
    registrarRotasDasRotinas(app, {
      verificador,
      poolApp: banco.pool,
      rodarAgora: (empresaId, execucaoId) => {
        void cuidarDaExecucao(opcoesDasRotinas, empresaId, execucaoId).catch((erro) =>
          app.log.error(
            { erro, execucaoId },
            "Rotinas: o Rodar agora falhou (a verificação do minuto tenta)",
          ),
        );
      },
    });
    trabalhos.push(async () => {
      await fila.createQueue(FILA_ROTINAS);
      await fila.schedule(FILA_ROTINAS, "* * * * *");
      await fila.work(FILA_ROTINAS, () =>
        continuarRastreio(null, FILA_ROTINAS, async () => {
          const n = await cuidarDasRotinas(opcoesDasRotinas);
          if (n > 0) app.log.info({ evento: "rotinas.cuidadas", n }, "Rotinas cuidadas");
        }),
      );
    });
    // Verificação a cada minuto (M2-04): tarefas de agentes sem sinal voltam para A fazer. O pg-boss garante que só
    // uma cópia da API roda cada vez.
    trabalhos.push(async () => {
      // Avisos de prazo e push (M3-06), a cada minuto.
      await fila.createQueue(FILA_NOTIFICACOES);
      await fila.schedule(FILA_NOTIFICACOES, "* * * * *");
      const vapid = config.acesso?.vapid ?? null;
      const enviar = vapid ? enviadorWebPush(vapid) : null;
      await fila.work(FILA_NOTIFICACOES, () =>
        continuarRastreio(null, FILA_NOTIFICACOES, async () => {
          // Uma parte com erro não para a outra.
          const prazos = await verificarPrazos(banco.pool).catch((erro) => {
            app.log.error({ erro }, "Verificação de prazos falhou");
            return 0;
          });
          const pushes = enviar ? await enviarPushPendentes(banco.pool, enviar, app.log) : 0;
          if (prazos + pushes > 0)
            app.log.info({ evento: "notificacoes", prazos, pushes }, "Avisos de prazo e push");
        }),
      );
      if (servicosDosAnexos) {
        await fila.createQueue(FILA_ANEXOS);
        await fila.schedule(FILA_ANEXOS, "* * * * *");
        // Acordada por um envio (com o rastreio de quem enviou) ou pela verificação a cada minuto.
        await fila.work<{ rastreio?: RastreioLevado } | null>(FILA_ANEXOS, (trabalhos) =>
          continuarRastreio(trabalhos[0]?.data?.rastreio, FILA_ANEXOS, async () => {
            const feito = await cuidarDosAnexos(banco.pool, servicosDosAnexos, app.log);
            if (feito.liberados + feito.bloqueados + feito.apagados > 0)
              app.log.info({ evento: "anexos", ...feito }, "Anexos cuidados");
          }),
        );
        await fila.createQueue(FILA_ESPACO);
        await fila.schedule(FILA_ESPACO, "0 9 * * *");
        await fila.work(FILA_ESPACO, () =>
          continuarRastreio(null, FILA_ESPACO, async () => {
            const bytes = await espacoTotal(banco.pool);
            if (bytes > LIMITE_DE_AVISO_DO_ESPACO)
              app.log.error(
                { evento: "anexos.espaco", bytes, limite: LIMITE_DE_AVISO_DO_ESPACO },
                "Os anexos passaram de 5 GB: hora de rever o plano do depósito",
              );
          }),
        );
      }
      await fila.createQueue(FILA_AGENTES_VIVOS);
      await fila.schedule(FILA_AGENTES_VIVOS, "* * * * *");
      await fila.work(FILA_AGENTES_VIVOS, () =>
        continuarRastreio(null, FILA_AGENTES_VIVOS, async () => {
          const devolvidas = await verificarAgentesVivos({ ...opcoesDosAgentes, log: app.log });
          if (devolvidas > 0) app.log.warn({ evento: "agente.sem_sinal", devolvidas }, "Tarefas devolvidas");
        }),
      );
    });
    registrarRotaDaAuditoria(app, verificador, banco.pool);
    registrarRotasDoAdministrador(app, verificador, banco.pool);
    registrarRotasDaConta(app, login, poolDoLogin, banco.pool);
    registrarRotasDosConvites(app, {
      login,
      verificador,
      poolApp: banco.pool,
      poolAcesso: poolDoLogin,
      carteiro,
      urlPublica: config.acesso.urlPublica,
      conferirSenhasVazadas: config.acesso.conferirSenhasVazadas,
    });
    registrarRotasDoTelegram(app, {
      login,
      poolAcesso: poolDoLogin,
      poolApp: banco.pool,
      bot,
      receber: async (atualizacao) => {
        // Sem repetir: vincular e as travas não podem rodar duas vezes (tratarAtualizacao não lança pelo envio).
        await fila.send(FILA_TELEGRAM, { atualizacao, rastreio: levarRastreio() }, { retryLimit: 0 });
      },
    });
    if (bot && opcoesDoBot) {
      const urlDoWebhook = `${config.acesso.urlPublica}/api/telegram/webhook`;
      trabalhos.push(async () => {
        await fila.createQueue(FILA_TELEGRAM);
        type MensagemNaFila = {
          atualizacao: Parameters<typeof tratarAtualizacao>[1];
          rastreio?: RastreioLevado;
        };
        await fila.work<MensagemNaFila | Parameters<typeof tratarAtualizacao>[1]>(
          FILA_TELEGRAM,
          async (lote) => {
            for (const t of lote) {
              // As mensagens que já estavam na fila antes do rastreio vêm sem o envelope.
              const m = "atualizacao" in t.data ? t.data : { atualizacao: t.data };
              await continuarRastreio(m.rastreio, "telegram", () =>
                tratarAtualizacao(opcoesDoBot, m.atualizacao),
              );
            }
          },
        );
        // A cada minuto: respostas que não chegaram ao Telegram (servidor reiniciado, Telegram fora do ar).
        await fila.createQueue(FILA_TELEGRAM_ENTREGAS);
        await fila.schedule(FILA_TELEGRAM_ENTREGAS, "* * * * *");
        await fila.work(FILA_TELEGRAM_ENTREGAS, () =>
          continuarRastreio(null, FILA_TELEGRAM_ENTREGAS, async () => {
            const n = await entregarPendentesNoTelegram(opcoesDoBot);
            if (n > 0)
              app.log.info({ evento: "telegram.entregas", n }, "Respostas atrasadas entregues no Telegram");
          }),
        );
        // Ligar o webhook não segura a subida da API: se o Telegram não responder, tenta de novo a cada minuto. O
        // cartão de Meu perfil só deixa gerar código depois que o webhook ligou.
        const ligarBot = async () => {
          try {
            const usuario = await bot.carteiro.quemSouEu();
            await bot.carteiro.ligarWebhook(urlDoWebhook, bot.segredo);
            await bot.carteiro.definirComandos(COMANDOS_LIGADOS);
            usuarioDoBot = usuario;
            app.log.info({ evento: "telegram.ligado", bot: usuario }, "Bot do Telegram ligado");
          } catch (erro) {
            app.log.error({ erro }, "Telegram: o bot não ligou; tenta de novo em 1 minuto");
            setTimeout(() => void ligarBot(), 60_000).unref();
          }
        };
        void ligarBot();
      });
    }
    registrarRotasDaParadaDaPlataforma(app, {
      login,
      poolAcesso: poolDoLogin,
      poolApp: banco.pool,
      acordar: acordarAgente,
    });
    registrarRotasDasContas(app, {
      login,
      poolAcesso: poolDoLogin,
      carteiro,
      urlPublica: config.acesso.urlPublica,
      conferirSenhasVazadas: config.acesso.conferirSenhasVazadas,
    });
    interno = {
      motor: opcoesDoMotor,
      rotinas: opcoesDasRotinas,
      bot: bot ? opcoesDoBot : null,
      anexos: servicosDosAnexos,
    };
  } else {
    app.log.warn("Login desligado: DATABASE_URL_ACESSO não foi informada (só permitido no Mac)");
  }
  return { app, trabalhos, interno };
}
