/**
 * Cliente Neo4j pela HTTP Query API.
 *
 * Nunca driver Bolt: serverless não sustenta pool de conexões (CLAUDE.md).
 * NEO4J_QUERY_URL aponta para o endpoint completo, ex.:
 *   https://<id>.databases.neo4j.io/db/<banco>/query/v2
 * O <banco> vem do NEO4J_DATABASE das credenciais do Aura — não é sempre "neo4j".
 */
import { env } from "./env";
import { comRetry } from "./rede";

type Parametros = Record<string, unknown>;

interface RespostaQuery {
  data?: { fields: string[]; values: unknown[][] };
  errors?: { code: string; message: string }[];
  queryType?: string;
  notifications?: NotificacaoDoBanco[];
}

/**
 * Aviso que o banco devolve junto do resultado — o que interessa aqui é o de
 * categoria `UNRECOGNIZED`: label, tipo de relação ou propriedade que não
 * existe no grafo. É o que separa "não há nada" de "o nome está errado".
 */
export interface NotificacaoDoBanco {
  code: string;
  title: string;
  description: string;
  severity?: string;
  category?: string;
}

export interface OpcoesDeExecucao {
  /**
   * `Read` faz o banco recusar escrita na execução, antes de tocar em linha
   * (`Neo.ClientError.Statement.AccessMode`), e deixa repetir a conexão que caiu
   * no meio — leitura não duplica nada. Ausente, o pedido sai sem o campo, que é
   * `Write`: o que as escritas precisam.
   */
  accessMode?: "Read" | "Write";
  /** Em segundos. O banco encerra a transação: `Transaction.Terminated`. */
  maxExecutionTime?: number;
}

/** A resposta inteira de um statement, antes de virar objetos. */
export interface ResultadoCru {
  fields: string[];
  values: unknown[][];
  /** `r`, `rw`, `w` ou `s` — o banco classifica, e no `EXPLAIN` sem executar. */
  queryType?: string;
  notifications: NotificacaoDoBanco[];
}

export class Neo4jError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "Neo4jError";
  }
}

/** Roda um statement e devolve as linhas como objetos { campo: valor }. */
export async function query<T = Record<string, unknown>>(
  statement: string,
  parameters: Parametros = {},
): Promise<T[]> {
  return linhas<T>({ data: await executar(statement, parameters) });
}

/**
 * Roda um statement e devolve a resposta inteira: colunas, linhas, a
 * classificação do banco e os avisos. `query()` passa por aqui; quem precisa do
 * resto é a Cypher que o chat escreve (`consulta.ts`).
 */
export async function executar(
  statement: string,
  parameters: Parametros = {},
  opcoes: OpcoesDeExecucao = {},
): Promise<ResultadoCru> {
  const { url, user, password } = env.neo4j;

  // Só a conexão é repetida, nunca um pedido que já saiu: `comRetry` sem
  // `leitura` repete apenas os códigos de antes do envio, e por isso vale
  // igual para o Cypher que escreve (regra inviolável 4). Em `Read` o banco não
  // deixa escrever, e a conexão que cai no meio também se repete.
  const { resp, texto } = await comRetry(
    "neo4j",
    async () => {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Basic ${btoa(`${user}:${password}`)}`,
        },
        body: JSON.stringify({ statement, parameters, ...opcoes }),
        cache: "no-store",
      });
      return { resp, texto: await resp.text() };
    },
    { leitura: opcoes.accessMode === "Read" },
  );

  let corpo: RespostaQuery;
  try {
    corpo = texto ? (JSON.parse(texto) as RespostaQuery) : {};
  } catch {
    throw new Neo4jError(`Resposta não-JSON do Neo4j (${resp.status}): ${texto.slice(0, 300)}`);
  }

  if (corpo.errors?.length) {
    const e = corpo.errors[0];
    throw new Neo4jError(e.message, e.code);
  }
  if (!resp.ok) {
    throw new Neo4jError(`Neo4j respondeu ${resp.status}: ${texto.slice(0, 300)}`);
  }

  return {
    fields: corpo.data?.fields ?? [],
    values: corpo.data?.values ?? [],
    queryType: corpo.queryType,
    notifications: corpo.notifications ?? [],
  };
}

/** Mesma coisa, mas exige exatamente uma linha (ou nenhuma). */
export async function queryUm<T = Record<string, unknown>>(
  statement: string,
  parameters: Parametros = {},
): Promise<T | null> {
  const r = await query<T>(statement, parameters);
  return r[0] ?? null;
}

export function linhas<T>(corpo: RespostaQuery): T[] {
  const data = corpo.data;
  if (!data) return [];
  return data.values.map((linha) => {
    const obj: Record<string, unknown> = {};
    data.fields.forEach((campo, i) => {
      obj[campo] = linha[i];
    });
    return obj as T;
  });
}
