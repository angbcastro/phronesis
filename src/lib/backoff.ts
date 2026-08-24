/** Backoff exponencial com teto e jitter, usado pela fila de upload. */

export const BASE_MS = 1_000;
export const TETO_MS = 30_000;

export function atrasoBackoff(tentativa: number, aleatorio: number = Math.random()): number {
  const expoente = Math.min(Math.max(tentativa, 0), 10);
  const base = Math.min(BASE_MS * 2 ** expoente, TETO_MS);
  return Math.round(base + base * 0.25 * aleatorio);
}
