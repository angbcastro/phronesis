/**
 * O agente `confronto` — o que ele busca, o que ele pede ao modelo, o que ele
 * grava e o que o desfazer restaura.
 *
 * Como em `enriquecimento.test.ts`, o que se testa primeiro é o que impede uma
 * resposta ruim de virar relação. Desde a 5.1 isso é uma lista maior, porque a
 * primeira revisão à mão disse onde o agente erra: par que ninguém pediu,
 * `COMPLEMENTA` abaixo do limiar, e número fora do acervo. A gravação continua
 * sendo conferida pelo Cypher que ela monta — apagar antes de escrever é o que
 * faz "uma geração" ser verdade sem precisar casar `execucao`.
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
  ALVOS_POR_LOTE,
  ConfrontoError,
  INSTRUCOES,
  K_CANDIDATOS,
  LEASE_MS,
  LIMIAR_COMPLEMENTA,
  PISO_CONFRONTO,
  PROMPT_VERSION_CONFRONTO,
  alvosDoLote,
  apresentar,
  blocoDoAcervo,
  blocoDosPares,
  candidatosDeLote,
  decidirLote,
  desfazerConfronto,
  gravarRelacoes,
  marcarFalhaEmLote,
  montarLote,
  montarPrompt,
  parsearRelacoes,
  processarLote,
  reivindicarProximosAtomos,
  reprocessarTudo,
  rodarElo,
  tamanhoDaFilaDeConfronto,
  type AtomoAlvo,
} from "@/lib/confronto";
import type { CandidatoDeConfronto } from "@/lib/tipos";
import { query, queryUm } from "@/lib/neo4j";

const consulta = vi.mocked(query);
const consultaUm = vi.mocked(queryUm);
const chamar = vi.mocked(generateText);

const alvo = (extra: Partial<AtomoAlvo> = {}): AtomoAlvo => ({
  id: "novo",
  texto: "hoje eu mudei de ideia sobre a carreira",
  tipo: "OPINIAO",
  valido_em: "2026-08-01T00:00:00.000Z",
  entidades: { sobre: [], cita: [] },
  ...extra,
});

const candidato = (extra: Partial<CandidatoDeConfronto> = {}): CandidatoDeConfronto => ({
  id: "velho",
  texto: "quero mudar de carreira para pesquisa",
  tipo: "OPINIAO",
  valido_em: "2026-06-01T00:00:00.000Z",
  entidades: { sobre: [], cita: [] },
  similaridade: 0.7,
  ...extra,
});

/** Um lote de um par só — o caso mínimo que o parser precisa para funcionar. */
const loteDeUmPar = () => montarLote([alvo()], { novo: [candidato()] });

const responder = (texto: string) =>
  chamar.mockResolvedValue({ text: texto, finishReason: "stop" } as never);

/** Responde por Cypher, e não por ordem de chamada — o caminho do lote é longo. */
const porCypher = (mapa: [RegExp, unknown][]) => {
  consulta.mockImplementation((async (cypher: string) => {
    for (const [re, valor] of mapa) if (re.test(String(cypher))) return valor;
    return [];
  }) as never);
};

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
  it("busca por vetor, desfaz a normalização do score, e só aceita passado", async () => {
    await candidatosDeLote(["a", "b"]);
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("db.index.vector.queryNodes('atomo_embedding'");
    expect(cypher).toContain("2 * score - 1 AS similaridade");
    expect(cypher).toContain("coalesce(candidato.valido_em, '') < coalesce(alvo.valido_em, '')");
    expect(cypher).toContain("candidato.id <> alvo.id");
    expect(cypher).toContain("coalesce(candidato.status, 'ativo') = 'ativo'");
  });

  it("uma consulta para o lote inteiro, com os defaults documentados", async () => {
    await candidatosDeLote(["a", "b", "c"]);
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(consulta.mock.calls[0][1]).toEqual({
      ids: ["a", "b", "c"],
      k: K_CANDIDATOS,
      piso: PISO_CONFRONTO,
    });
  });

  it("pendura as entidades do candidato, e nunca o \"eu\"", async () => {
    await candidatosDeLote(["a"]);
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("[:SOBRE]->(s:Entidade)");
    expect(cypher).toContain("[:MENCIONA]->(m:Entidade)");
    expect(cypher).toContain("toLower(coalesce(s.nome, '')) <> 'eu'");
    expect(cypher).toContain("toLower(coalesce(m.nome, '')) <> 'eu'");
  });

  it("agrupa as linhas por alvo, na forma do acervo", async () => {
    consulta.mockResolvedValue([
      { alvo_id: "a", id: "v1", texto: "t1", tipo: "FATO", valido_em: "2026-01-01", similaridade: 0.9, sobre: ["Behring Founders"], cita: [] },
      { alvo_id: "a", id: "v2", texto: "t2", tipo: "FATO", valido_em: "2026-01-02", similaridade: 0.8, sobre: [], cita: ["Murta"] },
      { alvo_id: "b", id: "v3", texto: "t3", tipo: "FATO", valido_em: "2026-01-03", similaridade: 0.7, sobre: [], cita: [] },
    ] as never);

    const r = await candidatosDeLote(["a", "b"]);
    expect(Object.keys(r)).toEqual(["a", "b"]);
    expect(r.a).toHaveLength(2);
    expect(r.a[0].entidades).toEqual({ sobre: ["Behring Founders"], cita: [] });
    expect(r.b[0].id).toBe("v3");
  });
});

describe("alvosDoLote", () => {
  it("devolve só quem está no grafo, com as entidades", async () => {
    consulta.mockResolvedValue([
      { id: "a", texto: "t", tipo: "OPINIAO", valido_em: "2026-01-01", sobre: [], cita: ["Augusto Castro"] },
    ] as never);

    const r = await alvosDoLote(["a", "sumiu"]);
    expect(r).toHaveLength(1);
    expect(r[0].entidades.cita).toEqual(["Augusto Castro"]);
  });
});

// ───────────────────────── o acervo e o prompt ─────────────────────────

describe("montarLote", () => {
  it("numera cada átomo uma vez só, mesmo servindo de alvo e de candidato", () => {
    const a1 = alvo({ id: "a1", valido_em: "2026-08-01" });
    const a2 = alvo({ id: "a2", valido_em: "2026-09-01" });
    const c = candidato({ id: "a1", valido_em: "2026-08-01" }); // o alvo a1 também é candidato de a2

    const lote = montarLote([a1, a2], { a1: [candidato({ id: "v" })], a2: [c] });

    expect(lote.acervo.map((x) => x.id)).toEqual(["a1", "v", "a2"]);
    expect(lote.pares).toEqual([
      { novo: 1, velho: 2 },
      { novo: 3, velho: 1 },
    ]);
  });

  it("alvo sem candidato não entra no acervo nem gera par", () => {
    const lote = montarLote([alvo({ id: "sozinho" })], {});
    expect(lote.acervo).toEqual([]);
    expect(lote.pares).toEqual([]);
  });
});

describe("a apresentação do átomo", () => {
  it("mostra tipo, data e as entidades separadas por papel", () => {
    expect(
      apresentar(alvo({ entidades: { sobre: ["Behring Founders"], cita: ["Murta"] } })),
    ).toBe("[OPINIAO 2026-08-01 · sobre: Behring Founders · cita: Murta]");
  });

  it("diz \"sem entidade nomeada\" em vez de omitir — é o lado ausente do contraste", () => {
    expect(apresentar(alvo())).toBe("[OPINIAO 2026-08-01 · sem entidade nomeada]");
  });

  it("átomo sem data não imprime data nenhuma", () => {
    expect(apresentar(alvo({ valido_em: "" }))).toBe("[OPINIAO · sem entidade nomeada]");
  });

  it("o acervo numera a partir de 1, na ordem", () => {
    const bloco = blocoDoAcervo([alvo({ texto: "a" }), alvo({ texto: "b", tipo: "DECISAO" })]);
    expect(bloco).toContain("1. [OPINIAO 2026-08-01 · sem entidade nomeada] a");
    expect(bloco).toContain("2. [DECISAO 2026-08-01 · sem entidade nomeada] b");
  });

  it("os pares saem como novo → velho", () => {
    expect(blocoDosPares([{ novo: 3, velho: 1 }])).toBe("3 → 1");
  });

  it("o prompt monta base, acervo e pares", () => {
    const p = montarPrompt(loteDeUmPar(), "BASE");
    expect(p.startsWith("BASE")).toBe(true);
    expect(p).toContain("ACERVO (cada trecho aparece uma vez, numerado):");
    expect(p).toContain("PARES A JULGAR (novo → antigo):");
    expect(p).toContain("1 → 2");
  });

  it("as quatro relações, NENHUMA e o envelope aparecem nas instruções", () => {
    for (const palavra of ["ATUALIZA", "CONTRADIZ", "CONFIRMA", "COMPLEMENTA", "NENHUMA", "relacoes", "novo", "velho"]) {
      expect(INSTRUCOES).toContain(palavra);
    }
  });
});

// ───────────────────────── o parser ─────────────────────────

describe("parsearRelacoes", () => {
  const lote = loteDeUmPar(); // acervo: 1 = "novo", 2 = "velho"; par: 1 → 2

  it("lê o envelope {relacoes:[...]} e agrupa pelo átomo mais novo", () => {
    const r = parsearRelacoes(
      '{"relacoes":[{"novo":1,"velho":2,"tipo":"ATUALIZA","confianca":0.9,"motivo":"mudou de ideia"}]}',
      lote,
    );
    expect(r.porAlvo.get("novo")).toEqual([
      { candidato_id: "velho", tipo: "ATUALIZA", confianca: 0.9, motivo: "mudou de ideia" },
    ]);
  });

  it("lê a lista solta também", () => {
    const r = parsearRelacoes('[{"novo":1,"velho":2,"tipo":"CONFIRMA","confianca":0.9,"motivo":"m"}]', lote);
    expect(r.porAlvo.get("novo")).toHaveLength(1);
  });

  it("lista vazia é resposta legítima", () => {
    const r = parsearRelacoes('{"relacoes":[]}', lote);
    expect(r.porAlvo.size).toBe(0);
    expect(r.descartadas).toBe(0);
  });

  it("ignora cerca de markdown e frase antes do JSON", () => {
    const r = parsearRelacoes(
      'claro:\n```json\n{"relacoes":[{"novo":1,"velho":2,"tipo":"CONFIRMA","confianca":1,"motivo":"m"}]}\n```',
      lote,
    );
    expect(r.porAlvo.size).toBe(1);
  });

  it("descarta número fora do acervo sem derrubar os outros", () => {
    const r = parsearRelacoes(
      '{"relacoes":[{"novo":9,"velho":2,"tipo":"ATUALIZA","confianca":1,"motivo":"m"},' +
        '{"novo":1,"velho":2,"tipo":"CONTRADIZ","confianca":1,"motivo":"m2"}]}',
      lote,
    );
    expect(r.porAlvo.get("novo")).toEqual([
      { candidato_id: "velho", tipo: "CONTRADIZ", confianca: 1, motivo: "m2" },
    ]);
  });

  it("descarta par que ninguém pediu — inclusive o mesmo par ao contrário", () => {
    const r = parsearRelacoes(
      '{"relacoes":[{"novo":2,"velho":1,"tipo":"ATUALIZA","confianca":1,"motivo":"direção errada"}]}',
      lote,
    );
    expect(r.porAlvo.size).toBe(0);
  });

  it("descarta tipo que não é um dos quatro", () => {
    const r = parsearRelacoes('{"relacoes":[{"novo":1,"velho":2,"tipo":"TALVEZ","confianca":1,"motivo":"m"}]}', lote);
    expect(r.porAlvo.size).toBe(0);
  });

  it("corta confiança fora de [0,1], e trata ausente como 0", () => {
    const r = parsearRelacoes(
      '{"relacoes":[{"novo":1,"velho":2,"tipo":"CONFIRMA","confianca":7,"motivo":"m"}]}',
      lote,
    );
    expect(r.porAlvo.get("novo")![0].confianca).toBe(1);

    const sem = parsearRelacoes(
      '{"relacoes":[{"novo":1,"velho":2,"tipo":"CONFIRMA","motivo":"m"}]}',
      lote,
    );
    expect(sem.porAlvo.get("novo")![0].confianca).toBe(0);
  });

  it("o piso derruba COMPLEMENTA fraca, e conta quantas", () => {
    const r = parsearRelacoes(
      `{"relacoes":[{"novo":1,"velho":2,"tipo":"COMPLEMENTA","confianca":0.6,"motivo":"m"}]}`,
      lote,
      0.7,
    );
    expect(r.porAlvo.size).toBe(0);
    expect(r.descartadas).toBe(1);
  });

  it("o piso não vale para os outros três — nenhum deles foi reprovado na revisão", () => {
    for (const tipo of ["ATUALIZA", "CONTRADIZ", "CONFIRMA"]) {
      const r = parsearRelacoes(
        `{"relacoes":[{"novo":1,"velho":2,"tipo":"${tipo}","confianca":0.1,"motivo":"m"}]}`,
        lote,
        0.7,
      );
      expect(r.porAlvo.get("novo")).toHaveLength(1);
      expect(r.descartadas).toBe(0);
    }
  });

  it("COMPLEMENTA no piso exato passa", () => {
    const r = parsearRelacoes(
      `{"relacoes":[{"novo":1,"velho":2,"tipo":"COMPLEMENTA","confianca":0.7,"motivo":"m"}]}`,
      lote,
      0.7,
    );
    expect(r.porAlvo.get("novo")).toHaveLength(1);
  });

  it("corta o motivo no teto", () => {
    const r = parsearRelacoes(
      `{"relacoes":[{"novo":1,"velho":2,"tipo":"CONFIRMA","confianca":1,"motivo":"${"x".repeat(500)}"}]}`,
      lote,
    );
    expect(r.porAlvo.get("novo")![0].motivo).toHaveLength(300);
  });

  it("resposta sem JSON reconhecível estoura ConfrontoError", () => {
    expect(() => parsearRelacoes("não sei dizer", lote)).toThrow(ConfrontoError);
  });
});

// ───────────────────────── a chamada ao modelo ─────────────────────────

describe("decidirLote", () => {
  it("carimba a versão do prompt e devolve o modelo da resposta", async () => {
    responder('{"relacoes":[]}');
    const d = await decidirLote(loteDeUmPar());
    expect(d.prompt_version).toBe(PROMPT_VERSION_CONFRONTO);
    expect(d.porAlvo.size).toBe(0);
  });

  it("o limiar do COMPLEMENTA em vigor é o da base quando não há override", async () => {
    responder('{"relacoes":[{"novo":1,"velho":2,"tipo":"COMPLEMENTA","confianca":0.65,"motivo":"m"}]}');
    const d = await decidirLote(loteDeUmPar());
    expect(LIMIAR_COMPLEMENTA).toBe(0.7);
    expect(d.descartadas).toBe(1);
  });

  it("repete com o dobro do teto quando o raciocínio come o orçamento", async () => {
    chamar
      .mockResolvedValueOnce({ text: "", finishReason: "length" } as never)
      .mockResolvedValueOnce({ text: '{"relacoes":[]}', finishReason: "stop" } as never);

    await decidirLote(loteDeUmPar());
    expect(chamar).toHaveBeenCalledTimes(2);
    const primeira = chamar.mock.calls[0][0] as { maxOutputTokens: number };
    const segunda = chamar.mock.calls[1][0] as { maxOutputTokens: number };
    expect(segunda.maxOutputTokens).toBe(primeira.maxOutputTokens * 2);
  });
});

// ───────────────────────── a gravação ─────────────────────────

describe("gravarRelacoes", () => {
  it("apaga a geração anterior antes de escrever a nova", async () => {
    await gravarRelacoes("s1-0", [], "exec-1", "", "", new Date("2026-09-13T00:00:00.000Z"));
    const primeira = String(consulta.mock.calls[0][0]);
    expect(primeira).toContain("[r:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]->()");
    expect(primeira).toContain("DELETE r");
  });

  it("uma consulta por tipo, com o literal saindo da constante fechada", async () => {
    await gravarRelacoes(
      "s1-0",
      [
        { candidato_id: "a", tipo: "ATUALIZA", confianca: 0.9, motivo: "m" },
        { candidato_id: "b", tipo: "COMPLEMENTA", confianca: 0.8, motivo: "m2" },
      ],
      "exec-1",
      "zai/glm-5.3-flash",
      "confronto-2",
    );
    const cyphers = consulta.mock.calls.map((c) => String(c[0]));
    expect(cyphers.some((c) => c.includes("MERGE (alvo)-[rel:ATUALIZA]->(candidato)"))).toBe(true);
    expect(cyphers.some((c) => c.includes("MERGE (alvo)-[rel:COMPLEMENTA]->(candidato)"))).toBe(true);
    expect(cyphers.some((c) => c.includes("MERGE (alvo)-[rel:CONTRADIZ]->(candidato)"))).toBe(false);
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
    expect(consulta).toHaveBeenCalledTimes(1);
    const [cypher, params] = consulta.mock.calls[0];
    expect(String(cypher)).toContain("a.confronto_estado = 'falhou'");
    expect(String(cypher)).toContain("WHERE a.confronto_estado = 'rodando'");
    expect((params as { motivo: string }).motivo).toHaveLength(300);
    expect((params as { ids: string[] }).ids).toEqual(["a", "b"]);
  });
});

// ───────────────────────── o desfazer e o reprocessar ─────────────────────────

describe("desfazerConfronto", () => {
  it("null quando o átomo nunca foi tentado", async () => {
    consultaUm.mockResolvedValue({ id: "s1-0", relacoes: 0, tinha: false } as never);
    expect(await desfazerConfronto("s1-0")).toBeNull();
  });

  it("devolve quantas relações apagou quando havia geração", async () => {
    consultaUm.mockResolvedValue({ id: "s1-0", relacoes: 2, tinha: true } as never);
    expect(await desfazerConfronto("s1-0")).toEqual({ id: "s1-0", relacoes: 2 });
  });

  it("átomo que não existe mais estoura ConfrontoError", async () => {
    consultaUm.mockResolvedValue(null as never);
    await expect(desfazerConfronto("sumiu")).rejects.toThrow(ConfrontoError);
  });
});

describe("reprocessarTudo", () => {
  it("apaga as relações e limpa os quatro campos de controle", async () => {
    consultaUm.mockResolvedValue({ atomos: 58, relacoes: 21 } as never);
    const r = await reprocessarTudo();
    expect(r).toEqual({ atomos: 58, relacoes: 21 });

    const cypher = String(consultaUm.mock.calls[0][0]);
    expect(cypher).toContain("DELETE r");
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
    const ids = await reivindicarProximosAtomos(ALVOS_POR_LOTE, new Date(antes));

    expect(ids).toEqual(["s1-0", "s1-1"]);
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("ORDER BY coalesce(a.valido_em, a.criado_em, '') ASC LIMIT $n");
    expect(cypher).toContain("a.embedding IS NOT NULL");
    const params = consulta.mock.calls[0][1] as { limite: string; n: number };
    expect(params.n).toBe(ALVOS_POR_LOTE);
    expect(new Date(antes).getTime() - new Date(params.limite).getTime()).toBe(LEASE_MS);
  });

  it("fila vazia devolve lista vazia", async () => {
    consulta.mockResolvedValue([] as never);
    expect(await reivindicarProximosAtomos()).toEqual([]);
  });
});

describe("tamanhoDaFilaDeConfronto", () => {
  it("conta o mesmo que a reivindicação pega — embedding incluído", async () => {
    consulta.mockResolvedValue([{ quantas: 7 }] as never);
    expect(await tamanhoDaFilaDeConfronto()).toBe(7);
    expect(String(consulta.mock.calls[0][0])).toContain("a.embedding IS NOT NULL");
  });
});

describe("processarLote", () => {
  it("sem candidato acima do piso, não vai ao modelo", async () => {
    porCypher([
      [/RETURN a\.id AS id, a\.texto AS texto/, [{ id: "s1-0", texto: "x", tipo: "OPINIAO", valido_em: "", sobre: [], cita: [] }]],
      [/queryNodes/, []],
    ]);

    const r = await processarLote(["s1-0"]);
    expect(r).toEqual({ alvos: 1, pares: 0, relacoes: 0, descartadas: 0 });
    expect(chamar).not.toHaveBeenCalled();

    const marcou = consulta.mock.calls.some((c) =>
      String(c[0]).includes("a.confronto_estado = 'processado'"),
    );
    expect(marcou).toBe(true);
  });

  it("átomo que sumiu entre reivindicar e processar vai para falhou", async () => {
    porCypher([[/RETURN a\.id AS id, a\.texto AS texto/, []]]);

    const r = await processarLote(["sumiu"]);
    expect(r).toEqual({ alvos: 0, pares: 0, relacoes: 0, descartadas: 0 });
    const falhou = consulta.mock.calls.find((c) =>
      String(c[0]).includes("a.confronto_estado = 'falhou'"),
    );
    expect((falhou?.[1] as { ids: string[] }).ids).toEqual(["sumiu"]);
  });

  it("uma chamada de modelo para o lote inteiro, e grava por alvo", async () => {
    porCypher([
      [
        /RETURN a\.id AS id, a\.texto AS texto/,
        [
          { id: "a1", texto: "t1", tipo: "OPINIAO", valido_em: "2026-08-01", sobre: [], cita: [] },
          { id: "a2", texto: "t2", tipo: "FATO", valido_em: "2026-09-01", sobre: [], cita: [] },
        ],
      ],
      [
        /queryNodes/,
        [
          { alvo_id: "a1", id: "v1", texto: "vt1", tipo: "FATO", valido_em: "2026-01-01", similaridade: 0.8, sobre: [], cita: [] },
          { alvo_id: "a2", id: "v1", texto: "vt1", tipo: "FATO", valido_em: "2026-01-01", similaridade: 0.8, sobre: [], cita: [] },
        ],
      ],
    ]);
    // acervo: 1 = a1, 2 = v1, 3 = a2; pares: 1→2 e 3→2
    responder('{"relacoes":[{"novo":3,"velho":2,"tipo":"CONTRADIZ","confianca":0.9,"motivo":"m"}]}');

    const r = await processarLote(["a1", "a2"]);
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ alvos: 2, pares: 2, relacoes: 1 });

    const escreveu = consulta.mock.calls.filter((c) =>
      String(c[0]).includes("MERGE (alvo)-[rel:CONTRADIZ]->(candidato)"),
    );
    expect(escreveu).toHaveLength(1);
    expect((escreveu[0][1] as { atomoId: string }).atomoId).toBe("a2");
  });
});

describe("rodarElo", () => {
  it("fila vazia devolve null", async () => {
    consulta.mockResolvedValue([] as never);
    expect(await rodarElo()).toBeNull();
  });

  it("falha do lote marca todos os reivindicados, e o elo não estoura", async () => {
    porCypher([
      [/SET a\.confronto_estado = 'rodando'/, [{ id: "s1-0" }, { id: "s1-1" }]],
      [/RETURN a\.id AS id, a\.texto AS texto/, [{ id: "s1-0", texto: "x", tipo: "OPINIAO", valido_em: "2026-08-01", sobre: [], cita: [] }]],
      [/queryNodes/, [{ alvo_id: "s1-0", id: "v", texto: "y", tipo: "FATO", valido_em: "2026-01-01", similaridade: 0.8, sobre: [], cita: [] }]],
    ]);
    chamar.mockRejectedValue(new Error("gateway fora do ar") as never);

    const r = await rodarElo();
    expect(r?.ids).toEqual(["s1-0", "s1-1"]);
    expect(r?.rodada).toBeNull();

    const falhou = consulta.mock.calls.filter((c) =>
      String(c[0]).includes("a.confronto_estado = 'falhou'"),
    );
    // A primeira é a do átomo que sumiu do lote (s1-1), a segunda é a do lote inteiro.
    expect((falhou.at(-1)?.[1] as { ids: string[] }).ids).toEqual(["s1-0", "s1-1"]);
  });
});
