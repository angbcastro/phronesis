/**
 * O bloco que o STT ouviu calado.
 *
 * Sessão real de 09/09 (`mtu336r50a5i4j3k2o1g`): 9 blocos, 7 com fala, os
 * blocos 4 e 8 mudos — RMS de 0,004 contra 0,11 dos outros, que é o silêncio de
 * duas pausas minhas. O provedor não escreve nada, o AI SDK levanta
 * `AI_NoTranscriptGeneratedError`, e o pipeline tratava isso como defeito:
 * insistia 150 s no mesmo bloco e mandava a sessão inteira para `erro`. Quatro
 * minutos e meio de diário perdidos por duas pausas.
 *
 * O que estes testes seguram é a distinção: **silêncio devolve bloco vazio,
 * qualquer outro erro continua subindo**. Afrouxar o segundo transformaria
 * modelo inexistente e áudio corrompido em sessão silenciosamente sem texto.
 */
import { describe, expect, it, vi } from "vitest";
import { NoTranscriptGeneratedError } from "ai";

const { transcribe } = vi.hoisted(() => ({ transcribe: vi.fn() }));

// Só `experimental_transcribe` é falso: `NoTranscriptGeneratedError` tem de ser
// a classe de verdade, senão o teste mede o dublê e não o contrato do SDK.
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  experimental_transcribe: transcribe,
}));

vi.mock("@/lib/modelos", () => ({
  garantirGateway: () => {},
  modeloStt: () => "xai/grok-stt",
  opcoesDeVocabulario: () => ({}),
}));
vi.mock("@/lib/overrides", () => ({
  efetivo: async (_agente: string, padrao: { modelo: string }) => padrao,
}));
vi.mock("@/lib/vocabulario", () => ({ vocabulario: async () => [] }));

import { ehSemTranscricao, SttError, transcrever } from "@/lib/stt";

const semTranscricao = () => new NoTranscriptGeneratedError({ responses: [] });

describe("reconhecer o bloco sem fala", () => {
  it("reconhece o erro do SDK", () => {
    expect(ehSemTranscricao(semTranscricao())).toBe(true);
  });

  it("reconhece pelo nome o erro que perdeu a identidade no caminho", () => {
    expect(ehSemTranscricao({ name: "AI_NoTranscriptGeneratedError" })).toBe(true);
  });

  it("não confunde com outra falha", () => {
    expect(ehSemTranscricao(new Error("Missing or empty model identifier"))).toBe(false);
    expect(ehSemTranscricao(null)).toBe(false);
  });
});

describe("transcrever um bloco mudo", () => {
  it("devolve bloco vazio em vez de derrubar a sessão", async () => {
    transcribe.mockRejectedValueOnce(semTranscricao());

    const r = await transcrever(new ArrayBuffer(8));

    expect(r.texto).toBe("");
    expect(r.palavras).toEqual([]);
    expect(r.modelo).toBe("xai/grok-stt");
  });

  it("erro que não é silêncio continua subindo como SttError", async () => {
    transcribe.mockRejectedValueOnce(new Error("Missing or empty model identifier"));

    await expect(transcrever(new ArrayBuffer(8))).rejects.toBeInstanceOf(SttError);
  });
});
