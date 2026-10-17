/**
 * O recorte por seção, e o que difere do git (onda 4 da interface).
 *
 * O editor de agente mostra, abaixo do prompt, as seções que diferem da base
 * do git — empilhadas, como a emenda da calibração. O que erraria calado é
 * mostrar seção igual como diferente por causa de espaço, ou esquecer a seção
 * que eu tirei.
 */
import { describe, expect, it } from "vitest";
import { INICIO_DO_PROMPT, diferencaPorSecao, fatiar, secoesDe } from "@/lib/secoes";
import { secoesDe as secoesDaRedacao } from "@/lib/redacao";

const BASE = `Você extrai afirmações.

REGRAS
Uma afirmação por item.

FORMATO
Devolva JSON.`;

describe("o recorte", () => {
  it("é o mesmo que a redação usa — uma regra num lugar só", () => {
    expect(secoesDe(BASE)).toEqual(["REGRAS", "FORMATO"]);
    expect(secoesDaRedacao).toBe(secoesDe);
  });

  it("o corpo vai do fim do cabeçalho ao próximo", () => {
    const [regras] = fatiar(BASE);
    expect(regras.nome).toBe("REGRAS");
    expect(regras.corpo.trim()).toBe("Uma afirmação por item.");
  });
});

describe("o que difere do git", () => {
  it("igual não tem diferença nenhuma, nem por espaço nas bordas", () => {
    expect(diferencaPorSecao(BASE, BASE)).toEqual([]);
    expect(diferencaPorSecao(BASE, BASE.replace("item.", "item.   \n"))).toEqual([]);
  });

  it("só a seção que mudou, com os dois lados", () => {
    const agora = BASE.replace("Uma afirmação por item.", "Uma afirmação por item, curta.");
    expect(diferencaPorSecao(BASE, agora)).toEqual([
      { secao: "REGRAS", antes: "Uma afirmação por item.", depois: "Uma afirmação por item, curta." },
    ]);
  });

  it("a seção nova não tem lado do git, e a tirada não tem lado de agora — e vem no fim", () => {
    const agora = `Você extrai afirmações.

EXEMPLOS
Um exemplo.

FORMATO
Devolva JSON.`;
    expect(diferencaPorSecao(BASE, agora)).toEqual([
      { secao: "EXEMPLOS", antes: null, depois: "Um exemplo." },
      { secao: "REGRAS", antes: "Uma afirmação por item.", depois: null },
    ]);
  });

  it("o que vem antes do primeiro cabeçalho é o início", () => {
    const agora = BASE.replace("Você extrai afirmações.", "Você extrai afirmações curtas.");
    expect(diferencaPorSecao(BASE, agora)).toEqual([
      { secao: INICIO_DO_PROMPT, antes: "Você extrai afirmações.", depois: "Você extrai afirmações curtas." },
    ]);
  });

  it("prompt sem cabeçalho nenhum é um início só", () => {
    expect(diferencaPorSecao("gere um título", "gere um título curto")).toEqual([
      { secao: INICIO_DO_PROMPT, antes: "gere um título", depois: "gere um título curto" },
    ]);
  });

  it("o mesmo cabeçalho duas vezes conta pela ordem", () => {
    const base = "REGRAS\na\n\nREGRAS\nb";
    const agora = "REGRAS\na\n\nREGRAS\nc";
    expect(diferencaPorSecao(base, agora)).toEqual([{ secao: "REGRAS (2)", antes: "b", depois: "c" }]);
  });
});
