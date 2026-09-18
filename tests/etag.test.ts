/**
 * O laço read-modify-write por etag, agora num lugar só (slice 8).
 *
 * O que este arquivo protege é a promessa que as quatro cópias faziam cada uma
 * por conta própria: **duas escritas quase simultâneas se somam** em vez de a
 * segunda apagar a primeira. Sem `LIST` no R2, o que uma escrita apaga é
 * inalcançável para sempre — é por isso que esta é a única concorrência do
 * sistema que tem teste próprio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => {
  class ConflitoR2Error extends Error {
    constructor(key: string) {
      super(`R2 PUT ${key} rejeitado por condicional (412)`);
      this.name = "ConflitoR2Error";
    }
  }
  return { getJson: vi.fn(), putJson: vi.fn(async () => ({ etag: null })), ConflitoR2Error };
});

import { atualizarJson } from "@/lib/etag";
import { ConflitoR2Error, getJson, putJson } from "@/lib/r2";

interface Caixa {
  itens: string[];
}

const vazia = (): Caixa => ({ itens: [] });
const naoDormir = async () => {};

beforeEach(() => {
  vi.mocked(getJson).mockReset();
  vi.mocked(putJson).mockReset().mockResolvedValue({ etag: '"novo"' });
});

describe("atualizarJson", () => {
  it("cria o objeto com If-None-Match quando ele ainda não existe", async () => {
    vi.mocked(getJson).mockResolvedValue(null);

    const r = await atualizarJson<Caixa>("k", (c) => c ?? vazia(), (c) => ({ itens: [...c.itens, "a"] }));

    expect(r.mudou).toBe(true);
    expect(r.valor.itens).toEqual(["a"]);
    expect(vi.mocked(putJson).mock.calls[0][2]).toEqual({ ifNoneMatch: "*" });
  });

  it("grava com If-Match quando já existe, para a escrita alheia não sumir", async () => {
    vi.mocked(getJson).mockResolvedValue({ valor: { itens: ["a"] }, etag: '"v1"' });

    await atualizarJson<Caixa>("k", (c) => c ?? vazia(), (c) => ({ itens: [...c.itens, "b"] }));

    expect(vi.mocked(putJson).mock.calls[0][2]).toEqual({ ifMatch: '"v1"' });
  });

  it("reaplica o mutador sobre o corrente depois de um conflito — as duas escritas se somam", async () => {
    vi.mocked(getJson)
      .mockResolvedValueOnce({ valor: { itens: ["a"] }, etag: '"v1"' })
      // Entre a leitura e a escrita, outro worker acrescentou "b".
      .mockResolvedValueOnce({ valor: { itens: ["a", "b"] }, etag: '"v2"' });
    vi.mocked(putJson).mockRejectedValueOnce(new ConflitoR2Error("k"));

    const r = await atualizarJson<Caixa>(
      "k",
      (c) => c ?? vazia(),
      (c) => ({ itens: [...c.itens, "c"] }),
      { dormir: naoDormir },
    );

    expect(r.valor.itens).toEqual(["a", "b", "c"]);
    expect(putJson).toHaveBeenCalledTimes(2);
  });

  it("mutador que devolve null não grava, e diz que a escrita não foi minha", async () => {
    vi.mocked(getJson).mockResolvedValue({ valor: { itens: ["a"] }, etag: '"v1"' });

    const r = await atualizarJson<Caixa>("k", (c) => c ?? vazia(), () => null);

    expect(r).toEqual({ valor: { itens: ["a"] }, mudou: false });
    expect(putJson).not.toHaveBeenCalled();
  });

  it("mutador que devolve o mesmo objeto não paga um PUT à toa", async () => {
    vi.mocked(getJson).mockResolvedValue({ valor: { itens: ["a"] }, etag: '"v1"' });

    const r = await atualizarJson<Caixa>("k", (c) => c ?? vazia(), (c) => c);

    expect(r.mudou).toBe(false);
    expect(putJson).not.toHaveBeenCalled();
  });

  it("mas cria o objeto quando ele não existia, mesmo com o mutador devolvendo a base", async () => {
    // Criar **é** a mudança: um manifest vazio que nunca foi gravado precisa
    // existir para a próxima leitura ter etag.
    vi.mocked(getJson).mockResolvedValue(null);

    const r = await atualizarJson<Caixa>("k", (c) => c ?? vazia(), (c) => c);

    expect(r.mudou).toBe(true);
    expect(putJson).toHaveBeenCalledTimes(1);
  });

  it("normaliza a cada volta, e não uma vez só", async () => {
    // O objeto no R2 pode ser de uma versão anterior do tipo — é o caso do
    // índice de calibração da 4.6, sem `padroes`.
    vi.mocked(getJson)
      .mockResolvedValueOnce({ valor: {} as Caixa, etag: '"v1"' })
      .mockResolvedValueOnce({ valor: {} as Caixa, etag: '"v2"' });
    vi.mocked(putJson).mockRejectedValueOnce(new ConflitoR2Error("k"));

    const normalizar = vi.fn((c: Caixa | undefined) => ({ itens: c?.itens ?? [] }));
    await atualizarJson<Caixa>("k", normalizar, (c) => ({ itens: [...c.itens, "a"] }), {
      dormir: naoDormir,
    });

    expect(normalizar).toHaveBeenCalledTimes(2);
  });

  it("desiste depois das tentativas, e a frase diz de que objeto ela fala", async () => {
    vi.mocked(getJson).mockResolvedValue({ valor: { itens: [] }, etag: '"v1"' });
    vi.mocked(putJson).mockRejectedValue(new ConflitoR2Error("k"));

    await expect(
      atualizarJson<Caixa>("k", (c) => c ?? vazia(), (c) => ({ itens: [...c.itens, "a"] }), {
        tentativas: 3,
        rotulo: "a caixa",
        dormir: naoDormir,
      }),
    ).rejects.toThrow("Não consegui gravar a caixa após 3 tentativas");
    expect(putJson).toHaveBeenCalledTimes(3);
  });

  it("erro que não é conflito sobe na primeira — repetir não conserta R2 fora do ar", async () => {
    vi.mocked(getJson).mockResolvedValue(null);
    vi.mocked(putJson).mockRejectedValue(new Error("R2 fora do ar"));

    await expect(
      atualizarJson<Caixa>("k", (c) => c ?? vazia(), (c) => c, { dormir: naoDormir }),
    ).rejects.toThrow("R2 fora do ar");
    expect(putJson).toHaveBeenCalledTimes(1);
  });

  it("respeita o teto da espera — dez tentativas não viram dezenas de segundos", async () => {
    vi.mocked(getJson).mockResolvedValue({ valor: { itens: [] }, etag: '"v1"' });
    vi.mocked(putJson).mockRejectedValue(new ConflitoR2Error("k"));

    const esperas: number[] = [];
    await atualizarJson<Caixa>("k", (c) => c ?? vazia(), (c) => ({ itens: [...c.itens, "a"] }), {
      tentativas: 6,
      base_ms: 100,
      teto_ms: 300,
      dormir: async (ms) => void esperas.push(ms),
    }).catch(() => {});

    expect(esperas.every((ms) => ms <= 340)).toBe(true);
  });
});
