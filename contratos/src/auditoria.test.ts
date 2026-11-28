import { describe, expect, it } from "vitest";
import {
  ACOES_IDENTIDADE,
  calcularHash,
  conferirEventoAuditoria,
  type EventoAuditoria,
  textoCanonico,
  verificarCorrente,
} from "./auditoria.ts";

const EMPRESA = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const PESSOA = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

async function montarCorrente(quantos: number): Promise<EventoAuditoria[]> {
  const eventos: EventoAuditoria[] = [];
  for (let i = 1; i <= quantos; i++) {
    const semHash = {
      id: `0193a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, "0")}`,
      empresaId: EMPRESA,
      sequencia: i,
      ator: { tipo: "pessoa" as const, pessoaId: PESSOA },
      acao: "acesso.entrou",
      alvo: { tipo: "sessao", id: `sessao-${i}` },
      origem: { canal: "painel" as const, ip: "203.0.113.10", aparelho: "iPhone do Sandro" },
      ocorridoEm: `2026-11-17T00:0${i}:00Z`,
      rastreio: "4bf92f3577b34da6a3ce929d0e0e4736",
      detalhes: { metodo: "senha_e_2fa", tentativas: i },
      hashAnterior: eventos.at(-1)?.hash ?? null,
    };
    eventos.push({ ...semHash, hash: await calcularHash(semHash) });
  }
  return eventos;
}

describe("evento de auditoria", () => {
  it("aceita um evento válido de pessoa, agente e sistema", async () => {
    const [evento] = await montarCorrente(1);
    expect(conferirEventoAuditoria(evento).ok).toBe(true);
    expect(conferirEventoAuditoria({ ...evento, ator: { tipo: "agente", agenteId: PESSOA } }).ok).toBe(true);
    const sistema = {
      ...evento,
      ator: { tipo: "sistema", servico: "fila" },
      origem: { canal: "sistema", ip: null, aparelho: null },
    };
    expect(conferirEventoAuditoria(sistema).ok).toBe(true);
  });

  it("recusa ação fora do padrão assunto.verbo e canal desconhecido", async () => {
    const [evento] = await montarCorrente(1);
    expect(conferirEventoAuditoria({ ...evento, acao: "Entrou" }).ok).toBe(false);
    expect(conferirEventoAuditoria({ ...evento, origem: { ...evento?.origem, canal: "carta" } }).ok).toBe(
      false,
    );
  });

  it("nunca aceita senha, token ou código nos detalhes, nem escondidos mais fundo", async () => {
    const [evento] = await montarCorrente(1);
    expect(conferirEventoAuditoria({ ...evento, detalhes: { senha: "123" } }).ok).toBe(false);
    expect(conferirEventoAuditoria({ ...evento, detalhes: { pedido: { accessToken: "x" } } }).ok).toBe(false);
    expect(conferirEventoAuditoria({ ...evento, detalhes: { lista: [{ codigo_2fa: "1" }] } }).ok).toBe(false);
  });

  it("só o primeiro evento fica sem anterior", async () => {
    const [primeiro, segundo] = await montarCorrente(2);
    expect(conferirEventoAuditoria({ ...primeiro, hashAnterior: segundo?.hash }).ok).toBe(false);
    expect(conferirEventoAuditoria({ ...segundo, hashAnterior: null }).ok).toBe(false);
  });

  it("todas as ações de identidade seguem o padrão", async () => {
    const [evento] = await montarCorrente(1);
    for (const acao of ACOES_IDENTIDADE) {
      expect(conferirEventoAuditoria({ ...evento, acao }).ok, acao).toBe(true);
    }
  });
});

describe("corrente da auditoria", () => {
  it("o texto canônico não depende da ordem das chaves", async () => {
    const [evento] = await montarCorrente(1);
    if (!evento) throw new Error("sem evento");
    const invertido = Object.fromEntries(Object.entries(evento).reverse()) as EventoAuditoria;
    expect(textoCanonico(invertido)).toBe(textoCanonico(evento));
    expect(textoCanonico(evento)).not.toContain('"hash":"');
  });

  it("uma corrente íntegra passa na verificação", async () => {
    expect(await verificarCorrente(await montarCorrente(5))).toEqual({ integra: true, eventos: 5 });
  });

  it("alterar um registro no meio é percebido", async () => {
    const eventos = await montarCorrente(5);
    const alterado = eventos.map((e) => (e.sequencia === 3 ? { ...e, detalhes: { metodo: "outro" } } : e));
    expect(await verificarCorrente(alterado)).toEqual({
      integra: false,
      sequencia: 3,
      motivo: "o conteúdo foi alterado",
    });
  });

  it("apagar um registro é percebido", async () => {
    const eventos = await montarCorrente(5);
    const resultado = await verificarCorrente(eventos.filter((e) => e.sequencia !== 2));
    expect(resultado).toMatchObject({ integra: false, sequencia: 3 });
  });

  it("refazer o hash de um registro alterado quebra o elo com o seguinte", async () => {
    const eventos = await montarCorrente(4);
    const original = eventos[1];
    if (!original) throw new Error("sem evento");
    const { hash: _h, ...semHash } = { ...original, acao: "acesso.saiu" };
    eventos[1] = { ...semHash, hash: await calcularHash(semHash) };
    expect(await verificarCorrente(eventos)).toEqual({
      integra: false,
      sequencia: 3,
      motivo: "não aponta para o evento anterior",
    });
  });

  it("evento de outra empresa misturado na corrente é percebido", async () => {
    const eventos = await montarCorrente(3);
    const misturado = eventos.map((e) =>
      e.sequencia === 2 ? { ...e, empresaId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d" } : e,
    );
    expect(await verificarCorrente(misturado)).toMatchObject({ integra: false, sequencia: 2 });
  });
});
