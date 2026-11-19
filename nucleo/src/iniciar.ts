/**
 * Ponto de partida da API. Rodar com o rastreio carregado antes:
 *   node --import ./src/rastreio.ts src/iniciar.ts
 */
import { carteiroDoLog, carteiroResend } from "./acesso/carteiro.ts";
import { criarLogin, criarPoolDoLogin } from "./acesso/login.ts";
import { registrarRotasDoLogin } from "./acesso/rotas.ts";
import { verificarAgentesVivos } from "./agentes/chaves.ts";
import { registrarRotasDoAgente, registrarRotasDosAgentes } from "./agentes/rotas.ts";
import { registrarRotasDosAvisos } from "./avisos/index.ts";
import { enviadorWebPush, enviarPushPendentes, verificarPrazos } from "./avisos/notificacoes.ts";
import { criarBanco } from "./banco.ts";
import { ErroDeConfig, lerConfig } from "./config.ts";
import { registrarRotasDaConta } from "./conta/rotas.ts";
import { registrarRotasDasContas } from "./contas/rotas.ts";
import { registrarRotasDosConvites } from "./convites/rotas.ts";
import { criarFila } from "./fila.ts";
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
import { registrarTempoReal } from "./tempo-real/index.ts";

/** Fila da verificação de agente vivo (a cada minuto). */
const FILA_AGENTES_VIVOS = "agentes-vivos";
const FILA_NOTIFICACOES = "notificacoes";

async function iniciar(): Promise<void> {
  const config = lerConfig();
  const banco = criarBanco(config.bancoUrl);
  const fila = criarFila(config.bancoUrl);
  const app = criarServidor(config, banco);
  const poolDoLogin = config.acesso ? criarPoolDoLogin(config.acesso.bancoUrl) : null;
  /** Trabalhos da fila, ligados depois que ela começa. */
  const trabalhos: (() => Promise<void>)[] = [];
  if (config.acesso && poolDoLogin) {
    const carteiro = config.acesso.resend
      ? carteiroResend(config.acesso.resend)
      : carteiroDoLog(app.log, config.ambiente);
    const login = criarLogin({ ...config.acesso, ambiente: config.ambiente, carteiro }, poolDoLogin);
    registrarRotasDoLogin(app, login, poolDoLogin);
    const verificador = criarVerificador(login, poolDoLogin, banco.pool, catalogoDeModulos());
    registrarRotasDePermissoes(app, verificador, banco.pool);
    registrarRotasDasTarefas(app, verificador, banco.pool);
    registrarRotasDosProjetos(app, verificador, banco.pool);
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
    };
    registrarRotasDosAgentes(app, opcoesDosAgentes);
    registrarRotasDoAgente(app, opcoesDosAgentes);
    registrarServidorMcp(app, opcoesDosAgentes);
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
