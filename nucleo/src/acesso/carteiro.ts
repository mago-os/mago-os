/**
 * Carteiros: quem entrega os e-mails do sistema (M1-03 e M1-07).
 *
 * - carteiroResend: o de verdade, pelo Resend (MAGO_RESEND_CHAVE), como "Mago OS <nao-responda@osmago.com>".
 * - carteiroDoLog: sem a chave do Resend (no Mac), o link vai para o log da API. Na produção, recusa.
 *
 * Os textos não usam o travessão, como os outros textos que a pessoa lê.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Carteiro, DadosDoAvisoDeAgente } from "./login.ts";

export const REMETENTE = "Mago OS <nao-responda@osmago.com>";

export interface DadosDoConvite {
  para: string;
  nome: string;
  empresa: string;
  quemConvidou: string;
  link: string;
}

function escapar(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Um e-mail simples, no estilo do Mago OS: texto curto, um botão, e o link escrito para quem não vê o botão. */
function montar(
  titulo: string,
  paragrafos: string[],
  botao: string,
  link: string,
): { html: string; text: string } {
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#fafafa;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0a0a0b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border:1px solid #e6e6e9;border-radius:12px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b6b74">Mago OS</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapar(titulo)}</h1>
${paragrafos.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapar(p)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${escapar(link)}" style="display:inline-block;background:#0a0a0b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapar(botao)}</a></p>
<p style="margin:0;font-size:13px;color:#6b6b74;line-height:1.5">Se o botão não funcionar, copie este endereço no navegador:<br>${escapar(link)}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${titulo}\n\n${paragrafos.join("\n\n")}\n\n${botao}: ${link}\n`;
  return { html, text };
}

export function emailDeSenha(nome: string, link: string) {
  return {
    assunto: "Defina a sua senha do Mago OS",
    ...montar(
      `Olá, ${nome.split(" ")[0]}`,
      [
        "Recebemos um pedido para definir a senha da sua conta no Mago OS.",
        "O link vale 1 hora e funciona uma vez só. Se não foi você, pode ignorar este e-mail: a sua senha continua a mesma.",
      ],
      "Definir a senha",
      link,
    ),
  };
}

export function emailDeConvite(d: DadosDoConvite) {
  return {
    assunto: `${d.quemConvidou} convidou você para a ${d.empresa} no Mago OS`,
    ...montar(
      `Você foi convidado para a ${d.empresa}`,
      [
        `${d.quemConvidou} convidou você para trabalhar na ${d.empresa} pelo Mago OS, onde pessoas e agentes de IA trabalham juntos.`,
        "O convite vale 7 dias e funciona uma vez só. Se você não esperava este convite, pode ignorar este e-mail.",
      ],
      "Aceitar o convite",
      d.link,
    ),
  };
}

export interface DadosDoConviteDeEmpresa {
  para: string;
  nome: string;
  quemConvidou: string;
  link: string;
}

export function emailDeConviteDeEmpresa(d: DadosDoConviteDeEmpresa) {
  return {
    assunto: `${d.quemConvidou} convidou você para criar a sua conta no Mago OS`,
    ...montar(
      `Olá, ${d.nome.split(" ")[0]}`,
      [
        `${d.quemConvidou} convidou você para criar a sua conta no Mago OS, onde pessoas e agentes de IA trabalham juntos.`,
        "Pelo link, você cria o seu acesso e cadastra a empresa (com CNPJ) ou a sua conta de pessoa física (com CPF). Você será o administrador da conta.",
        "O convite vale 7 dias e funciona uma vez só. Se você não esperava este convite, pode ignorar este e-mail.",
      ],
      "Criar a minha conta",
      d.link,
    ),
  };
}

export function emailDeAvisoDeAgente(d: DadosDoAvisoDeAgente) {
  const tarefas =
    d.tarefas.length === 0
      ? []
      : [
          `Tarefas que voltaram para A fazer ou passaram para você: ${d.tarefas.slice(0, 10).join("; ")}${
            d.tarefas.length > 10 ? ` e mais ${d.tarefas.length - 10}` : ""
          }.`,
        ];
  return {
    assunto: `O agente ${d.agente} ${d.oQueAconteceu}`,
    ...montar(
      `O agente ${d.agente} ${d.oQueAconteceu}`,
      [`Olá, ${d.nome.split(" ")[0]}. Você é a pessoa responsável por este agente no Mago OS.`, ...tarefas],
      "Ver o agente",
      d.link,
    ),
  };
}

/** Envia pelo Resend. Erro no envio vira exceção: quem chamou decide o que mostrar. */
export function carteiroResend(chave: string, envio: typeof fetch = fetch): Carteiro {
  async function mandar(para: string, e: { assunto: string; html: string; text: string }) {
    const r = await envio("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: REMETENTE, to: [para], subject: e.assunto, html: e.html, text: e.text }),
    });
    if (!r.ok) throw new Error(`Resend recusou o e-mail (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }
  return {
    enviarLinkDeSenha: ({ para, nome, link }) => mandar(para, emailDeSenha(nome, link)),
    enviarConvite: (d) => mandar(d.para, emailDeConvite(d)),
    enviarConviteDeEmpresa: (d) => mandar(d.para, emailDeConviteDeEmpresa(d)),
    enviarAvisoDeAgente: (d) => mandar(d.para, emailDeAvisoDeAgente(d)),
  };
}

export function carteiroDoLog(log: FastifyBaseLogger, ambiente: "local" | "teste" | "producao"): Carteiro {
  const recusar = () => {
    if (ambiente === "producao")
      throw new Error("Sem provedor de e-mail na produção: o link não pode ir para o log");
  };
  return {
    async enviarLinkDeSenha({ para, link }) {
      recusar();
      log.warn({ evento: "senha.pediu_recuperacao", para, link }, "Link de senha (sem e-mail: ver o log)");
    },
    async enviarConvite({ para, empresa, link }) {
      recusar();
      log.warn(
        { evento: "vinculo.convidou", para, empresa, link },
        "Link de convite (sem e-mail: ver o log)",
      );
    },
    async enviarConviteDeEmpresa({ para, link }) {
      recusar();
      log.warn(
        { evento: "empresa.convidou", para, link },
        "Link de convite de conta nova (sem e-mail: ver o log)",
      );
    },
    async enviarAvisoDeAgente({ para, agente, oQueAconteceu }) {
      log.warn(
        { evento: "agente.aviso", para, agente, oQueAconteceu },
        "Aviso de agente (sem e-mail: ver o log)",
      );
    },
  };
}
