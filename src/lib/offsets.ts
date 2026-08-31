/**
 * Do trecho que o modelo devolveu para o segundo do áudio.
 *
 * O LLM **não** produz timestamp. Ele devolve o pedaço de texto que sustenta a
 * afirmação, e o casamento com as palavras da transcrição acontece aqui, em
 * código. Timestamp inventado por modelo é procedência falsa — pior que
 * procedência nenhuma, porque parece confiável e ninguém confere.
 *
 * Três resultados possíveis, e o átomo registra qual foi (`Ancora`):
 *
 *   exata       os tokens do trecho aparecem em sequência na transcrição
 *   aproximada  não em sequência, mas uma janela do mesmo tamanho tem a maior
 *               parte deles — o modelo corrigiu a gramática ou comeu um "né"
 *   nenhuma     o trecho não está lá. Não inventamos offset: o átomo vai para a
 *               revisão sem player, e é o primeiro que você deve olhar com
 *               desconfiança
 *
 * Módulo puro: não fala com rede nem com modelo.
 */
import { tokenizar } from "./texto";
import type { Ancora, Palavra } from "./tipos";

/** Fração dos tokens do trecho que uma janela precisa ter para valer. */
export const LIMIAR_APROXIMADO = 0.6;

export type Trecho =
  | { ancora: "exata" | "aproximada"; inicio_s: number; fim_s: number }
  | { ancora: "nenhuma"; inicio_s: null; fim_s: null };

const SEM_ANCORA: Trecho = { ancora: "nenhuma", inicio_s: null, fim_s: null };

interface TokenIndexado {
  token: string;
  /** Índice em `palavras[]` de onde este token veio. */
  palavra: number;
}

/**
 * Um token por palavra do texto, cada um apontando para a entrada de
 * `palavras[]` que o produziu.
 *
 * Na granularidade `segmento` uma entrada pode conter várias palavras, então o
 * mapa não é 1:1 — e é justamente por isso que ele existe. O offset devolvido é
 * o da entrada inteira: a precisão é a que o provedor deu, nem mais nem menos.
 */
export function indexar(palavras: Palavra[]): TokenIndexado[] {
  const saida: TokenIndexado[] = [];
  palavras.forEach((p, i) => {
    for (const token of tokenizar(p.palavra)) saida.push({ token, palavra: i });
  });
  return saida;
}

/**
 * Primeira ocorrência contígua de `alvo` em `tokens`, procurando a partir de
 * `de` e dando a volta. A volta importa: o modelo não devolve os átomos
 * necessariamente na ordem em que foram ditos.
 */
export function acharExato(tokens: string[], alvo: string[], de = 0): number {
  if (alvo.length === 0 || alvo.length > tokens.length) return -1;

  const ultimo = tokens.length - alvo.length;
  const bate = (inicio: number) => alvo.every((t, k) => tokens[inicio + k] === t);

  for (let i = Math.max(0, Math.min(de, ultimo)); i <= ultimo; i++) if (bate(i)) return i;
  for (let i = 0; i < Math.min(de, ultimo + 1); i++) if (bate(i)) return i;
  return -1;
}

interface Janela {
  inicio: number;
  /** Quantos tokens do alvo a janela contém, contando repetição. */
  comuns: number;
}

/**
 * Melhor janela do tamanho do alvo, por interseção de multiconjunto. Janela
 * deslizante com contadores: percorre a transcrição uma vez só.
 */
export function melhorJanela(tokens: string[], alvo: string[]): Janela | null {
  const largura = Math.min(alvo.length, tokens.length);
  if (largura === 0) return null;

  const noAlvo = new Map<string, number>();
  for (const t of alvo) noAlvo.set(t, (noAlvo.get(t) ?? 0) + 1);

  const naJanela = new Map<string, number>();
  let comuns = 0;

  const entra = (t: string) => {
    const n = (naJanela.get(t) ?? 0) + 1;
    naJanela.set(t, n);
    if (n <= (noAlvo.get(t) ?? 0)) comuns++;
  };
  const sai = (t: string) => {
    const n = naJanela.get(t) ?? 0;
    if (n <= (noAlvo.get(t) ?? 0)) comuns--;
    naJanela.set(t, n - 1);
  };

  for (let i = 0; i < largura; i++) entra(tokens[i]);
  let melhor: Janela = { inicio: 0, comuns };

  for (let i = largura; i < tokens.length; i++) {
    sai(tokens[i - largura]);
    entra(tokens[i]);
    if (comuns > melhor.comuns) melhor = { inicio: i - largura + 1, comuns };
  }
  return melhor;
}

/**
 * Localizador com cursor. Os átomos de uma sessão são procurados em sequência,
 * e cada acerto empurra o cursor — sem isso, "eu acho que" casaria sempre com a
 * primeira vez que a frase aparece, e todo átomo de uma sessão de 15 min
 * apontaria para o mesmo lugar do áudio.
 *
 * Cursor só anda quando acha. Trecho não encontrado não desalinha o resto.
 *
 * `localizar.semAvancar` existe por causa do átomo que junta momentos distintos
 * da sessão: o segundo trecho dele pode estar lá na frente, e o átomo seguinte
 * volta para trás. Quem chama avança o cursor no primeiro trecho de cada átomo
 * e usa `semAvancar` nos demais — assim a ordem narrativa continua guiando a
 * busca. `acharExato` dá a volta na transcrição, então trecho atrás do cursor
 * continua sendo encontrado de qualquer forma.
 */
export function criarLocalizador(palavras: Palavra[]) {
  const indexados = indexar(palavras);
  const tokens = indexados.map((t) => t.token);
  let cursor = 0;

  const segundos = (inicio: number, fim: number, ancora: Exclude<Ancora, "nenhuma">): Trecho => {
    const primeira = palavras[indexados[inicio].palavra];
    const ultima = palavras[indexados[fim].palavra];
    cursor = fim + 1;
    return {
      ancora,
      inicio_s: arredondar(primeira.inicio),
      fim_s: arredondar(ultima.fim),
    };
  };

  function localizar(trecho: string, avancar = true): Trecho {
    const cursorAntes = cursor;
    const achado = procurar(trecho);
    if (!avancar) cursor = cursorAntes;
    return achado;
  }

  localizar.semAvancar = (trecho: string): Trecho => localizar(trecho, false);

  return localizar;

  function procurar(trecho: string): Trecho {
    const alvo = tokenizar(trecho);
    if (alvo.length === 0 || tokens.length === 0) return SEM_ANCORA;

    const exato = acharExato(tokens, alvo, cursor);
    if (exato >= 0) return segundos(exato, exato + alvo.length - 1, "exata");

    // Daqui para baixo é aproximação: procura primeiro adiante do cursor, que é
    // onde o próximo átomo deve estar, e só depois na sessão inteira.
    const adiante = melhorJanela(tokens.slice(cursor), alvo);
    const escolhida =
      adiante && adiante.comuns / alvo.length >= LIMIAR_APROXIMADO
        ? { inicio: adiante.inicio + cursor, comuns: adiante.comuns }
        : melhorJanela(tokens, alvo);

    if (!escolhida || escolhida.comuns / alvo.length < LIMIAR_APROXIMADO) return SEM_ANCORA;

    // A janela pode ter sido cortada pelo fim da transcrição — nunca passar dela.
    const fim = Math.min(escolhida.inicio + alvo.length - 1, tokens.length - 1);
    return segundos(escolhida.inicio, fim, "aproximada");
  }
}

const arredondar = (n: number) => Math.round(n * 1000) / 1000;
