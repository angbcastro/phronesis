/**
 * O dump do grafo: a forma do objeto e a chave que se poda sozinha.
 *
 * O que não se testa aqui é o Cypher — ele mora numa constante e só o banco
 * responde por ele. O que se testa é o que o resto do sistema promete: que o
 * vetor não entra, e que a chave gira.
 */
import { describe, expect, it } from "vitest";
import { montarDump, objetoDePares } from "@/lib/backup";
import { chaveBackup } from "@/lib/chaves";

describe("a chave do backup gira pelo dia do mês", () => {
  it("zera à esquerda, para as 31 chaves ordenarem como texto", () => {
    expect(chaveBackup(new Date("2026-09-07T06:00:00Z"))).toBe("backup/grafo-07.json");
    expect(chaveBackup(new Date("2026-09-30T06:00:00Z"))).toBe("backup/grafo-30.json");
  });

  /**
   * A mesma chave no mês seguinte é o mecanismo, não um efeito colateral: é a
   * sobrescrita que poda a janela sem nenhum LIST e sem nenhum DELETE — e
   * `r2.ts` não tem LIST, por decisão.
   */
  it("repete a chave mês a mês, que é o que poda a janela", () => {
    expect(chaveBackup(new Date("2026-09-07T06:00:00Z"))).toBe(
      chaveBackup(new Date("2026-10-07T06:00:00Z")),
    );
  });
});

describe("a forma do dump", () => {
  it("vira objeto a partir dos pares que o Cypher devolve", () => {
    expect(objetoDePares([["nome", "Rapha"], ["canonico", true]])).toEqual({
      nome: "Rapha",
      canonico: true,
    });
  });

  it("carrega nós, arestas e a hora, e nada mais", () => {
    const dump = montarDump(
      [{ labels: ["Entidade", "Pessoa"], pares: [["id", "e1"], ["nome", "Rapha"]] }],
      [{ de: "a1", tipo: "SOBRE", para: "e1", props: {} }],
      new Date("2026-09-12T06:00:00Z"),
    );

    expect(dump.gerado_em).toBe("2026-09-12T06:00:00.000Z");
    expect(dump.nos).toEqual([
      { labels: ["Entidade", "Pessoa"], props: { id: "e1", nome: "Rapha" } },
    ]);
    expect(dump.arestas).toEqual([{ de: "a1", tipo: "SOBRE", para: "e1", props: {} }]);
  });

  /**
   * O vetor sai no Cypher, não aqui — mas se um dia alguém trocar a consulta
   * por um `properties(n)` inocente, é este teste que fica sem par e a omissão
   * apareceria como 48 MB de JSON. Ele documenta a intenção no lugar onde ela
   * se lê.
   */
  it("não inventa embedding para quem não mandou", () => {
    const dump = montarDump([{ labels: ["Atomo"], pares: [["id", "a1"], ["texto", "oi"]] }], []);
    expect(Object.keys(dump.nos[0].props)).toEqual(["id", "texto"]);
  });
});
