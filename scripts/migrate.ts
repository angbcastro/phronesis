/**
 * Aplica db/migrations/*.cypher em ordem, pela HTTP Query API.
 *
 * Não existe tabela de controle: nesta slice o grafo tem um único label
 * (:Sessao), então nada de nó :Migration. Toda migration é escrita com
 * `IF NOT EXISTS` / `MERGE` e é segura de reaplicar.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pastaMigrations = join(raiz, "db", "migrations");

function envObrigatoria(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Variável de ambiente ausente: ${nome}`);
    process.exit(1);
  }
  return v;
}

/** Divide o arquivo em statements, ignorando comentários `//` e linhas vazias. */
export function statements(cypher: string): string[] {
  return cypher
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function rodar(statement: string, url: string, auth: string): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: auth,
    },
    body: JSON.stringify({ statement }),
  });
  const corpo = await resp.json().catch(() => ({}) as Record<string, unknown>);
  const errors = (corpo as { errors?: { message: string }[] }).errors;
  if (errors?.length) throw new Error(errors[0].message);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(corpo)}`);
}

async function main() {
  const url = envObrigatoria("NEO4J_QUERY_URL");
  const auth =
    "Basic " +
    Buffer.from(`${envObrigatoria("NEO4J_USER")}:${envObrigatoria("NEO4J_PASSWORD")}`).toString(
      "base64",
    );

  const arquivos = (await readdir(pastaMigrations)).filter((f) => f.endsWith(".cypher")).sort();

  if (arquivos.length === 0) {
    console.log("Nenhuma migration em db/migrations/");
    return;
  }

  for (const arquivo of arquivos) {
    const cypher = await readFile(join(pastaMigrations, arquivo), "utf8");
    const lista = statements(cypher);
    process.stdout.write(`${arquivo} — ${lista.length} statement(s) `);
    for (const s of lista) {
      await rodar(s, url, auth);
      process.stdout.write(".");
    }
    process.stdout.write(" ok\n");
  }
  console.log("Migrations aplicadas.");
}

// Só roda quando chamado pela CLI — o parser é importado pelos testes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("\nFalhou:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
