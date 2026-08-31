/**
 * Layout do R2. Um lugar só monta chave — em toda rota, worker e teste.
 *
 *   sessoes/<id>/manifest.json
 *   sessoes/<id>/chunk_000.webm   (gravado no navegador)
 *   sessoes/<id>/chunk_000.opus   (arquivo importado — a extensão é a de origem)
 *   sessoes/<id>/chunk_000.json
 *   sessoes/<id>/transcricao.json
 *   sessoes/<id>/extracao.json
 */
import { EXT_GRAVACAO, extensaoAceita } from "./audio";

export const prefixoSessao = (id: string) => `sessoes/${id}`;
export const chaveManifest = (id: string) => `${prefixoSessao(id)}/manifest.json`;
export const chaveTranscricao = (id: string) => `${prefixoSessao(id)}/transcricao.json`;

/**
 * A proposta de extração. A existência deste objeto é a trava de idempotência
 * da extração: se ele está lá, não se chama o modelo de novo nem se sobrescreve
 * proposta que já pode ter sido revisada.
 */
export const chaveExtracao = (id: string) => `${prefixoSessao(id)}/extracao.json`;

export function indiceChunk(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i > 999_999) {
    throw new Error(`Índice de bloco inválido: ${i}`);
  }
  return String(i).padStart(3, "0");
}

/**
 * A extensão vira caminho no R2, então é validada aqui e não só na rota:
 * este é o único lugar que monta a chave, e quem confia no chamador
 * escreve fora do prefixo da sessão mais cedo ou mais tarde.
 */
export const chaveChunkAudio = (id: string, i: number, ext: string = EXT_GRAVACAO) => {
  if (!extensaoAceita(ext)) throw new Error(`Extensão de áudio inválida: ${ext}`);
  return `${prefixoSessao(id)}/chunk_${indiceChunk(i)}.${ext}`;
};

export const chaveChunkTranscricao = (id: string, i: number) =>
  `${prefixoSessao(id)}/chunk_${indiceChunk(i)}.json`;

/** Aceita só o formato que este sistema gera. Barra a travessia de caminho. */
export function idValido(id: string): boolean {
  return /^[0-9a-z]{8,40}$/.test(id);
}
