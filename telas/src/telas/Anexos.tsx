/**
 * Anexos da tarefa e dos comentários (M3-08): anexar pelo botão, arrastando, ou tirando foto no celular; a situação
 * do antivírus; prévia de imagens; abrir ou baixar por link de 5 minutos.
 */
import { type Anexo, extensaoBloqueada, TAMANHO_MAXIMO_DO_ANEXO } from "@mago-os/contratos";
import { Camera, FileText, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { enviarAnexo, excluirAnexo, linkDoAnexo, listarAnexos } from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Os anexos da tarefa, sempre atualizados pelo tempo real (o antivírus muda a situação sozinho). */
export function useAnexos(tarefaId: string) {
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [ligados, setLigados] = useState(true);
  const recarregar = useCallback(async () => {
    const r = await listarAnexos(tarefaId);
    if (r.ok && r.dados) {
      setAnexos(r.dados.anexos);
      setLigados(r.dados.ligados);
    }
  }, [tarefaId]);
  useEffect(() => {
    void recarregar();
  }, [recarregar]);
  useTempoReal((aviso) => {
    if (aviso.tipo === "reconectou" || (aviso.tipo === "tarefa" && aviso.id === tarefaId)) void recarregar();
  });
  return { anexos, ligados, recarregar };
}

/** Confere antes de pedir o link (o núcleo confere de novo). Devolve o problema, ou null. */
export function problemaDoArquivo(arquivo: File): string | null {
  if (extensaoBloqueada(arquivo.name))
    return `"${arquivo.name}" não pode ser anexado, porque pode rodar um programa.`;
  if (arquivo.size > TAMANHO_MAXIMO_DO_ANEXO) return `"${arquivo.name}" passa de 25 MB.`;
  if (arquivo.size === 0) return `"${arquivo.name}" está vazio.`;
  return null;
}

/** Envia vários arquivos, um de cada vez. Devolve a mensagem para a tela. */
export async function enviarArquivos(
  tarefaId: string,
  arquivos: File[],
  comentarioId?: string,
): Promise<Mensagem> {
  const erros: string[] = [];
  let enviados = 0;
  for (const arquivo of arquivos) {
    const problema = problemaDoArquivo(arquivo);
    if (problema) {
      erros.push(problema);
      continue;
    }
    const r = await enviarAnexo(tarefaId, arquivo, comentarioId);
    if (r.ok) enviados += 1;
    else erros.push(`"${arquivo.name}": ${r.mensagem}`);
  }
  if (erros.length > 0) return { tipo: "erro", texto: erros.join(" ") };
  return enviados > 0
    ? {
        tipo: "ok",
        texto:
          enviados === 1
            ? "Arquivo enviado. O antivírus confere antes de liberar."
            : `${enviados} arquivos enviados. O antivírus confere antes de liberar.`,
      }
    : null;
}

async function abrir(a: Anexo) {
  // A aba abre já no clique (o Safari do iPhone bloqueia aba aberta depois de esperar a rede) e recebe o link depois.
  const aba = window.open("about:blank", "_blank");
  const r = await linkDoAnexo(a.tarefaId, a.id);
  if (!r.ok || !r.dados) {
    aba?.close();
    return;
  }
  if (aba) {
    aba.opener = null;
    aba.location.href = r.dados.url;
  } else window.location.assign(r.dados.url);
}

/** Prévia de uma imagem liberada (pede o link de 5 minutos ao aparecer). */
function Previa({ anexo }: { anexo: Anexo }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void linkDoAnexo(anexo.tarefaId, anexo.id).then((r) => {
      if (vivo && r.ok && r.dados) setUrl(r.dados.url);
    });
    return () => {
      vivo = false;
    };
  }, [anexo.tarefaId, anexo.id]);
  if (!url) return <span className="grid size-16 place-items-center rounded-md bg-suave" />;
  return <img src={url} alt={`Prévia de ${anexo.nome}`} className="size-16 rounded-md object-cover" />;
}

const ehImagem = (tipo: string) => /^image\/(png|jpeg|gif|webp)$/.test(tipo);

export function ListaDeAnexos({
  anexos,
  euId,
  podeExcluirTodos,
  aoMudar,
}: {
  anexos: Anexo[];
  euId: string;
  podeExcluirTodos: boolean;
  aoMudar: () => void;
}) {
  if (anexos.length === 0) return null;
  async function aoExcluir(a: Anexo) {
    if (!window.confirm(`Excluir o anexo "${a.nome}"? O arquivo é apagado.`)) return;
    await excluirAnexo(a.tarefaId, a.id);
    aoMudar();
  }
  return (
    <ul className="grid gap-2" aria-label="Anexos">
      {anexos.map((a) => {
        const meu = a.enviadoPor.tipo === "pessoa" && a.enviadoPor.pessoaId === euId;
        return (
          <li key={a.id} className="flex items-center gap-3 rounded-md border border-linha p-2">
            {a.situacao === "disponivel" && ehImagem(a.tipo) ? (
              <button type="button" onClick={() => void abrir(a)} aria-label={`Abrir ${a.nome}`}>
                <Previa anexo={a} />
              </button>
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-suave">
                <FileText className="size-5 text-texto-2" />
              </span>
            )}
            <div className="grid min-w-0 flex-1 gap-0.5">
              {a.situacao === "disponivel" ? (
                <button
                  type="button"
                  onClick={() => void abrir(a)}
                  className="truncate text-left text-sm font-medium hover:underline"
                >
                  {a.nome}
                </button>
              ) : (
                <span className="truncate text-sm font-medium">{a.nome}</span>
              )}
              <span
                className={cn(
                  "text-xs",
                  a.situacao === "bloqueado" ? "font-semibold text-perigo" : "text-texto-2",
                )}
              >
                {a.situacao === "verificando"
                  ? "Conferindo no antivírus..."
                  : a.situacao === "bloqueado"
                    ? "Bloqueado pelo antivírus (o arquivo foi apagado)"
                    : tamanhoLegivel(a.tamanho)}
              </span>
            </div>
            {(meu || podeExcluirTodos) && (
              <Button
                variant="fantasma"
                size="icone"
                aria-label={`Excluir ${a.nome}`}
                onClick={() => void aoExcluir(a)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Botões de anexar (e tirar foto, no celular). */
export function BotoesDeAnexar({ aoEscolher }: { aoEscolher: (arquivos: File[]) => void }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const foto = useRef<HTMLInputElement>(null);
  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    aoEscolher(Array.from(e.target.files ?? []));
    e.target.value = "";
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      <input ref={arquivo} type="file" multiple hidden onChange={escolher} aria-label="Escolher arquivos" />
      <input
        ref={foto}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={escolher}
        aria-label="Tirar foto"
      />
      <Button variant="contorno" size="pequeno" type="button" onClick={() => arquivo.current?.click()}>
        <Paperclip className="size-4" /> Anexar
      </Button>
      <Button
        variant="contorno"
        size="pequeno"
        type="button"
        className="md:hidden"
        onClick={() => foto.current?.click()}
      >
        <Camera className="size-4" /> Tirar foto
      </Button>
    </div>
  );
}

/** O cartão dos anexos da tarefa (os dos comentários aparecem em cada comentário). */
export function AnexosDaTarefa({
  tarefaId,
  anexos,
  ligados,
  podeAnexar,
  euId,
  podeExcluirTodos,
  aoMudar,
}: {
  tarefaId: string;
  anexos: Anexo[];
  ligados: boolean;
  podeAnexar: boolean;
  euId: string;
  podeExcluirTodos: boolean;
  aoMudar: () => void;
}) {
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const daTarefa = anexos.filter((a) => a.comentarioId === null);

  async function enviar(arquivos: File[]) {
    if (arquivos.length === 0) return;
    setEnviando(true);
    setMensagem(await enviarArquivos(tarefaId, arquivos));
    setEnviando(false);
    aoMudar();
  }

  if (!ligados && daTarefa.length === 0) return null;
  return (
    <Card
      className={cn("gap-3", arrastando && "ring-2 ring-tinta")}
      onDragOver={(e) => {
        if (!podeAnexar || !ligados) return;
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        if (!podeAnexar || !ligados) return;
        e.preventDefault();
        setArrastando(false);
        void enviar(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitulo>Anexos</CardTitulo>
        {podeAnexar && ligados && <BotoesDeAnexar aoEscolher={(a) => void enviar(a)} />}
      </div>
      {mensagem && <Aviso {...mensagem} />}
      {enviando && <p className="text-sm text-texto-2">Enviando...</p>}
      {daTarefa.length === 0 ? (
        podeAnexar && ligados ? (
          <p className="text-sm text-texto-2">
            Arraste arquivos para cá ou use Anexar (até 25 MB cada). Todo arquivo passa pelo antivírus.
          </p>
        ) : null
      ) : (
        <ListaDeAnexos anexos={daTarefa} euId={euId} podeExcluirTodos={podeExcluirTodos} aoMudar={aoMudar} />
      )}
    </Card>
  );
}
