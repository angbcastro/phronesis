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

/**
 * O plural das telas: `1 item`, `3 itens`, `0 itens`.
 *
 * Eram parênteses — "item(ns)", "sessão(ões)", "sutil(is)" —, que é o jeito de
 * formulário falar, e não o de quem conta. As duas formas vêm inteiras, porque
 * o português não pluraliza por sufixo fixo.
 */
export const plural = (n: number, um: string, varios: string): string =>
  `${n} ${n === 1 ? um : varios}`;

/** As referências de um átomo por nome — o sujeito e as menções, na ordem. */
export interface NomesDoAtomo {
  sobre: string;
  menciona: string[];
}

/** O nome que não pode ser trocado no texto corrido sem estragar a frase. */
const intocavel = (nome: string): boolean => {
  const chave = normalizarNome(nome);
  return chave === "" || chave === "eu" || PRONOMES.has(chave);
};

/**
 * Os pares `antigo → novo` que uma troca de entidade produz num átomo.
 *
 * Só par **inequívoco**: o sujeito, que é um valor só, e nas menções apenas
 * quando saiu exatamente uma e entrou exatamente uma. Com duas saindo e duas
 * entrando não há como saber qual virou qual, e nome errado no texto é pior que
 * nome velho — o texto mentiria com a minha voz.
 */
function paresDeTroca(antes: NomesDoAtomo, depois: NomesDoAtomo): [string, string][] {
  const pares: [string, string][] = [];
  const chavesDepois = new Set([depois.sobre, ...depois.menciona].map(normalizarNome));
  const chavesAntes = new Set([antes.sobre, ...antes.menciona].map(normalizarNome));

  const sAntes = normalizarNome(antes.sobre);
  const sDepois = normalizarNome(depois.sobre);
  // O sujeito antigo que continua no átomo (virou menção) não saiu do texto.
  if (sAntes !== sDepois && !chavesDepois.has(sAntes)) pares.push([antes.sobre, depois.sobre]);

  const usados = new Set([sAntes, sDepois]);
  const sairam = antes.menciona.filter((m) => {
    const k = normalizarNome(m);
    return k !== "" && !usados.has(k) && !chavesDepois.has(k);
  });
  const entraram = depois.menciona.filter((m) => {
    const k = normalizarNome(m);
    return k !== "" && !usados.has(k) && !chavesAntes.has(k);
  });
  if (sairam.length === 1 && entraram.length === 1) pares.push([sairam[0], entraram[0]]);

  return pares.filter(([de, para]) => !intocavel(de) && !intocavel(para));
}

/** Troca toda ocorrência de `de` por `para`, sem caixa nem acento, palavra inteira. */
function trocarNome(texto: string, de: string, para: string): string {
  const alvo = tokenizar(de);
  if (alvo.length === 0) return texto;

  // Cada token normalizado com o trecho do texto original de onde saiu. Uma
  // palavra pode render mais de um token (pontuação no meio vira espaço), e
  // os dois apontam para a mesma palavra.
  const tokens: { t: string; inicio: number; fim: number }[] = [];
  for (const m of texto.matchAll(/[\p{L}\p{N}]+/gu)) {
    for (const t of tokenizar(m[0])) tokens.push({ t, inicio: m.index!, fim: m.index! + m[0].length });
  }

  let saida = "";
  let cursor = 0;
  for (let i = 0; i + alvo.length <= tokens.length; ) {
    if (alvo.every((t, k) => tokens[i + k].t === t)) {
      saida += texto.slice(cursor, tokens[i].inicio) + para.trim();
      cursor = tokens[i + alvo.length - 1].fim;
      i += alvo.length;
    } else i++;
  }
  return saida + texto.slice(cursor);
}

/**
 * O texto do átomo depois que a entidade dele mudou.
 *
 * O extrator escreve o nome gravado dentro do texto (`extracao-9`): se a
 * resolução pendurou "a Nic" na Nicolle Borsato, o texto diz "Nicolle Borsato",
 * e trocar a aresta na revisão deixaria o texto dizendo a pessoa errada. Esta
 * função troca o nome **antigo da entidade** pelo novo, e só ele: a grafia
 * falada ("Nic") serve igual para quem quer que seja, e fica.
 *
 * Mora aqui porque são dois lugares que não podem divergir: a revisão, que
 * mostra e manda o texto reescrito, e `correcoes.ts`, que mede contra ele o que
 * foi edição minha de verdade. Nome que não aparece inteiro no texto não muda
 * nada; `eu` e pronome nunca são trocados.
 */
export function reescreverNomes(texto: string, antes: NomesDoAtomo, depois: NomesDoAtomo): string {
  return paresDeTroca(antes, depois).reduce((t, [de, para]) => trocarNome(t, de, para), texto);
}
