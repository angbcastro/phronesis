import { describe, expect, it } from "vitest";
import { duracaoPorChunks, estaAberta, estaConcluida, foiAbandonada, podeIrPara } from "@/lib/estados";

describe("transições", () => {
  it("segue o caminho feliz da slice", () => {
    expect(podeIrPara("gravando", "finalizando")).toBe(true);
    expect(podeIrPara("finalizando", "transcrevendo")).toBe(true);
    expect(podeIrPara("transcrevendo", "transcrito")).toBe(true);
  });

  it("não volta atrás de uma sessão já transcrita", () => {
    expect(podeIrPara("transcrito", "finalizando")).toBe(false);
    expect(podeIrPara("transcrito", "gravando")).toBe(false);
  });

  it("permite repetir o estado atual — finalizar duas vezes não quebra", () => {
    expect(podeIrPara("finalizando", "finalizando")).toBe(true);
    expect(podeIrPara("transcrito", "transcrito")).toBe(true);
  });

  it("deixa retomar ou processar uma sessão abandonada", () => {
    expect(podeIrPara("abandonada", "gravando")).toBe(true);
    expect(podeIrPara("abandonada", "finalizando")).toBe(true);
  });

  it("permite retry manual depois de erro no STT", () => {
    expect(podeIrPara("erro", "transcrevendo")).toBe(true);
  });
});

describe("abandono", () => {
  const agora = new Date("2026-08-23T20:00:00.000Z");
  const minAtras = (m: number) => new Date(agora.getTime() - m * 60_000).toISOString();

  it("marca abandonada sem bloco novo há mais de 10 min", () => {
    expect(foiAbandonada("gravando", minAtras(11), agora)).toBe(true);
  });

  it("não marca dentro da janela de 10 min", () => {
    expect(foiAbandonada("gravando", minAtras(9), agora)).toBe(false);
  });

  it("só se aplica a sessão em gravação", () => {
    expect(foiAbandonada("transcrevendo", minAtras(30), agora)).toBe(false);
  });

  it("sessão sem bloco nenhum não é abandonada", () => {
    expect(foiAbandonada("gravando", null, agora)).toBe(false);
  });
});

describe("classificação", () => {
  it("o chip de recuperação pega gravando, abandonada e erro", () => {
    expect((["gravando", "abandonada", "erro"] as const).every(estaAberta)).toBe(true);
    expect((["transcrito", "finalizando", "transcrevendo"] as const).some(estaAberta)).toBe(false);
  });

  it("só transcrito é terminal", () => {
    expect(estaConcluida("transcrito")).toBe(true);
    expect(estaConcluida("erro")).toBe(false);
  });

  it("converte contagem de blocos em segundos", () => {
    expect(duracaoPorChunks(30)).toBe(900); // 15 min
  });
});
