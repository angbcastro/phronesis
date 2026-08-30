/**
 * Normalização de texto em português. Uma regra só, usada por dois lugares que
 * não podem divergir:
 *
 *   `offsets.ts`     casa o trecho do modelo com as palavras da transcrição
 *   `entidades.ts`   produz o `nome_normalizado`, que é chave única no banco
 *
 * Se as duas normalizações divergissem, "Rodozanco" acharia o áudio certo e
 * mesmo assim criaria um segundo nó no grafo. Por isso mora aqui, sozinha.
 *
 * Módulo puro: não fala com rede, banco nem modelo.
 */

/**
 * Minúsculas, sem acento, sem pontuação. NFD separa a letra do acento e a
 * faixa de combining marks tira o acento — "reunião" e "REUNIAO," viram a
 * mesma coisa.
 */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas de acento, soltas pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

/** Palavras normalizadas. Texto sem letra nenhuma vira `[]`, não `[""]`. */
export function tokenizar(s: string): string[] {
  const limpo = normalizar(s);
  return limpo === "" ? [] : limpo.split(/\s+/);
}
