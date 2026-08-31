/**
 * Vocabulário injetado no STT como lista de termos.
 *
 * Metade do que se fala são nomes próprios que o modelo não conhece.
 * Transcrição que precisa ser corrigida é transcrição que mata o sistema.
 *
 * A lista de fato muda a grafia da saída — medido, ver `ARCHITECTURE.md` §4.4.
 * O **nome da opção** por onde ela viaja é por provedor e mora em
 * `modelos.ts` (`opcoesDeVocabulario`), não aqui.
 *
 * Slice 3: a lista é a **união** de `config/vocabulario.txt` com os nomes das
 * entidades do grafo. O arquivo vem primeiro e vence as vagas do teto: ele tem
 * coisa que não é entidade e nome que eu ainda não falei uma vez sequer — e
 * entidade só existe depois que eu falo. Ele deixa de ser a lista e vira o
 * override manual.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nomesParaVocabulario } from "./entidades";
import { ehPronome, normalizarNome } from "./texto";

/** Limites do `keyterm` da API de STT: 100 termos, 50 caracteres cada. */
export const MAX_TERMOS = 100;
export const MAX_CARACTERES = 50;

/** Quanto tempo a lista vale antes de perguntar ao grafo de novo. */
export const TTL_MS = 5 * 60_000;

export function termos(conteudo: string): string[] {
  return conteudo
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * Palavras que não ajudam como termo de STT, por mais que sejam entidades
 * legítimas no grafo.
 *
 * `eu` é uma `:Pessoa` como qualquer outra — decisão tomada — mas como keyterm
 * seria só uma palavra comuníssima do português empurrada para dentro do
 * modelo. O mesmo vale para o nome descritivo que virou nó ("meu pai") e para
 * qualquer entidade de uma palavra só que seja vocabulário corrente: ensinar o
 * STT a ouvir "casa" com mais força piora a transcrição inteira em troca de
 * nada.
 */
const COMUNS = new Set([
  "eu", "casa", "trabalho", "gente", "pessoa", "vida", "dia", "tempo", "coisa",
  "amor", "medo", "deus", "mae", "pai", "filho", "filha", "irmao", "irma",
  "amigo", "amiga", "chefe", "cliente", "empresa", "projeto", "reuniao",
]);

/**
 * Termo que vale a pena mandar. O ganho do vocabulário está em nome próprio
 * incomum; palavra que o modelo já escreve certo só ocupa uma das 100 vagas.
 */
export function termoUtil(termo: string): boolean {
  const chave = normalizarNome(termo);
  if (chave === "") return false;
  if (ehPronome(chave)) return false;
  // Só filtra palavra única: "Ana Paula" passa mesmo que "ana" fosse comum.
  return !(chave.split(" ").length === 1 && COMUNS.has(chave));
}

/** Corta a lista no que a API aceita, sem mandar termo truncado pela metade. */
export function keyterms(lista: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];

  for (const termo of lista) {
    if (termo.length > MAX_CARACTERES) continue;
    if (!termoUtil(termo)) continue;
    const chave = termo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(termo);
    if (saida.length === MAX_TERMOS) break;
  }
  return saida;
}

async function doArquivo(): Promise<string[]> {
  try {
    const conteudo = await readFile(join(process.cwd(), "config", "vocabulario.txt"), "utf8");
    return termos(conteudo);
  } catch {
    return [];
  }
}

/**
 * Os nomes do grafo, ou lista vazia se o grafo não responder.
 *
 * **Nunca propaga erro.** A instância Aura Free pausa sozinha e o hostname
 * deixa de resolver; se essa falha subisse, uma sessão inteira deixaria de ser
 * transcrita por causa de uma otimização de grafia. O vocabulário é melhoria,
 * não dependência do caminho do áudio.
 */
async function doGrafo(): Promise<string[]> {
  try {
    return await nomesParaVocabulario(MAX_TERMOS);
  } catch (e) {
    console.error("[vocabulario] grafo indisponível, seguindo só com o arquivo:", e);
    return [];
  }
}

let cache: { lista: string[]; em: number } | null = null;

/** Só para teste: a próxima chamada volta a perguntar. */
export function esquecerVocabulario(): void {
  cache = null;
}

/**
 * A lista final. Cache com TTL, não eterno: ela muda a cada confirmar, e sem
 * cache seria uma consulta ao Neo4j por bloco de 30 s. A defasagem aceita é o
 * TTL — um nome confirmado agora leva alguns minutos para chegar ao STT, o que
 * é irrelevante, porque ele já foi falado.
 */
export async function vocabulario(agora: number = Date.now()): Promise<string[]> {
  if (cache && agora - cache.em < TTL_MS) return cache.lista;

  const [arquivo, grafo] = await Promise.all([doArquivo(), doGrafo()]);
  const lista = keyterms([...arquivo, ...grafo]);

  cache = { lista, em: agora };
  return lista;
}
