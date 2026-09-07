/**
 * Quem parece ser a mesma coisa que quem.
 *
 * Duas camadas, e **as duas só propõem**. Fundir é decisão minha, na tela
 * (`fusao.ts` é quem escreve). "Marina" e "Mariana" são distância 1 e são duas
 * pessoas; fundir errado é irreversível num sistema que não desfaz, e o custo
 * do erro é assimétrico — duas entidades a mais é grafo um pouco sujo, uma
 * fusão errada é grafo mentindo.
 *
 *   1. `parecidas()`  string, de graça, roda sobre a lista inteira
 *   2. `julgar()`     o modelo olha a lista curta com o contexto dos átomos
 *
 * A camada 2 sai pelo Gateway (regra 8) e só roda quando eu peço, no botão —
 * não a cada vez que a tela abre. Senão a manutenção vira uma conta mensal por
 * uma pergunta que quase sempre tem a mesma resposta.
 */
import { generateText } from "ai";
import {
  garantirGateway,
  modeloDuplicatas,
  opcoesDeRaciocinio,
  textoDaResposta,
} from "./modelos";
import { carimbo, efetivo } from "./overrides";
import { chaveDoPar } from "./fusao";
import { normalizar } from "./texto";
import type { EntidadeDoGrafo } from "./entidades";

/** Muda sempre que o prompt mudar — mesma disciplina da extração (regra 7). */
export const PROMPT_VERSION_DUPLICATAS = "duplicatas-1";

export class DuplicatasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicatasError";
  }
}

export interface ParCandidato {
  a: string;
  b: string;
  /** 0..1 — só ordena a lista curta; não decide nada. */
  proximidade: number;
  motivo: string;
}

export interface ParJulgado extends ParCandidato {
  mesma: boolean;
  explicacao: string;
}

/** Distância de Levenshtein, iterativa com duas linhas. */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  let atual = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    atual[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
    }
    [anterior, atual] = [atual, anterior];
  }
  return anterior[b.length];
}

/** "exx med" → "exxmed". É o que faz as duas grafias colidirem. */
const semEspaco = (s: string) => normalizar(s).replace(/\s+/g, "");

/**
 * O par vale ser olhado?
 *
 * Três sinais, do mais forte para o mais fraco. O limiar é folgado de
 * propósito: esta camada não decide nada, ela só evita mandar N² pares para o
 * modelo. Falso positivo aqui custa um item na lista; falso negativo custa uma
 * duplicata que nunca vai ser percebida.
 */
export function proximidade(a: string, b: string): { valor: number; motivo: string } | null {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (na === "" || nb === "" || na === nb) return null;

  if (semEspaco(na) === semEspaco(nb)) {
    return { valor: 1, motivo: "mesma grafia sem os espaços" };
  }

  const palavrasA = new Set(na.split(" "));
  const palavrasB = new Set(nb.split(" "));
  const comuns = [...palavrasA].filter((p) => palavrasB.has(p) && p.length > 2);
  if (comuns.length > 0 && (palavrasA.size > 1 || palavrasB.size > 1)) {
    return { valor: 0.8, motivo: `compartilham "${comuns.join(" ")}"` };
  }

  const d = distancia(na, nb);
  const maior = Math.max(na.length, nb.length);
  // Uma letra de diferença em nome curto é ruído ("Ana"/"Ane"); em nome longo é
  // quase certamente a mesma coisa ("Rodozanco"/"Rodozanko").
  if (d <= 2 && maior >= 5) {
    return { valor: 1 - d / maior, motivo: `${d} letra(s) de diferença` };
  }
  return null;
}

/**
 * Todos os pares que valem uma segunda olhada, do mais parecido ao menos.
 *
 * `jaDistintos` são os que eu já recusei — eles não voltam. Sem isso a tela
 * pergunta a mesma coisa toda vez, e cobrança é como este sistema morre.
 */
export function parecidas(
  entidades: readonly EntidadeDoGrafo[],
  jaDistintos: ReadonlySet<string> = new Set(),
): ParCandidato[] {
  const pares: ParCandidato[] = [];

  for (let i = 0; i < entidades.length; i++) {
    for (let j = i + 1; j < entidades.length; j++) {
      const x = entidades[i];
      const y = entidades[j];
      if (jaDistintos.has(chaveDoPar(x.nome_normalizado, y.nome_normalizado))) continue;

      const p = proximidade(x.nome, y.nome);
      if (!p) continue;
      pares.push({
        a: x.nome_normalizado,
        b: y.nome_normalizado,
        proximidade: p.valor,
        motivo: p.motivo,
      });
    }
  }

  return pares.sort((p, q) => q.proximidade - p.proximidade);
}

export const INSTRUCOES = `Você recebe pares de nomes que aparecem num diário pessoal, com o contexto em que cada um foi usado. Para cada par, diga se são a MESMA entidade escrita de dois jeitos, ou duas entidades diferentes.

Responda SIM apenas quando for grafia diferente da mesma coisa: "Exxmed" e "Exx Med", "Rodozanco" e "Rodozanko", um apelido e o nome de quem o contexto mostra ser a mesma pessoa.

Responda NÃO quando forem coisas diferentes que por acaso se parecem: "Marina" e "Mariana" são duas pessoas, "Pedro" e "Pedra" idem. Nome parecido é o caso comum num diário, não a exceção.

Na dúvida, responda NÃO. Fundir duas coisas diferentes é irreversível; deixar duas passando é só um item a mais na lista.

Devolva SÓ um array JSON, sem texto em volta:
[{"a":"<chave a>","b":"<chave b>","mesma":true|false,"explicacao":"<uma frase curta>"}]`;

interface Julgamento {
  a?: unknown;
  b?: unknown;
  mesma?: unknown;
  explicacao?: unknown;
}

export function extrairJson(bruto: string): Julgamento[] {
  const limpo = bruto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const inicio = limpo.indexOf("[");
  const fim = limpo.lastIndexOf("]");
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new DuplicatasError(`resposta sem array JSON: ${bruto.slice(0, 300)}`);
  }
  try {
    const v = JSON.parse(limpo.slice(inicio, fim + 1)) as unknown;
    return Array.isArray(v) ? (v as Julgamento[]) : [];
  } catch {
    throw new DuplicatasError(`array JSON inválido: ${bruto.slice(0, 300)}`);
  }
}

/** Como cada entidade é apresentada ao modelo: nome e o que se disse dela. */
export interface ContextoEntidade {
  nome_normalizado: string;
  nome: string;
  tipo: string;
  textos: string[];
}

/** O que o julgamento produziu, com a procedência do que de fato rodou. */
export interface Julgados {
  pares: ParJulgado[];
  /** `null` quando não houve o que julgar: nada foi chamado, nada custou. */
  modelo: string | null;
  prompt_version: string;
}

/**
 * O modelo julga a lista curta. Par que ele não devolver fica de fora — sem
 * resposta não há proposta, e inventar uma seria pior.
 *
 * Devolve o modelo e a `prompt_version` que **de fato** rodaram, e não só os
 * pares: desde o painel de agentes (4.7) os dois podem vir do que eu editei, e
 * a rota não tem como saber disso por fora — se ela os recalculasse, mostraria
 * uma procedência que não é a desta chamada.
 */
export async function julgar(
  pares: readonly ParCandidato[],
  contexto: ReadonlyMap<string, ContextoEntidade>,
): Promise<Julgados> {
  if (pares.length === 0) {
    return { pares: [], modelo: null, prompt_version: PROMPT_VERSION_DUPLICATAS };
  }
  garantirGateway();

  const descrever = (chave: string) => {
    const c = contexto.get(chave);
    if (!c) return `"${chave}"`;
    const amostra = c.textos.slice(0, 3).map((t) => `    - ${t.slice(0, 180)}`);
    return `"${c.nome}" (chave ${chave}, ${c.tipo})${amostra.length ? `\n${amostra.join("\n")}` : ""}`;
  };

  const corpo = pares
    .map((p, i) => `${i + 1}. par [${p.a}] x [${p.b}] — ${p.motivo}\n  ${descrever(p.a)}\n  ${descrever(p.b)}`)
    .join("\n\n");

  // O prompt e o modelo que eu editei no painel, ou a base do git (slice 4.7).
  const meu = await efetivo("duplicatas", { prompt: INSTRUCOES, modelo: modeloDuplicatas() });
  const modelo = meu.modelo;

  let texto: string;
  try {
    const r = await generateText({
      model: modelo,
      maxOutputTokens: 4000,
      prompt: `${meu.prompt}\n\nPARES:\n\n${corpo}`,
      // O cap na origem, quando se sabe pedir a este provedor (`modelos.ts`).
      providerOptions: opcoesDeRaciocinio(modelo),
    });
    // Cai no pensamento quando o modelo escreveu a resposta lá — mesmo modelo
    // de raciocínio da extração, mesmo modo de falha.
    texto = textoDaResposta(r);
  } catch (e) {
    throw new DuplicatasError(e instanceof Error ? e.message : String(e));
  }

  const porChave = new Map(pares.map((p) => [chaveDoPar(p.a, p.b), p]));
  const julgados: ParJulgado[] = [];

  for (const j of extrairJson(texto)) {
    const a = typeof j.a === "string" ? j.a : "";
    const b = typeof j.b === "string" ? j.b : "";
    const original = porChave.get(chaveDoPar(a, b));
    if (!original) continue;
    julgados.push({
      ...original,
      mesma: j.mesma === true,
      explicacao: typeof j.explicacao === "string" ? j.explicacao : "",
    });
  }

  return {
    pares: julgados,
    modelo,
    prompt_version: carimbo(PROMPT_VERSION_DUPLICATAS, meu.hash),
  };
}
