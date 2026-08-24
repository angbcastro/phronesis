/**
 * O manifest é a verdade sobre quais blocos existem e quais já foram
 * transcritos. Vive no R2 (regra 2). Toda escrita é read-modify-write
 * condicional por etag: dois `/pronto` simultâneos não se sobrescrevem.
 */
import { chaveManifest } from "./chaves";
import type { ChunkManifest, Manifest } from "./tipos";
import { DURACAO_CHUNK_S } from "./tipos";
import { ConflitoR2Error, getJson, putJson } from "./r2";

// ---------- puro ----------

export function manifestVazio(sessao_id: string): Manifest {
  return { sessao_id, chunks: [], finalizado: false };
}

function ordenado(chunks: ChunkManifest[]): ChunkManifest[] {
  return [...chunks].sort((a, b) => a.i - b.i);
}

/**
 * Registra um bloco subido. Idempotente: reenviar o mesmo bloco não
 * duplica a entrada nem reabre um bloco já transcrito (aceite 9).
 */
export function registrarChunk(
  m: Manifest,
  entrada: { i: number; bytes: number; subido_em: string },
): Manifest {
  const existente = m.chunks.find((c) => c.i === entrada.i);
  if (existente) {
    // Só atualiza o tamanho; `transcrito` e `subido_em` são preservados.
    if (existente.bytes === entrada.bytes) return m;
    return {
      ...m,
      chunks: ordenado(
        m.chunks.map((c) => (c.i === entrada.i ? { ...c, bytes: entrada.bytes } : c)),
      ),
    };
  }
  return {
    ...m,
    chunks: ordenado([...m.chunks, { ...entrada, transcrito: false }]),
  };
}

export function marcarTranscrito(m: Manifest, i: number): Manifest {
  if (!m.chunks.some((c) => c.i === i && !c.transcrito)) return m;
  return { ...m, chunks: m.chunks.map((c) => (c.i === i ? { ...c, transcrito: true } : c)) };
}

export function marcarFinalizado(m: Manifest): Manifest {
  return m.finalizado ? m : { ...m, finalizado: true };
}

export const pendentes = (m: Manifest): ChunkManifest[] => m.chunks.filter((c) => !c.transcrito);

export const tudoTranscrito = (m: Manifest): boolean => pendentes(m).length === 0;

/** Próximo índice a gravar. Retomar sessão continua a numeração (aceite 3). */
export function proximoIndice(m: Manifest): number {
  return m.chunks.reduce((max, c) => Math.max(max, c.i + 1), 0);
}

/** Estimativa de duração pelos blocos existentes — serve ao chip de recuperação. */
export function duracaoEstimadaS(m: Manifest): number {
  return m.chunks.length * DURACAO_CHUNK_S;
}

export const bytesTotais = (m: Manifest): number =>
  m.chunks.reduce((soma, c) => soma + c.bytes, 0);

// ---------- com R2 ----------

export async function carregarManifest(sessao_id: string): Promise<Manifest> {
  const o = await getJson<Manifest>(chaveManifest(sessao_id));
  return o?.valor ?? manifestVazio(sessao_id);
}

const TENTATIVAS_MANIFEST = 6;

/**
 * Aplica `mutador` ao manifest e grava condicionalmente. Em conflito
 * (outro `/pronto` gravou antes), relê e reaplica — o mutador precisa ser
 * puro e idempotente.
 */
export async function atualizarManifest(
  sessao_id: string,
  mutador: (m: Manifest) => Manifest,
): Promise<Manifest> {
  const key = chaveManifest(sessao_id);

  for (let tentativa = 0; tentativa < TENTATIVAS_MANIFEST; tentativa++) {
    const atual = await getJson<Manifest>(key);
    const base = atual?.valor ?? manifestVazio(sessao_id);
    const novo = mutador(base);

    if (novo === base && atual) return base; // nada mudou

    try {
      await putJson(key, novo, atual?.etag ? { ifMatch: atual.etag } : { ifNoneMatch: "*" });
      return novo;
    } catch (e) {
      if (!(e instanceof ConflitoR2Error)) throw e;
      await new Promise((r) => setTimeout(r, 40 * 2 ** tentativa + Math.random() * 40));
    }
  }
  throw new Error(`Não consegui gravar o manifest de ${sessao_id} após ${TENTATIVAS_MANIFEST} tentativas`);
}
