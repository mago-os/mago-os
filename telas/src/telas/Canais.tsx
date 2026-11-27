/**
 * Canais (M8-02, decisão 0052): o administrador conecta um número de WhatsApp pela Evolution API lendo o QR code no
 * celular, vê a situação de cada canal (em vermelho quando caiu), muda o nome e a equipe que atende, desconecta e
 * apaga o canal sem conversas. O aviso de risco e o de uso da Evolution (condição da licença) ficam no topo.
 */
import {
  AVISO_DE_RISCO_DA_EVOLUTION,
  AVISO_DE_USO_DA_EVOLUTION,
  type Canal,
  type QrDoCanal,
  type SituacaoDeCanal,
} from "@mago-os/contratos";
import { Globe, MessageCircle, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import { usePessoas } from "./Tarefas";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;

const NOMES_DAS_SITUACOES: Record<SituacaoDeCanal, string> = {
  esperando_conexao: "Esperando ler o QR code",
  conectado: "Conectado",
  desconectado: "Desconectado",
  pausado: "Pausado",
};

/** De quanto em quanto tempo a tela pergunta pelo QR novo e pela conexão (o QR do WhatsApp troca a cada ~20 s). */
const SEGUNDOS_DO_QR = 4;

/** +5511987654321 → +55 11 98765-4321 (os de fora do Brasil ficam como estão). */
function numeroParaLer(n: string | null): string {
  if (!n) return "";
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(n);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : n;
}

/** As equipes (áreas) que existem na empresa, para escolher quem atende o canal. */
function useEquipes(): string[] {
  const pessoas = usePessoas();
  return [...new Set(pessoas.flatMap((p) => (p.area ? [p.area] : [])))].sort();
}

function EscolherEquipe({
  id,
  valor,
  aoMudar,
  equipes,
}: {
  id: string;
  valor: string | null;
  aoMudar: (v: string | null) => void;
  equipes: string[];
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Equipe que atende
      </label>
      <select
        id={id}
        className="h-10 rounded-md border border-linha bg-cartao px-3 text-sm"
        value={valor ?? ""}
        onChange={(e) => aoMudar(e.target.value || null)}
      >
        <option value="">Todos os funcionários</option>
        {equipes.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );
}

/** O QR code, que se atualiza sozinho até o celular ler. */
function LerQr({ canal, aoConectar }: { canal: Canal; aoConectar: () => void }) {
  const [qr, setQr] = useState<QrDoCanal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    async function perguntar() {
      const r = await pedir<QrDoCanal>("GET", `/canais/${canal.id}/qr`);
      if (!vivo) return;
      if (!r.ok) return setErro(r.mensagem ?? "Não deu para mostrar o QR code agora.");
      setErro(null);
      setQr(r.dados ?? null);
      if (r.dados?.situacao === "conectado") aoConectar();
    }
    void perguntar();
    const relogio = setInterval(() => void perguntar(), SEGUNDOS_DO_QR * 1000);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, [canal.id, aoConectar]);
  if (erro) return <Aviso tipo="erro" texto={erro} />;
  if (!qr) return <p className="text-sm text-texto-2">Preparando o QR code...</p>;
  if (!qr.qr) return <p className="text-sm text-texto-2">Esperando o QR code...</p>;
  return (
    <div className="grid justify-items-center gap-2">
      <img src={qr.qr} alt="QR code para conectar o WhatsApp" className="size-64 rounded bg-white p-2" />
      <ol className="list-decimal pl-5 text-sm text-texto-2">
        <li>No celular do número, abra o WhatsApp.</li>
        <li>Toque em Aparelhos conectados e depois em Conectar um aparelho.</li>
        <li>Aponte a câmera para este QR code. Ele se atualiza sozinho.</li>
      </ol>
    </div>
  );
}

function CartaoDoCanal({
  canal,
  equipes,
  aoMudar,
}: {
  canal: Canal;
  equipes: string[];
  aoMudar: (m?: Mensagem) => void;
}) {
  const [lendo, setLendo] = useState(canal.situacao === "esperando_conexao");
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(canal.nome);
  const [area, setArea] = useState<string | null>(canal.area);
  const conectou = useCallback(() => {
    setLendo(false);
    aoMudar({ tipo: "ok", texto: `"${canal.nome}" conectado.` });
  }, [aoMudar, canal.nome]);
  const caiu = canal.situacao === "desconectado";

  async function salvar() {
    const r = await pedir("POST", `/canais/${canal.id}`, { nome, area });
    if (!r.ok) return aoMudar({ tipo: "erro", texto: r.mensagem ?? "" });
    setEditando(false);
    aoMudar({ tipo: "ok", texto: "Canal salvo." });
  }
  async function desconectar() {
    if (
      !confirm(`Desconectar o número do canal "${canal.nome}"? As mensagens dos clientes deixam de chegar.`)
    )
      return;
    const r = await pedir("POST", `/canais/${canal.id}/desconectar`);
    aoMudar(r.ok ? { tipo: "ok", texto: "Número desconectado." } : { tipo: "erro", texto: r.mensagem ?? "" });
  }
  async function apagar() {
    if (!confirm(`Apagar o canal "${canal.nome}"?`)) return;
    const r = await pedir("DELETE", `/canais/${canal.id}`);
    aoMudar(r.ok ? { tipo: "ok", texto: "Canal apagado." } : { tipo: "erro", texto: r.mensagem ?? "" });
  }

  return (
    <Card className={cn("gap-3", caiu && "border-perigo/50")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitulo className="flex items-center gap-2">
            {canal.provedor === "site" ? <Globe className="size-4" /> : <MessageCircle className="size-4" />}
            {canal.nome}
          </CardTitulo>
          <CardDescricao>
            <span
              className={cn(caiu && "font-medium text-perigo", canal.situacao === "conectado" && "text-ok")}
            >
              {NOMES_DAS_SITUACOES[canal.situacao]}
            </span>
            {canal.identificador ? ` · ${numeroParaLer(canal.identificador)}` : ""}
            {` · ${canal.area ? `equipe ${canal.area}` : "todos os funcionários"}`}
          </CardDescricao>
        </div>
        <div className="flex flex-wrap gap-2">
          {canal.provedor === "evolution" && canal.situacao !== "conectado" && !lendo && (
            <Button size="pequeno" onClick={() => setLendo(true)}>
              Ler o QR code
            </Button>
          )}
          <Button size="pequeno" variant="contorno" onClick={() => setEditando(!editando)}>
            Editar
          </Button>
          {canal.provedor === "evolution" && canal.situacao === "conectado" && (
            <Button size="pequeno" variant="fantasma" onClick={() => void desconectar()}>
              Desconectar
            </Button>
          )}
          <Button size="pequeno" variant="fantasma" onClick={() => void apagar()}>
            Apagar
          </Button>
        </div>
      </div>
      {caiu && (
        <p className="flex items-center gap-2 text-sm text-perigo">
          <TriangleAlert className="size-4 shrink-0" />
          As mensagens dos clientes não estão chegando. Leia o QR code de novo.
        </p>
      )}
      {editando && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <Campo
            rotulo="Nome do canal"
            id={`nome-${canal.id}`}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <EscolherEquipe id={`equipe-${canal.id}`} valor={area} aoMudar={setArea} equipes={equipes} />
          <div>
            <Button type="submit" size="pequeno">
              Salvar
            </Button>
          </div>
        </form>
      )}
      {lendo && canal.provedor === "evolution" && <LerQr canal={canal} aoConectar={conectou} />}
    </Card>
  );
}

export function Canais({ podeCriar }: { podeCriar: boolean }) {
  const [dados, setDados] = useState<{ canais: Canal[]; whatsappLigado: boolean } | null>(null);
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [enviando, setEnviando] = useState(false);
  const equipes = useEquipes();

  const carregar = useCallback(async () => {
    const r = await pedir<{ canais: Canal[]; whatsappLigado: boolean }>("GET", "/canais");
    setDados(r.dados ?? { canais: [], whatsappLigado: false });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  const aoMudar = useCallback(
    (m?: Mensagem) => {
      if (m !== undefined) setMensagem(m);
      void carregar();
    },
    [carregar],
  );

  async function conectar() {
    setEnviando(true);
    const r = await pedir("POST", "/canais", { nome: nome.trim(), area });
    setEnviando(false);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setNovo(false);
    setNome("");
    setArea(null);
    setMensagem({ tipo: "ok", texto: "Canal criado. Leia o QR code com o celular do número." });
    void carregar();
  }

  if (!dados) return null;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Canais</h1>
        {podeCriar && dados.whatsappLigado && !novo && (
          <Button onClick={() => setNovo(true)}>
            <Plus /> Conectar WhatsApp
          </Button>
        )}
      </div>
      <Card className="gap-2 border-alerta/40">
        <p className="flex gap-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alerta" />
          {AVISO_DE_RISCO_DA_EVOLUTION}
        </p>
        <p className="text-xs text-texto-2">{AVISO_DE_USO_DA_EVOLUTION}</p>
      </Card>
      {!dados.whatsappLigado && (
        <Aviso tipo="erro" texto="A conexão de WhatsApp ainda não está ligada neste ambiente." />
      )}
      {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      {novo && (
        <Card className="gap-3">
          <CardTitulo>Conectar WhatsApp</CardTitulo>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void conectar();
            }}
          >
            <Campo
              rotulo="Nome do canal"
              id="nome-do-canal"
              placeholder="WhatsApp comercial"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              maxLength={80}
            />
            <EscolherEquipe id="equipe-do-canal" valor={area} aoMudar={setArea} equipes={equipes} />
            <div className="flex gap-2">
              <Button type="submit" disabled={enviando || !nome.trim()}>
                Criar e mostrar o QR code
              </Button>
              <Button type="button" variant="fantasma" onClick={() => setNovo(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}
      {dados.canais.length === 0 && !novo && <p className="text-sm text-texto-2">Nenhum canal ainda.</p>}
      {dados.canais.map((c) => (
        <CartaoDoCanal key={`${c.id}-${c.situacao}`} canal={c} equipes={equipes} aoMudar={aoMudar} />
      ))}
    </main>
  );
}
