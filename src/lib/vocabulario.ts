/**
 * Vocabulário injetado como prompt inicial do STT.
 *
 * Metade do que se fala são nomes próprios que o Whisper não conhece.
 * Transcrição que precisa ser corrigida é transcrição que mata o sistema.
 *
 * Slice 1: lista escrita à mão em config/vocabulario.txt.
 * A partir da slice 3 ela passa a ser gerada das entidades do grafo.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Whisper corta o prompt em ~224 tokens; mantemos margem. */
const LIMITE_CARACTERES = 850;

export function termos(conteudo: string): string[] {
  return conteudo
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export function montarPrompt(lista: string[]): string {
  if (lista.length === 0) return "";
  let prompt = `Nomes próprios que aparecem nesta gravação: ${lista.join(", ")}.`;
  if (prompt.length > LIMITE_CARACTERES) prompt = prompt.slice(0, LIMITE_CARACTERES - 1) + ".";
  return prompt;
}

let cache: string | null = null;

export async function promptVocabulario(): Promise<string> {
  if (cache !== null) return cache;
  try {
    const conteudo = await readFile(join(process.cwd(), "config", "vocabulario.txt"), "utf8");
    cache = montarPrompt(termos(conteudo));
  } catch {
    cache = "";
  }
  return cache;
}
