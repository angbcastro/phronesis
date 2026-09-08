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

const TENTATIVAS_MANIFEST = 10;
const BASE_MS_MANIFEST = 40;
const TETO_MS_MANIFEST = 2_000;

/**
 * Aplica `mutador` ao manifest e grava condicionalmente. Em conflito
 * (outro `/pronto` gravou antes), relê e reaplica — o mutador precisa ser
 * puro e idempotente.
 *
 * **Dez tentativas, não seis** (medido na importação, slice 4.10): um
 * bloco cujo STT tropeça no rate limit do Gateway fica preso em
 * `comEsperaDeLimite` por até 60 s (`limite.ts`) antes de `marcarTranscrito`
 * gravar aqui. Quando vários blocos tropeçam juntos — comum na importação,
 * que sobe blocos bem mais depressa que a gravação ao vivo —, as esperas
 * terminam perto umas das outras e o `marcarTranscrito` de todos colide com
 * o `registrarChunk` de blocos novos chegando. Seis tentativas com teto de
 * ~1,3 s por espera não sobrevivem a essa rajada; o manifest fica sem gravar
 * e a rota `/pronto` sobe o erro cru. O teto de 2 s por tentativa evita que
 * dez tentativas virem uma espera visível de dezenas de segundos.
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
      const espera = Math.min(BASE_MS_MANIFEST * 2 ** tentativa, TETO_MS_MANIFEST);
      await new Promise((r) => setTimeout(r, espera + Math.random() * 40));
    }
  }
  throw new Error(`Não consegui gravar o manifest de ${sessao_id} após ${TENTATIVAS_MANIFEST} tentativas`);
}
