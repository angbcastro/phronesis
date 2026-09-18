"use client";

/**
 * Fila de upload dos blocos.
 *
 * O bloco é gravado no IndexedDB antes de qualquer rede e só é apagado
 * depois que o PUT no R2 confirma. Rede caindo por um minuto atrasa a
 * subida e não perde bloco.
 *
 * O áudio vai direto do navegador para o R2 pela presigned URL — nenhuma
 * requisição de áudio passa por rota da Vercel.
 *
 * **Vários blocos por vez desde a slice 8.** Ela subia um de cada vez, e durante
 * a fala isso é irrelevante: chega um bloco a cada 30 s e a fila vive vazia. O
 * momento em que importa é um só — o instante do `parar`, quando pode haver uma
 * fila inteira represada por um túnel ruim e é ela que segura o `/finalizar`. É
 * o começo do número que esta fatia mede.
 */
import { atrasoBackoff } from "@/lib/backoff";
import { chunksPendentes, removerChunk, salvarChunk, type ChunkLocal } from "./deposito";

export interface EstadoFila {
  pendentes: number;
  ultimo_salvo_em: number | null;
  offline: boolean;
}

type Ouvinte = (e: EstadoFila) => void;

const ouvintes = new Set<Ouvinte>();
let estado: EstadoFila = { pendentes: 0, ultimo_salvo_em: null, offline: false };
let rodando = false;
const tentativas = new Map<string, number>();

function emitir(mudanca: Partial<EstadoFila>) {
  estado = { ...estado, ...mudanca };
  ouvintes.forEach((o) => o(estado));
}

export function observarFila(o: Ouvinte): () => void {
  ouvintes.add(o);
  o(estado);
  return () => ouvintes.delete(o);
}

export const estadoFila = (): EstadoFila => estado;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!r.ok) throw new Error(`${url} respondeu ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Um bloco: presigned, PUT, `/pronto`, e só então some do depósito local.
 *
 * A espera do retry mora aqui desde a slice 8, e não no laço: com três frentes,
 * dormir no laço faria o bloco que deu certo esperar pelo que falhou.
 */
async function subirUm(chunk: ChunkLocal): Promise<void> {
  try {
    await subirDeFato(chunk);
  } catch (e) {
    const tentativa = (tentativas.get(chunk.chave) ?? 0) + 1;
    tentativas.set(chunk.chave, tentativa);
    emitir({ offline: typeof navigator !== "undefined" && !navigator.onLine });
    console.warn(`[fila] bloco ${chunk.chave} tentativa ${tentativa}:`, e);
    await new Promise((r) => setTimeout(r, atrasoBackoff(tentativa - 1)));
    throw e;
  }
}

async function subirDeFato(chunk: ChunkLocal): Promise<void> {
  const base = `/api/sessoes/${chunk.sessao_id}/chunks/${chunk.i}`;

  const { url } = await json<{ url: string }>(`${base}/url`, { method: "POST" });

  const put = await fetch(url, {
    method: "PUT",
    body: chunk.blob,
    headers: { "Content-Type": "audio/webm" },
  });
  if (!put.ok) throw new Error(`PUT no R2 respondeu ${put.status}`);

  await json(`${base}/pronto`, { method: "POST" });

  // Só agora o bloco pode sumir do depósito local.
  await removerChunk(chunk.chave);
  tentativas.delete(chunk.chave);
  emitir({ ultimo_salvo_em: Date.now() });
}

/**
 * Quantos blocos sobem ao mesmo tempo.
 *
 * O mesmo número de `BLOCOS_SIMULTANEOS` da importação (`Importacao.tsx`), e
 * pela mesma razão pelo outro lado: mais frentes não custam nada ao R2 — o PUT
 * é presigned e não passa por function nenhuma —, mas cada `/pronto` dispara uma
 * chamada de STT, e trinta ao mesmo tempo são a rajada que a 4.8 existe para não
 * fazer. Durante a fala nunca há três blocos pendentes; no instante do `parar`,
 * com fila represada, três frentes esvaziam em um terço do tempo.
 */
const FRENTES = 3;

async function laco(): Promise<void> {
  if (rodando) return;
  rodando = true;

  try {
    for (;;) {
      const fila = await chunksPendentes();
      emitir({ pendentes: fila.length });
      if (fila.length === 0) return;

      // `allSettled` e não `all`: um bloco que falha faz a sua própria espera e
      // volta na rodada seguinte, sem cancelar os que estão subindo junto.
      const rodada = await Promise.allSettled(fila.slice(0, FRENTES).map(subirUm));
      if (rodada.every((r) => r.status === "fulfilled")) emitir({ offline: false });
    }
  } finally {
    rodando = false;
  }
}

/** Acorda a fila. Seguro chamar a qualquer momento. */
export function acordar(): void {
  void laco();
}

/** Enfileira um bloco recém-gravado. Persiste antes de tentar a rede. */
export async function enfileirar(sessao_id: string, i: number, blob: Blob): Promise<void> {
  await salvarChunk(sessao_id, i, blob);
  emitir({ pendentes: (await chunksPendentes()).length });
  acordar();
}

/**
 * De quanto em quanto tempo se reconfere se a fila esvaziou.
 *
 * Eram 500 ms, e é o primeiro dos três pollings entre "acabei de falar" e "a
 * revisão abriu" (§4.17). Aqui a conferência é no IndexedDB, não na rede: 150 ms
 * não custam requisição nenhuma, e o que eles cortam é meio segundo de espera no
 * exato instante em que eu estou olhando a tela.
 */
const INTERVALO_FILA_MS = 150;

/** Resolve quando não há mais bloco pendente — usado antes de finalizar. */
export async function aguardarFilaVazia(timeoutMs = 120_000): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const fila = await chunksPendentes();
    if (fila.length === 0) return true;
    if (Date.now() > limite) return false;
    acordar();
    await new Promise((r) => setTimeout(r, INTERVALO_FILA_MS));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", acordar);
}
