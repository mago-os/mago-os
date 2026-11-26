/**
 * Chaves de API (M7-02, decisão 0047): o administrador cria a chave (nome, módulos com "ler" ou "escrever", a pessoa
 * em nome de quem ela age, os IPs e a validade de até 1 ano), vê a chave inteira uma vez só, troca (a antiga vale mais
 * 24 horas) e revoga. O link da documentação fica no topo.
 */
import {
  ACESSOS_DA_API,
  type AcessoDaApi,
  type ChaveDeApi,
  type ChaveDeApiCriada,
  type EscopoDaChave,
  MODULOS_DA_API,
  type ModuloDaApi,
} from "@mago-os/contratos";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import { usePessoas } from "./Tarefas";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;

const NOMES_DOS_MODULOS: Record<ModuloDaApi, string> = {
  tarefas: "Tarefas e comentários",
  projetos: "Projetos",
  contatos: "Contatos",
  agentes: "Agentes",
};
const NOMES_DOS_ACESSOS: Record<AcessoDaApi, string> = { ler: "Só ler", escrever: "Ler e escrever" };

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
const daquiAUmAno = () => new Date(Date.now() + 364 * 86_400_000).toISOString().slice(0, 10);

function Situacao({ k }: { k: ChaveDeApi }) {
  const vencida = Date.parse(k.validaAte) <= Date.now();
  const texto = k.revogadaEm
    ? "Revogada"
    : vencida
      ? "Vencida"
      : k.trocadaPorId
        ? `Trocada, vale até ${new Date(k.validaAte).toLocaleString("pt-BR")}`
        : `Vale até ${dia(k.validaAte)}`;
  const ativa = !k.revogadaEm && !vencida;
  return <span className={ativa ? "text-xs text-ok" : "text-xs text-texto-2"}>{texto}</span>;
}

export function ChavesDeApi({ euId }: { euId: string }) {
  const [chaves, setChaves] = useState<ChaveDeApi[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const pessoas = usePessoas();
  const nomes = Object.fromEntries(pessoas.map((p) => [p.id, p.nome]));

  const carregar = useCallback(async () => {
    const r = await pedir<{ chaves: ChaveDeApi[] }>("GET", "/empresa/chaves-de-api");
    setChaves(r.dados?.chaves ?? []);
    if (!r.ok) setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const escopo: EscopoDaChave = {};
    for (const m of MODULOS_DA_API) {
      const v = String(f.get(`modulo-${m}`) ?? "");
      if (v === "ler" || v === "escrever") escopo[m] = v;
    }
    if (Object.keys(escopo).length === 0)
      return setMensagem({ tipo: "erro", texto: "Escolha pelo menos um módulo para a chave." });
    const ips = String(f.get("ips") ?? "")
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const validade = String(f.get("validade") ?? "");
    const r = await pedir<ChaveDeApiCriada>("POST", "/empresa/chaves-de-api", {
      nome: String(f.get("nome")).trim(),
      escopo,
      pessoaId: String(f.get("pessoa") || euId),
      ips,
      ...(validade ? { validaAte: new Date(`${validade}T23:59:00`).toISOString() } : {}),
    });
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setSegredo(r.dados.segredo);
    setCopiada(false);
    setCriando(false);
    setMensagem(null);
    void carregar();
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 3000);
    } catch {
      setMensagem({ tipo: "erro", texto: "Não deu para copiar. Selecione a chave e copie à mão." });
    }
  }

  async function remover(k: ChaveDeApi) {
    if (!confirm(`Apagar a chave "${k.nome}" da lista? O registro dela continua na auditoria.`)) return;
    const r = await pedir("POST", `/empresa/chaves-de-api/${k.id}/remover`, {});
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({ tipo: "ok", texto: "Chave apagada da lista." });
    void carregar();
  }

  async function trocar(k: ChaveDeApi) {
    if (!confirm(`Trocar a chave "${k.nome}"? A nova vale já, e a atual continua por mais 24 horas.`)) return;
    const r = await pedir<ChaveDeApiCriada>("POST", `/empresa/chaves-de-api/${k.id}/trocar`, {});
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setSegredo(r.dados.segredo);
    setCopiada(false);
    void carregar();
  }

  async function revogar(k: ChaveDeApi) {
    if (!confirm(`Revogar a chave "${k.nome}"? Ela para de funcionar na hora.`)) return;
    const r = await pedir("POST", `/empresa/chaves-de-api/${k.id}/revogar`, {});
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({ tipo: "ok", texto: "Chave revogada." });
    void carregar();
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Chaves de API</h1>
          <p className="text-sm text-texto-2">
            Para ligar sistemas de fora (n8n, Make, o site da empresa) ao Mago OS. Cada chave age em nome de
            uma pessoa e nunca pode mais do que ela. Veja a{" "}
            <a className="underline" href="/api/docs" target="_blank" rel="noreferrer">
              documentação da API
            </a>
            .
          </p>
        </div>
        {!criando && (
          <Button onClick={() => setCriando(true)}>
            <Plus /> Nova chave
          </Button>
        )}
      </div>

      {segredo && (
        <Card className="gap-2 border-alerta/40">
          <CardTitulo>Copie a chave agora</CardTitulo>
          <CardDescricao>
            Ela aparece só esta vez. Guarde num lugar seguro, como o cofre de senhas.
          </CardDescricao>
          <code
            className={
              copiada
                ? "break-all rounded bg-ok/10 p-2 text-sm ring-2 ring-ok/40 transition-colors"
                : "break-all rounded bg-suave p-2 text-sm transition-colors"
            }
          >
            {segredo}
          </code>
          <p role="status" className="min-h-5 text-sm text-ok">
            {copiada ? "Chave copiada para a área de transferência." : ""}
          </p>
          <div className="flex gap-2">
            <Button size="pequeno" variant="contorno" onClick={() => void copiar(segredo)}>
              {copiada ? <Check /> : <Copy />}
              {copiada ? "Copiada!" : "Copiar"}
            </Button>
            <Button
              size="pequeno"
              variant="fantasma"
              onClick={() => {
                setSegredo(null);
                setCopiada(false);
              }}
            >
              Já guardei
            </Button>
          </div>
        </Card>
      )}

      {criando && (
        <Card className="gap-4">
          <CardTitulo>Nova chave</CardTitulo>
          <form className="grid gap-4" onSubmit={(e) => void criar(e)}>
            <Campo
              id="nome"
              name="nome"
              rotulo="Nome"
              placeholder="Ex.: n8n da 4xpert"
              required
              maxLength={80}
            />
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">O que a chave alcança</legend>
              {MODULOS_DA_API.map((m) => (
                <div key={m} className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`modulo-${m}`} className="text-sm">
                    {NOMES_DOS_MODULOS[m]}
                  </label>
                  <select
                    id={`modulo-${m}`}
                    name={`modulo-${m}`}
                    defaultValue=""
                    className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
                  >
                    <option value="">Não alcança</option>
                    {ACESSOS_DA_API.map((a) => (
                      <option key={a} value={a}>
                        {NOMES_DOS_ACESSOS[a]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </fieldset>
            <div className="grid gap-1.5">
              <label htmlFor="pessoa" className="text-sm font-medium">
                Em nome de quem
              </label>
              <select
                id="pessoa"
                name="pessoa"
                defaultValue={euId}
                className="h-11 rounded-md border border-linha bg-cartao px-2"
              >
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
            <Campo
              id="validade"
              name="validade"
              type="date"
              rotulo="Vale até (no máximo 1 ano)"
              defaultValue={daquiAUmAno()}
            />
            <div className="grid gap-1.5">
              <label htmlFor="ips" className="text-sm font-medium">
                IPs permitidos (opcional)
              </label>
              <textarea
                id="ips"
                name="ips"
                rows={2}
                placeholder="Ex.: 203.0.113.10 ou 203.0.113.0/24. Vazio: de qualquer lugar."
                className="rounded-md border border-linha bg-cartao p-3"
              />
            </div>
            {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
            <div className="flex gap-2">
              <Button type="submit">Criar chave</Button>
              <Button type="button" variant="fantasma" onClick={() => setCriando(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!criando && mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      {chaves && chaves.length === 0 && <p className="text-sm text-texto-2">Nenhuma chave ainda.</p>}
      <ul className="grid gap-2">
        {chaves?.map((k) => {
          const ativa = !k.revogadaEm && Date.parse(k.validaAte) > Date.now();
          return (
            <li key={k.id} className="grid gap-1.5 rounded-lg border border-linha bg-cartao p-3">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                <KeyRound className="size-4 text-texto-2" />
                {k.nome}
                <code className="text-xs font-normal text-texto-2">{k.prefixo}</code>
              </span>
              <span className="text-sm text-texto-2">
                {Object.entries(k.escopo)
                  .map(
                    ([m, a]) =>
                      `${NOMES_DOS_MODULOS[m as ModuloDaApi]}: ${NOMES_DOS_ACESSOS[a as AcessoDaApi]}`,
                  )
                  .join(" · ")}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <Situacao k={k} />
                <span>Em nome de {nomes[k.pessoaId] ?? "uma pessoa da empresa"}</span>
                {k.ips.length > 0 && <span>IPs: {k.ips.join(", ")}</span>}
                <span>{k.ultimoUsoEm ? `Último uso ${dia(k.ultimoUsoEm)}` : "Nunca usada"}</span>
              </span>
              {!ativa && (
                <div className="flex gap-2">
                  <Button
                    size="pequeno"
                    variant="fantasma"
                    className="text-perigo"
                    onClick={() => void remover(k)}
                  >
                    <Trash2 /> Apagar
                  </Button>
                </div>
              )}
              {ativa && (
                <div className="flex gap-2">
                  {!k.trocadaPorId && (
                    <Button size="pequeno" variant="contorno" onClick={() => void trocar(k)}>
                      Trocar
                    </Button>
                  )}
                  <Button
                    size="pequeno"
                    variant="fantasma"
                    className="text-perigo"
                    onClick={() => void revogar(k)}
                  >
                    Revogar
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
