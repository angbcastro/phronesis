import { describe, expect, it } from "vitest";
import { mostraMarca } from "@/components/Marca";

describe("marca no canto superior esquerdo", () => {
  it("não aparece no início — a tela de gravar não ganha nada crônico", () => {
    expect(mostraMarca("/")).toBe(false);
  });

  it("não aparece no login — não há sessão para onde voltar", () => {
    expect(mostraMarca("/entrar")).toBe(false);
  });

  it("aparece em toda tela de dentro", () => {
    for (const rota of [
      "/sessoes",
      "/entidades",
      "/sessao/abc",
      "/sessao/abc/revisar",
      "/sessao/abc/transcricao",
    ]) {
      expect(mostraMarca(rota), rota).toBe(true);
    }
  });

  it("some quando a rota ainda não é conhecida, em vez de piscar", () => {
    expect(mostraMarca(null)).toBe(false);
  });
});
