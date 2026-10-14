/**
 * A Cypher que o modelo escreve: a trava, a limpeza e o corte (slice 12).
 *
 * Sem rede: o `fetch` falso responde o `EXPLAIN` com o `queryType` que o caso
 * pede — o mesmo que a instância devolveu para cada forma de escrita — e a
 * execução com as linhas que o caso monta. O que se prende aqui é o que nenhum
 * modelo pode desfazer: escrita recusada **antes** de executar, vetor fora da
 * saída, corte que diz quanto cortou.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSA_OMITIDA,
  LISTA_DE_NUMEROS_MAX,
  NADA_ACHADO,
  TEMPO_MAXIMO_S,
  TETO_CARACTERES,
  TETO_LINHAS,
  bloqueio,
  consultar,
  limpar,
} from "@/lib/consulta";
import { query } from "@/lib/neo4j";

interface Pedido {
  statement: string;
  parameters: Record<string, unknown>;
  accessMode?: string;
  maxExecutionTime?: number;
}

const originalFetch = globalThis.fetch;
let pedidos: Pedido[];
/** O que o banco diz de cada consulta: a classificação e a resposta da execução. */
let banco: {
  queryType?: string;
  explainErro?: { code: string; message: string };
  execucao?: Record<string, unknown>;
};

const execucoes = () => pedidos.filter((p) => !p.statement.startsWith("EXPLAIN "));
const resposta = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 202 });

beforeEach(() => {
  process.env.NEO4J_QUERY_URL = "https://banco.teste/db/neo4j/query/v2";
  process.env.NEO4J_USER = "neo4j";
  process.env.NEO4J_PASSWORD = "senha";
  pedidos = [];
  banco = { queryType: "r", execucao: { data: { fields: ["n"], values: [[1]] }, queryType: "r" } };

  globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const pedido = JSON.parse(String(init?.body)) as Pedido;
    pedidos.push(pedido);
    if (pedido.statement.startsWith("EXPLAIN ")) {
      if (banco.explainErro) {
        return new Response(JSON.stringify({ errors: [banco.explainErro] }), { status: 400 });
      }
      return resposta({ data: { fields: [], values: [] }, queryType: banco.queryType });
    }
    return resposta(banco.execucao);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Linhas de execução com uma coluna só. */
const comLinhas = (fields: string[], values: unknown[][], extra: Record<string, unknown> = {}) => {
  banco.execucao = { data: { fields, values }, queryType: "r", ...extra };
};

describe("a escrita é recusada antes de executar", () => {
  // A classificação que a instância deu a cada forma, no EXPLAIN.
  it.each([
    ["CREATE (x:Teste) RETURN x", "rw"],
    ["MERGE (x:Teste {id: 1})", "w"],
    ["MATCH (a:Atomo) SET a.x = 1", "w"],
    ["MATCH (a:Atomo) DETACH DELETE a", "w"],
    ["MATCH (a:Atomo) REMOVE a.x", "w"],
    ["CREATE INDEX x IF NOT EXISTS FOR (n:Teste) ON (n.x)", "s"],
  ])("%s (%s)", async (cypher, tipo) => {
    banco.queryType = tipo;
    const r = await consultar(cypher);
    expect(r.erro).toMatch(new RegExp(`classificou a consulta como '${tipo}'`));
    expect(r.texto).toContain("nada foi executado");
    expect(pedidos).toHaveLength(1);
    expect(execucoes()).toEqual([]);
  });

  it("sem classificação nenhuma, também não executa", async () => {
    banco.queryType = undefined;
    const r = await consultar("MATCH (a:Atomo) RETURN a.id");
    expect(r.erro).toMatch(/classificou a consulta como '\?'/);
    expect(execucoes()).toEqual([]);
  });

  it("CALL de procedure de escrita não chega nem ao EXPLAIN", async () => {
    const r = await consultar("CALL db.createLabel('Teste')");
    expect(r.erro).toMatch(/CALL de procedure/);
    expect(pedidos).toEqual([]);
  });

  it("o EXPLAIN e a execução vão em Read, e a execução com o tempo máximo", async () => {
    await consultar("MATCH (a:Atomo) RETURN count(a) AS n");
    expect(pedidos.map((p) => p.statement)).toEqual([
      "EXPLAIN MATCH (a:Atomo) RETURN count(a) AS n",
      "MATCH (a:Atomo) RETURN count(a) AS n",
    ]);
    expect(pedidos.map((p) => p.accessMode)).toEqual(["Read", "Read"]);
    expect(pedidos[1].maxExecutionTime).toBe(TEMPO_MAXIMO_S);
  });

  it("a escrita que passasse do EXPLAIN o banco recusa na execução, e volta como texto", async () => {
    banco.execucao = {
      errors: [
        {
          code: "Neo.ClientError.Statement.AccessMode",
          message: "Writing in read access mode not allowed.",
        },
      ],
    };
    const r = await consultar("MATCH (a:Atomo) RETURN a.id");
    expect(r.erro).toBe("o banco recusou: a consulta tenta escrever, e esta ferramenta só lê");
  });

  it("query() continua sem accessMode — as escritas de hoje dependem disso", async () => {
    await query("MATCH (a:Atomo) RETURN a.id AS id");
    expect(pedidos[0]).toEqual({ statement: "MATCH (a:Atomo) RETURN a.id AS id", parameters: {} });
  });
});

describe("os bloqueios no texto não vão ao banco", () => {
  it.each([
    ["LOAD CSV FROM 'https://x.com/a.csv' AS l RETURN l", /LOAD CSV/],
    ["load csv with headers from 'file:///a' as l return l", /LOAD CSV/],
    ["MATCH (c:Conversa) RETURN c.titulo", /:Conversa/],
    ["MATCH (c:`Conversa`) RETURN c", /:Conversa/],
    ["MATCH (n) WHERE 'Conversa' IN labels(n) RETURN n", /:Conversa/],
    ["MATCH (n:$('Conversa')) RETURN n", /:Conversa/],
    ["USE outro MATCH (n) RETURN n", /USE/],
    ["CALL { USE outro MATCH (n) RETURN n } RETURN 1", /USE/],
    ["EXPLAIN MATCH (n) RETURN n", /EXPLAIN nem PROFILE/],
    ["// comentário\nPROFILE MATCH (n) RETURN n", /EXPLAIN nem PROFILE/],
    ["CALL db.labels() YIELD label RETURN label", /CALL de procedure/],
    ["MATCH (a) CALL apoc.create.node(['X'], {}) YIELD node RETURN node", /CALL de procedure/],
    ["TERMINATE TRANSACTIONS 'neo4j-transaction-1'", /TERMINATE/],
    ["   ", /vazia/],
  ])("%s", async (cypher, motivo) => {
    const r = await consultar(cypher);
    expect(r.erro).toMatch(motivo);
    expect(pedidos).toEqual([]);
  });

  it.each([
    ["'use' dentro de um literal", "MATCH (a:Atomo) WHERE a.texto CONTAINS 'use isto' RETURN a.id"],
    ["USE num comentário", "MATCH (a:Atomo) // USE outro\nRETURN a.id"],
    ["'conversa' minúscula, como se busca no texto", "MATCH (a:Atomo) WHERE toLower(a.texto) CONTAINS 'conversa' RETURN a.id"],
    ["CALL { de subquery", "MATCH (a:Atomo) CALL { RETURN 1 AS um } RETURN a.id, um"],
    ["CALL (x) { de subquery", "MATCH (a:Atomo) CALL (a) { RETURN a.id AS i } RETURN i"],
    ["OPTIONAL CALL de subquery", "MATCH (a:Atomo) OPTIONAL CALL (a) { RETURN 1 AS um } RETURN um"],
    ["a cláusula SEARCH", "MATCH (a:Atomo) SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 5) SCORE AS s RETURN a.id"],
    ["SHOW INDEXES", "SHOW INDEXES"],
  ])("%s passa", (_, cypher) => {
    expect(bloqueio(cypher)).toBeNull();
  });

  it("o ; do fim sai antes de ir ao banco", async () => {
    await consultar("MATCH (a:Atomo) RETURN count(a) AS n;\n");
    expect(execucoes()[0].statement).toBe("MATCH (a:Atomo) RETURN count(a) AS n");
  });
});

describe("parâmetros", () => {
  it("$vetor sem texto volta como texto, sem ir ao banco", async () => {
    const r = await consultar(
      "MATCH (a:Atomo) SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 5) SCORE AS s RETURN a.id",
      { hoje: "2026-10-13" },
    );
    expect(r.erro).toMatch(/\$vetor só existe quando a chamada traz `texto`/);
    expect(pedidos).toEqual([]);
  });

  it("o parâmetro inventado diz quais existem", async () => {
    const r = await consultar("MATCH (a:Atomo) WHERE a.valido_em > $desde RETURN a.id", {
      hoje: "2026-10-13",
    });
    expect(r.erro).toMatch(/\$desde não existe — os desta consulta são \$hoje/);
    expect(pedidos).toEqual([]);
  });

  it("os parâmetros vão iguais ao EXPLAIN e à execução", async () => {
    await consultar("RETURN date($hoje) AS d", { hoje: "2026-10-13" });
    expect(pedidos.map((p) => p.parameters)).toEqual([{ hoje: "2026-10-13" }, { hoje: "2026-10-13" }]);
  });

  it("'$vetor' dentro de um literal não conta como uso", async () => {
    const r = await consultar("RETURN '$vetor' AS x", {});
    expect(r.erro).toBeUndefined();
  });
});

describe("a saída nunca leva vetor", () => {
  const vetor = Array.from({ length: 1536 }, (_, i) => i / 1536);

  it("nem como propriedade de nó, nem de relação, nem aninhado", async () => {
    comLinhas(
      ["a", "r", "m"],
      [
        [
          {
            elementId: "4:x:1",
            labels: ["Atomo"],
            properties: { id: "a1", texto: "um trecho", embedding: vetor },
          },
          {
            elementId: "5:x:2",
            startNodeElementId: "4:x:1",
            endNodeElementId: "4:x:3",
            type: "ATUALIZA",
            properties: { camada: "sutil" },
          },
          { fundo: [{ embedding_modelo: "m", v: vetor }] },
        ],
      ],
    );
    const r = await consultar("MATCH (a:Atomo)-[r]->(b) RETURN a, r, {fundo: [b]} AS m");
    expect(r.texto).not.toMatch(/embedding/);
    expect(r.texto).not.toContain(String(vetor[7]));
    expect(r.texto).not.toContain("elementId");
    expect(JSON.stringify(r.linhas)).not.toMatch(/embedding|elementId/);
    expect(r.linhas[0][0]).toEqual({ _labels: ["Atomo"], id: "a1", texto: "um trecho" });
    expect(r.linhas[0][1]).toEqual({ _tipo: "ATUALIZA", camada: "sutil" });
    expect(r.linhas[0][2]).toEqual({ fundo: [{ v: "[lista de 1536 números, omitida]" }] });
  });

  it("lista de número curta fica — é contagem, não vetor", () => {
    const curta = Array.from({ length: LISTA_DE_NUMEROS_MAX }, (_, i) => i);
    expect(limpar(curta)).toEqual(curta);
    expect(limpar([...curta, 99])).toBe(`[lista de ${LISTA_DE_NUMEROS_MAX + 1} números, omitida]`);
  });

  it("nó de :Conversa que chegou sem o label escrito vira marca", () => {
    const conversa = { elementId: "4:x:9", labels: ["Conversa"], properties: { titulo: "t" } };
    expect(limpar([conversa])).toEqual([CONVERSA_OMITIDA]);
  });
});

describe("o corte diz quanto cortou e manda agregar", () => {
  it("por linhas", async () => {
    comLinhas(["n"], Array.from({ length: 412 }, (_, i) => [i]));
    const r = await consultar("UNWIND range(1, 412) AS n RETURN n");
    expect(r.cortado).toBe(true);
    expect(r.total).toBe(412);
    expect(r.linhas).toHaveLength(TETO_LINHAS);
    expect(r.texto.split("\n")[0]).toBe(
      `cortado em ${TETO_LINHAS} de 412 linhas — agregue, filtre ou projete menos.`,
    );
  });

  it("por caracteres", async () => {
    const longo = "x".repeat(1000);
    comLinhas(["t"], Array.from({ length: 30 }, () => [longo]));
    const r = await consultar("MATCH (a:Atomo) RETURN a.texto AS t");
    expect(r.cortado).toBe(true);
    expect(r.linhas.length).toBeLessThan(TETO_CARACTERES / 1000);
    expect(r.texto).toMatch(new RegExp(`^cortado em ${r.linhas.length} de 30 linhas — agregue`));
    // A tabela que vai ao modelo respeita o teto; a linha de topo vem por cima.
    const tabela = r.texto.split("\n").slice(1).join("\n");
    expect(tabela.length).toBeLessThanOrEqual(TETO_CARACTERES);
  });

  it("a primeira linha vai sempre, cortada se sozinha passar do teto", async () => {
    comLinhas(["tudo"], [["y".repeat(TETO_CARACTERES * 2)], ["z"]]);
    const r = await consultar("MATCH (a:Atomo) RETURN collect(a.texto) AS tudo");
    expect(r.cortado).toBe(true);
    expect(r.linhas).toHaveLength(1);
    expect(r.texto).toContain("…[linha cortada]");
    expect(r.texto.split("\n").slice(1).join("\n").length).toBeLessThanOrEqual(TETO_CARACTERES + 20);
  });

  it("sem corte, diz quantas e mostra a tabela", async () => {
    comLinhas(["pessoa", "afetivos"], [["Mãe", 12], ["Isinha\nSilva", 3]]);
    const r = await consultar("MATCH (p:Pessoa) RETURN p.nome AS pessoa, 1 AS afetivos");
    expect(r.cortado).toBe(false);
    expect(r.texto).toBe("2 linhas.\npessoa | afetivos\nMãe | 12\nIsinha Silva | 3");
  });
});

describe("o vazio e os avisos", () => {
  it("zero linhas é dito, com as causas", async () => {
    comLinhas(["id"], []);
    const r = await consultar("MATCH (a:Atomo {tipo: 'MEDO'}) RETURN a.id AS id");
    expect(r.total).toBe(0);
    expect(r.erro).toBeUndefined();
    expect(r.texto).toBe(NADA_ACHADO);
  });

  it("o aviso do banco vai no texto, com o nome que faltou", async () => {
    comLinhas(["x"], [], {
      notifications: [
        {
          code: "Neo.ClientNotification.Statement.UnknownLabelWarning",
          title: "The provided label is not in the database.",
          description:
            "One of the labels in your query is not available in the database (the missing label name is: Medo)",
          severity: "WARNING",
          category: "UNRECOGNIZED",
        },
      ],
    });
    const r = await consultar("MATCH (m:Medo) RETURN m.nome AS x");
    expect(r.avisos).toEqual(["The provided label is not in the database. (the missing label name is: Medo)"]);
    expect(r.texto.split("\n")).toEqual([
      NADA_ACHADO,
      "aviso do banco: The provided label is not in the database. (the missing label name is: Medo)",
    ]);
  });
});

describe("o erro do banco volta como texto", () => {
  it("sintaxe, no EXPLAIN, sem executar", async () => {
    banco.explainErro = {
      code: "Neo.ClientError.Statement.SyntaxError",
      message: "Invalid input 'RETURN': expected ')' (line 1, column 24 (offset: 23))",
    };
    const r = await consultar("MATCH (a:Atomo RETURN a");
    expect(r.erro).toMatch(/^erro de sintaxe — Invalid input 'RETURN'/);
    expect(execucoes()).toEqual([]);
  });

  it("o tempo estourado — chega como Transaction.Terminated", async () => {
    banco.execucao = {
      errors: [
        {
          code: "Neo.ClientError.Transaction.Terminated",
          message: "The transaction has been terminated. Explicitly terminated by the user.",
        },
      ],
    };
    const r = await consultar("UNWIND range(1, 200000000) AS x RETURN count(x)");
    expect(r.erro).toBe(
      `a consulta passou de ${TEMPO_MAXIMO_S} s e foi interrompida — restrinja (um LIMIT, um recorte de tempo) ou agregue no banco`,
    );
  });

  it("a falha de rede sobe — não é culpa da consulta", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(consultar("RETURN 1")).rejects.toThrow("fetch failed");
  });
});
