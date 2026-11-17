import { describe, expect, it } from "vitest";
import { normalizarEmail } from "../comum.ts";
import { conferirEmpresa } from "./empresa.ts";
import { conferirPessoa } from "./pessoa.ts";
import { conferirPapelNaPlataforma } from "./plataforma.ts";
import { conferirSessao } from "./sessao.ts";
import { conferirVinculo } from "./vinculo.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const ID2 = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const AGORA = "2026-11-17T00:30:00Z";

const pessoa = {
  id: ID,
  nome: "Sandro Nolasco",
  email: "sandro@exemplo.com",
  idioma: "pt-BR",
  fusoHorario: "Europe/Lisbon",
  situacao: "ativa",
  criadaEm: AGORA,
  atualizadaEm: AGORA,
};

describe("pessoa", () => {
  it("aceita uma pessoa válida, com e sem foto", () => {
    expect(conferirPessoa(pessoa).ok).toBe(true);
    expect(conferirPessoa({ ...pessoa, foto: "https://exemplo.com/foto.png" }).ok).toBe(true);
  });

  it("recusa e-mail inválido ou com maiúsculas, e normalizarEmail resolve as maiúsculas", () => {
    expect(conferirPessoa({ ...pessoa, email: "nao-e-email" }).ok).toBe(false);
    expect(conferirPessoa({ ...pessoa, email: "Sandro@Exemplo.com" }).ok).toBe(false);
    expect(conferirPessoa({ ...pessoa, email: normalizarEmail(" Sandro@Exemplo.com ") }).ok).toBe(true);
  });

  it("recusa situação desconhecida, campo a mais, nome vazio e foto sem https", () => {
    expect(conferirPessoa({ ...pessoa, situacao: "apagada" }).ok).toBe(false);
    expect(conferirPessoa({ ...pessoa, senha: "x" }).ok).toBe(false);
    expect(conferirPessoa({ ...pessoa, nome: "   " }).ok).toBe(false);
    expect(conferirPessoa({ ...pessoa, foto: "http://exemplo.com/f.png" }).ok).toBe(false);
  });

  it("diz onde está cada problema", () => {
    const resultado = conferirPessoa({ ...pessoa, email: "x", idioma: "portugues" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      const caminhos = resultado.problemas.map((p) => p.caminho);
      expect(caminhos).toContain("/email");
      expect(caminhos).toContain("/idioma");
    }
  });
});

describe("empresa", () => {
  const empresa = {
    id: ID,
    nome: "Nolask",
    tipo: "pj",
    documento: "11222333000181",
    nomeLegal: "Nolask Ltda",
    fusoHorario: "America/Sao_Paulo",
    idioma: "pt-BR",
    telefone: null,
    situacao: "ativa",
    criadaEm: AGORA,
    atualizadaEm: AGORA,
  };

  it("aceita ativa e suspensa, recusa outras situações", () => {
    expect(conferirEmpresa(empresa).ok).toBe(true);
    expect(conferirEmpresa({ ...empresa, situacao: "suspensa" }).ok).toBe(true);
    expect(conferirEmpresa({ ...empresa, situacao: "cancelada" }).ok).toBe(false);
  });
});

describe("vínculo", () => {
  const vinculo = {
    id: ID,
    pessoaId: ID,
    empresaId: ID2,
    perfil: "funcionario",
    area: null,
    situacao: "ativo",
    convidadoEm: "2026-11-01T10:00:00Z",
    entrouEm: "2026-11-02T10:00:00Z",
    desligadoEm: null,
  };

  it("aceita os três perfis", () => {
    expect(conferirVinculo(vinculo).ok).toBe(true);
    expect(conferirVinculo({ ...vinculo, perfil: "administrador" }).ok).toBe(true);
    expect(conferirVinculo({ ...vinculo, perfil: "gestor_area", area: "comercial" }).ok).toBe(true);
  });

  it("dono da plataforma não é perfil de empresa", () => {
    expect(conferirVinculo({ ...vinculo, perfil: "dono" }).ok).toBe(false);
  });

  it("gestor precisa de área; funcionário pode ter (a equipe dele); administrador não tem", () => {
    expect(conferirVinculo({ ...vinculo, perfil: "gestor_area" }).ok).toBe(false);
    expect(conferirVinculo({ ...vinculo, area: "comercial" }).ok).toBe(true);
    expect(conferirVinculo({ ...vinculo, perfil: "administrador", area: "comercial" }).ok).toBe(false);
    expect(conferirVinculo({ ...vinculo, perfil: "gestor_area", area: "Área Comercial" }).ok).toBe(false);
  });

  it("as datas combinam com a situação", () => {
    const convidado = { ...vinculo, situacao: "convidado", entrouEm: null };
    expect(conferirVinculo(convidado).ok).toBe(true);
    expect(conferirVinculo({ ...convidado, entrouEm: "2026-11-02T10:00:00Z" }).ok).toBe(false);
    expect(conferirVinculo({ ...vinculo, entrouEm: null }).ok).toBe(false);
    expect(conferirVinculo({ ...vinculo, situacao: "desligado" }).ok).toBe(false);
    expect(
      conferirVinculo({ ...vinculo, situacao: "desligado", desligadoEm: "2026-11-10T10:00:00Z" }).ok,
    ).toBe(true);
    // Convite recusado ou cancelado: desligado sem nunca ter entrado.
    expect(
      conferirVinculo({ ...convidado, situacao: "desligado", desligadoEm: "2026-11-03T10:00:00Z" }).ok,
    ).toBe(true);
  });

  it("as datas seguem a ordem convite, entrada, saída", () => {
    expect(conferirVinculo({ ...vinculo, entrouEm: "2026-10-01T10:00:00Z" }).ok).toBe(false);
    expect(
      conferirVinculo({ ...vinculo, situacao: "desligado", desligadoEm: "2026-11-01T12:00:00Z" }).ok,
    ).toBe(false);
  });
});

describe("papel na plataforma", () => {
  it("só existe o dono por enquanto", () => {
    expect(conferirPapelNaPlataforma({ pessoaId: ID, papel: "dono", concedidoEm: AGORA }).ok).toBe(true);
    expect(conferirPapelNaPlataforma({ pessoaId: ID, papel: "revendedor", concedidoEm: AGORA }).ok).toBe(
      false,
    );
  });
});

describe("sessão", () => {
  const sessao = {
    id: ID,
    pessoaId: ID,
    empresaId: ID2,
    aparelho: "iPhone do Sandro",
    navegador: "Safari 26 no iOS 26",
    ip: "203.0.113.10",
    criadaEm: "2026-11-17T00:00:00Z",
    ultimoUsoEm: "2026-11-17T00:30:00Z",
    expiraEm: "2026-11-24T00:00:00Z",
    encerradaEm: null,
    doisFatores: { verificadoEm: "2026-11-17T00:00:00Z", aparelhoConfiavelAte: "2026-12-17T00:00:00Z" },
  };

  it("aceita uma sessão válida, com IPv6 e sem empresa escolhida", () => {
    expect(conferirSessao(sessao).ok).toBe(true);
    expect(conferirSessao({ ...sessao, ip: "2001:db8::1", empresaId: null }).ok).toBe(true);
  });

  it("recusa IP inválido e token dentro do contrato", () => {
    expect(conferirSessao({ ...sessao, ip: "999.1.1.1" }).ok).toBe(false);
    expect(conferirSessao({ ...sessao, token: "abc" }).ok).toBe(false);
  });

  it("aparelho confiável só com 2FA e por até 30 dias", () => {
    const semDoisFatores = { verificadoEm: null, aparelhoConfiavelAte: "2026-12-01T00:00:00Z" };
    expect(conferirSessao({ ...sessao, doisFatores: semDoisFatores }).ok).toBe(false);
    const longoDemais = {
      verificadoEm: "2026-11-17T00:00:00Z",
      aparelhoConfiavelAte: "2026-12-17T00:00:01Z",
    };
    expect(conferirSessao({ ...sessao, doisFatores: longoDemais }).ok).toBe(false);
  });

  it("as datas da sessão seguem a ordem", () => {
    expect(conferirSessao({ ...sessao, expiraEm: "2026-11-16T00:00:00Z" }).ok).toBe(false);
    expect(conferirSessao({ ...sessao, ultimoUsoEm: "2026-11-16T00:00:00Z" }).ok).toBe(false);
  });
});
