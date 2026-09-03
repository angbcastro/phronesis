/**
 * O agente 2 — de quem eu estava falando.
 *
 * O que importa testar aqui é **quando o modelo é chamado** e **o que acontece
 * quando ele não responde direito**. A qualidade da atribuição eu avalio à mão,
 * na revisão, sessão real por sessão real; o que um teste pode garantir é que
 * uma sessão sem ambiguidade não paga nada, e que uma resposta ruim degrada para
 * dúvida em vez de para uma atribuição errada em silêncio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));

// A camada semântica é rede: embutir pelo Gateway e duas consultas de índice.
// Aqui ela é injetada à mão, que é o que permite testar a **regra de união**
// sem banco e sem chave — a qualidade da vizinhança eu avalio à mão, olhando a
// revisão, como toda avaliação de qualidade deste projeto.
vi.mock("@/lib/entidades", async (original) => ({
  ...(await original<typeof import("@/lib/entidades")>()),
  candidatosSemanticos: vi.fn(async (textos: readonly string[]) => textos.map(() => [])),
}));

import { generateText } from "ai";
import { candidatosSemanticos } from "@/lib/entidades";
import {
  ALCANCE,
  PISO_PERFIL,
  PISO_VIZINHOS,
  PROMPT_VERSION_RESOLUCAO,
  TOP_K,
  candidatosDe,
  decidir,
  listarMencoes,
  montarPrompt,
  parsearResposta,
  resolverReferencias,
  unir,
  validarMarcas,
} from "@/lib/resolucao";
import { normalizarNome } from "@/lib/texto";
import type { CandidatoSemantico, EntidadeDoGrafo } from "@/lib/entidades";
import type { AtomoCru, ReferenciaResolvida } from "@/lib/tipos";

const chamar = vi.mocked(generateText);
const semantica = vi.mocked(candidatosSemanticos);

/** Um candidato como as camadas 3a/3b o devolvem. */
const porPerfil = (chave: string, similaridade = 0.5): CandidatoSemantico => ({
  chave,
  camada: "perfil",
  similaridade,
  votos: 1,
  porque: [],
});

const porVizinhos = (
  chave: string,
  { votos = 1, similaridade = 0.6, ids = ["velho-0"] } = {},
): CandidatoSemantico => ({
  chave,
  camada: "vizinhos",
  similaridade,
  votos,
  porque: ids.map((atomo_id) => ({
    atomo_id,
    valido_em: "2026-08-12T00:00:00.000Z",
    texto: "andei de slackline no parque",
    similaridade,
  })),
});

const responder = (corpo: unknown) =>
  chamar.mockResolvedValue({
    text: JSON.stringify(corpo),
    response: { modelId: "zai/glm-5.3-flash" },
  } as never);

const no = (nome: string, extra: Partial<EntidadeDoGrafo> = {}): EntidadeDoGrafo => {
  const chave = normalizarNome(nome);
  return {
    id: `id-${chave}`,
    nome,
    nome_normalizado: chave,
    chaves: [chave],
    tipo: "Pessoa",
    sessoes: 1,
    atomos: 1,
    aliases: [],
    perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
    ...extra,
  };
};

const atomo = (sobre: string, extra: Partial<AtomoCru> = {}): AtomoCru => ({
  texto: "Fui no parque andar de slackline",
  tipo: "FATO",
  sobre,
  menciona: [],
  trechos: ["fui no parque andar de slack"],
  ...extra,
});

/** O caso da slice: dois nomes que soam igual, dois nós distintos. */
const RAFFA = no("Raffa", {
  perfil: {
    contexto: "amigo de fora do trabalho",
    pode_ajudar_com: "",
    fizemos_juntos: "slackline no parque, todo sábado",
  },
});
const RAPHA = no("Rapha", {
  perfil: {
    contexto: "sócio no evento",
    pode_ajudar_com: "produção de evento",
    fizemos_juntos: "",
  },
});

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  chamar.mockReset();
  // Sem vetor, por padrão: a slice 4 inteira tem que continuar valendo quando a
  // camada semântica não devolve nada — índice ainda não criado, Gateway fora,
  // ou nada acima do piso.
  semantica.mockReset();
  semantica.mockImplementation(async (textos) => textos.map(() => []));
});

describe("quem pode ser esta menção", () => {
  it("casa a grafia exata", () => {
    const c = candidatosDe("Raffa", [RAFFA, RAPHA]);
    expect(c.exatos.map((e) => e.nome)).toEqual(["Raffa"]);
  });

  it("atravessa alias: a grafia fundida encontra o vencedor", () => {
    const exxmed = no("Exxmed", { chaves: ["exxmed", "exx med"] });
    expect(candidatosDe("Exx Med", [exxmed]).exatos[0].nome).toBe("Exxmed");
  });

  it("o homófono aparece como parecido, que é o ponto inteiro", () => {
    // "Rafa" fica a uma ou duas letras de "Raffa" e de "Rapha" — a mesma camada
    // de string da slice 3 pega o caso de graça.
    const c = candidatosDe("Rafa", [RAFFA, RAPHA]);
    expect(c.exatos).toEqual([]);
    expect(c.parecidos.map((e) => e.nome).sort()).toEqual(["Raffa", "Rapha"]);
  });

  it("um nó não é candidato parecido de si mesmo", () => {
    const c = candidatosDe("Raffa", [RAFFA]);
    expect(c.parecidos).toEqual([]);
  });
});

describe("só chama o modelo quando há o que decidir", () => {
  it("um exato e nenhum parecido resolve de graça", () => {
    expect(decidir(candidatosDe("Isinha", [no("Isinha")]))).toMatchObject({ tipo: "no" });
  });

  it("nenhum candidato é entidade nova, de graça", () => {
    expect(decidir(candidatosDe("Marina", [no("Isinha")]))).toEqual({ tipo: "nova" });
  });

  it("dois parecidos vão ao agente", () => {
    expect(decidir(candidatosDe("Rafa", [RAFFA, RAPHA])).tipo).toBe("julgar");
  });

  it("um exato E um parecido vão ao agente — é o caso traiçoeiro", () => {
    // O STT escreve "Rapha" exatamente, o casamento de string acerta por sorte,
    // e como "Raffa" é parecido a menção vai ao agente mesmo assim. Sem esta
    // linha o sistema acertaria metade das vezes por acidente.
    const d = decidir(candidatosDe("Rapha", [RAFFA, RAPHA]));
    expect(d.tipo).toBe("julgar");
    expect(d.tipo === "julgar" && d.candidatos.map((c) => c.entidade.nome).sort()).toEqual([
      "Raffa",
      "Rapha",
    ]);
  });

  it("um parecido sozinho também vai: é ele ou é alguém novo", () => {
    expect(decidir(candidatosDe("Rafa", [RAFFA])).tipo).toBe("julgar");
  });
});

describe("sessão sem ambiguidade não paga nada", () => {
  it("nenhuma menção duvidosa, nenhuma chamada de modelo (critério 5)", async () => {
    const atomos = [atomo("eu", { menciona: ["Isinha"] })];
    const r = await resolverReferencias(atomos, [no("eu"), no("Isinha")]);

    expect(chamar).not.toHaveBeenCalled();
    expect(r.modelo).toBeNull();
    // Registrar uma versão de prompt que não rodou seria mentira na procedência.
    expect(r.prompt_version).toBeNull();
    expect(r.sobre[0]).toMatchObject({ entidade: "eu", conhecida: true, certo: true });
    expect(r.menciona[0][0]).toMatchObject({ entidade: "Isinha", conhecida: true });
  });

  it("grafo vazio: tudo é entidade nova, e ninguém é chamado", async () => {
    const r = await resolverReferencias([atomo("Marina")], []);
    expect(chamar).not.toHaveBeenCalled();
    expect(r.sobre[0]).toMatchObject({ entidade: "Marina", conhecida: false, certo: true });
  });
});

describe("o agente atribui menção por menção", () => {
  const atomos = [
    atomo("eu", { texto: "Fui no parque andar de slackline com o Rafa", menciona: ["Rafa"] }),
    atomo("Rafa", { texto: "Fiz uma call com o Rafa para fechar o evento" }),
  ];

  it("dois “Rafa” da mesma sessão caem em nós diferentes", async () => {
    // É o critério 2 da slice, e a razão de a atribuição ser por menção e não
    // por sessão: uma candidata por nome não teria como expressar isto.
    responder({
      referencias: [
        { n: 1, entidade: "raffa", certo: true, motivo: "slackline é o que fizeram juntos" },
        { n: 2, entidade: "rapha", certo: true, motivo: "o evento é do sócio" },
      ],
      perfil: [],
    });

    const r = await resolverReferencias(atomos, [RAFFA, RAPHA]);

    expect(chamar).toHaveBeenCalledTimes(1);
    expect(r.menciona[0][0].entidade).toBe("Raffa");
    expect(r.sobre[1].entidade).toBe("Rapha");
    expect(r.prompt_version).toBe(PROMPT_VERSION_RESOLUCAO);
  });

  it("uma chamada só para a sessão inteira, por mais menções que haja", async () => {
    responder({ referencias: [], perfil: [] });
    await resolverReferencias(atomos, [RAFFA, RAPHA]);
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  it("dúvida vem marcada, com o motivo e as alternativas preenchidas", async () => {
    // Critério 3: "falei com o Rafa hoje", sem mais contexto, chega destacado —
    // com sugestão, e sem travar o confirmar.
    responder({
      referencias: [
        { n: 1, entidade: "raffa", certo: false, motivo: "nada no átomo separa os dois" },
      ],
      perfil: [],
    });

    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);
    expect(r.sobre[0]).toMatchObject({
      citado: "Rafa",
      entidade: "Raffa",
      certo: false,
      motivo: "nada no átomo separa os dois",
    });
    expect(r.sobre[0].alternativas).toEqual(["Rapha"]);
  });

  it('"NOVA" cria entidade com a grafia que o extrator ouviu', async () => {
    responder({
      referencias: [{ n: 1, entidade: "NOVA", certo: true, motivo: "não é nenhum dos dois" }],
      perfil: [],
    });
    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);
    expect(r.sobre[0]).toMatchObject({ entidade: "Rafa", conhecida: false, certo: true });
  });
});

describe("resposta ruim degrada para dúvida, nunca para atribuição errada", () => {
  it("menção que o agente não respondeu volta incerta", async () => {
    responder({ referencias: [], perfil: [] });
    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);
    expect(r.sobre[0].certo).toBe(false);
    expect(r.sobre[0].motivo).toMatch(/não respondeu/);
  });

  it("entidade inventada, fora dos candidatos, não é aceita", async () => {
    responder({ referencias: [{ n: 1, entidade: "pedro", certo: true, motivo: "" }], perfil: [] });
    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);
    expect(r.sobre[0].entidade).toBe("Rafa"); // caiu para entidade nova
    expect(r.sobre[0].certo).toBe(false);
  });

  it("o fallback é o casamento exato, nunca o parecido", async () => {
    // Duas entidades a mais eu conserto em /entidades; fundir duas pessoas por
    // um palpite não tem desfazer.
    responder({ referencias: [], perfil: [] });
    const r = await resolverReferencias([atomo("Rapha")], [RAFFA, RAPHA]);
    expect(r.sobre[0]).toMatchObject({ entidade: "Rapha", conhecida: true, certo: false });
  });

  it("agente fora do ar não derruba a extração, que já foi paga", async () => {
    chamar.mockRejectedValue(new Error("gateway 503"));
    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);
    expect(r.sobre[0].certo).toBe(false);
    expect(r.sobre[0].motivo).toMatch(/falhou/);
  });

  it("resposta sem JSON também degrada, e não estoura", async () => {
    chamar.mockResolvedValue({ text: "desculpe, não consegui" } as never);
    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);
    expect(r.sobre[0].certo).toBe(false);
  });
});

describe("as marcas de perfil", () => {
  const sobre: ReferenciaResolvida[] = [
    { citado: "eu", entidade: "eu", conhecida: true, certo: true, alternativas: [], motivo: "", porque: [] },
  ];
  const menciona: ReferenciaResolvida[][] = [
    [
      {
        citado: "Rafa",
        entidade: "Raffa",
        conhecida: true,
        certo: true,
        alternativas: [],
        motivo: "",
        porque: [],
      },
    ],
  ];

  it("a marca é de quem a informação fala, não do sujeito do átomo", () => {
    // "fui no parque andar de slackline com o Raffa" é sobre "eu", e a
    // informação de perfil é do Raffa. É por isso que a marca é uma aresta.
    const m = validarMarcas(
      [{ atomo: 0, entidade: "raffa", campo: "fizemos_juntos" }],
      sobre,
      menciona,
      1,
    );
    expect(m[0]).toEqual([{ entidade: "Raffa", campo: "fizemos_juntos" }]);
  });

  it("campo fora do schema não entra", () => {
    const m = validarMarcas([{ atomo: 0, entidade: "raffa", campo: "cor_favorita" }], sobre, menciona, 1);
    expect(m[0]).toEqual([]);
  });

  it("entidade que o átomo não cita não entra", () => {
    // Senão o agente penduraria informação num nó que não tem nada a ver com a
    // frase — e o perfil é justamente o que ele lê para desambiguar depois.
    const m = validarMarcas([{ atomo: 0, entidade: "rapha", campo: "contexto" }], sobre, menciona, 1);
    expect(m[0]).toEqual([]);
  });

  it("átomo fora da lista não entra", () => {
    expect(validarMarcas([{ atomo: 7, entidade: "eu", campo: "contexto" }], sobre, menciona, 1)[0]).toEqual([]);
  });

  it("a mesma marca duas vezes vira uma", () => {
    const m = validarMarcas(
      [
        { atomo: 0, entidade: "raffa", campo: "fizemos_juntos" },
        { atomo: 0, entidade: "Raffa", campo: "FIZEMOS_JUNTOS" },
      ],
      sobre,
      menciona,
      1,
    );
    expect(m[0]).toHaveLength(1);
  });
});

describe("mecânica", () => {
  it("as menções saem na ordem em que a revisão as mostra", () => {
    expect(listarMencoes([atomo("eu", { menciona: ["a", "b"] })])).toEqual([
      { atomo: 0, papel: "sobre", ordem: 0, citado: "eu" },
      { atomo: 0, papel: "menciona", ordem: 0, citado: "a" },
      { atomo: 0, papel: "menciona", ordem: 1, citado: "b" },
    ]);
  });

  it("o prompt leva o perfil, que é o que desambigua", () => {
    const p = montarPrompt(
      [atomo("Rafa")],
      [
        {
          n: 1,
          mencao: { atomo: 0, papel: "sobre", ordem: 0, citado: "Rafa" },
          candidatos: [
            { entidade: RAFFA, camada: "string", similaridade: null, porque: [] },
            { entidade: RAPHA, camada: "string", similaridade: null, porque: [] },
          ],
        },
      ],
      [RAFFA, RAPHA],
    );
    expect(p).toContain("slackline no parque");
    expect(p).toContain("produção de evento");
    expect(p).toContain('"raffa"');
  });

  it("aceita JSON embrulhado em cerca de markdown", () => {
    const r = parsearResposta('```json\n{"referencias":[{"n":1}],"perfil":[]}\n```');
    expect(r.referencias).toHaveLength(1);
  });

  it("resposta sem JSON nenhum estoura com o que veio junto", () => {
    expect(() => parsearResposta("não consegui")).toThrow(/não consegui/);
  });
});

describe("as duas camadas semânticas (slice 4.5)", () => {
  /** Uma entidade que a grafia falada não alcança — o Rapha do passo zero. */
  const BIBI = no("Bibi", {
    perfil: { contexto: "amiga do trabalho", pode_ajudar_com: "", fizemos_juntos: "" },
  });

  it("o candidato do vetor entra sem tirar ninguém — as camadas são aditivas", () => {
    const c = candidatosDe("Rafa", [RAFFA, RAPHA, BIBI], [porPerfil("bibi")]);
    expect(c.exatos).toEqual([]);
    expect(c.parecidos.map((e) => e.nome)).toEqual(["Raffa", "Rapha"]);
    expect(c.semanticos.map((s) => s.entidade.nome)).toEqual(["Bibi"]);
  });

  it("entidade com perfil e ZERO átomo vira candidata (critério 4)", () => {
    // Nenhuma camada de string a alcança: "Bibi" não casa nem por chave nem por
    // distância com nada do que foi dito. É o buraco que a 3a existe para tapar.
    const d = decidir(candidatosDe("aquela menina", [RAFFA, BIBI], [porPerfil("bibi", 0.41)]));
    expect(d.tipo).toBe("julgar");
    expect(d.tipo === "julgar" && d.candidatos.map((c) => c.entidade.nome)).toEqual(["Bibi"]);
  });

  it("a camada dos vizinhos leva junto QUAIS átomos elegeram (critério 5)", () => {
    // Sem esta lista a camada não entra: ela herda atribuição passada, e o que
    // a torna aceitável é ser um voto entre k com o id na tela.
    const d = decidir(
      candidatosDe("aquele cara", [RAFFA], [porVizinhos("raffa", { ids: ["s1-0", "s2-3"] })]),
    );
    expect(d.tipo === "julgar" && d.candidatos[0].porque.map((e) => e.atomo_id)).toEqual([
      "s1-0",
      "s2-3",
    ]);
    expect(d.tipo === "julgar" && d.candidatos[0].porque[0].valido_em).toContain("2026-08-12");
  });

  it("vizinhos votando no MESMO nó que a grafia achou não criam dúvida (critério 6)", () => {
    // É o caso comum de toda sessão sem ambiguidade: a grafia casa, e os
    // vizinhos votam em quem a grafia já tinha achado. União de tamanho 1,
    // decisão de graça, agente 2 não chamado — o critério 5 da slice 4
    // sobrevive ao vetor exatamente por causa desta deduplicação.
    const d = decidir(candidatosDe("Isinha", [no("Isinha")], [porVizinhos("isinha", { votos: 3 })]));
    expect(d.tipo).toBe("no");
  });

  it("o mesmo nó por duas camadas aparece uma vez — e leva o porquê junto", () => {
    const uniao = unir(
      candidatosDe("Raffa", [RAFFA], [porVizinhos("raffa", { ids: ["s9-1"] })]),
    );
    expect(uniao).toHaveLength(1);
    // A camada mais forte vence a etiqueta; a evidência é da única que a tem.
    expect(uniao[0].camada).toBe("exato");
    expect(uniao[0].porque.map((e) => e.atomo_id)).toEqual(["s9-1"]);
  });

  it("voto pesa mais que similaridade na ordem dos semânticos", () => {
    // Dois átomos apontando para a mesma pessoa dizem mais que um átomo
    // apontando um pouco mais parecido.
    const c = candidatosDe(
      "alguém",
      [RAFFA, RAPHA],
      [porVizinhos("rapha", { votos: 1, similaridade: 0.9 }), porVizinhos("raffa", { votos: 2, similaridade: 0.5 })],
    );
    expect(c.semanticos.map((s) => s.entidade.nome)).toEqual(["Raffa", "Rapha"]);
  });

  it("TOP_K corta a união, e o exato nunca é o cortado", () => {
    const catalogo = [RAFFA, RAPHA, BIBI, no("Marcos"), no("Marina")];
    const uniao = unir(
      candidatosDe("Rafa", catalogo, [porPerfil("bibi"), porPerfil("marcos"), porPerfil("marina")]),
    );
    expect(uniao).toHaveLength(TOP_K);
    // exato, string, string — o vetor só entra no que sobrar do teto.
    expect(uniao.map((c) => c.entidade.nome)).toEqual(["Raffa", "Rapha", "Bibi"]);
  });

  it("chave que o catálogo não conhece cai fora em silêncio", () => {
    // O índice pode guardar o vetor de um nó que a leitura de hoje não lista.
    // Candidato que não existe na tela seria um nome impossível de escolher.
    expect(candidatosDe("Rafa", [RAFFA], [porPerfil("fantasma")]).semanticos).toEqual([]);
  });

  it("o piso e o alcance de cada camada se calibram separado", () => {
    // 3a é assimétrica (átomo contra string de perfil), 3b é simétrica (átomo
    // contra átomo). Igualá-los seria coincidência, não economia.
    expect(PISO_PERFIL).not.toBe(PISO_VIZINHOS);
    expect(ALCANCE.vizinhos).toBeGreaterThan(ALCANCE.perfis);
  });

  it("catálogo vazio não paga nem uma chamada de embedding", async () => {
    await resolverReferencias([atomo("eu")], []);
    expect(semantica).not.toHaveBeenCalled();
    expect(chamar).not.toHaveBeenCalled();
  });

  it("a semântica é consultada uma vez para a sessão inteira, por átomo", async () => {
    await resolverReferencias([atomo("eu"), atomo("Isinha")], [no("Isinha")]);
    expect(semantica).toHaveBeenCalledTimes(1);
    expect(semantica.mock.calls[0][0]).toEqual([
      "Fui no parque andar de slackline",
      "Fui no parque andar de slackline",
    ]);
    expect(semantica.mock.calls[0][1]).toEqual({ perfil: PISO_PERFIL, vizinhos: PISO_VIZINHOS });
  });

  it("o porquê do candidato escolhido chega à referência da revisão", async () => {
    semantica.mockImplementation(async (textos) =>
      textos.map(() => [porVizinhos("raffa", { ids: ["s1-0"] })]),
    );
    responder({
      referencias: [{ n: 1, entidade: "raffa", certo: false, motivo: "slackline" }],
      perfil: [],
    });

    const r = await resolverReferencias([atomo("aquele cara")], [RAFFA]);
    expect(r.sobre[0].entidade).toBe("Raffa");
    expect(r.sobre[0].porque.map((e) => e.atomo_id)).toEqual(["s1-0"]);
  });

  it("o prompt diz por que cada candidato está na lista", async () => {
    // Uma menção que junta as três: a grafia casa com o Raffa, o Rapha é
    // parecido, e a Bibi só entra pelos vizinhos.
    semantica.mockImplementation(async (textos) =>
      textos.map(() => [porVizinhos("bibi", { ids: ["s7-2"] })]),
    );
    responder({ referencias: [], perfil: [] });

    await resolverReferencias([atomo("Raffa")], [RAFFA, RAPHA, BIBI]);
    const prompt = String((chamar.mock.calls[0][0] as { prompt: string }).prompt);
    expect(prompt).toContain("a grafia bate");
    expect(prompt).toContain("o nome é parecido");
    expect(prompt).toContain("átomo(s) parecidos com este já são dela");
    expect(prompt).toContain("andei de slackline no parque");
  });

  it("a camada semântica cair não derruba a resolução", async () => {
    // `candidatosSemanticos` já engole a falha e devolve vazio; o que este
    // teste garante é que a sessão continua resolvendo pelas camadas de string.
    semantica.mockImplementation(async (textos) => textos.map(() => []));
    const r = await resolverReferencias([atomo("Isinha")], [no("Isinha")]);
    expect(r.sobre[0].entidade).toBe("Isinha");
    expect(r.modelo).toBeNull();
  });

  it("a versão do prompt subiu porque a ENTRADA do agente mudou", () => {
    expect(PROMPT_VERSION_RESOLUCAO).toBe("resolucao-2");
  });
});
