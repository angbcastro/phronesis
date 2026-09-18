/**
 * O RAG por bloco: quem o grafo acha que este trecho cita (slice 4.9).
 *
 * **É a inversão que a 4.9 fez.** Até a 4.8 o prompt da extração não sabia que
 * entidades existem no grafo, e era de propósito (§4.6). O argumento que
 * derrubou a decisão é que o problema **é** do extrator: quem escreve o texto do
 * átomo é ele, e é no texto que o nome errado se fixa — inclusive dentro do
 * vetor, que sai só de `a.texto`. Medido em 04/09: um terço das 21 correções das
 * 5 primeiras sessões era conserto de grafia de nome próprio que o STT errou.
 *
 * Este módulo não entrega o catálogo inteiro ao extrator. Entrega os até
 * `TETO_DO_DOSSIE` nós que o trecho **parece** citar, escolhidos por busca. Com
 * um grafo pequeno os dois são a mesma coisa; a diferença aparece quando ele
 * cresce, e o desenho tem de estar pronto antes disso.
 *
 * Cinco camadas aditivas, e a segunda é a que faz o caso "giam" funcionar:
 *
 *   exato      n-grama do bloco = uma chave do catálogo (alias inclusive)
 *   prefixo    token de ≥4 letras que começa uma palavra de ≥6 de uma chave
 *   parecido   `proximidade()` de `duplicatas.ts` sobre os mesmos n-gramas
 *   perfil     `candidatosPorPerfil` com o texto do bloco
 *   vizinhos   `candidatosPorVizinhos`, voto por `:SOBRE`/`:MENCIONA`
 *
 * As três primeiras são **puras** — `candidatasPorGrafia`, testável sem rede,
 * mesma divisão que `duplicatas.ts` já tem. As duas últimas reusam
 * `candidatosSemanticos` de `entidades.ts` sem alterá-lo: ele já aceita texto
 * arbitrário e já engole a própria falha devolvendo lista vazia.
 *
 * **Nada aqui pode derrubar uma gravação.** Sem `candidatas_NNN.json` o dossiê
 * fica menor, e dossiê vazio faz o extrator se comportar exatamente como na 4.8.
 * É a regra de precedência da 4.5: nada no caminho do vetor impede uma gravação.
 *
 * O grafo é **lido** e nunca escrito (regra 5).
 */
import { chaveChunkCandidatas, chaveChunkTranscricao } from "./chaves";
import { proximidade } from "./duplicatas";
import { acharPorChave, candidatosSemanticos, listarEntidades } from "./entidades";
import type { EntidadeDoGrafo } from "./entidades";
import { getJson, putJson } from "./r2";
import { mencoesDe, sobreDe } from "./referencias";
import { ALCANCE, PISO_PERFIL, PISO_VIZINHOS } from "./resolucao";
import { ehPronome, normalizarNome, tokenizar } from "./texto";
import type { AtomoProposto, TranscricaoBloco } from "./tipos";

/**
 * Quantas candidatas um bloco de 30 s guarda.
 *
 * Teto e não lista inteira porque o arquivo é cache: o que ele custa a mais em
 * bytes, custa também em prompt lá na frente, e a camada `parecido` sempre acha
 * alguém quando o grafo cresce.
 */
export const TETO_POR_BLOCO = 12;

/**
 * Quantas candidatas a janela mostra ao extrator.
 *
 * Com um grafo pequeno isto significa na prática "o catálogo inteiro entra", e
 * está certo: o RAG só começa a **selecionar** quando o grafo passa de 30
 * entidades. O número existe para o dia em que ele passar.
 */
export const TETO_DO_DOSSIE = 30;

/**
 * Os dois pisos da camada `prefixo`, e eles são **heurística sem medição**: os
 * números saíram de raciocínio, não de dado (§14). Quem os ajusta sou eu,
 * olhando a revisão, sessão real por sessão real.
 *
 * `MIN_TOKEN` vale para todo n-grama de um token só, nas três camadas de string:
 * palavra curta demais casa com qualquer coisa. `MIN_ALVO_PREFIXO` é da palavra
 * **alcançada** — sem ele, um prefixo de quatro letras puxaria nó por um pedaço
 * de nome que não distingue ninguém.
 */
export const MIN_TOKEN = 4;
export const MIN_ALVO_PREFIXO = 6;

/** Até quantos tokens um n-grama junta. "giampaolo lepore" precisa de 2. */
export const MAX_NGRAMA = 3;

/**
 * De onde a candidata veio, da mais forte para a mais fraca.
 *
 * `ja_nesta_sessao` vai na frente de todas: é o sinal mais forte que existe
 * dentro de uma sessão, e é o análogo incremental do "procure o nome na
 * transcrição INTEIRA" que o prompt base já manda fazer. Ela não sai de bloco
 * nenhum — nasce no dossiê, das janelas anteriores.
 */
export const CAMADAS_DO_DOSSIE = [
  "ja_nesta_sessao",
  "exato",
  "prefixo",
  "parecido",
  "vizinhos",
  "perfil",
] as const;

export type CamadaDossie = (typeof CAMADAS_DO_DOSSIE)[number];

const forca = (c: CamadaDossie): number => CAMADAS_DO_DOSSIE.indexOf(c);

/**
 * Uma candidata como o arquivo do bloco a guarda: a chave, a camada e um número
 * que só ordena.
 *
 * **Só a chave, e não o nó inteiro.** O arquivo é cache de uma busca; guardar o
 * nome, o tipo e o perfil junto faria dele uma foto do grafo que envelhece
 * sozinha. Quem resolve chave → nó é o dossiê, com o catálogo da hora.
 */
export interface Candidata {
  /** `nome_normalizado` do nó, já atravessando alias. */
  chave: string;
  camada: CamadaDossie;
  /** 0..1 — ordena dentro da camada, não decide nada. */
  score: number;
}

/** `sessoes/<id>/candidatas_NNN.json`. */
export interface CandidatasDoBloco {
  sessao_id: string;
  i: number;
  candidatas: Candidata[];
  /**
   * A camada semântica trouxe alguma coisa?
   *
   * `false` quer dizer duas coisas que este módulo não consegue separar: nada
   * passou do piso, ou a chamada caiu (rate limit do Gateway, índice ausente) —
   * `candidatosSemanticos` engole a própria falha e devolve lista vazia nos
   * dois casos. Sem este campo o arquivo sairia **degradado e cacheado como
   * completo**, e um limite de 75 s no meio da gravação apagaria a camada
   * semântica da sessão inteira em silêncio.
   *
   * O catch-up do `/finalizar` refaz uma vez os que saíram `false`; distinguir
   * as duas causas exigiria mexer em `candidatosSemanticos`, e refazer um bloco
   * custa uma chamada de embedding.
   */
  semantico: boolean;
  /** Já refeito uma vez pelo catch-up. É o que impede refazer a cada passada. */
  refeito?: boolean;
  criado_em: string;
}

// ─────────────────────────────── puro ───────────────────────────────

/**
 * Os n-gramas de 1 a `MAX_NGRAMA` tokens que valem ser procurados.
 *
 * A guarda contra falso positivo mora aqui: n-grama de **um** token exige
 * `MIN_TOKEN` letras e não ser pronome (`texto.ts`). "ela" e "isso" aparecem em
 * toda sessão e não são nome de ninguém.
 */
export function ngramas(tokens: readonly string[]): string[] {
  const saida = new Set<string>();

  for (let n = 1; n <= MAX_NGRAMA; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const grama = tokens.slice(i, i + n).join(" ");
      if (n === 1 && grama.length < MIN_TOKEN) continue;
      if (ehPronome(grama)) continue;
      saida.add(grama);
    }
  }
  return [...saida];
}

/** Ordena por camada, depois por score. A chave desempata, para não dançar. */
const porForca = (a: Candidata, b: Candidata): number =>
  forca(a.camada) - forca(b.camada) || b.score - a.score || a.chave.localeCompare(b.chave);

/**
 * A união das camadas, sem repetição: o mesmo nó achado por duas entra uma vez
 * só, pela **mais forte**, e leva o melhor score que tiver naquela camada.
 *
 * Mesma regra de `unir()` em `resolucao.ts`, e pelo mesmo motivo: camada é
 * procedência, não peso — o que a lista precisa dizer é *por que* aquele nó está
 * ali, e a resposta útil é a razão mais forte.
 */
export function unirCandidatas(lista: readonly Candidata[], teto: number): Candidata[] {
  const porChave = new Map<string, Candidata>();

  for (const c of lista) {
    if (c.chave === "") continue;
    const ja = porChave.get(c.chave);
    if (!ja) {
      porChave.set(c.chave, { ...c });
    } else if (forca(c.camada) < forca(ja.camada)) {
      porChave.set(c.chave, { ...c });
    } else if (c.camada === ja.camada && c.score > ja.score) {
      ja.score = c.score;
    }
  }

  return [...porChave.values()].sort(porForca).slice(0, teto);
}

/**
 * As três camadas de string, sobre o texto de um bloco. Pura: sem rede, sem
 * banco, sem modelo — é o que permite testar o caso "giam" à mão.
 */
export function candidatasPorGrafia(
  texto: string,
  catalogo: readonly EntidadeDoGrafo[],
): Candidata[] {
  if (catalogo.length === 0) return [];

  const tokens = tokenizar(texto);
  const gramas = ngramas(tokens);
  const achadas: Candidata[] = [];

  // 1. exato — a grafia conhecida, alias inclusive. A chave do catálogo já
  // atravessa fusão, então "exx med" cai no nó de "Exxmed" de graça.
  const porChave = new Map<string, EntidadeDoGrafo>();
  for (const e of catalogo) {
    for (const chave of e.chaves) if (chave && !porChave.has(chave)) porChave.set(chave, e);
  }
  for (const grama of gramas) {
    const e = porChave.get(grama);
    if (e) achadas.push({ chave: e.nome_normalizado, camada: "exato", score: 1 });
  }

  // 2. prefixo — o apelido que a camada de string não alcança. "giam" fica longe
  // demais de "giampaolo lepore" em Levenshtein e não compartilha palavra
  // nenhuma; começar a palavra é o único sinal que sobra.
  const iniciais = tokens.filter((t) => t.length >= MIN_TOKEN && !ehPronome(t));
  for (const e of catalogo) {
    for (const chave of e.chaves) {
      for (const palavra of chave.split(" ")) {
        if (palavra.length < MIN_ALVO_PREFIXO) continue;
        for (const t of iniciais) {
          if (t.length < palavra.length && palavra.startsWith(t)) {
            achadas.push({
              chave: e.nome_normalizado,
              camada: "prefixo",
              score: t.length / palavra.length,
            });
          }
        }
      }
    }
  }

  // 3. parecido — o homófono, de graça, pela mesma função que a slice 3 já usa
  // para propor duplicata: "Bejewel" fica a poucas letras de "Behring".
  for (const grama of gramas) {
    for (const e of catalogo) {
      for (const chave of e.chaves) {
        const p = proximidade(grama, chave);
        if (p) achadas.push({ chave: e.nome_normalizado, camada: "parecido", score: p.valor });
      }
    }
  }

  return unirCandidatas(achadas, TETO_POR_BLOCO);
}

/** Uma candidata do dossiê: o nó, e por que ele está na lista. */
export interface ItemDoDossie {
  entidade: EntidadeDoGrafo;
  camada: CamadaDossie;
  score: number;
}

export type Dossie = ItemDoDossie[];

/**
 * O dossiê da janela: a união das candidatas dos blocos dela com as entidades
 * **já atribuídas nas janelas anteriores**.
 *
 * A segunda fonte é de graça e é a mais forte: ela vem de `parcial.atomos`, que
 * a janela já recebe. Chave que não está no catálogo cai fora em silêncio —
 * mesma regra que `comoCandidatos` aplica ao que o vetor devolve: candidato que
 * não existe é um nome que o extrator não teria como apontar.
 *
 * Empate de camada e de score desempata por `sessoes`: entre dois nós igualmente
 * parecidos, o que eu falo toda semana é o mais provável.
 */
export function dossieDaJanela({
  blocos = [],
  jaAtribuidas = [],
  catalogo,
}: {
  blocos?: readonly (readonly Candidata[])[];
  jaAtribuidas?: readonly string[];
  catalogo: readonly EntidadeDoGrafo[];
}): Dossie {
  const daSessao: Candidata[] = jaAtribuidas.map((chave) => ({
    chave,
    camada: "ja_nesta_sessao",
    score: 1,
  }));

  const unidas = unirCandidatas([...daSessao, ...blocos.flat()], Number.MAX_SAFE_INTEGER);

  const itens: Dossie = [];
  const vistos = new Set<string>();
  for (const c of unidas) {
    const no = acharPorChave(c.chave, catalogo);
    if (!no || vistos.has(no.id)) continue;
    vistos.add(no.id);
    itens.push({ entidade: no, camada: c.camada, score: c.score });
  }

  return itens
    .sort(
      (a, b) =>
        forca(a.camada) - forca(b.camada) ||
        b.score - a.score ||
        b.entidade.sessoes - a.entidade.sessoes ||
        a.entidade.nome_normalizado.localeCompare(b.entidade.nome_normalizado),
    )
    .slice(0, TETO_DO_DOSSIE);
}

/**
 * As entidades que as janelas anteriores desta sessão já atribuíram.
 *
 * Sai de `sobreDe`/`mencoesDe`, que leem os dois formatos de proposta
 * (`referencias.ts`) — a mesma leitura da revisão, e não uma segunda que
 * divergiria.
 *
 * Devolve chave, e não nó: quem decide se ela existe no grafo é o dossiê, com o
 * catálogo da hora. Entidade nova, que ainda não é nó nenhum, cai fora ali — não
 * há nome gravado nem perfil para mostrar ao extrator.
 */
export function entidadesJaAtribuidas(atomos: readonly AtomoProposto[]): string[] {
  const chaves = new Set<string>();
  for (const a of atomos) {
    for (const r of [sobreDe(a), ...mencoesDe(a)]) {
      const chave = normalizarNome(r.entidade);
      if (chave !== "") chaves.add(chave);
    }
  }
  return [...chaves];
}

// ───────────────────────────── com R2 ─────────────────────────────

/**
 * As candidatas de um bloco, calculando e gravando se ainda não existirem.
 *
 * **A existência de `candidatas_NNN.json` é a trava** (regra 4): bloco já
 * consultado não é reconsultado nem repago, por mais vezes que `/pronto` e
 * `/finalizar` passem por ele. A exceção é `refazerDegradado`, o catch-up do
 * `/finalizar`: um arquivo que saiu sem camada semântica é refeito **uma** vez,
 * e o `refeito` é o que impede a segunda.
 *
 * Devolve `null` quando o bloco ainda não tem transcrição — não é falha, é a
 * ordem normal das coisas.
 */
export async function recuperarCandidatas(
  sessao_id: string,
  i: number,
  {
    catalogo,
    refazerDegradado = false,
  }: { catalogo?: readonly EntidadeDoGrafo[]; refazerDegradado?: boolean } = {},
): Promise<CandidatasDoBloco | null> {
  const key = chaveChunkCandidatas(sessao_id, i);

  const pronto = (await getJson<CandidatasDoBloco>(key))?.valor;
  if (pronto && (pronto.semantico || pronto.refeito || !refazerDegradado)) return pronto;

  const bloco = await getJson<TranscricaoBloco>(chaveChunkTranscricao(sessao_id, i));
  if (!bloco) return pronto ?? null;

  const lista = catalogo ?? (await listarEntidades());
  const { candidatas, semantico } = await candidatasDoBloco(bloco.valor.texto, lista);

  const registro: CandidatasDoBloco = {
    sessao_id,
    i,
    candidatas,
    semantico,
    ...(pronto ? { refeito: true } : {}),
    criado_em: new Date().toISOString(),
  };
  await putJson(key, registro);
  return registro;
}

/**
 * As cinco camadas sobre o texto de um bloco.
 *
 * Catálogo vazio pula tudo, inclusive o Gateway: sem entidade no grafo não há em
 * que a busca acertar, e pagar uma chamada de embedding para descobrir isso
 * seria gastar por nada na primeira sessão da vida do sistema. Aí `semantico` é
 * `true` porque não houve camada nenhuma a perder — não há o que refazer.
 *
 * Os pisos são os mesmos da resolução, de propósito: dois lugares para calibrar
 * a mesma pergunta divergiriam. O que muda é o texto de um lado — um bloco de
 * 30 s contra a frase de um átomo —, e isso está no §14.
 */
export async function candidatasDoBloco(
  texto: string,
  catalogo: readonly EntidadeDoGrafo[],
): Promise<{ candidatas: Candidata[]; semantico: boolean }> {
  if (catalogo.length === 0 || texto.trim() === "") {
    return { candidatas: [], semantico: true };
  }

  const porGrafia = candidatasPorGrafia(texto, catalogo);

  // Nunca estoura: `candidatosSemanticos` engole índice ausente, Gateway fora e
  // rate limit devolvendo lista vazia (§4.10).
  const [semanticos = []] = await candidatosSemanticos(
    [texto],
    { perfil: PISO_PERFIL, vizinhos: PISO_VIZINHOS },
    ALCANCE,
  );

  const doVetor: Candidata[] = semanticos.map((s) => ({
    chave: s.chave,
    camada: s.camada,
    score: s.similaridade,
  }));

  return {
    candidatas: unirCandidatas([...porGrafia, ...doVetor], TETO_POR_BLOCO),
    semantico: semanticos.length > 0,
  };
}

/**
 * As candidatas dos blocos de uma janela, com o catch-up do que faltar.
 *
 * **Os quatro blocos em paralelo desde a slice 8.** Eram um `for` com `await`, e
 * cada volta paga um GET no R2 e, quando o bloco ainda não foi consultado, um
 * `embedMany` mais duas consultas vetoriais. Os blocos não dependem uns dos
 * outros e nada no código exigia a ordem — ela era só o jeito mais fácil de
 * escrever o laço, e custava a soma de quatro idas à rede na janela do fim, que
 * é exatamente onde eu estou esperando olhando a tela.
 *
 * A ordem da **saída** continua sendo a dos índices: `Promise.all` preserva a
 * posição, e o dossiê é montado sobre ela.
 *
 * **Falhar aqui nunca derruba a janela.** Bloco sem candidatas só faz o dossiê
 * ficar menor, e dossiê vazio faz o extrator se comportar exatamente como na
 * 4.8 — a mesma precedência do vetor (§4.10). Por isso cada bloco tem o seu
 * `catch`, e não o laço: um bloco que estoura não pode levar os outros três
 * junto, que é o que um `Promise.all` sem isso faria.
 */
export async function candidatasDaJanela(
  sessao_id: string,
  indices: readonly number[],
  opcoes: { catalogo?: readonly EntidadeDoGrafo[]; refazerDegradado?: boolean } = {},
): Promise<Candidata[][]> {
  const lidos = await Promise.all(
    indices.map(async (i) => {
      try {
        return await recuperarCandidatas(sessao_id, i, opcoes);
      } catch (e) {
        console.error(`[candidatas] sessão ${sessao_id} bloco ${i}:`, e);
        return null;
      }
    }),
  );
  return lidos.flatMap((r) => (r ? [r.candidatas] : []));
}
