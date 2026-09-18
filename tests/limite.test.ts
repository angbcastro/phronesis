/**
 * O rate limit do Gateway, e a espera que o transforma em atraso.
 *
 * Medido em 2026-09-02: o free tier recusou chamadas seguidas de transcrição —
 * primeiro no `google/gemini-3.5-transcribe`, depois, na mesma janela, no
 * `xai/grok-stt`, que `ARCHITECTURE.md` listava como "sem rate limit". O erro
 * chega embrulhado pelo `RetryError` do AI SDK, e é essa forma que estes testes
 * fixam: se o SDK mudar o embrulho, é aqui que se descobre.
 */
import { describe, expect, it, vi } from "vitest";
import {
  comEsperaDeLimite,
  ehLimiteDeTaxa,
  ehTransitorio,
  esperaDoLimite,
  esperaTransitoria,
  ESPERAS_MS,
  ESPERAS_TRANSITORIA_MS,
  TENTATIVAS,
} from "@/lib/limite";

/** `GatewayRateLimitError` como o `@ai-sdk/gateway` o constrói. */
function limiteDoGateway(): Error {
  return Object.assign(new Error("Free tier requests on this model are rate-limited."), {
    name: "GatewayRateLimitError",
    type: "rate_limit_exceeded",
    statusCode: 429,
    isRetryable: true,
  });
}

/** Como o erro de fato sobe: o SDK tentou três vezes antes de desistir. */
function embrulhado(dentro: Error): Error {
  return Object.assign(new Error(`Failed after 3 attempts. Last error: ${dentro.message}`), {
    name: "RetryError",
    reason: "maxRetriesExceeded",
    lastError: dentro,
    errors: [dentro],
  });
}

const semDormir = { dormir: async () => {} };

describe("reconhecer o limite", () => {
  it("acha o erro nu", () => {
    expect(ehLimiteDeTaxa(limiteDoGateway())).toBe(true);
  });

  it("acha dentro do RetryError, que é como ele chega de verdade", () => {
    expect(ehLimiteDeTaxa(embrulhado(limiteDoGateway()))).toBe(true);
  });

  it("acha por statusCode quando o nome não sobreviveu ao embrulho", () => {
    const cru = Object.assign(new Error("too many requests"), { statusCode: 429 });
    expect(ehLimiteDeTaxa(new Error("falhou", { cause: cru }))).toBe(true);
  });

  it("não confunde com outro erro do Gateway — 404 pede conserto, não espera", () => {
    const naoExiste = Object.assign(new Error("Model not found"), {
      name: "GatewayModelNotFoundError",
      statusCode: 404,
    });
    expect(ehLimiteDeTaxa(embrulhado(naoExiste))).toBe(false);
    expect(ehLimiteDeTaxa(new Error("transcrição vazia"))).toBe(false);
    expect(ehLimiteDeTaxa(null)).toBe(false);
  });

  it("cadeia circular não trava", () => {
    const a = new Error("a");
    (a as { cause?: unknown }).cause = a;
    expect(ehLimiteDeTaxa(a)).toBe(false);
  });
});

describe("esperar o limite passar", () => {
  it("a segunda tentativa é a que passa — foi o que a medição fez à mão", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(embrulhado(limiteDoGateway()))
      .mockResolvedValue("transcrito");

    await expect(comEsperaDeLimite("stt", fn, semDormir)).resolves.toBe("transcrito");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("erro que não é limite sobe na primeira: esperar não conserta modelo errado", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Missing or empty model identifier"));

    await expect(comEsperaDeLimite("stt", fn, semDormir)).rejects.toThrow("Missing or empty");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("desiste depois do teto, com o erro original", async () => {
    const fn = vi.fn().mockRejectedValue(embrulhado(limiteDoGateway()));

    await expect(comEsperaDeLimite("stt", fn, semDormir)).rejects.toThrow("Failed after 3");
    expect(fn).toHaveBeenCalledTimes(TENTATIVAS);
  });

  it("espera dezenas de segundos, não milissegundos — a janela do limite é longa", async () => {
    const dormiu: number[] = [];
    const fn = vi.fn().mockRejectedValue(embrulhado(limiteDoGateway()));

    await expect(
      comEsperaDeLimite("stt", fn, {
        dormir: async (ms) => {
          dormiu.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(dormiu).toHaveLength(ESPERAS_MS.length);
    expect(dormiu[0]).toBeGreaterThanOrEqual(ESPERAS_MS[0]);
    expect(dormiu[1]).toBeGreaterThan(dormiu[0]);
    // O jitter é para cima, nunca para baixo: esperar menos que o medido é o
    // erro que faz a espera não servir para nada.
    expect(esperaDoLimite(0, 0)).toBe(ESPERAS_MS[0]);
    expect(esperaDoLimite(1, 1)).toBeGreaterThan(ESPERAS_MS[1]);
  });

  it("não espera além do prazo de quem chamou", async () => {
    const fn = vi.fn().mockRejectedValue(embrulhado(limiteDoGateway()));
    // Orçamento menor que a primeira espera: não adianta dormir, o `waitUntil`
    // morre antes de a chamada voltar.
    const ate = Date.now() + 1_000;

    await expect(comEsperaDeLimite("stt", fn, { ...semDormir, ate })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/**
 * A segunda escada (slice 8).
 *
 * As esperas longas nasceram de **uma** medição — o 429 do free tier, 02/09 —, e
 * o módulo tratava todo o resto como definitivo. Isso ficou caro pelo lado
 * oposto quando o penhasco virou erro: um 502 do Gateway ou um socket que morreu
 * no meio passam sozinhos em segundos, e derrubar a janela por eles passou a
 * custar a sessão inteira.
 */
describe("a falha que passa sozinha", () => {
  const semDormir = { dormir: async () => {} };

  it("reconhece 5xx, 408, socket caído e provedor sobrecarregado", () => {
    expect(ehTransitorio({ statusCode: 503 })).toBe(true);
    expect(ehTransitorio({ statusCode: 408 })).toBe(true);
    expect(ehTransitorio({ type: "overloaded_error" })).toBe(true);
    expect(ehTransitorio(new Error("the model is overloaded, try again"))).toBe(true);

    const rede = new TypeError("fetch failed");
    (rede as { cause?: unknown }).cause = { code: "ECONNRESET" };
    expect(ehTransitorio(rede)).toBe(true);
  });

  it("não reconhece o que falha igual na segunda vez", () => {
    expect(ehTransitorio(new Error("Missing or empty model identifier"))).toBe(false);
    expect(ehTransitorio({ statusCode: 400 })).toBe(false);
    expect(ehTransitorio(null)).toBe(false);
  });

  it("espera segundos, não dezenas de segundos", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ statusCode: 502 }).mockResolvedValue("extraído");
    const dormiu: number[] = [];

    await expect(
      comEsperaDeLimite("extracao", fn, { dormir: async (ms) => void dormiu.push(ms) }),
    ).resolves.toBe("extraído");

    expect(dormiu).toHaveLength(1);
    expect(dormiu[0]).toBeLessThan(ESPERAS_TRANSITORIA_MS[0] * 2);
    expect(esperaTransitoria(0, 0)).toBe(ESPERAS_TRANSITORIA_MS[0]);
  });

  it("desiste depois do teto curto, sem gastar a paciência do 429", async () => {
    const fn = vi.fn().mockRejectedValue({ statusCode: 502 });

    await expect(comEsperaDeLimite("extracao", fn, semDormir)).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(fn).toHaveBeenCalledTimes(ESPERAS_TRANSITORIA_MS.length + 1);
  });

  /**
   * Os contadores são separados de propósito: um blip de rede no começo não
   * pode gastar as tentativas que o limite de taxa vai precisar depois.
   */
  it("um blip de rede não consome as tentativas do rate limit", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 502 })
      .mockRejectedValueOnce(limiteDoGateway())
      .mockRejectedValueOnce(limiteDoGateway())
      .mockResolvedValue("transcrito");

    await expect(comEsperaDeLimite("stt", fn, semDormir)).resolves.toBe("transcrito");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("o prazo de quem chamou vale para as duas escadas", async () => {
    const fn = vi.fn().mockRejectedValue({ statusCode: 502 });

    await expect(
      comEsperaDeLimite("extracao", fn, { ...semDormir, ate: Date.now() - 1 }),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
