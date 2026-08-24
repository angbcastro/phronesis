"use client";

/**
 * Depósito local dos blocos (IndexedDB).
 *
 * Um bloco só sai daqui depois que o PUT no R2 confirma. É isso que faz
 * fechar a aba no meio da gravação não perder áudio.
 */

const DB = "phronesis";
const VERSAO = 1;
const LOJA_CHUNKS = "chunks";
const LOJA_ESTADO = "estado";

export interface ChunkLocal {
  chave: string; // `${sessao_id}/${i}`
  sessao_id: string;
  i: number;
  blob: Blob;
  criado_em: number;
}

export interface SessaoLocal {
  chave: "atual";
  sessao_id: string;
  iniciada_em: number;
}

let conexao: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (conexao) return conexao;
  conexao = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOJA_CHUNKS)) {
        const loja = db.createObjectStore(LOJA_CHUNKS, { keyPath: "chave" });
        loja.createIndex("por_sessao", "sessao_id");
      }
      if (!db.objectStoreNames.contains(LOJA_ESTADO)) {
        db.createObjectStore(LOJA_ESTADO, { keyPath: "chave" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return conexao;
}

function promessa<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loja(nome: string, modo: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await abrir();
  return db.transaction(nome, modo).objectStore(nome);
}

export const chaveLocal = (sessao_id: string, i: number) => `${sessao_id}/${i}`;

export async function salvarChunk(sessao_id: string, i: number, blob: Blob): Promise<ChunkLocal> {
  const registro: ChunkLocal = { chave: chaveLocal(sessao_id, i), sessao_id, i, blob, criado_em: Date.now() };
  await promessa((await loja(LOJA_CHUNKS, "readwrite")).put(registro));
  return registro;
}

/** Pendentes em ordem de gravação — a fila sobe na ordem em que foi falado. */
export async function chunksPendentes(): Promise<ChunkLocal[]> {
  const todos = await promessa((await loja(LOJA_CHUNKS, "readonly")).getAll() as IDBRequest<ChunkLocal[]>);
  return todos.sort((a, b) => a.criado_em - b.criado_em || a.i - b.i);
}

export async function removerChunk(chave: string): Promise<void> {
  await promessa((await loja(LOJA_CHUNKS, "readwrite")).delete(chave));
}

export async function guardarSessaoAtual(sessao_id: string): Promise<void> {
  const registro: SessaoLocal = { chave: "atual", sessao_id, iniciada_em: Date.now() };
  await promessa((await loja(LOJA_ESTADO, "readwrite")).put(registro));
}

export async function lerSessaoAtual(): Promise<SessaoLocal | null> {
  const r = await promessa(
    (await loja(LOJA_ESTADO, "readonly")).get("atual") as IDBRequest<SessaoLocal | undefined>,
  );
  return r ?? null;
}

export async function limparSessaoAtual(): Promise<void> {
  await promessa((await loja(LOJA_ESTADO, "readwrite")).delete("atual"));
}
