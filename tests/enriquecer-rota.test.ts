/**
 * `POST /api/entidades/enriquecer { elo: true }` — a corrente da fila.
 *
 * O que se prende aqui é o que faltou em 23/09 (slice 4.12.1): quando o elo
 * seguinte responde fora de 2xx, a quebra deixa uma linha `[fila]` **com o
 * status**, em vez de passar como sucesso e a fila parar calada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pendentes: Promise<unknown>[] = [];
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => pendentes.push(p),
}));
vi.mock("@/lib/entidades", () => ({
  acharPorChave: vi.fn(),
  listarEntidades: vi.fn(async () => []),
  passadaDeVetores: vi.fn(async () => {}),
}));
vi.mock("@/lib/enriquecimento", () => ({
  EnriquecimentoError: class extends Error {},
  TETO_MOTIVO: 300,
  enfileirar: vi.fn(),
  enriquecer: vi.fn(),
  marcarEstado: vi.fn(),
  reivindicarProxima: vi.fn(),
  rodarElo: vi.fn(async () => null),
}));

import { POST } from "@/app/api/entidades/enriquecer/route";
import { reivindicarProxima } from "@/lib/enriquecimento";

const reivindicar = vi.mocked(reivindicarProxima);
const busca = vi.fn();
let erro: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;

const elo = async (corpo: Record<string, unknown> = { elo: true }) => {
  const r = await POST(
    new Request("http://localhost/api/entidades/enriquecer", {
      method: "POST",
      headers: { cookie: "sessao=abc" },
      body: JSON.stringify(corpo),
    }),
  );
  await Promise.all(pendentes.splice(0));
  return r;
};

beforeEach(() => {
  pendentes.length = 0;
  reivindicar.mockReset();
  busca.mockReset();
  vi.stubGlobal("fetch", busca);
  erro = vi.spyOn(console, "error").mockImplementation(() => {});
  info = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  erro.mockRestore();
  info.mockRestore();
});

const linhasDeErro = () => erro.mock.calls.map((c) => String(c[0]));

describe("o encadeamento", () => {
  it("o elo seguinte que responde fora de 2xx deixa o status no log", async () => {
    reivindicar.mockResolvedValue("rapha");
    busca.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    await elo();
    expect(linhasDeErro()).toContainEqual(
      expect.stringMatching(/^\[fila\] o elo seguinte respondeu 500: Internal Server Error — a fila para aqui$/),
    );
  });

  it("o 401 do middleware também — é a outra causa que 23/09 não deixou ver", async () => {
    reivindicar.mockResolvedValue("rapha");
    busca.mockResolvedValue(new Response(`{"erro":"não autenticado"}`, { status: 401 }));

    await elo();
    expect(linhasDeErro().some((l) => l.includes("respondeu 401"))).toBe(true);
  });

  it("repassa o meu cookie ao elo seguinte", async () => {
    reivindicar.mockResolvedValue("rapha");
    busca.mockResolvedValue(new Response("{}", { status: 200 }));

    await elo();
    const init = busca.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).cookie).toBe("sessao=abc");
    expect(JSON.parse(String(init.body))).toEqual({ elo: true });
    expect(linhasDeErro()).toEqual([]);
  });

  it("a exceção de rede continua logada, e não derruba a rota", async () => {
    reivindicar.mockResolvedValue("rapha");
    busca.mockRejectedValue(new Error("ECONNRESET"));

    expect((await elo()).status).toBe(200);
    expect(linhasDeErro().some((l) => l.includes("não consegui chamar o elo seguinte"))).toBe(true);
  });

  it("fila vazia não encadeia", async () => {
    reivindicar.mockResolvedValue(null);
    await elo();
    expect(busca).not.toHaveBeenCalled();
  });
});
