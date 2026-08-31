/**
 * Do segundo absoluto para o bloco certo do áudio.
 *
 * É o que o botão de escutar depende. Errar aqui toca o pedaço errado, e a
 * revisão inteira deixa de ser confiável — "mostrar a origem, sempre" é
 * princípio de UX da visão, não enfeite.
 */
import { describe, expect, it } from "vitest";
import { localizarNoAudio } from "@/components/Revisao";
import type { BlocoAbsoluto } from "@/lib/tipos";

/** Sessão gravada: um bloco a cada 30 s. */
const gravada: BlocoAbsoluto[] = [
  { i: 0, texto: "", offset_s: 0 },
  { i: 1, texto: "", offset_s: 30 },
  { i: 2, texto: "", offset_s: 60 },
];

/** Sessão importada: um bloco só, cobrindo o arquivo inteiro. */
const importada: BlocoAbsoluto[] = [{ i: 0, texto: "", offset_s: 0 }];

describe("localizar no áudio", () => {
  it("acha o bloco que contém o segundo, e o offset dentro dele", () => {
    expect(localizarNoAudio(gravada, 0)).toEqual({ i: 0, dentro: 0 });
    expect(localizarNoAudio(gravada, 12.5)).toEqual({ i: 0, dentro: 12.5 });
    expect(localizarNoAudio(gravada, 42)).toEqual({ i: 1, dentro: 12 });
    expect(localizarNoAudio(gravada, 61)).toEqual({ i: 2, dentro: 1 });
  });

  it("a borda do bloco pertence ao bloco que começa nela", () => {
    expect(localizarNoAudio(gravada, 30)).toEqual({ i: 1, dentro: 0 });
    expect(localizarNoAudio(gravada, 29.9)).toEqual({ i: 0, dentro: 29.9 });
  });

  it("sessão importada tem um bloco só — o offset é o segundo absoluto", () => {
    // Sem isso, um trecho no minuto 9 de um arquivo importado procuraria o
    // bloco 18, que não existe, e o player ficaria mudo.
    expect(localizarNoAudio(importada, 540)).toEqual({ i: 0, dentro: 540 });
  });

  it("segundo antes do primeiro bloco cai no primeiro, não em lugar nenhum", () => {
    expect(localizarNoAudio(gravada, -5)).toEqual({ i: 0, dentro: 0 });
  });

  it("sem bloco nenhum, não há o que tocar", () => {
    expect(localizarNoAudio([], 10)).toBeNull();
  });

  it("não depende da ordem em que os blocos chegam", () => {
    const fora = [gravada[2], gravada[0], gravada[1]];
    expect(localizarNoAudio(fora, 42)).toEqual({ i: 1, dentro: 12 });
  });
});
