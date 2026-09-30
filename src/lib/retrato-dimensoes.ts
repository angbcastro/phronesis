/**
 * O agente `retrato-dimensoes-1` — propõe as dimensões em que a minha vida se
 * divide — e o arquivo onde elas moram (slice 10).
 *
 * **Por que as dimensões não são minhas desde o começo.** Ditar a lista pede
 * que eu saiba de antemão como o diário me divide; deixá-las emergir a cada
 * rodada muda a forma do retrato entre rodadas e torna impossível comparar. A
 * decisão foi o meio: **o agente propõe, eu aprovo** — e a proposta vai para
 * `sugestao`, ao lado da lista atual, e **nunca** para `dimensoes` sem eu
 * aceitar.
 *
 * **Módulo próprio, e não uma função de `retrato.ts`.** O registro dos agentes
 * (`agentes.ts`) é um prompt, um envelope e um módulo por agente, e
 * `tests/agentes.test.ts` cobra que nenhum módulo seja de dois. A spec pôs os
 * dois agentes em `retrato.ts`; o teste venceu, e a dependência vai num sentido
 * só: `retrato.ts` importa este, este não importa aquele. O prefixo comum — as
 * regras e os átomos — chega aqui pronto, como argumento.
 *
 * **O prompt editável deste agente é só o sufixo**, formato incluído. Editá-lo
 * no painel não mexe no prefixo, e é por isso que a proposta pode rodar na mesma
 * rodada das seções lendo o mesmo cache do provedor.
 */
import { generateText } from "ai";
import { chaveConfigRetrato } from "./chaves";
import { atualizarJson } from "./etag";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloRetrato,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { carimbo, efetivo } from "./overrides";
import { getJson } from "./r2";
import { tokenizar } from "./texto";
import { ID_AGORA } from "./tipos";
import type { ConfigRetrato, DimensaoDoRetrato } from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_RETRATO_DIMENSOES = "retrato-dimensoes-1";

/** O que o prompt pede. O parser aceita menos — resposta curta não é inválida. */
export const MIN_DIMENSOES = 6;
export const MAX_DIMENSOES = 12;

/** Os tetos da edição à mão: o que o servidor aceita de um corpo do cliente. */
export const TETO_NOME_DIMENSAO = 60;
export const TETO_O_QUE_ENTRA = 400;
export const TETO_DIMENSOES_A_MAO = 20;

/** Quanto da resposta crua entra no log quando o parse falha. */
const AMOSTRA_ERRO = 400;

export class RetratoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetratoError";
  }
}

// ──────────────────────── o id, que é estável ────────────────────────

/** O formato de um id de dimensão: minúsculas, dígitos e hífen. */
export const ehIdDeDimensao = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 48 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);

/**
 * O id de uma dimensão nova, a partir do nome.
 *
 * **Nunca devolve `agora`**: é o id da seção fixa, e uma dimensão chamada
 * "Agora" que o recebesse pisaria nela. Nem um id que já está em `usados` — a
 * colisão ganha sufixo, `agora-2`, `corpo-2`.
 */
export function slugDimensao(nome: string, usados: ReadonlySet<string> = new Set()): string {
  const base = tokenizar(nome).join("-").slice(0, 40).replace(/-+$/, "") || "dimensao";
  const ocupado = (id: string) => id === ID_AGORA || usados.has(id);
  if (!ocupado(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!ocupado(id)) return id;
  }
}

// ──────────────────────── o arquivo ────────────────────────

const VAZIA: ConfigRetrato = { dimensoes: [], sugestao: null, atualizado_em: "" };

const texto = (v: unknown, teto: number): string =>
  typeof v === "string" ? v.trim().slice(0, teto) : "";

/** Uma lista de dimensões lida do R2, sem confiar em nada dela. */
function dimensoesValidas(v: unknown): DimensaoDoRetrato[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();
  const saida: DimensaoDoRetrato[] = [];
  for (const d of v) {
    const id = (d as { id?: unknown })?.id;
    const nome = texto((d as { nome?: unknown })?.nome, TETO_NOME_DIMENSAO);
    if (!ehIdDeDimensao(id) || id === ID_AGORA || vistos.has(id) || nome === "") continue;
    vistos.add(id);
    saida.push({ id, nome, o_que_entra: texto((d as { o_que_entra?: unknown }).o_que_entra, TETO_O_QUE_ENTRA) });
  }
  return saida;
}

/** O objeto do R2 como ele deveria ser. Ausente ou torto vira a configuração vazia. */
export function normalizarConfig(cru: unknown): ConfigRetrato {
  if (!cru || typeof cru !== "object") return { ...VAZIA };
  const c = cru as Partial<ConfigRetrato>;
  const sugestao = Array.isArray(c.sugestao) ? dimensoesValidas(c.sugestao) : null;
  return {
    dimensoes: dimensoesValidas(c.dimensoes),
    sugestao: sugestao && sugestao.length > 0 ? sugestao : null,
    atualizado_em: typeof c.atualizado_em === "string" ? c.atualizado_em : "",
  };
}

/** A configuração em vigor. **Não engole erro**: sem ela a rodada não sabe o que escrever. */
export async function lerConfigRetrato(): Promise<ConfigRetrato> {
  const o = await getJson<ConfigRetrato>(chaveConfigRetrato());
  return normalizarConfig(o?.valor);
}

const atualizarConfig = (mutador: (c: ConfigRetrato) => ConfigRetrato) =>
  atualizarJson<ConfigRetrato>(chaveConfigRetrato(), normalizarConfig, mutador, {
    rotulo: "as dimensões do retrato",
  }).then((r) => r.valor);

/**
 * Grava a lista que eu editei na tela.
 *
 * O cliente manda a lista inteira, na ordem que ele quer. **Quem dá id é o
 * servidor**: o id que veio e casa com o formato é mantido — é assim que
 * renomear preserva a seção —, e dimensão nova ganha um pelo nome. A sugestão
 * pendente não é tocada: editar a lista atual não é responder à proposta.
 */
export function limparDimensoesDaTela(entrada: unknown): DimensaoDoRetrato[] {
  if (!Array.isArray(entrada)) throw new RetratoError("espera { dimensoes: [...] }");
  if (entrada.length > TETO_DIMENSOES_A_MAO) {
    throw new RetratoError(`no máximo ${TETO_DIMENSOES_A_MAO} dimensões`);
  }

  const brutas = entrada.map((d) => ({
    id: (d as { id?: unknown })?.id,
    nome: texto((d as { nome?: unknown })?.nome, TETO_NOME_DIMENSAO),
    o_que_entra: texto((d as { o_que_entra?: unknown })?.o_que_entra, TETO_O_QUE_ENTRA),
  }));
  if (brutas.some((d) => d.nome === "")) throw new RetratoError("toda dimensão precisa de nome");

  // Primeiro os ids que vieram, para uma dimensão nova não roubar o id de uma
  // que já existia só por vir antes na lista.
  const usados = new Set<string>();
  const mantidos = brutas.map((d) => {
    if (ehIdDeDimensao(d.id) && d.id !== ID_AGORA && !usados.has(d.id)) {
      usados.add(d.id);
      return d.id;
    }
    return null;
  });

  return brutas.map((d, i) => {
    const id = mantidos[i] ?? slugDimensao(d.nome, usados);
    usados.add(id);
    return { id, nome: d.nome, o_que_entra: d.o_que_entra };
  });
}

export async function gravarDimensoes(
  entrada: unknown,
  agora: string = new Date().toISOString(),
): Promise<ConfigRetrato> {
  const dimensoes = limparDimensoesDaTela(entrada);
  return atualizarConfig((c) => ({ ...c, dimensoes, atualizado_em: agora }));
}

/** "Aceitar": a sugestão vira a lista, inteira, e deixa de ser sugestão. */
export async function aceitarSugestao(
  agora: string = new Date().toISOString(),
): Promise<ConfigRetrato> {
  const r = await atualizarConfig((c) =>
    c.sugestao ? { dimensoes: c.sugestao, sugestao: null, atualizado_em: agora } : c,
  );
  return r;
}

export async function descartarSugestao(
  agora: string = new Date().toISOString(),
): Promise<ConfigRetrato> {
  return atualizarConfig((c) => (c.sugestao ? { ...c, sugestao: null, atualizado_em: agora } : c));
}

/** A proposta do agente, ao lado da lista atual. **Nunca** em `dimensoes`. */
export async function gravarSugestao(
  sugestao: DimensaoDoRetrato[],
  agora: string = new Date().toISOString(),
): Promise<ConfigRetrato> {
  return atualizarConfig((c) => ({ ...c, sugestao, atualizado_em: agora }));
}

// ──────────────────────── o agente ────────────────────────

/**
 * O sufixo da proposta — a tarefa **e** o formato. É o que o painel edita.
 *
 * Mora depois do prefixo comum, e não antes: qualquer coisa que muda entre
 * chamadas antes dos átomos quebra o cache do provedor no primeiro byte
 * diferente.
 */
export const INSTRUCOES = `TAREFA DESTA CHAMADA: PROPOR AS DIMENSÕES DO RETRATO

Leia todos os trechos acima e proponha as dimensões em que a vida do dono do diário se divide — as áreas que um retrato dele precisa cobrir para dizer quem ele é hoje. Cada dimensão vira uma seção do retrato, escrita depois, uma por vez, a partir destes mesmos trechos.

- Entre ${MIN_DIMENSOES} e ${MAX_DIMENSOES} dimensões.
- Elas saem do que os trechos falam, e não de uma lista pronta de áreas da vida. Área que o diário quase não menciona não vira dimensão; assunto que ocupa muitos trechos pode merecer uma só para ele.
- Todo trecho que diz algo sobre quem ele é deve caber em alguma dimensão. Duas dimensões não disputam os mesmos trechos.
- Não proponha "Agora", "Momento atual" nem nada equivalente: o momento atual já é uma seção fixa do retrato.
- nome: curto, de duas a quatro palavras, do jeito que o dono falaria.
- o_que_entra: uma frase que diz que trechos pertencem a esta dimensão. É a instrução que a chamada daquela seção vai receber, então seja concreto sobre o assunto, não sobre o tom.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"dimensoes":[{"nome":"...","o_que_entra":"..."}]}`;

/**
 * O sufixo que vai ao modelo: a lista em vigor, quando há, e o prompt.
 *
 * A lista em vigor entra para a proposta poder conversar com ela — manter o que
 * serve, mudar o que não serve. Ela fica **depois** do prefixo, como tudo que
 * varia.
 */
export function montarSufixo(prompt: string, emVigor: readonly DimensaoDoRetrato[]): string {
  if (emVigor.length === 0) return prompt;
  const lista = emVigor.map((d) => `- ${d.nome}: ${d.o_que_entra}`).join("\n");
  return `DIMENSÕES EM VIGOR (proponha a lista inteira como ela deveria ser — mantendo o que serve):
${lista}

${prompt}`;
}

/**
 * Mesma tolerância dos outros agentes: cerca de markdown, frase antes do JSON.
 *
 * Os ids saem daqui, do código, e nunca do modelo. **Nome que já existe na
 * lista em vigor herda o id dela**: aceitar uma proposta que manteve "Corpo e
 * treino" mantém a seção de "Corpo e treino".
 */
export function parsearDimensoes(
  bruto: string,
  emVigor: readonly DimensaoDoRetrato[] = [],
): DimensaoDoRetrato[] {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) {
    throw new RetratoError(`resposta sem JSON reconhecível: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }

  let v: { dimensoes?: unknown };
  try {
    v = JSON.parse(semCerca.slice(inicio, fim + 1)) as { dimensoes?: unknown };
  } catch (e) {
    throw new RetratoError(
      `JSON inválido: ${e instanceof Error ? e.message : String(e)} — ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }
  if (!Array.isArray(v.dimensoes)) {
    throw new RetratoError(`resposta sem "dimensoes": ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }

  const idPorNome = new Map(emVigor.map((d) => [tokenizar(d.nome).join(" "), d.id]));
  const usados = new Set<string>();
  const nomes = new Set<string>();
  const saida: DimensaoDoRetrato[] = [];

  for (const d of v.dimensoes) {
    const nome = texto((d as { nome?: unknown })?.nome, TETO_NOME_DIMENSAO);
    const chave = tokenizar(nome).join(" ");
    if (nome === "" || nomes.has(chave)) continue;
    nomes.add(chave);

    const herdado = idPorNome.get(chave);
    const id = herdado && !usados.has(herdado) ? herdado : slugDimensao(nome, usados);
    usados.add(id);
    saida.push({
      id,
      nome,
      o_que_entra: texto((d as { o_que_entra?: unknown })?.o_que_entra, TETO_O_QUE_ENTRA),
    });
    if (saida.length === MAX_DIMENSOES) break;
  }

  if (saida.length === 0) {
    throw new RetratoError(`nenhuma dimensão aproveitável: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }
  return saida;
}

export interface PropostaEscrita {
  dimensoes: DimensaoDoRetrato[];
  modelo: string;
  prompt_version: string;
}

/**
 * O agente propõe. **Não grava nada** — quem grava a sugestão é quem chama,
 * pelo `gravarSugestao`.
 *
 * `prefixo` é o prefixo comum da rodada (`retrato.ts`), byte a byte igual ao
 * das seções: é o que faz esta chamada ler o cache que a fase 1 escreveu.
 * `comEsperaDeLimite` sem `ate`, como o enriquecimento: ninguém está esperando
 * do outro lado da tela a ponto de valer cortar a espera.
 */
export async function proporDimensoes(
  prefixo: string,
  emVigor: readonly DimensaoDoRetrato[],
): Promise<PropostaEscrita> {
  garantirGateway();
  const meu = await efetivo("retrato-dimensoes", { prompt: INSTRUCOES, modelo: modeloRetrato() });

  const inicio = Date.now();
  const r = await comEsperaDeLimite(`retrato-dimensoes ${meu.modelo}`, () =>
    generateText({
      // String de propósito: id em string sai pelo Gateway (regra 8).
      model: meu.modelo,
      prompt: `${prefixo}\n\n${montarSufixo(meu.prompt, emVigor)}`,
      temperature: 0,
      // Sem `maxOutputTokens`, herdado da 4.12.1: o raciocínio cresce com a entrada.
      maxRetries: 0,
    }),
  );
  console.log(`[retrato] proposta de dimensões: ${Date.now() - inicio} ms — ${diagnostico(r)}`);

  if (faltouOrcamento(r)) {
    throw new RetratoError(
      `a resposta bateu o teto de saída do próprio modelo (${meu.modelo}): ${diagnostico(r)}`,
    );
  }
  if (veioDoPensamento(r)) {
    console.warn("[retrato] proposta: texto vazio, lendo o JSON do pensamento.", diagnostico(r));
  }

  return {
    dimensoes: parsearDimensoes(textoDaResposta(r), emVigor),
    modelo: r.response?.modelId ?? meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_RETRATO_DIMENSOES, meu.hash),
  };
}
