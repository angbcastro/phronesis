/**
 * A leitura de entidade depois que a fusão existe.
 *
 * O ponto inteiro da slice: uma grafia fundida continua no banco, e quem a
 * encontra tem que ser levado ao vencedor. Sem isso a fusão arruma o passado e
 * a sessão de amanhã recria o problema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));

import { acharPorChave, listarEntidades, nomesParaVocabulario } from "@/lib/entidades";
import type { EntidadeDoGrafo } from "@/lib/entidades";
import { query } from "@/lib/neo4j";

const consulta = vi.mocked(query);
const cypher = () => String(consulta.mock.calls[0][0]);

beforeEach(() => {
  consulta.mockReset();
  consulta.mockResolvedValue([]);
});

describe("a chave atravessa o alias", () => {
  it("a consulta traz as grafias fundidas junto com a do vencedor", async () => {
    // É o ponto inteiro da slice 3: a grafia morta continua no banco, e quem a
    // encontra tem que ser levado ao vencedor. Sem `chaves` a resolução de
    // amanhã recriaria o nó que eu fundi ontem.
    await listarEntidades();
    expect(cypher()).toContain("collect(DISTINCT alias.nome_normalizado) AS chaves_alias");
  });

  it("uma grafia fundida encontra o vencedor, com o nome e o tipo dele", async () => {
    consulta.mockResolvedValue([
      {
        id: "id-exxmed",
        nome: "Exxmed",
        nome_normalizado: "exxmed",
        labels: ["Entidade", "Projeto"],
        atomos: 5,
        sessoes: 3,
        aliases: ["Exx Med"],
        chaves_alias: ["exx med"],
      },
    ] as never);

    const catalogo = await listarEntidades();
    const achada = acharPorChave("exx med", catalogo) as EntidadeDoGrafo;

    expect(achada.nome).toBe("Exxmed");
    // O grafo vence sobre o extrator, inclusive no tipo.
    expect(achada.tipo).toBe("Projeto");
    expect(achada.sessoes).toBe(3);
  });

  it("chave que ninguém tem não acha nada — é entidade nova", async () => {
    expect(acharPorChave("alguem novo", await listarEntidades())).toBeUndefined();
  });
});

describe("os três campos de perfil", () => {
  it("a consulta lê os três, com campo ausente valendo vazio", async () => {
    // Mesma decisão do `status` na 004: a defesa fica na leitura, para valer
    // também para o nó que um deploy antigo criar amanhã.
    await listarEntidades();
    for (const campo of ["contexto", "pode_ajudar_com", "fizemos_juntos"]) {
      expect(cypher()).toContain(`coalesce(e.${campo}, '') AS ${campo}`);
    }
  });

  it("nó sem perfil nenhum vira perfil vazio, não undefined", async () => {
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

    const [e] = await listarEntidades();
    expect(e.perfil).toEqual({ contexto: "", pode_ajudar_com: "", fizemos_juntos: "" });
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
