/**
 * Módulos que existem hoje e o que cada um declara (contrato DeclaracaoDeModulo). Os módulos de negócio
 * (CRM, financeiro...) entram aqui quando forem construídos, cada um com a sua área.
 */
import { conferirDeclaracaoDeModulo, type DeclaracaoDeModulo } from "@mago-os/contratos";

export const MODULOS_DO_NUCLEO: readonly DeclaracaoDeModulo[] = [
  {
    id: "pessoas",
    nome: "Pessoas da empresa",
    acoes: ["ver", "criar", "editar", "excluir"],
    temDadosSensiveis: true,
    area: null,
  },
  { id: "permissoes", nome: "Permissões", acoes: ["ver", "editar"], temDadosSensiveis: false, area: null },
  { id: "auditoria", nome: "Auditoria", acoes: ["ver"], temDadosSensiveis: true, area: null },
  // Segurança da empresa (exigir 2FA ou passkey de todos). Padrão: só o administrador.
  {
    id: "seguranca",
    nome: "Segurança da empresa",
    acoes: ["ver", "editar"],
    temDadosSensiveis: false,
    area: null,
  },
  // Tarefas (M2-01): o funcionário vê e edita as que é responsável ou criou; o gestor, também as da equipe.
  {
    id: "tarefas",
    nome: "Tarefas",
    // aprovar: destravar a tarefa pegada por outro (M2-02). Padrão: só o administrador.
    acoes: ["ver", "criar", "editar", "aprovar", "excluir"],
    temDadosSensiveis: false,
    area: null,
  },
  // Agentes (M2-03): todos veem (para escolher um como responsável); só o administrador cadastra e desliga.
  {
    id: "agentes",
    nome: "Agentes",
    acoes: ["ver", "criar", "editar", "excluir"],
    temDadosSensiveis: false,
    area: null,
  },
  // Espaços (M3-01): todos veem; só o administrador cria, edita e arquiva.
  {
    id: "espacos",
    nome: "Espaços",
    acoes: ["ver", "criar", "editar"],
    temDadosSensiveis: false,
    area: null,
  },
  // Projetos (M3-01): o administrador e o gestor veem todos; o funcionário, os que é membro. Criar é do
  // administrador e do gestor; editar (e arquivar), do diretor do projeto e do administrador; excluir, só o
  // administrador. "Meus" nos projetos: ver = sou membro; editar = sou o diretor.
  {
    id: "projetos",
    nome: "Projetos",
    acoes: ["ver", "criar", "editar", "excluir"],
    temDadosSensiveis: false,
    area: null,
  },
];

/** Catálogo de módulos. Recusa na subida uma declaração fora do contrato ou um id repetido. */
export function catalogoDeModulos(modulos: readonly DeclaracaoDeModulo[] = MODULOS_DO_NUCLEO) {
  const mapa = new Map<string, DeclaracaoDeModulo>();
  for (const modulo of modulos) {
    const r = conferirDeclaracaoDeModulo(modulo);
    if (!r.ok)
      throw new Error(
        `Módulo ${modulo.id} fora do contrato: ${r.problemas.map((p) => p.mensagem).join("; ")}`,
      );
    if (mapa.has(modulo.id)) throw new Error(`Módulo repetido: ${modulo.id}`);
    mapa.set(modulo.id, modulo);
  }
  return mapa;
}
