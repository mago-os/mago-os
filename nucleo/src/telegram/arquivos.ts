/**
 * Arquivos mandados pelo Telegram (M5-03, decisão 0034), na verificação a cada minuto: o que passou das 24 horas
 * sem tarefa vence (nada foi baixado, nada a apagar), e o anexo que o antivírus bloqueou é avisado no Telegram de quem
 * mandou, uma vez só.
 */
import { respostaDeArquivoBloqueado } from "@mago-os/contratos";
import { comEmpresa } from "../empresa.ts";
import type { OpcoesDoTelegram } from "./servico.ts";

export async function cuidarDosArquivosDoTelegram(
  o: Pick<OpcoesDoTelegram, "poolApp" | "carteiro" | "log">,
  empresaId: string,
): Promise<{ vencidos: number; avisados: number }> {
  const { vencidos, bloqueados } = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const v = await c.query(
      `update arquivos_do_telegram set situacao = 'vencido'
        where empresa_id = empresa_ativa() and situacao = 'esperando' and vence_em < now()`,
    );
    // Marca antes de mandar: um aviso que não chegar não é repetido a cada minuto (o anexo bloqueado já está no app).
    const b = await c.query<{ nome: string; chat_id: string | null }>(
      `update arquivos_do_telegram a set bloqueio_avisado_em = now()
         from anexos x
         left join vinculos_do_telegram t on t.empresa_id = x.empresa_id and t.pessoa_id = x.enviado_por_pessoa_id
        where a.empresa_id = empresa_ativa() and x.empresa_id = a.empresa_id and x.id = a.anexo_id
          and a.situacao = 'anexado' and a.bloqueio_avisado_em is null and x.situacao = 'bloqueado'
       returning a.nome, t.chat_id`,
    );
    return { vencidos: v.rowCount ?? 0, bloqueados: b.rows };
  });
  let avisados = 0;
  for (const b of bloqueados) {
    if (!b.chat_id) continue;
    await o.carteiro
      .enviar(Number(b.chat_id), respostaDeArquivoBloqueado(b.nome))
      .then(() => {
        avisados++;
      })
      .catch((erro) => o.log.warn({ erro }, "Telegram: aviso de arquivo bloqueado não foi enviado"));
  }
  return { vencidos, avisados };
}
