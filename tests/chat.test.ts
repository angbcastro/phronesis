/**
 * O chat: as duas ferramentas, o loop com teto, a conversa que persiste, e as
 * lógicas puras da tela.
 *
 * O que se testa primeiro é o que erraria **calado**: um filtro de período que
 * deixa passar átomo sem data, uma entidade que não existe voltando como "nada
 * encontrado" em vez de "esse nome não está no grafo", um NDJSON partido no
 * meio de uma linha, e o loop parando no teto sem escrever resposta nenhuma —
 * que é o caso em que a pergunta mais cara do sistema voltaria vazia.
 *
 * A gravação é conferida pelo Cypher que ela monta e pela ordem das escritas:
 * apagar o objeto do R2 **antes** do nó é o que impede um objeto órfão, e
 * `r2.ts` não tem `LIST` para reencontrá-lo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, generateText: vi.fn() };
});
vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []), queryUm: vi.fn(async () => null) }));
vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(async () => null),
  putJson: vi.fn(async () => ({ etag: null })),
  remover: vi.fn(async () => undefined),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));
vi.mock("@/lib/embedding", () => ({
  embutir: vi.fn(async () => ({ embedding: [0.1, 0.2], modelo: "openai/text-embedding-3-small" })),
}));
vi.mock("@/lib/entidades", () => ({
  listarEntidades: vi.fn(async () => []),
  acharPorChave: vi.fn(),
}));

import { generateText } from "ai";
import {
  INSTRUCOES,
  K_BUSCA,
  PISO_BUSCA,
  PROFUNDIDADE_HISTORICO,
  PROMPT_VERSION_CHAT,
  TETO_ATOMOS,
  TETO_FERRAMENTAS,
  buscarAtomos,
  chamadasFeitas,
  dataSimples,
  ferramentas,
  historicoDoAtomo,
  linhaDeAtomo,
  montarSistema,
  paraOModelo,
  parametrosLimpos,
  respostaDaBusca,
  respostaDoHistorico,
  responder,
  tiposValidos,
} from "@/lib/chat";
import {
  INSTRUCOES_TITULO,
  PROMPT_VERSION_TITULO,
  TETO_TITULO,
  acrescentarMensagens,
  apagarConversa,
  arquivarConversa,
  criarConversa,
  listarConversas,
  montarPromptDeTitulo,
  parsearTitulo,
  titularConversa,
} from "@/lib/conversas";
import {
  TETO_ROTULO,
  diaCurto,
  frasePasso,
  partirLinhas,
  rotuloDaConversa,
  separarConversas,
} from "@/components/Chat";
import { chaveMensagens, chavePromptAgente } from "@/lib/chaves";
import { AGENTE_IDS, ehAgenteId } from "@/lib/tipos";
import { acharPorChave, listarEntidades } from "@/lib/entidades";
import { embutir } from "@/lib/embedding";
import { ConflitoR2Error, getJson, putJson, remover } from "@/lib/r2";
import { query, queryUm } from "@/lib/neo4j";
import type { AtomoAchado, Conversa, Mensagem, PassoDeFerramenta } from "@/lib/tipos";

const consulta = vi.mocked(query);
const consultaUm = vi.mocked(queryUm);
const chamar = vi.mocked(generateText);
const catalogo = vi.mocked(listarEntidades);
const achar = vi.mocked(acharPorChave);

const atomo = (extra: Partial<AtomoAchado> = {}): AtomoAchado => ({
  id: "a1",
  texto: "terminei com a Isinha ontem",
  tipo: "FATO",
  valido_em: "2026-07-02T10:00:00.000Z",
  sobre: ["Isinha"],
  cita: [],
  ...extra,
});

const conversa = (extra: Partial<Conversa> = {}): Conversa => ({
  id: "c1abcdefgh",
  titulo: "o fim com a Isinha",
  criado_em: "2026-09-10T10:00:00.000Z",
  atualizada_em: "2026-09-12T18:00:00.000Z",
  arquivada_em: null,
  mensagens_key: chaveMensagens("c1abcdefgh"),
  ...extra,
});

/** O mínimo que `responder` precisa ver num retorno de `generateText`. */
const respostaDoModelo = (texto: string, extra: Record<string, unknown> = {}) =>
  ({
    text: texto,
    finishReason: "stop",
    steps: [],
    responseMessages: [],
    response: { modelId: "zai/glm-5.3-flash" },
    ...extra,
  }) as never;

/** O Cypher decide a resposta: os caminhos aqui fazem mais de uma consulta. */
const porCypher = (mapa: [RegExp, unknown][]) => {
  consulta.mockImplementation((async (cypher: string) => {
    for (const [re, valor] of mapa) if (re.test(String(cypher))) return valor;
    return [];
  }) as never);
};

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  delete process.env.CHAT_MODEL;
  delete process.env.CHAT_TITULO_MODEL;
  consulta.mockReset();
  consulta.mockResolvedValue([] as never);
  consultaUm.mockReset();
  consultaUm.mockResolvedValue(null as never);
  chamar.mockReset();
  catalogo.mockReset();
  catalogo.mockResolvedValue([] as never);
  achar.mockReset();
  vi.mocked(getJson).mockReset().mockResolvedValue(null as never);
  vi.mocked(putJson).mockReset().mockResolvedValue({ etag: null } as never);
  vi.mocked(remover).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(embutir).mockClear();
});

// ─────────────────────── o registro dos dois agentes ───────────────────────

describe("os dois agentes novos existem como agente", () => {
  it("`chat` e `titulo-chat` são ids de domínio", () => {
    expect(AGENTE_IDS).toContain("chat");
    expect(AGENTE_IDS).toContain("titulo-chat");
    expect(ehAgenteId("titulo-chat")).toBe(true);
  });

  /**
   * O hífen é novo: até a slice 6 todo id era só letra, e `chavePromptAgente`
   * barrava qualquer outra coisa. Se ela voltar a barrar, um prompt editado de
   * `titulo-chat` deixa de ter onde ser gravado — e o erro só apareceria no meu
   * primeiro toque na tela de agentes.
   */
  it("o id com hífen tem onde gravar o prompt editado", () => {
    expect(chavePromptAgente("titulo-chat", "a1b2c3d4")).toBe(
      "config/prompt-titulo-chat-a1b2c3d4.json",
    );
    expect(() => chavePromptAgente("../etc", "a1b2c3d4")).toThrow();
    expect(() => chavePromptAgente("-chat", "a1b2c3d4")).toThrow();
  });

  it("o prompt do chat continua nomeando as duas ferramentas", () => {
    // É o envelope deste agente: o parser dele é o loop de tool-calling, e um
    // prompt que não cita a ferramenta é um prompt que a desliga.
    expect(INSTRUCOES).toContain("buscar_atomos");
    expect(INSTRUCOES).toContain("historico_do_atomo");
  });
});

// ─────────────────────────── ferramenta 1 ───────────────────────────

describe("buscar_atomos", () => {
  it("sem texto, é um MATCH filtrado do mais recente para o mais antigo", async () => {
    await buscarAtomos({});
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("MATCH (a:Atomo)");
    expect(cypher).not.toContain("db.index.vector.queryNodes");
    expect(cypher).toContain("ORDER BY valido_em DESC");
    expect(consulta.mock.calls[0][1]).toEqual({ limite: TETO_ATOMOS });
    expect(embutir).not.toHaveBeenCalled();
  });

  it("com texto, o vetor entra e os filtros se somam", async () => {
    await buscarAtomos({ texto: "como eu estava", tipo: ["SENTIMENTO"] });
    const [cypher, parametros] = consulta.mock.calls[0];
    expect(String(cypher)).toContain("db.index.vector.queryNodes('atomo_embedding'");
    expect(String(cypher)).toContain("2 * score - 1 AS similaridade");
    expect(String(cypher)).toContain("a.tipo IN $tipos");
    expect(String(cypher)).toContain("ORDER BY similaridade DESC");
    expect(parametros).toMatchObject({ k: K_BUSCA, piso: PISO_BUSCA, tipos: ["SENTIMENTO"] });
    expect(embutir).toHaveBeenCalledWith("como eu estava");
  });

  it("só átomo ativo, sempre — nos dois caminhos", async () => {
    await buscarAtomos({});
    await buscarAtomos({ texto: "x" });
    for (const c of consulta.mock.calls) {
      expect(String(c[0])).toContain("coalesce(a.status, 'ativo') = 'ativo'");
    }
  });

  /**
   * `left(valido_em, 10)` e não a string inteira: o parâmetro é uma data e o
   * campo é um instante. Sem o corte, `<= '2026-08-31'` excluiria tudo que
   * aconteceu no próprio dia 31.
   */
  it("o período compara data com data, e átomo sem data fica de fora", async () => {
    await buscarAtomos({ desde: "2026-08-01", ate: "2026-08-31" });
    const [cypher, parametros] = consulta.mock.calls[0];
    expect(String(cypher)).toContain("left(a.valido_em, 10) >= $desde");
    expect(String(cypher)).toContain("left(a.valido_em, 10) <= $ate");
    expect(String(cypher)).toContain("coalesce(a.valido_em, '') <> ''");
    expect(parametros).toMatchObject({ desde: "2026-08-01", ate: "2026-08-31" });
  });

  it("sem período, o átomo sem data continua elegível", async () => {
    await buscarAtomos({ tipo: ["FATO"] });
    expect(String(consulta.mock.calls[0][0])).not.toContain("coalesce(a.valido_em, '') <> ''");
  });

  it("a entidade resolve pelo catálogo, e a fusão é atravessada na consulta", async () => {
    catalogo.mockResolvedValue([
      { id: "e1", nome: "Isinha", chaves: ["isinha", "isa"] },
    ] as never);
    achar.mockReturnValue({ id: "e1", nome: "Isinha", chaves: ["isinha", "isa"] } as never);

    await buscarAtomos({ entidade: "Isa" });
    const [cypher, parametros] = consulta.mock.calls[0];
    expect(String(cypher)).toContain("[:SOBRE|:MENCIONA]->(e:Entidade)");
    expect(String(cypher)).toContain("(e)-[:FUNDIDA_EM]->(:Entidade { id: $entidadeId })");
    expect(parametros).toMatchObject({ entidadeId: "e1" });
  });

  /**
   * A diferença entre "essa pessoa não está no diário" e "você escreveu o nome
   * de outro jeito" é a diferença entre uma resposta errada e um segundo
   * palpite. Voltar lista vazia sem aviso ensinaria o modelo a concluir a
   * primeira.
   */
  it("entidade que não existe volta com aviso e nomes parecidos, sem consultar nada", async () => {
    catalogo.mockResolvedValue([
      { id: "e9", nome: "Isabela Prado", chaves: ["isabela prado"] },
      { id: "e8", nome: "Murta", chaves: ["murta"] },
    ] as never);
    achar.mockReturnValue(undefined as never);

    const r = await buscarAtomos({ entidade: "Isabela" });
    expect(r.achados).toEqual([]);
    expect(r.aviso).toContain("Isabela Prado");
    expect(consulta).not.toHaveBeenCalled();
  });

  it("as entidades do átomo vêm penduradas, e nunca o \"eu\"", async () => {
    await buscarAtomos({});
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("toLower(coalesce(s.nome, '')) <> 'eu'");
    expect(cypher).toContain("toLower(coalesce(m.nome, '')) <> 'eu'");
  });

  it("a linha do grafo vira átomo achado, com campo ausente virando vazio", async () => {
    consulta.mockResolvedValue([
      { id: "a1", texto: "t", tipo: "FATO", valido_em: "", sobre: null, cita: null, similaridade: 0.62 },
    ] as never);
    const r = await buscarAtomos({ texto: "x" });
    expect(r.achados[0]).toEqual({
      id: "a1",
      texto: "t",
      tipo: "FATO",
      valido_em: "",
      sobre: [],
      cita: [],
      similaridade: 0.62,
    });
  });
});

describe("os parâmetros que o modelo manda", () => {
  it("data solta vira AAAA-MM-DD, e lixo vira vazio", () => {
    expect(dataSimples("2026-08-01T10:00:00.000Z")).toBe("2026-08-01");
    expect(dataSimples("2026-08-01")).toBe("2026-08-01");
    expect(dataSimples("agosto")).toBe("");
    expect(dataSimples(undefined)).toBe("");
    expect(dataSimples(7)).toBe("");
  });

  it("tipo inventado pelo modelo é ignorado, não derruba a busca", () => {
    expect(tiposValidos(["FATO", "SONHO", "FATO"])).toEqual(["FATO"]);
    expect(tiposValidos("OPINIAO")).toEqual(["OPINIAO"]);
    expect(tiposValidos(undefined)).toEqual([]);
  });

  it("o (i) mostra só o que foi de fato usado", () => {
    expect(parametrosLimpos({ texto: "  ", entidade: "Isinha", tipo: ["X"] as never })).toEqual({
      entidade: "Isinha",
    });
    expect(parametrosLimpos({ desde: "2026-08-01", ate: "lixo" })).toEqual({
      desde: "2026-08-01",
    });
  });
});

// ─────────────────────────── ferramenta 2 ───────────────────────────

describe("historico_do_atomo", () => {
  it("anda nas duas direções, até a profundidade declarada", async () => {
    await historicoDoAtomo("a1");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain(
      `[:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA*1..${PROFUNDIDADE_HISTORICO}]-(o:Atomo)`,
    );
    // Sem seta: a relação nasce do mais novo para o mais antigo, e a pergunta
    // "como mudou" quer os dois lados do ponto onde eu parei.
    expect(cypher).not.toContain("]->(o:Atomo)");
    expect(cypher).toContain("ORDER BY valido_em ASC");
  });

  it("átomo que não existe volta com aviso, e não busca aresta nenhuma", async () => {
    const r = await historicoDoAtomo("sumido");
    expect(r.achados).toEqual([]);
    expect(r.aviso).toContain("sumido");
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("id vazio nem chega ao banco", async () => {
    const r = await historicoDoAtomo("  ");
    expect(r.aviso).toBe("id de átomo vazio");
    expect(consulta).not.toHaveBeenCalled();
  });

  /**
   * Um item só não é "não mudou": é "a varredura do confronto ainda não passou
   * por aqui". Devolver a lista sem dizer isso faria o modelo afirmar o
   * contrário do que os dados sustentam.
   */
  it("átomo sem vizinho diz que ainda não tem relação registrada", async () => {
    consulta.mockResolvedValueOnce([
      { id: "a1", texto: "t", tipo: "OPINIAO", valido_em: "2026-01-01", sobre: [], cita: [] },
    ] as never);
    const r = await historicoDoAtomo("a1");
    expect(r.achados).toHaveLength(1);
    expect(r.elos).toEqual([]);
    expect(r.aviso).toContain("ainda não tem nenhuma relação");
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("com vizinhos, a segunda consulta traz as arestas só entre os achados", async () => {
    porCypher([
      [
        /UNWIND \$ids AS x/,
        [
          { de: "a2", para: "a1", tipo: "ATUALIZA", motivo: "mudou de ideia", confianca: 0.8 },
          { de: "a2", para: "a1", tipo: "INVENTADA", motivo: "", confianca: 0.9 },
        ],
      ],
      [
        /OPTIONAL MATCH \(raiz\)/,
        [
          { id: "a1", texto: "antes", tipo: "OPINIAO", valido_em: "2026-01-01", sobre: [], cita: [] },
          { id: "a2", texto: "depois", tipo: "OPINIAO", valido_em: "2026-06-01", sobre: [], cita: [] },
        ],
      ],
    ]);

    const r = await historicoDoAtomo("a1");
    expect(r.achados.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(String(consulta.mock.calls[1][0])).toContain("WHERE b.id IN $ids");
    expect(consulta.mock.calls[1][1]).toEqual({ ids: ["a1", "a2"] });
    // Tipo que não é um dos quatro é descartado em silêncio, como no confronto.
    expect(r.elos).toEqual([
      { de: "a2", para: "a1", tipo: "ATUALIZA", motivo: "mudou de ideia", confianca: 0.8 },
    ]);
  });
});

// ─────────────────────── o que volta ao modelo ───────────────────────

describe("o texto que a ferramenta devolve", () => {
  it("cada linha carrega o id, porque é por ele que o histórico é pedido", () => {
    expect(linhaDeAtomo(atomo())).toContain("[id a1 · FATO · 2026-07-02 · sobre: Isinha]");
  });

  it("busca vazia diz que está vazia, e não devolve string à toa", () => {
    expect(respostaDaBusca({ achados: [] })).toBe("nenhum trecho encontrado.");
    expect(respostaDaBusca({ achados: [], aviso: "não existe entidade" })).toBe(
      "não existe entidade",
    );
  });

  it("o histórico separa os trechos das relações", () => {
    const s = respostaDoHistorico({
      achados: [atomo({ id: "a1" }), atomo({ id: "a2" })],
      elos: [{ de: "a2", para: "a1", tipo: "ATUALIZA", motivo: "mudou", confianca: 0.8 }],
    });
    expect(s).toContain("RELAÇÕES (o mais novo → o mais antigo):");
    expect(s).toContain("a2 ATUALIZA a1 — mudou");
  });
});

/**
 * O que a primeira pergunta vaga de verdade ("quais são minhas prioridades")
 * cobrou: doze átomos por busca vezes oito buscas encadeadas, e o mesmo átomo
 * voltando inteiro em cada busca que o alcança. O modelo lê contexto recuperado
 * como relevante por construção, e respondeu com o diário inteiro.
 *
 * Colapsar e não omitir é a parte que erraria calado nos dois sentidos: omitir
 * faria o modelo ler a segunda busca como mais pobre do que foi e buscar de
 * novo; e um conjunto que sobrevivesse a uma tentativa perdida faria a resposta
 * citar "já mostrado acima" sem nada acima.
 */
describe("o mesmo átomo não volta inteiro duas vezes", () => {
  it("a segunda vez é o id e a lembrança, e a primeira continua inteira", () => {
    const vistos = new Set<string>();
    const primeira = respostaDaBusca({ achados: [atomo({ id: "a1" })] }, vistos);
    const segunda = respostaDaBusca({ achados: [atomo({ id: "a1" })] }, vistos);

    expect(primeira).toContain("terminei com a Isinha ontem");
    expect(segunda).toBe("[id a1] já mostrado acima");
  });

  it("a memória atravessa as duas ferramentas", () => {
    const vistos = new Set<string>();
    respostaDaBusca({ achados: [atomo({ id: "a1" })] }, vistos);
    const historico = respostaDoHistorico(
      {
        achados: [atomo({ id: "a1" }), atomo({ id: "a2", texto: "voltei a falar com ela" })],
        elos: [{ de: "a2", para: "a1", tipo: "ATUALIZA", motivo: "mudou", confianca: 0.8 }],
      },
      vistos,
    );

    expect(historico).toContain("[id a1] já mostrado acima");
    expect(historico).toContain("voltei a falar com ela");
    // A cadeia continua legível: colapsar o texto não apaga a relação.
    expect(historico).toContain("a2 ATUALIZA a1 — mudou");
  });

  it("sem conjunto nenhum, nada colapsa", () => {
    const texto = respostaDaBusca({ achados: [atomo({ id: "a1" }), atomo({ id: "a1" })] });
    expect(texto).not.toContain("já mostrado acima");
  });

  it("o (i) continua com tudo — quem corta é só o que volta ao modelo", async () => {
    consulta.mockResolvedValue([
      { id: "a1", texto: "terminei com a Isinha", tipo: "FATO", valido_em: "2026-07-02", sobre: [], cita: [] },
    ] as never);
    const passos: PassoDeFerramenta[] = [];
    const f = ferramentas((p) => passos.push(p), new Set<string>());

    const primeira = await f.buscar_atomos.execute!({ texto: "isinha" } as never, {} as never);
    const segunda = await f.buscar_atomos.execute!({ texto: "término" } as never, {} as never);

    expect(String(primeira)).toContain("terminei com a Isinha");
    expect(String(segunda)).toBe("[id a1] já mostrado acima");
    // O rastro completo é a promessa da spec: os dois passos guardam o achado.
    expect(passos).toHaveLength(2);
    expect(passos[1].achados[0].texto).toBe("terminei com a Isinha");
  });

  it("a memória morre com a resposta: outra pergunta vê o átomo inteiro de novo", async () => {
    consulta.mockResolvedValue([
      { id: "a1", texto: "terminei com a Isinha", tipo: "FATO", valido_em: "2026-07-02", sobre: [], cita: [] },
    ] as never);
    const devolvido: string[] = [];
    chamar.mockImplementation((async (opcoes: {
      tools: Record<string, { execute: (a: unknown, b: unknown) => Promise<unknown> }>;
    }) => {
      devolvido.push(String(await opcoes.tools.buscar_atomos.execute({ texto: "isinha" }, {})));
      return respostaDoModelo("pronto");
    }) as never);

    await responder([{ papel: "eu", texto: "x", criado_em: "" }]);
    await responder([{ papel: "eu", texto: "y", criado_em: "" }]);

    expect(devolvido).toHaveLength(2);
    for (const texto of devolvido) expect(texto).toContain("terminei com a Isinha");
  });
});

describe("as ferramentas prontas para o SDK", () => {
  /**
   * Ferramenta que estoura derruba o loop inteiro e a pergunta fica sem
   * resposta. Ferramenta que devolve "não consegui" deixa o modelo tentar outro
   * caminho — que é o que uma pessoa faria.
   */
  it("falha da busca vira texto para o modelo, nunca exceção", async () => {
    consulta.mockRejectedValue(new Error("Neo4j fora do ar") as never);
    const passos: PassoDeFerramenta[] = [];
    const f = ferramentas((p) => passos.push(p));

    const r = await f.buscar_atomos.execute!({ texto: "x" } as never, {} as never);
    expect(String(r)).toContain("Neo4j fora do ar");
    expect(passos[0]).toMatchObject({
      ferramenta: "buscar_atomos",
      parametros: { texto: "x" },
      achados: [],
    });
    expect(passos[0].erro).toContain("Neo4j fora do ar");
  });

  it("o passo anunciado carrega o que voltou, cortado para caber na tela", async () => {
    consulta.mockResolvedValue([
      { id: "a1", texto: "x".repeat(900), tipo: "FATO", valido_em: "", sobre: [], cita: [] },
    ] as never);
    const passos: PassoDeFerramenta[] = [];
    const f = ferramentas((p) => passos.push(p));

    await f.buscar_atomos.execute!({} as never, {} as never);
    expect(passos[0].achados[0].texto.length).toBeLessThan(900);
    expect(passos[0].achados[0].texto.endsWith("…")).toBe(true);
  });

  it("uma tela que estoura no anúncio não derruba a resposta", async () => {
    const f = ferramentas(() => {
      throw new Error("a tela sumiu");
    });
    await expect(f.buscar_atomos.execute!({} as never, {} as never)).resolves.toBeTypeOf("string");
  });
});

// ─────────────────────────── o loop ───────────────────────────

describe("o loop do agente", () => {
  it("o teto conta chamada de ferramenta, e não passo do modelo", () => {
    expect(chamadasFeitas([])).toBe(0);
    expect(chamadasFeitas([{ toolCalls: [1, 2] }, { toolCalls: [3] }] as never)).toBe(3);
    expect(chamadasFeitas([{}] as never)).toBe(0);
  });

  it("a data de hoje entra fora do prompt editável", () => {
    const s = montarSistema("MEU PROMPT", new Date("2026-09-13T12:00:00.000Z"));
    expect(s.startsWith("MEU PROMPT")).toBe(true);
    expect(s).toContain("Hoje é 2026-09-13.");
    // O prompt salvo não pode carregar a data: ele é imutável por hash, e
    // congelaria "hoje" no dia em que eu o editei.
    expect(INSTRUCOES).not.toContain("Hoje é");
  });

  it("a conversa vira mensagens de modelo, e o rastro antigo não volta", () => {
    const antiga: Mensagem = {
      papel: "agente",
      texto: "você escreveu isso em agosto",
      criado_em: "",
      rastro: [{ ferramenta: "buscar_atomos", parametros: {}, achados: [atomo()] }],
    };
    expect(paraOModelo(antiga)).toEqual({
      role: "assistant",
      content: "você escreveu isso em agosto",
    });
    expect(paraOModelo({ papel: "eu", texto: "e depois?", criado_em: "" })).toEqual({
      role: "user",
      content: "e depois?",
    });
  });

  it("responde numa chamada só quando o modelo já escreve texto", async () => {
    chamar.mockResolvedValue(respostaDoModelo("em 12 de agosto você escreveu que…"));

    const r = await responder([{ papel: "eu", texto: "como eu estava?", criado_em: "" }]);
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(r.texto).toBe("em 12 de agosto você escreveu que…");
    expect(r.prompt_version).toBe(PROMPT_VERSION_CHAT);
    expect(r.modelo).toBe("zai/glm-5.3-flash");

    const pedido = chamar.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(pedido.tools as object)).toEqual([
      "buscar_atomos",
      "historico_do_atomo",
    ]);
    // Id em string: é o que faz a chamada sair pelo Gateway (regra 8).
    expect(typeof pedido.model).toBe("string");
  });

  /**
   * O caso que a fatia mais teme: o loop bate no teto **em cima de um resultado
   * de ferramenta**, e o modelo ainda não escreveu nada. Sem a segunda chamada,
   * a pergunta mais composta — a que gastou as oito buscas — é justamente a que
   * volta vazia.
   */
  it("parou no teto sem texto: pede a síntese, com as ferramentas caladas", async () => {
    chamar
      .mockResolvedValueOnce(
        respostaDoModelo("", {
          steps: [{ toolCalls: [1, 2, 3, 4] }, { toolCalls: [5, 6, 7, 8] }],
          responseMessages: [{ role: "assistant", content: "…" }],
        }),
      )
      .mockResolvedValueOnce(respostaDoModelo("com o que achei, dá para dizer que…"));

    const r = await responder([{ papel: "eu", texto: "e depois da Canastra?", criado_em: "" }]);
    expect(chamar).toHaveBeenCalledTimes(2);
    const sintese = chamar.mock.calls[1][0] as Record<string, unknown>;
    expect(sintese.toolChoice).toBe("none");
    expect((sintese.messages as unknown[]).length).toBe(2);
    expect(r.texto).toBe("com o que achei, dá para dizer que…");
  });

  it("o teto é o número declarado, e ele para o loop", async () => {
    chamar.mockResolvedValue(respostaDoModelo("pronto"));
    await responder([{ papel: "eu", texto: "x", criado_em: "" }]);

    const parar = (chamar.mock.calls[0][0] as { stopWhen: (o: unknown) => boolean }).stopWhen;
    const passos = (n: number) => ({ steps: Array.from({ length: n }, () => ({ toolCalls: [1] })) });
    expect(parar(passos(TETO_FERRAMENTAS - 1))).toBe(false);
    expect(parar(passos(TETO_FERRAMENTAS))).toBe(true);
  });

  it("modelo que não escreve nada nem na síntese é erro, não resposta vazia", async () => {
    chamar.mockResolvedValue(respostaDoModelo(""));
    await expect(responder([{ papel: "eu", texto: "x", criado_em: "" }])).rejects.toThrow(
      /não escreveu resposta/,
    );
  });

  it("o rastro sai das ferramentas de fato chamadas", async () => {
    consulta.mockResolvedValue([
      { id: "a1", texto: "t", tipo: "FATO", valido_em: "2026-08-01", sobre: [], cita: [] },
    ] as never);
    chamar.mockImplementation((async (opcoes: { tools: Record<string, { execute: (a: unknown, b: unknown) => Promise<unknown> }> }) => {
      await opcoes.tools.buscar_atomos.execute({ entidade: "" , texto: "isinha" }, {});
      return respostaDoModelo("pronto");
    }) as never);

    const vistos: PassoDeFerramenta[] = [];
    const r = await responder([{ papel: "eu", texto: "x", criado_em: "" }], {
      aoPasso: (p) => vistos.push(p),
    });
    expect(r.rastro).toHaveLength(1);
    expect(r.rastro[0]).toMatchObject({ ferramenta: "buscar_atomos", parametros: { texto: "isinha" } });
    expect(vistos).toHaveLength(1);
  });
});

// ─────────────────────────── a conversa ───────────────────────────

describe(":Conversa", () => {
  it("nasce ativa, com a chave do R2 no nó e nada mais", async () => {
    const c = await criarConversa(new Date("2026-09-13T12:00:00.000Z"));
    expect(c.titulo).toBe("");
    expect(c.arquivada_em).toBeNull();
    expect(c.mensagens_key).toBe(`conversas/${c.id}/mensagens.json`);

    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("CREATE (c:Conversa");
    // Ausente é o estado "ativa": gravar `null` seria a mesma coisa com uma
    // propriedade a mais para toda leitura tratar.
    expect(cypher).not.toContain("arquivada_em");
  });

  it("a lista ordena pela última vez que a conversa foi tocada", async () => {
    await listarConversas();
    expect(String(consulta.mock.calls[0][0])).toContain(
      "ORDER BY coalesce(c.atualizada_em, '') DESC",
    );
  });

  it("campo ausente no grafo vira conversa ativa e sem título", async () => {
    consulta.mockResolvedValue([
      { id: "c1", titulo: "", criado_em: "", atualizada_em: "", arquivada_em: null, mensagens_key: "" },
    ] as never);
    const [c] = await listarConversas();
    expect(c.arquivada_em).toBeNull();
    expect(c.mensagens_key).toBe(chaveMensagens("c1"));
  });

  it("arquivar escreve a data; desarquivar remove a propriedade", async () => {
    consultaUm.mockResolvedValue({ id: "c1", titulo: "", criado_em: "", atualizada_em: "", arquivada_em: "2026-09-13", mensagens_key: "" } as never);
    await arquivarConversa("c1", true);
    expect(String(consultaUm.mock.calls[0][0])).toContain("SET c.arquivada_em = $em");

    await arquivarConversa("c1", false);
    expect(String(consultaUm.mock.calls[1][0])).toContain("REMOVE c.arquivada_em");
  });

  /**
   * O R2 antes do grafo. Na ordem inversa, uma falha no meio deixaria um objeto
   * órfão que ninguém mais alcança: a chave só existia no nó que acabou de
   * sumir, e `r2.ts` não tem `LIST` para reencontrá-la.
   */
  it("apagar tira o objeto antes do nó", async () => {
    const ordem: string[] = [];
    consultaUm.mockResolvedValue({
      id: "c1", titulo: "", criado_em: "", atualizada_em: "",
      arquivada_em: null, mensagens_key: "conversas/c1/mensagens.json",
    } as never);
    vi.mocked(remover).mockImplementation((async () => {
      ordem.push("r2");
    }) as never);
    consulta.mockImplementation((async () => {
      ordem.push("neo4j");
      return [];
    }) as never);

    expect(await apagarConversa("c1")).toBe(true);
    expect(ordem).toEqual(["r2", "neo4j"]);
    expect(vi.mocked(remover).mock.calls[0][0]).toBe("conversas/c1/mensagens.json");
    expect(String(consulta.mock.calls[0][0])).toContain("DETACH DELETE c");
  });

  it("apagar o que não existe é false, e não apaga nada", async () => {
    consultaUm.mockResolvedValue(null as never);
    expect(await apagarConversa("c1")).toBe(false);
    expect(remover).not.toHaveBeenCalled();
    expect(consulta).not.toHaveBeenCalled();
  });
});

describe("as mensagens no R2", () => {
  it("a primeira escrita é condicional a não existir nada", async () => {
    await acrescentarMensagens("c1", [{ papel: "eu", texto: "oi", criado_em: "" }]);
    const [chave, corpo, opcoes] = vi.mocked(putJson).mock.calls[0];
    expect(chave).toBe(chaveMensagens("c1"));
    expect((corpo as { mensagens: Mensagem[] }).mensagens).toHaveLength(1);
    expect(opcoes).toEqual({ ifNoneMatch: "*" });
  });

  it("a seguinte é read-modify-write por etag, e acrescenta no fim", async () => {
    vi.mocked(getJson).mockResolvedValue({
      valor: { conversa_id: "c1", mensagens: [{ papel: "eu", texto: "primeira", criado_em: "" }] },
      etag: '"abc"',
    } as never);

    const todas = await acrescentarMensagens("c1", [
      { papel: "agente", texto: "segunda", criado_em: "" },
    ]);
    expect(todas.map((m) => m.texto)).toEqual(["primeira", "segunda"]);
    expect(vi.mocked(putJson).mock.calls[0][2]).toEqual({ ifMatch: '"abc"' });
  });

  it("conflito relê e reaplica uma vez — a segunda escrita não apaga a primeira", async () => {
    vi.mocked(putJson)
      .mockRejectedValueOnce(new ConflitoR2Error("conversas/c1/mensagens.json") as never)
      .mockResolvedValueOnce({ etag: '"nova"' } as never);
    vi.mocked(getJson)
      .mockResolvedValueOnce({ valor: { conversa_id: "c1", mensagens: [] }, etag: null } as never)
      .mockResolvedValueOnce({
        valor: { conversa_id: "c1", mensagens: [{ papel: "eu", texto: "de outra aba", criado_em: "" }] },
        etag: '"x"',
      } as never);

    const todas = await acrescentarMensagens("c1", [
      { papel: "eu", texto: "minha", criado_em: "" },
    ]);
    expect(todas.map((m) => m.texto)).toEqual(["de outra aba", "minha"]);
    expect(putJson).toHaveBeenCalledTimes(2);
  });

  it("o `atualizada_em` do nó sobe depois do R2, nunca antes", async () => {
    const ordem: string[] = [];
    vi.mocked(putJson).mockImplementation((async () => {
      ordem.push("r2");
      return { etag: null };
    }) as never);
    consulta.mockImplementation((async () => {
      ordem.push("neo4j");
      return [];
    }) as never);

    await acrescentarMensagens("c1", [{ papel: "eu", texto: "oi", criado_em: "" }]);
    expect(ordem).toEqual(["r2", "neo4j"]);
    expect(String(consulta.mock.calls[0][0])).toContain("SET c.atualizada_em");
  });

  it("lista vazia não escreve nada", async () => {
    await acrescentarMensagens("c1", []);
    expect(putJson).not.toHaveBeenCalled();
    expect(consulta).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── o título ───────────────────────────

describe("titulo-chat", () => {
  it("o prompt leva a pergunta e a resposta, nesta ordem", () => {
    const p = montarPromptDeTitulo("como eu estava?", "você estava mal");
    expect(p.startsWith(INSTRUCOES_TITULO)).toBe(true);
    expect(p.indexOf("como eu estava?")).toBeLessThan(p.indexOf("você estava mal"));
  });

  it("aceita cerca, aspas e ponto final — e corta no teto", () => {
    expect(parsearTitulo('```json\n{"titulo":"o fim com a Isinha."}\n```')).toBe(
      "o fim com a Isinha",
    );
    expect(parsearTitulo('vou responder: {"titulo":"“a viagem à Canastra”"}')).toBe(
      "a viagem à Canastra",
    );
    expect(parsearTitulo(`{"titulo":"${"x".repeat(200)}"}`)).toHaveLength(TETO_TITULO);
  });

  it("resposta sem JSON não derruba nada: volta vazio", () => {
    expect(parsearTitulo("não sei")).toBe("");
    expect(parsearTitulo('{"titulo": 7}')).toBe("");
  });

  it("carimba a própria versão e corta no teto", async () => {
    chamar.mockResolvedValue(respostaDoModelo('{"titulo":"o fim com a Isinha"}'));
    expect(await titularConversa("p", "r")).toBe("o fim com a Isinha");
    expect(PROMPT_VERSION_TITULO).toBe("titulo-chat-1");
  });

  it("orçamento estourado deixa a conversa sem título, e não quebra a resposta", async () => {
    chamar.mockResolvedValue(respostaDoModelo("", { finishReason: "length" }));
    expect(await titularConversa("p", "r")).toBe("");
  });
});

// ─────────────────────────── a tela ───────────────────────────

describe("o NDJSON que a tela lê", () => {
  /**
   * A rede corta o chunk onde quiser, inclusive no meio de uma linha. Guardar o
   * resto é a única coisa deste componente que erraria em silêncio — o
   * `JSON.parse` de meia linha derrubaria a leitura inteira.
   */
  it("guarda a linha partida no meio para o próximo pedaço", () => {
    const a = partirLinhas('{"tipo":"conversa"}\n{"tipo":"pa');
    expect(a.linhas).toEqual(['{"tipo":"conversa"}']);
    expect(a.resto).toBe('{"tipo":"pa');

    const b = partirLinhas(`${a.resto}sso"}\n`);
    expect(b.linhas).toEqual(['{"tipo":"passo"}']);
    expect(b.resto).toBe("");
  });

  it("linha em branco não vira evento", () => {
    expect(partirLinhas("\n\n{}\n").linhas).toEqual(["{}"]);
  });
});

describe("o progresso e a lista", () => {
  it("a frase do passo diz o que foi buscado e quanto voltou", () => {
    expect(
      frasePasso({
        ferramenta: "buscar_atomos",
        parametros: { texto: "término", entidade: "Isinha", tipo: ["SENTIMENTO"], desde: "2026-07-01" },
        achados: [atomo(), atomo({ id: "a2" })],
      }),
    ).toBe("buscou “término” · sobre Isinha · sentimento · desde 2026-07-01 — 2 trechos");

    expect(frasePasso({ ferramenta: "buscar_atomos", parametros: {}, achados: [] })).toBe(
      "buscou o mais recente — nada",
    );
    expect(
      frasePasso({ ferramenta: "historico_do_atomo", parametros: { atomo_id: "a1" }, achados: [atomo()] }),
    ).toBe("seguiu o que mudou — 1 trecho");
  });

  it("passo que falhou diz o erro em vez da contagem", () => {
    expect(
      frasePasso({
        ferramenta: "buscar_atomos",
        parametros: {},
        achados: [],
        erro: "Neo4j fora do ar",
      }),
    ).toContain("Neo4j fora do ar");
  });

  /**
   * O título gerado vence sempre; o truncamento é o fallback, não o padrão —
   * foi exatamente essa a decisão da entrevista.
   */
  it("o rótulo é o título, e só na falta dele a primeira pergunta cortada", () => {
    expect(rotuloDaConversa(conversa())).toBe("o fim com a Isinha");
    expect(rotuloDaConversa(conversa({ titulo: "" }), "  como   eu estava?  ")).toBe(
      "como eu estava?",
    );
    expect(rotuloDaConversa(conversa({ titulo: "" }))).toBe("conversa sem título");
    expect(rotuloDaConversa(conversa({ titulo: "" }), "p".repeat(200))).toHaveLength(
      TETO_ROTULO + 1,
    );
  });

  it("ativas e arquivadas se separam sem reordenar", () => {
    const cs = [
      conversa({ id: "a" }),
      conversa({ id: "b", arquivada_em: "2026-09-01T00:00:00.000Z" }),
      conversa({ id: "c" }),
    ];
    const { ativas, arquivadas } = separarConversas(cs);
    expect(ativas.map((c) => c.id)).toEqual(["a", "c"]);
    expect(arquivadas.map((c) => c.id)).toEqual(["b"]);
  });

  it("a lista mostra o dia, não a hora", () => {
    expect(diaCurto("2026-09-13T18:00:00.000Z")).toBe("13/09");
    expect(diaCurto("")).toBe("");
  });
});
