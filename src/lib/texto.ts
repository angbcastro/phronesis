/**
 * Normalização de texto em português. Uma regra só, usada por dois lugares que
 * não podem divergir:
 *
 *   `offsets.ts`     casa o trecho do modelo com as palavras da transcrição
 *   `entidades.ts`   produz o `nome_normalizado`, que é chave única no banco
 *   `Revisao.tsx`    monta o payload do confirmar com as mesmas chaves
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

/** Nome normalizado: a chave única de `:Entidade` no grafo. */
export const normalizarNome = (nome: string): string => tokenizar(nome).join(" ");

/**
 * Palavras que o extrator devolve quando não sabe de quem está falando.
 *
 * Mora aqui porque a revisão (cliente) precisa saber quando ainda falta nomear,
 * e o confirmar (servidor) precisa recusar o que passar mesmo assim. Duas listas
 * divergiriam, e a trava valeria só na tela.
 *
 * `eu` fica de fora de propósito: é entidade legítima, decisão já tomada.
 */
const PRONOMES = new Set([
  "ela", "ele", "elas", "eles", "a gente", "nos", "voce", "voces",
  "isso", "isto", "aquilo", "esse", "essa", "aquele", "aquela",
  "alguem", "ninguem", "a pessoa", "essa pessoa",
  "essa menina", "esse menino", "esse cara", "essa mina",
]);

/** `true` quando o nome não é nome — a revisão vai perguntar quem é. */
export const ehPronome = (nome: string): boolean => PRONOMES.has(normalizarNome(nome));
