/**
 * O que o servidor registra quando a transcrição falha.
 *
 * A tela só sabe dizer "a transcrição falhou" — o motivo tem de estar no log
 * do servidor, senão a falha é indiagnosticável depois do fato. Foi o que
 * aconteceu na sessão de 2026-08-24: o `catch` da espera engolia o erro do
 * STT sem uma linha sequer, e a sessão ia para `erro` calada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const manifesto = {
  sessao_id: "s1",
  chunks: [{ i: 0, bytes: 100, subido_em: "2026-08-24T00:00:00.000Z", transcrito: false }],
  finalizado: false,
};

vi.mock("@/lib/stt", () => ({
  transcrever: vi.fn(async () => {
    throw new Error("Missing or empty model identifier");
  }),
}));

vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(async () => null),
  getBytes: vi.fn(async () => new ArrayBuffer(8)),
  putJson: vi.fn(async () => {}),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

// A extração não chega a rodar aqui — a transcrição falha antes. Mockada para
// o teste não depender do Gateway nem do Neo4j.
vi.mock("@/lib/extracao", () => ({ extrair: vi.fn() }));

vi.mock("@/lib/sessoes", () => ({
  buscarSessao: vi.fn(async () => ({ id: "s1", status: "finalizando", duracao_s: 30 })),
  atualizarSessao: vi.fn(async () => null),
}));

vi.mock("@/lib/manifest", () => ({
  carregarManifest: vi.fn(async () => manifesto),
  extensaoDoChunk: vi.fn(() => "webm"),
  atualizarManifest: vi.fn(async () => manifesto),
  marcarTranscrito: vi.fn((m) => m),
  pendentes: vi.fn((m) => m.chunks.filter((c: { transcrito: boolean }) => !c.transcrito)),
  tudoTranscrito: vi.fn(() => false),
}));

import { finalizarSessao } from "@/lib/pipeline";

let erros: string[];

beforeEach(() => {
  erros = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    erros.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("falha de transcrição deixa rastro no log", () => {
  it("registra o motivo do STT, com sessão e bloco", async () => {
    const p = finalizarSessao("s1");
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    const linha = erros.find((e) => e.includes("Missing or empty model identifier"));
    expect(linha, `nenhum log com o motivo. Logs: ${JSON.stringify(erros)}`).toBeDefined();
    expect(linha).toContain("s1");
    expect(linha).toContain("0");
  });

  it("registra quais blocos ficaram para trás quando desiste", async () => {
    const p = finalizarSessao("s1");
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await p;

    expect(r.status).toBe("erro");
    expect(r.faltando).toEqual([0]);
    expect(erros.some((e) => e.includes("desistiu") || e.includes("faltando"))).toBe(true);
  });
});
