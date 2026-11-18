/**
 * Telas do administrador (M1-10, parte 2): Pessoas (com os ajustes de permissão), Segurança e Auditoria.
 * O que cada pessoa vê aqui depende das permissões dela: a API confere tudo de novo, a tela só não mostra o resto.
 */
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type AcaoNoModulo,
  type Alcance,
  ajustarPermissao,
  cancelarConvite,
  convidar,
  desligarPessoa,
  type EventoDaAuditoria,
  lerRegrasDaPlataforma,
  lerSeguranca,
  listarAuditoria,
  listarPessoas,
  type ModuloComPermissao,
  type PessoaDaEmpresa,
  permissoesDaPessoa,
  reenviarConvite,
  salvarRegrasDaPlataforma,
  salvarSeguranca,
} from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { Aviso } from "./Acesso";

const NOME_DO_PERFIL = {
  administrador: "Administrador",
  gestor_area: "Gestor de área",
  funcionario: "Funcionário",
} as const;
const NOME_DA_SITUACAO = { convidado: "Convidado", ativo: "Ativo", desligado: "Desligado" } as const;
const NOME_DA_ACAO: Record<AcaoNoModulo, string> = {
  ver: "Ver",
  criar: "Criar",
  editar: "Editar",
  aprovar: "Aprovar",
  excluir: "Excluir",
};
const NOME_DO_ALCANCE: Record<Alcance, string> = {
  nada: "Não pode",
  meus: "Só os meus",
  equipe: "Da equipe",
  tudo: "Tudo",
};

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

/**
 * Carrega de novo quando a pessoa volta para o app (outra aba, outro app no celular): assim a lista mostra, por
 * exemplo, quem acabou de aceitar um convite sem precisar recarregar a página.
 */
export function useAoVoltar(carregar: () => unknown) {
  useEffect(() => {
    const aoMudar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoMudar);
    window.addEventListener("focus", aoMudar);
    return () => {
      document.removeEventListener("visibilitychange", aoMudar);
      window.removeEventListener("focus", aoMudar);
    };
  }, [carregar]);
}

function Pagina({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid max-w-4xl gap-4 px-4 py-5 md:py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        <p className="text-sm text-texto-2">{descricao}</p>
      </div>
      {children}
    </main>
  );
}

interface PoderesEmPessoas {
  podeAjustar: boolean;
  podeConvidar: boolean;
  podeDesligar: boolean;
  euId: string;
}

export function Pessoas(poderes: PoderesEmPessoas) {
  const [pessoas, setPessoas] = useState<PessoaDaEmpresa[] | null>(null);
  const [aberta, setAberta] = useState<PessoaDaEmpresa | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => setPessoas(await listarPessoas()), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);

  if (aberta)
    return (
      <PermissoesDaPessoa
        pessoa={aberta}
        {...poderes}
        aoVoltar={(texto) => {
          setAberta(null);
          setMensagem(texto ? { tipo: "ok", texto } : null);
          void carregar();
        }}
      />
    );

  // Quem foi desligado ou teve o convite cancelado sai da lista (continua na auditoria).
  const lista = pessoas?.filter((p) => p.situacao !== "desligado");
  return (
    <Pagina titulo="Pessoas" descricao="Quem está nesta empresa, com o perfil e a situação de cada um.">
      {poderes.podeConvidar && !convidando && (
        <Button className="justify-self-start" onClick={() => setConvidando(true)}>
          Convidar pessoa
        </Button>
      )}
      {convidando && (
        <FormularioDeConvite
          aoFechar={(texto) => {
            setConvidando(false);
            if (texto) {
              setMensagem({ tipo: "ok", texto });
              void carregar();
            }
          }}
        />
      )}
      {mensagem && <Aviso {...mensagem} />}
      <Card className="gap-0 p-0">
        {pessoas === null && <p className="p-5 text-sm text-texto-2">Carregando...</p>}
        <ul>
          {lista?.map((p) => (
            <li key={p.vinculoId} className="border-t border-linha first:border-t-0">
              <button
                type="button"
                onClick={() => setAberta(p)}
                className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-suave"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-suave text-xs font-semibold">
                  {p.nome
                    .split(/\s+/)
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{p.nome}</span>
                  <span className="truncate text-xs text-texto-2">
                    {p.email ?? "E-mail oculto (dado pessoal)"}
                  </span>
                </span>
                <span className="hidden text-right text-xs sm:grid">
                  <span className="font-medium">
                    {NOME_DO_PERFIL[p.perfil]}
                    {p.area ? ` · ${p.area}` : ""}
                  </span>
                  <span className={p.situacao === "ativo" ? "text-ok" : "text-texto-2"}>
                    {NOME_DA_SITUACAO[p.situacao]}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </Pagina>
  );
}

function PermissoesDaPessoa({
  pessoa,
  podeAjustar,
  podeConvidar,
  podeDesligar,
  euId,
  aoVoltar,
}: PoderesEmPessoas & {
  pessoa: PessoaDaEmpresa;
  aoVoltar: (mensagem?: string) => void;
}) {
  const [modulos, setModulos] = useState<ModuloComPermissao[] | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    setModulos((await permissoesDaPessoa(pessoa.vinculoId))?.modulos ?? []);
  }, [pessoa.vinculoId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function mudar(modulo: string, acao: AcaoNoModulo | "ver_sensiveis", alcance: Alcance) {
    const r = await ajustarPermissao({ vinculoId: pessoa.vinculoId, modulo, acao, alcance });
    setMensagem(
      r.ok ? { tipo: "ok", texto: "Permissão ajustada." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  const administrador = pessoa.perfil === "administrador";
  return (
    <Pagina
      titulo={pessoa.nome}
      descricao={`${NOME_DO_PERFIL[pessoa.perfil]}${pessoa.area ? ` da área ${pessoa.area}` : ""}. ${
        administrador
          ? "O administrador pode tudo na empresa; não há o que ajustar."
          : "O perfil é o ponto de partida; aqui você ajusta módulo por módulo."
      }`}
    >
      <Button variant="fantasma" size="pequeno" className="justify-self-start" onClick={() => aoVoltar()}>
        <ChevronLeft />
        Pessoas
      </Button>
      {mensagem && <Aviso {...mensagem} />}
      {pessoa.situacao === "convidado" && podeConvidar && (
        <AcoesDoConvite
          pessoa={pessoa}
          aoMudar={aoVoltar}
          aoErro={(texto) => setMensagem({ tipo: "erro", texto })}
        />
      )}
      {modulos?.map((m) => (
        <Card key={m.id} className="gap-3">
          <CardTitulo>{m.nome}</CardTitulo>
          <div className="grid gap-2 sm:grid-cols-2">
            {m.acoes.map((acao) => (
              <label key={acao} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {NOME_DA_ACAO[acao]}
                  {m.ajustes[acao] ? <span className="ml-1 text-xs text-secundaria">(ajustado)</span> : null}
                </span>
                <select
                  aria-label={`${m.nome}: ${NOME_DA_ACAO[acao]}`}
                  className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm disabled:opacity-60"
                  value={m.permissao.acoes[acao]}
                  disabled={!podeAjustar || administrador}
                  onChange={(e) => void mudar(m.id, acao, e.target.value as Alcance)}
                >
                  {(Object.keys(NOME_DO_ALCANCE) as Alcance[]).map((a) => (
                    <option key={a} value={a}>
                      {NOME_DO_ALCANCE[a]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {m.temDadosSensiveis && (
            <label className="flex items-center gap-2 border-t border-linha pt-3 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-tinta"
                checked={m.permissao.verSensiveis}
                disabled={!podeAjustar || administrador}
                onChange={(e) => void mudar(m.id, "ver_sensiveis", e.target.checked ? "tudo" : "nada")}
              />
              Pode ver os dados sensíveis deste módulo
            </label>
          )}
        </Card>
      ))}
      {pessoa.situacao === "ativo" && podeDesligar && pessoa.id !== euId && (
        <Desligar
          pessoa={pessoa}
          aoDesligar={aoVoltar}
          aoErro={(texto) => setMensagem({ tipo: "erro", texto })}
        />
      )}
    </Pagina>
  );
}

const AREA = /^[a-z][a-z0-9_]{1,39}$/;

function FormularioDeConvite({ aoFechar }: { aoFechar: (mensagem?: string) => void }) {
  const [perfil, setPerfil] = useState<PessoaDaEmpresa["perfil"]>("funcionario");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const area = String(dados.get("area") ?? "")
      .trim()
      .toLowerCase();
    if (perfil === "gestor_area" && !AREA.test(area))
      return setErro("Informe a área do gestor, em letras minúsculas e sem espaço (ex.: comercial).");
    if (area && !AREA.test(area))
      return setErro("A área vai em letras minúsculas e sem espaço (ex.: comercial).");
    setEnviando(true);
    setErro(null);
    const email = String(dados.get("email")).trim();
    const r = await convidar({
      email,
      nome: String(dados.get("nome")).trim(),
      perfil,
      area: perfil === "administrador" || !area ? null : area,
    });
    setEnviando(false);
    if (r.ok) aoFechar(`Convite enviado para ${email}. O link vale 7 dias.`);
    else setErro(r.mensagem ?? null);
  }

  return (
    <Card className="gap-4">
      <div className="grid gap-1">
        <CardTitulo>Convidar pessoa</CardTitulo>
        <CardDescricao>
          A pessoa recebe um e-mail com o link para entrar. O link vale 7 dias e funciona uma vez só.
        </CardDescricao>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void aoEnviar(e)}>
        <Campo id="convite-nome" name="nome" rotulo="Nome" autoComplete="off" required maxLength={200} />
        <Campo id="convite-email" name="email" type="email" rotulo="E-mail" autoComplete="off" required />
        <div className="grid gap-1.5">
          <label htmlFor="convite-perfil" className="text-sm font-medium">
            Perfil
          </label>
          <select
            id="convite-perfil"
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
            value={perfil}
            onChange={(e) => setPerfil(e.target.value as PessoaDaEmpresa["perfil"])}
          >
            {(Object.keys(NOME_DO_PERFIL) as PessoaDaEmpresa["perfil"][]).map((p) => (
              <option key={p} value={p}>
                {NOME_DO_PERFIL[p]}
              </option>
            ))}
          </select>
        </div>
        {perfil !== "administrador" && (
          <Campo
            id="convite-area"
            name="area"
            rotulo={perfil === "gestor_area" ? "Área" : "Área (opcional)"}
            placeholder="comercial"
            required={perfil === "gestor_area"}
          />
        )}
        {erro && (
          <div className="sm:col-span-2">
            <Aviso texto={erro} tipo="erro" />
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={enviando}>
            {enviando ? "Enviando..." : "Enviar convite"}
          </Button>
          <Button type="button" variant="fantasma" onClick={() => aoFechar()}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AcoesDoConvite({
  pessoa,
  aoMudar,
  aoErro,
}: {
  pessoa: PessoaDaEmpresa;
  aoMudar: (mensagem: string) => void;
  aoErro: (mensagem: string) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  async function fazer(acao: "reenviar" | "cancelar") {
    setEnviando(true);
    const r =
      acao === "reenviar" ? await reenviarConvite(pessoa.vinculoId) : await cancelarConvite(pessoa.vinculoId);
    setEnviando(false);
    if (!r.ok) return aoErro(r.mensagem ?? "");
    aoMudar(
      acao === "reenviar"
        ? `Convite reenviado para ${pessoa.nome}. O link anterior parou de valer.`
        : `Convite de ${pessoa.nome} cancelado.`,
    );
  }
  return (
    <Card className="gap-3">
      <CardTitulo>Convite pendente</CardTitulo>
      <CardDescricao>
        {pessoa.nome} ainda não aceitou o convite. Você pode mandar um link novo (o anterior para de valer) ou
        cancelar.
      </CardDescricao>
      <div className="flex flex-wrap gap-2">
        <Button variant="contorno" disabled={enviando} onClick={() => void fazer("reenviar")}>
          Reenviar o convite
        </Button>
        <Button variant="fantasma" disabled={enviando} onClick={() => void fazer("cancelar")}>
          Cancelar o convite
        </Button>
      </div>
    </Card>
  );
}

function Desligar({
  pessoa,
  aoDesligar,
  aoErro,
}: {
  pessoa: PessoaDaEmpresa;
  aoDesligar: (mensagem: string) => void;
  aoErro: (mensagem: string) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  async function desligar() {
    setEnviando(true);
    const r = await desligarPessoa(pessoa.vinculoId);
    setEnviando(false);
    if (r.ok) aoDesligar(`${pessoa.nome} foi desligado da empresa.`);
    else {
      setConfirmando(false);
      aoErro(r.mensagem ?? "");
    }
  }
  return (
    <Card className="gap-3 border-perigo/40">
      <CardTitulo>Desligar da empresa</CardTitulo>
      <CardDescricao>
        O acesso de {pessoa.nome} a esta empresa cai na hora, em todos os aparelhos. O histórico continua na
        auditoria. Para voltar, é preciso um convite novo.
      </CardDescricao>
      {confirmando ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Tem certeza?</span>
          <Button variant="perigo" disabled={enviando} onClick={() => void desligar()}>
            Sim, desligar {pessoa.nome.split(" ")[0]}
          </Button>
          <Button variant="fantasma" disabled={enviando} onClick={() => setConfirmando(false)}>
            Não
          </Button>
        </div>
      ) : (
        <Button variant="contorno" className="justify-self-start" onClick={() => setConfirmando(true)}>
          Desligar
        </Button>
      )}
    </Card>
  );
}

export function Seguranca({
  podeEditar,
  donoDaPlataforma,
}: {
  podeEditar: boolean;
  donoDaPlataforma: boolean;
}) {
  const [empresa, setEmpresa] = useState<{ exigirDoisFatores: boolean; exigirPasskey: boolean } | null>(null);
  const [plataforma, setPlataforma] = useState<{ exigirPasskeyAdministradores: boolean } | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  const carregar = useCallback(async () => {
    setEmpresa(await lerSeguranca());
    if (donoDaPlataforma) setPlataforma(await lerRegrasDaPlataforma());
  }, [donoDaPlataforma]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function mudarEmpresa(dados: { exigirDoisFatores: boolean; exigirPasskey: boolean }) {
    setEmpresa(dados);
    const r = await salvarSeguranca(dados);
    setMensagem(
      r.ok ? { tipo: "ok", texto: "Regras da empresa salvas." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  async function mudarPlataforma(valor: boolean) {
    setPlataforma({ exigirPasskeyAdministradores: valor });
    const r = await salvarRegrasDaPlataforma(valor);
    setMensagem(
      r.ok ? { tipo: "ok", texto: "Regra da plataforma salva." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  return (
    <Pagina
      titulo="Segurança"
      descricao="A autenticação em 2 fatores já é obrigatória para administradores. Aqui você pode apertar as regras, nunca afrouxar."
    >
      {mensagem && <Aviso {...mensagem} />}
      {empresa && (
        <Card className="gap-3">
          <CardTitulo>Nesta empresa</CardTitulo>
          <Interruptor
            rotulo="Exigir 2FA de todas as pessoas"
            descricao="Quem ainda não tem vai precisar ativar no próximo acesso."
            ligado={empresa.exigirDoisFatores}
            desligado={!podeEditar}
            aoMudar={(v) => void mudarEmpresa({ ...empresa, exigirDoisFatores: v })}
          />
          <Interruptor
            rotulo="Exigir passkey de todas as pessoas"
            descricao="O código do app deixa de valer sozinho. Fecha a porta para o golpe do site falso."
            ligado={empresa.exigirPasskey}
            desligado={!podeEditar}
            aoMudar={(v) => void mudarEmpresa({ ...empresa, exigirPasskey: v })}
          />
        </Card>
      )}
      {plataforma && (
        <Card className="gap-3">
          <div className="grid gap-1">
            <CardTitulo>Plataforma inteira</CardTitulo>
            <CardDescricao>
              Só você, como Dono da plataforma, vê isto. Vale para todas as empresas.
            </CardDescricao>
          </div>
          <Interruptor
            rotulo="Administradores e Dono só com passkey"
            descricao="Em todas as empresas, administradores confirmam só com passkey."
            ligado={plataforma.exigirPasskeyAdministradores}
            aoMudar={(v) => void mudarPlataforma(v)}
          />
        </Card>
      )}
    </Pagina>
  );
}

function Interruptor(props: {
  rotulo: string;
  descricao: string;
  ligado: boolean;
  desligado?: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 border-t border-linha pt-3 first:border-t-0 first:pt-0">
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{props.rotulo}</span>
        <span className="text-xs text-texto-2">{props.descricao}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.ligado}
        className="mt-1 size-5 shrink-0 accent-tinta"
        checked={props.ligado}
        disabled={props.desligado}
        onChange={(e) => props.aoMudar(e.target.checked)}
      />
    </label>
  );
}

const GRUPOS_DE_ACAO = [
  ["", "Tudo"],
  ["acesso", "Entradas e saídas"],
  ["dois_fatores", "2FA"],
  ["sessao", "Aparelhos"],
  ["permissao", "Permissões"],
  ["empresa", "Empresa"],
  ["pessoa", "Pessoas"],
] as const;

function descreverAcao(e: EventoDaAuditoria): string {
  const nomes: Record<string, string> = {
    "acesso.entrou": "Entrou",
    "acesso.saiu": "Saiu",
    "acesso.falhou": "Senha errada",
    "acesso.travou": "Login travado",
    "dois_fatores.verificou": "Confirmou o 2FA",
    "dois_fatores.ativou": "Ativou o 2FA",
    "sessao.encerrou": "Aparelho desconectado",
    "sessao.aparelho_novo": "Acesso por aparelho novo",
    "permissao.alterou": "Mudou uma permissão",
    "empresa.alterou": "Mudou a segurança da empresa",
    "empresa.trocou_ativa": "Trocou de empresa",
    "pessoa.alterou": "Mudou o perfil",
    "senha.trocou": "Trocou a senha",
  };
  return nomes[e.acao] ?? e.acao;
}

export function Auditoria({ nomes }: { nomes: Map<string, string> }) {
  const [eventos, setEventos] = useState<EventoDaAuditoria[] | null>(null);
  const [acao, setAcao] = useState("");
  const [desde, setDesde] = useState("");

  useEffect(() => {
    setEventos(null);
    void listarAuditoria({ acao, desde: desde ? new Date(desde).toISOString() : "" }).then((r) =>
      setEventos(r ?? []),
    );
  }, [acao, desde]);

  return (
    <Pagina
      titulo="Auditoria"
      descricao="Quem fez o quê, quando e de onde. Os registros não podem ser alterados nem apagados."
    >
      <div className="flex flex-wrap gap-3">
        <select
          aria-label="Tipo de evento"
          className="h-10 rounded-md border border-linha bg-cartao px-2 text-sm"
          value={acao}
          onChange={(e) => setAcao(e.target.value)}
        >
          {GRUPOS_DE_ACAO.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="Desde"
          className="h-10 rounded-md border border-linha bg-cartao px-2 text-sm"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
        />
      </div>
      <Card className="gap-0 p-0">
        {eventos === null && <p className="p-5 text-sm text-texto-2">Carregando...</p>}
        {eventos?.length === 0 && (
          <p className="p-5 text-sm text-texto-2">Nenhum evento com esses filtros.</p>
        )}
        <ul>
          {eventos?.map((e) => (
            <li key={e.sequencia} className="grid gap-0.5 border-t border-linha px-5 py-3 first:border-t-0">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{descreverAcao(e)}</span>
                <span className="text-xs text-texto-2">
                  {new Date(e.ocorrido_em).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </span>
              <span className="text-xs text-texto-2">
                {e.ator.pessoaId
                  ? (nomes.get(e.ator.pessoaId) ?? "Pessoa")
                  : e.ator.tipo === "agente"
                    ? "Agente"
                    : "Sistema"}
                {e.origem.aparelho ? ` · ${e.origem.aparelho}` : ""}
                {e.origem.ip ? ` · IP ${e.origem.ip}` : ""}
                {` · nº ${e.sequencia}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Pagina>
  );
}
