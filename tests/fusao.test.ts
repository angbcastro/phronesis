/**
 * Fundir, renomear, recusar.
 *
 * O que precisa estar visível num teste é que **nada é apagado** (regra 6) e
 * que a grafia morta vira alias — é isso que faz a fusão valer para a sessão de
 * amanhã, e não só arrumar o passado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));

import { query } from "@/lib/neo4j";
import {
  chaveDoPar,
  criarEntidade,
  fundir,
  FusaoError,
  marcarDistintas,
  renomear,
  STATUS_ENTIDADE_FUNDIDA,
  trocarTipo,
} from "@/lib/fusao";

const consulta = vi.mocked(query);
const todoCypher = () => consulta.mock.calls.map((c) => String(c[0])).join("\n---\n");

/** As duas existem, e nenhuma delas foi fundida em outra coisa. */
function grafoComAsDuas() {
  consulta.mockImplementation(async (statement: string) => {
    if (statement.includes("jaFundida")) {
      return [
        { v: "id-v", p: "id-p", jaFundida: false, vencedoraFundida: false },
      ] as never;
    }
    if (statement.includes("count(DISTINCT a) AS n")) return [{ n: 2 }] as never;
    if (statement.includes("count(r) AS n")) return [{ n: 1 }] as never;
    return [] as never;
  });
}

beforeEach(() => {
  consulta.mockReset();
  consulta.mockResolvedValue([]);
});

describe("fundir", () => {
  it("não apaga a perdedora: marca status e cria a aresta de alias", async () => {
    grafoComAsDuas();
    await fundir("Exxmed", "Exx Med");

    const cypher = todoCypher();
    expect(cypher).toContain("MERGE (p)-[:FUNDIDA_EM]->(v)");
    expect(cypher).toContain("SET p.status = $fundida");
    // Regra 6: nada de DELETE em nó. As arestas migradas, sim, essas somem.
    expect(cypher).not.toMatch(/DELETE\s+p\b/);
    expect(cypher).not.toMatch(/DETACH DELETE/);
  });

  it("migra :SOBRE e :MENCIONA com MERGE no destino", async () => {
    grafoComAsDuas();
    const r = await fundir("Exxmed", "Exx Med");

    const cypher = todoCypher();
    expect(cypher).toContain("MERGE (a)-[:SOBRE]->(v)");
    expect(cypher).toContain("MERGE (a)-[:MENCIONA]->(v)");
    expect(r.arestas_migradas).toBe(5); // 2 por tipo + 1 :PERFILA, no mock
  });

  /**
   * A marca de perfil é a terceira aresta que aponta para entidade, e a única
   * com propriedade. Deixá-la para trás não dá erro: o perfil do vencedor
   * simplesmente para de ver os átomos que estavam no alias, porque
   * `atomosMarcados` atravessa do alias para o vencedor e não o contrário.
   * Fusão não tem desfazer, então o teste é aqui.
   */
  it("migra :PERFILA junto, preservando o campo", async () => {
    grafoComAsDuas();
    await fundir("Raffa", "Rapha");

    const cypher = todoCypher();
    expect(cypher).toContain("MATCH (a:Atomo)-[r:PERFILA]->(p)");
    // O `campo` viaja: sem ele a aresta migrada não diria de que campo é.
    expect(cypher).toContain("MERGE (a)-[:PERFILA { campo: campo }]->(v)");
  });

  it("as três arestas de entidade migram, e nenhuma outra", async () => {
    grafoComAsDuas();
    await fundir("Exxmed", "Exx Med");

    const migradas = [...todoCypher().matchAll(/MERGE \(a\)-\[:(\w+)/g)].map((m) => m[1]);
    expect(new Set(migradas)).toEqual(new Set(["SOBRE", "MENCIONA", "PERFILA"]));
  });

  it("normaliza os dois lados — a chave é que casa, não a grafia", async () => {
    grafoComAsDuas();
    const r = await fundir("  Exxmed  ", "EXX MED");
    expect(r.vencedora).toBe("exxmed");
    expect(r.perdedora).toBe("exx med");
  });

  it("fundir de novo não refaz nada", async () => {
    consulta.mockImplementation(async (statement: string) => {
      if (statement.includes("jaFundida")) {
        return [
          { v: "id-v", p: "id-p", jaFundida: true, vencedoraFundida: false },
        ] as never;
      }
      return [] as never;
    });

    const r = await fundir("Exxmed", "Exx Med");
    expect(r.arestas_migradas).toBe(0);
    expect(todoCypher()).not.toContain("MERGE (a)-[:SOBRE]->(v)");
  });

  /**
   * A cadeia (slice 4.8.1). As dez travessias de `:FUNDIDA_EM` do projeto são de
   * um salto, e o conserto fica no lado da escrita: fusão é rara e é escrita,
   * leitura é quente. Sem esta consulta, `rapha2 → rapha` seguido de
   * `rapha → raphael` deixa `rapha2` pendurada num nó fundido — a chave some do
   * catálogo, e o átomo dito com aquela grafia vai parar num nó que nenhuma
   * listagem mostra.
   */
  it("fundir o vencedor leva os aliases dele junto", async () => {
    grafoComAsDuas();
    await fundir("Raphael", "Rapha");

    const cypher = todoCypher();
    expect(cypher).toContain("MATCH (x:Entidade)-[r:FUNDIDA_EM]->(p:Entidade");
    expect(cypher).toContain("MERGE (x)-[:FUNDIDA_EM]->(v)");
  });

  it("a reposição acontece ANTES de a perdedora virar alias", async () => {
    // Depois seria tarde de um jeito específico: o `MATCH` de reposição casaria
    // a própria perdedora, que acabou de ganhar sua aresta para o vencedor.
    grafoComAsDuas();
    await fundir("Raphael", "Rapha");

    const consultas = consulta.mock.calls.map((c) => String(c[0]));
    const reposicao = consultas.findIndex((q) => q.includes("MERGE (x)-[:FUNDIDA_EM]->(v)"));
    const marcacao = consultas.findIndex((q) => q.includes("SET p.status = $fundida"));
    expect(reposicao).toBeGreaterThanOrEqual(0);
    expect(reposicao).toBeLessThan(marcacao);
  });

  it("refazer a cadeia não duplica aresta nem perde alias", async () => {
    // `MERGE` + `DELETE`, como o resto da fusão: ela não é atômica (§14), e o
    // contrato é que refazer cura.
    grafoComAsDuas();
    await fundir("Raphael", "Rapha");

    const reposicao = consulta.mock.calls
      .map((c) => String(c[0]))
      .find((q) => q.includes("MERGE (x)-[:FUNDIDA_EM]->(v)"))!;
    expect(reposicao).toContain("MERGE");
    expect(reposicao).toContain("DELETE r");
    expect(reposicao).not.toContain("CREATE");
  });

  it("recusa fundir PARA DENTRO de uma grafia já fundida", async () => {
    // Corrompe do mesmo jeito que a cadeia, e até a 4.8 só a perdedora era
    // conferida.
    consulta.mockImplementation(async (statement: string) =>
      statement.includes("jaFundida")
        ? ([{ v: "id-v", p: "id-p", jaFundida: false, vencedoraFundida: true }] as never)
        : ([] as never),
    );

    await expect(fundir("Rapha", "Rapha2")).rejects.toThrow(/já é uma grafia fundida/);
    expect(todoCypher()).not.toContain("SET p.status = $fundida");
  });

  it("recusa fundir uma entidade nela mesma", async () => {
    await expect(fundir("Exxmed", "exxmed")).rejects.toThrow(FusaoError);
  });

  it("recusa quando um dos lados não está no grafo", async () => {
    consulta.mockImplementation(async (statement: string) =>
      statement.includes("jaFundida")
        ? ([{ v: "id-v", p: null, jaFundida: false, vencedoraFundida: false }] as never)
        : ([] as never),
    );
    await expect(fundir("Exxmed", "Fantasma")).rejects.toThrow(/não está no grafo/);
  });
});

describe("renomear", () => {
  it("a grafia velha vira alias do nome novo", async () => {
    await renomear("meu pai", "Antônio");

    const cypher = todoCypher();
    expect(cypher).toContain("SET e.nome = $novo, e.nome_normalizado = $chaveNova");
    expect(cypher).toContain("MERGE (alias)-[:FUNDIDA_EM]->(e)");
    // O alias nasce já fundido: ele nunca deve aparecer como entidade viva.
    const params = consulta.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(params.fundida).toBe(STATUS_ENTIDADE_FUNDIDA);
  });

  it("mudar só a caixa não cria alias — a chave é a mesma", async () => {
    await renomear("isinha", "Isinha");
    const cypher = todoCypher();
    expect(cypher).toContain("SET e.nome = $novo");
    expect(cypher).not.toContain("FUNDIDA_EM");
  });

  it("recusa nome que já é de outra entidade — isso é fusão, não renome", async () => {
    consulta.mockImplementation(async (statement: string) =>
      statement.includes("RETURN e.id AS id") ? ([{ id: "outro" }] as never) : ([] as never),
    );
    await expect(renomear("meu pai", "Isinha")).rejects.toThrow(/funda as duas/);
  });

  it("recusa nome vazio", async () => {
    await expect(renomear("meu pai", "   ")).rejects.toThrow(FusaoError);
  });
});

describe("recusar um par", () => {
  it("grava a aresta que impede a pergunta de voltar", async () => {
    await marcarDistintas("Marina", "Mariana");
    expect(todoCypher()).toContain("MERGE (x)-[:DISTINTA_DE]->(y)");
  });

  it("recusa marcar uma entidade como distinta dela mesma", async () => {
    await expect(marcarDistintas("Marina", "marina")).rejects.toThrow(FusaoError);
  });
});

describe("chave do par", () => {
  it("não depende da ordem — senão a recusa só valeria num sentido", () => {
    expect(chaveDoPar("a", "b")).toBe(chaveDoPar("b", "a"));
  });
});

describe("trocar o tipo", () => {
  it("põe o label novo e tira os outros, sem tocar em :Entidade", async () => {
    // :Entidade carrega a constraint de nome_normalizado e é por ele que toda
    // leitura encontra o nó — removê-lo sumiria com a entidade.
    consulta.mockResolvedValue([{ id: "id-1" }] as never);
    await trocarTipo("rodozanco", "Projeto");

    const cypher = todoCypher();
    expect(cypher).toContain("SET e:Projeto");
    expect(cypher).toContain("REMOVE e:Pessoa, e:Objetivo");
    expect(cypher).not.toMatch(/REMOVE[^\n]*e:Entidade/);
  });

  it("entidade que não existe estoura em vez de virar no-op silencioso", async () => {
    consulta.mockResolvedValue([] as never);
    await expect(trocarTipo("fantasma", "Pessoa")).rejects.toThrow(/não está no grafo/);
  });

  it("recusa tipo fora da constante fechada — é label literal no Cypher", async () => {
    await expect(trocarTipo("isinha", "Fantasma" as never)).rejects.toThrow(/Tipo inválido/);
  });
});

describe("criar entidade à mão", () => {
  it("nasce ativa, com o label do tipo escolhido", async () => {
    consulta.mockResolvedValue([] as never);
    const r = await criarEntidade("Rodozanco", "Projeto");

    expect(r.nome).toBe("Rodozanco");
    expect(todoCypher()).toContain("CREATE (e:Entidade:Projeto");
    const params = consulta.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(params.chave).toBe("rodozanco");
    expect(params.ativa).toBe("ativa");
  });

  it("recusa nome que já está no grafo", async () => {
    consulta.mockResolvedValue([{ nome: "Isinha", fundida: false }] as never);
    await expect(criarEntidade("isinha", "Pessoa")).rejects.toThrow(/já está no grafo/);
  });

  it("recusa nome que é grafia já fundida, e diz em quem", async () => {
    // Sem isso o erro seria a violação de constraint, que não explica nada.
    consulta.mockResolvedValue([{ nome: "Exxmed", fundida: true }] as never);
    await expect(criarEntidade("Exx Med", "Projeto")).rejects.toThrow(/grafia de "Exxmed"/);
  });

  it("recusa pronome, como o confirmar", async () => {
    await expect(criarEntidade("ela", "Pessoa")).rejects.toThrow(/pronome/);
  });

  it("recusa nome vazio", async () => {
    await expect(criarEntidade("   ", "Pessoa")).rejects.toThrow(FusaoError);
  });
});

describe("o nome que o alias guarda", () => {
  it("vem do nó, não do argumento — a tela passa a chave normalizada", async () => {
    // Passando a chave crua como nome do alias, a lista mostrava
    // "zztestefusao" onde devia estar "ZZTesteFusao". Peguei isso rodando o
    // fluxo de verdade contra o Aura, não nos testes.
    await renomear("meu pai", "Antônio");
    const cypher = todoCypher();
    expect(cypher).toContain("WITH e, e.nome AS nomeVelho");
    expect(cypher).toContain("nome: nomeVelho");
    // O nome velho não pode mais viajar como parâmetro.
    const params = consulta.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(params.nomeVelho).toBeUndefined();
  });
});
