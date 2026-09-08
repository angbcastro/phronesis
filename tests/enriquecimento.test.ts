/**
 * O agente 4 — o que ele lê, o que ele pede ao modelo, e o que ele aceita de
 * volta.
 *
 * O risco desta fatia está declarado na spec e na migration 010: **ninguém
 * revisa antes de gravar**. Por isso o que se testa aqui, antes de qualquer
 * coisa, é o que impede uma resposta ruim de virar ficha — o parser recusando o
 * vazio, o corte do `TETO_RESUMO`, e a entidade sem átomo que nem chega ao
 * modelo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));
vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(async () => null),
  putJson: vi.fn(async () => ({ etag: null })),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

import { generateText } from "ai";
import {
  EnriquecimentoError,
  INSTRUCOES,
  PROMPT_VERSION_ENRIQUECIMENTO,
  atomosDaEntidade,
  blocoDeAtomos,
  escreverFicha,
  montarPrompt,
  parsearFicha,
} from "@/lib/enriquecimento";
import type { AtomoDaEntidade } from "@/lib/enriquecimento";
import { query } from "@/lib/neo4j";
import { TETO_RESUMO } from "@/lib/tipos";

const consulta = vi.mocked(query);
const chamar = vi.mocked(generateText);

const RAPHA = { nome: "Rapha Bertoldo", tipo: "Pessoa" as const, aliases: ["Raffa"] };

const atomo = (extra: Partial<AtomoDaEntidade> = {}): AtomoDaEntidade => ({
  texto: "produziu o evento inteiro sozinho",
  tipo: "FATO",
  valido_em: "2026-08-01T00:00:00.000Z",
  sobre: true,
  ...extra,
});

const responder = (texto: string) =>
  chamar.mockResolvedValue({ text: texto, finishReason: "stop" } as never);

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  delete process.env.ENRIQUECIMENTO_MODEL;
  consulta.mockReset();
  consulta.mockResolvedValue([] as never);
  chamar.mockReset();
});

// ───────────────────────── o que ele lê do grafo ─────────────────────────

describe("os átomos que entram", () => {
  it("lê SOBRE e MENCIONA — e não :PERFILA, que é o filtro do agente 2", async () => {
    await atomosDaEntidade("rapha");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("[r:SOBRE|MENCIONA]");
    expect(cypher).not.toContain("PERFILA");
  });

  it("não tem teto: a fatia decidiu reler tudo em vez de acumular", async () => {
    // "Incremental" carregaria para sempre o que uma rodada ruim escreveu.
    await atomosDaEntidade("rapha");
    expect(String(consulta.mock.calls[0][0])).not.toContain("LIMIT");
  });

  it("só átomo ativo, do mais novo para o mais velho", async () => {
    await atomosDaEntidade("rapha");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("coalesce(a.status, 'ativo') = 'ativo'");
    expect(cypher).toContain("ORDER BY valido_em DESC");
  });

  it("atravessa alias: a ficha de uma grafia fundida lê os átomos do vencedor", async () => {
    await atomosDaEntidade("raffa");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain(":FUNDIDA_EM");
    expect(cypher).toContain("coalesce(v, e) AS alvo");
    expect(consulta.mock.calls[0][1]).toEqual({ chave: "raffa" });
  });

  it("entidade sem nome não vai ao banco", async () => {
    expect(await atomosDaEntidade("   ")).toEqual([]);
    expect(consulta).not.toHaveBeenCalled();
  });

  it("átomo sem texto não entra — ele não tem o que dizer da entidade", async () => {
    consulta.mockResolvedValue([
      { texto: "", tipo: "FATO", valido_em: "", sobre: true },
      { texto: "vale", tipo: "FATO", valido_em: "", sobre: false },
    ] as never);
    expect(await atomosDaEntidade("rapha")).toHaveLength(1);
  });
});

// ───────────────────────── o que vai ao modelo ─────────────────────────

describe("o prompt", () => {
  it("o tipo e a data de cada átomo entram — os dois pesam na decisão", () => {
    const bloco = blocoDeAtomos([atomo()]);
    expect(bloco).toBe("- [FATO 2026-08-01] produziu o evento inteiro sozinho");
  });

  it("a menção de passagem é marcada como citada", () => {
    expect(blocoDeAtomos([atomo({ sobre: false })])).toContain("(citada)");
  });

  it("átomo sem data não inventa uma", () => {
    expect(blocoDeAtomos([atomo({ valido_em: "" })])).toBe(
      "- [FATO] produziu o evento inteiro sozinho",
    );
  });

  it("leva nome, tipo, grafias e a contagem de trechos", () => {
    const p = montarPrompt(RAPHA, [atomo(), atomo()]);
    expect(p).toContain("ENTIDADE: Rapha Bertoldo (pessoa)");
    expect(p).toContain("TAMBÉM ESCRITA: Raffa");
    expect(p).toContain("(2 trecho(s)");
  });

  it("o prompt do painel vence a base — é o que o /agentes edita", () => {
    expect(montarPrompt(RAPHA, [atomo()], "meu prompt").startsWith("meu prompt")).toBe(true);
  });

  it("a instrução do resumo é identidade, e diz o teto que o parser aplica", () => {
    // Se o resumo só descrever, a segunda passada volta a ser a regra e a fatia
    // não terá servido para nada — é a medida que a spec §5 manda olhar.
    expect(INSTRUCOES).toContain("O QUE A DISTINGUE DE OUTRA PARECIDA");
    expect(INSTRUCOES).toContain(`No máximo ${TETO_RESUMO} caracteres`);
  });

  it("a regra que mais importa está escrita: só o que os trechos sustentam", () => {
    expect(INSTRUCOES).toContain("SÓ AFIRME O QUE OS TRECHOS SUSTENTAM");
    expect(INSTRUCOES).toContain("Ninguém revisa este texto antes de ele ser gravado");
  });
});

// ───────────────────────── o que ele aceita de volta ─────────────────────────

describe("o parser", () => {
  const inteira = `{"resumo":"Produtor de eventos","contexto":"amigo","pode_ajudar_com":"produção","fizemos_juntos":"slackline"}`;

  it("lê os quatro campos de uma vez", () => {
    expect(parsearFicha(inteira)).toEqual({
      resumo: "Produtor de eventos",
      perfil: { contexto: "amigo", pode_ajudar_com: "produção", fizemos_juntos: "slackline" },
    });
  });

  it("tolera cerca de markdown e frase antes do JSON, como os outros agentes", () => {
    expect(parsearFicha("```json\nAqui está: " + inteira + "\n```").resumo).toBe(
      "Produtor de eventos",
    );
  });

  it("campo ausente volta vazio — o prompt diz que vazio é resposta legítima", () => {
    const f = parsearFicha(`{"resumo":"x"}`);
    expect(f.perfil).toEqual({ contexto: "", pode_ajudar_com: "", fizemos_juntos: "" });
  });

  it("corta o resumo em TETO_RESUMO, como gravarResumo faria", () => {
    const longo = `{"resumo":"${"a".repeat(TETO_RESUMO + 200)}","contexto":"x"}`;
    expect(parsearFicha(longo).resumo).toHaveLength(TETO_RESUMO);
  });

  it("os quatro vazios são recusados: gravar isso por cima da ficha seria perda", () => {
    expect(() => parsearFicha(`{"resumo":"","contexto":""}`)).toThrow(EnriquecimentoError);
  });

  it("resposta sem JSON nenhum é erro, e o erro carrega a amostra", () => {
    expect(() => parsearFicha("não consegui")).toThrow(/não consegui/);
  });

  it("campo que não é string não vira texto", () => {
    expect(parsearFicha(`{"resumo":"x","contexto":{"a":1}}`).perfil.contexto).toBe("");
  });
});

// ───────────────────────── a chamada ─────────────────────────

describe("escrever a ficha", () => {
  it("entidade sem átomo nenhum não vai ao modelo", async () => {
    // Pagar uma chamada para não ter o que dizer é desperdício, e sobrescrever
    // a ficha com o vazio seria perda.
    await expect(escreverFicha(RAPHA, [])).rejects.toThrow(EnriquecimentoError);
    expect(chamar).not.toHaveBeenCalled();
  });

  it("devolve a ficha, a contagem de átomos e a procedência (regra 7)", async () => {
    responder(`{"resumo":"Produtor","contexto":"amigo"}`);
    const f = await escreverFicha(RAPHA, [atomo(), atomo()]);
    expect(f.resumo).toBe("Produtor");
    expect(f.atomos).toBe(2);
    expect(f.prompt_version).toBe(PROMPT_VERSION_ENRIQUECIMENTO);
    expect(f.modelo).toBe("zai/glm-5.3-flash");
  });

  it("o modelo sai por string, pelo Gateway (regra 8)", async () => {
    responder(`{"resumo":"x"}`);
    await escreverFicha(RAPHA, [atomo()]);
    expect(typeof (chamar.mock.calls[0][0] as { model: unknown }).model).toBe("string");
  });

  it("ENRIQUECIMENTO_MODEL separa este agente sem tocar em código", async () => {
    process.env.ENRIQUECIMENTO_MODEL = "openai/gpt-5";
    responder(`{"resumo":"x"}`);
    const f = await escreverFicha(RAPHA, [atomo()]);
    expect(f.modelo).toBe("openai/gpt-5");
  });

  it("orçamento estourado repete com o dobro, em vez de repetir a mesma chamada", async () => {
    chamar
      .mockResolvedValueOnce({ text: "", finishReason: "length" } as never)
      .mockResolvedValueOnce({ text: `{"resumo":"x"}`, finishReason: "stop" } as never);

    await escreverFicha(RAPHA, [atomo()]);
    const teto = (i: number) =>
      (chamar.mock.calls[i][0] as { maxOutputTokens: number }).maxOutputTokens;
    expect(teto(1)).toBe(teto(0) * 2);
  });

  it("lê o JSON do pensamento quando o texto veio vazio e o orçamento sobrou", async () => {
    chamar.mockResolvedValue({
      text: "",
      reasoningText: `{"resumo":"do pensamento"}`,
      finishReason: "stop",
    } as never);
    expect((await escreverFicha(RAPHA, [atomo()])).resumo).toBe("do pensamento");
  });

  it("a espera de rate limit não tem prazo: ninguém está esperando na tela", async () => {
    // A fila pode dormir o quanto o Gateway pedir — é a diferença entre este
    // agente e os que rodam dentro da extração de uma janela.
    responder(`{"resumo":"x"}`);
    await escreverFicha(RAPHA, [atomo()]);
    expect((chamar.mock.calls[0][0] as { maxRetries: number }).maxRetries).toBe(0);
  });
});
