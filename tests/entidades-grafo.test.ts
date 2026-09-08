/**
 * A leitura de entidade depois que a fusão existe.
 *
 * O ponto inteiro da slice: uma grafia fundida continua no banco, e quem a
 * encontra tem que ser levado ao vencedor. Sem isso a fusão arruma o passado e
 * a sessão de amanhã recria o problema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));
// A porta do Gateway é mockada; o que se testa aqui é QUEM sai de dia, que é a
// regra do hash — a chamada de rede em si não tem o que ensinar.
vi.mock("@/lib/embedding", async (original) => ({
  ...(await original<typeof import("@/lib/embedding")>()),
  embutirVarios: vi.fn(async (textos: string[]) =>
    textos.map(() => ({ embedding: [0.1, 0.2], modelo: "openai/text-embedding-3-small" })),
  ),
}));

import {
  acharPorChave,
  garantirEmbeddings,
  listarEntidades,
  nomesParaVocabulario,
  passadaDeVetores,
} from "@/lib/entidades";
import type { EntidadeDoGrafo } from "@/lib/entidades";
import { embutirVarios, fonteDaEntidade, hashDaFonte } from "@/lib/embedding";
import { modeloEmbedding } from "@/lib/modelos";
import { query } from "@/lib/neo4j";

const consulta = vi.mocked(query);
const embutir = vi.mocked(embutirVarios);
const cypher = () => String(consulta.mock.calls[0][0]);

beforeEach(() => {
  consulta.mockReset();
  consulta.mockResolvedValue([]);
  embutir.mockClear();
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

  it("lê também a propriedade `aliases` — a segunda fonte da 4.11", async () => {
    await listarEntidades();
    expect(cypher()).toContain("coalesce(e.aliases, []) AS aliases_prop");
  });

  /**
   * O caso "jean" da 4.11, e é ele que a fatia inteira existe para entregar: a
   * grafia deixou de ser nó, então ela só casa se `chaves` a incluir. Sem esta
   * linha, "jean" cairia como entidade nova na sessão seguinte — que é
   * exatamente o comportamento anterior à 4.9.
   */
  it("a grafia da propriedade entra em chaves, e o casamento exato a encontra", async () => {
    consulta.mockResolvedValue([
      {
        id: "id-g",
        nome: "Giampaolo Lepore",
        nome_normalizado: "giampaolo lepore",
        labels: ["Entidade", "Pessoa"],
        atomos: 7,
        sessoes: 3,
        aliases_prop: ["Jean", "Giam"],
        aliases: [],
        chaves_alias: [],
      },
    ] as never);

    const catalogo = await listarEntidades();
    expect(catalogo[0].aliases).toEqual(["Jean", "Giam"]);
    expect(acharPorChave("jean", catalogo)?.nome).toBe("Giampaolo Lepore");
    expect(acharPorChave("giam", catalogo)?.nome).toBe("Giampaolo Lepore");
  });

  it("as duas fontes viram uma lista só, sem repetir a mesma grafia", async () => {
    // A propriedade (009) e o nó de fusão real podem dizer o mesmo nome. A
    // lista é para eu ler; mostrar "Jean, Jean" seria ruído.
    consulta.mockResolvedValue([
      {
        id: "id-g",
        nome: "Giampaolo Lepore",
        nome_normalizado: "giampaolo lepore",
        labels: ["Entidade", "Pessoa"],
        atomos: 7,
        sessoes: 3,
        aliases_prop: ["Jean"],
        aliases: ["jean", "Giampa"],
        chaves_alias: ["jean", "giampa"],
      },
    ] as never);

    const [e] = await listarEntidades();
    expect(e.aliases).toEqual(["Jean", "Giampa"]);
    expect(e.chaves).toEqual(["giampaolo lepore", "jean", "giampa"]);
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

  /**
   * Até a 009 isso saía de graça: a grafia era um nó `status = 'fundida'`, e o
   * filtro acima a deixava de fora sem que ninguém decidisse nada. Agora ela é
   * item de `e.aliases`, no mesmo nó do nome bom — então o array não pode ser
   * lido aqui, e o que antes era consequência virou escolha escrita.
   */
  it("lê só e.nome: a propriedade `aliases` nunca entra no vocabulário", async () => {
    await nomesParaVocabulario(100);
    expect(cypher()).toContain("RETURN e.nome AS nome");
    expect(cypher()).not.toContain("aliases");
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

describe("o vetor da entidade (slice 4.5)", () => {
  /** Uma linha como `garantirEmbeddings` a lê do grafo. */
  const linha = (extra: Record<string, unknown> = {}) => ({
    id: "id-raffa",
    nome: "Raffa",
    labels: ["Entidade", "Pessoa"],
    aliases: [],
    contexto: "amigo de infância",
    pode_ajudar_com: null,
    fizemos_juntos: null,
    embedding_fonte: null,
    embedding_modelo: null,
    ...extra,
  });

  /** O hash que o grafo teria se estivesse em dia com esta linha. */
  const emDia = (l: ReturnType<typeof linha>) =>
    hashDaFonte(
      fonteDaEntidade({
        nome: l.nome,
        tipo: "Pessoa",
        aliases: l.aliases as string[],
        perfil: {
          contexto: l.contexto ?? "",
          pode_ajudar_com: l.pode_ajudar_com ?? "",
          fizemos_juntos: l.fizemos_juntos ?? "",
        },
      }),
    );

  it("entidade sem vetor nenhum é embutida", async () => {
    consulta.mockResolvedValueOnce([linha()] as never).mockResolvedValue([] as never);
    const r = await garantirEmbeddings();
    expect(r).toMatchObject({ conferidas: 1, embutidas: 1 });
    expect(embutir).toHaveBeenCalledTimes(1);
  });

  it("entidade em dia NÃO é reembutida — o hash é a trava (critério 8)", async () => {
    const l = linha();
    consulta.mockResolvedValueOnce([
      { ...l, embedding_fonte: emDia(l), embedding_modelo: modeloEmbedding() },
    ] as never);

    const r = await garantirEmbeddings();
    expect(r.embutidas).toBe(0);
    expect(embutir).not.toHaveBeenCalled();
    // Nem a consulta de escrita roda: nada saiu de dia, nada tem que ser gravado.
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("editar o perfil faz a entidade sair de dia (critério 8)", async () => {
    const antes = linha();
    const depois = linha({ fizemos_juntos: "acampamos na serra" });
    consulta.mockResolvedValueOnce([
      { ...depois, embedding_fonte: emDia(antes), embedding_modelo: modeloEmbedding() },
    ] as never);

    expect((await garantirEmbeddings()).embutidas).toBe(1);
  });

  it("trocar EMBEDDING_MODEL põe todo mundo de volta na fila", async () => {
    // Dois espaços vetoriais no mesmo índice não dão erro: dão vizinhança
    // errada. É para isso que `embedding_modelo` existe.
    const l = linha();
    consulta.mockResolvedValueOnce([
      { ...l, embedding_fonte: emDia(l), embedding_modelo: "outro/modelo-de-antes" },
    ] as never);

    expect((await garantirEmbeddings()).embutidas).toBe(1);
  });

  it("entidade fundida fica de fora — não é candidata a nada", async () => {
    await garantirEmbeddings();
    expect(cypher()).toContain("coalesce(e.status, 'ativa') <> 'fundida'");
  });

  it("grava o hash junto do vetor, não a string inteira", async () => {
    const l = linha();
    consulta.mockResolvedValueOnce([l] as never).mockResolvedValue([] as never);
    await garantirEmbeddings();

    const escrita = consulta.mock.calls[1];
    expect(String(escrita[0])).toContain("e.embedding_fonte = v.fonte");
    const params = escrita[1] as { entidades: { fonte: string }[] };
    expect(params.entidades[0].fonte).toBe(emDia(l));
  });
});

/**
 * O gancho (slice 4.8.1).
 *
 * `garantirEmbeddings()` tinha um chamador só — `POST /api/entidades/embutir` —
 * e nenhuma tela chama essa rota. A "próxima passada" que o §8.4 descreve não
 * existia: entidade nascida num confirmar ficava sem vetor para sempre, e a
 * camada 3a era código que não podia achar nada.
 */
describe("a passada de vetores que o confirmar e as rotas disparam", () => {
  const linha = (extra: Record<string, unknown> = {}) => ({
    id: "id-raffa",
    nome: "Raffa",
    labels: ["Entidade", "Pessoa"],
    aliases: [],
    contexto: "amigo de infância",
    pode_ajudar_com: null,
    fizemos_juntos: null,
    embedding_fonte: null,
    embedding_modelo: null,
    ...extra,
  });

  const emDia = (l: ReturnType<typeof linha>) =>
    hashDaFonte(
      fonteDaEntidade({
        nome: l.nome,
        tipo: "Pessoa",
        aliases: l.aliases as string[],
        perfil: {
          contexto: l.contexto ?? "",
          pode_ajudar_com: l.pode_ajudar_com ?? "",
          fizemos_juntos: l.fizemos_juntos ?? "",
        },
      }),
    );

  it("a primeira passada embute, a segunda não embute de novo (regra 4)", async () => {
    const l = linha();
    // Primeira: a entidade não tem vetor. Segunda: o hash já é o de hoje —
    // que é o estado em que a primeira a deixou.
    consulta
      .mockResolvedValueOnce([l] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { ...l, embedding_fonte: emDia(l), embedding_modelo: modeloEmbedding() },
      ] as never);

    await passadaDeVetores("teste");
    await passadaDeVetores("teste");

    expect(embutir).toHaveBeenCalledTimes(1);
  });

  it("rodar com nada fora de dia custa uma consulta e zero chamada de modelo", async () => {
    const l = linha();
    consulta.mockResolvedValueOnce([
      { ...l, embedding_fonte: emDia(l), embedding_modelo: modeloEmbedding() },
    ] as never);

    await passadaDeVetores("teste");
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(embutir).not.toHaveBeenCalled();
  });

  it("falhar não sobe: nada no caminho do vetor impede uma gravação", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    consulta.mockRejectedValueOnce(new Error("neo4j fora"));

    await expect(passadaDeVetores("confirmar abc")).resolves.toBeUndefined();
    expect(log.mock.calls.map((c) => String(c[0])).join(" | ")).toContain("[entidades]");
    log.mockRestore();
  });
});
