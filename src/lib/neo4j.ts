/**
 * Cliente Neo4j pela HTTP Query API.
 *
 * Nunca driver Bolt: serverless não sustenta pool de conexões (CLAUDE.md).
 * NEO4J_QUERY_URL aponta para o endpoint completo, ex.:
 *   https://<id>.databases.neo4j.io/db/<banco>/query/v2
 * O <banco> vem do NEO4J_DATABASE das credenciais do Aura — não é sempre "neo4j".
 */
import { env } from "./env";

type Parametros = Record<string, unknown>;

interface RespostaQuery {
  data?: { fields: string[]; values: unknown[][] };
  errors?: { code: string; message: string }[];
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
  const { url, user, password } = env.neo4j;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${user}:${password}`)}`,
    },
    body: JSON.stringify({ statement, parameters }),
    cache: "no-store",
  });

  const texto = await resp.text();
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

  return linhas<T>(corpo);
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
