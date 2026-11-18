/**
 * Tempo real (M2-06): a tela abre um WebSocket em /tempo-real e recebe "a tarefa X mudou" quando algo muda.
 *
 * - Autenticado pela sessão da pessoa (o mesmo cookie das rotas), com o 2FA completo e uma empresa ativa em que ela
 *   tem vínculo. Uma conexão por aba.
 * - Os avisos vêm do próprio PostgreSQL (LISTEN no canal mago_mudancas, gatilhos da migração 0015), então chegam a
 *   todas as cópias da API, inclusive na troca azul e verde. Nada fica guardado no servidor além das conexões abertas.
 * - Cada pessoa só recebe avisos da empresa ativa dela. O aviso leva só tipo e id: a tela busca pela rota normal, e
 *   a permissão continua valendo.
 * - A cada minuto a sessão é conferida de novo: quem saiu, foi desligado ou trocou de empresa perde a conexão.
 */
import websocket from "@fastify/websocket";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import pg from "pg";
import type { Login } from "../acesso/login.ts";
import { sessaoDoPedido } from "../acesso/rotas.ts";
import { permissoesNaEmpresa, type Verificador } from "../permissoes/verificar.ts";

export const CANAL = "mago_mudancas";

/** O que a tela recebe. "reconectou": avisos podem ter se perdido, busque tudo de novo. */
export type AvisoDeMudanca =
  | { tipo: "tarefa" | "agente"; id: string; operacao: "insert" | "update" | "delete" }
  | { tipo: "reconectou" };

interface Conexao {
  enviar(aviso: AvisoDeMudanca): void;
  fechar(codigo: number, motivo: string): void;
}

export interface OpcoesDoTempoReal {
  login: Login;
  poolAcesso: pg.Pool;
  poolApp: pg.Pool;
  verificador: Verificador;
  /** Conexão do papel da API (mago_app), para o LISTEN. */
  bancoUrl: string;
  /** Intervalos em milissegundos (os testes usam valores curtos). */
  conferirSessaoACada?: number;
  pingACada?: number;
}

/** Escuta o canal do banco e reconecta sozinho se a conexão cair. */
function escutar(
  bancoUrl: string,
  log: FastifyBaseLogger,
  aoAvisar: (texto: string) => void,
  aoVoltar: () => void,
) {
  let cliente: pg.Client | null = null;
  let parado = false;
  let tentativas = 0;

  async function conectar(): Promise<void> {
    if (parado) return;
    const novo = new pg.Client({ connectionString: bancoUrl, application_name: "mago-os-tempo-real" });
    novo.on("notification", (msg) => {
      if (msg.channel === CANAL && msg.payload) aoAvisar(msg.payload);
    });
    novo.on("error", (erro) => {
      log.error({ erro }, "Tempo real: a conexão de escuta caiu");
      void novo.end().catch(() => {});
      if (cliente === novo) {
        cliente = null;
        agendar();
      }
    });
    try {
      await novo.connect();
      await novo.query(`listen ${CANAL}`);
      cliente = novo;
      if (tentativas > 0) aoVoltar();
      tentativas = 0;
    } catch (erro) {
      log.error({ erro }, "Tempo real: não foi possível escutar o banco");
      void novo.end().catch(() => {});
      agendar();
    }
  }

  function agendar() {
    if (parado) return;
    tentativas += 1;
    setTimeout(() => void conectar(), Math.min(30_000, 1000 * 2 ** Math.min(tentativas, 5))).unref();
  }

  return {
    iniciar: conectar,
    async parar() {
      parado = true;
      await cliente?.end().catch(() => {});
    },
  };
}

export async function registrarTempoReal(app: FastifyInstance, o: OpcoesDoTempoReal): Promise<void> {
  const porEmpresa = new Map<string, Set<Conexao>>();
  const conferirACada = o.conferirSessaoACada ?? 60_000;
  const pingACada = o.pingACada ?? 25_000;

  const escuta = escutar(
    o.bancoUrl,
    app.log,
    (texto) => {
      let aviso: { empresaId?: string; tipo?: string; id?: string; operacao?: string };
      try {
        aviso = JSON.parse(texto);
      } catch {
        return;
      }
      if (!aviso.empresaId || (aviso.tipo !== "tarefa" && aviso.tipo !== "agente") || !aviso.id) return;
      const operacao = aviso.operacao === "insert" || aviso.operacao === "delete" ? aviso.operacao : "update";
      for (const c of porEmpresa.get(aviso.empresaId) ?? [])
        c.enviar({ tipo: aviso.tipo, id: aviso.id, operacao });
    },
    () => {
      for (const conjunto of porEmpresa.values()) for (const c of conjunto) c.enviar({ tipo: "reconectou" });
    },
  );
  await escuta.iniciar();
  app.addHook("onClose", async () => {
    await escuta.parar();
    for (const conjunto of porEmpresa.values()) for (const c of conjunto) c.fechar(1001, "servidor parando");
  });

  /** A sessão ainda vale, com 2FA completo, e a pessoa tem vínculo ativo na empresa ativa. Devolve a empresa. */
  async function empresaDaSessao(
    pedido: FastifyRequest,
  ): Promise<{ empresaId: string; sessaoId: string } | null> {
    const sessao = await sessaoDoPedido(o.login, o.poolAcesso, pedido);
    if (!sessao?.estado.completa || !sessao.empresaId) return null;
    const permissoes = await permissoesNaEmpresa(
      o.poolApp,
      sessao.pessoa.id,
      sessao.empresaId,
      o.verificador.catalogo,
    );
    return permissoes ? { empresaId: sessao.empresaId, sessaoId: sessao.sessaoId } : null;
  }

  await app.register(websocket, { options: { maxPayload: 1024 } });
  app.get("/tempo-real", { websocket: true }, async (socket, pedido) => {
    const inicio = await empresaDaSessao(pedido).catch(() => null);
    if (!inicio) {
      socket.close(4401, "sem sessão");
      return;
    }
    const conexao: Conexao = {
      enviar: (aviso) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(aviso));
      },
      fechar: (codigo, motivo) => socket.close(codigo, motivo),
    };
    const conjunto = porEmpresa.get(inicio.empresaId) ?? new Set<Conexao>();
    conjunto.add(conexao);
    porEmpresa.set(inicio.empresaId, conjunto);

    const ping = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, pingACada);
    const conferir = setInterval(async () => {
      const agora = await empresaDaSessao(pedido).catch(() => null);
      if (!agora || agora.empresaId !== inicio.empresaId) socket.close(4401, "sessão mudou");
    }, conferirACada);

    socket.on("close", () => {
      clearInterval(ping);
      clearInterval(conferir);
      conjunto.delete(conexao);
      if (conjunto.size === 0) porEmpresa.delete(inicio.empresaId);
    });
    // A tela não manda nada: qualquer mensagem é ignorada.
    socket.on("message", () => {});
  });
}
