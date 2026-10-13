/**
 * O agente `confronto` — o que ele busca, o que ele pede ao modelo, o que ele
 * grava, o que o desfazer restaura e o que a minha edição congela.
 *
 * Como em `enriquecimento.test.ts`, o que se testa primeiro é o que impede uma
 * resposta ruim de virar relação: número fora da lista, tipo inventado, camada
 * inválida, `COMPLEMENTA` forte abaixo do limiar, o teto de sete. Desde a 5.2
 * vem junto o que o horizonte largo trouxe — **a direção decidida pelo código**,
 * quando o candidato é mais novo que o alvo, e **o `dono`**, que é o que faz
 * "uma geração" continuar verdade quando a rodada escreve aresta que chega ao
 * alvo. A gravação continua sendo conferida pelo Cypher que ela monta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []), queryUm: vi.fn(async () => null) }));
vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(async () => null),
  putJson: vi.fn(async () => ({ etag: null })),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

import { generateText } from "ai";
import {
  ALVOS_POR_ELO,
  ConfrontoError,
  INSTRUCOES,
  K_CANDIDATOS,
  LEASE_MS,
  LIMIAR_COMPLEMENTA,
  PROMPT_VERSION_CONFRONTO,
  TETO_RELACOES_POR_ATOMO,
  alvosDoLote,
  apresentar,
  blocoDosCandidatos,
  candidatosDeLote,
  decidirAlvo,
  desfazerConfronto,
  distancia,
  editarRelacao,
  ehMaisNovo,
  gravarRelacoes,
  lerRadial,
  marcarFalhaEmLote,
  montarPrompt,
  parsearRelacoes,
  processarElo,
  recentes,
  reivindicarProximosAtomos,
  repartirPares,
  reprocessarTudo,
  rodarElo,
  tamanhoDaFilaDeConfronto,
  type AtomoAlvo,
} from "@/lib/confronto";
import type { AtomoNoAcervo, CandidatoDeConfronto } from "@/lib/tipos";
import { query, queryUm } from "@/lib/neo4j";

const consulta = vi.mocked(query);
const consultaUm = vi.mocked(queryUm);
const chamar = vi.mocked(generateText);

const alvo = (extra: Partial<AtomoAlvo> = {}): AtomoAlvo => ({
  id: "alvo",
  texto: "fiquei travado o dia inteiro",
  tipo: "SENTIMENTO",
  valido_em: "2026-08-10T20:00:00.000Z",
  entidades: { sobre: [], cita: [] },
  sessao_id: "s-alvo",
  inicio_s: 30,
  congeladas: 0,
  ...extra,
});

const candidato = (extra: Partial<CandidatoDeConfronto> = {}): CandidatoDeConfronto => ({
  id: "velho",
  texto: "a reunião com a Murta foi remarcada",
  tipo: "FATO",
  valido_em: "2026-08-07T20:00:00.000Z",
  entidades: { sobre: [], cita: ["Murta"] },
  sessao_id: "s-velha",
  inicio_s: 10,
  similaridade: 0.7,
  ...extra,
});

const responder = (texto: string) =>
  chamar.mockResolvedValue({ text: texto, finishReason: "stop" } as never);

/** Responde por Cypher, e não por ordem de chamada — o caminho do elo é longo. */
const porCypher = (mapa: [RegExp, unknown][]) => {
  consulta.mockImplementation((async (cypher: string) => {
    for (const [re, valor] of mapa) if (re.test(String(cypher))) return valor;
    return [];
  }) as never);
};

const linhaDeAlvo = (extra: Record<string, unknown> = {}) => ({
  id: "a1",
  texto: "t1",
  tipo: "OPINIAO",
  valido_em: "2026-08-01",
  sessao_id: "s1",
  inicio_s: 5,
  congeladas: 0,
  sobre: [],
  cita: [],
  ...extra,
});

const linhaDeCandidato = (extra: Record<string, unknown> = {}) => ({
  alvo_id: "a1",
  id: "v1",
  texto: "vt1",
  tipo: "FATO",
  valido_em: "2026-01-01",
  sessao_id: "s0",
  inicio_s: 3,
  similaridade: 0.8,
  sobre: [],
  cita: [],
  ...extra,
});

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  delete process.env.CONFRONTO_MODEL;
  consulta.mockReset();
  consulta.mockResolvedValue([] as never);
  consultaUm.mockReset();
  consultaUm.mockResolvedValue(null as never);
  chamar.mockReset();
});

// ───────────────────────── candidatos e alvos ─────────────────────────

describe("candidatosDeLote", () => {
  it("busca cem por vetor no grafo inteiro, sem filtro de data e sem piso", async () => {
    await candidatosDeLote(["a", "b"]);
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("db.index.vector.queryNodes('atomo_embedding'");
    expect(cypher).toContain("2 * score - 1 AS similaridade");
    expect(cypher).toContain("candidato.id <> alvo.id");
    expect(cypher).toContain("coalesce(candidato.status, 'ativo') = 'ativo'");
    // O que a 5.1 tinha e a 5.2 tirou: só passado, e o piso.
    expect(cypher).not.toContain("< coalesce(alvo.valido_em, '')");
    expect(cypher).not.toContain("$piso");
    // Sem data não há como dizer quem é o mais novo.
    expect(cypher).toContain("coalesce(candidato.valido_em, '') <> ''");
  });

  it("pede um a mais que K_CANDIDATOS — o próprio alvo volta no topo", async () => {
    await candidatosDeLote(["a"]);
    expect(K_CANDIDATOS).toBe(100);
    expect(consulta.mock.calls[0][1]).toEqual({ ids: ["a"], k: K_CANDIDATOS + 1 });
  });

  it("tira do par a recusa, a aresta congelada e a de outra rodada", async () => {
    await candidatosDeLote(["a"]);
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("NOT EXISTS { MATCH (alvo)-[:CONFRONTO_RECUSADO]-(candidato) }");
    expect(cypher).toContain("coalesce(r.origem, 'agente') = 'eu'");
    expect(cypher).toContain("coalesce(r.dono, startNode(r).id) <> alvo.id");
  });

  it("pendura as entidades e a sessão do candidato, e nunca o \"eu\"", async () => {
    await candidatosDeLote(["a"]);
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("[:SOBRE]->(s:Entidade)");
    expect(cypher).toContain("toLower(coalesce(s.nome, '')) <> 'eu'");
    expect(cypher).toContain("(sessao:Sessao)-[:GEROU]->(candidato)");
    expect(cypher).toContain("candidato.inicios_s[0] AS inicio_s");
  });

  it("agrupa as linhas por alvo", async () => {
    consulta.mockResolvedValue([
      linhaDeCandidato({ alvo_id: "a", id: "v1" }),
      linhaDeCandidato({ alvo_id: "a", id: "v2", inicio_s: null }),
      linhaDeCandidato({ alvo_id: "b", id: "v3", sessao_id: null }),
    ] as never);

    const r = await candidatosDeLote(["a", "b"]);
    expect(r.a.map((c) => c.id)).toEqual(["v1", "v2"]);
    expect(r.a[1].inicio_s).toBeNull();
    expect(r.b[0].sessao_id).toBe("");
  });
});

describe("alvosDoLote", () => {
  it("devolve quem está no grafo, com a sessão, a âncora e as congeladas", async () => {
    consulta.mockResolvedValue([linhaDeAlvo({ congeladas: 2 })] as never);
    const r = await alvosDoLote(["a1", "sumido"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "a1", sessao_id: "s1", inicio_s: 5, congeladas: 2 });
    expect(String(consulta.mock.calls[0][0])).toContain("WHERE c.origem = 'eu'");
  });
});

describe("repartirPares", () => {
  it("o par que dois alvos do mesmo elo compartilham fica com o primeiro", () => {
    const a = alvo({ id: "a" });
    const b = alvo({ id: "b" });
    const r = repartirPares([a, b], {
      a: [candidato({ id: "b" }), candidato({ id: "x" })],
      b: [candidato({ id: "a" }), candidato({ id: "y" })],
    });
    expect(r.a.map((c) => c.id)).toEqual(["b", "x"]);
    expect(r.b.map((c) => c.id)).toEqual(["y"]);
  });
});

// ───────────────────────── a ordem do par ─────────────────────────

describe("ehMaisNovo", () => {
  const atomo = (extra: Partial<AtomoNoAcervo>): AtomoNoAcervo => ({ ...alvo(), ...extra });

  it("data maior é mais nova", () => {
    expect(ehMaisNovo(atomo({ valido_em: "2026-09-01" }), atomo({ valido_em: "2026-08-01" }))).toBe(true);
    expect(ehMaisNovo(atomo({ valido_em: "2026-08-01" }), atomo({ valido_em: "2026-09-01" }))).toBe(false);
  });

  it("na mesma sessão, o que foi dito depois é o mais novo", () => {
    const antes = atomo({ id: "z", inicio_s: 10 });
    const depois = atomo({ id: "a", inicio_s: 95 });
    expect(ehMaisNovo(depois, antes)).toBe(true);
    expect(ehMaisNovo(antes, depois)).toBe(false);
  });

  it("sem âncora fica antes de qualquer ancorado, e o empate final é pelo id", () => {
    expect(ehMaisNovo(atomo({ inicio_s: null }), atomo({ inicio_s: 0 }))).toBe(false);
    expect(ehMaisNovo(atomo({ id: "b", inicio_s: null }), atomo({ id: "a", inicio_s: null }))).toBe(true);
  });
});

describe("distancia", () => {
  it("diz o lado e a distância em dias", () => {
    expect(distancia(alvo(), candidato())).toBe("mais antigo · 3 dias antes");
    expect(distancia(alvo(), candidato({ valido_em: "2026-08-11T20:00:00.000Z" }))).toBe(
      "mais novo · 1 dia depois",
    );
  });

  it("na mesma sessão, diz se foi dito antes ou depois", () => {
    const mesma = { sessao_id: "s-alvo", valido_em: alvo().valido_em };
    expect(distancia(alvo(), candidato({ ...mesma, inicio_s: 90 }))).toBe(
      "mais novo · mesma sessão, dito depois",
    );
    expect(distancia(alvo(), candidato({ ...mesma, inicio_s: 2 }))).toBe(
      "mais antigo · mesma sessão, dito antes",
    );
  });

  it("longe, fala em meses e anos", () => {
    expect(distancia(alvo(), candidato({ valido_em: "2026-02-10T20:00:00.000Z" }))).toBe(
      "mais antigo · 6 meses antes",
    );
    expect(distancia(alvo(), candidato({ valido_em: "2023-08-10T20:00:00.000Z" }))).toBe(
      "mais antigo · 3 anos antes",
    );
  });
});

// ───────────────────────── o que o modelo lê ─────────────────────────

describe("o prompt", () => {
  it("mostra tipo, data e as entidades separadas por papel", () => {
    expect(apresentar(candidato({ entidades: { sobre: ["Behring"], cita: ["Murta"] } }))).toBe(
      "[FATO 2026-08-07 · sobre: Behring · cita: Murta]",
    );
  });

  it("diz \"sem entidade nomeada\" em vez de omitir", () => {
    expect(apresentar(alvo())).toBe("[SENTIMENTO 2026-08-10 · sem entidade nomeada]");
  });

  it("numera os candidatos a partir de 1, cada um com o seu lado", () => {
    const bloco = blocoDosCandidatos(alvo(), [candidato(), candidato({ id: "n", valido_em: "2026-08-20T00:00:00.000Z" })]);
    expect(bloco.split("\n")[0]).toMatch(/^1\. \(mais antigo · 3 dias antes\) \[FATO/);
    expect(bloco.split("\n")[1]).toMatch(/^2\. \(mais novo · /);
  });

  it("monta base, o trecho em julgamento e a lista", () => {
    const p = montarPrompt(alvo(), [candidato()], "BASE");
    expect(p.startsWith("BASE")).toBe(true);
    expect(p).toContain("O TRECHO EM JULGAMENTO\n[SENTIMENTO");
    expect(p).toContain("fiquei travado o dia inteiro");
    expect(p).toContain("1. (mais antigo");
  });

  it("as quatro relações, as duas camadas, o teto e o envelope estão nas instruções", () => {
    for (const t of ["NENHUMA", "ATUALIZA", "CONTRADIZ", "CONFIRMA", "COMPLEMENTA"]) {
      expect(INSTRUCOES).toContain(t);
    }
    for (const secao of ["\nFORTE\n", "\nSUTIL\n", "\nA ORDEM DO PAR\n", "\nFORMATO\n"]) {
      expect(INSTRUCOES).toContain(secao);
    }
    expect(INSTRUCOES).toContain(`No máximo ${TETO_RELACOES_POR_ATOMO} relações`);
    expect(INSTRUCOES).toContain('"camada":"forte"');
    expect(INSTRUCOES).toContain('{"relacoes":[');
  });

  it("o sutil liga e nunca nomeia", () => {
    expect(INSTRUCOES).toContain("nunca dá nome ao que os liga");
    expect(INSTRUCOES).toMatch(/diagnóstico/);
  });
});

// ───────────────────────── o que o modelo devolve ─────────────────────────

describe("parsearRelacoes", () => {
  const cands = [candidato({ id: "velho" }), candidato({ id: "novo", valido_em: "2026-08-20T00:00:00.000Z" })];
  const ler = (json: string, opcoes = {}) => parsearRelacoes(json, alvo(), cands, opcoes);

  it("orienta pelo código: candidato mais antigo é o velho, mais novo é o novo", () => {
    const r = ler(
      '{"relacoes":[' +
        '{"n":1,"tipo":"COMPLEMENTA","camada":"forte","confianca":0.9,"motivo":"a"},' +
        '{"n":2,"tipo":"CONTRADIZ","camada":"forte","confianca":0.8,"motivo":"b"}]}',
    );
    expect(r.relacoes).toEqual([
      { novo_id: "alvo", velho_id: "velho", tipo: "COMPLEMENTA", camada: "forte", confianca: 0.9, motivo: "a" },
      { novo_id: "novo", velho_id: "alvo", tipo: "CONTRADIZ", camada: "forte", confianca: 0.8, motivo: "b" },
    ]);
  });

  it("lê a lista solta, e lista vazia é resposta legítima", () => {
    expect(ler('[{"n":1,"tipo":"CONFIRMA","camada":"forte","confianca":0.9}]').relacoes).toHaveLength(1);
    expect(ler('{"relacoes":[]}')).toEqual({ relacoes: [], rebaixadas: 0, cortadas: 0 });
  });

  it("ignora cerca de markdown e frase antes do JSON", () => {
    const r = ler('Aqui:\n```json\n{"relacoes":[{"n":1,"tipo":"CONFIRMA","camada":"forte","confianca":0.9}]}\n```');
    expect(r.relacoes).toHaveLength(1);
  });

  it("descarta n fora da lista, n repetido e tipo inventado, sem derrubar os outros", () => {
    const r = ler(
      '{"relacoes":[' +
        '{"n":0,"tipo":"CONFIRMA","camada":"forte","confianca":0.9},' +
        '{"n":3,"tipo":"CONFIRMA","camada":"forte","confianca":0.9},' +
        '{"n":1,"tipo":"EXPLICA","camada":"forte","confianca":0.9},' +
        '{"n":1,"tipo":"CONFIRMA","camada":"forte","confianca":0.9},' +
        '{"n":1,"tipo":"CONTRADIZ","camada":"forte","confianca":0.9}]}',
    );
    expect(r.relacoes.map((x) => x.tipo)).toEqual(["CONFIRMA"]);
  });

  it("camada ausente ou inválida vira sutil — na dúvida, a ressalva", () => {
    const r = ler(
      '{"relacoes":[{"n":1,"tipo":"CONFIRMA","confianca":0.9},{"n":2,"tipo":"ATUALIZA","camada":"media","confianca":0.9}]}',
    );
    expect(r.relacoes.map((x) => x.camada)).toEqual(["sutil", "sutil"]);
  });

  it("COMPLEMENTA forte abaixo do limiar desce para sutil, e conta", () => {
    const r = ler('{"relacoes":[{"n":1,"tipo":"COMPLEMENTA","camada":"forte","confianca":0.6}]}');
    expect(r.relacoes[0].camada).toBe("sutil");
    expect(r.rebaixadas).toBe(1);
  });

  it("o limiar não vale para os outros três, nem para o que já veio sutil", () => {
    const r = ler(
      '{"relacoes":[{"n":1,"tipo":"CONTRADIZ","camada":"forte","confianca":0.5},{"n":2,"tipo":"COMPLEMENTA","camada":"sutil","confianca":0.3}]}',
    );
    expect(r.relacoes.map((x) => x.camada)).toEqual(["forte", "sutil"]);
    expect(r.rebaixadas).toBe(0);
  });

  it("COMPLEMENTA no limiar exato fica forte", () => {
    const r = ler(`{"relacoes":[{"n":1,"tipo":"COMPLEMENTA","camada":"forte","confianca":${LIMIAR_COMPLEMENTA}}]}`);
    expect(r.relacoes[0].camada).toBe("forte");
  });

  it("corta confiança fora de [0,1], e trata ausente como 0", () => {
    const r = ler(
      '{"relacoes":[{"n":1,"tipo":"CONFIRMA","camada":"forte","confianca":7},{"n":2,"tipo":"CONFIRMA","camada":"sutil"}]}',
    );
    expect(r.relacoes.map((x) => x.confianca)).toEqual([1, 0]);
  });

  it("o teto fica com as fortes primeiro, depois as de mais confiança", () => {
    const muitos = Array.from({ length: 10 }, (_, i) => candidato({ id: `c${i}` }));
    const itens = [
      ...Array.from({ length: 8 }, (_, i) => `{"n":${i + 1},"tipo":"CONFIRMA","camada":"sutil","confianca":0.${i + 1}}`),
      '{"n":9,"tipo":"ATUALIZA","camada":"forte","confianca":0.5}',
    ];
    const r = parsearRelacoes(`{"relacoes":[${itens.join(",")}]}`, alvo(), muitos);
    expect(r.relacoes).toHaveLength(TETO_RELACOES_POR_ATOMO);
    expect(r.relacoes[0]).toMatchObject({ velho_id: "c8", camada: "forte" });
    expect(r.relacoes.at(-1)?.confianca).toBe(0.3);
    expect(r.cortadas).toBe(2);
  });

  it("o teto desconta as relações que eu já congelei", () => {
    const r = ler(
      '{"relacoes":[{"n":1,"tipo":"CONFIRMA","camada":"forte","confianca":0.9},{"n":2,"tipo":"CONFIRMA","camada":"forte","confianca":0.8}]}',
      { teto: 1 },
    );
    expect(r.relacoes).toHaveLength(1);
    expect(r.cortadas).toBe(1);
  });

  it("corta o motivo no teto", () => {
    const r = ler(`{"relacoes":[{"n":1,"tipo":"CONFIRMA","camada":"forte","confianca":0.9,"motivo":"${"x".repeat(500)}"}]}`);
    expect(r.relacoes[0].motivo).toHaveLength(300);
  });

  it("resposta sem JSON reconhecível estoura ConfrontoError", () => {
    expect(() => ler("não sei")).toThrow(ConfrontoError);
  });
});

// ───────────────────────── a chamada ao modelo ─────────────────────────

describe("decidirAlvo", () => {
  it("carimba a versão do prompt e devolve o modelo da resposta", async () => {
    responder('{"relacoes":[]}');
    const d = await decidirAlvo(alvo(), [candidato()]);
    expect(PROMPT_VERSION_CONFRONTO).toBe("confronto-3");
    expect(d.prompt_version).toBe(PROMPT_VERSION_CONFRONTO);
    expect(d.relacoes).toEqual([]);
  });

  it("uma chamada, com o teto de saída alto e sem segunda tentativa dobrada", async () => {
    chamar.mockResolvedValue({ text: "", finishReason: "length" } as never);
    await expect(decidirAlvo(alvo(), [candidato()])).rejects.toThrow(ConfrontoError);
    expect(chamar).toHaveBeenCalledTimes(1);
    expect((chamar.mock.calls[0][0] as { maxOutputTokens: number }).maxOutputTokens).toBe(100_000);
  });

  it("passa o teto descontado ao parser", async () => {
    responder(
      '{"relacoes":[{"n":1,"tipo":"CONFIRMA","camada":"forte","confianca":0.9},{"n":2,"tipo":"CONFIRMA","camada":"forte","confianca":0.8}]}',
    );
    const d = await decidirAlvo(alvo(), [candidato({ id: "x" }), candidato({ id: "y" })], { teto: 1 });
    expect(d.relacoes).toHaveLength(1);
  });
});

// ───────────────────────── a gravação ─────────────────────────

describe("gravarRelacoes", () => {
  it("apaga só a geração do agente cujo dono é este átomo, nas duas direções", async () => {
    await gravarRelacoes("s1-0", [], "exec-1", "", "", new Date("2026-09-13T00:00:00.000Z"));
    const primeira = String(consulta.mock.calls[0][0]);
    expect(primeira).toContain("[r:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]-(:Atomo)");
    expect(primeira).toContain("coalesce(r.origem, 'agente') = 'agente'");
    expect(primeira).toContain("coalesce(r.dono, startNode(r).id) = $atomoId");
    expect(primeira).toContain("DELETE r");
  });

  it("uma consulta por tipo, do novo para o velho, com camada, origem e dono", async () => {
    await gravarRelacoes(
      "alvo",
      [
        { novo_id: "alvo", velho_id: "a", tipo: "ATUALIZA", camada: "forte", confianca: 0.9, motivo: "m" },
        { novo_id: "b", velho_id: "alvo", tipo: "COMPLEMENTA", camada: "sutil", confianca: 0.8, motivo: "m2" },
      ],
      "exec-1",
      "deepseek/deepseek-v4.1-flash",
      "confronto-3",
    );
    const cyphers = consulta.mock.calls.map((c) => String(c[0]));
    const atualiza = consulta.mock.calls.find((c) => String(c[0]).includes("MERGE (novo)-[rel:ATUALIZA]->(velho)"));
    expect(atualiza).toBeDefined();
    expect(cyphers.some((c) => c.includes("MERGE (novo)-[rel:COMPLEMENTA]->(velho)"))).toBe(true);
    expect(cyphers.some((c) => c.includes("MERGE (novo)-[rel:CONTRADIZ]->(velho)"))).toBe(false);

    const cypher = String(atualiza![0]);
    expect(cypher).toContain("rel.camada = r.camada");
    expect(cypher).toContain("rel.origem = 'agente'");
    expect(cypher).toContain("rel.dono = $atomoId");
    expect((atualiza![1] as { relacoes: unknown[] }).relacoes).toEqual([
      { novo_id: "alvo", velho_id: "a", motivo: "m", confianca: 0.9, camada: "forte" },
    ]);
  });

  it("confere de novo, na escrita, a recusa e a aresta minha ou de outra rodada", async () => {
    await gravarRelacoes(
      "alvo",
      [{ novo_id: "alvo", velho_id: "a", tipo: "CONFIRMA", camada: "forte", confianca: 0.9, motivo: "m" }],
      "exec-1",
      "m",
      "confronto-3",
    );
    const cypher = String(consulta.mock.calls.find((c) => String(c[0]).includes("MERGE"))![0]);
    expect(cypher).toContain("NOT EXISTS { MATCH (novo)-[:CONFRONTO_RECUSADO]-(velho) }");
    expect(cypher).toContain("coalesce(x.dono, startNode(x).id) <> $atomoId");
  });

  it("marca o átomo processado no final, com a execução carimbada", async () => {
    await gravarRelacoes("s1-0", [], "exec-9", "", "", new Date("2026-09-13T00:00:00.000Z"));
    const ultima = consulta.mock.calls.at(-1)!;
    expect(String(ultima[0])).toContain("a.confronto_estado = 'processado'");
    expect(ultima[1]).toMatchObject({ atomoId: "s1-0", execucao: "exec-9" });
  });
});

describe("marcarFalhaEmLote", () => {
  it("grava o motivo cortado no teto, e só em quem ainda está rodando", async () => {
    await marcarFalhaEmLote(["a", "b"], "x".repeat(500));
    const [cypher, params] = consulta.mock.calls[0];
    expect(String(cypher)).toContain("a.confronto_estado = 'falhou'");
    expect(String(cypher)).toContain("WHERE a.confronto_estado = 'rodando'");
    expect((params as { motivo: string }).motivo).toHaveLength(300);
  });
});

// ───────────────────────── o desfazer e o reprocessar ─────────────────────────

describe("desfazerConfronto", () => {
  it("apaga só o que a rodada deste átomo escreveu — as minhas ficam", async () => {
    consultaUm.mockResolvedValue({ id: "s1-0", relacoes: 2, tinha: true } as never);
    expect(await desfazerConfronto("s1-0")).toEqual({ id: "s1-0", relacoes: 2 });
    const cypher = String(consultaUm.mock.calls[0][0]);
    expect(cypher).toContain("coalesce(rel.origem, 'agente') = 'agente'");
    expect(cypher).toContain("coalesce(rel.dono, startNode(rel).id) = a.id");
  });

  it("null quando o átomo nunca foi tentado", async () => {
    consultaUm.mockResolvedValue({ id: "s1-0", relacoes: 0, tinha: false } as never);
    expect(await desfazerConfronto("s1-0")).toBeNull();
  });

  it("átomo que não existe mais estoura ConfrontoError", async () => {
    consultaUm.mockResolvedValue(null as never);
    await expect(desfazerConfronto("sumiu")).rejects.toThrow(ConfrontoError);
  });
});

describe("reprocessarTudo", () => {
  it("apaga as do agente, preserva as minhas, e limpa os quatro campos", async () => {
    consultaUm.mockResolvedValue({ atomos: 58, relacoes: 13 } as never);
    expect(await reprocessarTudo()).toEqual({ atomos: 58, relacoes: 13 });

    const cypher = String(consultaUm.mock.calls[0][0]);
    expect(cypher).toContain("coalesce(rel.origem, 'agente') = 'agente'");
    expect(cypher).not.toContain("CONFRONTO_RECUSADO");
    for (const campo of ["confronto_estado", "confronto_em", "confronto_execucao", "confronto_motivo"]) {
      expect(cypher).toContain(campo);
    }
  });

  it("grafo sem nada processado devolve zeros em vez de estourar", async () => {
    consultaUm.mockResolvedValue(null as never);
    expect(await reprocessarTudo()).toEqual({ atomos: 0, relacoes: 0 });
  });
});

// ───────────────────────────── a fila ─────────────────────────────

describe("reivindicarProximosAtomos", () => {
  it("pega os mais antigos pendentes, com o lease de retomada", async () => {
    consulta.mockResolvedValue([{ id: "s1-0" }, { id: "s1-1" }] as never);
    const antes = Date.now();
    const ids = await reivindicarProximosAtomos(ALVOS_POR_ELO, new Date(antes));

    expect(ids).toEqual(["s1-0", "s1-1"]);
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("ORDER BY coalesce(a.valido_em, a.criado_em, '') ASC LIMIT $n");
    const params = consulta.mock.calls[0][1] as { limite: string; n: number };
    expect(params.n).toBe(ALVOS_POR_ELO);
    expect(new Date(antes).getTime() - new Date(params.limite).getTime()).toBe(LEASE_MS);
  });
});

describe("tamanhoDaFilaDeConfronto e recentes", () => {
  it("a fila conta o mesmo que a reivindicação pega — embedding incluído", async () => {
    consulta.mockResolvedValue([{ quantas: 7 }] as never);
    expect(await tamanhoDaFilaDeConfronto()).toBe(7);
    expect(String(consulta.mock.calls[0][0])).toContain("a.embedding IS NOT NULL");
  });

  it("os recentes contam fortes e sutis de qualquer rodada", async () => {
    await recentes();
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("size([c IN camadas WHERE c = 'forte']) AS fortes");
    expect(cypher).toContain("size([c IN camadas WHERE c = 'sutil']) AS sutis");
  });
});

describe("processarElo", () => {
  it("alvo sem candidato não vai ao modelo, e sai processado", async () => {
    porCypher([
      [/RETURN a\.id AS id, a\.texto AS texto/, [linhaDeAlvo()]],
      [/queryNodes/, []],
    ]);

    const r = await processarElo(["a1"]);
    expect(r).toMatchObject({ alvos: 1, pares: 0, relacoes: 0, falhas: 0 });
    expect(chamar).not.toHaveBeenCalled();
    expect(consulta.mock.calls.some((c) => String(c[0]).includes("'processado'"))).toBe(true);
  });

  it("alvo com o teto cheio de relações minhas não paga a chamada", async () => {
    porCypher([
      [/RETURN a\.id AS id, a\.texto AS texto/, [linhaDeAlvo({ congeladas: TETO_RELACOES_POR_ATOMO })]],
      [/queryNodes/, [linhaDeCandidato()]],
    ]);
    await processarElo(["a1"]);
    expect(chamar).not.toHaveBeenCalled();
  });

  it("átomo que sumiu entre reivindicar e processar vai para falhou", async () => {
    porCypher([[/RETURN a\.id AS id, a\.texto AS texto/, []]]);
    const r = await processarElo(["sumiu"]);
    expect(r.alvos).toBe(0);
    const falhou = consulta.mock.calls.find((c) => String(c[0]).includes("'falhou'"));
    expect((falhou?.[1] as { ids: string[] }).ids).toEqual(["sumiu"]);
  });

  it("uma chamada por alvo, e grava pelo dono — inclusive a aresta que chega ao alvo", async () => {
    porCypher([
      [
        /RETURN a\.id AS id, a\.texto AS texto/,
        [linhaDeAlvo({ id: "a1", valido_em: "2026-08-01" }), linhaDeAlvo({ id: "a2", valido_em: "2026-09-01" })],
      ],
      [
        /queryNodes/,
        [
          linhaDeCandidato({ alvo_id: "a1", id: "v1", valido_em: "2026-10-01" }),
          linhaDeCandidato({ alvo_id: "a2", id: "v2", texto: "vt2", valido_em: "2026-01-01" }),
        ],
      ],
    ]);
    chamar.mockImplementation((async ({ prompt }: { prompt: string }) => ({
      text: prompt.includes("vt1")
        ? '{"relacoes":[{"n":1,"tipo":"CONTRADIZ","camada":"forte","confianca":0.9,"motivo":"m"}]}'
        : '{"relacoes":[]}',
      finishReason: "stop",
    })) as never);

    const r = await processarElo(["a1", "a2"]);
    expect(chamar).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ alvos: 2, pares: 2, relacoes: 1, falhas: 0 });

    const escreveu = consulta.mock.calls.filter((c) =>
      String(c[0]).includes("MERGE (novo)-[rel:CONTRADIZ]->(velho)"),
    );
    expect(escreveu).toHaveLength(1);
    // v1 é mais novo que a1: a aresta sai de v1 e chega em a1, e o dono é a1.
    expect(escreveu[0][1]).toMatchObject({
      atomoId: "a1",
      relacoes: [{ novo_id: "v1", velho_id: "a1" }],
    });
  });

  it("a falha é do alvo: um cai, o outro grava", async () => {
    porCypher([
      [/RETURN a\.id AS id, a\.texto AS texto/, [linhaDeAlvo({ id: "a1" }), linhaDeAlvo({ id: "a2" })]],
      [
        /queryNodes/,
        [linhaDeCandidato({ alvo_id: "a1", id: "v1" }), linhaDeCandidato({ alvo_id: "a2", id: "v2", texto: "vt2" })],
      ],
    ]);
    chamar.mockImplementation((async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("vt2")) throw new Error("gateway fora do ar");
      return { text: '{"relacoes":[]}', finishReason: "stop" };
    }) as never);

    const r = await processarElo(["a1", "a2"]);
    expect(r).toMatchObject({ alvos: 2, falhas: 1 });
    const falhou = consulta.mock.calls.filter((c) => String(c[0]).includes("'falhou'"));
    expect(falhou.map((c) => (c[1] as { ids: string[] }).ids)).toEqual([["a2"]]);
    const processou = consulta.mock.calls.filter((c) => String(c[0]).includes("'processado'"));
    expect(processou.map((c) => (c[1] as { atomoId: string }).atomoId)).toEqual(["a1"]);
  });
});

describe("rodarElo", () => {
  it("fila vazia devolve null", async () => {
    consulta.mockResolvedValue([] as never);
    expect(await rodarElo()).toBeNull();
  });

  it("falha antes de os alvos se separarem marca todos os reivindicados", async () => {
    consulta.mockImplementation((async (cypher: string) => {
      if (/SET a\.confronto_estado = 'rodando'/.test(cypher)) return [{ id: "s1-0" }, { id: "s1-1" }];
      if (/RETURN a\.id AS id, a\.texto AS texto/.test(cypher)) throw new Error("Aura fora do ar");
      return [];
    }) as never);

    const r = await rodarElo();
    expect(r?.rodada).toBeNull();
    const falhou = consulta.mock.calls.filter((c) => String(c[0]).includes("'falhou'"));
    expect((falhou.at(-1)?.[1] as { ids: string[] }).ids).toEqual(["s1-0", "s1-1"]);
  });
});

// ───────────────────────── o radial e a minha edição ─────────────────────────

describe("lerRadial", () => {
  it("null quando o átomo não existe", async () => {
    expect(await lerRadial("sumido")).toBeNull();
  });

  it("as duas direções, os vizinhos uma vez só, e a ausência lida como forte/agente", async () => {
    consultaUm.mockResolvedValue({
      id: "c", texto: "centro", tipo: "FATO", valido_em: "2026-08-01", sessao_id: "s",
      estado: "processado", em: "2026-08-02", motivo_falha: "",
    } as never);
    consulta.mockResolvedValue([
      { novo_id: "c", velho_id: "v", tipo: "CONFIRMA", camada: "forte", origem: "agente", confianca: 0.9, motivo: "m", modelo: "x", prompt_version: "confronto-3", criado_em: "", editado_em: "", v_id: "v", v_texto: "vt", v_tipo: "FATO", v_valido_em: "2026-01-01", v_sessao_id: "s0" },
      { novo_id: "n", velho_id: "c", tipo: "COMPLEMENTA", camada: null, origem: null, confianca: 0.6, motivo: "", modelo: "", prompt_version: "", criado_em: "", editado_em: "", v_id: "n", v_texto: "nt", v_tipo: "SENTIMENTO", v_valido_em: "2026-09-01", v_sessao_id: "s2" },
      { novo_id: "n", velho_id: "c", tipo: "INVENTADA", camada: "forte", origem: "eu", confianca: 1, motivo: "", modelo: "", prompt_version: "", criado_em: "", editado_em: "", v_id: "n", v_texto: "nt", v_tipo: "SENTIMENTO", v_valido_em: "2026-09-01", v_sessao_id: "s2" },
    ] as never);

    const r = await lerRadial("c");
    expect(r?.vizinhos.map((v) => v.id)).toEqual(["v", "n"]);
    expect(r?.relacoes).toHaveLength(2);
    expect(r?.relacoes[1]).toMatchObject({ novo_id: "n", velho_id: "c", camada: "forte", origem: "agente" });
    expect(String(consulta.mock.calls[0][0])).toContain("coalesce(v.status, 'ativo') = 'ativo'");
  });
});

describe("editarRelacao", () => {
  const linhaDaRelacao = (extra: Record<string, unknown> = {}) => ({
    tipo: "COMPLEMENTA", camada: "sutil", origem: "agente", confianca: 0.6, motivo: "aqui: x; ali: y",
    modelo: "deepseek/deepseek-v4.1-flash", prompt_version: "confronto-3", criado_em: "", editado_em: "",
    original_tipo: null, original_camada: null, original_motivo: null,
    novo_texto: "fiquei travado", novo_tipo: "SENTIMENTO", novo_valido_em: "2026-08-10",
    novo_sessao_id: "s1", novo_inicios_s: [30, 41],
    velho_texto: "a reunião foi remarcada", velho_tipo: "FATO", velho_valido_em: "2026-08-07",
    ...extra,
  });

  it("relação que não existe estoura ConfrontoError", async () => {
    await expect(editarRelacao("n", "v", "camada", "forte")).rejects.toThrow(ConfrontoError);
  });

  it("trocar a camada congela a aresta e guarda o original só na primeira vez", async () => {
    consultaUm
      .mockResolvedValueOnce(linhaDaRelacao() as never)
      .mockResolvedValueOnce(linhaDaRelacao({ camada: "forte", origem: "eu", original_camada: "sutil" }) as never);

    const r = await editarRelacao("n", "v", "camada", "forte");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("MATCH (novo:Atomo { id: $novo })-[r:COMPLEMENTA]->(velho:Atomo { id: $velho })");
    expect(cypher).toContain("r.original_camada = coalesce(r.original_camada, r.camada, 'forte')");
    expect(cypher).toContain("r.origem = 'eu'");
    expect(r.antes.original).toEqual({ tipo: "COMPLEMENTA", camada: "sutil", motivo: "aqui: x; ali: y" });
    expect(r.depois?.camada).toBe("forte");
  });

  it("trocar o tipo apaga e recria com as propriedades, os dois literais da constante", async () => {
    consultaUm.mockResolvedValue(linhaDaRelacao() as never);
    await editarRelacao("n", "v", "tipo", "CONFIRMA");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("[r:COMPLEMENTA]");
    expect(cypher).toContain("CREATE (novo)-[n:CONFIRMA]->(velho)");
    expect(cypher).toContain("SET n = p, n.origem = 'eu'");
  });

  it("tipo fora dos quatro é recusado antes de qualquer escrita", async () => {
    consultaUm.mockResolvedValue(linhaDaRelacao() as never);
    await expect(editarRelacao("n", "v", "tipo", "EXPLICA")).rejects.toThrow(ConfrontoError);
    expect(consulta).not.toHaveBeenCalled();
  });

  it("motivo vazio é recusado — para tirar a relação, apaga", async () => {
    consultaUm.mockResolvedValue(linhaDaRelacao() as never);
    await expect(editarRelacao("n", "v", "motivo", "   ")).rejects.toThrow(ConfrontoError);
  });

  it("apagar deixa a recusa do par, e não há depois", async () => {
    consultaUm.mockResolvedValue(linhaDaRelacao() as never);
    const r = await editarRelacao("n", "v", "recusar", "");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("DELETE r");
    expect(cypher).toContain("MERGE (novo)-[x:CONFRONTO_RECUSADO]->(velho)");
    expect(consulta.mock.calls[0][1]).toMatchObject({ tipo: "COMPLEMENTA" });
    expect(r.depois).toBeNull();
  });
});
