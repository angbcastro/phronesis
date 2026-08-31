/**
 * A leitura de entidade depois que a fusão existe.
 *
 * O ponto inteiro da slice: uma grafia fundida continua no banco, e quem a
 * encontra tem que ser levado ao vencedor. Sem isso a fusão arruma o passado e
 * a sessão de amanhã recria o problema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));

import { buscarConhecidas, listarEntidades, nomesParaVocabulario, resolver } from "@/lib/entidades";
import { query } from "@/lib/neo4j";

const consulta = vi.mocked(query);
const cypher = () => String(consulta.mock.calls[0][0]);

beforeEach(() => {
  consulta.mockReset();
  consulta.mockResolvedValue([]);
});

describe("buscar entidade conhecida", () => {
  it("atravessa o alias e devolve o vencedor", async () => {
    await buscarConhecidas(["exx med"]);
    expect(cypher()).toContain("OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)");
    expect(cypher()).toContain("coalesce(v, e) AS alvo");
    expect(cypher()).toContain("RETURN alvo.id AS id, alvo.nome AS nome");
  });

  it("mantém a chave procurada, não a do vencedor", async () => {
    // O chamador casa a candidata da sessão de volta por essa chave; devolver a
    // do vencedor faria a candidata "Exx Med" não encontrar a si mesma.
    await buscarConhecidas(["exx med"]);
    expect(cypher()).toContain("e.nome_normalizado AS nome_normalizado");
  });

  it("uma grafia fundida volta como conhecida, com o nome do vencedor", async () => {
    consulta.mockResolvedValue([
      {
        id: "id-exxmed",
        nome: "Exxmed",
        nome_normalizado: "exx med",
        labels: ["Entidade", "Projeto"],
        sessoes: 3,
      },
    ] as never);

    const [c] = await resolver([
      { nome: "Exx Med", nome_normalizado: "exx med", tipo: "Pessoa", ocorrencias: 1 },
    ]);

    expect(c.conhecida).toBe(true);
    expect(c.nome).toBe("Exxmed");
    // O grafo vence sobre o extrator, inclusive no tipo.
    expect(c.tipo).toBe("Projeto");
    expect(c.sessoes).toBe(3);
  });

  it("lista vazia não fala com o banco", async () => {
    await buscarConhecidas([]);
    expect(consulta).not.toHaveBeenCalled();
  });
});

describe("a lista da tela de manutenção", () => {
  it("não mostra nó fundido como linha própria", async () => {
    await listarEntidades();
    expect(cypher()).toContain("coalesce(e.status, 'ativa') <> 'fundida'");
  });

  it("traz as grafias fundidas como alias do vencedor", async () => {
    await listarEntidades();
    expect(cypher()).toContain("(alias:Entidade)-[:FUNDIDA_EM]->(e)");
  });

  it("status ausente conta como ativa — nó criado antes da 004", async () => {
    // A defesa fica na leitura, e não numa migração de dado: migrar arrumaria
    // os nós de hoje e não o que um deploy antigo criasse amanhã.
    consulta.mockResolvedValue([
      {
        id: "id-1",
        nome: "Isinha",
        nome_normalizado: "isinha",
        labels: ["Entidade", "Pessoa"],
        atomos: 4,
        sessoes: 2,
        aliases: [],
      },
    ] as never);

    const lista = await listarEntidades();
    expect(lista[0].nome).toBe("Isinha");
    expect(lista[0].tipo).toBe("Pessoa");
  });
});

describe("os nomes que vão para o STT", () => {
  it("não manda grafia que eu já rejeitei", async () => {
    // Mandar o alias ensinaria o modelo a reproduzir justamente a grafia errada.
    await nomesParaVocabulario(100);
    expect(cypher()).toContain("coalesce(e.status, 'ativa') <> 'fundida'");
  });

  it("ordena por sessões, com desempate estável pelo nome", async () => {
    // Sem desempate a mesma consulta devolveria ordens diferentes, e o cache
    // com TTL passaria listas distintas ao STT entre um bloco e outro.
    await nomesParaVocabulario(100);
    expect(cypher()).toContain("ORDER BY sessoes DESC, e.nome");
  });

  it("respeita o teto pedido", async () => {
    await nomesParaVocabulario(100);
    expect(consulta.mock.calls[0][1]).toEqual({ limite: 100 });
  });
});
