/**
 * A Cypher que o modelo escreve (slice 12): o que roda, e o que volta dela.
 *
 * O chat pergunta ao grafo o que nenhuma consulta pronta sabe — contar, ordenar,
 * comparar períodos, acompanhar uma mudança — escrevendo a própria consulta.
 * Este módulo é a porta dela, e a porta tem três travas, cada uma pelo que a
 * anterior não vê (§4.16.3):
 *
 * 1. **Bloqueios no texto**, antes de qualquer ida ao banco: o que o banco
 *    classifica como leitura e não é — `LOAD CSV` sai do grafo, `TERMINATE`
 *    mata transação alheia, `CALL` de procedure pode ser classificada errado —,
 *    e o que é leitura e não é do chat: `:Conversa`, outro banco por `USE`.
 * 2. **`EXPLAIN` em `Read`**: o banco classifica a consulta sem executá-la, e só
 *    `r` segue. Erro de sintaxe volta aqui, sem nada ter rodado.
 * 3. **A execução em `Read`**: o banco recusa a escrita antes de tocar em linha.
 *    É o que segura o que as duas primeiras deixassem passar.
 *
 * **A saída é limpa e tem teto.** Nó e relação viram propriedades; vetor nunca
 * volta. O teto é o mesmo com 300 ou 30 mil átomos, e quando corta diz quanto e
 * manda agregar: o agente aprende a contar no banco em vez de despejar.
 *
 * **Erro da consulta é texto, não exceção** — recusa, sintaxe, tempo,
 * parâmetro que não existe. O modelo lê e reescreve, como faria uma pessoa.
 * Exceção sobe só quando a culpa não é da consulta: a rede.
 */
import { executar, Neo4jError, type NotificacaoDoBanco } from "./neo4j";

/** Linhas que vão ao modelo, no máximo. */
export const TETO_LINHAS = 150;
/** Caracteres da tabela que vão ao modelo, no máximo — o que vier primeiro. */
export const TETO_CARACTERES = 12_000;
/** Segundos até o banco encerrar a consulta (`maxExecutionTime`). */
export const TEMPO_MAXIMO_S = 10;
/** Lista de número maior que isto é vetor, e vetor não se lê. */
export const LISTA_DE_NUMEROS_MAX = 16;
/** A mensagem de erro do banco ecoa a consulta inteira; o modelo precisa do começo. */
const TETO_ERRO = 600;

export interface ResultadoDaConsulta {
  /** O que volta ao modelo: a contagem ou o corte, os avisos e a tabela — ou o erro. */
  texto: string;
  colunas: string[];
  /** As que foram ao modelo, já limpas e cortadas. */
  linhas: unknown[][];
  /** Quantas o banco devolveu. */
  total: number;
  cortado: boolean;
  /** Label, relação ou propriedade que não existe no grafo, e o resto que o banco avisou. */
  avisos: string[];
  /** A consulta não rodou, ou rodou e o banco a interrompeu: `texto` diz por quê. */
  erro?: string;
}

// ─── Os bloqueios ───────────────────────────────────────────────────────────

/**
 * A Cypher em duas leituras: o código, sem comentários e com cada literal de
 * string esvaziado — `'use'` dentro de um texto não é a cláusula `USE` —, e os
 * literais, à parte.
 *
 * O identificador entre crases perde as crases: `` :`Conversa` `` é `:Conversa`.
 * O que não for uma palavra só vira `_`, para ``AS `use isto` `` não parecer
 * cláusula.
 */
export function separar(cypher: string): { codigo: string; literais: string[] } {
  let codigo = "";
  const literais: string[] = [];
  let i = 0;
  while (i < cypher.length) {
    const c = cypher[i];
    const d = cypher[i + 1];
    if (c === "/" && d === "/") {
      const fim = cypher.indexOf("\n", i);
      i = fim < 0 ? cypher.length : fim;
      codigo += " ";
    } else if (c === "/" && d === "*") {
      const fim = cypher.indexOf("*/", i + 2);
      i = fim < 0 ? cypher.length : fim + 2;
      codigo += " ";
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < cypher.length && cypher[j] !== c) j += cypher[j] === "\\" ? 2 : 1;
      literais.push(cypher.slice(i + 1, j));
      codigo += "''";
      i = j + 1;
    } else if (c === "`") {
      let j = i + 1;
      let nome = "";
      while (j < cypher.length) {
        if (cypher[j] === "`" && cypher[j + 1] === "`") {
          nome += "`";
          j += 2;
        } else if (cypher[j] === "`") {
          break;
        } else {
          nome += cypher[j++];
        }
      }
      codigo += /^\w+$/.test(nome) ? nome : "_";
      i = j + 1;
    } else {
      codigo += c;
      i++;
    }
  }
  return { codigo, literais };
}

/** Palavra em posição de cláusula: não é pedaço de nome, nem propriedade, nem parâmetro. */
const clausula = (palavra: string, depois = "\\s") =>
  new RegExp(`(^|[^\\w.$])${palavra}${depois}`, "i");

const BLOQUEIOS: { regra: RegExp; motivo: string }[] = [
  {
    regra: /^\s*(EXPLAIN|PROFILE)\b/i,
    motivo: "não comece por EXPLAIN nem PROFILE: quem põe o EXPLAIN é a ferramenta",
  },
  {
    regra: clausula("LOAD", "\\s+CSV\\b"),
    motivo: "LOAD CSV não é permitido: é uma porta para fora do grafo",
  },
  {
    // `CALL {` e `CALL (x) {` são subquery, e passam.
    regra: clausula("CALL", "\\b(?!\\s*[({])"),
    motivo:
      "CALL de procedure não é permitido — subquery, `CALL { … }` ou `CALL (x) { … }`, pode. A busca por sentido é a cláusula SEARCH",
  },
  { regra: clausula("USE"), motivo: "USE não é permitido: só existe este banco" },
  {
    regra: clausula("TERMINATE"),
    motivo: "TERMINATE não é leitura: encerra transação de outro",
  },
];

const CONVERSA = /\bConversa\b/;
const MOTIVO_CONVERSA =
  ":Conversa não é legível por aqui — uma conversa nunca enxerga outra. Para achar a palavra no texto de um átomo, compare em minúsculas: toLower(a.texto) CONTAINS 'conversa'";

/**
 * O motivo da recusa, ou `null` se a consulta pode ir ao banco.
 *
 * `:Conversa` se procura também **dentro** dos literais, e com a maiúscula: o
 * label se alcança por texto — `'Conversa' IN labels(n)`, `n:$('Conversa')`. A
 * palavra em minúscula, que é como se busca no texto de um átomo, passa.
 */
export function bloqueio(cypher: string): string | null {
  if (!cypher.trim()) return "a consulta veio vazia";
  const { codigo, literais } = separar(cypher);
  for (const { regra, motivo } of BLOQUEIOS) if (regra.test(codigo)) return motivo;
  if (CONVERSA.test(codigo) || literais.some((l) => CONVERSA.test(l))) return MOTIVO_CONVERSA;
  return null;
}

/** Os `$parametro` do código — o `$vetor` dentro de um texto não conta. */
function parametrosUsados(cypher: string): Set<string> {
  const { codigo } = separar(cypher);
  return new Set([...codigo.matchAll(/\$([A-Za-z_]\w*)/g)].map((m) => m[1]));
}

/**
 * A consulta usa este parâmetro? É o que deixa a ferramenta pular a chamada de
 * embedding quando o modelo mandou `texto` e não escreveu `$vetor`.
 */
export const usaParametro = (cypher: string, nome: string): boolean =>
  parametrosUsados(cypher).has(nome);

/**
 * O parâmetro que a consulta usa e que não veio. `$vetor` tem frase própria: ele
 * só existe quando a chamada traz `texto`, e o modelo que o usou sem `texto`
 * precisa saber disso, e não só que falta.
 */
export function parametroQueFalta(cypher: string, parametros: Record<string, unknown>): string | null {
  for (const nome of parametrosUsados(cypher)) {
    if (nome in parametros) continue;
    if (nome === "vetor") {
      return "a consulta usa $vetor, e $vetor só existe quando a chamada traz `texto`: passe em `texto` as palavras da busca por sentido";
    }
    const existem = Object.keys(parametros).map((p) => `$${p}`);
    return `o parâmetro $${nome} não existe — os desta consulta são ${existem.join(", ") || "nenhum"}, e $vetor vem com \`texto\``;
  }
  return null;
}

// ─── A limpeza ──────────────────────────────────────────────────────────────

/** O que a Query API manda no lugar de um nó. */
interface NoDoBanco {
  elementId: string;
  labels: string[];
  properties: Record<string, unknown>;
}

/** E no lugar de uma relação. */
interface RelacaoDoBanco {
  elementId: string;
  type: string;
  properties: Record<string, unknown>;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ehNo = (v: Record<string, unknown>): v is Record<string, unknown> & NoDoBanco =>
  typeof v.elementId === "string" && Array.isArray(v.labels) && ehObjeto(v.properties);

const ehRelacao = (v: Record<string, unknown>): v is Record<string, unknown> & RelacaoDoBanco =>
  typeof v.elementId === "string" && typeof v.type === "string" && ehObjeto(v.properties);

/** O nó de conversa que um `MATCH (n)` sem label trouxer. */
export const CONVERSA_OMITIDA = "[conversa: fora do alcance do chat]";

/**
 * Um valor da resposta, pronto para o modelo ler.
 *
 * - **Nó e relação viram propriedades**: o `elementId` sai, o nó leva os
 *   labels em `_labels`, a relação o tipo em `_tipo`.
 * - **Vetor nunca volta**, em qualquer profundidade: a propriedade com
 *   `embedding` no nome sai, e lista de número mais longa que
 *   `LISTA_DE_NUMEROS_MAX` vira uma marca — 1.536 números são 20 mil
 *   caracteres que não dizem nada a quem lê.
 * - **Nó de `:Conversa` vira uma marca**: o bloqueio pega o label escrito, e
 *   isto pega o nó que chegou sem ele.
 */
export function limpar(v: unknown): unknown {
  if (Array.isArray(v)) {
    if (v.length > LISTA_DE_NUMEROS_MAX && v.every((x) => typeof x === "number")) {
      return `[lista de ${v.length} números, omitida]`;
    }
    return v.map(limpar);
  }
  if (!ehObjeto(v)) return v;
  if (ehNo(v)) {
    if (v.labels.includes("Conversa")) return CONVERSA_OMITIDA;
    return { _labels: v.labels, ...propriedades(v.properties) };
  }
  if (ehRelacao(v)) return { _tipo: v.type, ...propriedades(v.properties) };
  return propriedades(v);
}

function propriedades(p: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(p)) {
    if (!/embedding/i.test(chave)) saida[chave] = limpar(valor);
  }
  return saida;
}

// ─── A tabela e o corte ─────────────────────────────────────────────────────

/** Texto e não JSON, pela razão de sempre (§4.16.2): o modelo lê para escrever prosa. */
function celula(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v.replace(/\s*\n\s*/g, " ");
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

const linhaDaTabela = (valores: readonly unknown[]) => valores.map(celula).join(" | ");

/**
 * As linhas que cabem: até `TETO_LINHAS`, e até `TETO_CARACTERES` de tabela, o
 * que vier primeiro. A primeira linha vai sempre — cortada no teto, se sozinha
 * ela já passar dele —, para o modelo ver a forma do que pediu.
 */
export function cortar(
  colunas: readonly string[],
  linhas: readonly unknown[][],
): { linhas: unknown[][]; tabela: string[]; cortado: boolean } {
  const tabela = [colunas.join(" | ")];
  let usados = tabela[0].length;
  const cabem: unknown[][] = [];
  let cortado = false;
  for (const l of linhas) {
    if (cabem.length >= TETO_LINHAS) break;
    const t = linhaDaTabela(l);
    if (usados + 1 + t.length > TETO_CARACTERES) {
      if (cabem.length === 0) {
        tabela.push(`${t.slice(0, Math.max(0, TETO_CARACTERES - usados - 1))}…[linha cortada]`);
        cabem.push(l);
        cortado = true;
      }
      break;
    }
    tabela.push(t);
    cabem.push(l);
    usados += 1 + t.length;
  }
  return { linhas: cabem, tabela, cortado: cortado || cabem.length < linhas.length };
}

/**
 * O título do aviso, mais o nome que faltou quando o banco o diz — "(the missing
 * label name is: Medo)" — ou o começo da descrição.
 */
export function textoDoAviso(n: NotificacaoDoBanco): string {
  const nome = n.description.match(/\(([^()]*\bis: [^()]*)\)\s*$/);
  if (nome) return `${n.title} (${nome[1]})`;
  const descricao = n.description.length > 200 ? `${n.description.slice(0, 200)}…` : n.description;
  return `${n.title} — ${descricao}`;
}

/**
 * Zero linhas não é resposta, é pergunta: consulta válida que volta vazia é o
 * erro que mais se parece com "o diário não tem" (`CLAUDE.md`).
 */
export const NADA_ACHADO =
  "0 linhas. A consulta rodou e não achou nada — antes de dizer que o diário não tem, confira: um filtro estreito demais (período, tipo); um nome de label, relação ou propriedade errado; um valor que não existe (status é 'ativo', tipo é um dos oito).";

export function textoDaConsulta(r: Omit<ResultadoDaConsulta, "texto" | "erro">, tabela: string[]): string {
  const avisos = r.avisos.map((a) => `aviso do banco: ${a}`);
  if (r.total === 0) return [NADA_ACHADO, ...avisos].join("\n");
  const topo = r.cortado
    ? `cortado em ${r.linhas.length} de ${r.total} linhas — agregue, filtre ou projete menos.`
    : `${r.total} ${r.total === 1 ? "linha" : "linhas"}.`;
  return [topo, ...avisos, ...tabela].join("\n");
}

// ─── A consulta ─────────────────────────────────────────────────────────────

const recusa = (erro: string): ResultadoDaConsulta => ({
  texto: erro,
  colunas: [],
  linhas: [],
  total: 0,
  cortado: false,
  avisos: [],
  erro,
});

/** O erro do banco, na frase que diz ao modelo o que fazer. */
export function erroDoBanco(e: Neo4jError): string {
  const codigo = e.code ?? "";
  const mensagem = e.message.length > TETO_ERRO ? `${e.message.slice(0, TETO_ERRO)}…` : e.message;
  if (codigo.endsWith("SyntaxError")) return `erro de sintaxe — ${mensagem}`;
  // O estouro do `maxExecutionTime` chega como `Transaction.Terminated` ("terminated
  // by the user"), e não como "timed out" — conferido na instância.
  if (codigo === "Neo.ClientError.Transaction.Terminated" || /TimedOut/.test(codigo)) {
    return `a consulta passou de ${TEMPO_MAXIMO_S} s e foi interrompida — restrinja (um LIMIT, um recorte de tempo) ou agregue no banco`;
  }
  if (codigo === "Neo.ClientError.Statement.AccessMode") {
    return "o banco recusou: a consulta tenta escrever, e esta ferramenta só lê";
  }
  return `o banco recusou (${codigo || "sem código"}): ${mensagem}`;
}

/**
 * Roda a Cypher do modelo, se ela for só leitura, e devolve o que ele lê.
 *
 * `parametros` vem pronto de quem chama — `$hoje` sempre, `$vetor` quando houve
 * `texto` —, e vai igual ao `EXPLAIN` e à execução.
 */
export async function consultar(
  cypher: string,
  parametros: Record<string, unknown> = {},
): Promise<ResultadoDaConsulta> {
  // O `;` do fim é hábito de console, e a Query API roda um statement só.
  const statement = cypher.trim().replace(/;\s*$/, "");

  const bloqueado = bloqueio(statement);
  if (bloqueado) return recusa(`recusada: ${bloqueado}`);
  const falta = parametroQueFalta(statement, parametros);
  if (falta) return recusa(falta);

  try {
    const plano = await executar(`EXPLAIN ${statement}`, parametros, { accessMode: "Read" });
    if (plano.queryType !== "r") {
      return recusa(
        `recusada: o banco classificou a consulta como '${plano.queryType ?? "?"}', e esta ferramenta só roda leitura ('r') — nada foi executado`,
      );
    }

    const r = await executar(statement, parametros, {
      accessMode: "Read",
      maxExecutionTime: TEMPO_MAXIMO_S,
    });
    const limpas = r.values.map((l) => l.map(limpar));
    const { linhas, tabela, cortado } = cortar(r.fields, limpas);
    const avisos = [...new Set(r.notifications.map(textoDoAviso))];
    const resultado = { colunas: r.fields, linhas, total: limpas.length, cortado, avisos };
    return { ...resultado, texto: textoDaConsulta(resultado, tabela) };
  } catch (e) {
    if (e instanceof Neo4jError) return recusa(erroDoBanco(e));
    throw e;
  }
}
