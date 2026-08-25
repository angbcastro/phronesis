/**
 * Vocabulário injetado no STT como lista de termos (`keyterm`).
 *
 * Metade do que se fala são nomes próprios que o modelo não conhece.
 * Transcrição que precisa ser corrigida é transcrição que mata o sistema.
 *
 * Slice 1: lista escrita à mão em config/vocabulario.txt.
 * A partir da slice 3 ela passa a ser gerada das entidades do grafo.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Limites do `keyterm` da API de STT: 100 termos, 50 caracteres cada. */
export const MAX_TERMOS = 100;
export const MAX_CARACTERES = 50;

export function termos(conteudo: string): string[] {
  return conteudo
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Corta a lista no que a API aceita, sem mandar termo truncado pela metade. */
export function keyterms(lista: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];

  for (const termo of lista) {
    if (termo.length > MAX_CARACTERES) continue;
    const chave = termo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(termo);
    if (saida.length === MAX_TERMOS) break;
  }
  return saida;
}

let cache: string[] | null = null;

export async function vocabulario(): Promise<string[]> {
  if (cache !== null) return cache;
  try {
    const conteudo = await readFile(join(process.cwd(), "config", "vocabulario.txt"), "utf8");
    cache = keyterms(termos(conteudo));
  } catch {
    cache = [];
  }
  return cache;
}
