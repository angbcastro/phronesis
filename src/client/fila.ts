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

async function subirUm(chunk: ChunkLocal): Promise<void> {
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

async function laco(): Promise<void> {
  if (rodando) return;
  rodando = true;

  try {
    for (;;) {
      const fila = await chunksPendentes();
      emitir({ pendentes: fila.length });
      if (fila.length === 0) return;

      const chunk = fila[0];
      try {
        await subirUm(chunk);
        emitir({ offline: false });
      } catch (e) {
        const tentativa = (tentativas.get(chunk.chave) ?? 0) + 1;
        tentativas.set(chunk.chave, tentativa);
        emitir({ offline: typeof navigator !== "undefined" && !navigator.onLine });
        console.warn(`[fila] bloco ${chunk.chave} tentativa ${tentativa}:`, e);
        await new Promise((r) => setTimeout(r, atrasoBackoff(tentativa - 1)));
      }
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

/** Resolve quando não há mais bloco pendente — usado antes de finalizar. */
export async function aguardarFilaVazia(timeoutMs = 120_000): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const fila = await chunksPendentes();
    if (fila.length === 0) return true;
    if (Date.now() > limite) return false;
    acordar();
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", acordar);
}
