/**
 * Fundir, renomear, recusar.
 *
 * O que precisa estar visível num teste é que **nada é apagado** (regra 6) e
 * que a grafia morta vira alias — é isso que faz a fusão valer para a sessão de
 * amanhã, e não só arrumar o passado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));

import { query } from "@/lib/neo4j";
import {
  chaveDoPar,
  fundir,
  FusaoError,
  marcarDistintas,
  renomear,
  STATUS_ENTIDADE_FUNDIDA,
} from "@/lib/fusao";

const consulta = vi.mocked(query);
const todoCypher = () => consulta.mock.calls.map((c) => String(c[0])).join("\n---\n");

/** As duas existem e a perdedora ainda não foi fundida. */
function grafoComAsDuas() {
  consulta.mockImplementation(async (statement: string) => {
    if (statement.includes("jaFundida")) {
      return [{ v: "id-v", p: "id-p", jaFundida: false }] as never;
    }
    if (statement.includes("count(DISTINCT a) AS n")) return [{ n: 2 }] as never;
    return [] as never;
  });
}

beforeEach(() => {
  consulta.mockReset();
  consulta.mockResolvedValue([]);
});

describe("fundir", () => {
  it("não apaga a perdedora: marca status e cria a aresta de alias", async () => {
    grafoComAsDuas();
    await fundir("Exxmed", "Exx Med");

    const cypher = todoCypher();
    expect(cypher).toContain("MERGE (p)-[:FUNDIDA_EM]->(v)");
    expect(cypher).toContain("SET p.status = $fundida");
    // Regra 6: nada de DELETE em nó. As arestas migradas, sim, essas somem.
    expect(cypher).not.toMatch(/DELETE\s+p\b/);
    expect(cypher).not.toMatch(/DETACH DELETE/);
  });

  it("migra :SOBRE e :MENCIONA com MERGE no destino", async () => {
    grafoComAsDuas();
    const r = await fundir("Exxmed", "Exx Med");

    const cypher = todoCypher();
    expect(cypher).toContain("MERGE (a)-[:SOBRE]->(v)");
    expect(cypher).toContain("MERGE (a)-[:MENCIONA]->(v)");
    expect(r.atomos_migrados).toBe(4); // 2 por tipo, no mock
  });

  it("normaliza os dois lados — a chave é que casa, não a grafia", async () => {
    grafoComAsDuas();
    const r = await fundir("  Exxmed  ", "EXX MED");
    expect(r.vencedora).toBe("exxmed");
    expect(r.perdedora).toBe("exx med");
  });

  it("fundir de novo não refaz nada", async () => {
    consulta.mockImplementation(async (statement: string) => {
      if (statement.includes("jaFundida")) {
        return [{ v: "id-v", p: "id-p", jaFundida: true }] as never;
      }
      return [] as never;
    });

    const r = await fundir("Exxmed", "Exx Med");
    expect(r.atomos_migrados).toBe(0);
    expect(todoCypher()).not.toContain("MERGE (a)-[:SOBRE]->(v)");
  });

  it("recusa fundir uma entidade nela mesma", async () => {
    await expect(fundir("Exxmed", "exxmed")).rejects.toThrow(FusaoError);
  });

  it("recusa quando um dos lados não está no grafo", async () => {
    consulta.mockImplementation(async (statement: string) =>
      statement.includes("jaFundida") ? ([{ v: "id-v", p: null, jaFundida: false }] as never) : ([] as never),
    );
    await expect(fundir("Exxmed", "Fantasma")).rejects.toThrow(/não está no grafo/);
  });
});

describe("renomear", () => {
  it("a grafia velha vira alias do nome novo", async () => {
    await renomear("meu pai", "Antônio");

    const cypher = todoCypher();
    expect(cypher).toContain("SET e.nome = $novo, e.nome_normalizado = $chaveNova");
    expect(cypher).toContain("MERGE (alias)-[:FUNDIDA_EM]->(e)");
    // O alias nasce já fundido: ele nunca deve aparecer como entidade viva.
    const params = consulta.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(params.fundida).toBe(STATUS_ENTIDADE_FUNDIDA);
  });

  it("mudar só a caixa não cria alias — a chave é a mesma", async () => {
    await renomear("isinha", "Isinha");
    const cypher = todoCypher();
    expect(cypher).toContain("SET e.nome = $novo");
    expect(cypher).not.toContain("FUNDIDA_EM");
  });

  it("recusa nome que já é de outra entidade — isso é fusão, não renome", async () => {
    consulta.mockImplementation(async (statement: string) =>
      statement.includes("RETURN e.id AS id") ? ([{ id: "outro" }] as never) : ([] as never),
    );
    await expect(renomear("meu pai", "Isinha")).rejects.toThrow(/funda as duas/);
  });

  it("recusa nome vazio", async () => {
    await expect(renomear("meu pai", "   ")).rejects.toThrow(FusaoError);
  });
});

describe("recusar um par", () => {
  it("grava a aresta que impede a pergunta de voltar", async () => {
    await marcarDistintas("Marina", "Mariana");
    expect(todoCypher()).toContain("MERGE (x)-[:DISTINTA_DE]->(y)");
  });

  it("recusa marcar uma entidade como distinta dela mesma", async () => {
    await expect(marcarDistintas("Marina", "marina")).rejects.toThrow(FusaoError);
  });
});

describe("chave do par", () => {
  it("não depende da ordem — senão a recusa só valeria num sentido", () => {
    expect(chaveDoPar("a", "b")).toBe(chaveDoPar("b", "a"));
  });
});
