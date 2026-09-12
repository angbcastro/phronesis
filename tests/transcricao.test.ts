import { describe, expect, it } from "vitest";
import {
  absolutizarPalavras,
  concatenar,
  juntarTexto,
  offsetDoBloco,
  prefixoContiguo,
} from "@/lib/transcricao";
import type { TranscricaoBloco } from "@/lib/tipos";

const bloco = (
  i: number,
  texto: string,
  palavras: [string, number, number][],
  granularidade: "palavra" | "segmento" = "palavra",
): TranscricaoBloco => ({
  i,
  texto,
  palavras: palavras.map(([palavra, inicio, fim]) => ({ palavra, inicio, fim })),
  modelo: "xai/grok-stt",
  granularidade,
});

describe("offsets absolutos", () => {
  it("soma 30 × i ao offset relativo do bloco", () => {
    expect(offsetDoBloco(0)).toBe(0);
    expect(offsetDoBloco(18)).toBe(540); // minuto 9
  });

  it("um trecho no minuto 9 aponta para o segundo 540 do áudio", () => {
    const b = bloco(18, "reunião difícil", [["reunião", 2.5, 3.1]]);
    expect(absolutizarPalavras(b)[0]).toEqual({ palavra: "reunião", inicio: 542.5, fim: 543.1 });
  });

  it("preserva a duração de cada palavra ao deslocar", () => {
    const b = bloco(3, "x", [["x", 10, 12.5]]);
    const [p] = absolutizarPalavras(b);
    expect(p.fim - p.inicio).toBeCloseTo(2.5, 6);
  });
});

describe("concatenação", () => {
  it("ordena os blocos pelo índice, não pela ordem de chegada", () => {
    const t = concatenar("s1", [bloco(2, "terceiro", []), bloco(0, "primeiro", []), bloco(1, "segundo", [])]);
    expect(t.texto).toBe("primeiro segundo terceiro");
    expect(t.blocos.map((b) => b.i)).toEqual([0, 1, 2]);
  });

  it("mapeia cada bloco para o seu offset absoluto", () => {
    const t = concatenar("s1", [bloco(0, "a", []), bloco(1, "b", []), bloco(2, "c", [])]);
    expect(t.blocos.map((b) => b.offset_s)).toEqual([0, 30, 60]);
  });

  it("não cola nem duplica espaço na emenda dos blocos", () => {
    expect(juntarTexto([bloco(0, "  falei disso ", []), bloco(1, " e depois disso  ", [])])).toBe(
      "falei disso e depois disso",
    );
  });

  it("ignora bloco sem fala em vez de deixar espaço solto", () => {
    expect(juntarTexto([bloco(0, "a", []), bloco(1, "   ", []), bloco(2, "b", [])])).toBe("a b");
  });

  it("acumula as palavras de todos os blocos em ordem", () => {
    const t = concatenar("s1", [
      bloco(0, "um", [["um", 1, 1.4]]),
      bloco(1, "dois", [["dois", 2, 2.4]]),
    ]);
    expect(t.palavras.map((p) => p.inicio)).toEqual([1, 32]);
  });
});

describe("procedência da sessão", () => {
  it("guarda o modelo que transcreveu", () => {
    expect(concatenar("s1", [bloco(0, "a", [])]).modelo).toBe("xai/grok-stt");
  });

  it("um bloco só por segmento derruba a precisão da sessão inteira", () => {
    const t = concatenar("s1", [
      bloco(0, "a", [["a", 0, 1]]),
      bloco(1, "b", [["b", 0, 4]], "segmento"),
    ]);
    expect(t.granularidade).toBe("segmento");
  });

  // Sessão `mtu336r50a5i4j3k2o1g`: pausa de 30 s no meio do diário. O bloco mudo
  // volta sem palavra nenhuma, e sem palavra ele não tem o que dizer sobre a
  // precisão dos tempos — deixá-lo votar apagaria o player por palavra da sessão
  // inteira por causa de um silêncio.
  it("bloco mudo não rebaixa a precisão de quem falou", () => {
    const t = concatenar("s1", [bloco(0, "a", [["a", 0, 1]]), bloco(1, "", [], "segmento")]);
    expect(t.granularidade).toBe("palavra");
  });

  it("só declara precisão por palavra quando todos os blocos têm", () => {
    const t = concatenar("s1", [bloco(0, "a", []), bloco(1, "b", [])]);
    expect(t.granularidade).toBe("palavra");
  });
});

describe("prefixo contíguo", () => {
  it("corta no primeiro buraco: texto parcial nunca é lido fora de ordem", () => {
    const r = prefixoContiguo([{ i: 0 }, { i: 1 }, { i: 3 }, { i: 4 }]);
    expect(r.map((b) => b.i)).toEqual([0, 1]);
  });

  it("é vazio enquanto o bloco 0 não ficou pronto", () => {
    expect(prefixoContiguo([{ i: 1 }, { i: 2 }])).toEqual([]);
  });

  it("aceita blocos fora de ordem na entrada", () => {
    expect(prefixoContiguo([{ i: 2 }, { i: 0 }, { i: 1 }]).map((b) => b.i)).toEqual([0, 1, 2]);
  });
});
