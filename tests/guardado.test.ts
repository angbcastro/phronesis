/**
 * O recado de fechamento do confirmar: a frase que a home mostra por 3 s.
 *
 * O que se fixa é a frase, que é a parte pura. A leitura e a escrita passam
 * por `sessionStorage`, que não existe aqui — e engolir a falta dele é parte
 * do contrato: sem storage não há recado, e nada mais muda.
 */
import { describe, expect, it } from "vitest";
import { anunciarGuardado, fraseGuardado, lerGuardado } from "@/client/guardado";

describe("a frase do recado", () => {
  it("conta os itens, no singular quando é um", () => {
    expect(fraseGuardado(8)).toBe("guardado · 8 itens");
    expect(fraseGuardado(1)).toBe("guardado · 1 item");
  });

  it("zero item não diz que guardou alguma coisa", () => {
    // Desmarcar tudo e confirmar fecha a sessão sem nada no grafo.
    expect(fraseGuardado(0)).toBe("sessão fechada · nada entrou");
  });
});

describe("sem sessionStorage", () => {
  it("anunciar não estoura, e ler devolve nada", () => {
    expect(() => anunciarGuardado(3)).not.toThrow();
    expect(lerGuardado()).toBeNull();
  });
});
