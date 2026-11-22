/**
 * Ponto de partida da API. Rodar com o rastreio carregado antes:
 *   node --import ./src/rastreio.ts src/iniciar.ts
 */
import { carteiroDoLog, carteiroResend } from "./acesso/carteiro.ts";
import { criarLogin, criarPoolDoLogin } from "./acesso/login.ts";
import { registrarRotasDoLogin } from "./acesso/rotas.ts";
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
import { criarBanco } from "./banco.ts";
import { registrarRotaDaBusca } from "./busca/index.ts";
import { ErroDeConfig, lerConfig } from "./config.ts";
import { registrarRotasDaConta } from "./conta/rotas.ts";
import { registrarRotasDasContas } from "./contas/rotas.ts";
import { rodarPeloClaudeCode, testarPeloClaudeCode } from "./contas-de-ia/claude-code.ts";
import { criarCofre } from "./contas-de-ia/cofre.ts";
import { modelosDeVerdade } from "./contas-de-ia/conversa.ts";
import { provedoresDeVerdade } from "./contas-de-ia/provedores.ts";
import { registrarRotasDasContasDeIa } from "./contas-de-ia/rotas.ts";
import { registrarRotasDosConvites } from "./convites/rotas.ts";
import { registrarRotasDosCustos } from "./custos/index.ts";
import { registrarRotasDosDadosDaEmpresa } from "./dados-da-empresa/index.ts";
import { criarFila } from "./fila.ts";
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
import { criarServidor } from "./servidor.ts";
import { registrarRotasDasTarefas } from "./tarefas/rotas.ts";
import { carteiroDoTelegram } from "./telegram/carteiro.ts";
import { digitandoNoTelegram, entregarNoTelegram, entregarPendentesNoTelegram } from "./telegram/conversa.ts";
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
const FILA_PASSOS_ANTIGOS = "passos-antigos";
/** Fila dos anexos (M3-08): antivírus, envios parados e arquivos para apagar. A cada minuto, e na hora do envio. */
const FILA_ANEXOS = "anexos";
/** Aviso de espaço dos anexos (conta gratuita do Backblaze): uma vez por dia. */
const FILA_ESPACO = "anexos-espaco";
const LIMITE_DE_AVISO_DO_ESPACO = 5 * 1024 * 1024 * 1024;
/** Mensagens do Telegram (M5-01): o webhook responde na hora e a mensagem é tratada aqui. */
const FILA_TELEGRAM = "telegram";
const FILA_TELEGRAM_ENTREGAS = "telegram-entregas";

async function iniciar(): Promise<void> {
  const config = lerConfig();
  const banco = criarBanco(config.bancoUrl);
  const fila = criarFila(config.bancoUrl);
  const app = criarServidor(config, banco);
  const poolDoLogin = config.acesso ? criarPoolDoLogin(config.acesso.bancoUrl) : null;
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
  if (config.acesso && poolDoLogin) {
    const carteiro = config.acesso.resend
      ? carteiroResend(config.acesso.resend)
      : carteiroDoLog(app.log, config.ambiente);
    const login = criarLogin({ ...config.acesso, ambiente: config.ambiente, carteiro }, poolDoLogin);
    registrarRotasDoLogin(app, login, poolDoLogin);
    const verificador = criarVerificador(login, poolDoLogin, banco.pool, catalogoDeModulos());
    registrarRotasDePermissoes(app, verificador, banco.pool);
    // Agentes internos (M4-02): a mensagem da pessoa, a delegação e a tarefa atribuída (M4-04) viram trabalho na fila; o motor roda cada um.
    const acordarAgente = (empresaId: string, execucaoId: string) => {
      void fila
        .send(FILA_AGENTES_INTERNOS, { empresaId, execucaoId })
        .catch((erro) =>
          app.log.error({ erro, execucaoId }, "Fila dos agentes internos não recebeu o trabalho"),
        );
    };
    /** Acorda a fila dos anexos (o antivírus), do app e do Telegram. */
    const acordarFilaDosAnexos = () => {
      void fila.send(FILA_ANEXOS, {}).catch((erro) => app.log.warn({ erro }, "Fila dos anexos não acordou"));
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
      provedores: provedoresDeVerdade(config.ambiente, undefined, (token, modelo) =>
        testarPeloClaudeCode(rodarPeloClaudeCode, token, modelo),
      ),
      ambiente: config.ambiente,
    });
    // Telegram (M5-01, decisão 0032): sem o token, desligado.
    let usuarioDoBot: string | null = null;
    const bot: BotLigado | null = config.telegram
      ? {
          carteiro: carteiroDoTelegram(config.telegram.token),
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
      modelos: modelosDeVerdade(config.ambiente),
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
                void entregarNoTelegram(opcoesDoBot, empresaId).catch((erro) =>
                  app.log.warn({ erro }, "Telegram: entrega ao fim da execução falhou"),
                );
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
    trabalhos.push(async () => {
      await fila.createQueue(FILA_AGENTES_INTERNOS);
      await fila.work<{ empresaId: string; execucaoId: string }>(
        FILA_AGENTES_INTERNOS,
        { batchSize: 1 },
        async (trabalhos) => {
          for (const t of trabalhos) await rodarExecucao(opcoesDoMotor, t.data.empresaId, t.data.execucaoId);
        },
      );
      // Todo dia, às 4h (UTC): os passos com mais de 90 dias são apagados (M4-07).
      await fila.createQueue(FILA_PASSOS_ANTIGOS);
      await fila.schedule(FILA_PASSOS_ANTIGOS, "0 4 * * *");
      await fila.work(FILA_PASSOS_ANTIGOS, async () => {
        const n = await apagarPassosAntigos(banco.pool);
        if (n > 0) app.log.info({ evento: "passos.apagados", n }, "Passos com mais de 90 dias apagados");
      });
      // A cada minuto: pedidos de aprovação de mais de 24 horas vencem (M4-03).
      await fila.createQueue(FILA_APROVACOES_VENCIDAS);
      await fila.schedule(FILA_APROVACOES_VENCIDAS, "* * * * *");
      await fila.work(FILA_APROVACOES_VENCIDAS, async () => {
        const n = await verificarAprovacoesVencidas(banco.pool, app.log);
        if (n > 0) app.log.info({ evento: "aprovacoes.vencidas", n }, "Pedidos de aprovação vencidos");
      });
      // A cada minuto: execuções esquecidas (reinício no meio, ou trabalho que não chegou à fila).
      await fila.createQueue(FILA_EXECUCOES_ESQUECIDAS);
      await fila.schedule(FILA_EXECUCOES_ESQUECIDAS, "* * * * *");
      await fila.work(FILA_EXECUCOES_ESQUECIDAS, async () => {
        const n = await verificarExecucoesEsquecidas(opcoesDoMotor);
        if (n > 0)
          app.log.warn({ evento: "agentes_internos.esquecidas", n }, "Execuções esquecidas cuidadas");
      });
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
    // Verificação a cada minuto (M2-04): tarefas de agentes sem sinal voltam para A fazer. O pg-boss garante que só
    // uma cópia da API roda cada vez.
    trabalhos.push(async () => {
      // Avisos de prazo e push (M3-06), a cada minuto.
      await fila.createQueue(FILA_NOTIFICACOES);
      await fila.schedule(FILA_NOTIFICACOES, "* * * * *");
      const vapid = config.acesso?.vapid ?? null;
      const enviar = vapid ? enviadorWebPush(vapid) : null;
      await fila.work(FILA_NOTIFICACOES, async () => {
        // Uma parte com erro não para a outra.
        const prazos = await verificarPrazos(banco.pool).catch((erro) => {
          app.log.error({ erro }, "Verificação de prazos falhou");
          return 0;
        });
        const pushes = enviar ? await enviarPushPendentes(banco.pool, enviar, app.log) : 0;
        if (prazos + pushes > 0)
          app.log.info({ evento: "notificacoes", prazos, pushes }, "Avisos de prazo e push");
      });
      if (servicosDosAnexos) {
        await fila.createQueue(FILA_ANEXOS);
        await fila.schedule(FILA_ANEXOS, "* * * * *");
        await fila.work(FILA_ANEXOS, async () => {
          const feito = await cuidarDosAnexos(banco.pool, servicosDosAnexos, app.log);
          if (feito.liberados + feito.bloqueados + feito.apagados > 0)
            app.log.info({ evento: "anexos", ...feito }, "Anexos cuidados");
        });
        await fila.createQueue(FILA_ESPACO);
        await fila.schedule(FILA_ESPACO, "0 9 * * *");
        await fila.work(FILA_ESPACO, async () => {
          const bytes = await espacoTotal(banco.pool);
          if (bytes > LIMITE_DE_AVISO_DO_ESPACO)
            app.log.error(
              { evento: "anexos.espaco", bytes, limite: LIMITE_DE_AVISO_DO_ESPACO },
              "Os anexos passaram de 5 GB: hora de rever o plano do depósito",
            );
        });
      }
      await fila.createQueue(FILA_AGENTES_VIVOS);
      await fila.schedule(FILA_AGENTES_VIVOS, "* * * * *");
      await fila.work(FILA_AGENTES_VIVOS, async () => {
        const devolvidas = await verificarAgentesVivos({ ...opcoesDosAgentes, log: app.log });
        if (devolvidas > 0) app.log.warn({ evento: "agente.sem_sinal", devolvidas }, "Tarefas devolvidas");
      });
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
        await fila.send(FILA_TELEGRAM, atualizacao, { retryLimit: 0 });
      },
    });
    if (bot && opcoesDoBot) {
      const urlDoWebhook = `${config.acesso.urlPublica}/api/telegram/webhook`;
      trabalhos.push(async () => {
        await fila.createQueue(FILA_TELEGRAM);
        await fila.work<Parameters<typeof tratarAtualizacao>[1]>(FILA_TELEGRAM, async (lote) => {
          for (const t of lote) await tratarAtualizacao(opcoesDoBot, t.data);
        });
        // A cada minuto: respostas que não chegaram ao Telegram (servidor reiniciado, Telegram fora do ar).
        await fila.createQueue(FILA_TELEGRAM_ENTREGAS);
        await fila.schedule(FILA_TELEGRAM_ENTREGAS, "* * * * *");
        await fila.work(FILA_TELEGRAM_ENTREGAS, async () => {
          const n = await entregarPendentesNoTelegram(opcoesDoBot);
          if (n > 0)
            app.log.info({ evento: "telegram.entregas", n }, "Respostas atrasadas entregues no Telegram");
        });
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
  } else {
    app.log.warn("Login desligado: DATABASE_URL_ACESSO não foi informada (só permitido no Mac)");
  }

  fila.on("error", (erro) => app.log.error({ erro }, "Erro na fila"));
  await fila.start();
  for (const ligar of trabalhos) await ligar();
  await app.listen({ port: config.porta, host: config.host });

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    app.log.info({ sinal }, "Encerrando a API");
    await app.close();
    await fila.stop({ graceful: true });
    await banco.fechar();
    await poolDoLogin?.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void encerrar("SIGTERM"));
  process.once("SIGINT", () => void encerrar("SIGINT"));
}

iniciar().catch((erro: unknown) => {
  if (erro instanceof ErroDeConfig) {
    console.error(erro.message);
  } else {
    console.error("A API não conseguiu subir:", erro);
  }
  process.exit(1);
});
