/**
 * O manifest é a verdade sobre quais blocos existem e quais já foram
 * transcritos. Vive no R2 (regra 2). Toda escrita é read-modify-write
 * condicional por etag: dois `/pronto` simultâneos não se sobrescrevem.
 */
import { EXT_GRAVACAO } from "./audio";
import { chaveManifest } from "./chaves";
import type { ChunkManifest, Manifest } from "./tipos";
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
  entrada: { i: number; bytes: number; subido_em: string; ext?: string },
): Manifest {
  const existente = m.chunks.find((c) => c.i === entrada.i);
  if (existente) {
    // Só atualiza o tamanho; `transcrito`, `subido_em` e `ext` são
    // preservados — o reenvio pode vir sem a extensão, e esquecê-la
    // deixaria o pipeline procurando o áudio na chave errada.
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

/**
 * Onde está o áudio deste bloco. Manifest sem o campo é de gravação, de
 * antes da importação existir — o padrão preserva essas sessões.
 */
export function extensaoDoChunk(m: Manifest, i: number): string {
  return m.chunks.find((c) => c.i === i)?.ext ?? EXT_GRAVACAO;
}

export function marcarTranscrito(m: Manifest, i: number): Manifest {
  if (!m.chunks.some((c) => c.i === i && !c.transcrito)) return m;
  return { ...m, chunks: m.chunks.map((c) => (c.i === i ? { ...c, transcrito: true } : c)) };
}

export const pendentes = (m: Manifest): ChunkManifest[] => m.chunks.filter((c) => !c.transcrito);

export const tudoTranscrito = (m: Manifest): boolean => pendentes(m).length === 0;

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
