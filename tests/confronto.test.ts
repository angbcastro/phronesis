/**
 * O agente `confronto` — o que ele busca, o que ele pede ao modelo, o que ele
 * grava e o que o desfazer restaura.
 *
 * Como em `enriquecimento.test.ts`, o que se testa primeiro é o que impede uma
 * resposta ruim de virar relação: o parser tolerante a candidato inválido, o
 * corte de confiança em [0,1], e o átomo sem candidato que nem chega ao
 * modelo. A gravação é conferida pelo Cypher que ela monta — apagar antes de
 * escrever é o que faz "uma geração" ser verdade sem precisar casar `execucao`.
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
  ConfrontoError,
  INSTRUCOES,
  K_CANDIDATOS,
  LEASE_MS,
  PISO_CONFRONTO,
  PROMPT_VERSION_CONFRONTO,
  blocoDeCandidatos,
  candidatosDeConfronto,
  decidirRelacoes,
  desfazerConfronto,
  gravarRelacoes,
  marcarFalha,
  montarPrompt,
  parsearRelacoes,
  processarAtomo,
  reivindicarProximoAtomo,
  rodarElo,
} from "@/lib/confronto";
import type { CandidatoDeConfronto } from "@/lib/tipos";
import { query, queryUm } from "@/lib/neo4j";

const consulta = vi.mocked(query);
const consultaUm = vi.mocked(queryUm);
const chamar = vi.mocked(generateText);

const candidato = (extra: Partial<CandidatoDeConfronto> = {}): CandidatoDeConfronto => ({
  id: "s1-0",
  texto: "quero mudar de carreira para pesquisa",
  tipo: "OPINIAO",
  valido_em: "2026-06-01T00:00:00.000Z",
  similaridade: 0.7,
  ...extra,
});

const responder = (texto: string) =>
  chamar.mockResolvedValue({ text: texto, finishReason: "stop" } as never);

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  delete process.env.CONFRONTO_MODEL;
  consulta.mockReset();
  consulta.mockResolvedValue([] as never);
  consultaUm.mockReset();
  consultaUm.mockResolvedValue(null as never);
  chamar.mockReset();
});

// ───────────────────────── candidatos ─────────────────────────

describe("candidatosDeConfronto", () => {
  it("busca por vetor, desfaz a normalização do score, e só aceita passado", async () => {
    await candidatosDeConfronto("s1-0");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("db.index.vector.queryNodes('atomo_embedding'");
    expect(cypher).toContain("2 * score - 1 AS similaridade");
    expect(cypher).toContain("coalesce(candidato.valido_em, '') < coalesce(alvo.valido_em, '')");
    expect(cypher).toContain("candidato.id <> alvo.id");
    expect(cypher).toContain("coalesce(candidato.status, 'ativo') = 'ativo'");
  });

  it("os parâmetros default são os documentados", async () => {
    await candidatosDeConfronto("s1-0");
    expect(consulta.mock.calls[0][1]).toEqual({ atomoId: "s1-0", k: K_CANDIDATOS, piso: PISO_CONFRONTO });
  });
});

// ───────────────────────── o prompt ─────────────────────────

describe("o prompt", () => {
  it("numera os candidatos na ordem recebida", () => {
    const bloco = blocoDeCandidatos([
      candidato({ texto: "a" }),
      candidato({ texto: "b", tipo: "DECISAO" }),
    ]);
    expect(bloco).toContain("1. [OPINIAO 2026-06-01] a");
    expect(bloco).toContain("2. [DECISAO 2026-06-01] b");
  });

  it("candidato sem data não imprime data nenhuma", () => {
    const bloco = blocoDeCandidatos([candidato({ valido_em: "" })]);
    expect(bloco).toContain("1. [OPINIAO] ");
  });

  it("monta o trecho novo e o bloco de candidatos sobre a base", () => {
    const p = montarPrompt(
      { texto: "mudei de ideia sobre carreira", tipo: "OPINIAO", valido_em: "2026-08-01T00:00:00.000Z" },
      [candidato()],
      "BASE",
    );
    expect(p.startsWith("BASE")).toBe(true);
    expect(p).toContain("TRECHO NOVO [OPINIAO] (2026-08-01): mudei de ideia sobre carreira");
    expect(p).toContain("1. [OPINIAO 2026-06-01]");
  });

  it("as quatro relações e NENHUMA aparecem nas instruções", () => {
    for (const palavra of ["ATUALIZA", "CONTRADIZ", "CONFIRMA", "COMPLEMENTA", "NENHUMA"]) {
      expect(INSTRUCOES).toContain(palavra);
    }
  });
});

// ───────────────────────── o parser ─────────────────────────

describe("parsearRelacoes", () => {
  const cands = [candidato({ id: "a" }), candidato({ id: "b" })];

  it("lê o envelope {relacoes:[...]}", () => {
    const r = parsearRelacoes(
      '{"relacoes":[{"n":1,"tipo":"ATUALIZA","confianca":0.9,"motivo":"mudou de ideia"}]}',
      cands,
    );
    expect(r).toEqual([{ candidato_id: "a", tipo: "ATUALIZA", confianca: 0.9, motivo: "mudou de ideia" }]);
  });

  it("lê a lista solta também", () => {
    const r = parsearRelacoes('[{"n":2,"tipo":"COMPLEMENTA","confianca":0.5,"motivo":"m"}]', cands);
    expect(r[0].candidato_id).toBe("b");
  });

  it("lista vazia é resposta legítima", () => {
    expect(parsearRelacoes('{"relacoes":[]}', cands)).toEqual([]);
  });

  it("ignora cerca de markdown e frase antes do JSON", () => {
    const r = parsearRelacoes(
      'claro, aqui está:\n```json\n{"relacoes":[{"n":1,"tipo":"CONFIRMA","confianca":1,"motivo":"m"}]}\n```',
      cands,
    );
    expect(r).toHaveLength(1);
  });

  it("descarta item com n fora do intervalo, sem derrubar os outros", () => {
    const r = parsearRelacoes(
      '{"relacoes":[{"n":9,"tipo":"ATUALIZA","confianca":1,"motivo":"m"},' +
        '{"n":1,"tipo":"CONTRADIZ","confianca":1,"motivo":"m2"}]}',
      cands,
    );
    expect(r).toEqual([{ candidato_id: "a", tipo: "CONTRADIZ", confianca: 1, motivo: "m2" }]);
  });

  it("descarta tipo que não é um dos quatro", () => {
    const r = parsearRelacoes('{"relacoes":[{"n":1,"tipo":"TALVEZ","confianca":1,"motivo":"m"}]}', cands);
    expect(r).toEqual([]);
  });

  it("corta confiança fora de [0,1], e trata ausente como 0", () => {
    const r = parsearRelacoes(
      '{"relacoes":[{"n":1,"tipo":"CONFIRMA","confianca":7,"motivo":"m"},' +
        '{"n":2,"tipo":"CONFIRMA","motivo":"m"}]}',
      cands,
    );
    expect(r[0].confianca).toBe(1);
    expect(r[1].confianca).toBe(0);
  });

  it("resposta sem JSON reconhecível estoura ConfrontoError", () => {
    expect(() => parsearRelacoes("não sei dizer", cands)).toThrow(ConfrontoError);
  });
});

// ───────────────────────── a chamada ao modelo ─────────────────────────

describe("decidirRelacoes", () => {
  it("carimba a versão do prompt e devolve o modelo da resposta", async () => {
    responder('{"relacoes":[]}');
    const d = await decidirRelacoes(
      { texto: "x", tipo: "OPINIAO", valido_em: "" },
      [candidato()],
    );
    expect(d.prompt_version).toBe(PROMPT_VERSION_CONFRONTO);
    expect(d.relacoes).toEqual([]);
  });

  it("repete com o dobro do teto quando o raciocínio come o orçamento", async () => {
    chamar
      .mockResolvedValueOnce({ text: "", finishReason: "length" } as never)
      .mockResolvedValueOnce({ text: '{"relacoes":[]}', finishReason: "stop" } as never);

    await decidirRelacoes({ texto: "x", tipo: "OPINIAO", valido_em: "" }, [candidato()]);
    expect(chamar).toHaveBeenCalledTimes(2);
    const segundaChamada = chamar.mock.calls[1][0] as { maxOutputTokens: number };
    const primeiraChamada = chamar.mock.calls[0][0] as { maxOutputTokens: number };
    expect(segundaChamada.maxOutputTokens).toBe(primeiraChamada.maxOutputTokens * 2);
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
        { candidato_id: "b", tipo: "COMPLEMENTA", confianca: 0.6, motivo: "m2" },
      ],
      "exec-1",
      "zai/glm-5.3-flash",
      "confronto-1",
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

describe("marcarFalha", () => {
  it("grava o motivo cortado no teto, sem tocar relação nenhuma", async () => {
    await marcarFalha("s1-0", "x".repeat(500));
    expect(consulta).toHaveBeenCalledTimes(1);
    const [cypher, params] = consulta.mock.calls[0];
    expect(String(cypher)).toContain("a.confronto_estado = 'falhou'");
    expect((params as { motivo: string }).motivo).toHaveLength(300);
  });
});

// ───────────────────────── o desfazer ─────────────────────────

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

// ───────────────────────────── a fila ─────────────────────────────

describe("reivindicarProximoAtomo", () => {
  it("pega o mais antigo pendente, com o lease de retomada", async () => {
    consulta.mockResolvedValue([{ id: "s1-0" }] as never);
    const antes = Date.now();
    const id = await reivindicarProximoAtomo(new Date(antes));
    expect(id).toBe("s1-0");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("ORDER BY coalesce(a.valido_em, a.criado_em, '') ASC LIMIT 1");
    expect(cypher).toContain("a.embedding IS NOT NULL");
    const params = consulta.mock.calls[0][1] as { limite: string };
    expect(new Date(antes).getTime() - new Date(params.limite).getTime()).toBe(LEASE_MS);
  });

  it("fila vazia devolve null", async () => {
    consulta.mockResolvedValue([] as never);
    expect(await reivindicarProximoAtomo()).toBeNull();
  });
});

describe("processarAtomo", () => {
  it("sem candidato acima do piso, não vai ao modelo", async () => {
    consultaUm.mockResolvedValue({ id: "s1-0", texto: "x", tipo: "OPINIAO", valido_em: "" } as never);
    consulta.mockResolvedValue([] as never); // candidatosDeConfronto vazio

    const r = await processarAtomo("s1-0");
    expect(r).toEqual({ candidatos: 0, relacoes: 0 });
    expect(chamar).not.toHaveBeenCalled();
  });

  it("átomo que sumiu do grafo estoura ConfrontoError", async () => {
    consultaUm.mockResolvedValue(null as never);
    await expect(processarAtomo("sumiu")).rejects.toThrow(ConfrontoError);
  });
});

describe("rodarElo", () => {
  it("fila vazia devolve null", async () => {
    consulta.mockResolvedValue([] as never);
    expect(await rodarElo()).toBeNull();
  });

  it("falha do processamento marca o átomo, e o elo não estoura", async () => {
    consulta
      .mockResolvedValueOnce([{ id: "s1-0" }] as never) // reivindicar
      .mockResolvedValueOnce([] as never); // marcarFalha (SET não retorna nada relevante)
    consultaUm.mockResolvedValue(null as never); // processarAtomo não acha o átomo → estoura

    const r = await rodarElo();
    expect(r).toEqual({ id: "s1-0", rodada: null });
    const marcou = consulta.mock.calls.some((c) => String(c[0]).includes("a.confronto_estado = 'falhou'"));
    expect(marcou).toBe(true);
  });
});
