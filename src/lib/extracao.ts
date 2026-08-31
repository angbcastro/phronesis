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
export const PROMPT_VERSION = "extracao-4";

export class ExtracaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtracaoError";
  }
}

const INSTRUCOES = `Você recebe a transcrição de um diário falado, em português, gravado no fim do dia. Sua tarefa é devolver uma versão ESTRUTURADA E ORGANIZADA do que foi dito — não um recorte da transcrição.

Pense assim: daqui a um ano, o que desta sessão eu vou querer reencontrar, ou ver que mudou de ideia, ou lembrar que tinha esquecido?

QUANTOS
Uma sessão de 15 minutos deve render de 10 a 20 átomos. Prefira sempre o átomo maior e mais organizado a vários recortes pequenos. Se você está produzindo um átomo por frase, está errado.

O QUE MERECE UM ÁTOMO
- Carga: o que eu senti, o que me incomodou, o que me deu alívio ou orgulho.
- Conclusão: o que eu aprendi, percebi ou entendi.
- Consequência: o que muda alguma coisa daqui pra frente.
- Decisão: o que eu decidi fazer ou parar de fazer.
- Interação: o que aconteceu com uma pessoa, num projeto, num objetivo — inclusive detalhe sobre alguém que eu vou querer saber antes da próxima conversa.

A TRIVIALIDADE DO DIA VIRA UM ÁTOMO SÓ
Tarefa doméstica, rotina de exercício, deslocamento, compra corriqueira, refeição — nada disso merece átomo próprio. Junte TUDO num único átomo de tipo ROTINA, no máximo um por sessão, listando as coisas numa frase. Se a rotina tiver carga ("foi muito bom"), essa parte vira um átomo separado de SENTIMENTO; a lista continua na ROTINA.

JUNTE O QUE É O MESMO ASSUNTO
Se eu falo de uma coisa no começo e volto a ela mais tarde, isso é UM átomo, não dois. Reúna o que foi dito nos dois momentos numa afirmação só, e devolva os dois trechos.

OS CAMPOS
"texto": a afirmação, limpa e organizada, COM AS MINHAS PALAVRAS. Tire muleta de fala ("aí", "tipo", "basicamente", "né", "assim"), resolva pronome solto ("ele" → o nome), monte uma frase que se sustente sozinha daqui a um ano. NÃO parafraseie para outro vocabulário, não interprete, não psicologize, não melhore o que eu penso. Se eu falei feio, fica feio; o que não pode é ficar ininteligível fora do contexto.

"trechos": lista de 1 ou mais pedaços COPIADOS LITERALMENTE da transcrição, sem corrigir nada, que sustentam a afirmação. É o que liga o átomo ao áudio. Cada trecho tem que aparecer palavra por palavra na transcrição. Se o átomo junta dois momentos, devolva os dois trechos.

"tipo": um de
  FATO        aconteceu, e importa
  OPINIAO     o que eu acho
  SENTIMENTO  como eu me senti
  APRENDIZADO o que eu concluí
  CONQUISTA   o que eu consegui
  DECISAO     o que eu decidi fazer ou parar de fazer
  ROTINA      a trivialidade do dia, colapsada (no máximo um por sessão)

"sobre": exatamente uma entidade, e ela depende do tipo. Esta regra não tem exceção:
  SENTIMENTO, APRENDIZADO e ROTINA  → SEMPRE "eu". Sentimento é meu por definição, mesmo quando foi outra pessoa que o provocou; quem provocou vai em "menciona". Aprendizado é meu mesmo quando é sobre outra pessoa.
  FATO, OPINIAO, CONQUISTA, DECISAO → o assunto de que trata: a pessoa, o projeto ou o objetivo. Só use "eu" quando não houver mesmo nenhum outro assunto.

"menciona": as OUTRAS entidades citadas, ou []. Nunca repita aqui o que já está em "sobre", e não liste "eu" num átomo que já é sobre "eu".

ENTIDADES
Devolva também "entidades": cada entidade citada uma vez só, com o tipo proposto — PESSOA, PROJETO ou OBJETIVO. "eu" é PESSOA. Só liste o que for de fato uma pessoa, um projeto ou um objetivo; coisa que não é nenhum dos três não entra nessa lista e fica apenas dentro do texto do átomo.

NOME DE ENTIDADE É NOME
Procure o nome na transcrição INTEIRA antes de desistir: se em algum momento eu digo "a Marina" e depois passo a falar "ela", a entidade é "Marina" em todos os átomos, inclusive nos que só dizem "ela". O mesmo vale para "meu chefe", "esse cara", "a gente".

Só quando a pessoa NUNCA é nomeada na sessão inteira, devolva o pronome como está ("ela"). Não invente nome, não escreva "ela (namorada)", não use apelido que eu não usei. Quem vai perguntar quem é sou eu, na revisão.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"atomos":[{"texto":"...","tipo":"FATO","sobre":"...","menciona":[],"trechos":["...","..."]}],
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

/**
 * Lista de strings não vazias. Aceita uma string solta como lista de um: o
 * modelo às vezes devolve `"trechos": "..."` em vez do array, e recusar o átomo
 * por causa disso seria perder conteúdo bom por erro de forma.
 */
function listaDeTexto(v: unknown): string[] {
  if (typeof v === "string") return texto(v) === "" ? [] : [texto(v)];
  if (!Array.isArray(v)) return [];
  return v.map(texto).filter((x) => x !== "");
}

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
    const trechos = listaDeTexto(i.trechos);
    const sobre = texto(i.sobre);

    if (t === "") descartados.push({ motivo: "texto vazio", bruto: item });
    else if (tipo === null) descartados.push({ motivo: `tipo desconhecido: ${String(i.tipo)}`, bruto: item });
    else if (trechos.length === 0) descartados.push({ motivo: "sem trecho — não haveria como ligar ao áudio", bruto: item });
    else if (sobre === "") descartados.push({ motivo: "sem sujeito", bruto: item });
    else {
      atomos.push({
        texto: t,
        tipo,
        sobre,
        menciona: listaDeTexto(i.menciona),
        trechos,
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
 *
 * Só o **primeiro** trecho de cada átomo empurra o cursor do localizador. Os
 * demais podem estar em qualquer ponto da sessão — é o que significa juntar o
 * mesmo assunto dito em dois momentos —, e deixá-los mover o cursor jogaria a
 * busca do próximo átomo para o fim da transcrição.
 */
export function ancorar(
  sessao_id: string,
  crus: AtomoCru[],
  transcricao: Transcricao,
  modelo: string,
): AtomoProposto[] {
  const localizar = criarLocalizador(transcricao.palavras);

  return crus.map(({ trechos, ...atomo }, indice) => ({
    ...atomo,
    trechos: trechos.map((texto, ordem) => ({
      texto,
      ...(ordem === 0 ? localizar(texto) : localizar.semAvancar(texto)),
    })),
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
