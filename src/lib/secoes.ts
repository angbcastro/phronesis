/**
 * As seções de um prompt: o recorte que a calibração e o editor de agente
 * usam. Puro — o navegador importa.
 *
 * A seção é a unidade porque é a unidade que os prompts deste sistema já usam:
 * uma linha em caixa alta, e o corpo dela até a linha seguinte em caixa alta.
 * O `redacao-1` emenda por ela, a tela da calibração mostra "o que a seção diz
 * hoje" por ela, e o editor de agente mostra por ela o que difere do git (onda 4
 * da interface).
 *
 * Mora aqui, e não em `redacao.ts`, porque aquele fala com modelo e o
 * navegador não pode importá-lo. Uma regex só, num módulo só: duas para a
 * mesma regra divergem no primeiro ajuste, e a que ninguém lembrar de acertar
 * passa a discordar em silêncio.
 */

/**
 * Um cabeçalho de seção: linha inteira em caixa alta, quatro caracteres ou
 * mais.
 */
const CABECALHO = /^[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÇ 0-9]{3,}$/;

export const ehCabecalho = (linha: string): boolean => CABECALHO.test(linha);

/** Os cabeçalhos de um prompt, na ordem em que aparecem. */
export function secoesDe(texto: string): string[] {
  return texto.split("\n").filter(ehCabecalho);
}

export interface Secao {
  /** O cabeçalho, sem espaço em volta. */
  nome: string;
  /** O corpo, do fim do cabeçalho até o cabeçalho seguinte (ou o fim). */
  corpo: string;
  /** Índices no texto original: `[inicio do cabeçalho, fim do corpo)`. */
  inicio: number;
  fim: number;
}

/**
 * O prompt fatiado em seções, com as fronteiras em índice de caractere.
 *
 * Trabalha sobre offsets e não sobre uma lista de linhas remontada, porque
 * remontar com `join("\n")` normalizaria `\r\n` e espaço no fim de linha — e
 * então "seção que eu não toquei volta byte a byte" deixaria de ser verdade
 * justamente no caso em que ninguém olharia.
 */
export function fatiar(texto: string): Secao[] {
  const linhas = texto.split("\n");
  const saida: Secao[] = [];

  let offset = 0;
  for (const linha of linhas) {
    if (ehCabecalho(linha)) {
      if (saida.length > 0) saida[saida.length - 1].fim = offset;
      saida.push({ nome: linha, corpo: "", inicio: offset, fim: texto.length });
    }
    offset += linha.length + 1; // +1 do "\n" que o split comeu
  }

  for (const s of saida) {
    s.corpo = texto.slice(s.inicio + s.nome.length, s.fim);
  }
  return saida;
}

/** O nome do que vem antes do primeiro cabeçalho, na diferença. */
export const INICIO_DO_PROMPT = "início";

/** Uma seção que difere entre o git e o texto de agora. */
export interface DiferencaDeSecao {
  secao: string;
  /** O corpo no git; `null` quando a seção só existe agora. */
  antes: string | null;
  /** O corpo agora; `null` quando a seção foi tirada. */
  depois: string | null;
}

/**
 * O que difere do git, seção por seção — o que o editor de agente mostra
 * abaixo do prompt, empilhado como a emenda da calibração.
 *
 * Só as que diferem, na ordem do texto de agora, e as tiradas no fim. O que
 * vem antes do primeiro cabeçalho conta como uma seção, `INICIO_DO_PROMPT`.
 * Compara cada corpo **sem o espaço das bordas** — a mesma régua do "salvar"
 * do editor, que ignora espaço em volta do prompt —, e seção com o mesmo
 * cabeçalho duas vezes conta pela ordem de aparição.
 */
export function diferencaPorSecao(base: string, atual: string): DiferencaDeSecao[] {
  const partes = (texto: string): Map<string, string> => {
    const secoes = fatiar(texto);
    const mapa = new Map<string, string>();
    const inicio = (secoes.length > 0 ? texto.slice(0, secoes[0].inicio) : texto).trim();
    if (inicio !== "") mapa.set(INICIO_DO_PROMPT, inicio);
    for (const s of secoes) {
      let nome = s.nome.trim();
      for (let n = 2; mapa.has(nome); n++) nome = `${s.nome.trim()} (${n})`;
      mapa.set(nome, s.corpo.trim());
    }
    return mapa;
  };

  const antes = partes(base);
  const depois = partes(atual);
  const ordem = [...depois.keys(), ...[...antes.keys()].filter((n) => !depois.has(n))];

  return ordem.flatMap((secao) => {
    const a = antes.get(secao) ?? null;
    const d = depois.get(secao) ?? null;
    return a === d ? [] : [{ secao, antes: a, depois: d }];
  });
}
