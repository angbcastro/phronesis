import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statements } from "../scripts/migrate";
import { DIMENSAO_EMBEDDING } from "@/lib/modelos";

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

describe("007_historia_organizacao.cypher", () => {
  const m007 = readFileSync("db/migrations/007_historia_organizacao.cypher", "utf8");

  it("é no-op — nem valor de propriedade nem label se declaram aqui", () => {
    // Como a 003 e a 005: o Aura Free não tem constraint de valor, e label novo
    // passa a existir quando o primeiro nó o recebe, no confirmar.
    expect(statements(m007)).toEqual([]);
  });

  it("documenta os dois contratos que mudaram, que é para o que ela existe", () => {
    expect(m007).toMatch(/HISTORIA \| ROTINA/);
    expect(m007).toMatch(/:Organizacao/);
    expect(m007).toMatch(/TIPOS_SEMPRE_EU/);
  });

  it("diz que não reclassifica o que já está no grafo", () => {
    // A empresa que hoje é :Pessoa continua :Pessoa até eu trocar em /entidades.
    expect(m007).toMatch(/SEM MIGRAÇÃO DE DADO/);
  });
});

describe("006_embedding.cypher", () => {
  const m006 = readFileSync("db/migrations/006_embedding.cypher", "utf8");
  const lista = statements(m006);

  it("declara os dois índices vetoriais, e só eles (critério 1)", () => {
    expect(lista).toHaveLength(2);
    expect(m006).toMatch(/CREATE VECTOR INDEX atomo_embedding IF NOT EXISTS/);
    expect(m006).toMatch(/CREATE VECTOR INDEX entidade_embedding IF NOT EXISTS/);
    expect(lista[0]).toMatch(/FOR \(a:Atomo\) ON \(a\.embedding\)/);
    expect(lista[1]).toMatch(/FOR \(e:Entidade\) ON \(e\.embedding\)/);
  });

  it("a dimensão declarada é a que a porta do vetor conhece", () => {
    // A única coisa desta slice que amarra o schema: trocar para um modelo de
    // outra dimensão exige DROP e recriar, por migration nova.
    for (const s of lista) {
      expect(s).toContain(`\`vector.dimensions\`: ${DIMENSAO_EMBEDDING}`);
      expect(s).toMatch(/`vector\.similarity_function`: 'cosine'/);
    }
  });

  it("é segura reaplicar — rodar de novo é no-op (critério 1)", () => {
    expect(lista.every((s) => /IF NOT EXISTS/.test(s))).toBe(true);
  });

  it("não migra dado: nenhum vetor é calculado aqui", () => {
    // Quem preenche são as duas rotas de embutir. Fosse aqui, o retrofill
    // custaria uma migration em vez de uma chamada de rota.
    const cypher = lista.join(" ");
    expect(cypher).not.toMatch(/\bSET\b|\bMERGE\b|\bMATCH\b/);
  });

  it("não fixa número de HNSW que ninguém calibrou", () => {
    // O padrão medido em 2026-09-02 (SCALAR, m 16, ef_construction 100) é o que
    // a migration herda de propósito.
    // Nos statements, não no arquivo: o comentário fala dos padrões medidos
    // de propósito, e é o Cypher que não pode fixá-los.
    expect(lista.join(" ")).not.toMatch(/hnsw\.|quantization/);
  });

  it("documenta os campos novos, que Neo4j não declara", () => {
    expect(m006).toMatch(/embedding_modelo/);
    expect(m006).toMatch(/embedding_fonte/);
  });
});
