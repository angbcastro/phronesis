/**
 * O diagnóstico da resposta do modelo.
 *
 * Ele existe por causa de uma sessão real (`mthu6r1y5h`) em que a extração
 * recebeu zero caractere e o log não soube dizer por quê. Vale para os três
 * agentes: todos usam a mesma família de modelo de raciocínio e todos podem
 * levar uma resposta sem texto nenhum.
 */
import { describe, expect, it } from "vitest";
import { diagnostico } from "@/lib/modelos";

describe("o diagnóstico da resposta vazia", () => {
  // "Vieram 0 caractere(s)" não distingue duas causas com consertos opostos.
  // Foi a dúvida que a sessão mthu6r1y5h deixou, e é o que estes campos fecham.

  it("o orçamento estourado aparece como tal", () => {
    const d = diagnostico({
      finishReason: "length",
      text: "",
      usage: { inputTokens: 4200, outputTokens: 8000, outputTokenDetails: { reasoningTokens: 8000 } },
    });
    expect(d).toContain("finishReason=length");
    expect(d).toContain("saida=8000");
    expect(d).toContain("raciocinio=8000");
    expect(d).toContain("texto=0 char");
  });

  it("o texto que foi parar no raciocínio se distingue do orçamento estourado", () => {
    // Aqui a saída sobrou e o modelo terminou por conta própria: o JSON existe,
    // só não veio na parte de texto. A segunda tentativa acertaria por sorte.
    const d = diagnostico({
      finishReason: "stop",
      text: "",
      reasoningText: '{"atomos":[]}',
      usage: { inputTokens: 4200, outputTokens: 300, outputTokenDetails: { reasoningTokens: 290 } },
    });
    expect(d).toContain("finishReason=stop");
    expect(d).toContain("texto=0 char");
    expect(d).toContain("pensamento=13 char");
  });

  it("campo que o provedor não mandou vira ?, e não derruba o log", () => {
    // Diagnóstico que estoura no meio de um erro é pior que diagnóstico nenhum.
    expect(diagnostico({})).toBe(
      "finishReason=? entrada=? saida=? raciocinio=? texto=0 char pensamento=0 char",
    );
  });
});
