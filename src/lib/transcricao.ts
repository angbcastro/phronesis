/**
 * Concatenação dos blocos.
 *
 * Cada bloco é transcrito sozinho e volta com offsets relativos ao seu
 * próprio início. O offset absoluto na sessão é `relativo + 30 * i`
 * (aceite 6: clicar num trecho do minuto 9 toca o áudio no minuto 9).
 */
import type { BlocoAbsoluto, Palavra, Transcricao, TranscricaoBloco } from "./tipos";
import { DURACAO_CHUNK_S } from "./tipos";

export const offsetDoBloco = (i: number): number => i * DURACAO_CHUNK_S;

export function absolutizarPalavras(bloco: TranscricaoBloco): Palavra[] {
  const offset = offsetDoBloco(bloco.i);
  return bloco.palavras.map((p) => ({
    palavra: p.palavra,
    inicio: arredondar(p.inicio + offset),
    fim: arredondar(p.fim + offset),
  }));
}

const arredondar = (n: number) => Math.round(n * 1000) / 1000;

/** Junta o texto sem colar palavras nem duplicar espaço na emenda dos blocos. */
export function juntarTexto(blocos: TranscricaoBloco[]): string {
  return blocos
    .map((b) => b.texto.trim())
    .filter((t) => t.length > 0)
    .join(" ");
}

/**
 * Maior prefixo contíguo a partir do bloco 0. A transcrição parcial mostra
 * só isso: um buraco no meio faria o texto ser lido fora de ordem.
 */
export function prefixoContiguo<T extends { i: number }>(blocos: T[]): T[] {
  const porIndice = new Map(blocos.map((b) => [b.i, b]));
  const saida: T[] = [];
  for (let i = 0; porIndice.has(i); i++) saida.push(porIndice.get(i)!);
  return saida;
}

export function concatenar(sessao_id: string, blocos: TranscricaoBloco[]): Transcricao {
  const ordenados = [...blocos].sort((a, b) => a.i - b.i);

  const palavras: Palavra[] = [];
  const mapa: BlocoAbsoluto[] = [];

  for (const bloco of ordenados) {
    palavras.push(...absolutizarPalavras(bloco));
    mapa.push({ i: bloco.i, texto: bloco.texto.trim(), offset_s: offsetDoBloco(bloco.i) });
  }

  return { sessao_id, texto: juntarTexto(ordenados), palavras, blocos: mapa };
}
