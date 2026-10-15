/**
 * O dia de Brasília (slice 12): a data que o chat diz.
 *
 * O que se prende aqui é a fronteira das 21h: `valido_em` é UTC, e a sessão
 * gravada entre 21h e meia-noite em Brasília já é o dia seguinte em Greenwich.
 * Cortar a string erra esse dia, calado, num diário que se grava à noite.
 */
import { describe, expect, it } from "vitest";
import { FUSO, dataCurta, dataEHora, diaLocal, hojeLocal } from "@/lib/dia";

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


describe("a data das telas", () => {
  const agora = new Date("2026-10-14T15:00:00.000Z"); // 12:00 de 14/10 em Brasília

  it("dia/mês, que é como eu leio", () => {
    expect(dataCurta("2026-09-04T12:00:00.000Z", agora)).toBe("04/09");
  });

  it("o dia é o de Brasília, e não o de Greenwich", () => {
    // 00:55Z de 04/09 é 21:55 de 03/09 em São Paulo.
    expect(dataCurta("2026-09-04T00:55:25.710Z", agora)).toBe("03/09");
  });

  it("o ano só entra quando não é o corrente", () => {
    expect(dataCurta("2025-12-31T15:00:00.000Z", agora)).toBe("31/12/2025");
  });

  it("aceita um dia sem hora, e lixo dá vazio", () => {
    expect(dataCurta("2026-09-13", agora)).toBe("13/09");
    expect(dataCurta("", agora)).toBe("");
    expect(dataCurta("ontem", agora)).toBe("");
  });

  it("com hora: hoje, ontem, e o dia nos outros", () => {
    expect(dataEHora("2026-10-14T13:05:00.000Z", agora)).toBe("hoje, 10:05");
    // 01:30Z de 14/10 é 22:30 de 13/10 em Brasília: ontem.
    expect(dataEHora("2026-10-14T01:30:00.000Z", agora)).toBe("ontem, 22:30");
    expect(dataEHora("2026-08-31T02:49:33.716Z", agora)).toBe("30/08, 23:49");
  });

  it("com hora, lixo dá vazio", () => {
    expect(dataEHora("não é data", agora)).toBe("");
  });
});
