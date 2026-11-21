/**
 * Agentes › Skills (M4-05): a biblioteca (as da plataforma e as da empresa), criar, editar o rascunho, publicar e
 * escolher os agentes que recebem cada uma. Uma skill é só texto e não dá permissão nenhuma.
 */
import { CARACTERES_DA_SKILL, type Skill, type VersaoDeSkill } from "@mago-os/contratos";
import { ArrowLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type AgenteNaLista, listarAgentes } from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;

function FormularioDaSkill({
  inicial,
  nomeFixo,
  aoSalvar,
  aoCancelar,
  rotulo,
}: {
  inicial: { nome: string; descricao: string; texto: string };
  nomeFixo: boolean;
  aoSalvar: (d: { nome: string; descricao: string; texto: string }) => Promise<void>;
  aoCancelar?: () => void;
  rotulo: string;
}) {
  const [d, setD] = useState(inicial);
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void aoSalvar(d);
      }}
    >
      <Campo
        id="nome-da-skill"
        rotulo="Nome (minúsculas e hífen, ex.: responder-clientes)"
        value={d.nome}
        onChange={(e) => setD({ ...d, nome: e.target.value.toLowerCase() })}
        disabled={nomeFixo}
        required
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        maxLength={64}
      />
      <Campo
        id="descricao-da-skill"
        rotulo="Quando usar (o agente lê para decidir)"
        value={d.descricao}
        onChange={(e) => setD({ ...d, descricao: e.target.value })}
        required
        maxLength={1024}
      />
      <label className="grid gap-1 text-sm font-medium">
        Texto da skill (SKILL.md)
        <textarea
          value={d.texto}
          onChange={(e) => setD({ ...d, texto: e.target.value })}
          required
          rows={12}
          maxLength={CARACTERES_DA_SKILL}
          className="w-full min-w-0 rounded-md border border-linha bg-cartao px-3 py-2 font-mono text-sm font-normal"
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit">{rotulo}</Button>
        {aoCancelar && (
          <Button type="button" variant="fantasma" onClick={aoCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

function DetalheDaSkill({
  skill,
  todas,
  agentes,
  aoMudar,
}: {
  skill: Skill;
  /** A biblioteca inteira: dela sai a lista de skills de cada agente (sem ler de novo do servidor). */
  todas: Skill[];
  agentes: AgenteNaLista[];
  aoMudar: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [versoes, setVersoes] = useState<VersaoDeSkill[]>([]);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<{ skill: Skill; versoes: VersaoDeSkill[] }>(
      "GET",
      `/skills/${encodeURIComponent(skill.id)}`,
    );
    if (r.ok && r.dados) setVersoes(r.dados.versoes);
  }, [skill.id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  const rascunho = versoes.find((v) => v.situacao === "rascunho");
  const publicada = versoes.find((v) => v.situacao === "publicada");
  const base = rascunho ?? publicada;

  async function salvarRascunho(d: { nome: string; descricao: string; texto: string }) {
    const r = await pedir("POST", `/skills/${encodeURIComponent(skill.id)}/rascunho`, d);
    setMensagem(
      r.ok
        ? { tipo: "ok", texto: "Rascunho salvo. Os agentes continuam com a versão publicada." }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
    void aoMudar();
  }
  async function publicar() {
    const r = await pedir<{ versao: number }>("POST", `/skills/${encodeURIComponent(skill.id)}/publicar`, {});
    setMensagem(
      r.ok
        ? { tipo: "ok", texto: `Versão ${r.dados?.versao} publicada.` }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
    void aoMudar();
  }
  /** Uma mudança de cada vez: a lista do agente sai da biblioteca já carregada, e a próxima espera esta terminar. */
  async function atribuir(agenteId: string, recebe: boolean) {
    setOcupado(true);
    const lista = new Set(todas.filter((s) => s.agentes.includes(agenteId)).map((s) => s.id));
    if (recebe) lista.add(skill.id);
    else lista.delete(skill.id);
    const r = await pedir("POST", `/agentes/${encodeURIComponent(agenteId)}/skills`, { skills: [...lista] });
    if (!r.ok) setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    await aoMudar();
    setOcupado(false);
  }

  return (
    <div className="grid gap-3 border-t border-linha pt-3">
      {mensagem && <Aviso {...mensagem} />}
      <div className="grid gap-1">
        <p className="text-sm font-medium">Agentes que recebem</p>
        <div className="flex flex-wrap gap-3">
          {agentes.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={skill.agentes.includes(a.id)}
                disabled={ocupado}
                onChange={(e) => void atribuir(a.id, e.target.checked)}
              />
              {a.nome}
            </label>
          ))}
        </div>
      </div>
      {skill.origem === "plataforma" ? (
        <pre className="overflow-x-auto rounded-md bg-suave p-2 text-xs whitespace-pre-wrap">
          {publicada?.texto}
        </pre>
      ) : (
        base && (
          <>
            <p className="text-xs text-texto-2">
              {rascunho
                ? `Editando o rascunho da versão ${rascunho.versao}.${publicada ? ` Os agentes recebem a versão ${publicada.versao}.` : " Ainda não publicada: os agentes não recebem."}`
                : `Versão ${publicada?.versao} publicada. Salvar cria o rascunho da próxima.`}
            </p>
            <FormularioDaSkill
              key={`${base.versao}:${base.situacao}`}
              inicial={{ nome: skill.nome, descricao: base.descricao, texto: base.texto }}
              nomeFixo
              rotulo="Salvar rascunho"
              aoSalvar={salvarRascunho}
            />
            {rascunho && (
              <Button variant="contorno" onClick={() => void publicar()}>
                Publicar a versão {rascunho.versao}
              </Button>
            )}
          </>
        )
      )}
    </div>
  );
}

export function Skills({ podeCriar }: { podeCriar: boolean }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [agentes, setAgentes] = useState<AgenteNaLista[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<Skill[]>("GET", "/skills");
    setSkills(r.ok && r.dados ? r.dados : []);
  }, []);
  useEffect(() => {
    void carregar();
    void listarAgentes().then((r) => setAgentes((r.dados ?? []).filter((a) => a.situacao !== "desligado")));
  }, [carregar]);

  async function criar(d: { nome: string; descricao: string; texto: string }) {
    const r = await pedir<{ id: string }>("POST", "/skills", d);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({ tipo: "ok", texto: "Skill criada como rascunho. Publique para os agentes receberem." });
    setCriando(false);
    await carregar();
    setAberta(r.dados?.id ?? null);
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/agentes" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
        <ArrowLeft className="size-4" /> Agentes
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
          <p className="text-sm text-texto-2">
            Textos que ensinam um jeito de fazer algo. Cada agente recebe só as skills escolhidas para ele.
            Uma skill não dá permissão nenhuma.
          </p>
        </div>
        {podeCriar && !criando && (
          <Button onClick={() => setCriando(true)}>
            <Plus /> Nova skill
          </Button>
        )}
      </div>
      {mensagem && <Aviso {...mensagem} />}
      {criando && (
        <Card className="gap-3">
          <CardTitulo>Nova skill</CardTitulo>
          <FormularioDaSkill
            inicial={{ nome: "", descricao: "", texto: "" }}
            nomeFixo={false}
            rotulo="Criar rascunho"
            aoSalvar={criar}
            aoCancelar={() => setCriando(false)}
          />
        </Card>
      )}
      {skills?.map((s) => (
        <Card key={s.id} className="gap-2">
          <button
            type="button"
            className="grid gap-1 text-left"
            aria-expanded={aberta === s.id}
            onClick={() => setAberta(aberta === s.id ? null : s.id)}
          >
            <CardTitulo>{s.nome}</CardTitulo>
            <CardDescricao>{s.descricao}</CardDescricao>
            <span className="flex flex-wrap gap-2 text-xs text-texto-2">
              <span>{s.origem === "plataforma" ? "Da plataforma" : "Da empresa"}</span>
              <span>{s.versaoPublicada ? `Versão ${s.versaoPublicada}` : "Ainda não publicada"}</span>
              {s.temRascunho && <span>Com rascunho</span>}
              <span>
                {s.agentes.length === 0
                  ? "Nenhum agente"
                  : s.agentes.length === 1
                    ? "1 agente"
                    : `${s.agentes.length} agentes`}
              </span>
            </span>
          </button>
          {aberta === s.id && (
            <DetalheDaSkill skill={s} todas={skills} agentes={agentes} aoMudar={carregar} />
          )}
        </Card>
      ))}
    </main>
  );
}
