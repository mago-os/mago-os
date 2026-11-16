/**
 * Núcleo do Mago OS.
 *
 * O servidor Fastify, a rota de saúde, os registros e a fila chegam no M0-04.
 */
import { VERSAO_CONTRATOS } from "@mago-os/contratos";

export const NOME_DO_SISTEMA = "Mago OS";

/** Informação básica que a rota de saúde vai devolver. */
export function sobreOSistema(): { nome: string; versaoContratos: number } {
  return { nome: NOME_DO_SISTEMA, versaoContratos: VERSAO_CONTRATOS };
}
