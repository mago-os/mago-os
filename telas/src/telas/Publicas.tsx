/**
 * Páginas públicas (M6-05c, cartão #190): /sobre, a página inicial que o Google pede para publicar o login, e
 * /privacidade, a Política de Privacidade. Abertas sem login e sem falar com a API.
 */

import { Bot, ClipboardList, MessageCircle, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { Mago } from "@/componentes/Mago";
import { Button } from "@/componentes/ui/button";
import { Card } from "@/componentes/ui/card";
import { type Bloco, lerTexto, type Trecho } from "@/lib/texto-simples";
import politica from "@/textos/politica-de-privacidade.md?raw";

export const PAGINAS_PUBLICAS = ["/sobre", "/privacidade"];

const CONTATO = "privacidade@osmago.com";

function useTitulo(titulo: string) {
  useEffect(() => {
    const anterior = document.title;
    document.title = titulo;
    return () => {
      document.title = anterior;
    };
  }, [titulo]);
}

/** Links das páginas públicas, no pé das telas de acesso e das próprias páginas. */
export function RodapePublico() {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-6 text-xs text-texto-3">
      <a className="hover:text-tinta hover:underline" href="/sobre">
        Sobre o Mago OS
      </a>
      <a className="hover:text-tinta hover:underline" href="/privacidade">
        Política de Privacidade
      </a>
      <span>Nolask Tecnologia Digital</span>
    </footer>
  );
}

const RECURSOS = [
  {
    icone: ClipboardList,
    titulo: "Tarefas, projetos e rotinas",
    texto: "Quadros, listas, agenda e rotinas que se repetem, com prioridades, prazos, anexos e comentários.",
  },
  {
    icone: Bot,
    titulo: "Agentes de IA na equipe",
    texto:
      "Agentes que pegam tarefas, entregam resultados e pedem aprovação, com as contas de IA da própria empresa e limites de gasto.",
  },
  {
    icone: ShieldCheck,
    titulo: "Permissões e auditoria",
    texto:
      "Cada empresa só vê os próprios dados. Login com 2FA, permissões por pessoa e agente, e o registro de quem fez o quê.",
  },
  {
    icone: MessageCircle,
    titulo: "Telegram e avisos",
    texto: "Converse com o coordenador pelo Telegram, aprove pedidos dos agentes e receba avisos no celular.",
  },
];

export function Sobre() {
  useTitulo("Mago OS: pessoas e agentes de IA trabalhando juntos");
  return (
    <>
      <main className="mx-auto grid max-w-3xl gap-8 px-4 py-10">
        <section className="grid justify-items-center gap-4 text-center">
          <Mago tamanho={96} estado="parado" rotulo="Mago" />
          <h1 className="text-3xl font-semibold tracking-tight">Mago OS</h1>
          <p className="max-w-xl text-texto-2">
            O sistema operacional de agentes para empresas: pessoas e agentes de inteligência artificial
            trabalhando juntos em tarefas, projetos e rotinas, com login seguro, permissões, auditoria e
            isolamento total entre empresas.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <a href="/entrar">Entrar</a>
            </Button>
            <Button asChild variant="contorno">
              <a href="/privacidade">Política de Privacidade</a>
            </Button>
          </div>
        </section>
        <section className="grid gap-3 sm:grid-cols-2" aria-label="O que o Mago OS faz">
          {RECURSOS.map(({ icone: Icone, titulo, texto }) => (
            <Card key={titulo} className="gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Icone className="size-4 text-texto-2" aria-hidden="true" />
                {titulo}
              </h2>
              <p className="text-sm text-texto-2">{texto}</p>
            </Card>
          ))}
        </section>
        <section className="grid gap-2 text-center text-sm text-texto-2">
          <p>
            Para quem é: empresas que querem organizar o trabalho da equipe e colocar agentes de IA para
            ajudar, com controle do que cada um pode fazer. O acesso é por convite.
          </p>
          <p>
            O Mago OS é oferecido pela Nolask Tecnologia Digital, CNPJ 36.142.232/0001-21. Contato:{" "}
            <a className="text-tinta underline" href={`mailto:${CONTATO}`}>
              {CONTATO}
            </a>
            .
          </p>
        </section>
      </main>
      <RodapePublico />
    </>
  );
}

function Trechos({ trechos }: { trechos: Trecho[] }) {
  return trechos.map((t, i) => {
    const chave = `${i}-${t.texto}`;
    if (t.tipo === "negrito") return <strong key={chave}>{t.texto}</strong>;
    if (t.tipo === "link")
      return (
        <a
          key={chave}
          className="text-tinta underline"
          href={t.endereco}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.texto}
        </a>
      );
    return <span key={chave}>{t.texto}</span>;
  });
}

function BlocoDoTexto({ bloco }: { bloco: Bloco }) {
  switch (bloco.tipo) {
    case "titulo":
      return bloco.nivel === 1 ? (
        <h1 className="text-2xl font-semibold tracking-tight">{bloco.texto}</h1>
      ) : (
        <h2 className="mt-4 text-lg font-semibold tracking-tight">{bloco.texto}</h2>
      );
    case "paragrafo":
      return (
        <p className="text-sm leading-relaxed text-texto-2">
          <Trechos trechos={bloco.trechos} />
        </p>
      );
    case "lista":
      return (
        <ul className="grid list-disc gap-1 pl-5 text-sm leading-relaxed text-texto-2">
          {bloco.itens.map((item, i) => (
            <li key={i}>
              <Trechos trechos={item} />
            </li>
          ))}
        </ul>
      );
    case "tabela":
      return (
        <div className="overflow-x-auto rounded-cartao border border-linha">
          <table className="w-full text-left text-sm">
            <thead className="bg-suave">
              <tr>
                {bloco.cabecalho.map((c, i) => (
                  <th key={i} className="px-3 py-2 font-medium">
                    <Trechos trechos={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloco.linhas.map((linha, i) => (
                <tr key={i} className="border-t border-linha align-top">
                  {linha.map((c, j) => (
                    <td key={j} className="px-3 py-2 text-texto-2">
                      <Trechos trechos={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

const BLOCOS_DA_POLITICA = lerTexto(politica);

export function Privacidade() {
  useTitulo("Política de Privacidade do Mago OS");
  return (
    <>
      <main className="mx-auto grid max-w-3xl gap-3 px-4 py-10">
        {BLOCOS_DA_POLITICA.map((bloco, i) => (
          <BlocoDoTexto key={i} bloco={bloco} />
        ))}
      </main>
      <RodapePublico />
    </>
  );
}
