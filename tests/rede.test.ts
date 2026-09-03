import { describe, expect, it, vi } from "vitest";
import { codigoDeRede, comRetry, descricaoDeRede, reconectavel } from "@/lib/rede";

/** O erro como o undici entrega: TypeError genérico, código no `cause`. */
function falhaDeRede(code: string): Error {
  const e = new TypeError("fetch failed");
  (e as { cause?: unknown }).cause = Object.assign(new Error("Connect Timeout Error"), { code });
  return e;
}

const semDormir = { dormir: async () => {} };

describe("classificação do erro de rede", () => {
  it("acha o código dentro do cause, que é onde o undici põe", () => {
    expect(codigoDeRede(falhaDeRede("UND_ERR_CONNECT_TIMEOUT"))).toBe("UND_ERR_CONNECT_TIMEOUT");
  });

  it("erro do serviço não tem código de rede", () => {
    expect(codigoDeRede(new Error("Cypher inválido"))).toBeNull();
    expect(descricaoDeRede(new Error("Cypher inválido"))).toBeNull();
  });

  it("conexão que nem abriu se repete mesmo em escrita: o pedido não saiu", () => {
    for (const code of ["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]) {
      expect(reconectavel(falhaDeRede(code), false)).toBe(true);
    }
  });

  it("conexão que caiu depois de abrir só se repete em leitura", () => {
    expect(reconectavel(falhaDeRede("ECONNRESET"), false)).toBe(false);
    expect(reconectavel(falhaDeRede("ECONNRESET"), true)).toBe(true);
  });
});

describe("comRetry", () => {
  it("a segunda tentativa é a que salva — foi o que a rede fez de verdade", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(falhaDeRede("UND_ERR_CONNECT_TIMEOUT"))
      .mockResolvedValue("proposta");

    await expect(comRetry("r2", fn, semDormir)).resolves.toBe("proposta");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("desiste depois do teto de tentativas, com o erro original", async () => {
    const fn = vi.fn().mockRejectedValue(falhaDeRede("UND_ERR_CONNECT_TIMEOUT"));

    await expect(comRetry("r2", fn, { ...semDormir, tentativas: 3 })).rejects.toThrow(
      "fetch failed",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("erro do serviço sobe na primeira: repetir só faz a tela esperar mais", async () => {
    const fn = vi.fn().mockRejectedValue(new Neo4jFake());

    await expect(comRetry("neo4j", fn, semDormir)).rejects.toBeInstanceOf(Neo4jFake);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("espera entre tentativas, com backoff crescente", async () => {
    const dormiu: number[] = [];
    const fn = vi.fn().mockRejectedValue(falhaDeRede("ECONNREFUSED"));

    await expect(
      comRetry("r2", fn, {
        tentativas: 3,
        dormir: async (ms) => {
          dormiu.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(dormiu).toHaveLength(2);
    expect(dormiu[1]).toBeGreaterThan(dormiu[0]);
  });
});

class Neo4jFake extends Error {}
