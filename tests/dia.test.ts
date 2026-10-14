/**
 * O dia de Brasília (slice 12): a data que o chat diz.
 *
 * O que se prende aqui é a fronteira das 21h: `valido_em` é UTC, e a sessão
 * gravada entre 21h e meia-noite em Brasília já é o dia seguinte em Greenwich.
 * Cortar a string erra esse dia, calado, num diário que se grava à noite.
 */
import { describe, expect, it } from "vitest";
import { FUSO, diaLocal, hojeLocal } from "@/lib/dia";

describe("diaLocal", () => {
  it("01:30 em Greenwich ainda é o dia anterior em Brasília", () => {
    expect(diaLocal("2026-10-14T01:30:00.000Z")).toBe("2026-10-13");
  });

  it("03:00 em Greenwich é meia-noite em Brasília: já é o mesmo dia", () => {
    expect(diaLocal("2026-10-14T03:00:00.000Z")).toBe("2026-10-14");
    expect(diaLocal("2026-10-14T02:59:59.999Z")).toBe("2026-10-13");
  });

  it("a virada de mês e de ano também", () => {
    expect(diaLocal("2026-11-01T02:00:00.000Z")).toBe("2026-10-31");
    expect(diaLocal("2027-01-01T01:00:00.000Z")).toBe("2026-12-31");
  });

  it("uma data sem hora já é um dia, e volta como veio", () => {
    // `new Date("2026-09-13")` é a meia-noite de Greenwich: convertida, daria o 12.
    expect(diaLocal("2026-09-13")).toBe("2026-09-13");
  });

  it("vazio e lixo dão vazio, e não uma data inventada", () => {
    expect(diaLocal("")).toBe("");
    expect(diaLocal("   ")).toBe("");
    expect(diaLocal("ontem")).toBe("");
    expect(diaLocal(new Date(Number.NaN))).toBe("");
  });

  it("aceita Date", () => {
    expect(diaLocal(new Date("2026-10-14T01:30:00.000Z"))).toBe("2026-10-13");
  });
});

describe("hojeLocal", () => {
  it("às 22h de Brasília, hoje ainda é hoje", () => {
    expect(hojeLocal(new Date("2026-10-14T01:00:00.000Z"))).toBe("2026-10-13");
  });

  it("o fuso é o de São Paulo", () => {
    expect(FUSO).toBe("America/Sao_Paulo");
  });
});
