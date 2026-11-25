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
  // Dados da empresa (M3-11): todos veem; muda quem tem "editar" (padrão: o administrador). Sensível: o CPF.
  { id: "empresa", nome: "Dados da empresa", acoes: ["ver", "editar"], temDadosSensiveis: true, area: null },
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
  // Contas de IA (M4-01): as chaves dos provedores de IA da empresa. Padrão: só o administrador (ninguém lê a chave).
  {
    id: "contas_de_ia",
    nome: "Contas de IA",
    acoes: ["ver", "criar", "editar", "excluir"],
    temDadosSensiveis: true,
    area: null,
  },
  // Instruções e skills dos agentes (M4-05): todos veem; editar as camadas da empresa e dos agentes, criar e
  // atribuir skills e publicá-las (aprovar) é do administrador por padrão.
  {
    id: "instrucoes",
    nome: "Instruções e skills",
    acoes: ["ver", "criar", "editar", "aprovar"],
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
  // Agenda (M5-07, decisão 0041): todos criam; o alcance de "ver" diz quem vê o evento inteiro (o administrador todos,
  // o gestor os da equipe, os outros os em que estão); editar e cancelar os dos outros, só o administrador.
  {
    id: "agenda",
    nome: "Agenda",
    acoes: ["ver", "criar", "editar"],
    temDadosSensiveis: false,
    area: null,
  },
  // Rotinas (M5-05, decisão 0039): todos criam as próprias; o administrador vê, desliga e apaga todas; o gestor vê as
  // da equipe. Só o dono edita, liga e roda (conferido nas rotas).
  {
    id: "rotinas",
    nome: "Rotinas",
    acoes: ["ver", "criar", "editar", "excluir"],
    temDadosSensiveis: false,
    area: null,
  },
  // Contatos (M7-01, decisão 0045): pessoas e organizações de fora. O administrador e o gestor veem e editam todos; o
  // funcionário, os seus (responsável, cadastrou ou ligado a um projeto de que é membro). aprovar: juntar (padrão:
  // administrador e gestor). excluir: apagar, só o administrador.
  {
    id: "contatos",
    nome: "Contatos",
    acoes: ["ver", "criar", "editar", "aprovar", "excluir"],
    temDadosSensiveis: false,
    area: null,
  },
  // API pública (M7-02, decisão 0047): as chaves de API da empresa. Padrão: só o administrador vê, cria, troca e revoga.
  { id: "api", nome: "API pública", acoes: ["ver", "criar", "editar"], temDadosSensiveis: false, area: null },
  // Projetos (M3-01): o administrador e o gestor veem todos; o funcionário, os que é membro. Criar e editar (e
  // arquivar) são do administrador e do gestor, e o diretor edita o próprio projeto; excluir, só o administrador.
  // "Meus" nos projetos: ver = sou membro; editar = sou o diretor.
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
