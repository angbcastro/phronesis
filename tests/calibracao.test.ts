/**
 * A persistência das correções no R2.
 *
 * Duas promessas, e as duas são invisíveis quando quebram: o registro de uma
 * revisão nunca é sobrescrito por um reenvio, e duas escritas concorrentes no
 * índice se **somam** em vez de a segunda apagar a primeira. Sem `LIST` no R2,
 * correção que sai do índice é inatingível para sempre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A classe mora dentro da fábrica: `vi.mock` é içado para o topo do arquivo, e
// uma variável de fora ainda não existe quando ele roda.
vi.mock("@/lib/r2", () => {
  class ConflitoR2Error extends Error {
    constructor(key: string) {
      super(`R2 PUT ${key} rejeitado por condicional (412)`);
      this.name = "ConflitoR2Error";
    }
  }
  return {
    getJson: vi.fn(),
    putJson: vi.fn(async () => ({ etag: null })),
    ConflitoR2Error,
  };
});

import { atualizarIndice, capturarCorrecoes, carregarIndice } from "@/lib/calibracao";
import { indiceVazio, juntarNoIndice } from "@/lib/correcoes";
import { ConflitoR2Error, getJson, putJson } from "@/lib/r2";
import type { Correcao, Extracao, IndiceCalibracao } from "@/lib/tipos";

const SESSAO = "mtgn3zf7";
const EM = "2026-09-03T21:00:00.000Z";

const correcao = (id: string): Correcao =>
  ({
    id,
    sessao_id: SESSAO,
    atomo_id: null,
    entidade_chave: null,
    agente: "extracao",
    tipo: "texto",
    antes: "a",
    depois: "b",
    tipo_atomo: null,
    texto_proposto: "",
    inicios_s: [],
    prompt_version: "extracao-5",
    modelo: "m",
    tocado: true,
    em: EM,
    incorporada_em: null,
  }) as Correcao;

const comCorrecoes = (ids: string[]): IndiceCalibracao => ({
  ...indiceVazio(EM),
  correcoes: ids.map(correcao),
});

const proposta = (atomos: unknown[]): Extracao =>
  ({
    sessao_id: SESSAO,
    atomos,
    entidades: [],
    descartados: [],
    prompt_version: "extracao-5",
    modelo: "zai/glm-5.3-flash",
    prompt_version_resolucao: null,
    modelo_resolucao: null,
    granularidade: "palavra",
    criado_em: EM,
  }) as Extracao;

const atomo = (indice: number) => ({
  id: `${SESSAO}-${indice}`,
  indice,
  texto: "Terminei o esboço",
  tipo: "FATO",
  sobre: { citado: "eu", entidade: "eu", conhecida: false, certo: true, alternativas: [], motivo: "", porque: [] },
  menciona: [],
  trechos: [{ texto: "terminei", inicio_s: 12, fim_s: 14, ancora: "exata" }],
  perfila: [],
  prompt_version: "extracao-5",
  modelo: "zai/glm-5.3-flash",
});

/** Os PUTs que aconteceram, por chave. */
const puts = () => vi.mocked(putJson).mock.calls.map(([key, valor, opcoes]) => ({ key, valor, opcoes }));
const putEm = (sufixo: string) => puts().filter((p) => p.key.endsWith(sufixo));

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue(null);
  vi.mocked(putJson).mockReset().mockResolvedValue({ etag: null } as never);
});

describe("o índice, lido e gravado por etag", () => {
  it("índice que ainda não existe nasce vazio, sem estourar", async () => {
    const i = await carregarIndice();
    expect(i.correcoes).toEqual([]);
    expect(i.padroes).toEqual([]);
    expect(i.visitado_em).toEqual({});
  });

  it("a primeira escrita usa If-None-Match, para não atropelar quem chegou junto", async () => {
    await atualizarIndice((i) => juntarNoIndice(i, [correcao("a")], EM));
    expect(putEm("calibracao/indice.json")[0].opcoes).toEqual({ ifNoneMatch: "*" });
  });

  it("índice que já existe é gravado com o etag que acabou de ser lido", async () => {
    vi.mocked(getJson).mockResolvedValue({ valor: comCorrecoes(["velha"]), etag: 'W/"abc"' } as never);

    await atualizarIndice((i) => juntarNoIndice(i, [correcao("nova")], EM));

    const p = putEm("calibracao/indice.json")[0];
    expect(p.opcoes).toEqual({ ifMatch: 'W/"abc"' });
    expect((p.valor as IndiceCalibracao).correcoes.map((c) => c.id)).toEqual(["nova", "velha"]);
  });

  it("conflito relê o corrente e reaplica — a correção do outro não se perde", async () => {
    vi.mocked(getJson)
      .mockResolvedValueOnce({ valor: comCorrecoes([]), etag: '"v1"' } as never)
      .mockResolvedValueOnce({ valor: comCorrecoes(["de outro worker"]), etag: '"v2"' } as never);
    vi.mocked(putJson).mockRejectedValueOnce(new ConflitoR2Error("k"));

    await atualizarIndice((i) => juntarNoIndice(i, [correcao("minha")], EM));

    const ultimo = putEm("calibracao/indice.json").at(-1)!;
    expect((ultimo.valor as IndiceCalibracao).correcoes.map((c) => c.id)).toEqual([
      "minha",
      "de outro worker",
    ]);
    expect(ultimo.opcoes).toEqual({ ifMatch: '"v2"' });
  });

  it("erro que não é conflito sobe — não é caso de tentar de novo", async () => {
    vi.mocked(putJson).mockRejectedValue(new Error("R2 fora do ar"));
    await expect(atualizarIndice((i) => juntarNoIndice(i, [correcao("a")], EM))).rejects.toThrow(
      "R2 fora do ar",
    );
  });

  it("mutador que não muda nada não grava", async () => {
    vi.mocked(getJson).mockResolvedValue({ valor: comCorrecoes(["a"]), etag: '"v1"' } as never);
    await atualizarIndice((i) => juntarNoIndice(i, [correcao("a")], EM));
    expect(putEm("calibracao/indice.json")).toHaveLength(0);
  });
});

describe("capturar as correções de uma revisão", () => {
  it("grava o registro da sessão e o índice, nesta ordem", async () => {
    const n = await capturarCorrecoes({
      proposta: proposta([atomo(0)]),
      confirmados: [],
      entidades: [],
      gestos: null,
      em: EM,
    });

    expect(n).toBe(1);
    expect(puts().map((p) => p.key)).toEqual([
      `sessoes/${SESSAO}/correcoes.json`,
      "calibracao/indice.json",
    ]);
    expect(putEm("correcoes.json")[0].opcoes).toEqual({ ifNoneMatch: "*" });
  });

  it("revisão sem correção nenhuma grava o registro vazio e não toca o índice", async () => {
    const n = await capturarCorrecoes({
      proposta: proposta([]),
      confirmados: [],
      entidades: [],
      gestos: null,
      em: EM,
    });

    expect(n).toBe(0);
    expect(puts().map((p) => p.key)).toEqual([`sessoes/${SESSAO}/correcoes.json`]);
  });

  it("reenvio não sobrescreve o registro permanente, e o índice segue em frente", async () => {
    vi.mocked(putJson).mockImplementation(async (key: string) =>
      key.endsWith("correcoes.json") ? Promise.reject(new ConflitoR2Error("k")) : { etag: null },
    );

    await expect(
      capturarCorrecoes({
        proposta: proposta([atomo(0)]),
        confirmados: [],
        entidades: [],
        gestos: null,
        em: EM,
      }),
    ).resolves.toBe(1);

    expect(putEm("calibracao/indice.json")).toHaveLength(1);
  });

  it("sem faltante nenhum, a transcrição nem é lida", async () => {
    await capturarCorrecoes({
      proposta: proposta([atomo(0)]),
      confirmados: [],
      entidades: [],
      gestos: { atomos: [], entidades_recusadas: [], renomes: [], faltantes: [] },
      em: EM,
    });

    const lidas = vi.mocked(getJson).mock.calls.map(([key]) => key);
    expect(lidas.some((k) => k.endsWith("transcricao.json"))).toBe(false);
  });

  it("com faltante, a transcrição é lida e o texto nasce ancorado", async () => {
    vi.mocked(getJson).mockImplementation(async (key: string) =>
      key.endsWith("transcricao.json")
        ? ({
            valor: {
              palavras: [
                { palavra: "esqueci", inicio: 400, fim: 400.4 },
                { palavra: "do", inicio: 400.4, fim: 400.6 },
                { palavra: "médico", inicio: 400.6, fim: 401 },
              ],
            },
            etag: null,
          } as never)
        : null,
    );

    await capturarCorrecoes({
      proposta: proposta([]),
      confirmados: [],
      entidades: [],
      gestos: {
        atomos: [],
        entidades_recusadas: [],
        renomes: [],
        faltantes: [{ texto: "esqueci do médico" }],
      },
      em: EM,
    });

    const registro = putEm("correcoes.json")[0].valor as { correcoes: Correcao[] };
    expect(registro.correcoes[0]).toMatchObject({ tipo: "faltou", inicios_s: [400] });
  });
});
