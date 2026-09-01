/**
 * Máquina de estados da sessão.
 *
 *   gravando → finalizando → transcrevendo → transcrito → extraindo → em_revisao → confirmada
 *                     ↓              ↓                          ↓
 *                    erro           erro                       erro
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

const PERMITIDAS: Record<StatusSessao, StatusSessao[]> = {
  gravando: ["gravando", "finalizando"],
  finalizando: ["finalizando", "transcrevendo", "erro"],
  transcrevendo: ["transcrevendo", "transcrito", "erro"],
  transcrito: ["transcrito", "extraindo"],
  extraindo: ["extraindo", "em_revisao", "erro"],
  em_revisao: ["em_revisao", "confirmada", "extraindo"], // reextrair é decisão da revisão
  confirmada: ["confirmada"],
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
 * Nada mais vai mudar sozinho: ou tem proposta esperando, ou acabou, ou falhou.
 * É onde a tela de leitura pode parar o polling — parar em `transcrito`, como
 * `completa` sugere, faria a tela nunca ver a extração terminar.
 */
export const terminouDeProcessar = (s: StatusSessao): boolean =>
  s === "em_revisao" || s === "confirmada" || s === "erro";
