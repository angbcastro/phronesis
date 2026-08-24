/**
 * Máquina de estados da sessão (slice 1).
 *
 *   gravando → finalizando → transcrevendo → transcrito
 *         ↓            ↓
 *    abandonada       erro
 *
 * As transições são idempotentes: chamar `finalizar` duas vezes não
 * reprocessa nem volta atrás de um estado já concluído (aceite 9).
 */
import type { StatusSessao } from "./tipos";
import { ABANDONO_MIN, DURACAO_CHUNK_S } from "./tipos";

const PERMITIDAS: Record<StatusSessao, StatusSessao[]> = {
  gravando: ["gravando", "finalizando", "abandonada"],
  finalizando: ["finalizando", "transcrevendo", "erro"],
  transcrevendo: ["transcrevendo", "transcrito", "erro"],
  transcrito: ["transcrito"],
  abandonada: ["abandonada", "gravando", "finalizando"], // retomar ou processar
  erro: ["erro", "finalizando", "transcrevendo"], // retry manual
};

export function podeIrPara(de: StatusSessao, para: StatusSessao): boolean {
  return PERMITIDAS[de].includes(para);
}

/** Estado terminal — nada mais a processar. */
export const estaConcluida = (s: StatusSessao): boolean => s === "transcrito";

/** Sessão que o chip de recuperação deve oferecer. */
export const estaAberta = (s: StatusSessao): boolean =>
  s === "gravando" || s === "abandonada" || s === "erro";

/** Sem bloco novo há mais de 10 min → abandonada. */
export function foiAbandonada(
  status: StatusSessao,
  ultimoChunkEm: string | null,
  agora: Date = new Date(),
): boolean {
  if (status !== "gravando") return false;
  if (!ultimoChunkEm) return false;
  const minutos = (agora.getTime() - new Date(ultimoChunkEm).getTime()) / 60_000;
  return minutos > ABANDONO_MIN;
}

/** Duração aproximada pela contagem de blocos, para o chip da home. */
export const duracaoPorChunks = (n: number): number => n * DURACAO_CHUNK_S;
