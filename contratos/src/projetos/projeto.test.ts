import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { conferirEspaco, conferirProjeto, PedidoDeEditarProjeto } from "./projeto.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const ID2 = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const AGENTE = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d";
const AGORA = "2026-11-19T02:00:00Z";

const espaco = {
  id: ID,
  empresaId: ID2,
  nome: "Operações",
  descricao: null,
  cor: "#1aa39a",
  situacao: "ativo",
  criadoEm: AGORA,
  atualizadoEm: AGORA,
};

const projeto = {
  id: ID,
  empresaId: ID2,
  espacoId: ID,
  nome: "Construção do Mago OS",
  descricao: null,
  cor: "#1aa39a",
  situacao: "ativo",
  diretorId: ID,
  gerente: { tipo: "agente", agenteId: AGENTE },
  membros: [
    { quem: { tipo: "pessoa", pessoaId: ID }, papel: "diretor" },
    { quem: { tipo: "agente", agenteId: AGENTE }, papel: "gerente" },
    { quem: { tipo: "pessoa", pessoaId: ID2 }, papel: "membro" },
  ],
  gerenteRecebeSemResponsavel: true,
  inicio: "2026-11-19",
  fim: null,
  criadoEm: AGORA,
  atualizadoEm: AGORA,
};

describe("espaço", () => {
  it("aceita um espaço e recusa cor fora do formato", () => {
    expect(conferirEspaco(espaco).ok).toBe(true);
    expect(conferirEspaco({ ...espaco, cor: "turquesa" }).ok).toBe(false);
    expect(conferirEspaco({ ...espaco, situacao: "apagado" }).ok).toBe(false);
  });
});

describe("projeto", () => {
  it("aceita diretor pessoa, gerente agente e membros", () => {
    expect(conferirProjeto(projeto).ok).toBe(true);
  });

  it("aceita projeto sem gerente", () => {
    const semGerente = {
      ...projeto,
      gerente: null,
      gerenteRecebeSemResponsavel: false,
      membros: [projeto.membros[0]],
    };
    expect(conferirProjeto(semGerente).ok).toBe(true);
  });

  it("o diretor e o gerente aparecem uma vez só entre os membros, com o papel certo", () => {
    expect(conferirProjeto({ ...projeto, membros: projeto.membros.slice(1) }).ok).toBe(false);
    expect(conferirProjeto({ ...projeto, membros: [projeto.membros[0], projeto.membros[2]] }).ok).toBe(false);
    expect(conferirProjeto({ ...projeto, membros: [...projeto.membros, projeto.membros[2]] }).ok).toBe(false);
    expect(conferirProjeto({ ...projeto, diretorId: ID2 }).ok).toBe(false);
  });

  it("gerente recebendo tarefas precisa existir, e o fim vem depois do início", () => {
    const semGerente = { ...projeto, gerente: null, membros: [projeto.membros[0]] };
    expect(conferirProjeto(semGerente).ok).toBe(false);
    expect(conferirProjeto({ ...projeto, fim: "2026-11-01" }).ok).toBe(false);
  });

  it("editar pede pelo menos um campo", () => {
    expect(conferir(PedidoDeEditarProjeto, {}).ok).toBe(false);
    expect(conferir(PedidoDeEditarProjeto, { nome: "Novo nome" }).ok).toBe(true);
  });
});
