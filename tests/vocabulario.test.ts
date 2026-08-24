import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { montarPrompt, termos } from "@/lib/vocabulario";
import { mapearPalavras } from "@/lib/stt";

const arquivo = readFileSync("config/vocabulario.txt", "utf8");

describe("config/vocabulario.txt", () => {
  it("ignora comentários e linhas vazias", () => {
    expect(termos("# nota\n\nRodozanco\n  Exxmed  \n")).toEqual(["Rodozanco", "Exxmed"]);
  });

  it("carrega os nomes próprios do arquivo de verdade", () => {
    const lista = termos(arquivo);
    expect(lista).toContain("Rodozanco");
    expect(lista).toContain("Exxmed");
    expect(lista.every((t) => !t.startsWith("#"))).toBe(true);
  });

  it("injeta os nomes no prompt inicial do STT", () => {
    const prompt = montarPrompt(termos(arquivo));
    expect(prompt).toContain("Rodozanco");
    expect(prompt).toContain("Exxmed");
  });

  it("não manda prompt quando a lista está vazia", () => {
    expect(montarPrompt([])).toBe("");
  });

  it("respeita o limite de prompt do Whisper", () => {
    const prompt = montarPrompt(Array.from({ length: 500 }, (_, i) => `Nome${i}`));
    expect(prompt.length).toBeLessThanOrEqual(850);
    expect(prompt.endsWith(".")).toBe(true);
  });
});

describe("resposta do STT", () => {
  it("traduz as palavras com timestamp para o formato interno", () => {
    const r = mapearPalavras({ text: "oi", words: [{ word: "oi", start: 0.2, end: 0.5 }] });
    expect(r).toEqual([{ palavra: "oi", inicio: 0.2, fim: 0.5 }]);
  });

  it("aguenta resposta sem timestamps", () => {
    expect(mapearPalavras({ text: "oi" })).toEqual([]);
  });
});
