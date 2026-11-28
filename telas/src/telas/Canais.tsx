/**
 * Canais (M8-02, decisão 0052): o administrador conecta um número de WhatsApp pela Evolution API lendo o QR code no
 * celular, vê a situação de cada canal (em vermelho quando caiu), muda o nome e a equipe que atende, desconecta e
 * apaga o canal sem conversas. O aviso de risco e o de uso da Evolution (condição da licença) ficam no topo.
 */
import {
  AVISO_DE_RISCO_DA_EVOLUTION,
  AVISO_DE_USO_DA_EVOLUTION,
  type Canal,
  type ModoDoCanal,
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

const NOMES_DOS_MODOS: Record<ModoDoCanal, string> = {
  so_pessoas: "Só pessoas (o agente não responde)",
  sugere: "O agente sugere e a pessoa envia",
  sozinho: "O agente responde sozinho",
};
const NOMES_DOS_DIAS = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** O agente de atendimento do canal (M8-05): o modo, o horário, a mensagem de fora do horário e as instruções. */
function AgenteDoCanal({ canal, aoMudar }: { canal: Canal; aoMudar: (m?: Mensagem) => void }) {
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<ModoDoCanal>(canal.modo ?? "sugere");
  const [dias, setDias] = useState<number[]>(canal.horario?.dias ?? [1, 2, 3, 4, 5]);
  const [inicio, setInicio] = useState(canal.horario?.inicio ?? "09:00");
  const [fim, setFim] = useState(canal.horario?.fim ?? "18:00");
  const [fora, setFora] = useState(canal.mensagemForaDoHorario ?? "");
  const [instrucoes, setInstrucoes] = useState(canal.instrucoes ?? "");
  const [limite, setLimite] = useState(canal.limiteDeAutonomia ?? 20);
  // A passagem para uma pessoa (M8-06).
  const [assuntos, setAssuntos] = useState((canal.assuntosParaPessoas ?? []).join(", "));
  const [prazo, setPrazo] = useState(canal.prazoParaAssumir ?? 10);
  const [passagem, setPassagem] = useState(canal.mensagemDePassagem ?? "");
  const [sugerir, setSugerir] = useState(canal.sugerirComPessoa ?? true);

  async function usarAtendente() {
    const r = await pedir("POST", `/canais/${canal.id}/atendente`);
    aoMudar(
      r.ok
        ? {
            tipo: "ok",
            texto: "Agente Atendimento ligado ao canal. Escolha o modelo de IA e ligue o agente em Agentes.",
          }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
  }
  async function salvar() {
    const r = await pedir("POST", `/canais/${canal.id}`, {
      modo,
      horario: { dias: [...dias].sort(), inicio, fim },
      ...(fora.trim() ? { mensagemForaDoHorario: fora.trim() } : {}),
      instrucoes: instrucoes.trim() || null,
      limiteDeAutonomia: limite,
      assuntosParaPessoas: [
        ...new Set(
          assuntos
            .split(",")
            .map((a) => a.trim().slice(0, 60))
            .filter((a) => a.length > 0),
        ),
      ].slice(0, 20),
      prazoParaAssumir: prazo,
      ...(passagem.trim() ? { mensagemDePassagem: passagem.trim() } : {}),
      sugerirComPessoa: sugerir,
    });
    aoMudar(
      r.ok ? { tipo: "ok", texto: "Agente do canal salvo." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
  }

  if (!canal.agenteId)
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-linha pt-3 text-sm">
        <span className="text-texto-2">Sem agente: só pessoas respondem.</span>
        <Button size="pequeno" variant="contorno" onClick={() => void usarAtendente()}>
          Usar o agente Atendimento
        </Button>
      </div>
    );
  return (
    <div className="grid gap-3 border-t border-linha pt-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Agente:{" "}
          <a className="underline" href={`/agentes/${canal.agenteId}`}>
            Atendimento
          </a>{" "}
          · {NOMES_DOS_MODOS[canal.modo ?? "sugere"]}
          {canal.modo === "sugere"
            ? ` · ${canal.sugestoesSemEdicao ?? 0} de ${canal.limiteDeAutonomia ?? 20} enviadas sem mudar`
            : ""}
        </span>
        <Button size="pequeno" variant="fantasma" onClick={() => setAberto(!aberto)}>
          {aberto ? "Fechar" : "Configurar o agente"}
        </Button>
      </div>
      {aberto && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <label className="grid gap-1.5">
            <span className="font-medium">Modo</span>
            <select
              className="h-10 rounded-md border border-linha bg-cartao px-3"
              value={modo}
              onChange={(e) => setModo(e.target.value as ModoDoCanal)}
            >
              {(Object.keys(NOMES_DOS_MODOS) as ModoDoCanal[]).map((m) => (
                <option key={m} value={m}>
                  {NOMES_DOS_MODOS[m]}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="grid gap-1.5">
            <legend className="font-medium">Horário de atendimento</legend>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={dias.includes(d)}
                    onChange={(e) =>
                      setDias((l) => (e.target.checked ? [...l, d] : l.filter((x) => x !== d)))
                    }
                  />
                  {NOMES_DOS_DIAS[d]}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1">
                Das{" "}
                <input
                  type="time"
                  className="h-9 rounded-md border border-linha bg-cartao px-2"
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                />
              </label>
              <label className="inline-flex items-center gap-1">
                às{" "}
                <input
                  type="time"
                  className="h-9 rounded-md border border-linha bg-cartao px-2"
                  value={fim}
                  onChange={(e) => setFim(e.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <label className="grid gap-1.5">
            <span className="font-medium">Mensagem de fora do horário</span>
            <textarea
              className="rounded-md border border-linha bg-cartao p-2"
              rows={2}
              maxLength={1000}
              value={fora}
              onChange={(e) => setFora(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="font-medium">Instruções deste canal (produtos, tom, o que não prometer)</span>
            <textarea
              className="rounded-md border border-linha bg-cartao p-2"
              rows={4}
              maxLength={8000}
              value={instrucoes}
              onChange={(e) => setInstrucoes(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="font-medium">
              Avisar quando o agente tiver quantas sugestões enviadas sem mudar
            </span>
            <input
              type="number"
              min={1}
              max={1000}
              className="h-10 w-32 rounded-md border border-linha bg-cartao px-3"
              value={limite}
              onChange={(e) => setLimite(Number(e.target.value) || 20)}
            />
          </label>
          <fieldset className="grid gap-3 rounded-md border border-linha p-3">
            <legend className="px-1 font-medium">Passar para uma pessoa</legend>
            <p className="text-texto-2">
              O agente passa a conversa quando o cliente pede uma pessoa, está irritado, repete a pergunta, a
              conversa não anda ou ele não sabe responder.
            </p>
            <label className="grid gap-1.5">
              <span>Assuntos que sempre vão para uma pessoa (separados por vírgula)</span>
              <input
                className="h-10 rounded-md border border-linha bg-cartao px-3"
                placeholder="desconto, reclamação, jurídico"
                value={assuntos}
                onChange={(e) => setAssuntos(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span>Mensagem ao cliente quando o agente passa a conversa</span>
              <textarea
                className="rounded-md border border-linha bg-cartao p-2"
                rows={2}
                maxLength={1000}
                value={passagem}
                onChange={(e) => setPassagem(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span>Minutos para alguém assumir antes de avisar o gestor</span>
              <input
                type="number"
                min={1}
                max={240}
                className="h-10 w-32 rounded-md border border-linha bg-cartao px-3"
                value={prazo}
                onChange={(e) => setPrazo(Math.min(240, Math.max(1, Number(e.target.value) || 10)))}
              />
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={sugerir} onChange={(e) => setSugerir(e.target.checked)} />
              Sugerir respostas quando uma pessoa atende (usa a conta de IA a cada mensagem)
            </label>
          </fieldset>
          <div>
            <Button type="submit" size="pequeno">
              Salvar o agente do canal
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Os domínios escritos um por linha (ou por vírgula), como o balão guarda: https e sem barra no fim. */
function lerDominios(texto: string): string[] {
  return [
    ...new Set(
      texto
        .split(/[\s,]+/)
        .map((d) => d.trim().toLowerCase().replace(/\/+$/, ""))
        .filter((d) => d.length > 0)
        .map((d) => (d.startsWith("http") ? d : `https://${d}`)),
    ),
  ].slice(0, 10);
}

/**
 * O balão do site (M8-07, decisão 0057): a linha de código para colar no site, os domínios onde ele abre, a
 * aparência, o link da política de privacidade e o WhatsApp para continuar.
 */
function BalaoDoSite({
  canal,
  whatsapps,
  aoMudar,
}: {
  canal: Canal;
  whatsapps: Canal[];
  aoMudar: (m?: Mensagem) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [dominios, setDominios] = useState((canal.dominios ?? []).join("\n"));
  const [cor, setCor] = useState(canal.cor ?? "#4f46e5");
  const [posicao, setPosicao] = useState<"direita" | "esquerda">(canal.posicao ?? "direita");
  const [boasVindas, setBoasVindas] = useState(canal.boasVindas ?? "");
  const [politica, setPolitica] = useState(canal.politicaUrl ?? "");
  const [whatsapp, setWhatsapp] = useState(canal.whatsappCanalId ?? "");
  const linha = `<script src="${window.location.origin}/balao.js" data-canal="${canal.chavePublica ?? ""}" async></script>`;

  async function salvar() {
    const r = await pedir("POST", `/canais/${canal.id}`, {
      dominios: lerDominios(dominios),
      cor,
      posicao,
      ...(boasVindas.trim() ? { boasVindas: boasVindas.trim() } : {}),
      ...(politica.trim() ? { politicaUrl: politica.trim() } : {}),
      whatsappCanalId: whatsapp || null,
    });
    aoMudar(r.ok ? { tipo: "ok", texto: "Balão salvo." } : { tipo: "erro", texto: r.mensagem ?? "" });
  }
  async function trocarChave() {
    if (
      !confirm("Trocar a chave? A linha de código que está no site para de funcionar até você colar a nova.")
    )
      return;
    const r = await pedir("POST", `/canais/${canal.id}/chave`);
    aoMudar(
      r.ok
        ? { tipo: "ok", texto: "Chave trocada. Cole a linha nova no site." }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
  }

  return (
    <div className="grid gap-3 border-t border-linha pt-3 text-sm">
      <div className="grid gap-1.5">
        <span className="font-medium">Linha de código para colar no site, antes do fim do body</span>
        <code className="block overflow-x-auto rounded-md bg-fundo p-2 text-xs" data-linha-do-balao="">
          {canal.chavePublica
            ? linha
            : "Este balão ainda não tem chave: toque em Trocar a chave para gerar a linha."}
        </code>
        <div className="flex flex-wrap gap-2">
          <Button
            size="pequeno"
            variant="contorno"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(linha)
                .then(() => aoMudar({ tipo: "ok", texto: "Linha de código copiada." }))
            }
          >
            Copiar
          </Button>
          <Button size="pequeno" variant="fantasma" onClick={() => void trocarChave()}>
            Trocar a chave
          </Button>
          <Button size="pequeno" variant="fantasma" onClick={() => setAberto(!aberto)}>
            {aberto ? "Fechar" : "Configurar o balão"}
          </Button>
        </div>
      </div>
      {aberto && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <label className="grid gap-1.5">
            <span className="font-medium">Sites onde o balão pode abrir (um por linha, até 10)</span>
            <textarea
              className="rounded-md border border-linha bg-cartao p-2"
              rows={3}
              placeholder="https://www.minhaloja.com.br"
              value={dominios}
              onChange={(e) => setDominios(e.target.value)}
            />
            <span className="text-xs text-texto-2">
              Escreva o endereço exato, com o subdomínio (www é diferente de sem www). Em outro site, o balão
              não abre.
            </span>
          </label>
          <Campo
            rotulo="Link da política de privacidade da empresa (obrigatório)"
            id={`politica-${canal.id}`}
            type="url"
            placeholder="https://www.minhaloja.com.br/privacidade"
            value={politica}
            onChange={(e) => setPolitica(e.target.value)}
          />
          <label className="grid gap-1.5">
            <span className="font-medium">Mensagem de boas-vindas</span>
            <textarea
              className="rounded-md border border-linha bg-cartao p-2"
              rows={2}
              maxLength={500}
              value={boasVindas}
              onChange={(e) => setBoasVindas(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="grid gap-1.5">
              <span className="font-medium">Cor</span>
              <input
                type="color"
                className="h-10 w-16 rounded-md border border-linha bg-cartao"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="font-medium">Posição</span>
              <select
                className="h-10 rounded-md border border-linha bg-cartao px-3"
                value={posicao}
                onChange={(e) => setPosicao(e.target.value as "direita" | "esquerda")}
              >
                <option value="direita">Direita</option>
                <option value="esquerda">Esquerda</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="font-medium">Continuar no WhatsApp</span>
            <select
              className="h-10 rounded-md border border-linha bg-cartao px-3"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            >
              <option value="">Não mostrar</option>
              {whatsapps.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nome}
                  {w.identificador ? ` (${numeroParaLer(w.identificador)})` : ""}
                </option>
              ))}
            </select>
          </label>
          <div>
            <Button type="submit" size="pequeno">
              Salvar o balão
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function CartaoDoCanal({
  canal,
  equipes,
  whatsapps,
  aoMudar,
}: {
  canal: Canal;
  equipes: string[];
  whatsapps: Canal[];
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
      {canal.provedor === "site" && <BalaoDoSite canal={canal} whatsapps={whatsapps} aoMudar={aoMudar} />}
      <AgenteDoCanal canal={canal} aoMudar={aoMudar} />
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
  const [novoBalao, setNovoBalao] = useState(false);
  const [dominiosNovos, setDominiosNovos] = useState("");
  const [politicaNova, setPoliticaNova] = useState("");
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

  async function criarBalao() {
    setEnviando(true);
    const r = await pedir("POST", "/canais/site", {
      nome: nome.trim(),
      area,
      dominios: lerDominios(dominiosNovos),
      politicaUrl: politicaNova.trim(),
    });
    setEnviando(false);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setNovoBalao(false);
    setNome("");
    setArea(null);
    setDominiosNovos("");
    setPoliticaNova("");
    setMensagem({ tipo: "ok", texto: "Balão criado. Copie a linha de código e cole no site." });
    void carregar();
  }

  if (!dados) return null;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Canais</h1>
        <div className="flex flex-wrap gap-2">
          {podeCriar && !novo && !novoBalao && (
            <Button variant="contorno" onClick={() => setNovoBalao(true)}>
              <Globe /> Chat no site
            </Button>
          )}
          {podeCriar && dados.whatsappLigado && !novo && !novoBalao && (
            <Button onClick={() => setNovo(true)}>
              <Plus /> Conectar WhatsApp
            </Button>
          )}
        </div>
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
      {novoBalao && (
        <Card className="gap-3">
          <CardTitulo>Chat no site</CardTitulo>
          <CardDescricao>
            Um balão de conversa no site da empresa. O agente e a equipe respondem pela caixa de conversas.
          </CardDescricao>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void criarBalao();
            }}
          >
            <Campo
              rotulo="Nome do canal"
              id="nome-do-balao"
              placeholder="Chat do site"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              maxLength={80}
            />
            <EscolherEquipe id="equipe-do-balao" valor={area} aoMudar={setArea} equipes={equipes} />
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Sites onde o balão pode abrir (um por linha)</span>
              <textarea
                className="rounded-md border border-linha bg-cartao p-2"
                rows={2}
                placeholder="https://www.minhaloja.com.br"
                value={dominiosNovos}
                onChange={(e) => setDominiosNovos(e.target.value)}
                required
              />
            </label>
            <Campo
              rotulo="Link da política de privacidade da empresa"
              id="politica-do-balao"
              type="url"
              placeholder="https://www.minhaloja.com.br/privacidade"
              value={politicaNova}
              onChange={(e) => setPoliticaNova(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={enviando || !nome.trim() || !dominiosNovos.trim() || !politicaNova.trim()}
              >
                Criar o balão
              </Button>
              <Button type="button" variant="fantasma" onClick={() => setNovoBalao(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}
      {dados.canais.length === 0 && !novo && <p className="text-sm text-texto-2">Nenhum canal ainda.</p>}
      {dados.canais.map((c) => (
        <CartaoDoCanal
          key={`${c.id}-${c.situacao}-${c.chavePublica ?? ""}`}
          canal={c}
          equipes={equipes}
          whatsapps={dados.canais.filter((w) => w.provedor === "evolution")}
          aoMudar={aoMudar}
        />
      ))}
    </main>
  );
}
