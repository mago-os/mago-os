import { describe, expect, it } from "vitest";
import {
  conferirPedidoDeContato,
  conferirPedidoDeEditarContato,
  conferirPedidoDeJuntar,
} from "./contatos.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OUTRO = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

describe("contatos", () => {
  it("aceita uma pessoa com e-mail, telefone internacional, rede e organização", () => {
    const r = conferirPedidoDeContato({
      tipo: "pessoa",
      nome: "Ana Souza",
      papeis: ["lead", "parceiro"],
      identificadores: [
        { tipo: "email", valor: "ana@exemplo.com", principal: true },
        { tipo: "telefone", valor: "+5511987654321", principal: true, whatsapp: true },
        { tipo: "rede", rede: "instagram", valor: "@ana", principal: false },
      ],
      organizacoes: [{ organizacaoId: ID, cargo: "Diretora" }],
      documento: "12345678901",
    });
    expect(r.ok).toBe(true);
  });

  it("recusa telefone fora do formato internacional e e-mail com maiúscula", () => {
    const tel = conferirPedidoDeContato({
      tipo: "pessoa",
      nome: "Ana",
      identificadores: [{ tipo: "telefone", valor: "11987654321", principal: true, whatsapp: false }],
    });
    expect(tel.ok).toBe(false);
    const email = conferirPedidoDeContato({
      tipo: "pessoa",
      nome: "Ana",
      identificadores: [{ tipo: "email", valor: "Ana@exemplo.com", principal: true }],
    });
    expect(email.ok).toBe(false);
  });

  it("recusa identificador repetido, dois principais do mesmo tipo e organização ligada a organização", () => {
    const repetido = conferirPedidoDeContato({
      tipo: "pessoa",
      nome: "Ana",
      identificadores: [
        { tipo: "email", valor: "ana@exemplo.com", principal: true },
        { tipo: "email", valor: "ana@exemplo.com", principal: false },
      ],
    });
    expect(repetido.ok).toBe(false);
    const doisPrincipais = conferirPedidoDeContato({
      tipo: "pessoa",
      nome: "Ana",
      identificadores: [
        { tipo: "email", valor: "ana@exemplo.com", principal: true },
        { tipo: "email", valor: "ana@outro.com", principal: true },
      ],
    });
    expect(doisPrincipais.ok).toBe(false);
    const org = conferirPedidoDeContato({
      tipo: "organizacao",
      nome: "Acme",
      organizacoes: [{ organizacaoId: ID }],
    });
    expect(org.ok).toBe(false);
  });

  it("editar não deixa marcar como juntado nem vir vazio", () => {
    expect(conferirPedidoDeEditarContato({ situacao: "juntado" }).ok).toBe(false);
    expect(conferirPedidoDeEditarContato({}).ok).toBe(false);
    expect(conferirPedidoDeEditarContato({ situacao: "arquivado" }).ok).toBe(true);
  });

  it("juntar pede dois contatos diferentes", () => {
    expect(conferirPedidoDeJuntar({ ficaId: ID, saiId: ID }).ok).toBe(false);
    expect(conferirPedidoDeJuntar({ ficaId: ID, saiId: OUTRO }).ok).toBe(true);
  });
});
