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

import { generateText } from "ai";
import {
  PROMPT_VERSION_RESOLUCAO,
  candidatosDe,
  decidir,
  listarMencoes,
  montarPrompt,
  parsearResposta,
  resolverReferencias,
  validarMarcas,
} from "@/lib/resolucao";
import { normalizarNome } from "@/lib/texto";
import type { EntidadeDoGrafo } from "@/lib/entidades";
import type { AtomoCru, ReferenciaResolvida } from "@/lib/tipos";

const chamar = vi.mocked(generateText);

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
    expect(d.tipo === "julgar" && d.candidatos.map((c) => c.nome).sort()).toEqual([
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
    { citado: "eu", entidade: "eu", conhecida: true, certo: true, alternativas: [], motivo: "" },
  ];
  const menciona: ReferenciaResolvida[][] = [
    [{ citado: "Rafa", entidade: "Raffa", conhecida: true, certo: true, alternativas: [], motivo: "" }],
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
      [{ n: 1, mencao: { atomo: 0, papel: "sobre", ordem: 0, citado: "Rafa" }, candidatos: [RAFFA, RAPHA] }],
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
