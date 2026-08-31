import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIPO_PADRAO,
  coletar,
  normalizarNome,
  normalizarTipoEntidade,
  resolver,
  tipoDosLabels,
} from "@/lib/entidades";
import type { AtomoCru } from "@/lib/tipos";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));
import { query } from "@/lib/neo4j";

const consulta = vi.mocked(query);

const atomo = (sobre: string, menciona: string[] = []): AtomoCru => ({
  texto: "t",
  tipo: "FATO",
  sobre,
  menciona,
  trechos: ["t"],
});

afterEach(() => {
  consulta.mockReset();
  consulta.mockResolvedValue([]);
});

describe("nome normalizado", () => {
  it("é a chave que faz a segunda sessão achar o nó da primeira", () => {
    expect(normalizarNome("Rodozanco")).toBe("rodozanco");
    expect(normalizarNome("  RODOZANCO, ")).toBe("rodozanco");
    expect(normalizarNome("José da Silva")).toBe("jose da silva");
  });

  it("colapsa o espaço que a pontuação deixa para trás", () => {
    expect(normalizarNome("Exx-Med")).toBe("exx med");
  });

  it("nome sem letra nenhuma vira string vazia, não entidade fantasma", () => {
    expect(normalizarNome("…")).toBe("");
  });
});

describe("tipo da entidade", () => {
  it("aceita o que o extrator manda, em qualquer caixa", () => {
    expect(normalizarTipoEntidade("PESSOA")).toBe("Pessoa");
    expect(normalizarTipoEntidade("projeto")).toBe("Projeto");
    expect(normalizarTipoEntidade("Objetivo")).toBe("Objetivo");
  });

  it("recusa o que não é label do schema", () => {
    expect(normalizarTipoEntidade("EMPRESA")).toBeNull();
    expect(normalizarTipoEntidade(42)).toBeNull();
  });

  it("lê o tipo dos labels do nó, ignorando :Entidade", () => {
    expect(tipoDosLabels(["Entidade", "Projeto"])).toBe("Projeto");
    expect(tipoDosLabels(["Entidade"])).toBe(TIPO_PADRAO);
  });
});

describe("coleta", () => {
  it("conta sujeito e menção, sem duplicar a mesma entidade", () => {
    const c = coletar([atomo("Rodozanco", ["Exxmed"]), atomo("Exxmed")]);
    expect(c.map((e) => [e.nome_normalizado, e.ocorrencias])).toEqual([
      ["rodozanco", 1],
      ["exxmed", 2],
    ]);
  });

  it("variações de grafia são a mesma entidade; a primeira vira o nome", () => {
    const c = coletar([atomo("Rodozanco"), atomo("RODOZANCO,")]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ nome: "Rodozanco", ocorrencias: 2 });
  });

  it('"eu" é entidade como qualquer outra', () => {
    const [e] = coletar([atomo("eu")], [{ nome: "eu", tipo: "PESSOA" }]);
    expect(e).toMatchObject({ nome: "eu", nome_normalizado: "eu", tipo: "Pessoa" });
  });

  it("usa o tipo que o extrator propôs", () => {
    const [e] = coletar([atomo("Phronesis")], [{ nome: "Phronesis", tipo: "PROJETO" }]);
    expect(e.tipo).toBe("Projeto");
  });

  it("sem proposta, ou com proposta inválida, cai no padrão", () => {
    expect(coletar([atomo("Rodozanco")])[0].tipo).toBe(TIPO_PADRAO);
    expect(coletar([atomo("X")], [{ nome: "X", tipo: "EMPRESA" }])[0].tipo).toBe(TIPO_PADRAO);
  });

  it("entidade que o modelo listou e nenhum átomo cita não entra", () => {
    // Seria nó órfão no grafo: ninguém aponta para ela.
    expect(coletar([atomo("Rodozanco")], [{ nome: "Ninguém", tipo: "PESSOA" }])).toHaveLength(1);
  });

  it("sujeito vazio não vira entidade", () => {
    expect(coletar([atomo("  ")])).toEqual([]);
  });
});

describe("resolução contra o grafo", () => {
  it("uma consulta só para a sessão inteira", async () => {
    await resolver(coletar([atomo("Rodozanco", ["Exxmed"]), atomo("Phronesis")]));
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(consulta.mock.calls[0][1]).toEqual({
      chaves: ["rodozanco", "exxmed", "phronesis"],
    });
  });

  it("sem entidade nenhuma, não vai ao banco", async () => {
    expect(await resolver([])).toEqual([]);
    expect(consulta).not.toHaveBeenCalled();
  });

  it("entidade já no grafo volta conhecida, com o id do nó", async () => {
    consulta.mockResolvedValue([
      {
        id: "e1",
        nome: "Rodozanco",
        nome_normalizado: "rodozanco",
        labels: ["Entidade", "Pessoa"],
        sessoes: 3,
      },
    ]);
    const [e] = await resolver(coletar([atomo("rodozanco,")]));
    expect(e).toMatchObject({ conhecida: true, id: "e1", nome: "Rodozanco", tipo: "Pessoa" });
  });

  it("traz em quantas sessões a entidade já apareceu", async () => {
    // É o que a revisão mostra para eu decidir se ela vira nó:
    // "conhecida (3 sessões)" contra "nova, citada 1x".
    consulta.mockResolvedValue([
      {
        id: "e1",
        nome: "Rodozanco",
        nome_normalizado: "rodozanco",
        labels: ["Entidade", "Pessoa"],
        sessoes: 3,
      },
    ]);
    const [conhecida] = await resolver(coletar([atomo("Rodozanco")]));
    expect(conhecida.sessoes).toBe(3);

    consulta.mockResolvedValue([]);
    const [nova] = await resolver(coletar([atomo("Alguém Novo")]));
    expect(nova).toMatchObject({ conhecida: false, sessoes: 0, ocorrencias: 1 });
  });

  it("conta sessões distintas, não átomos", async () => {
    const cypher = String(
      (await resolver(coletar([atomo("Rodozanco")])), consulta.mock.calls[0][0]),
    );
    expect(cypher).toContain("count(DISTINCT s)");
    expect(cypher).toContain("OPTIONAL MATCH");
  });

  it("o que está no grafo vence o que o extrator propôs", async () => {
    // Mudar o tipo de uma entidade existente é edição na revisão, não efeito
    // colateral de uma extração.
    consulta.mockResolvedValue([
      {
        id: "e2",
        nome: "Exxmed",
        nome_normalizado: "exxmed",
        labels: ["Entidade", "Projeto"],
        sessoes: 7,
      },
    ]);
    const [e] = await resolver(coletar([atomo("Exxmed")], [{ nome: "Exxmed", tipo: "PESSOA" }]));
    expect(e.tipo).toBe("Projeto");
  });

  it("entidade nova volta sem id — quem cria é o confirmar", async () => {
    const [e] = await resolver(coletar([atomo("Alguém Novo")]));
    expect(e).toMatchObject({ conhecida: false, id: null, tipo: TIPO_PADRAO });
  });

  it("preserva a contagem de ocorrências ao resolver", async () => {
    const [e] = await resolver(coletar([atomo("Exxmed"), atomo("X", ["Exxmed"])]));
    expect(e.ocorrencias).toBe(2);
  });

  it("nada é escrito no grafo — a resolução só lê (regra 5)", async () => {
    await resolver(coletar([atomo("Rodozanco")]));
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("MATCH");
    expect(cypher).not.toMatch(/CREATE|MERGE|SET|DELETE/);
  });
});
