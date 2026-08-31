/**
 * A escrita no grafo. É o único lugar que cria :Atomo e :Entidade, então é
 * aqui que as travas de idempotência precisam estar visíveis num teste.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));

import { STATUS_ATOMO_ATIVO, gravarAtomos, gravarEntidades } from "@/lib/atomos";
import { query } from "@/lib/neo4j";
import type { AtomoParaGravar, EntidadeParaGravar } from "@/lib/atomos";

const consulta = vi.mocked(query);

const cypherDe = (i: number) => String(consulta.mock.calls[i][0]);
const paramsDe = (i: number) => consulta.mock.calls[i][1] as Record<string, unknown>;

const atomo = (extra: Partial<AtomoParaGravar> = {}): AtomoParaGravar => ({
  id: "s1-0",
  texto: "O contrato da Exxmed vai atrasar",
  tipo: "FATO",
  inicios_s: [12.5],
  fins_s: [15],
  ancoras: ["exata"],
  sobre: "exxmed",
  menciona: [],
  prompt_version: "extracao-3",
  modelo: "zai/glm-5.3-flash",
  ...extra,
});

beforeEach(() => {
  consulta.mockClear();
  consulta.mockResolvedValue([]);
});

describe("entidades", () => {
  it("uma consulta por tipo, com o label literal", () => {
    // Neo4j não aceita label vindo de parâmetro e o projeto não usa APOC.
    const entidades: EntidadeParaGravar[] = [
      { nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" },
      { nome: "Phronesis", nome_normalizado: "phronesis", tipo: "Projeto" },
    ];
    return gravarEntidades(entidades).then(() => {
      expect(consulta).toHaveBeenCalledTimes(2);
      expect(cypherDe(0)).toContain("n:Pessoa");
      expect(cypherDe(1)).toContain("n:Projeto");
    });
  });

  it("não consulta o banco para um tipo sem entidade nenhuma", async () => {
    await gravarEntidades([{ nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" }]);
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("MERGE por nome_normalizado — é a trava contra duplicata", async () => {
    await gravarEntidades([{ nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" }]);
    expect(cypherDe(0)).toContain("MERGE (n:Entidade { nome_normalizado: e.nome_normalizado })");
  });

  it("entidade que já existe mantém grafia e labels", async () => {
    // ON CREATE, não SET: extração não renomeia nem troca tipo do que existe.
    await gravarEntidades([{ nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" }]);
    const cypher = cypherDe(0);
    expect(cypher).toContain("ON CREATE SET");
    expect(cypher).not.toMatch(/\n\s*SET n\./);
  });

  it("lista vazia não fala com o banco", async () => {
    await gravarEntidades([]);
    expect(consulta).not.toHaveBeenCalled();
  });
});

describe("átomos", () => {
  it("MERGE pelo id determinístico — confirmar duas vezes não duplica", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T02:01:26.718Z");
    expect(cypherDe(0)).toContain("MERGE (at:Atomo { id: a.id })");
  });

  it("grava as âncoras como listas paralelas (migration 003)", async () => {
    await gravarAtomos("s1", [atomo({ inicios_s: [1, 40], fins_s: [3, 45], ancoras: ["exata", "aproximada"] })], "2026-08-31T00:00:00.000Z");
    const cypher = cypherDe(0);
    expect(cypher).toContain("at.inicios_s = a.inicios_s");
    expect(cypher).toContain("at.fins_s = a.fins_s");
    expect(cypher).toContain("at.ancoras = a.ancoras");
  });

  it("valido_em é a data da sessão, não a de agora", async () => {
    // É o eixo do "como eu estava em julho": vale quando eu falei.
    const iniciada = "2026-07-14T21:00:00.000Z";
    await gravarAtomos("s1", [atomo()], iniciada);
    expect(paramsDe(0).valido_em).toBe(iniciada);
    expect(paramsDe(0).agora).not.toBe(iniciada);
  });

  it("todo átomo nasce ativo, com procedência (regra 7)", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(paramsDe(0).status).toBe(STATUS_ATOMO_ATIVO);
    const cypher = cypherDe(0);
    expect(cypher).toContain("at.prompt_version = a.prompt_version");
    expect(cypher).toContain("at.modelo = a.modelo");
  });

  it("criado_em só no ON CREATE — reconfirmar não reescreve o nascimento", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(cypherDe(0)).toContain("ON CREATE SET at.criado_em = $agora");
  });

  it("liga :GEROU e :SOBRE numa consulta só", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    const cypher = cypherDe(0);
    expect(cypher).toContain("MERGE (s)-[:GEROU]->(at)");
    expect(cypher).toContain("MERGE (at)-[:SOBRE]->(e)");
  });

  it("sem menção, não roda a segunda consulta", async () => {
    // UNWIND de lista vazia mataria a linha inteira, e átomo sem menção é o caso comum.
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("as menções vão achatadas, uma linha por par", async () => {
    await gravarAtomos(
      "s1",
      [atomo({ menciona: ["rafa", "phronesis"] }), atomo({ id: "s1-1", menciona: ["rafa"] })],
      "2026-08-31T00:00:00.000Z",
    );
    expect(consulta).toHaveBeenCalledTimes(2);
    expect(cypherDe(1)).toContain("MERGE (a)-[:MENCIONA]->(e)");
    expect(paramsDe(1).mencoes).toEqual([
      { atomo_id: "s1-0", entidade: "rafa" },
      { atomo_id: "s1-0", entidade: "phronesis" },
      { atomo_id: "s1-1", entidade: "rafa" },
    ]);
  });

  it("nenhum átomo aprovado não fala com o banco", async () => {
    await gravarAtomos("s1", [], "2026-08-31T00:00:00.000Z");
    expect(consulta).not.toHaveBeenCalled();
  });

  it("átomo rejeitado não é gravado — nem com status", async () => {
    // Regra 6: `rejeitado` é para tirar do grafo o que já entrou, não para
    // registrar o que nunca entrou. Quem filtra é a rota; aqui só chega aprovado.
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(JSON.stringify(paramsDe(0))).not.toContain("rejeitado");
  });
});
