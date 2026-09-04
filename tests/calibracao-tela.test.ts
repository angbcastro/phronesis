/**
 * A tela de calibração — as duas decisões dela que não são CSS.
 *
 * A primeira é como o par `antes → depois` é apresentado, e ela saiu do
 * material real: metade das correções são parágrafos longos, o resto são nomes
 * curtos. Uma forma só serviria mal aos dois. A segunda é o agrupamento do
 * refugo do parser, que a revisão carregava e nunca mostrou.
 */
import { describe, expect, it } from "vitest";
import { agruparDescartes, cabeEmLinha, diaMes, LIMITE_LINHA } from "@/components/Calibracao";

describe("par curto em linha, par longo empilhado", () => {
  it("renome e troca de tipo cabem numa linha", () => {
    expect(cabeEmLinha("Beijing Founders", "Behring Founders")).toBe(true);
    expect(cabeEmLinha("FATO", "OPINIAO")).toBe(true);
    expect(cabeEmLinha("ela", "")).toBe(true);
  });

  it("reescrita de átomo não cabe — é parágrafo, não rótulo", () => {
    const antes = "a".repeat(280);
    const depois = "b".repeat(264);
    expect(cabeEmLinha(antes, depois)).toBe(false);
  });

  it("o corte é sobre a soma dos dois lados, não sobre cada um", () => {
    // Um `antes` curto com um `depois` longo continua sendo dois parágrafos
    // para ler — foi o caso do átomo que ganhou 369 caracteres no fim.
    expect(cabeEmLinha("", "x".repeat(LIMITE_LINHA + 1))).toBe(false);
    expect(cabeEmLinha("x".repeat(LIMITE_LINHA), "")).toBe(true);
  });
});

describe("o refugo do parser, agrupado por motivo", () => {
  it("soma o mesmo motivo entre sessões, e ordena pelo que mais aparece", () => {
    const agrupado = agruparDescartes({
      a: {
        blocos: [],
        descartados: [{ motivo: "sem sujeito" }, { motivo: "texto vazio" }],
      },
      b: { blocos: [], descartados: [{ motivo: "texto vazio" }, { motivo: "texto vazio" }] },
    });

    expect(agrupado).toEqual([
      { motivo: "texto vazio", n: 3 },
      { motivo: "sem sujeito", n: 1 },
    ]);
  });

  it("sessão ainda não carregada não conta como zero descarte — simplesmente não entra", () => {
    expect(agruparDescartes({ a: undefined })).toEqual([]);
  });

  it("nada descartado é lista vazia, não um zero na tela", () => {
    expect(agruparDescartes({ a: { blocos: [], descartados: [] } })).toEqual([]);
  });
});

describe("a data da correção", () => {
  it("situa sem pesar: dia e mês, no fuso de quem lê", () => {
    // 00:55Z de 04/09 é 21:55 de 03/09 em São Paulo — e é a data local que
    // situa a lembrança, não a que o servidor carimbou.
    const texto = diaMes("2026-09-04T00:55:25.710Z");
    expect(texto).toMatch(/^\d{2} de [a-z]{3}/i);
  });

  it("data quebrada não estoura a lista inteira", () => {
    expect(diaMes("não é data")).toBe("");
  });
});
