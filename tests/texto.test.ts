/**
 * A normalização mora num lugar só porque duas coisas dependem dela e não
 * podem divergir: o casamento de offsets e o `nome_normalizado`, que é chave
 * única no banco. Se divergissem, "Rodozanco" acharia o áudio certo e ainda
 * assim criaria um segundo nó no grafo.
 */
import { describe, expect, it } from "vitest";
import { normalizar, tokenizar } from "@/lib/texto";

describe("normalização", () => {
  it("tira acento, caixa e pontuação — o modelo pontua do jeito dele", () => {
    expect(normalizar("Reunião, difícil!")).toBe("reuniao  dificil");
    expect(tokenizar("Reunião, difícil!")).toEqual(["reuniao", "dificil"]);
  });

  it("mantém número, que é parte de nome de verdade", () => {
    expect(tokenizar("Projeto 2026")).toEqual(["projeto", "2026"]);
  });

  it("texto sem letra nenhuma vira lista vazia, não ['']", () => {
    expect(tokenizar("… — !")).toEqual([]);
    expect(tokenizar("")).toEqual([]);
  });
});
