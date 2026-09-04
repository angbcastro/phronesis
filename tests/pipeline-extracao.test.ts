/**
 * O gatilho da extração: o que acontece entre a transcrição ficar pronta e a
 * proposta existir no R2.
 *
 * A trava é a existência de `extracao.json`. Sem ela, um retry do `waitUntil`
 * chamaria o modelo de novo e sobrescreveria uma proposta que eu talvez já
 * tivesse revisado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A classe é declarada dentro da fábrica: `vi.mock` é içado para o topo do
// arquivo, e uma variável de fora ainda não existiria quando ele rodasse.
vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(),
  putJson: vi.fn(async () => ({ etag: null })),
  getBytes: vi.fn(),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

vi.mock("@/lib/extracao", () => ({ extrair: vi.fn() }));

vi.mock("@/lib/sessoes", () => ({
  buscarSessao: vi.fn(),
  atualizarSessao: vi.fn(async () => null),
}));

import { extrairSessao } from "@/lib/pipeline";
import { extrair } from "@/lib/extracao";
import { ConflitoR2Error, getJson, putJson } from "@/lib/r2";
import { atualizarSessao } from "@/lib/sessoes";

const CHAVE_TRANSCRICAO = "sessoes/s1/transcricao.json";
const CHAVE_EXTRACAO = "sessoes/s1/extracao.json";

const transcricao = {
  sessao_id: "s1",
  texto: "falei com o Rodozanco",
  palavras: [{ palavra: "falei", inicio: 0, fim: 1 }],
  blocos: [],
  modelo: "xai/grok-stt",
  granularidade: "segmento",
};

const proposta = (marca: string) => ({
  sessao_id: "s1",
  atomos: [],
  entidades: [],
  descartados: [],
  prompt_version: marca,
  modelo: "zai/glm-5.3-flash",
  granularidade: "segmento",
  criado_em: "2026-08-30T00:00:00.000Z",
});

/** O que está no bucket neste teste. */
let r2: Map<string, unknown>;
let erros: string[];

/** Último status para o qual a sessão foi movida. */
const statusGravados = () =>
  vi.mocked(atualizarSessao).mock.calls.map((c) => (c[1] as { status?: string }).status);

beforeEach(() => {
  r2 = new Map();
  erros = [];
  vi.mocked(getJson).mockImplementation(async (key: string) =>
    r2.has(key) ? { valor: r2.get(key), etag: null } : null,
  );
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    erros.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(extrair).mockReset();
  vi.mocked(putJson).mockReset().mockResolvedValue({ etag: null });
  vi.mocked(atualizarSessao).mockReset().mockResolvedValue(null);
});

describe("extração dispara sozinha", () => {
  it("grava a proposta no R2 e deixa a sessão em revisão", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-2") as never);

    const r = await extrairSessao("s1");

    expect(r.status).toBe("em_revisao");
    expect(vi.mocked(putJson).mock.calls[0][0]).toBe(CHAVE_EXTRACAO);
    expect(statusGravados()).toEqual(["extraindo", "em_revisao"]);
  });

  it("a proposta é gravada com If-None-Match, que fecha a corrida", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-2") as never);

    await extrairSessao("s1");

    expect(vi.mocked(putJson).mock.calls[0][2]).toEqual({ ifNoneMatch: "*" });
  });
});

describe("idempotência", () => {
  it("proposta já no R2 não chama o modelo de novo", async () => {
    // É a trava do retry: o modelo custa, e a proposta pode já ter sido revisada.
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    r2.set(CHAVE_EXTRACAO, proposta("extracao-1"));

    const r = await extrairSessao("s1");

    expect(extrair).not.toHaveBeenCalled();
    expect(putJson).not.toHaveBeenCalled();
    expect(r.extracao).toMatchObject({ prompt_version: "extracao-1" });
    expect(r.status).toBe("em_revisao");
  });

  it("perder a corrida do PUT devolve a proposta do outro worker", async () => {
    // Duas propostas para a mesma sessão seriam duas listas para eu revisar.
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    vi.mocked(extrair).mockImplementation(async () => {
      r2.set(CHAVE_EXTRACAO, proposta("do-outro"));
      return proposta("a-minha") as never;
    });
    vi.mocked(putJson).mockRejectedValue(new ConflitoR2Error(CHAVE_EXTRACAO));

    const r = await extrairSessao("s1");

    expect(r.status).toBe("em_revisao");
    expect(r.extracao).toMatchObject({ prompt_version: "do-outro" });
  });
});

describe("re-extração forçada", () => {
  it("ignora a proposta pronta e chama o modelo de novo", async () => {
    // É o que permite calibrar o prompt sem gravar áudio novo.
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    r2.set(CHAVE_EXTRACAO, proposta("extracao-2"));
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-3") as never);

    const r = await extrairSessao("s1", { forcar: true });

    expect(extrair).toHaveBeenCalledTimes(1);
    expect(r.extracao).toMatchObject({ prompt_version: "extracao-3" });
  });

  it("sobrescreve: forçado não vai com If-None-Match", async () => {
    // Quem forçou quer a proposta nova no lugar da antiga; não há corrida a perder.
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    r2.set(CHAVE_EXTRACAO, proposta("extracao-2"));
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-3") as never);

    await extrairSessao("s1", { forcar: true });

    expect(vi.mocked(putJson).mock.calls[0][2]).toEqual({});
  });

  it("guarda a proposta que ela substituiu, para eu poder comparar depois", async () => {
    // A única defesa contra regressão silenciosa da slice 4.6: ver a lista
    // anterior ao lado da nova. Sem métrica, sem placar — olho no olho.
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    r2.set(CHAVE_EXTRACAO, proposta("extracao-5"));
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-5+a3f91c7d") as never);

    await extrairSessao("s1", { forcar: true });

    const copia = vi
      .mocked(putJson)
      .mock.calls.find(([key]) => key === "sessoes/s1/extracao-anterior.json");
    expect(copia).toBeDefined();
    expect(copia![1]).toMatchObject({ prompt_version: "extracao-5" });
  });

  it("a cópia vem depois da proposta nova — é ela que importa se algo morrer no meio", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    r2.set(CHAVE_EXTRACAO, proposta("extracao-5"));
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-6") as never);

    await extrairSessao("s1", { forcar: true });

    const chaves = vi.mocked(putJson).mock.calls.map(([key]) => key);
    expect(chaves.indexOf(CHAVE_EXTRACAO)).toBeLessThan(
      chaves.indexOf("sessoes/s1/extracao-anterior.json"),
    );
  });

  it("falhar ao guardar a cópia não derruba a re-extração", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    r2.set(CHAVE_EXTRACAO, proposta("extracao-5"));
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-6") as never);
    vi.mocked(putJson).mockImplementation(async (key: string) => {
      if (key.endsWith("extracao-anterior.json")) throw new Error("R2 fora do ar");
      return { etag: null };
    });

    const r = await extrairSessao("s1", { forcar: true });

    expect(r.status).toBe("em_revisao");
    expect(r.extracao).toMatchObject({ prompt_version: "extracao-6" });
  });

  it("primeira extração da sessão não inventa uma anterior", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    vi.mocked(extrair).mockResolvedValue(proposta("extracao-5") as never);

    await extrairSessao("s1", { forcar: true });

    const chaves = vi.mocked(putJson).mock.calls.map(([key]) => key);
    expect(chaves).not.toContain("sessoes/s1/extracao-anterior.json");
  });

  it("sem forcar, a trava continua valendo", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    r2.set(CHAVE_EXTRACAO, proposta("extracao-2"));

    await extrairSessao("s1");

    expect(extrair).not.toHaveBeenCalled();
  });
});

describe("falha", () => {
  it("modelo que estoura leva a sessão para erro, com o motivo no log", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    vi.mocked(extrair).mockRejectedValue(new Error("model not found: zai/glm-5.3-flash"));

    const r = await extrairSessao("s1");

    expect(r.status).toBe("erro");
    expect(statusGravados()).toEqual(["extraindo", "erro"]);
    expect(erros.some((e) => e.includes("model not found"))).toBe(true);
    expect(erros.some((e) => e.includes("[extracao]") && e.includes("s1"))).toBe(true);
  });

  it("a transcrição sobrevive à falha da extração", async () => {
    r2.set(CHAVE_TRANSCRICAO, transcricao);
    vi.mocked(extrair).mockRejectedValue(new Error("timeout"));

    await extrairSessao("s1");

    // Nada foi escrito por cima do que já estava pronto.
    expect(putJson).not.toHaveBeenCalled();
    expect(r2.get(CHAVE_TRANSCRICAO)).toBe(transcricao);
  });

  it("sem transcrição não há o que extrair — erro, e o modelo não é chamado", async () => {
    const r = await extrairSessao("s1");

    expect(r.status).toBe("erro");
    expect(extrair).not.toHaveBeenCalled();
    expect(erros.some((e) => e.includes("sem transcricao.json"))).toBe(true);
  });
});
