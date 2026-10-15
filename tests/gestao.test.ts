/**
 * Onde a engrenagem mora no canto superior direito.
 *
 * Em toda tela de gestão — a gaveta é o caminho entre elas —, e em nenhuma do
 * ritual: o corredor e a revisão não ganham porta de serviço, e `/` tem a
 * engrenagem própria, na borda, montada pela `Gravacao`. Mesma forma do teste
 * da marca, porque é a mesma pergunta: em que rota este controle existe.
 */
import { describe, expect, it } from "vitest";
import { mostraGestaoNoCanto } from "@/components/Gestao";

describe("a engrenagem no canto", () => {
  it("aparece em toda tela de gestão", () => {
    for (const rota of [
      "/sessoes",
      "/entidades",
      "/agentes",
      "/agentes/consulta",
      "/confronto",
      "/calibracao",
      "/sessao/abc/transcricao",
    ]) {
      expect(mostraGestaoNoCanto(rota), rota).toBe(true);
    }
  });

  it("não aparece no ritual — o corredor e a revisão não ganham porta de serviço", () => {
    expect(mostraGestaoNoCanto("/sessao/abc")).toBe(false);
    expect(mostraGestaoNoCanto("/sessao/abc/revisar")).toBe(false);
  });

  it("não aparece em `/`, que tem a dela, nem no login", () => {
    expect(mostraGestaoNoCanto("/")).toBe(false);
    expect(mostraGestaoNoCanto("/entrar")).toBe(false);
  });

  it("some quando a rota ainda não é conhecida, em vez de piscar", () => {
    expect(mostraGestaoNoCanto(null)).toBe(false);
  });
});
