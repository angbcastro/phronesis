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
