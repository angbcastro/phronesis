/**
 * Extração de átomos a partir da transcrição.
 *
 * Sai pelo Vercel AI Gateway como todo o resto que fala com modelo — o
 * endereçamento está em `modelos.ts` (regra 8). Este arquivo monta o prompt,
 * valida a resposta, casa cada trecho com o áudio (`offsets.ts`) e confronta as
 * entidades citadas com o grafo (`entidades.ts`).
 *
 * **Os offsets não saem do modelo.** Ele devolve o trecho; `offsets.ts` acha o
 * segundo. Ver o cabeçalho de lá para o porquê.
 *
 * O grafo é **lido** (para saber que entidade já existe) e nunca escrito. Nada
 * vai para o R2 tampouco: a função devolve a proposta e quem a chamar decide o
 * que fazer com ela. Antes da confirmação na revisão o grafo não recebe nada
 * (regra 5).
 */
import { generateText } from "ai";
import { resolverEntidades } from "./entidades";
import type { EntidadePropostaFrase } from "./entidades";
import { garantirGateway, modeloExtracao } from "./modelos";
import { criarLocalizador } from "./offsets";
import { TIPOS_ATOMO } from "./tipos";
import type { AtomoCru, AtomoProposto, Descarte, Extracao, TipoAtomo, Transcricao } from "./tipos";

/**
 * Muda sempre que o prompt mudar. Vai gravado em todo átomo (regra 7): sem
 * isso, daqui a três meses não há como saber qual versão produziu o quê.
 */
export const PROMPT_VERSION = "extracao-2";

export class ExtracaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtracaoError";
  }
}

const INSTRUCOES = `Você recebe a transcrição de um diário falado, em português. Extraia as afirmações atômicas.

Uma afirmação atômica é uma coisa só, dita por quem gravou, que continue fazendo sentido lida sozinha daqui a um ano.

Regras:
- Use as palavras de quem falou. Não parafraseie, não resuma, não melhore a frase.
- Uma afirmação por item. Frase com duas afirmações vira dois itens.
- Descarte o que não afirma nada: hesitação, teste de microfone, pensamento interrompido, "então", "né".
- "trecho" é obrigatório e tem que ser COPIADO LITERALMENTE da transcrição, sem corrigir nada. É o que liga a afirmação ao áudio. Não junte pedaços distantes num trecho só.
- "sobre": exatamente uma entidade — pessoa, projeto ou objetivo. Quando a afirmação é sobre quem está falando, use "eu", que é uma entidade como qualquer outra.
- "menciona": as outras entidades citadas na afirmação, ou [].
- "tipo": FATO (aconteceu), OPINIAO (o que eu acho), SENTIMENTO (como eu me senti), APRENDIZADO (o que eu concluí), CONQUISTA (o que eu consegui).

Devolva também "entidades": cada entidade citada uma vez só, com o tipo proposto — PESSOA, PROJETO ou OBJETIVO. "eu" é PESSOA.

Responda somente com JSON, sem texto antes ou depois, neste formato:
{"atomos":[{"texto":"...","tipo":"FATO","sobre":"...","menciona":[],"trecho":"..."}],
 "entidades":[{"nome":"...","tipo":"PESSOA"}]}

Transcrição:
`;

export const montarPrompt = (texto: string): string => INSTRUCOES + texto.trim();

/**
 * O modelo às vezes embrulha o JSON em cerca de markdown ou emenda uma frase
 * antes. Pegar do primeiro `{` ao último `}` resolve os dois casos sem afrouxar
 * a validação, que continua item por item logo abaixo.
 */
export function isolarJson(bruto: string): string {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");

  // Objeto ou lista solta, o que vier primeiro — o modelo às vezes devolve só
  // o array, sem o envelope que o prompt pediu.
  const aberturas = [semCerca.indexOf("{"), semCerca.indexOf("[")].filter((i) => i >= 0);
  if (aberturas.length === 0) throw new ExtracaoError("resposta sem JSON reconhecível");

  const inicio = Math.min(...aberturas);
  const fim = semCerca.lastIndexOf(semCerca[inicio] === "{" ? "}" : "]");
  if (fim <= inicio) throw new ExtracaoError("resposta sem JSON reconhecível");
  return semCerca.slice(inicio, fim + 1);
}

/** "OPINIÃO" e "opiniao" são a mesma coisa; qualquer outra não é tipo nenhum. */
export function normalizarTipo(valor: unknown): TipoAtomo | null {
  if (typeof valor !== "string") return null;
  const limpo = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  return (TIPOS_ATOMO as readonly string[]).includes(limpo) ? (limpo as TipoAtomo) : null;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export interface RespostaExtrator {
  atomos: AtomoCru[];
  /** Só uma dica de tipo: quem decide o que vira nó é `entidades.ts`. */
  entidades: EntidadePropostaFrase[];
  descartados: Descarte[];
}

/**
 * Valida item por item. O que não passa vai para `descartados` com o motivo —
 * item malformado não derruba a extração inteira, e não some em silêncio: a
 * lista de descarte é o que diz se o prompt está piorando.
 */
export function parsearResposta(bruto: string): RespostaExtrator {
  let cru: unknown;
  try {
    cru = JSON.parse(isolarJson(bruto));
  } catch (e) {
    throw new ExtracaoError(
      `resposta não é JSON válido: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const lista = Array.isArray(cru) ? cru : (cru as { atomos?: unknown })?.atomos;
  if (!Array.isArray(lista)) throw new ExtracaoError('resposta sem a lista "atomos"');

  const atomos: AtomoCru[] = [];
  const descartados: Descarte[] = [];

  for (const item of lista) {
    if (!item || typeof item !== "object") {
      descartados.push({ motivo: "item não é objeto", bruto: item });
      continue;
    }
    const i = item as Record<string, unknown>;
    const tipo = normalizarTipo(i.tipo);
    const t = texto(i.texto);
    const trecho = texto(i.trecho);
    const sobre = texto(i.sobre);

    if (t === "") descartados.push({ motivo: "texto vazio", bruto: item });
    else if (tipo === null) descartados.push({ motivo: `tipo desconhecido: ${String(i.tipo)}`, bruto: item });
    else if (trecho === "") descartados.push({ motivo: "sem trecho — não haveria como ligar ao áudio", bruto: item });
    else if (sobre === "") descartados.push({ motivo: "sem sujeito", bruto: item });
    else {
      atomos.push({
        texto: t,
        tipo,
        sobre,
        menciona: Array.isArray(i.menciona) ? i.menciona.map(texto).filter((m) => m !== "") : [],
        trecho,
      });
    }
  }

  return { atomos, entidades: propostasDeEntidade(cru), descartados };
}

/**
 * As entidades que o modelo listou, com o tipo proposto. Item malformado é
 * ignorado em silêncio, e não descartado: isto é palpite de tipo, não conteúdo
 * — `entidades.ts` cai no padrão quando falta, e a contagem de verdade sai dos
 * átomos.
 */
function propostasDeEntidade(cru: unknown): EntidadePropostaFrase[] {
  const lista = (cru as { entidades?: unknown })?.entidades;
  if (!Array.isArray(lista)) return [];

  return lista.flatMap((e) => {
    const nome = texto((e as { nome?: unknown })?.nome);
    return nome === "" ? [] : [{ nome, tipo: (e as { tipo?: unknown })?.tipo }];
  });
}

/**
 * Ata cada átomo ao áudio e carimba a procedência. O id é determinístico
 * (`<sessao_id>-<índice>`) — é o que fará o MERGE do confirmar ser idempotente
 * quando o confirmar existir (regra 4).
 */
export function ancorar(
  sessao_id: string,
  crus: AtomoCru[],
  transcricao: Transcricao,
  modelo: string,
): AtomoProposto[] {
  const localizar = criarLocalizador(transcricao.palavras);

  return crus.map((atomo, indice) => ({
    ...atomo,
    ...localizar(atomo.trecho),
    id: `${sessao_id}-${indice}`,
    indice,
    prompt_version: PROMPT_VERSION,
    modelo,
  }));
}

/** A proposta inteira, pronta para a revisão. Não grava nada em lugar nenhum. */
export async function extrair(transcricao: Transcricao): Promise<Extracao> {
  garantirGateway(); // falha cedo, antes de mandar a transcrição para qualquer lugar
  const modelo = modeloExtracao();

  if (transcricao.texto.trim() === "") {
    throw new ExtracaoError("transcrição vazia — não há o que extrair");
  }

  let resposta;
  try {
    // `model` é string de propósito: id em string sai pelo Gateway. Objeto de
    // provedor furaria a porta única — ver o cabeçalho de `modelos.ts`.
    resposta = await generateText({
      model: modelo,
      prompt: montarPrompt(transcricao.texto),
      temperature: 0,
    });
  } catch (e) {
    throw new ExtracaoError(e instanceof Error ? e.message : String(e));
  }

  const { atomos, entidades, descartados } = parsearResposta(resposta.text ?? "");
  const modeloReal = resposta.response?.modelId ?? modelo;

  return {
    sessao_id: transcricao.sessao_id,
    atomos: ancorar(transcricao.sessao_id, atomos, transcricao, modeloReal),
    // Lê o grafo; não escreve nada nele (regra 5).
    entidades: await resolverEntidades(atomos, entidades),
    descartados,
    prompt_version: PROMPT_VERSION,
    modelo: modeloReal,
    granularidade: transcricao.granularidade,
    criado_em: new Date().toISOString(),
  };
}
