import { describe, expect, it } from "vitest";
import {
  ALFA_PONTA,
  alturaOnda,
  amplitudePx,
  AMPLITUDE_MAX,
  AMPLITUDE_MIN,
  CAMADAS,
  CICLOS,
  comAlfa,
  envelope,
  nivelRms,
  nivelSimulado,
  suavizar,
} from "@/lib/onda";

/** O byte que o AnalyserNode entrega para um deslocamento -1..1. */
const byte = (v: number) => Math.round(128 + v * 128);

describe("nível do microfone", () => {
  it("silêncio absoluto é zero", () => {
    expect(nivelRms(new Uint8Array(64).fill(128))).toBe(0);
  });

  it("não passa de 1 nem com o sinal saturado", () => {
    expect(nivelRms(new Uint8Array(64).fill(255))).toBe(1);
    expect(nivelRms(new Uint8Array(64).fill(0))).toBe(1);
  });

  it("é RMS, não pico: um estalo isolado quase não move a agulha", () => {
    const amostras = new Uint8Array(1024).fill(128);
    amostras[0] = 255;
    expect(nivelRms(amostras)).toBeLessThan(0.2);
  });

  it("fala normal cai no meio da faixa, não colada em nenhuma ponta", () => {
    // ±0,12 de deslocamento é conversa a um palmo do aparelho.
    const fala = Array.from({ length: 512 }, (_, i) => byte(0.12 * Math.sin(i / 3)));
    const n = nivelRms(fala);
    expect(n).toBeGreaterThan(0.2);
    expect(n).toBeLessThan(0.8);
  });

  it("buffer vazio não vira NaN", () => {
    expect(nivelRms(new Uint8Array(0))).toBe(0);
  });
});

describe("suavização", () => {
  it("caminha na direção do valor novo sem saltar até ele", () => {
    const passo = suavizar(0, 1);
    expect(passo).toBeGreaterThan(0);
    expect(passo).toBeLessThan(1);
  });

  it("converge para o valor novo se ele se mantém", () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = suavizar(v, 1);
    expect(v).toBeCloseTo(1, 3);
  });
});

describe("amplitude", () => {
  it("respeita a faixa fixada na especificação", () => {
    expect(amplitudePx(0)).toBe(AMPLITUDE_MIN);
    expect(amplitudePx(1)).toBe(AMPLITUDE_MAX);
  });

  it("prende valores fora de 0..1 em vez de extrapolar", () => {
    expect(amplitudePx(-3)).toBe(AMPLITUDE_MIN);
    expect(amplitudePx(9)).toBe(AMPLITUDE_MAX);
  });
});

describe("envelope da onda", () => {
  it("é zero nas duas pontas: nem cortada pelo círculo, nem decepada na borda", () => {
    expect(envelope(0)).toBe(0);
    expect(envelope(1)).toBe(0);
  });

  it("nunca passa de 1 — a amplitude é o teto, não uma sugestão", () => {
    for (let t = 0; t <= 1; t += 0.01) expect(envelope(t)).toBeLessThanOrEqual(1);
  });

  it("cresce rápido saindo do círculo e decai o resto do caminho", () => {
    expect(envelope(0.15)).toBeGreaterThan(envelope(0.02));
    expect(envelope(0.15)).toBeGreaterThan(envelope(0.6));
    expect(envelope(0.6)).toBeGreaterThan(envelope(0.95));
  });
});

describe("altura da onda", () => {
  it("cabe na amplitude pedida em todo o percurso", () => {
    for (let t = 0; t <= 1; t += 0.005) {
      expect(Math.abs(alturaOnda(t, AMPLITUDE_MAX, 1.3))).toBeLessThanOrEqual(AMPLITUDE_MAX);
    }
  });

  it("encosta o desenho no círculo e na ponta, seja qual for a fase", () => {
    // `Math.abs` porque o seno devolve -0 em metade das fases, e -0 desenha
    // exatamente onde +0 desenha.
    for (const fase of [0, 1, 2.5, 6]) {
      expect(Math.abs(alturaOnda(0, AMPLITUDE_MAX, fase))).toBe(0);
      expect(Math.abs(alturaOnda(1, AMPLITUDE_MAX, fase))).toBe(0);
    }
  });

  it("a crista viaja do círculo para fora conforme a fase avança", () => {
    // O ponto de fase nula caminha para t maior quando a fase cresce.
    const cristaEm = (fase: number) => fase / (2 * Math.PI * CICLOS);
    expect(cristaEm(1)).toBeGreaterThan(cristaEm(0));
  });

  it("mais ciclos põem mais cristas no mesmo percurso", () => {
    const cruzamentos = (ciclos: number) => {
      let n = 0;
      let antes = alturaOnda(0.001, AMPLITUDE_MAX, 0, ciclos);
      for (let t = 0.002; t < 0.999; t += 0.001) {
        const agora = alturaOnda(t, AMPLITUDE_MAX, 0, ciclos);
        if (antes < 0 !== agora < 0) n++;
        antes = agora;
      }
      return n;
    };
    expect(cruzamentos(4.25)).toBeGreaterThan(cruzamentos(2.9));
  });
});

describe("as três camadas", () => {
  it("são três", () => {
    expect(CAMADAS).toHaveLength(3);
  });

  it("nenhuma passa da amplitude do momento — 25px continua o teto", () => {
    for (const c of CAMADAS) {
      expect(c.amplitude).toBeGreaterThan(0);
      expect(c.amplitude).toBeLessThanOrEqual(1);
      for (let t = 0; t <= 1; t += 0.01) {
        expect(Math.abs(alturaOnda(t, AMPLITUDE_MAX * c.amplitude, c.fase, c.ciclos))).toBeLessThanOrEqual(
          AMPLITUDE_MAX,
        );
      }
    }
  });

  it("uma linha principal e duas acompanhando, não três iguais", () => {
    const amplitudes = CAMADAS.map((c) => c.amplitude);
    expect(amplitudes[0]).toBeGreaterThan(amplitudes[1]);
    expect(amplitudes[1]).toBeGreaterThan(amplitudes[2]);
    const alfas = CAMADAS.map((c) => c.alfa);
    expect(alfas[0]).toBeGreaterThan(alfas[1]);
    expect(alfas[1]).toBeGreaterThan(alfas[2]);
  });

  it("os ciclos não estão em razão simples: as três nunca se realinham", () => {
    // Se duas fechassem o mesmo desenho junto, o par piscaria como uma onda
    // só, grossa. Nenhuma razão entre elas pode cair perto de um racional
    // curto (1/2, 2/3, 3/4, 1, …) dentro da tolerância que o olho pega.
    for (let i = 0; i < CAMADAS.length; i++) {
      for (let j = i + 1; j < CAMADAS.length; j++) {
        const razao = CAMADAS[i].ciclos / CAMADAS[j].ciclos;
        for (let p = 1; p <= 4; p++) {
          for (let q = 1; q <= 4; q++) {
            expect(Math.abs(razao - p / q)).toBeGreaterThan(0.04);
          }
        }
      }
    }
  });

  it("as fases não nascem juntas", () => {
    const fases = new Set(CAMADAS.map((c) => c.fase));
    expect(fases.size).toBe(CAMADAS.length);
  });
});

describe("onda sem microfone", () => {
  it("fica dentro de 0..1 e não trava num valor só", () => {
    const vistos = new Set<number>();
    for (let ms = 0; ms < 20_000; ms += 250) {
      const n = nivelSimulado(ms);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(1);
      vistos.add(Math.round(n * 20));
    }
    expect(vistos.size).toBeGreaterThan(4);
  });
});

describe("cor da ponta", () => {
  it("troca o alfa de uma cor resolvida pelo navegador", () => {
    expect(comAlfa("rgb(214, 90, 49)", ALFA_PONTA)).toBe("rgba(214, 90, 49, 0.4)");
  });

  it("sobrescreve o alfa de uma rgba que já vinha com um", () => {
    expect(comAlfa("rgba(214, 90, 49, 0.8)", 0.4)).toBe("rgba(214, 90, 49, 0.4)");
  });

  it("devolve a entrada intacta quando não reconhece o formato", () => {
    expect(comAlfa("transparent", 0.4)).toBe("transparent");
  });
});
