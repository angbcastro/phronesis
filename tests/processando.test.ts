/**
 * O corredor entre parar de falar e revisar.
 *
 * O que se protege aqui é a única decisão dele que não é cosmética: **quando
 * empurrar a sessão**. Empurrar demais paga uma chamada de modelo à toa;
 * empurrar de menos deixa a sessão parada para sempre, com texto no R2 e
 * nenhuma proposta — que foi exatamente o beco em que `transcrito` ficou.
 */
import { describe, expect, it } from "vitest";
import { legenda, precisaFinalizar } from "@/components/Processando";

describe("quando o corredor chama /finalizar", () => {
  it("sessão que nunca foi fechada precisa — é o caminho normal do botão", () => {
    expect(precisaFinalizar("gravando")).toBe(true);
  });

  it("transcrita e sem proposta precisa: é o retry do waitUntil perdido", () => {
    expect(precisaFinalizar("transcrito")).toBe(true);
  });

  it("quebrada precisa — /finalizar é o retry manual", () => {
    expect(precisaFinalizar("erro")).toBe(true);
  });

  it("o que já está andando sozinho não é empurrado de novo", () => {
    for (const s of ["finalizando", "transcrevendo", "extraindo"]) {
      expect(precisaFinalizar(s), s).toBe(false);
    }
  });

  it("o que já acabou não é reprocessado", () => {
    for (const s of ["em_revisao", "confirmada"]) {
      expect(precisaFinalizar(s), s).toBe(false);
    }
  });
});

describe("o verbo do passo atual", () => {
  it("transcrita ou extraindo é a mesma espera, do meu lado", () => {
    expect(legenda("transcrito", false)).toBe("lendo o que você disse…");
    expect(legenda("extraindo", false)).toBe("lendo o que você disse…");
  });

  it("antes disso, o que está acontecendo é o áudio", () => {
    expect(legenda("finalizando", false)).toBe("guardando o áudio…");
    expect(legenda("transcrevendo", false)).toBe("transcrevendo…");
  });
});
