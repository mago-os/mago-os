/**
 * A transcrição do áudio que chega (M8-08, decisão 0058). O áudio entra na fila; a transcrição usa a conta de IA que
 * a empresa escolheu para transcrever (custo do cliente, no teto do mês) e fica na mensagem. Só sai o arquivo, já
 * conferido pelo antivírus, com até 10 minutos e 25 MB. Depois, o agente do canal atende lendo a transcrição (como
 * texto de outros); sem transcrição (sem conta, longa demais, no teto ou com falha), a conversa vai para as pessoas.
 */
import {
  BYTES_MAXIMOS_DA_TRANSCRICAO,
  SEGUNDOS_MAXIMOS_DA_TRANSCRICAO,
  type SituacaoDaTranscricao,
} from "@mago-os/contratos";
import type pg from "pg";
import type { ServicosDosAnexos } from "../anexos/servico.ts";
import type { Cofre } from "../contas-de-ia/cofre.ts";
import { chaveCifradaDaConta } from "../contas-de-ia/servico.ts";
import type { Transcritor } from "../contas-de-ia/transcricao.ts";
import { registrarTranscricao, tetoDaTranscricao } from "../custos/servico.ts";
import { comEmpresa } from "../empresa.ts";
import { type OpcoesDoAtendimento, pedirAoAtendente, voltarParaAsPessoas } from "./atendimento.ts";

export interface OpcoesDaTranscricao {
  poolApp: pg.Pool;
  arquivos: Pick<ServicosDosAnexos, "deposito"> | null;
  /** Sem o cofre (as contas de IA desligadas), nada é transcrito. */
  cofre: Cofre | null;
  transcritor: Transcritor;
  /** O agente do canal: atende depois da transcrição (sem ele, a transcrição só aparece na caixa). */
  atendimento?: OpcoesDoAtendimento;
  log: { warn(o: unknown, m?: string): void };
}

/** Sem a duração do WhatsApp: estima pelo tamanho (o áudio do WhatsApp tem cerca de 16 kbit/s). */
const segundosPeloTamanho = (bytes: number) => Math.max(1, Math.round(bytes / 2000));

const MOTIVOS: Record<Exclude<SituacaoDaTranscricao, "pronta" | "transcrevendo">, string> = {
  sem_conta: "o cliente mandou um áudio, e a empresa ainda não escolheu quem transcreve",
  longa_demais: "o cliente mandou um áudio longo demais para transcrever",
  no_teto: "o cliente mandou um áudio que não deu para transcrever (o gasto com IA chegou ao teto do mês)",
  falhou: "o cliente mandou um áudio que não deu para transcrever",
};

/**
 * Transcreve o áudio de uma mensagem que chegou. "automatica": a chegada da mensagem (depois, o agente atende ou a
 * conversa vai para as pessoas); falsa: uma pessoa pediu de novo pela caixa (só a transcrição muda). Devolve a
 * situação, ou nula quando a mensagem não é um áudio que chegou.
 */
export async function transcreverMensagem(
  o: OpcoesDaTranscricao,
  empresaId: string,
  mensagemId: string,
  automatica = true,
): Promise<SituacaoDaTranscricao | null> {
  type Preparo =
    | { fim: SituacaoDaTranscricao; conversaId: string }
    | {
        conversaId: string;
        agenteId: string | null;
        contaId: string;
        endereco: string;
        modelo: string;
        chave: string;
        caminho: string;
        mime: string;
        nome: string;
        segundos: number;
      };
  const preparo = await comEmpresa(o.poolApp, empresaId, async (c): Promise<Preparo | null> => {
    const r = await c.query<{
      conversa_id: string;
      agente_id: string | null;
      situacao: string | null;
      caminho: string | null;
      tipo: string | null;
      nome: string | null;
      tamanho: number | null;
      segundos: number | null;
    }>(
      `select m.conversa_id, cn.agente_id, a.situacao, a.caminho, a.tipo, a.nome, a.tamanho, a.segundos
         from mensagens_com_contatos m
         join canais_de_contato cn on cn.id = m.canal_id and cn.empresa_id = m.empresa_id
         left join arquivos_de_conversa a on a.mensagem_id = m.id and a.empresa_id = m.empresa_id
        where m.id = $1 and m.empresa_id = empresa_ativa() and m.tipo = 'audio' and m.direcao = 'chegou'
        for update of m`,
      [mensagemId],
    );
    const l = r.rows[0];
    if (!l) return null;
    const fim = (s: SituacaoDaTranscricao) => ({ fim: s, conversaId: l.conversa_id });
    const conta = (
      await c.query<{ id: string; endereco: string | null; modelo: string }>(
        `select id, endereco, modelo_de_transcricao as modelo from contas_de_ia
          where empresa_id = empresa_ativa() and modelo_de_transcricao is not null
            and provedor = 'compativel_openai' and credencial = 'chave_de_api'`,
      )
    ).rows[0];
    if (!conta?.endereco || !o.cofre) return fim("sem_conta");
    if (l.situacao !== "disponivel" || !l.caminho) return fim("falhou");
    const segundos = l.segundos ?? segundosPeloTamanho(l.tamanho ?? 0);
    if (segundos > SEGUNDOS_MAXIMOS_DA_TRANSCRICAO || (l.tamanho ?? 0) > BYTES_MAXIMOS_DA_TRANSCRICAO)
      return fim("longa_demais");
    if (await tetoDaTranscricao(c, conta.id)) return fim("no_teto");
    const cifrada = await chaveCifradaDaConta(c, conta.id);
    const cofre = o.cofre;
    if (!cifrada || !cofre) return fim("sem_conta");
    await c.query(
      "update mensagens_com_contatos set transcricao_situacao = 'transcrevendo' where id = $1 and empresa_id = empresa_ativa()",
      [mensagemId],
    );
    return {
      conversaId: l.conversa_id,
      agenteId: l.agente_id,
      contaId: conta.id,
      endereco: conta.endereco,
      modelo: conta.modelo,
      chave: await cofre.abrirChaveDeIa(c, empresaId, conta.id, cifrada),
      caminho: l.caminho,
      mime: l.tipo ?? "audio/ogg",
      nome: l.nome ?? "audio.ogg",
      segundos,
    };
  });
  if (!preparo) return null;

  let situacao: SituacaoDaTranscricao;
  let texto: string | null = null;
  if ("fim" in preparo) situacao = preparo.fim;
  else {
    try {
      if (!o.arquivos) throw new Error("sem depósito");
      const dados = await o.arquivos.deposito.ler(preparo.caminho);
      texto = (
        await o.transcritor.transcrever({
          endereco: preparo.endereco,
          chave: preparo.chave,
          modelo: preparo.modelo,
          dados,
          nome: preparo.nome,
          mime: preparo.mime,
        })
      ).texto;
      situacao = "pronta";
    } catch (erro) {
      o.log.warn({ erro: (erro as Error).message, mensagemId }, "Transcrição do áudio falhou");
      situacao = "falhou";
    }
  }
  await comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query(
      `update mensagens_com_contatos set transcricao = coalesce($3, transcricao), transcricao_situacao = $2,
              transcrita_em = now()
        where id = $1 and empresa_id = empresa_ativa()`,
      [mensagemId, situacao, texto],
    );
    if (situacao === "pronta" && !("fim" in preparo))
      await registrarTranscricao(c, {
        contaId: preparo.contaId,
        modelo: preparo.modelo,
        segundos: preparo.segundos,
        agenteId: preparo.agenteId,
      });
    // Sem transcrição, o agente não entende o áudio: a conversa vai para as pessoas (só na chegada).
    if (automatica && situacao !== "pronta" && situacao !== "transcrevendo")
      await voltarParaAsPessoas(c, preparo.conversaId, MOTIVOS[situacao]);
  });
  if (automatica && situacao === "pronta" && o.atendimento)
    await pedirAoAtendente(o.atendimento, empresaId, preparo.conversaId);
  return situacao;
}
