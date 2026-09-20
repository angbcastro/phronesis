/**
 * A proposta que se deixa ver antes de fechar (slice 8.2).
 *
 * Duas peças, e as duas erram calado se ninguém as prender aqui:
 *
 *   `propostaAtual`        de onde sai a lista — `extracao.json` quando existe,
 *                          o acumulado das janelas enquanto não existe, e `null`
 *                          só quando não há nem um átomo (é o que mantém a ponte
 *                          de `Processando` visível)
 *   `acompanharProposta`   o laço do fluxo: quando emitir, quando **não** emitir,
 *                          e quando desistir. Emitir demais é remontar a
 *                          proposta a cada 700 ms; emitir de menos é a tela
 *                          esperando para sempre com o confirmar travado
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(),
  putJson: vi.fn(),
  getBytes: vi.fn(),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

vi.mock("@/lib/extracao", () => ({
  extrair: vi.fn(),
  extrairJanela: vi.fn(),
  PROMPT_VERSION: "extracao-9",
}));

vi.mock("@/lib/entidades", async (original) => ({
  ...(await original<typeof import("@/lib/entidades")>()),
  listarEntidades: vi.fn(async () => []),
  agregarCandidatas: vi.fn(() => []),
  candidatosSemanticos: vi.fn(async (textos: readonly string[]) => textos.map(() => [])),
}));

vi.mock("@/lib/manifest", () => ({
  carregarManifest: vi.fn(),
  atualizarManifest: vi.fn(async (_id: string, m: unknown) => m),
  extensaoDoChunk: vi.fn(() => "webm"),
  marcarTranscrito: vi.fn((m) => m),
  soltarBloco: vi.fn((m) => m),
  reivindicarTranscricao: vi.fn(async () => true),
  pendentes: vi.fn(() => []),
  tudoTranscrito: vi.fn(() => true),
}));

vi.mock("@/lib/sessoes", () => ({
  buscarSessao: vi.fn(),
  atualizarSessao: vi.fn(async () => null),
}));

import { acompanharProposta, propostaAtual } from "@/lib/pipeline";
import { listarEntidades } from "@/lib/entidades";
import { carregarManifest } from "@/lib/manifest";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import type { EventoDaProposta } from "@/lib/pipeline";
import type { AtomoProposto, EstadoJanela, Parcial, StatusSessao } from "@/lib/tipos";

const CHAVE_PARCIAL = "sessoes/s1/parcial.json";
const CHAVE_EXTRACAO = "sessoes/s1/extracao.json";

let r2: Map<string, { valor: unknown; etag: string }>;

const bloco = (i: number) => ({
  i,
  texto: `bloco ${i} falado`,
  palavras: [{ palavra: "bloco", inicio: 0, fim: 1 }],
  modelo: "xai/grok-stt",
  granularidade: "palavra" as const,
});

/** Um manifest com `n` blocos, todos transcritos. */
const manifest = (n: number) => ({
  sessao_id: "s1",
  chunks: Array.from({ length: n }, (_, i) => ({
    i,
    bytes: 100,
    subido_em: "2026-09-20T12:00:00.000Z",
    transcrito: true,
  })),
  finalizado: false,
});

const atomo = (k: number): AtomoProposto =>
  ({
    id: `s1-${k}`,
    indice: k,
    texto: `átomo ${k}`,
    tipo: "FATO",
    sobre: {
      citado: "eu",
      entidade: "eu",
      conhecida: false,
      certo: true,
      alternativas: [],
      motivo: "",
      porque: [],
    },
    menciona: [],
    perfila: [],
    trechos: [],
    prompt_version: "extracao-9",
    modelo: "zai/glm-5.3-flash",
  }) as unknown as AtomoProposto;

const janela = (n: number, estado: EstadoJanela["estado"]): EstadoJanela => ({
  n,
  de: n * 4,
  ate: n * 4 + 3,
  estado,
  em: "2026-09-20T12:00:00.000Z",
});

/** O acumulado: `atomos` átomos, e as janelas nos estados pedidos. */
const parcial = (
  atomos: number,
  estados: EstadoJanela["estado"][],
  atualizado_em = "2026-09-20T12:00:00.000Z",
): Parcial => ({
  sessao_id: "s1",
  janelas: estados.map((e, n) => janela(n, e)),
  atomos: Array.from({ length: atomos }, (_, k) => atomo(k)),
  entidades: [],
  descartados: [],
  atualizado_em,
});

const extracaoFinal = {
  sessao_id: "s1",
  atomos: [atomo(0), atomo(1), atomo(2)],
  entidades: [],
  descartados: [],
  prompt_version: "extracao-9",
  modelo: "zai/glm-5.3-flash",
  prompt_version_resolucao: null,
  modelo_resolucao: null,
  granularidade: "palavra",
  criado_em: "2026-09-20T12:10:00.000Z",
};

const sessaoEm = (status: StatusSessao) =>
  vi.mocked(buscarSessao).mockResolvedValue({
    id: "s1",
    status,
    iniciada_em: "2026-09-20T12:00:00.000Z",
  } as never);

beforeEach(() => {
  r2 = new Map();
  for (let i = 0; i < 8; i++) {
    r2.set(`sessoes/s1/chunk_00${i}.json`, { valor: bloco(i), etag: "b" });
  }
  vi.mocked(getJson).mockImplementation(async (key: string) => r2.get(key) ?? null);
  vi.mocked(carregarManifest).mockResolvedValue(manifest(8) as never);
  vi.mocked(listarEntidades).mockResolvedValue([] as never);
  sessaoEm("extraindo");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("de onde sai a proposta que a revisão mostra", () => {
  it("sem parcial e sem extração não há o que mostrar — a ponte continua de pé", async () => {
    expect(await propostaAtual("s1")).toBeNull();
  });

  it("parcial sem átomo nenhum também é null: janela reivindicada não é proposta", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(0, ["em_curso"]), etag: "p" });
    expect(await propostaAtual("s1")).toBeNull();
  });

  it("o acumulado das janelas vira proposta, dizendo que ainda cresce", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(5, ["pronta", "em_curso"]), etag: "p" });

    const p = await propostaAtual("s1");

    expect(p?.crescendo).toBe(true);
    expect(p?.extracao.atomos).toHaveLength(5);
    expect(p?.trechos_totais).toBe(2);
    expect(p?.trechos_faltando).toBe(1);
  });

  it("a janela que falhou conta como faltando — ela ainda vai ser retentada", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(2, ["pronta", "falhou"]), etag: "p" });
    expect((await propostaAtual("s1"))?.trechos_faltando).toBe(1);
  });

  it("o mapa de blocos vem junto, e é o que faz o player funcionar antes do fim", async () => {
    // `transcricao.json` só existe depois que a sessão fecha; sem este mapa, a
    // revisão que cresce teria átomo sem botão de escutar.
    r2.set(CHAVE_PARCIAL, { valor: parcial(1, ["pronta", "em_curso"]), etag: "p" });

    const p = await propostaAtual("s1");

    expect(p?.blocos).toHaveLength(8);
    expect(p?.blocos[1]).toMatchObject({ i: 1, offset_s: 30 });
  });

  it("existindo extração, ela vence o parcial e a proposta não cresce mais", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(5, ["pronta", "pronta"]), etag: "p" });
    r2.set(CHAVE_EXTRACAO, { valor: extracaoFinal, etag: "e" });

    const p = await propostaAtual("s1");

    expect(p?.crescendo).toBe(false);
    expect(p?.extracao.atomos).toHaveLength(3);
    expect(p?.trechos_totais).toBeUndefined();
  });
});

/**
 * O laço do fluxo, com relógio e sono injetados.
 *
 * `dormir` é também o roteiro: cada volta consome um passo que mexe no R2 como
 * uma janela fechando mexeria. É o que permite testar "só emite quando mudou"
 * sem rede e sem esperar 700 ms de verdade.
 */
describe("o fluxo que a revisão consome", () => {
  let relogio: number;
  let eventos: EventoDaProposta[];
  let roteiro: Array<() => void>;

  const agora = () => relogio;
  const dormir = async (ms: number) => {
    relogio += ms;
    roteiro.shift()?.();
  };
  const manda = (e: EventoDaProposta) => eventos.push(e);

  const acompanhar = (teto = 5_000) =>
    acompanharProposta("s1", manda, { agora, dormir, intervalo: 700, teto });

  beforeEach(() => {
    relogio = 0;
    eventos = [];
    roteiro = [];
  });

  it("manda a proposta que já existe e continua enquanto ela cresce", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(2, ["pronta", "em_curso"], "t1"), etag: "p" });
    roteiro = [
      () => r2.set(CHAVE_PARCIAL, { valor: parcial(5, ["pronta", "pronta"], "t2"), etag: "p" }),
      () => r2.set(CHAVE_EXTRACAO, { valor: extracaoFinal, etag: "e" }),
    ];

    await acompanhar();

    expect(eventos.map((e) => e.tipo)).toEqual(["proposta", "proposta", "proposta"]);
    const propostas = eventos.flatMap((e) => (e.tipo === "proposta" ? [e.proposta] : []));
    expect(propostas.map((p) => p.extracao.atomos.length)).toEqual([2, 5, 3]);
    expect(propostas.map((p) => p.crescendo)).toEqual([true, true, false]);
  });

  it("a proposta fechada é o último evento: depois dela não há mais o que esperar", async () => {
    r2.set(CHAVE_EXTRACAO, { valor: extracaoFinal, etag: "e" });
    roteiro = [() => expect.unreachable("o laço devia ter parado no primeiro evento")];

    await acompanhar();

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "proposta", proposta: { crescendo: false } });
  });

  it("parcial sem mudança não vira evento — é o carimbo segurando o custo", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(2, ["pronta", "em_curso"], "t1"), etag: "p" });

    await acompanhar(2_800);

    expect(eventos).toHaveLength(1);
  });

  it("o catálogo é lido uma vez por conexão, e não uma por remontagem", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(2, ["pronta", "em_curso"], "t1"), etag: "p" });
    roteiro = [
      () => r2.set(CHAVE_PARCIAL, { valor: parcial(4, ["pronta", "em_curso"], "t2"), etag: "p" }),
      () => r2.set(CHAVE_PARCIAL, { valor: parcial(6, ["pronta", "pronta"], "t3"), etag: "p" }),
    ];

    await acompanhar(3_500);

    expect(eventos.length).toBeGreaterThan(2);
    expect(listarEntidades).toHaveBeenCalledTimes(1);
  });

  it("sessão que cai em erro no meio vira evento de erro, e o laço para", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(2, ["pronta", "em_curso"], "t1"), etag: "p" });
    roteiro = [() => sessaoEm("erro")];

    await acompanhar();

    expect(eventos.map((e) => e.tipo)).toEqual(["proposta", "erro"]);
  });

  it("erro com a proposta já gravada não esconde a lista que existe", async () => {
    // A ordem da checagem importa: `extracao.json` primeiro. Uma sessão marcada
    // `erro` por um caminho posterior ainda tem o que eu revisar.
    sessaoEm("erro");
    r2.set(CHAVE_EXTRACAO, { valor: extracaoFinal, etag: "e" });

    await acompanhar();

    expect(eventos).toHaveLength(1);
    expect(eventos[0].tipo).toBe("proposta");
  });

  it("sessão que não existe é erro na hora, sem ficar batendo", async () => {
    vi.mocked(buscarSessao).mockResolvedValue(null as never);

    await acompanhar();

    expect(eventos).toEqual([{ tipo: "erro", erro: "sessão não encontrada" }]);
  });

  it("abortado, não lê nada: a tela fechou e o trabalho daqui acaba junto", async () => {
    r2.set(CHAVE_PARCIAL, { valor: parcial(2, ["pronta", "em_curso"], "t1"), etag: "p" });
    const controle = new AbortController();
    controle.abort();

    await acompanharProposta("s1", manda, {
      agora,
      dormir,
      intervalo: 700,
      teto: 5_000,
      sinal: controle.signal,
    });

    expect(eventos).toEqual([]);
    expect(buscarSessao).not.toHaveBeenCalled();
  });

  it("o teto fecha o fluxo sem evento extra — quem reconecta é o cliente", async () => {
    await acompanhar(1_400);

    expect(eventos).toEqual([]);
    // Duas voltas (0 e 700) e a terceira já estourou: o laço não fica preso.
    expect(buscarSessao).toHaveBeenCalledTimes(2);
  });

  it("R2 que não atende fecha com erro em vez de insistir calado", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("fetch failed"));

    await acompanhar();

    expect(eventos).toEqual([{ tipo: "erro", erro: "fetch failed" }]);
  });
});
