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
vi.mock("@/lib/neo4j", () => ({
  query: vi.fn(async () => []),
  queryUm: vi.fn(async () => null),
  // `consultar_grafo` passa por `consulta.ts` de verdade: o EXPLAIN e a execução
  // chegam aqui, e o caso diz o que o banco responde.
  executar: vi.fn(async () => ({ fields: [], values: [], queryType: "r", notifications: [] })),
  Neo4jError: class Neo4jError extends Error {
    constructor(
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  },
}));
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
  PISO_ENTIDADE,
  TETO_ENTIDADES,
  buscarAtomos,
  buscarEntidades,
  chamadasFeitas,
  respostaDasEntidades,
  textoDaFicha,
  tipoDeEntidade,
  leituraDaPergunta,
  linhaDoRecorte,
  dataSimples,
  diaEmCypher,
  ferramentas,
  historicoDoAtomo,
  linhaDeAtomo,
  montarSistema,
  paraOModelo,
  parametrosLimpos,
  respostaDaBusca,
  respostaDoHistorico,
  responder,
  somarUso,
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
import { dataCurta } from "@/lib/dia";
import {
  TETO_ROTULO,
  celulaDoRastro,
  frasePasso,
  fraseRecorte,
  partirLinhas,
  rotuloDaConversa,
  rotuloDasLinhas,
  separarConversas,
  sessaoDoAtomo,
  trechosDoRastro,
} from "@/components/Chat";
import { chaveMensagens, chavePromptAgente } from "@/lib/chaves";
import { AGENTE_IDS, FERRAMENTAS_CHAT, ehAgenteId } from "@/lib/tipos";
import { acharPorChave, listarEntidades } from "@/lib/entidades";
import { embutir } from "@/lib/embedding";
import { ConflitoR2Error, getJson, putJson, remover } from "@/lib/r2";
import { executar, query, queryUm } from "@/lib/neo4j";
import type {
  AtomoAchado,
  Conversa,
  EntidadeAchada,
  Mensagem,
  PassoDeFerramenta,
} from "@/lib/tipos";

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

  it("o prompt do chat continua nomeando as cinco ferramentas", () => {
    // É o envelope deste agente: o parser dele é o loop de tool-calling, e um
    // prompt que não cita a ferramenta é um prompt que a desliga.
    for (const f of FERRAMENTAS_CHAT) expect(INSTRUCOES).toContain(f);
  });

  it("o schema do prompt não ensina o que nunca existiu, nem a conversa", () => {
    // Consulta que atravessa um rótulo que nunca ganhou migration não erra: volta
    // vazia, e parece resposta (CLAUDE.md). E :Conversa a trava recusa.
    expect(INSTRUCOES).not.toMatch(/Foco|:Pergunta|ENVOLVIDA_EM|CONTRIBUI_PARA|APONTA_PARA/);
    expect(INSTRUCOES).not.toContain("Conversa");
  });

  it("o prompt ensina o dia de Brasília, e não o corte do ISO", () => {
    expect(INSTRUCOES).toContain("timezone: 'America/Sao_Paulo'");
    // `left(a.valido_em, 10)` só aparece como o erro que é.
    for (const linha of INSTRUCOES.split("\n").filter((l) => l.includes("left(a.valido_em, 10)"))) {
      expect(linha).toContain("erra o dia");
    }
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
   * O dia e não o instante: o parâmetro é uma data e o campo é um instante — sem
   * a conversão, `<= '2026-08-31'` excluiria tudo que aconteceu no próprio dia
   * 31. E o dia de Brasília, não o de Greenwich (slice 12): `left(valido_em, 10)`
   * punha a sessão das 22h do dia 31 em setembro.
   */
  it("o período compara o dia de Brasília com a data, e átomo sem data fica de fora", async () => {
    await buscarAtomos({ desde: "2026-08-01", ate: "2026-08-31" });
    const [cypher, parametros] = consulta.mock.calls[0];
    expect(String(cypher)).toContain(`${diaEmCypher("a.valido_em")} >= $desde`);
    expect(String(cypher)).toContain(`${diaEmCypher("a.valido_em")} <= $ate`);
    expect(diaEmCypher("a.valido_em")).toContain("timezone: 'America/Sao_Paulo'");
    expect(String(cypher)).not.toContain("left(a.valido_em, 10)");
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

  /**
   * O ▶ do (i) precisa do segundo do áudio (onda 3 da interface). Ele vem da
   * primeira âncora, e só a tela o lê: o texto que vai ao modelo não muda.
   */
  it("a primeira âncora vem nos dois caminhos e no histórico, e o modelo não a lê", async () => {
    await buscarAtomos({});
    await buscarAtomos({ texto: "x" });
    await historicoDoAtomo("a1");
    for (const [cypher] of consulta.mock.calls.slice(0, 3)) {
      expect(String(cypher)).toContain("a.inicios_s[0] AS inicio_s, a.fins_s[0] AS fim_s");
    }

    consulta.mockResolvedValue([
      { id: "a1", texto: "t", tipo: "FATO", valido_em: "", sobre: [], cita: [], inicio_s: 192.4, fim_s: 199.1 },
      { id: "a2", texto: "u", tipo: "FATO", valido_em: "", sobre: [], cita: [], inicio_s: null, fim_s: null },
    ] as never);
    const r = await buscarAtomos({});
    expect(r.achados[0]).toMatchObject({ inicio_s: 192.4, fim_s: 199.1 });
    expect(r.achados[1]).not.toHaveProperty("inicio_s");
    expect(r.achados[1]).not.toHaveProperty("fim_s");
    expect(linhaDeAtomo(r.achados[0])).not.toContain("192");
  });
});

/**
 * O que a slice 9 trouxe para a busca: ela diz quanto cortou, e diz de que vazio
 * se trata. O detalhe que erraria calado é que os dois caminhos não contam a
 * mesma coisa — com texto, a conta é dentro da janela do índice, e escrever
 * "8 de 34" ali seria trocar um silêncio por uma mentira.
 */
describe("o recorte da busca", () => {
  it("as entidades se penduram depois do corte, nos dois caminhos", async () => {
    await buscarAtomos({});
    await buscarAtomos({ texto: "x" });
    for (const [cypher] of consulta.mock.calls) {
      const c = String(cypher);
      expect(c).not.toContain("LIMIT");
      expect(c.indexOf("[0..$limite]")).toBeGreaterThan(-1);
      expect(c.indexOf("[0..$limite]")).toBeLessThan(c.indexOf("OPTIONAL MATCH"));
    }
  });

  it("sem texto, o total é do diário", async () => {
    consulta.mockResolvedValue([
      { id: "a1", texto: "t", tipo: "FATO", valido_em: "2026-08-01", sobre: [], cita: [], total: 34 },
    ] as never);
    const r = await buscarAtomos({ tipo: ["FATO"] });
    expect(r.recorte).toEqual({ total: 34, mostrados: 1, filtrado: true });
    expect(linhaDoRecorte(r.recorte!)).toBe(
      "mostrando 1 de 34 trechos com esses filtros, os mais recentes primeiro.",
    );
  });

  it("com texto, a conta diz que é dentro da janela, não do diário", async () => {
    consulta.mockResolvedValue([
      {
        id: "a1", texto: "t", tipo: "FATO", valido_em: "", sobre: [], cita: [], similaridade: 0.6,
        total: 19, janela: 48, acima_do_piso: 19, melhor_abaixo: 0.44,
      },
    ] as never);
    const r = await buscarAtomos({ texto: "x" });
    expect(r.recorte).toMatchObject({ total: 19, mostrados: 1, janela: 48, piso: PISO_BUSCA });
    const linha = linhaDoRecorte(r.recorte!);
    expect(linha).toContain("mostrando 1 de 19");
    expect(linha).toContain("entre os 48 trechos mais parecidos");
    expect(linha).toContain("não no diário inteiro");
  });

  it("a linha de busca vazia carrega os números e não vira átomo", async () => {
    consulta.mockResolvedValue([
      { id: null, texto: null, tipo: null, valido_em: "", sobre: [], cita: [], total: 0, janela: 48, acima_do_piso: 0, melhor_abaixo: 0.41 },
    ] as never);
    const r = await buscarAtomos({ texto: "x" });
    expect(r.achados).toEqual([]);
    expect(r.recorte).toMatchObject({ total: 0, acima_do_piso: 0, melhor_abaixo: 0.41 });
  });

  it("as três causas de vazio deixam de ser uma frase só", () => {
    const piso = linhaDoRecorte({
      total: 0, mostrados: 0, janela: 48, acima_do_piso: 0, melhor_abaixo: 0.41, piso: 0.45,
    });
    expect(piso).toContain("nada passou do piso");
    expect(piso).toContain("0.41");
    expect(piso).toContain("alargar período ou tipo não muda nada");

    const filtro = linhaDoRecorte({
      total: 0, mostrados: 0, janela: 48, acima_do_piso: 19, melhor_abaixo: 0.44, piso: 0.45, filtrado: true,
    });
    expect(filtro).toContain("o filtro cortou");
    expect(filtro).toContain("19 passaram do piso");

    expect(linhaDoRecorte({ total: 0, mostrados: 0, filtrado: true })).toContain(
      "nenhum trecho com esses filtros",
    );
  });

  it("o modelo lê o recorte antes dos trechos", () => {
    const s = respostaDaBusca({
      achados: [atomo()],
      recorte: { total: 34, mostrados: 1, filtrado: false },
    });
    expect(s.split("\n")[0]).toBe("mostrando 1 de 34 trechos, os mais recentes primeiro.");
    expect(s.split("\n")[1]).toContain("[id a1");
  });

  it("o passo do (i) guarda o recorte e a duração", async () => {
    consulta.mockResolvedValue([
      { id: "a1", texto: "t", tipo: "FATO", valido_em: "", sobre: [], cita: [], total: 3 },
    ] as never);
    const passos: PassoDeFerramenta[] = [];
    await ferramentas((p) => passos.push(p)).buscar_atomos.execute!({} as never, {} as never);
    expect(passos[0].recorte).toMatchObject({ total: 3, mostrados: 1 });
    expect(passos[0].duracao_ms).toBeTypeOf("number");
  });
});

/**
 * Decisão 4: o catálogo e o vetor, uma vez por pergunta. Com o teto de oito
 * chamadas eram até oito de cada — e `embutir` não tem escada de repetição.
 */
describe("o que a pergunta lê uma vez só", () => {
  it("o catálogo é lido uma vez para várias buscas por entidade", async () => {
    achar.mockReturnValue({ id: "e1", nome: "Isinha", chaves: ["isinha"] } as never);
    const leitura = leituraDaPergunta();
    await buscarAtomos({ entidade: "Isinha" }, leitura);
    await buscarAtomos({ entidade: "Isa" }, leitura);
    expect(catalogo).toHaveBeenCalledTimes(1);
  });

  it("o mesmo texto embute uma vez, mesmo em paralelo; texto diferente embute de novo", async () => {
    const leitura = leituraDaPergunta();
    await Promise.all([
      buscarAtomos({ texto: "isinha" }, leitura),
      buscarAtomos({ texto: "isinha", tipo: ["FATO"] }, leitura),
    ]);
    await buscarAtomos({ texto: "término" }, leitura);
    expect(embutir).toHaveBeenCalledTimes(2);
  });

  it("falha não fica guardada: a próxima busca tenta de novo", async () => {
    vi.mocked(embutir).mockRejectedValueOnce(new Error("429") as never);
    const leitura = leituraDaPergunta();
    await expect(buscarAtomos({ texto: "x" }, leitura)).rejects.toThrow("429");
    await buscarAtomos({ texto: "x" }, leitura);
    expect(embutir).toHaveBeenCalledTimes(2);
  });

  it("uma resposta inteira lê o catálogo uma vez, por mais buscas que faça", async () => {
    achar.mockReturnValue({ id: "e1", nome: "Isinha", chaves: ["isinha"] } as never);
    chamar.mockImplementation((async (opcoes: {
      tools: Record<string, { execute: (a: unknown, b: unknown) => Promise<unknown> }>;
    }) => {
      await opcoes.tools.buscar_atomos.execute({ entidade: "Isinha" }, {});
      await opcoes.tools.buscar_atomos.execute({ entidade: "Isinha", tipo: ["FATO"] }, {});
      return respostaDoModelo("pronto");
    }) as never);
    await responder([{ papel: "eu", texto: "x", criado_em: "" }]);
    expect(catalogo).toHaveBeenCalledTimes(1);
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

  /**
   * Slice 5.2: a camada sutil é ligação provável, e uma cadeia de prováveis
   * não é história. O caminho longo só atravessa aresta forte; a sutil entra
   * um salto, a partir do átomo dado.
   */
  it("o caminho longo só atravessa aresta forte, e a sutil anda um salto", async () => {
    await historicoDoAtomo("a1");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain(
      "all(r IN relationships(p) WHERE coalesce(r.camada, 'forte') = 'forte')",
    );
    expect(cypher).toContain(
      "OPTIONAL MATCH (raiz)-[s1:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]-(v:Atomo)",
    );
    expect(cypher).toContain("s1.camada = 'sutil'");
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
          { de: "a2", para: "a1", tipo: "ATUALIZA", camada: "forte", motivo: "mudou de ideia", confianca: 0.8 },
          { de: "a2", para: "a1", tipo: "INVENTADA", camada: "forte", motivo: "", confianca: 0.9 },
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
      { de: "a2", para: "a1", tipo: "ATUALIZA", camada: "forte", motivo: "mudou de ideia", confianca: 0.8 },
    ]);
    expect(String(consulta.mock.calls[1][0])).toContain("coalesce(r.camada, 'forte') AS camada");
  });
});

// ─────────────────────────── ferramenta 3 ───────────────────────────

/** Uma entrada de catálogo, no formato de `listarEntidades`. */
const entrada = (extra: Record<string, unknown> = {}) => ({
  id: "e1",
  nome: "Isinha",
  nome_normalizado: "isinha",
  chaves: ["isinha", "isa"],
  tipo: "Pessoa",
  sessoes: 5,
  atomos: 13,
  aliases: ["Isa"],
  resumo: "ex-namorada; terminamos em julho",
  canonico: false,
  perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
  ...extra,
});

const ficha = (extra: Partial<EntidadeAchada> = {}): EntidadeAchada => ({
  id: "e1",
  nome: "Isinha",
  tipo: "Pessoa",
  aliases: [],
  resumo: "",
  perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
  atomos: 13,
  sessoes: 5,
  primeira: "2026-06-01",
  ultima: "2026-09-20",
  junto_com: [],
  ...extra,
});

/**
 * A ficha que as slices 4.11 e 4.12 construíram era ilegível para o chat. O que
 * erraria calado aqui: a co-ocorrência virar travessia de aresta que não existe
 * (volta vazia sempre), a ficha vazia ser lida como "nada a saber", e a busca
 * por sentido usar o piso do espaço errado.
 */
describe("buscar_entidades", () => {
  it("por nome, casa a grafia pelo catálogo e lê a ficha com a co-ocorrência", async () => {
    catalogo.mockResolvedValue([entrada()] as never);
    achar.mockReturnValue(entrada() as never);
    porCypher([
      [
        /UNWIND \$ids AS id/,
        [{ id: "e1", primeira: "2026-06-01", ultima: "2026-09-20", junto_com: [{ nome: "Murta", vezes: 3 }] }],
      ],
    ]);

    const r = await buscarEntidades({ nome: "Isa" });
    expect(r.entidades).toHaveLength(1);
    expect(r.entidades[0]).toMatchObject({
      nome: "Isinha",
      resumo: "ex-namorada; terminamos em julho",
      junto_com: [{ nome: "Murta", vezes: 3 }],
      primeira: "2026-06-01",
    });
    const cypher = String(consulta.mock.calls[0][0]);
    // Co-ocorrência sobre átomo, nunca aresta entre entidades.
    expect(cypher).toContain("(a)-[:SOBRE|:MENCIONA]->(o:Entidade)");
    expect(cypher).not.toMatch(/ENVOLVIDA_EM|CONTRIBUI_PARA|APONTA_PARA/);
    expect(cypher).toContain("(f:Entidade)-[:FUNDIDA_EM]->(e)");
    expect(cypher).toContain("coalesce(a.status, 'ativo') = 'ativo'");
  });

  it("sem grafia exata, devolve as parecidas e diz que foram parecidas", async () => {
    catalogo.mockResolvedValue([entrada({ nome: "Isabela Prado", chaves: ["isabela prado"] })] as never);
    achar.mockReturnValue(undefined as never);
    const r = await buscarEntidades({ nome: "Isabela" });
    expect(r.parecidas).toBe(true);
    expect(respostaDasEntidades(r)).toContain("nenhuma se chama exatamente assim");
  });

  it("nome que não existe nem parecido volta com aviso, sem consultar o banco", async () => {
    catalogo.mockResolvedValue([entrada()] as never);
    achar.mockReturnValue(undefined as never);
    const r = await buscarEntidades({ nome: "Zuleica" });
    expect(r.entidades).toEqual([]);
    expect(r.aviso).toContain("Zuleica");
    expect(consulta).not.toHaveBeenCalled();
  });

  it("por texto, usa o índice de entidade e o piso do perfil, não o da busca de átomo", async () => {
    catalogo.mockResolvedValue([
      entrada(),
      entrada({ id: "e2", nome: "Phronesis", tipo: "Projeto", chaves: ["phronesis"] }),
    ] as never);
    porCypher([
      [/UNWIND \$ids AS id/, []],
      [
        /entidade_embedding/,
        [
          { id: "e2", similaridade: 0.6 },
          { id: "e1", similaridade: 0.5 },
          { id: "e9", similaridade: PISO_ENTIDADE - 0.01 },
        ],
      ],
    ]);

    const r = await buscarEntidades({ texto: "diário falado", tipo: "Projeto" });
    expect(String(consulta.mock.calls[0][0])).toContain("queryNodes('entidade_embedding'");
    expect(PISO_ENTIDADE).not.toBe(PISO_BUSCA);
    expect(r.entidades.map((e) => e.nome)).toEqual(["Phronesis"]);
    expect(r.entidades[0].similaridade).toBe(0.6);
    expect(r.recorte).toMatchObject({
      total: 1, mostrados: 1, janela: 3, acima_do_piso: 2, filtrado: true, piso: PISO_ENTIDADE,
    });
  });

  it("nada acima do piso diz qual foi a melhor, e manda procurar nos trechos", async () => {
    catalogo.mockResolvedValue([entrada()] as never);
    porCypher([[/entidade_embedding/, [{ id: "e1", similaridade: 0.2 }]]]);
    const s = respostaDasEntidades(await buscarEntidades({ texto: "contabilidade" }));
    expect(s).toContain("nenhuma ficha passou do piso");
    expect(s).toContain("0.20");
    expect(s).toContain("buscar_atomos");
  });

  it("sem nome nem texto, lista as mais faladas do tipo, sem o eu, e nomeia as que sobraram", async () => {
    const projetos = Array.from({ length: TETO_ENTIDADES + 2 }, (_, i) =>
      entrada({ id: `p${i}`, nome: `Projeto ${i}`, nome_normalizado: `projeto ${i}`, tipo: "Projeto" }),
    );
    catalogo.mockResolvedValue([
      entrada({ id: "eu", nome: "eu", nome_normalizado: "eu", tipo: "Projeto" }),
      ...projetos,
      entrada(),
    ] as never);

    const r = await buscarEntidades({ tipo: "projeto" as never });
    expect(r.entidades).toHaveLength(TETO_ENTIDADES);
    expect(r.entidades.map((e) => e.nome)).not.toContain("eu");
    expect(r.outras).toEqual(["Projeto 5", "Projeto 6"]);
    expect(r.recorte).toMatchObject({ total: TETO_ENTIDADES + 2, mostrados: TETO_ENTIDADES });
    expect(respostaDasEntidades(r)).toContain("As outras: Projeto 5, Projeto 6.");
  });

  it("tipo em qualquer caixa e acento casa; tipo inventado é ignorado", () => {
    expect(tipoDeEntidade("organização")).toBe("Organizacao");
    expect(tipoDeEntidade("PESSOA")).toBe("Pessoa");
    expect(tipoDeEntidade("projetos")).toBeNull();
  });

  it("ficha vazia é dita, e não omitida", () => {
    const s = textoDaFicha(ficha());
    expect(s).toContain("ficha vazia");
    expect(s).toContain("13 trecho(s) em 5 sessão(ões), de 2026-06-01 a 2026-09-20");
  });

  it("ficha escrita mostra só os campos preenchidos, e quem co-ocorre", () => {
    const s = textoDaFicha(
      ficha({
        resumo: "ex-namorada",
        perfil: { contexto: "", pode_ajudar_com: "design", fizemos_juntos: "" },
        junto_com: [{ nome: "Murta", vezes: 3 }],
      }),
    );
    expect(s).toContain("resumo: ex-namorada");
    expect(s).toContain("pode ajudar com: design");
    expect(s).not.toContain("contexto:");
    expect(s).not.toContain("ficha vazia");
    expect(s).toContain("aparece junto com: Murta (3)");
  });

  it("entidade e átomo na mesma pergunta leem o catálogo uma vez só", async () => {
    catalogo.mockResolvedValue([entrada()] as never);
    achar.mockReturnValue(entrada() as never);
    chamar.mockImplementation((async (opcoes: {
      tools: Record<string, { execute: (a: unknown, b: unknown) => Promise<unknown> }>;
    }) => {
      await opcoes.tools.buscar_entidades.execute({ nome: "Isinha" }, {});
      await opcoes.tools.buscar_atomos.execute({ entidade: "Isinha" }, {});
      return respostaDoModelo("pronto");
    }) as never);

    const r = await responder([{ papel: "eu", texto: "quem é a Isinha?", criado_em: "" }]);
    expect(catalogo).toHaveBeenCalledTimes(1);
    expect(r.rastro.map((p) => p.ferramenta)).toEqual(["buscar_entidades", "buscar_atomos"]);
    expect(r.rastro[0].entidades?.[0].nome).toBe("Isinha");
    expect(r.rastro[0].achados).toEqual([]);
  });

  it("falha vira texto para o modelo, nunca exceção", async () => {
    catalogo.mockRejectedValue(new Error("Neo4j fora do ar") as never);
    const passos: PassoDeFerramenta[] = [];
    const s = await ferramentas((p) => passos.push(p)).buscar_entidades.execute!(
      {} as never,
      {} as never,
    );
    expect(String(s)).toContain("Neo4j fora do ar");
    expect(passos[0].erro).toContain("Neo4j fora do ar");
  });
});

// ─────────────────────── o que volta ao modelo ───────────────────────

describe("o texto que a ferramenta devolve", () => {
  it("cada linha carrega o id, porque é por ele que o histórico é pedido", () => {
    expect(linhaDeAtomo(atomo())).toContain("[id a1 · FATO · 2026-07-02 · sobre: Isinha]");
  });

  it("a data é o dia de Brasília: a sessão das 22h não vira o dia seguinte", () => {
    expect(linhaDeAtomo(atomo({ valido_em: "2026-07-03T01:30:00.000Z" }))).toContain("· FATO · 2026-07-02 ·");
    expect(linhaDeAtomo(atomo({ valido_em: "" }))).toContain("· FATO · sem data ·");
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
      elos: [{ de: "a2", para: "a1", tipo: "ATUALIZA", camada: "forte", motivo: "mudou", confianca: 0.8 }],
    });
    expect(s).toContain("RELAÇÕES (o mais novo → o mais antigo;");
    expect(s).toContain("a2 ATUALIZA a1 — mudou");
  });

  it("a relação sutil vem marcada, para o modelo a dizer como provável", () => {
    const s = respostaDoHistorico({
      achados: [atomo({ id: "a1" }), atomo({ id: "a2" })],
      elos: [
        { de: "a2", para: "a1", tipo: "COMPLEMENTA", camada: "sutil", motivo: "aqui: x; ali: y", confianca: 0.6 },
      ],
    });
    expect(s).toContain("a2 COMPLEMENTA (sutil) a1 — aqui: x; ali: y");
    expect(s).toContain('"sutil" é ligação provável');
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
        elos: [{ de: "a2", para: "a1", tipo: "ATUALIZA", camada: "forte", motivo: "mudou", confianca: 0.8 }],
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
    // Abaixo da linha do recorte, o átomo repetido é só a lembrança.
    expect(String(segunda).split("\n").at(-1)).toBe("[id a1] já mostrado acima");
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

// ─────────────────────── consultar_grafo (slice 12) ───────────────────────

describe("consultar_grafo", () => {
  const banco = vi.mocked(executar);
  /** O que cada ida ao banco recebeu: o EXPLAIN primeiro, depois a execução. */
  const idas = () => banco.mock.calls.map(([statement, parametros]) => ({ statement, parametros }));

  beforeEach(() => {
    banco.mockReset();
    banco.mockImplementation((async (statement: string) =>
      statement.startsWith("EXPLAIN ")
        ? { fields: [], values: [], queryType: "r", notifications: [] }
        : {
            fields: ["pessoa", "afetivos"],
            values: [["Nicole Borsato", 15], ["Isinha", 6]],
            queryType: "r",
            notifications: [],
          }) as never);
  });

  const cypher = "MATCH (p:Pessoa) RETURN p.nome AS pessoa, 1 AS afetivos";
  const busca =
    "MATCH (a:Atomo) SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 5) SCORE AS s RETURN a.id AS id";

  it("devolve a tabela ao modelo, e o rastro guarda a Cypher e as linhas", async () => {
    const passos: PassoDeFerramenta[] = [];
    const f = ferramentas((p) => passos.push(p));

    const r = await f.consultar_grafo.execute!({ cypher } as never, {} as never);
    expect(r).toBe("2 linhas.\npessoa | afetivos\nNicole Borsato | 15\nIsinha | 6");
    expect(passos).toHaveLength(1);
    expect(passos[0]).toMatchObject({
      ferramenta: "consultar_grafo",
      parametros: {},
      achados: [],
      consulta: {
        cypher,
        colunas: ["pessoa", "afetivos"],
        linhas: [["Nicole Borsato", 15], ["Isinha", 6]],
        total: 2,
        cortado: false,
      },
    });
    expect(passos[0].erro).toBeUndefined();
    expect(passos[0].duracao_ms).toBeTypeOf("number");
  });

  it("$hoje é o dia de Brasília — às 22h de lá, Greenwich já virou o dia", async () => {
    const f = ferramentas(undefined, undefined, leituraDaPergunta(), new Date("2026-10-14T01:00:00.000Z"));
    await f.consultar_grafo.execute!({ cypher: "RETURN date($hoje) AS d" } as never, {} as never);
    expect(idas().map((i) => i.parametros)).toEqual([{ hoje: "2026-10-13" }, { hoje: "2026-10-13" }]);
  });

  it("responder passa o seu relógio às ferramentas", async () => {
    chamar.mockImplementation((async (opcoes: { tools: Record<string, { execute: Function }> }) => {
      await opcoes.tools.consultar_grafo.execute({ cypher: "RETURN $hoje AS d" }, {});
      return respostaDoModelo("ok");
    }) as never);
    await responder([{ papel: "eu", texto: "que dia é hoje?", criado_em: "" }], {
      agora: new Date("2026-10-14T02:30:00.000Z"),
    });
    expect(idas()[1].parametros).toEqual({ hoje: "2026-10-13" });
  });

  it("com texto e $vetor, o vetor vem da porta de embedding e o texto vai ao rastro", async () => {
    const passos: PassoDeFerramenta[] = [];
    const f = ferramentas((p) => passos.push(p));

    await f.consultar_grafo.execute!({ cypher: busca, texto: " medo, receio " } as never, {} as never);
    expect(embutir).toHaveBeenCalledWith("medo, receio");
    expect(idas()[1].parametros).toMatchObject({ vetor: [0.1, 0.2] });
    expect(passos[0].parametros).toEqual({ texto: "medo, receio" });
    expect(passos[0].consulta?.texto).toBe("medo, receio");
  });

  it("texto sem $vetor na consulta não chama o embedding", async () => {
    const f = ferramentas();
    await f.consultar_grafo.execute!({ cypher, texto: "medo" } as never, {} as never);
    expect(embutir).not.toHaveBeenCalled();
    expect(idas()[1].parametros).toEqual({ hoje: expect.any(String) });
  });

  it("a recusa vai ao modelo como texto e ao rastro como erro, com a Cypher", async () => {
    const passos: PassoDeFerramenta[] = [];
    const f = ferramentas((p) => passos.push(p));

    const r = await f.consultar_grafo.execute!({ cypher: "MATCH (c:Conversa) RETURN c" } as never, {} as never);
    expect(String(r)).toMatch(/^recusada: :Conversa/);
    expect(banco).not.toHaveBeenCalled();
    expect(passos[0].erro).toBe(r);
    expect(passos[0].consulta).toMatchObject({ cypher: "MATCH (c:Conversa) RETURN c", total: 0 });
  });

  it("a escrita para no EXPLAIN — a execução nunca é chamada", async () => {
    banco.mockResolvedValue({ fields: [], values: [], queryType: "rw", notifications: [] } as never);
    const f = ferramentas();
    const r = await f.consultar_grafo.execute!({ cypher: "CREATE (x:Teste) RETURN x" } as never, {} as never);
    expect(String(r)).toContain("nada foi executado");
    expect(idas().map((i) => i.statement)).toEqual(["EXPLAIN CREATE (x:Teste) RETURN x"]);
  });

  it("falha que não é da consulta — o embedding, a rede — vira texto, nunca exceção", async () => {
    vi.mocked(embutir).mockRejectedValueOnce(new Error("429 do Gateway"));
    const passos: PassoDeFerramenta[] = [];
    const f = ferramentas((p) => passos.push(p));

    const r = await f.consultar_grafo.execute!({ cypher: busca, texto: "x" } as never, {} as never);
    expect(String(r)).toBe("a consulta falhou: 429 do Gateway");
    expect(passos[0].erro).toBe("429 do Gateway");
    expect(passos[0].consulta?.cypher).toContain("SEARCH");
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
    // Às 22h de Brasília, Greenwich já está no dia seguinte (slice 12).
    expect(montarSistema("P", new Date("2026-09-14T01:00:00.000Z"))).toContain("Hoje é 2026-09-13.");
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
    // A lista dos tipos e o conjunto oferecido são a mesma: ferramenta nova que
    // entra numa e não na outra é o (i) desenhando o que o modelo não pode chamar.
    expect(Object.keys(pedido.tools as object)).toEqual([...FERRAMENTAS_CHAT]);
    expect(FERRAMENTAS_CHAT).toContain("consultar_grafo");
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

  it("parou no teto pedindo ferramenta: o pensamento não é resposta, a síntese é", async () => {
    // O deepseek na comparação da slice 12: oito chamadas, `finishReason`
    // tool-calls, texto em branco e o plano da próxima busca no pensamento.
    chamar
      .mockResolvedValueOnce(
        respostaDoModelo("\n\n", {
          finishReason: "tool-calls",
          reasoningText: "Let me fetch the full texts of a few.",
          steps: [{ toolCalls: [1, 2, 3, 4, 5, 6, 7, 8] }],
        }),
      )
      .mockResolvedValueOnce(respostaDoModelo("os dois que mais aparecem são…"));
    const r = await responder([{ papel: "eu", texto: "x", criado_em: "" }]);
    expect(chamar).toHaveBeenCalledTimes(2);
    expect(r.texto).toBe("os dois que mais aparecem são…");
  });

  it("a síntese que ainda pede ferramenta é erro dito, e não o pensamento na tela", async () => {
    const pedindo = respostaDoModelo("", {
      finishReason: "tool-calls",
      reasoningText: "Let me run one more query.",
      steps: [{ toolCalls: [1, 2, 3, 4, 5, 6, 7, 8] }],
    });
    chamar.mockResolvedValueOnce(pedindo).mockResolvedValueOnce(pedindo);
    await expect(responder([{ papel: "eu", texto: "x", criado_em: "" }])).rejects.toThrow(
      /pediu mais uma em vez de escrever/,
    );
  });

  it("o modelo dado direto vence o painel, com o prompt da base", async () => {
    // A comparação de modelos mede a base do git: um override salvo no painel
    // misturaria as duas coisas.
    vi.mocked(getJson).mockResolvedValue({
      overrides: { chat: { modelo: "outro/do-painel", prompt_hash: "a1b2c3d4" } },
    } as never);
    chamar.mockResolvedValue(respostaDoModelo("pronto"));
    const r = await responder([{ papel: "eu", texto: "x", criado_em: "" }], {
      modelo: "anthropic/claude-sonnet-5.5",
    });
    const pedido = chamar.mock.calls[0][0] as { model: string; system: string };
    expect(pedido.model).toBe("anthropic/claude-sonnet-5.5");
    expect(pedido.system.startsWith(INSTRUCOES)).toBe(true);
    expect(r.prompt_version).toBe(PROMPT_VERSION_CHAT);
  });

  it("o uso soma o loop e a síntese, e o que ninguém disse fica nulo", async () => {
    chamar
      .mockResolvedValueOnce(
        respostaDoModelo("", {
          steps: [{ toolCalls: [1, 2, 3, 4, 5, 6, 7, 8] }],
          totalUsage: { inputTokens: 1000, outputTokens: 200, outputTokenDetails: { reasoningTokens: 150 } },
        }),
      )
      .mockResolvedValueOnce(
        respostaDoModelo("síntese", { totalUsage: { inputTokens: 1500, outputTokens: 80 } }),
      );
    const r = await responder([{ papel: "eu", texto: "x", criado_em: "" }]);
    expect(r.uso).toEqual({ entrada: 2500, saida: 280, raciocinio: 150 });
    expect(somarUso([{}])).toEqual({ entrada: null, saida: null, raciocinio: null });
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

  it("com recorte, o passo diz quanto mostrou de quanto achou, e de onde veio a conta", () => {
    const passo: PassoDeFerramenta = {
      ferramenta: "buscar_atomos",
      parametros: { texto: "prioridades", tipo: ["DECISAO"] },
      achados: [atomo(), atomo({ id: "a2" })],
      recorte: {
        total: 5, mostrados: 2, janela: 48, acima_do_piso: 19, melhor_abaixo: 0.44, piso: 0.45, filtrado: true,
      },
      duracao_ms: 1234,
    };
    expect(frasePasso(passo)).toBe("buscou “prioridades” · decisao — 2 de 5 trechos");
    expect(fraseRecorte(passo)).toBe(
      "19 de 48 mais parecidos passaram do piso 0.45 · 5 passaram também nos filtros · 29 abaixo, o melhor em 0.44 · 1,2 s",
    );
    // Mensagem gravada antes da slice 9: sem recorte, sem linha nova.
    expect(fraseRecorte({ ferramenta: "buscar_atomos", parametros: {}, achados: [] })).toBe("");
  });

  it("o passo de entidade fala de fichas, não de trechos", () => {
    expect(
      frasePasso({
        ferramenta: "buscar_entidades",
        parametros: { texto: "contabilidade", tipo: "Pessoa" },
        achados: [],
        entidades: [ficha()],
      }),
    ).toBe("procurou “contabilidade” · pessoa — 1 ficha");
    expect(frasePasso({ ferramenta: "buscar_entidades", parametros: {}, achados: [] })).toBe(
      "procurou as mais faladas — nada",
    );
  });

  it("o passo de consulta fala de linhas, e diz o corte", () => {
    const passo = (consulta: Partial<NonNullable<PassoDeFerramenta["consulta"]>>, erro?: string) =>
      frasePasso({
        ferramenta: "consultar_grafo",
        parametros: {},
        achados: [],
        consulta: { cypher: "MATCH …", colunas: [], linhas: [], total: 0, cortado: false, ...consulta },
        ...(erro ? { erro } : {}),
      });
    expect(passo({ linhas: [[1], [2]], total: 15 })).toBe("consultou o grafo — 15 linhas");
    expect(passo({ linhas: [[1]], total: 1 })).toBe("consultou o grafo — 1 linha");
    expect(passo({ linhas: Array.from({ length: 150 }, () => [1]), total: 412, cortado: true })).toBe(
      "consultou o grafo — cortado em 150 de 412",
    );
    expect(passo({})).toBe("consultou o grafo — nada");
    // O erro de sintaxe ecoa a consulta inteira; a linha de progresso leva o começo.
    const longo = `erro de sintaxe — ${"x".repeat(300)}\n"EXPLAIN MATCH"`;
    const frase = passo({}, longo);
    expect(frase.startsWith("consultou o grafo — erro de sintaxe")).toBe(true);
    expect(frase.length).toBeLessThan(160);
    expect(frase).not.toContain("EXPLAIN");
  });

  it("o (i) oferece as linhas que o modelo leu, e diz de quantas quando cortou", () => {
    const c = (linhas: unknown[][], total: number, cortado = false) => ({
      cypher: "MATCH …",
      colunas: ["x"],
      linhas,
      total,
      cortado,
    });
    expect(rotuloDasLinhas(c([[1], [2]], 2), false)).toBe("ver as 2 linhas ▸");
    expect(rotuloDasLinhas(c([[1]], 1), true)).toBe("ver a linha ▾");
    expect(rotuloDasLinhas(c([[1], [2]], 412, true), false)).toBe("ver as 2 de 412 linhas ▸");
  });

  it("a célula do (i) lê lista como texto, e vazio como traço", () => {
    expect(celulaDoRastro("Nicole")).toBe("Nicole");
    expect(celulaDoRastro(0.51)).toBe("0.51");
    expect(celulaDoRastro(["Nicole", "Isinha"])).toBe("Nicole, Isinha");
    expect(celulaDoRastro([])).toBe("—");
    expect(celulaDoRastro(null)).toBe("—");
    expect(celulaDoRastro("")).toBe("—");
    expect(celulaDoRastro({ _labels: ["Pessoa"], nome: "Nicole" })).toBe(
      '{"_labels":["Pessoa"],"nome":"Nicole"}',
    );
  });

  it("mensagem gravada antes da consulta existir continua desenhando o passo", () => {
    expect(frasePasso({ ferramenta: "consultar_grafo", parametros: {}, achados: [] })).toBe(
      "consultou o grafo — nada",
    );
    expect(frasePasso({ ferramenta: "historico_do_atomo", parametros: {}, achados: [atomo()] })).toBe(
      "seguiu o que mudou — 1 trecho",
    );
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

  /**
   * O (i) abre pelos trechos (onda 3 da interface): todo átomo que as chamadas
   * trouxeram, uma vez só, na ordem em que vieram. Um átomo que duas buscas
   * alcançam é um trecho, não dois.
   */
  it("os trechos do (i) não se repetem e seguem a ordem das chamadas", () => {
    const passos: PassoDeFerramenta[] = [
      { ferramenta: "buscar_atomos", parametros: {}, achados: [atomo({ id: "a2" }), atomo({ id: "a1" })] },
      { ferramenta: "consultar_grafo", parametros: {}, achados: [] },
      {
        ferramenta: "historico_do_atomo",
        parametros: {},
        achados: [atomo({ id: "a1", texto: "outra cópia" }), atomo({ id: "a3" })],
      },
    ];
    const trechos = trechosDoRastro(passos);
    expect(trechos.map((a) => a.id)).toEqual(["a2", "a1", "a3"]);
    // A primeira aparição vence.
    expect(trechos[1].texto).toBe("terminei com a Isinha ontem");
  });

  it("resposta que só leu fichas ou linhas não tem trecho", () => {
    expect(
      trechosDoRastro([
        { ferramenta: "buscar_entidades", parametros: {}, achados: [], entidades: [] },
        { ferramenta: "consultar_grafo", parametros: {}, achados: [] },
      ]),
    ).toEqual([]);
  });

  it("a sessão sai do id do átomo, e id fora do formato não vira sessão", () => {
    expect(sessaoDoAtomo("mfz1k2a3b4-12")).toBe("mfz1k2a3b4");
    expect(sessaoDoAtomo("a1")).toBeNull();
    expect(sessaoDoAtomo("../x-1")).toBeNull();
    expect(sessaoDoAtomo("mfz1k2a3b4-")).toBeNull();
  });

  it("a lista mostra o dia, não a hora — o de Brasília", () => {
    // A data das telas mora em `dia.ts` desde a onda 2 da interface.
    const agora = new Date("2026-10-14T15:00:00.000Z");
    expect(dataCurta("2026-09-13T18:00:00.000Z", agora)).toBe("13/09");
    expect(dataCurta("2026-09-14T01:30:00.000Z", agora)).toBe("13/09");
    expect(dataCurta("", agora)).toBe("");
  });
});
