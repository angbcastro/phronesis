/**
 * `GET /api/cron/enriquecimento` — a batida semanal (slice 4.12.1).
 *
 * O que se prende é o contrato da corrente sem cookie: a batida enfileira e a
 * continuação não; a fila vazia para; e o orçamento no fim chama a própria rota
 * com a credencial do cron — sem ela o middleware devolveria 401 e a fila
 * pararia calada, que é o defeito que esta fatia existe para consertar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pendentes: Promise<unknown>[] = [];
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => pendentes.push(p),
}));
vi.mock("@/lib/entidades", () => ({
  listarEntidades: vi.fn(async () => []),
  passadaDeVetores: vi.fn(async () => {}),
}));
vi.mock("@/lib/enriquecimento", () => ({
  enfileirarCanonicasComNovidade: vi.fn(async () => 3),
  reivindicarProxima: vi.fn(),
  rodarElo: vi.fn(async () => null),
}));

import { GET } from "@/app/api/cron/enriquecimento/route";
import {
  enfileirarCanonicasComNovidade,
  reivindicarProxima,
  rodarElo,
} from "@/lib/enriquecimento";

const enfileirar = vi.mocked(enfileirarCanonicasComNovidade);
const reivindicar = vi.mocked(reivindicarProxima);
const rodar = vi.mocked(rodarElo);
const busca = vi.fn();

const bater = async (busca_ = "") => {
  const r = await GET(new Request(`https://phronesis.test/api/cron/enriquecimento${busca_}`));
  await Promise.all(pendentes.splice(0));
  return r;
};

beforeEach(() => {
  pendentes.length = 0;
  process.env.CRON_SECRET = "segredo-do-cron";
  enfileirar.mockClear();
  reivindicar.mockReset();
  rodar.mockClear();
  busca.mockReset();
  busca.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", busca);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a batida semanal", () => {
  it("enfileira as canônicas com novidade e anda a fila até esvaziar", async () => {
    reivindicar
      .mockResolvedValueOnce("eu")
      .mockResolvedValueOnce("adapta")
      .mockResolvedValueOnce(null);

    const r = await bater();
    expect(await r.json()).toEqual({ ok: true, continuacao: false, na_fila: 3 });
    expect(enfileirar).toHaveBeenCalledTimes(1);
    expect(rodar.mock.calls.map((c) => c[0])).toEqual(["eu", "adapta"]);
    expect(busca).not.toHaveBeenCalled();
  });

  it("a continuação não enfileira de novo: só processa", async () => {
    reivindicar.mockResolvedValue(null);
    const r = await bater("?continuacao=1");
    expect(await r.json()).toMatchObject({ continuacao: true, na_fila: 0 });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("orçamento no fim com fila sobrando chama a si mesma, com a credencial do cron", async () => {
    let t = 0;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    reivindicar.mockResolvedValue("eu");
    rodar.mockImplementation(async () => {
      t += 100_000; // cada ficha leva 100 s: a segunda passa do orçamento
      return null;
    });

    await bater();
    expect(rodar).toHaveBeenCalledTimes(2);
    expect(busca).toHaveBeenCalledTimes(1);
    const [url, init] = busca.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://phronesis.test/api/cron/enriquecimento?continuacao=1");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer segredo-do-cron");
  });

  it("a continuação que responde fora de 2xx deixa o status no log", async () => {
    let t = 0;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    reivindicar.mockResolvedValue("eu");
    rodar.mockImplementation(async () => {
      t += 200_000;
      return null;
    });
    busca.mockResolvedValue(new Response("não autenticado", { status: 401 }));

    await bater();
    const linhas = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(linhas.some((l) => l.includes("a continuação respondeu 401"))).toBe(true);
  });

  it("o grafo caído para a corrente — continuar viraria um laço de invocações", async () => {
    reivindicar.mockResolvedValueOnce("eu").mockRejectedValueOnce(new Error("Aura fora"));
    await bater();
    expect(busca).not.toHaveBeenCalled();
    const linhas = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(linhas.some((l) => l.includes("a fila para aqui"))).toBe(true);
  });
});
