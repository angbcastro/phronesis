/**
 * Layout do R2. Um lugar só monta chave — em toda rota, worker e teste.
 *
 *   sessoes/<id>/manifest.json
 *   sessoes/<id>/chunk_000.webm
 *   sessoes/<id>/chunk_000.json
 *   sessoes/<id>/transcricao.json
 */

export const prefixoSessao = (id: string) => `sessoes/${id}`;
export const chaveManifest = (id: string) => `${prefixoSessao(id)}/manifest.json`;
export const chaveTranscricao = (id: string) => `${prefixoSessao(id)}/transcricao.json`;

export function indiceChunk(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i > 999_999) {
    throw new Error(`Índice de bloco inválido: ${i}`);
  }
  return String(i).padStart(3, "0");
}

export const chaveChunkAudio = (id: string, i: number) =>
  `${prefixoSessao(id)}/chunk_${indiceChunk(i)}.webm`;

export const chaveChunkTranscricao = (id: string, i: number) =>
  `${prefixoSessao(id)}/chunk_${indiceChunk(i)}.json`;

/** Aceita só o formato que este sistema gera. Barra a travessia de caminho. */
export function idValido(id: string): boolean {
  return /^[0-9a-z]{8,40}$/.test(id);
}
