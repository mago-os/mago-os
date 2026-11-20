import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, decifrar, ErroDoCofre, lerChaveMestra } from "./cofre.ts";

describe("cofre", () => {
  const chave = randomBytes(32);

  it("cifra e decifra, com número aleatório novo a cada vez", () => {
    const a = cifrar(chave, Buffer.from("sk-ant-segredo"), "empresa-1");
    const b = cifrar(chave, Buffer.from("sk-ant-segredo"), "empresa-1");
    expect(a.equals(b)).toBe(false);
    expect(a.includes(Buffer.from("segredo"))).toBe(false);
    expect(decifrar(chave, a, "empresa-1").toString()).toBe("sk-ant-segredo");
  });

  it("não decifra com outro contexto, outra chave ou texto adulterado", () => {
    const a = cifrar(chave, Buffer.from("sk-ant-segredo"), "empresa-1");
    expect(() => decifrar(chave, a, "empresa-2")).toThrow(ErroDoCofre);
    expect(() => decifrar(randomBytes(32), a, "empresa-1")).toThrow(ErroDoCofre);
    const adulterado = Buffer.from(a);
    adulterado[14] = (adulterado[14] ?? 0) ^ 1;
    expect(() => decifrar(chave, adulterado, "empresa-1")).toThrow(ErroDoCofre);
  });

  it("lê a chave mestra só com 32 bytes em base64 e versão válida", () => {
    expect(lerChaveMestra(randomBytes(32).toString("base64"), 1)?.versao).toBe(1);
    expect(lerChaveMestra(randomBytes(16).toString("base64"), 1)).toBeNull();
    expect(lerChaveMestra(randomBytes(32).toString("base64"), 0)).toBeNull();
  });
});
