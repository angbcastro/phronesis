/**
 * O gatilho das janelas (slice 4.8): quando uma fatia da sessão é extraída
 * enquanto eu ainda estou falando, e o que acontece quando ela não fecha.
 *
 * O que este arquivo protege é a promessa da fatia — que a espera depois de
 * parar de falar seja só a da janela do fim — e o seguro dela: janela que
 * falhou não pode custar a sessão.
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
  PROMPT_VERSION: "extracao-7",
}));

// O módulo real, com as duas idas ao banco trocadas: `acharPorChave` e a
// travessia de alias continuam valendo, que é o que o dossiê da 4.9 usa.
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
  pendentes: vi.fn(() => []),
  tudoTranscrito: vi.fn(() => true),
}));

vi.mock("@/lib/sessoes", () => ({
  buscarSessao: vi.fn(async () => ({ id: "s1", status: "transcrito", duracao_s: 300 })),
  atualizarSessao: vi.fn(async () => null),
}));

import { avancarJanelas, extrairSessao } from "@/lib/pipeline";
import { extrair, extrairJanela } from "@/lib/extracao";
import { listarEntidades } from "@/lib/entidades";
import { carregarManifest } from "@/lib/manifest";
import { getJson, putJson } from "@/lib/r2";
import type { EntidadeDoGrafo } from "@/lib/entidades";
import type { Dossie } from "@/lib/recuperacao";
import type { Parcial, Transcricao } from "@/lib/tipos";

const CHAVE_PARCIAL = "sessoes/s1/parcial.json";
const CHAVE_TRANSCRICAO = "sessoes/s1/transcricao.json";
const CHAVE_EXTRACAO = "sessoes/s1/extracao.json";

/** O bucket deste teste. O etag muda a cada escrita, como no R2. */
let r2: Map<string, { valor: unknown; etag: string }>;
let erros: string[];
let versao = 0;

const bloco = (i: number) => ({
  i,
  texto: `bloco ${i} falado`,
  palavras: [
    { palavra: "bloco", inicio: 0, fim: 1 },
    { palavra: String(i), inicio: 1, fim: 2 },
    { palavra: "falado", inicio: 2, fim: 3 },
  ],
  modelo: "xai/grok-stt",
  granularidade: "palavra" as const,
});

/** Um manifest com `n` blocos, todos transcritos. */
const manifest = (n: number) => ({
  sessao_id: "s1",
  chunks: Array.from({ length: n }, (_, i) => ({
    i,
    bytes: 100,
    subido_em: "2026-09-05T12:00:00.000Z",
    transcrito: true,
  })),
  finalizado: false,
});

const transcricao: Transcricao = {
  sessao_id: "s1",
  texto: "a sessão inteira",
  palavras: [{ palavra: "a", inicio: 0, fim: 1 }],
  blocos: [],
  modelo: "xai/grok-stt",
  granularidade: "palavra",
};

const resultado = (novos: number, extra: Record<string, unknown> = {}) => ({
  novos: Array.from({ length: novos }, (_, k) => ({
    id: `s1-${k}`,
    indice: k,
    texto: `átomo ${k}`,
    tipo: "FATO",
    sobre: { citado: "eu", entidade: "eu", conhecida: false, certo: true, alternativas: [], motivo: "", porque: [] },
    menciona: [],
    perfila: [],
    trechos: [],
    prompt_version: "extracao-7",
    modelo: "zai/glm-5.3-flash",
  })),
  estende: [],
  entidades: [],
  descartados: [],
  prompt_version: "extracao-7",
  modelo: "zai/glm-5.3-flash",
  prompt_version_resolucao: null,
  modelo_resolucao: null,
  catalogo: [],
  candidatas: [],
  ...extra,
});

const parcial = () => r2.get(CHAVE_PARCIAL)?.valor as Parcial | undefined;

beforeEach(() => {
  r2 = new Map();
  erros = [];
  versao = 0;

  for (let i = 0; i < 8; i++) {
    r2.set(`sessoes/s1/chunk_00${i}.json`, { valor: bloco(i), etag: "b" });
  }

  vi.mocked(getJson).mockImplementation(async (key: string) => r2.get(key) ?? null);
  vi.mocked(putJson).mockImplementation(async (key: string, valor: unknown) => {
    const etag = `e${++versao}`;
    r2.set(key, { valor, etag });
    return { etag };
  });
  vi.mocked(carregarManifest).mockResolvedValue(manifest(4) as never);
  vi.mocked(extrairJanela).mockResolvedValue(resultado(2) as never);

  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    erros.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(extrairJanela).mockReset();
  vi.mocked(extrair).mockReset();
});

describe("a janela fecha durante a gravação", () => {
  it("quatro blocos transcritos fecham a janela 0, sem ninguém pedir", async () => {
    await avancarJanelas("s1");

    expect(extrairJanela).toHaveBeenCalledTimes(1);
    expect(parcial()?.janelas[0]).toMatchObject({ n: 0, de: 0, ate: 3, estado: "pronta" });
    expect(parcial()?.atomos.map((a) => a.id)).toEqual(["s1-0", "s1-1"]);
  });

  it("o texto que vai ao modelo é o dos blocos daquela janela, e só", async () => {
    vi.mocked(carregarManifest).mockResolvedValue(manifest(8) as never);
    await avancarJanelas("s1");

    const [primeira, segunda] = vi.mocked(extrairJanela).mock.calls;
    expect((primeira[0] as Transcricao).texto).toBe(
      "bloco 0 falado bloco 1 falado bloco 2 falado bloco 3 falado",
    );
    expect((segunda[0] as Transcricao).texto).toContain("bloco 4 falado");
    expect((segunda[0] as Transcricao).texto).not.toContain("bloco 0 falado");
  });

  it("a janela seguinte recebe o que a anterior propôs", async () => {
    // É o que a faz estender em vez de duplicar — e é o que segura o volume da
    // lista, já que não há passada de costura no fim.
    vi.mocked(carregarManifest).mockResolvedValue(manifest(8) as never);
    await avancarJanelas("s1");

    const [primeira, segunda] = vi.mocked(extrairJanela).mock.calls;
    expect((primeira[1] as { jaPropostos: unknown[] }).jaPropostos).toEqual([]);
    expect((segunda[1] as { jaPropostos: unknown[] }).jaPropostos).toHaveLength(2);
  });

  it("nenhuma delas se declara a sessão inteira — o bloco da janela vale", async () => {
    vi.mocked(carregarManifest).mockResolvedValue(manifest(8) as never);
    await avancarJanelas("s1");

    for (const [, opcoes] of vi.mocked(extrairJanela).mock.calls) {
      expect((opcoes as { unica: boolean }).unica).toBe(false);
    }
  });

  it("três blocos não fecham nada: a janela é de quatro", async () => {
    vi.mocked(carregarManifest).mockResolvedValue(manifest(3) as never);
    await avancarJanelas("s1");

    expect(extrairJanela).not.toHaveBeenCalled();
    expect(parcial()).toBeUndefined();
  });

  it("janela já pronta não é extraída de novo — é a trava do retry", async () => {
    await avancarJanelas("s1");
    await avancarJanelas("s1");

    expect(extrairJanela).toHaveBeenCalledTimes(1);
    expect(parcial()?.atomos).toHaveLength(2);
  });
});

describe("o dossiê da janela (slice 4.9)", () => {
  /** O nó que o STT nunca escreve certo — o caso medido em 04/09. */
  const GIAMPAOLO: EntidadeDoGrafo = {
    id: "e1",
    nome: "Giampaolo Lepore",
    nome_normalizado: "giampaolo lepore",
    chaves: ["giampaolo lepore"],
    tipo: "Pessoa",
    sessoes: 3,
    atomos: 7,
    aliases: [],
    resumo: "",
    canonico: false,
    perfil: { contexto: "sócio na Adapta", pode_ajudar_com: "", fizemos_juntos: "" },
  };

  const dossieDaChamada = (n = 0): Dossie =>
    (vi.mocked(extrairJanela).mock.calls[n][1] as { dossie: Dossie }).dossie;

  beforeEach(() => {
    vi.mocked(listarEntidades).mockResolvedValue([GIAMPAOLO] as never);
    // O bloco 0 diz "giam", que é o que o prefixo alcança e a camada de string
    // da resolução não alcançaria nunca.
    r2.set("sessoes/s1/chunk_000.json", {
      valor: { ...bloco(0), texto: "falei com o giam sobre o contrato" },
      etag: "b",
    });
  });

  it("a janela recebe o nó que o bloco cita, ainda que eu tenha dito 'giam'", async () => {
    await avancarJanelas("s1");
    expect(dossieDaChamada().map((d) => d.entidade.nome)).toEqual(["Giampaolo Lepore"]);
  });

  it("as candidatas do bloco ficam gravadas, e o bloco não é reconsultado", async () => {
    await avancarJanelas("s1");
    expect(r2.get("sessoes/s1/candidatas_000.json")).toBeDefined();

    const antes = r2.get("sessoes/s1/candidatas_000.json");
    await avancarJanelas("s1");
    expect(r2.get("sessoes/s1/candidatas_000.json")).toBe(antes);
  });

  it("as chaves que a janela viu ficam no parcial — é procedência (regra 7)", async () => {
    vi.mocked(extrairJanela).mockResolvedValue(
      resultado(1, { candidatas: ["giampaolo lepore"] }) as never,
    );
    await avancarJanelas("s1");
    expect(parcial()?.janelas[0].candidatas).toEqual(["giampaolo lepore"]);
  });

  it("busca que estoura não custa a janela: o dossiê fica vazio e a extração vai", async () => {
    // Sem o texto do bloco não há o que procurar — e isso não é falha da janela.
    r2.delete("sessoes/s1/chunk_000.json");
    r2.delete("sessoes/s1/chunk_001.json");
    r2.delete("sessoes/s1/chunk_002.json");
    r2.delete("sessoes/s1/chunk_003.json");

    await avancarJanelas("s1");
    expect(extrairJanela).toHaveBeenCalledTimes(1);
    expect(dossieDaChamada()).toEqual([]);
  });
});

describe("janela que não fecha", () => {
  it("a falha fica no parcial, com o motivo, e no log", async () => {
    vi.mocked(extrairJanela).mockRejectedValue(new Error("resposta vazia"));
    await avancarJanelas("s1");

    expect(parcial()?.janelas[0]).toMatchObject({ estado: "falhou", motivo: "resposta vazia" });
    expect(erros.join("\n")).toContain("[janela] sessão s1 janela 0 falhou");
  });

  it("não avança para a janela seguinte: ela precisa do acumulado desta", async () => {
    vi.mocked(carregarManifest).mockResolvedValue(manifest(8) as never);
    vi.mocked(extrairJanela).mockRejectedValue(new Error("resposta vazia"));
    await avancarJanelas("s1");

    expect(extrairJanela).toHaveBeenCalledTimes(1);
  });

  it("é retentada na passada seguinte, sem esperar o lease vencer", async () => {
    vi.mocked(extrairJanela).mockRejectedValueOnce(new Error("rate limit"));
    await avancarJanelas("s1");
    vi.mocked(extrairJanela).mockResolvedValue(resultado(1) as never);
    await avancarJanelas("s1");

    expect(parcial()?.janelas[0].estado).toBe("pronta");
    expect(parcial()?.atomos).toHaveLength(1);
  });
});

describe("a proposta final", () => {
  beforeEach(() => {
    r2.set(CHAVE_TRANSCRICAO, { valor: transcricao, etag: "t" });
  });

  it("sai do acumulado quando todas as janelas fecharam", async () => {
    vi.mocked(carregarManifest).mockResolvedValue(manifest(4) as never);
    await avancarJanelas("s1");
    vi.mocked(extrairJanela).mockClear();

    const r = await extrairSessao("s1");

    expect(r.status).toBe("em_revisao");
    expect(r.extracao?.atomos).toHaveLength(2);
    // A janela já estava pronta: o finalizar não pagou nada, e o passe único
    // não foi chamado. É a promessa da fatia.
    expect(extrairJanela).not.toHaveBeenCalled();
    expect(extrair).not.toHaveBeenCalled();
    expect(r2.get(CHAVE_EXTRACAO)).toBeDefined();
  });

  it("fecha a janela do fim, e ela é a única que sobrou para pagar", async () => {
    vi.mocked(carregarManifest).mockResolvedValue(manifest(6) as never);
    await avancarJanelas("s1"); // fecha só a janela 0; a 1 tem 2 blocos
    expect(extrairJanela).toHaveBeenCalledTimes(1);

    await extrairSessao("s1");

    expect(extrairJanela).toHaveBeenCalledTimes(2);
    const [, opcoes] = vi.mocked(extrairJanela).mock.calls[1];
    expect((opcoes as { unica: boolean }).unica).toBe(false);
    expect(parcial()?.janelas.map((j) => j.estado)).toEqual(["pronta", "pronta"]);
  });

  it("sessão de um bloco só é uma janela que se declara a sessão inteira", async () => {
    // O arquivo importado. O prompt sai sem bloco de janela nenhum, byte a byte
    // igual ao de antes desta fatia.
    vi.mocked(carregarManifest).mockResolvedValue(manifest(1) as never);
    await extrairSessao("s1");

    const [, opcoes] = vi.mocked(extrairJanela).mock.calls[0];
    expect((opcoes as { unica: boolean }).unica).toBe(true);
  });

  it("janela que não fechou cai no passe único — a sessão não morre por isso", async () => {
    vi.mocked(extrairJanela).mockRejectedValue(new Error("o modelo sumiu"));
    vi.mocked(extrair).mockResolvedValue({
      sessao_id: "s1",
      atomos: [],
      entidades: [],
      descartados: [],
      prompt_version: "extracao-7",
      modelo: "zai/glm-5.3-flash",
      prompt_version_resolucao: null,
      modelo_resolucao: null,
      granularidade: "palavra",
      criado_em: "2026-09-05T12:00:00.000Z",
    } as never);

    const r = await extrairSessao("s1");

    expect(extrair).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("em_revisao");
    expect(erros.join("\n")).toContain("não fecharam");
  });

  it("forçar zera o acumulado e refaz as janelas — calibra o que roda de verdade", async () => {
    await avancarJanelas("s1");
    expect(parcial()?.atomos).toHaveLength(2);

    vi.mocked(extrairJanela).mockResolvedValue(resultado(3) as never);
    await extrairSessao("s1", { forcar: true });

    expect(parcial()?.atomos).toHaveLength(3);
    expect(parcial()?.janelas).toHaveLength(1);
  });
});
