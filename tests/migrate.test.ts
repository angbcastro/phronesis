import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statements } from "../scripts/migrate";

const migration = readFileSync("db/migrations/001_sessao.cypher", "utf8");

describe("parser de migration", () => {
  it("separa os statements e descarta comentários", () => {
    expect(statements("// nota\nCREATE (a);\n\nCREATE (b);\n")).toEqual(["CREATE (a)", "CREATE (b)"]);
  });

  it("ignora arquivo só de comentário", () => {
    expect(statements("// nada aqui\n")).toEqual([]);
  });
});

describe("001_sessao.cypher", () => {
  it("garante id único de sessão", () => {
    expect(migration).toMatch(/CONSTRAINT sessao_id IF NOT EXISTS/);
    expect(migration).toMatch(/REQUIRE s\.id IS UNIQUE/);
  });

  it("é seguro reaplicar", () => {
    expect(statements(migration).every((s) => /IF NOT EXISTS/.test(s))).toBe(true);
  });

  it("não cria label fora do escopo da slice 1", () => {
    const cypher = statements(migration).join(" ");
    expect(cypher).toMatch(/:Sessao/);
    expect(cypher).not.toMatch(/:Atomo|:Entidade|:Pessoa|:Projeto|:Objetivo|:Foco|:Pergunta/);
  });
});

describe("004_fusao_entidade.cypher", () => {
  const m004 = readFileSync("db/migrations/004_fusao_entidade.cypher", "utf8");

  it("declara o índice de status, que toda leitura de entidade usa", () => {
    expect(m004).toMatch(/CREATE INDEX entidade_status IF NOT EXISTS/);
    expect(m004).toMatch(/FOR \(e:Entidade\) ON \(e\.status\)/);
  });

  it("é segura reaplicar", () => {
    expect(statements(m004).every((s) => /IF NOT EXISTS/.test(s))).toBe(true);
  });

  it("não migra dado — a defesa contra `status` ausente é na leitura", () => {
    // Preencher agora arrumaria os nós de hoje e não o que um deploy antigo
    // criasse amanhã. Por isso nenhum SET, MERGE ou CREATE de nó aqui.
    const cypher = statements(m004).join(" ");
    expect(cypher).not.toMatch(/\bSET\b|\bMERGE\b|\bMATCH\b/);
  });

  it("documenta as duas arestas novas, que Neo4j não declara", () => {
    expect(m004).toMatch(/:FUNDIDA_EM/);
    expect(m004).toMatch(/:DISTINTA_DE/);
  });
});
