/**
 * A escrita no grafo. É o único lugar que cria :Atomo e :Entidade, então é
 * aqui que as travas de idempotência precisam estar visíveis num teste.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));
vi.mock("@/lib/embedding", () => ({
  embutirVarios: vi.fn(async (textos: string[]) =>
    textos.map(() => ({ embedding: [0.1, 0.2], modelo: "provedor/embed-teste" })),
  ),
}));

import { STATUS_ATOMO_ATIVO, gravarAtomos, gravarEntidades } from "@/lib/atomos";
import { embutirVarios } from "@/lib/embedding";
import { query } from "@/lib/neo4j";
import type { AtomoParaGravar, EntidadeParaGravar } from "@/lib/atomos";

const consulta = vi.mocked(query);
const embutir = vi.mocked(embutirVarios);

const cypherDe = (i: number) => String(consulta.mock.calls[i][0]);
const paramsDe = (i: number) => consulta.mock.calls[i][1] as Record<string, unknown>;

/**
 * Onde, na fila de consultas, está a que contém este trecho de Cypher.
 *
 * As posições deixaram de ser fixas na slice 4.5: gravar um átomo passou a
 * disparar também a sondagem de "quem ainda precisa de vetor". Procurar pelo
 * Cypher em vez de contar índice é o que impede um teste de menção de quebrar
 * porque uma consulta de embedding nasceu antes dele.
 */
const indiceDe = (trecho: string) =>
  consulta.mock.calls.findIndex((c) => String(c[0]).includes(trecho));
const rodou = (trecho: string) => indiceDe(trecho) !== -1;

const atomo = (extra: Partial<AtomoParaGravar> = {}): AtomoParaGravar => ({
  id: "s1-0",
  texto: "O contrato da Exxmed vai atrasar",
  tipo: "FATO",
  inicios_s: [12.5],
  fins_s: [15],
  ancoras: ["exata"],
  sobre: "exxmed",
  menciona: [],
  perfila: [],
  prompt_version: "extracao-3",
  modelo: "zai/glm-5.3-flash",
  ...extra,
});

beforeEach(() => {
  consulta.mockClear();
  consulta.mockResolvedValue([]);
  embutir.mockClear();
  embutir.mockImplementation(async (textos) =>
    textos.map(() => ({ embedding: [0.1, 0.2], modelo: "provedor/embed-teste" })),
  );
});

describe("entidades", () => {
  it("uma consulta por tipo, com o label literal", () => {
    // Neo4j não aceita label vindo de parâmetro e o projeto não usa APOC.
    const entidades: EntidadeParaGravar[] = [
      { nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" },
      { nome: "Phronesis", nome_normalizado: "phronesis", tipo: "Projeto" },
    ];
    return gravarEntidades(entidades).then(() => {
      expect(consulta).toHaveBeenCalledTimes(2);
      expect(cypherDe(0)).toContain("n:Pessoa");
      expect(cypherDe(1)).toContain("n:Projeto");
    });
  });

  it("não consulta o banco para um tipo sem entidade nenhuma", async () => {
    await gravarEntidades([{ nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" }]);
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("MERGE por nome_normalizado — é a trava contra duplicata", async () => {
    await gravarEntidades([{ nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" }]);
    expect(cypherDe(0)).toContain("MERGE (n:Entidade { nome_normalizado: e.nome_normalizado })");
  });

  it("entidade que já existe mantém grafia e labels", async () => {
    // ON CREATE, não SET: extração não renomeia nem troca tipo do que existe.
    await gravarEntidades([{ nome: "Rafa", nome_normalizado: "rafa", tipo: "Pessoa" }]);
    const cypher = cypherDe(0);
    expect(cypher).toContain("ON CREATE SET");
    expect(cypher).not.toMatch(/\n\s*SET n\./);
  });

  it("lista vazia não fala com o banco", async () => {
    await gravarEntidades([]);
    expect(consulta).not.toHaveBeenCalled();
  });
});

describe("átomos", () => {
  it("MERGE pelo id determinístico — confirmar duas vezes não duplica", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T02:01:26.718Z");
    expect(cypherDe(0)).toContain("MERGE (at:Atomo { id: a.id })");
  });

  it("grava as âncoras como listas paralelas (migration 003)", async () => {
    await gravarAtomos("s1", [atomo({ inicios_s: [1, 40], fins_s: [3, 45], ancoras: ["exata", "aproximada"] })], "2026-08-31T00:00:00.000Z");
    const cypher = cypherDe(0);
    expect(cypher).toContain("at.inicios_s = a.inicios_s");
    expect(cypher).toContain("at.fins_s = a.fins_s");
    expect(cypher).toContain("at.ancoras = a.ancoras");
  });

  it("valido_em é a data da sessão, não a de agora", async () => {
    // É o eixo do "como eu estava em julho": vale quando eu falei.
    const iniciada = "2026-07-14T21:00:00.000Z";
    await gravarAtomos("s1", [atomo()], iniciada);
    expect(paramsDe(0).valido_em).toBe(iniciada);
    expect(paramsDe(0).agora).not.toBe(iniciada);
  });

  it("todo átomo nasce ativo, com procedência (regra 7)", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(paramsDe(0).status).toBe(STATUS_ATOMO_ATIVO);
    const cypher = cypherDe(0);
    expect(cypher).toContain("at.prompt_version = a.prompt_version");
    expect(cypher).toContain("at.modelo = a.modelo");
  });

  it("criado_em só no ON CREATE — reconfirmar não reescreve o nascimento", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(cypherDe(0)).toContain("ON CREATE SET at.criado_em = $agora");
  });

  it("liga :GEROU e :SOBRE numa consulta só", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    const cypher = cypherDe(0);
    expect(cypher).toContain("MERGE (s)-[:GEROU]->(at)");
    expect(cypher).toContain("MERGE (at)-[:SOBRE]->(alvo)");
  });

  it("o :SOBRE atravessa alias — átomo não fica pendurado em nó fundido", async () => {
    // A proposta pode ter sido montada antes de eu fundir duas entidades. A
    // trava é no servidor, não na tela: mesma razão pela qual o confirmar
    // recusa pronome de novo em vez de confiar na revisão.
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    const cypher = cypherDe(0);
    expect(cypher).toContain("OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)");
    expect(cypher).toContain("coalesce(v, e) AS alvo");
  });

  it("sem menção, não roda a consulta de menção", async () => {
    // UNWIND de lista vazia mataria a linha inteira, e átomo sem menção é o caso comum.
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(rodou(":MENCIONA")).toBe(false);
  });

  it("as menções vão achatadas, uma linha por par", async () => {
    await gravarAtomos(
      "s1",
      [atomo({ menciona: ["rafa", "phronesis"] }), atomo({ id: "s1-1", menciona: ["rafa"] })],
      "2026-08-31T00:00:00.000Z",
    );
    const i = indiceDe("MERGE (a)-[:MENCIONA]->(alvo)");
    expect(i).toBeGreaterThan(-1);
    // Depois de atravessar o alias, dois nomes distintos podem virar o mesmo
    // nó — e :SOBRE + :MENCIONA para a mesma entidade não é contrato válido.
    expect(cypherDe(i)).toContain("WHERE NOT (a)-[:SOBRE]->(alvo)");
    expect(paramsDe(i).mencoes).toEqual([
      { atomo_id: "s1-0", entidade: "rafa" },
      { atomo_id: "s1-0", entidade: "phronesis" },
      { atomo_id: "s1-1", entidade: "rafa" },
    ]);
  });

  it("nenhum átomo aprovado não fala com o banco", async () => {
    await gravarAtomos("s1", [], "2026-08-31T00:00:00.000Z");
    expect(consulta).not.toHaveBeenCalled();
  });

  it("a marca de perfil vira aresta com o campo dentro do MERGE", async () => {
    // O `campo` dentro do MERGE é o que faz reconfirmar não dobrar a aresta
    // (regra 4): o par (átomo, campo, entidade) é a identidade dela.
    await gravarAtomos(
      "s1",
      [atomo({ perfila: [{ entidade: "raffa", campo: "fizemos_juntos" }] })],
      "2026-08-31T00:00:00.000Z",
    );
    const i = indiceDe("MERGE (a)-[:PERFILA { campo: m.campo }]->(alvo)");
    expect(i).toBeGreaterThan(-1);
    expect(paramsDe(i).marcas).toEqual([
      { atomo_id: "s1-0", entidade: "raffa", campo: "fizemos_juntos" },
    ]);
  });

  it("a marca atravessa alias, como :SOBRE e :MENCIONA", async () => {
    await gravarAtomos(
      "s1",
      [atomo({ perfila: [{ entidade: "exx med", campo: "contexto" }] })],
      "2026-08-31T00:00:00.000Z",
    );
    expect(cypherDe(indiceDe(":PERFILA"))).toContain("coalesce(v, e) AS alvo");
  });

  it("sem marca nenhuma, não roda a consulta de perfil", async () => {
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(rodou(":PERFILA")).toBe(false);
  });

  it("campo fora do schema não vira aresta", async () => {
    // A migration 005 fecha a lista; deixar passar seria apodrecer o schema
    // pela porta dos fundos.
    await gravarAtomos(
      "s1",
      [atomo({ perfila: [{ entidade: "raffa", campo: "cor_favorita" as never }] })],
      "2026-08-31T00:00:00.000Z",
    );
    expect(rodou(":PERFILA")).toBe(false);
  });

  it("átomo rejeitado não é gravado — nem com status", async () => {
    // Regra 6: `rejeitado` é para tirar do grafo o que já entrou, não para
    // registrar o que nunca entrou. Quem filtra é a rota; aqui só chega aprovado.
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(JSON.stringify(paramsDe(0))).not.toContain("rejeitado");
  });
});

describe("o vetor do átomo (slice 4.5)", () => {
  it("o embedding vem DEPOIS da gravação — nunca antes", async () => {
    // A regra de precedência da slice inteira: nada no caminho do embedding
    // pode impedir uma gravação de acontecer.
    consulta.mockResolvedValue([{ id: "s1-0" }] as never);
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");

    const gravou = indiceDe("MERGE (at:Atomo { id: a.id })");
    const embutiu = indiceDe("SET a.embedding = v.embedding");
    expect(gravou).toBeGreaterThan(-1);
    expect(embutiu).toBeGreaterThan(gravou);
  });

  it("falha do Gateway NÃO derruba o confirmar (critério 9)", async () => {
    consulta.mockResolvedValue([{ id: "s1-0" }] as never);
    embutir.mockRejectedValue(new Error("gateway fora do ar"));

    // Não estoura: o átomo fica no grafo sem vetor, e a rota de retrofill o
    // alcança depois. Vetor é derivável; gravação não é.
    await expect(
      gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z"),
    ).resolves.toBeUndefined();
    expect(rodou("MERGE (at:Atomo { id: a.id })")).toBe(true);
  });

  it("átomo que já tem vetor não é reembutido (critério 7)", async () => {
    // A sondagem não devolveu o id: já está em dia. Reconfirmar não pode pagar
    // o Gateway de novo.
    consulta.mockResolvedValue([] as never);
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(embutir).not.toHaveBeenCalled();
    expect(rodou("SET a.embedding = v.embedding")).toBe(false);
  });

  it("o modelo vai gravado junto do vetor", async () => {
    // Vetores de dois modelos no mesmo índice não dão erro: dão vizinhança
    // errada. Sem o campo não há como saber quem refazer.
    consulta.mockResolvedValue([{ id: "s1-0" }] as never);
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");

    const i = indiceDe("SET a.embedding = v.embedding");
    expect(cypherDe(i)).toContain("a.embedding_modelo = v.modelo");
    expect(paramsDe(i).vetores).toEqual([
      { id: "s1-0", embedding: [0.1, 0.2], modelo: "provedor/embed-teste" },
    ]);
  });

  it("só o texto vira vetor — nada de tipo, entidade ou sessão", async () => {
    // O corte estrutural é do grafo, o semântico é do vetor. Enfiar o tipo no
    // texto embutido faria dois APRENDIZADO parecerem próximos por serem
    // APRENDIZADO, que é o sinal que o grafo já dá de graça e melhor.
    consulta.mockResolvedValue([{ id: "s1-0" }] as never);
    await gravarAtomos("s1", [atomo()], "2026-08-31T00:00:00.000Z");
    expect(embutir).toHaveBeenCalledWith(["O contrato da Exxmed vai atrasar"]);
  });
});
