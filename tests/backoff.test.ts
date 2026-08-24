import { describe, expect, it } from "vitest";
import { atrasoBackoff, TETO_MS } from "@/lib/backoff";

describe("backoff da fila de upload", () => {
  it("cresce a cada tentativa", () => {
    const atrasos = [0, 1, 2, 3].map((t) => atrasoBackoff(t, 0));
    expect(atrasos).toEqual([1000, 2000, 4000, 8000]);
  });

  it("para de crescer no teto", () => {
    expect(atrasoBackoff(20, 0)).toBe(TETO_MS);
  });

  it("adiciona jitter para não sincronizar retries", () => {
    expect(atrasoBackoff(0, 1)).toBeGreaterThan(atrasoBackoff(0, 0));
    expect(atrasoBackoff(0, 1)).toBeLessThanOrEqual(1250);
  });

  it("rede fora por 1 min cabe em poucas tentativas, sem desistir", () => {
    let total = 0;
    let n = 0;
    while (total < 60_000) {
      total += atrasoBackoff(n, 0);
      n++;
    }
    expect(n).toBeLessThanOrEqual(6);
  });
});
