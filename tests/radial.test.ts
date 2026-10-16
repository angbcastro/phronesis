/**
 * O radial a 390 px (onda 4 da interface): a data de cada vizinho vai para
 * fora do nó, e para que lado depende do quadrante. Nos de cima e de baixo ela
 * fica centrada acima ou abaixo — ao lado, com a letra de 14, encostaria no
 * vizinho seguinte do leque.
 */
import { describe, expect, it } from "vitest";
import { rotuloDoVizinho } from "@/components/Confronto";

describe("a data do vizinho no radial", () => {
  it("em cima e embaixo, centrada e para fora do nó", () => {
    const cima = rotuloDoVizinho({ x: 200, y: 90, lado: "cima" });
    expect(cima.ancora).toBe("middle");
    expect(cima.x).toBe(200);
    expect(cima.y).toBeLessThan(90);

    const baixo = rotuloDoVizinho({ x: 200, y: 320, lado: "baixo" });
    expect(baixo.ancora).toBe("middle");
    expect(baixo.y).toBeGreaterThan(320);
  });

  it("dos lados, para fora no sentido do texto", () => {
    const direita = rotuloDoVizinho({ x: 320, y: 200, lado: "direita" });
    expect(direita.ancora).toBe("start");
    expect(direita.x).toBeGreaterThan(320);

    const esquerda = rotuloDoVizinho({ x: 90, y: 200, lado: "esquerda" });
    expect(esquerda.ancora).toBe("end");
    expect(esquerda.x).toBeLessThan(90);
  });
});
