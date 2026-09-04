/**
 * Qual tela é ritual e qual é gestão — a regra que decide a fonte.
 *
 * O risco que este teste guarda é um regex ganancioso: sem o `$`,
 * `/sessao/x/transcricao` casaria com o padrão do corredor e a transcrição
 * literal — que é porta de serviço, gestão pura — passaria a ser desenhada como
 * se fosse parte do ritual diário.
 */
import { describe, expect, it } from "vitest";
import { ehRitual } from "@/lib/tipografia";

describe("o caminho do ritual", () => {
  it("gravar, esperar processar e revisar", () => {
    expect(ehRitual("/")).toBe(true);
    expect(ehRitual("/sessao/mtgn3zf7")).toBe(true);
    expect(ehRitual("/sessao/mtgn3zf7/revisar")).toBe(true);
  });

  it("a transcrição literal é gestão, não ritual", () => {
    // É a porta de serviço que saiu da jornada (ARCHITECTURE §11).
    expect(ehRitual("/sessao/mtgn3zf7/transcricao")).toBe(false);
  });

  it("as telas de manutenção são gestão", () => {
    for (const r of ["/sessoes", "/entidades", "/calibracao", "/entrar"]) {
      expect(ehRitual(r), r).toBe(false);
    }
  });

  it("rota desconhecida cai em gestão, não estoura", () => {
    expect(ehRitual(null)).toBe(false);
    expect(ehRitual("")).toBe(false);
    expect(ehRitual("/sessao")).toBe(false);
    expect(ehRitual("/sessao/x/revisar/mais")).toBe(false);
  });
});
