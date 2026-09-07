/**
 * O diagnóstico da resposta do modelo.
 *
 * Ele existe por causa de uma sessão real (`mthu6r1y5h`) em que a extração
 * recebeu zero caractere e o log não soube dizer por quê. Vale para os três
 * agentes: todos usam a mesma família de modelo de raciocínio e todos podem
 * levar uma resposta sem texto nenhum.
 */
import { describe, expect, it } from "vitest";
import {
  diagnostico,
  faltouOrcamento,
  textoDaResposta,
  veioDoPensamento,
} from "@/lib/modelos";

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

describe("qual das duas causas foi", () => {
  // A tabela do §4.6 nomeia as duas há duas fatias; durante esse tempo ela foi
  // prescrição escrita e o código repetia a chamada igual nos dois casos.

  it("cortado no meio do pensamento é falta de orçamento", () => {
    expect(faltouOrcamento({ finishReason: "length", text: "" })).toBe(true);
  });

  it("terminar por conta própria não é falta de orçamento, mesmo sem texto", () => {
    // Aqui repetir igual ainda faz sentido: a resposta vazia é intermitente.
    expect(faltouOrcamento({ finishReason: "stop", text: "" })).toBe(false);
    expect(faltouOrcamento({})).toBe(false);
  });
});

describe("de onde sai o texto da resposta", () => {
  it("o texto, quando existe", () => {
    const r = { finishReason: "stop", text: '{"atomos":[]}', reasoningText: "hmm" };
    expect(textoDaResposta(r)).toBe('{"atomos":[]}');
    expect(veioDoPensamento(r)).toBe(false);
  });

  it("o pensamento, quando o modelo escreveu a resposta lá", () => {
    // O modo de falha que a segunda tentativa mascarava acertando por sorte.
    const r = { finishReason: "stop", text: "", reasoningText: '{"atomos":[]}' };
    expect(textoDaResposta(r)).toBe('{"atomos":[]}');
    expect(veioDoPensamento(r)).toBe(true);
  });

  it("NUNCA o pensamento cortado no meio", () => {
    // Em `length` o raciocínio parou onde o orçamento acabou, e `isolarJson`
    // pega do primeiro `{` ao último `}`: casaria um rascunho que o modelo
    // estava abandonando, e a proposta sairia de uma ideia descartada.
    const r = {
      finishReason: "length",
      text: "",
      reasoningText: '{"atomos":[{"tipo":"FATO","texto":"talvez isso não',
    };
    expect(textoDaResposta(r)).toBe("");
    expect(veioDoPensamento(r)).toBe(false);
  });

  it("texto só de espaço conta como vazio", () => {
    const r = { finishReason: "stop", text: "  \n ", reasoningText: '{"atomos":[]}' };
    expect(textoDaResposta(r)).toBe('{"atomos":[]}');
  });
});
