/**
 * Dados da empresa (M3-11): todos veem; o administrador (ou quem ele liberar) muda nome, nome legal, tipo e
 * documento, telefone, fuso e idioma. Mudar o documento pede o segundo fator de novo.
 */
import {
  type DadosDaEmpresa as Dados,
  normalizarDocumento,
  type PedidoDeDadosDaEmpresa,
} from "@mago-os/contratos";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import { ConfirmarSegundoFator } from "./DoisFatores";
import { FUSOS, IDIOMAS } from "./Perfil";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

const seletor = "h-11 rounded-md border border-linha bg-cartao px-3 text-base disabled:opacity-60";

export function DadosDaEmpresa() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [form, setForm] = useState<PedidoDeDadosDaEmpresa | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [confirmar, setConfirmar] = useState(false);

  const carregar = useCallback(async () => {
    const r = await pedir<Dados>("GET", "/empresa/dados");
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setDados(r.dados);
    setForm({
      nome: r.dados.nome,
      tipo: r.dados.tipo,
      documento: r.dados.documento,
      nomeLegal: r.dados.nomeLegal,
      fusoHorario: r.dados.fusoHorario,
      idioma: r.dados.idioma,
      telefone: r.dados.telefone,
    });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    if (!form) return;
    const corpo: PedidoDeDadosDaEmpresa = {
      ...form,
      documento: form.documento ? normalizarDocumento(form.documento) : null,
      nomeLegal: form.nomeLegal?.trim() || null,
      telefone: form.telefone?.trim() || null,
    };
    const r = await pedir<Dados & { code?: string }>("POST", "/empresa/dados", corpo);
    if (!r.ok) {
      if (r.mensagem?.includes("confirme")) return setConfirmar(true);
      return setMensagem({ tipo: "erro", texto: r.mensagem || "Confira os campos e tente de novo." });
    }
    setMensagem({ tipo: "ok", texto: "Dados da empresa salvos." });
    void carregar();
  }

  if (confirmar) {
    return (
      <ConfirmarSegundoFator
        aoConfirmar={() => {
          setConfirmar(false);
          void salvar();
        }}
      />
    );
  }
  if (!dados || !form) {
    return (
      <main className="px-4 py-8 text-sm text-texto-2">
        {mensagem ? <Aviso {...mensagem} /> : "Carregando..."}
      </main>
    );
  }
  const travado = !dados.podeEditar;
  const mudar = (campo: keyof PedidoDeDadosDaEmpresa, valor: string | null) =>
    setForm((f) => (f ? { ...f, [campo]: valor } : f));

  return (
    <main className="mx-auto grid max-w-2xl gap-4 px-4 py-5 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight">Dados da empresa</h1>
      <Card className="gap-4">
        <CardTitulo>Conta</CardTitulo>
        <CardDescricao>
          {travado
            ? "Só o administrador muda os dados da empresa."
            : "O fuso vale para os prazos e as recorrências marcados daqui em diante. Mudar o documento pede a confirmação do segundo fator."}
        </CardDescricao>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <fieldset disabled={travado} className="grid gap-3">
            <Campo
              id="empresa-nome"
              rotulo="Nome no Mago OS"
              value={form.nome}
              onChange={(e) => mudar("nome", e.target.value)}
              required
              maxLength={200}
            />
            <div className="grid gap-1.5">
              <label htmlFor="empresa-tipo" className="text-sm font-medium">
                Tipo de conta
              </label>
              <select
                id="empresa-tipo"
                className={seletor}
                value={form.tipo ?? ""}
                onChange={(e) => {
                  const tipo = e.target.value === "" ? null : (e.target.value as "pf" | "pj");
                  setForm((f) => (f ? { ...f, tipo, documento: tipo ? f.documento : null } : f));
                }}
              >
                <option value="">Ainda não informado</option>
                <option value="pj">Empresa (CNPJ)</option>
                <option value="pf">Pessoa física (CPF)</option>
              </select>
            </div>
            {form.tipo && (
              <Campo
                id="empresa-documento"
                rotulo={form.tipo === "pj" ? "CNPJ" : "CPF"}
                value={form.documento ?? ""}
                onChange={(e) => mudar("documento", e.target.value || null)}
                inputMode={form.tipo === "pf" ? "numeric" : "text"}
                maxLength={20}
              />
            )}
            <Campo
              id="empresa-nome-legal"
              rotulo={form.tipo === "pf" ? "Nome completo" : "Razão social"}
              value={form.nomeLegal ?? ""}
              onChange={(e) => mudar("nomeLegal", e.target.value)}
              maxLength={200}
            />
            <Campo
              id="empresa-telefone"
              rotulo="Telefone"
              type="tel"
              value={form.telefone ?? ""}
              onChange={(e) => mudar("telefone", e.target.value)}
              maxLength={25}
            />
            <div className="grid gap-1.5">
              <label htmlFor="empresa-fuso" className="text-sm font-medium">
                Fuso horário
              </label>
              <select
                id="empresa-fuso"
                className={seletor}
                value={form.fusoHorario}
                onChange={(e) => mudar("fusoHorario", e.target.value)}
              >
                {[...new Set([form.fusoHorario, ...FUSOS])].map((f) => (
                  <option key={f} value={f}>
                    {f.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="empresa-idioma" className="text-sm font-medium">
                Idioma
              </label>
              <select
                id="empresa-idioma"
                className={seletor}
                value={form.idioma}
                onChange={(e) => mudar("idioma", e.target.value)}
              >
                {IDIOMAS.map(([valor, nome]) => (
                  <option key={valor} value={valor}>
                    {nome}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
          {mensagem && <Aviso {...mensagem} />}
          {!travado && (
            <Button type="submit" className="justify-self-start">
              Salvar
            </Button>
          )}
        </form>
      </Card>
    </main>
  );
}
