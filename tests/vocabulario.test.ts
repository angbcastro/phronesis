import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keyterms, MAX_CARACTERES, MAX_TERMOS, termos } from "@/lib/vocabulario";
import { palavrasDoMetadata, palavrasDosSegmentos } from "@/lib/stt";

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
});

describe("keyterms mandados ao STT", () => {
  it("passa a lista adiante como termos de biasing", () => {
    expect(keyterms(termos(arquivo))).toContain("Rodozanco");
  });

  it("respeita o teto de 100 termos da API", () => {
    const lista = keyterms(Array.from({ length: 250 }, (_, i) => `Nome${i}`));
    expect(lista).toHaveLength(MAX_TERMOS);
  });

  it("descarta termo longo demais em vez de mandar truncado pela metade", () => {
    const longo = "x".repeat(MAX_CARACTERES + 1);
    expect(keyterms(["Exxmed", longo])).toEqual(["Exxmed"]);
  });

  it("não repete o mesmo nome com outra caixa", () => {
    expect(keyterms(["Exxmed", "exxmed", "EXXMED"])).toEqual(["Exxmed"]);
  });

  it("lista vazia não vira keyterm nenhum", () => {
    expect(keyterms([])).toEqual([]);
  });
});

describe("timestamps devolvidos pelo gateway", () => {
  it("prefere timestamps por palavra quando o provedor os expõe", () => {
    const r = palavrasDoMetadata({ xai: { words: [{ text: "oi", start: 0.2, end: 0.5 }] } });
    expect(r).toEqual([{ palavra: "oi", inicio: 0.2, fim: 0.5 }]);
  });

  it("aceita o formato alternativo `word`", () => {
    const r = palavrasDoMetadata({ openai: { words: [{ word: "oi", start: 0, end: 1 }] } });
    expect(r).toEqual([{ palavra: "oi", inicio: 0, fim: 1 }]);
  });

  it("devolve null quando não há palavra nenhuma no metadata", () => {
    expect(palavrasDoMetadata({ xai: { duration: 30 } })).toBeNull();
    expect(palavrasDoMetadata(undefined)).toBeNull();
    expect(palavrasDoMetadata({ xai: { words: [] } })).toBeNull();
  });

  it("descarta palavra sem timestamp utilizável", () => {
    expect(palavrasDoMetadata({ xai: { words: [{ text: "oi" }] } })).toBeNull();
  });

  it("cai para segmento quando é só isso que vem", () => {
    const r = palavrasDosSegmentos([
      { text: " falei disso ", startSecond: 0, endSecond: 4.2 },
      { text: "   ", startSecond: 4.2, endSecond: 4.3 },
    ]);
    expect(r).toEqual([{ palavra: "falei disso", inicio: 0, fim: 4.2 }]);
  });
});
