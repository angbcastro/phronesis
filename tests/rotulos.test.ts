/**
 * O tipo do átomo como se fala, em toda tela.
 *
 * O enum (`OPINIAO`) é o que o grafo guarda e o que os prompts leem; a tela
 * mostra o rótulo ("opinião"). O que se fixa: os oito têm rótulo, nenhum sai
 * como código, e um tipo desconhecido aparece em vez de sumir.
 */
import { describe, expect, it } from "vitest";
import { ROTULO_TIPO_ATOMO, TIPOS_ATOMO, rotuloDoTipo } from "@/lib/tipos";

describe("o rótulo do tipo do átomo", () => {
  it("cobre os oito, em minúsculas e sem sublinhado", () => {
    for (const t of TIPOS_ATOMO) {
      const r = ROTULO_TIPO_ATOMO[t];
      expect(r, t).toBeTruthy();
      expect(r).toBe(r.toLowerCase());
      expect(r).not.toContain("_");
    }
  });

  it("leva o acento que o enum não tem", () => {
    expect(rotuloDoTipo("OPINIAO")).toBe("opinião");
    expect(rotuloDoTipo("DECISAO")).toBe("decisão");
    expect(rotuloDoTipo("HISTORIA")).toBe("história");
  });

  it("tipo fora do enum aparece em minúsculas, e não some", () => {
    expect(rotuloDoTipo("MEDO")).toBe("medo");
  });
});
