/**
 * Máquina de estados da sessão.
 *
 *   gravando → finalizando → transcrevendo → transcrito
 *         ↓            ↓            ↓            ↓
 *    abandonada       erro ────────────────→ extraindo → em_revisao → confirmada
 *
 * `transcrito` deixou de ser terminal na slice 2: a extração dispara sozinha
 * e a sessão só termina quando eu confirmo a revisão. `erro` é a saída tanto
 * da transcrição quanto da extração — em ambos os casos o que já está no R2
 * fica intacto e o retry é manual.
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
  transcrito: ["transcrito", "extraindo"],
  extraindo: ["extraindo", "em_revisao", "erro"],
  em_revisao: ["em_revisao", "confirmada", "extraindo"], // reextrair é decisão da revisão
  confirmada: ["confirmada"],
  abandonada: ["abandonada", "gravando", "finalizando"], // retomar ou processar
  erro: ["erro", "finalizando", "transcrevendo", "extraindo"], // retry manual
};

export function podeIrPara(de: StatusSessao, para: StatusSessao): boolean {
  return PERMITIDAS[de].includes(para);
}

/** Estado terminal — o grafo já recebeu o que eu aprovei. */
export const estaConcluida = (s: StatusSessao): boolean => s === "confirmada";

/**
 * A transcrição está pronta e gravada. É o que a tela de leitura espera para
 * parar o polling — a extração continua sozinha, atrás dela.
 */
export const temTranscricao = (s: StatusSessao): boolean =>
  s === "transcrito" || s === "extraindo" || s === "em_revisao" || s === "confirmada";

/** Extraída e não confirmada: tem proposta esperando por mim. */
export const estaPendenteDeRevisao = (s: StatusSessao): boolean => s === "em_revisao";

/**
 * Sessão que o chip de recuperação deve oferecer para **retomar a gravação**.
 *
 * `em_revisao` ainda não entra: pela spec ela deveria aparecer na home, mas o
 * chip de hoje só sabe oferecer "retomar" — e retomar a gravação de uma sessão
 * que está esperando revisão é a coisa errada. Entra junto com a tela de
 * revisão, que é quem sabe o que oferecer.
 */
export const STATUS_ABERTOS: StatusSessao[] = ["gravando", "abandonada", "erro"];

export const estaAberta = (s: StatusSessao): boolean => STATUS_ABERTOS.includes(s);

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
