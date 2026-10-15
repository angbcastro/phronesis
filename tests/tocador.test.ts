/**
 * O tocador dos trechos: o que ouvir, recortado em blocos, e o que o ▶ diz.
 *
 * O que se prende é a regra da decisão 4 (`Specs/interface-onda-3.md`): de 2 s
 * antes do trecho até o fim dele; a margem não entra no bloco anterior; o fim
 * atravessa para o bloco seguinte; sem fim, até o fim do bloco.
 */
import { describe, expect, it } from "vitest";
import { intervaloDeEscuta, nomeDoOuvir, textoDoOuvir } from "@/client/tocador";
import type { BlocoAbsoluto } from "@/lib/tipos";

const bloco = (i: number): BlocoAbsoluto => ({ i, texto: "", offset_s: i * 30 });
const GRAVACAO = [bloco(0), bloco(1), bloco(2), bloco(3)];

describe("o que ouvir", () => {
  it("de 2 s antes até o fim, dentro de um bloco só", () => {
    // 72 s é o segundo 12 do bloco 2.
    expect(intervaloDeEscuta(GRAVACAO, 72, 79)).toEqual([{ i: 2, de: 10, ate: 19 }]);
  });

  it("a margem para no começo do bloco do trecho", () => {
    expect(intervaloDeEscuta(GRAVACAO, 61, 65)).toEqual([{ i: 2, de: 0, ate: 5 }]);
  });

  it("o fim atravessa a borda e continua no bloco seguinte", () => {
    expect(intervaloDeEscuta(GRAVACAO, 85, 95)).toEqual([
      { i: 2, de: 23, ate: null },
      { i: 3, de: 0, ate: 5 },
    ]);
  });

  it("sem fim, toca até o fim do bloco", () => {
    expect(intervaloDeEscuta(GRAVACAO, 40, null)).toEqual([{ i: 1, de: 8, ate: null }]);
  });

  it("fim antes do início vale como sem fim", () => {
    expect(intervaloDeEscuta(GRAVACAO, 40, 39)).toEqual([{ i: 1, de: 8, ate: null }]);
  });

  it("a importação antiga tem um bloco só, com offset zero", () => {
    expect(intervaloDeEscuta([bloco(0)], 300, 310)).toEqual([{ i: 0, de: 298, ate: 310 }]);
  });

  it("os blocos podem vir fora de ordem", () => {
    const fora = [bloco(2), bloco(0), bloco(1)];
    expect(intervaloDeEscuta(fora, 45, 50)).toEqual([{ i: 1, de: 13, ate: 20 }]);
  });

  it("sem blocos, não há o que tocar", () => {
    expect(intervaloDeEscuta([], 10, 12)).toEqual([]);
  });
});

describe("o que o ▶ diz", () => {
  it("parado, carregando, tocando e falhou", () => {
    expect(textoDoOuvir(null, 192, 199)).toBe("▶ 03:12");
    expect(textoDoOuvir("carregando", 192, 199)).toBe("… 03:12");
    expect(textoDoOuvir("tocando", 192, 199)).toBe("■ 03:10–03:19");
    expect(textoDoOuvir("tocando", 192, null)).toBe("■ 03:10");
    expect(textoDoOuvir("falhou", 192, 199)).toBe("sem áudio");
  });

  it("quem ouve a tela sabe o que o toque vai fazer", () => {
    expect(nomeDoOuvir(null, 192)).toBe("ouvir a partir de 03:12");
    expect(nomeDoOuvir("tocando", 192)).toBe("parar o trecho de 03:12");
  });
});
