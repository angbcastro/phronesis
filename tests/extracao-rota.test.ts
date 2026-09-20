/**
 * `GET /api/sessoes/:id/extracao` — o contrato que a revisão lê.
 *
 * Ele mudou na slice 8.2, e o que mudou é o significado do 404: antes ele era
 * "a proposta ainda não fechou", agora é **"não há nem um átomo"**. É essa
 * diferença que faz a revisão abrir durante a extração em vez de esperar, e é
 * ela que este arquivo prende — junto com o que decide o rodapé e a trava do
 * confirmar (`crescendo`, `trechos_totais`, `trechos_faltando`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pipeline", () => ({ propostaAtual: vi.fn() }));
vi.mock("@/lib/r2", () => ({ getJson: vi.fn(async () => null) }));
vi.mock("@/lib/sessoes", () => ({ buscarSessao: vi.fn() }));

import { GET } from "@/app/api/sessoes/[id]/extracao/route";
import { propostaAtual } from "@/lib/pipeline";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import type { PropostaAtual } from "@/lib/pipeline";
import type { StatusSessao } from "@/lib/tipos";

const SESSAO = "mu4um3ot3t5k4g1u1p1j";

const extracao = (n: number) =>
  ({
    sessao_id: SESSAO,
    atomos: Array.from({ length: n }, (_, k) => ({ id: `${SESSAO}-${k}`, indice: k })),
    entidades: [],
    descartados: [],
    prompt_version: "extracao-9",
    modelo: "zai/glm-5.3-flash",
    prompt_version_resolucao: null,
    modelo_resolucao: null,
    granularidade: "palavra",
    criado_em: "2026-09-20T12:10:00.000Z",
  }) as unknown as PropostaAtual["extracao"];

const chamar = (busca = "") =>
  GET(new Request(`http://localhost/api/sessoes/${SESSAO}/extracao${busca}`), {
    params: Promise.resolve({ id: SESSAO }),
  });

const sessaoEm = (status: StatusSessao) =>
  vi.mocked(buscarSessao).mockResolvedValue({
    id: SESSAO,
    status,
    iniciada_em: "2026-09-20T12:00:00.000Z",
    duracao_s: 203,
  } as never);

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue(null as never);
  vi.mocked(propostaAtual).mockReset();
  vi.mocked(buscarSessao).mockReset();
  sessaoEm("extraindo");
});

describe("a proposta, como a revisão a recebe", () => {
  it("id inválido nem chega a bater no R2", async () => {
    const r = await GET(new Request("http://localhost/api/sessoes/x/extracao"), {
      params: Promise.resolve({ id: "não é id" }),
    });
    expect(r.status).toBe(400);
    expect(propostaAtual).not.toHaveBeenCalled();
  });

  it("sessão que não existe é 404, e não 502", async () => {
    vi.mocked(buscarSessao).mockResolvedValue(null as never);
    vi.mocked(propostaAtual).mockResolvedValue(null);
    expect((await chamar()).status).toBe(404);
  });

  it("zero átomo é 404 — é a única condição em que a ponte continua de pé", async () => {
    vi.mocked(propostaAtual).mockResolvedValue(null);

    const r = await chamar();

    expect(r.status).toBe(404);
    expect(((await r.json()) as { erro: string }).erro).toContain("extraindo");
  });

  it("a proposta que cresce vem com 200, e com quanto falta", async () => {
    vi.mocked(propostaAtual).mockResolvedValue({
      extracao: extracao(5),
      blocos: [{ i: 0, texto: "", offset_s: 0 }],
      crescendo: true,
      trechos_totais: 9,
      trechos_faltando: 2,
      anterior: null,
    });

    const r = await chamar();
    const d = (await r.json()) as Record<string, unknown>;

    expect(r.status).toBe(200);
    expect(d.crescendo).toBe(true);
    expect(d.trechos_totais).toBe(9);
    expect(d.trechos_faltando).toBe(2);
    expect(d.blocos).toHaveLength(1);
  });

  it("a proposta fechada não diz que cresce — é o que destrava o confirmar", async () => {
    sessaoEm("em_revisao");
    vi.mocked(propostaAtual).mockResolvedValue({
      extracao: extracao(9),
      blocos: [],
      crescendo: false,
      anterior: null,
    });

    const d = (await (await chamar()).json()) as Record<string, unknown>;

    expect(d.crescendo).toBe(false);
    expect(d.trechos_totais).toBeUndefined();
    expect(d.status).toBe("em_revisao");
  });

  it("a proposta anterior vem como cabeçalho, sem a lista", async () => {
    vi.mocked(propostaAtual).mockResolvedValue({
      extracao: extracao(9),
      blocos: [],
      crescendo: false,
      anterior: {
        atomos: 4,
        prompt_version: "extracao-8",
        modelo: "zai/glm-5.3-flash",
        criado_em: "2026-09-19T12:00:00.000Z",
      },
    });

    const d = (await (await chamar()).json()) as { anterior: Record<string, unknown> };

    expect(d.anterior.atomos).toBe(4);
    expect(d.anterior.lista).toBeUndefined();
    // A metade cara da resposta não é paga por quem não pediu.
    expect(getJson).not.toHaveBeenCalled();
  });

  it("`?anterior=1` paga a lista antiga, e só então", async () => {
    vi.mocked(propostaAtual).mockResolvedValue({
      extracao: extracao(9),
      blocos: [],
      crescendo: false,
      anterior: {
        atomos: 4,
        prompt_version: "extracao-8",
        modelo: "zai/glm-5.3-flash",
        criado_em: "2026-09-19T12:00:00.000Z",
      },
    });
    vi.mocked(getJson).mockResolvedValue({ valor: extracao(4), etag: "a" } as never);

    const d = (await (await chamar("?anterior=1")).json()) as {
      anterior: { lista?: unknown[] };
    };

    expect(d.anterior.lista).toHaveLength(4);
  });

  it("R2 fora do ar é 502 com a causa legível, e não 500 cru", async () => {
    vi.mocked(propostaAtual).mockRejectedValue(new Error("fetch failed"));
    expect((await chamar()).status).toBe(502);
  });
});
