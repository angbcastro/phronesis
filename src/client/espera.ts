"use client";

/**
 * Até quando vale continuar olhando uma sessão que ainda não fechou (18/09).
 *
 * Nasceu em `Processando.tsx`, e saiu de lá pelo mesmo motivo que
 * `localizarNoAudio` saiu da revisão (§4.5): **duas telas usam**. Desde a slice
 * 8.2 a revisão também fica esperando a proposta fechar, e ela não deve
 * arrastar o corredor inteiro para o seu bundle por causa de seis linhas puras.
 *
 * **Seis minutos, e o número é o da plataforma, não o do gosto.** O `/finalizar`
 * tem `maxDuration` de 300 s; passado esse tempo com folga, o que estava
 * trabalhando **provavelmente não está mais**, e insistir é olhar para uma tela
 * que ninguém vai atualizar. Chamar de travado antes disso seria pior que
 * esperar: eu reextrairia uma sessão que ainda estava viva, e pagaria duas vezes.
 */
export const TETO_DA_ESPERA_MS = 360_000;

/** Já passou do tempo em que ainda poderia haver alguém trabalhando? */
export function esperouDemais(desde: number, agora: number = Date.now()): boolean {
  return agora - desde >= TETO_DA_ESPERA_MS;
}
