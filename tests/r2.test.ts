/**
 * Contrato de transporte do PUT no R2.
 *
 * Os dois casos aqui são falhas reais observadas na primeira gravação de
 * verdade (2026-08-24), nenhuma das duas visível em teste de função pura:
 *
 * 1. sem `Content-Length` o R2 responde 411 quando o corpo sai como stream —
 *    e ele sai como stream no caminho do `waitUntil`, depois da resposta;
 * 2. o R2 comprime o GET de objeto compressível e devolve etag **fraco**
 *    (`W/"…"`). Repassado cru no `If-Match`, o R2 compara estrito e nunca
 *    casa: 412 em toda gravação do manifest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { put } from "@/lib/r2";

const originalFetch = globalThis.fetch;
let enviadas: Request[];

beforeEach(() => {
  process.env.R2_ACCOUNT_ID = "conta";
  process.env.R2_ACCESS_KEY_ID = "chave";
  process.env.R2_SECRET_ACCESS_KEY = "segredo";
  process.env.R2_BUCKET = "balde";

  enviadas = [];
  globalThis.fetch = vi.fn(async (entrada: RequestInfo | URL) => {
    enviadas.push(entrada as Request);
    return new Response(null, { status: 200, headers: { etag: '"abc"' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Content-Length no PUT", () => {
  it("manda o tamanho do corpo em texto — sem ele o R2 dá 411", async () => {
    const corpo = JSON.stringify({ sessao_id: "s1", chunks: [] });
    await put("sessoes/s1/manifest.json", corpo);

    expect(enviadas[0].headers.get("content-length")).toBe(
      String(new TextEncoder().encode(corpo).byteLength),
    );
  });

  it("conta bytes, não caracteres — acento ocupa dois", async () => {
    await put("k", "sessão");
    expect(enviadas[0].headers.get("content-length")).toBe("7");
  });

  it("manda o tamanho de corpo binário", async () => {
    await put("k", new Uint8Array(64));
    expect(enviadas[0].headers.get("content-length")).toBe("64");
  });
});

describe("If-Match precisa de validador forte", () => {
  it("tira o W/ do etag fraco que o GET comprimido devolve", async () => {
    await put("k", "x", { ifMatch: 'W/"a6756cd7e52935b9bb14d42e5c0355f2"' });
    expect(enviadas[0].headers.get("if-match")).toBe('"a6756cd7e52935b9bb14d42e5c0355f2"');
  });

  it("deixa o etag forte como está", async () => {
    await put("k", "x", { ifMatch: '"a6756cd7e52935b9bb14d42e5c0355f2"' });
    expect(enviadas[0].headers.get("if-match")).toBe('"a6756cd7e52935b9bb14d42e5c0355f2"');
  });
});
