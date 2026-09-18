/**
 * O que o servidor registra quando a transcrição falha.
 *
 * A tela só sabe dizer "a transcrição falhou" — o motivo tem de estar no log
 * do servidor, senão a falha é indiagnosticável depois do fato. Foi o que
 * aconteceu na sessão de 2026-08-24: o `catch` da espera engolia o erro do
 * STT sem uma linha sequer, e a sessão ia para `erro` calada.
 *
 * E o motivo tem de dizer **qual** falha foi: rate limit do Gateway pede voltar
 * mais tarde, modelo inexistente pede mexer no código. Confundir os dois faz
 * perder tarde procurando defeito onde só havia pressa (`limite.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const manifesto = {
  sessao_id: "s1",
  chunks: [{ i: 0, bytes: 100, subido_em: "2026-08-24T00:00:00.000Z", transcrito: false }],
  finalizado: false,
};

/** Trocável por teste: o mesmo laço tem de contar duas histórias diferentes. */
let erroDoStt = () => new Error("Missing or empty model identifier");

vi.mock("@/lib/stt", () => ({
  transcrever: vi.fn(async () => {
    throw erroDoStt();
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
  soltarBloco: vi.fn((m) => m),
  // O bloco é sempre meu neste arquivo: o que ele mede é a falha do STT, não a
  // disputa entre dois workers (essa está em `tests/manifest.test.ts`).
  reivindicarTranscricao: vi.fn(async () => true),
  pendentes: vi.fn((m) => m.chunks.filter((c: { transcrito: boolean }) => !c.transcrito)),
  tudoTranscrito: vi.fn(() => false),
}));

import { atualizarSessao } from "@/lib/sessoes";
import { ESPERA_MAX_MS, finalizarSessao } from "@/lib/pipeline";

/** Passar do prazo do laço, seja ele qual for — a constante é quem manda. */
const ALEM_DO_PRAZO = ESPERA_MAX_MS + 30_000;

let erros: string[];

beforeEach(() => {
  erros = [];
  erroDoStt = () => new Error("Missing or empty model identifier");
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
    await vi.advanceTimersByTimeAsync(ALEM_DO_PRAZO);
    await p;

    const linha = erros.find((e) => e.includes("Missing or empty model identifier"));
    expect(linha, `nenhum log com o motivo. Logs: ${JSON.stringify(erros)}`).toBeDefined();
    expect(linha).toContain("s1");
    expect(linha).toContain("0");
  });

  it("registra quais blocos ficaram para trás quando desiste", async () => {
    const p = finalizarSessao("s1");
    await vi.advanceTimersByTimeAsync(ALEM_DO_PRAZO);
    const r = await p;

    expect(r.status).toBe("erro");
    expect(r.faltando).toEqual([0]);
    expect(erros.some((e) => e.includes("desistiu") || e.includes("faltando"))).toBe(true);
  });

  it("quando a causa é rate limit, a desistência diz isso e manda voltar depois", async () => {
    erroDoStt = () =>
      Object.assign(new Error("Free tier requests on this model are rate-limited."), {
        name: "GatewayRateLimitError",
        statusCode: 429,
      });

    const p = finalizarSessao("s1");
    await vi.advanceTimersByTimeAsync(ALEM_DO_PRAZO);
    const r = await p;

    expect(r.status).toBe("erro");
    const desistencia = erros.find((e) => e.includes("desistiu"));
    expect(desistencia, `sem linha de desistência. Logs: ${JSON.stringify(erros)}`).toBeDefined();
    expect(desistencia).toContain("rate limit");
  });

  it("modelo inexistente não vira rate limit — a linha não pode mandar esperar à toa", async () => {
    const p = finalizarSessao("s1");
    await vi.advanceTimersByTimeAsync(ALEM_DO_PRAZO);
    await p;

    expect(erros.find((e) => e.includes("desistiu"))).not.toContain("rate limit");
  });
});

/**
 * `confirmada` é o único estado terminal da máquina (§5), e o que o protege é a
 * guarda de cada escrita — não a tabela de `estados.ts`, que nenhum caminho de
 * produção consulta. Sem ela, um `/finalizar` numa sessão já confirmada cuja
 * `transcricao.json` tivesse sumido do R2 gravava `erro` por cima: os átomos
 * continuariam no grafo e a sessão apareceria como falha.
 */
describe("uma sessão confirmada não vira erro", () => {
  it("a escrita de erro parte de qualquer estado menos confirmada", async () => {
    const p = finalizarSessao("s1");
    await vi.advanceTimersByTimeAsync(ALEM_DO_PRAZO);
    await p;

    const paraErro = vi
      .mocked(atualizarSessao)
      .mock.calls.filter((c) => (c[1] as { status?: string }).status === "erro");

    expect(paraErro.length, "nenhuma escrita de erro nesta execução").toBeGreaterThan(0);
    for (const [, , sePartirDe] of paraErro) {
      expect(sePartirDe, "escrita de erro sem guarda nenhuma").toBeDefined();
      expect(sePartirDe).not.toContain("confirmada");
    }
  });
});
