/**
 * O bloco importado não é `.webm`. O pipeline tem que ir buscar o áudio na
 * chave que o manifest registrou — procurar sempre em `.webm` faria toda
 * sessão importada morrer em "bloco não está no R2".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const manifesto = {
  sessao_id: "s1",
  chunks: [
    { i: 0, bytes: 100, subido_em: "2026-08-27T12:00:00.000Z", transcrito: false, ext: "opus" },
  ],
  finalizado: false,
};

const getBytes = vi.fn(async () => new ArrayBuffer(8));

vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(async () => null),
  getBytes: (...a: unknown[]) => getBytes(...(a as [])),
  putJson: vi.fn(async () => {}),
}));

vi.mock("@/lib/stt", () => ({
  transcrever: vi.fn(async () => ({
    texto: "oi",
    palavras: [],
    modelo: "xai/grok-stt",
    granularidade: "segmento",
  })),
}));

vi.mock("@/lib/manifest", async () => {
  const real = await vi.importActual<typeof import("@/lib/manifest")>("@/lib/manifest");
  return {
    ...real,
    carregarManifest: vi.fn(async () => manifesto),
    atualizarManifest: vi.fn(async () => manifesto),
    // O bloco é meu: o que este arquivo mede é a extensão, não a disputa entre
    // dois workers pelo mesmo bloco (`tests/manifest.test.ts`).
    reivindicarTranscricao: vi.fn(async () => true),
  };
});

import { transcreverBloco } from "@/lib/pipeline";

beforeEach(() => getBytes.mockClear());

describe("transcrição de bloco importado", () => {
  it("busca o áudio na extensão que o manifest registrou", async () => {
    await transcreverBloco("s1", 0);
    expect(getBytes).toHaveBeenCalledWith("sessoes/s1/chunk_000.opus");
  });

  it("bloco sem ext no manifest continua sendo procurado em webm", async () => {
    manifesto.chunks[0] = { ...manifesto.chunks[0], ext: undefined as unknown as string };
    await transcreverBloco("s1", 0);
    expect(getBytes).toHaveBeenCalledWith("sessoes/s1/chunk_000.webm");
    manifesto.chunks[0] = { ...manifesto.chunks[0], ext: "opus" };
  });
});
