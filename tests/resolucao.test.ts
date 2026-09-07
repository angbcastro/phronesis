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
  travadoEmEu,
  unir,
  validarMarcas,
} from "@/lib/resolucao";
import { normalizarNome } from "@/lib/texto";
import type { CandidatoSemantico, EntidadeDoGrafo } from "@/lib/entidades";
import type { AtomoCru, MencaoCrua, ReferenciaResolvida } from "@/lib/tipos";

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

/** O que o extrator devolve por menção desde a 4.9: a grafia, e o nó ou nada. */
const cita = (citado: string, chave: string | null = null): MencaoCrua => ({ citado, chave });


const atomo = (sobre: string, extra: Partial<AtomoCru> = {}): AtomoCru => ({
  texto: "Fui no parque andar de slackline",
  tipo: "FATO",
  sobre: cita(sobre),
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

describe("toda menção é validada (slice 4.9)", () => {
  it("menção que casa exato TAMBÉM vai ao agente — o critério 5 morreu aqui", async () => {
    // Era a promessa da slice 4: sessão sem ambiguidade não pagava nada. A 4.9
    // a desfaz de propósito — desde que o extrator aponta o nó e escreve o nome
    // dentro do texto do átomo, nenhuma atribuição dele entra sem segunda
    // opinião.
    responder({ referencias: [], perfil: [] });
    const atomos = [atomo("eu", { menciona: [cita("Isinha")] })];
    const r = await resolverReferencias(atomos, [no("eu"), no("Isinha")]);

    expect(chamar).toHaveBeenCalledTimes(1);
    expect(r.prompt_version).toBe(PROMPT_VERSION_RESOLUCAO);
  });

  it("agente calado devolve o prior: o que a 4.8 decidia de graça, com o certo de lá", async () => {
    responder({ referencias: [], perfil: [] });
    const atomos = [atomo("eu", { menciona: [cita("Isinha")] })];
    const r = await resolverReferencias(atomos, [no("eu"), no("Isinha")]);

    expect(r.sobre[0]).toMatchObject({ entidade: "eu", conhecida: true, certo: true });
    expect(r.menciona[0][0]).toMatchObject({ entidade: "Isinha", conhecida: true, certo: true });
  });

  it("menção sem candidato nenhum não vira pergunta: não há atribuição a validar", async () => {
    // É o que mantém a promessa de a primeira sessão da vida do sistema sair
    // como saía na 4.8 — e o que impede pagar uma chamada para descobrir que
    // não havia o que perguntar.
    const r = await resolverReferencias([atomo("Marina")], [no("Isinha")]);
    expect(chamar).not.toHaveBeenCalled();
    expect(r.sobre[0]).toMatchObject({ entidade: "Marina", conhecida: false, certo: true });
  });

  it("grafo vazio: tudo é entidade nova, e ninguém é chamado", async () => {
    const r = await resolverReferencias([atomo("Marina")], []);
    expect(chamar).not.toHaveBeenCalled();
    expect(r.sobre[0]).toMatchObject({ entidade: "Marina", conhecida: false, certo: true });
  });
});

describe("o agente atribui menção por menção", () => {
  const atomos = [
    atomo("eu", { texto: "Fui no parque andar de slackline com o Rafa", menciona: [cita("Rafa")] }),
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
  it("resposta sem julgamento nenhum marca falha e vai ao log (A1)", async () => {
    // Ele respondeu, e a chamada foi paga. Dizer "não respondeu" aqui é a
    // etiqueta errada, e é ela que eu leio para decidir se o agente funciona.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    responder({ referencias: [], perfil: [] });
    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);

    expect(r.sobre[0].certo).toBe(false);
    expect(r.sobre[0].motivo).toMatch(/não julgou nenhuma menção/);
    expect(log.mock.calls.map((c) => String(c[0])).join(" | ")).toContain("[resolucao]");
    log.mockRestore();
  });

  it("a menção que ele pulou continua dizendo que ele não respondeu por ela (C1)", async () => {
    // Duas pendentes, uma julgada: aqui o silêncio é mesmo daquela menção, e a
    // frase antiga é a verdadeira.
    responder({ referencias: [{ n: 1, entidade: "raffa", certo: true, motivo: "" }], perfil: [] });
    const r = await resolverReferencias(
      [atomo("Rafa"), atomo("Rafa", { texto: "Fiz uma call com o Rafa" })],
      [RAFFA, RAPHA],
    );

    expect(r.sobre[0].entidade).toBe("Raffa");
    expect(r.sobre[1].motivo).toMatch(/não respondeu por esta menção/);
  });

  it("resposta em array solto é lida, não engolida (A1)", async () => {
    // Sem a tolerância ao `[`, isto pegava do primeiro `{` ao último `}`,
    // devolvia um objeto sem `referencias` e virava silêncio pago.
    chamar.mockResolvedValue({
      text: JSON.stringify([{ n: 1, entidade: "raffa", certo: true, motivo: "slackline" }]),
      response: { modelId: "zai/glm-5.3-flash" },
    } as never);

    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);
    expect(r.sobre[0]).toMatchObject({ entidade: "Raffa", certo: true });
  });

  it("chave fora dos candidatos tem motivo próprio, e nomeia a chave (C1)", async () => {
    responder({ referencias: [{ n: 1, entidade: "pedro", certo: true, motivo: "" }], perfil: [] });
    const r = await resolverReferencias([atomo("Rafa")], [RAFFA, RAPHA]);

    expect(r.sobre[0].certo).toBe(false);
    expect(r.sobre[0].motivo).toContain("pedro");
    expect(r.sobre[0].motivo).not.toMatch(/não respondeu/);
  });

  it('"NOVA" que colide com um nó existente volta incerta (C2)', async () => {
    // A constraint de `nome_normalizado` (migration 002) impede o segundo nó:
    // o átomo vai cair no que já existe, e o agente tinha dito o contrário.
    // Sem esta marca, o sistema fazia o oposto do que o agente disse em
    // silêncio, com `certo: true`.
    responder({ referencias: [{ n: 1, entidade: "NOVA", certo: true, motivo: "" }], perfil: [] });
    const r = await resolverReferencias([atomo("Rapha")], [RAFFA, RAPHA]);

    expect(r.sobre[0].certo).toBe(false);
    expect(r.sobre[0].motivo).toContain("Rapha");
    // E o nome escolhido não se oferece como alternativa de si mesmo.
    expect(r.sobre[0].alternativas).toEqual(["Raffa"]);
  });

  it("o fallback do exato leva a evidência dos outros candidatos (C3)", async () => {
    // A camada `exato` tem sempre `porque: []`, e `??` não passa por `[]`:
    // a evidência dos vizinhos sumia justo quando eu tenho de decidir na mão.
    semantica.mockImplementation(async (textos) => textos.map(() => [porVizinhos("raffa")]));
    responder({ referencias: [], perfil: [] });
    const r = await resolverReferencias([atomo("Rapha")], [RAFFA, RAPHA]);

    expect(r.sobre[0]).toMatchObject({ entidade: "Rapha", conhecida: true, certo: false });
    expect(r.sobre[0].porque.map((e) => e.atomo_id)).toEqual(["velho-0"]);
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

/**
 * O que a slice 4.8.1 acrescentou de trava: a mesma pergunta não se paga duas
 * vezes dentro do mesmo átomo, e a chave do Gateway se confere antes da
 * primeira coisa que sai por ele.
 */
describe("a mesma pergunta não vai duas vezes", () => {
  it("duas menções iguais no mesmo átomo viram uma pergunta só (D2)", async () => {
    responder({ referencias: [{ n: 2, entidade: "raffa", certo: true, motivo: "" }], perfil: [] });
    const r = await resolverReferencias(
      [atomo("eu", { menciona: [cita("Rafa"), cita("rafa")] })],
      [no("eu"), RAFFA, RAPHA],
    );

    // O sujeito "eu" é a pergunta 1; as duas menções a "Rafa" viram a 2, e não
    // a 2 e a 3.
    const prompt = String((chamar.mock.calls[0][0] as { prompt: string }).prompt);
    expect(prompt).toContain("2. no átomo 0");
    expect(prompt).not.toContain("3. no átomo 0");

    // A resposta vale para as duas posições, e cada uma guarda a grafia dela.
    expect(r.menciona[0].map((m) => m.entidade)).toEqual(["Raffa", "Raffa"]);
    expect(r.menciona[0].map((m) => m.citado)).toEqual(["Rafa", "rafa"]);
  });

  it("entre átomos elas continuam duas — é o ponto inteiro da slice 4", async () => {
    responder({ referencias: [], perfil: [] });
    await resolverReferencias(
      [atomo("Rafa"), atomo("Rafa", { texto: "Fiz uma call com o Rafa" })],
      [RAFFA, RAPHA],
    );

    const prompt = String((chamar.mock.calls[0][0] as { prompt: string }).prompt);
    expect(prompt).toContain("1. no átomo 0");
    expect(prompt).toContain("2. no átomo 1");
  });

  it("a chave do Gateway é conferida antes de embutir, não depois (E2)", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    await expect(resolverReferencias([atomo("Isinha")], [no("Isinha")])).rejects.toThrow();
    expect(semantica).not.toHaveBeenCalled();
  });

  it("catálogo vazio não exige a chave: por ali nada sai pelo Gateway", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const r = await resolverReferencias([atomo("Marina")], []);
    expect(r.sobre[0].entidade).toBe("Marina");
  });
});

/**
 * A guarda do `"eu"` (slice 4.8.1, A2).
 *
 * As camadas semânticas são calculadas por átomo e entregues a todas as menções
 * dele: `"eu"` casa exato, a 3b traz de quem são os vizinhos, e a menção vai ao
 * agente — que pode responder outra pessoa. É o único achado da fatia que
 * corrompia dado em toda sessão gravada, e o conserto é o código recusar a
 * resposta que quebra o contrato do `extracao-7`, não deixar de perguntar.
 */
describe("SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA são sempre de eu", () => {
  const EU = no("eu");

  /** O vizinho vetorial vota noutra pessoa, e é o que põe a menção em julgamento. */
  const comVizinhoRaffa = () =>
    semantica.mockImplementation(async (textos) => textos.map(() => [porVizinhos("raffa")]));

  it("o sujeito continua eu mesmo quando o agente responde outra pessoa", async () => {
    comVizinhoRaffa();
    responder({
      referencias: [{ n: 1, entidade: "raffa", certo: true, motivo: "o slackline é dele" }],
      perfil: [],
    });

    const r = await resolverReferencias(
      [atomo("eu", { tipo: "SENTIMENTO", texto: "Fiquei feliz depois do parque" })],
      [EU, RAFFA],
    );

    expect(r.sobre[0]).toMatchObject({ entidade: "eu", conhecida: true, certo: false });
    expect(r.sobre[0].motivo).toContain("SENTIMENTO");
  });

  it("a recusa aparece na tela, em vez de acontecer calada", async () => {
    // Um agente querendo tirar um APRENDIZADO de `eu` costuma ser sinal de que
    // o tipo do átomo está errado — e isso eu só conserto se vir.
    comVizinhoRaffa();
    responder({ referencias: [{ n: 1, entidade: "raffa", certo: true, motivo: "" }], perfil: [] });

    const r = await resolverReferencias(
      [atomo("eu", { tipo: "APRENDIZADO", texto: "Aprendi a montar a fita sozinho" })],
      [EU, RAFFA],
    );

    expect(r.sobre[0].certo).toBe(false);
    expect(r.sobre[0].porque).toEqual([]);
  });

  it("a guarda é do sujeito: a menção do mesmo átomo continua livre", async () => {
    comVizinhoRaffa();
    responder({
      referencias: [
        { n: 1, entidade: "raffa", certo: true, motivo: "" },
        { n: 2, entidade: "raffa", certo: true, motivo: "" },
      ],
      perfil: [],
    });

    const r = await resolverReferencias(
      [atomo("eu", { tipo: "SENTIMENTO", menciona: [cita("Rafa")] })],
      [EU, RAFFA, RAPHA],
    );

    expect(r.sobre[0].entidade).toBe("eu");
    expect(r.menciona[0][0]).toMatchObject({ entidade: "Raffa", certo: true });
  });

  it("num FATO o agente continua podendo tirar o sujeito de eu", async () => {
    // A regra é dos três tipos, não de todo átomo: em FATO, OPINIAO, CONQUISTA
    // e DECISAO o sujeito é o assunto, e `eu` ali é só o padrão de quando não há
    // outro.
    comVizinhoRaffa();
    responder({ referencias: [{ n: 1, entidade: "raffa", certo: true, motivo: "" }], perfil: [] });

    const r = await resolverReferencias([atomo("eu", { tipo: "FATO" })], [EU, RAFFA]);
    expect(r.sobre[0]).toMatchObject({ entidade: "Raffa", certo: true });
  });

  it("o extrator que já pôs outra pessoa no SENTIMENTO não é reescrito aqui", async () => {
    // A guarda impede **tirar** o sujeito de `eu`. Se o extrator violou o
    // próprio contrato, quem arbitra é a revisão, não este código.
    responder({ referencias: [{ n: 1, entidade: "raffa", certo: true, motivo: "" }], perfil: [] });
    const r = await resolverReferencias(
      [atomo("Rafa", { tipo: "SENTIMENTO" })],
      [EU, RAFFA, RAPHA],
    );
    expect(r.sobre[0]).toMatchObject({ entidade: "Raffa", certo: true });
  });

  it("travadoEmEu diz quando a guarda vale", () => {
    expect(travadoEmEu("SENTIMENTO", "sobre", "eu")).toBe(true);
    expect(travadoEmEu("ROTINA", "sobre", "Eu")).toBe(true);
    // HISTORIA entrou na lista com a migration 007: eu vivi a história, e quem
    // a viveu comigo está em `menciona`.
    expect(travadoEmEu("HISTORIA", "sobre", "eu")).toBe(true);
    expect(travadoEmEu("HISTORIA", "menciona", "eu")).toBe(false);
    expect(travadoEmEu("SENTIMENTO", "menciona", "eu")).toBe(false);
    expect(travadoEmEu("FATO", "sobre", "eu")).toBe(false);
    expect(travadoEmEu("SENTIMENTO", "sobre", "Rafa")).toBe(false);
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
    // A menção carrega também o que o extrator apontou (4.9) — aqui, nada.
    expect(listarMencoes([atomo("eu", { menciona: [cita("a"), cita("b")] })])).toEqual([
      { atomo: 0, papel: "sobre", ordem: 0, citado: "eu", chave: null },
      { atomo: 0, papel: "menciona", ordem: 0, citado: "a", chave: null },
      { atomo: 0, papel: "menciona", ordem: 1, citado: "b", chave: null },
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

  it("array solto é a lista de julgamentos, como na extração", () => {
    const r = parsearResposta('[{"n":1,"entidade":"raffa","certo":true,"motivo":"x"}]');
    expect(r.referencias).toHaveLength(1);
    expect(r.perfil).toEqual([]);
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
    // exato, string, string — e o vetor só entra no que sobrar do teto. Com
    // `extrator` na cabeça (4.9), a última vaga é a primeira a ser espremida.
    expect(uniao.map((c) => c.entidade.nome)).toEqual(["Raffa", "Rapha", "Bibi", "Marcos"]);
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
    responder({ referencias: [], perfil: [] });
    const r = await resolverReferencias([atomo("Isinha")], [no("Isinha")]);
    expect(r.sobre[0].entidade).toBe("Isinha");
  });

  it("a versão do prompt subiu porque a ENTRADA do agente mudou", () => {
    // `resolucao-2` na 4.5 (o vetor entrou na união), `resolucao-3` na 4.9 (a
    // chave do extrator entrou, e a lista passou a ser de todas as menções),
    // `resolucao-4` na 007 (o catálogo ganhou organizações, e HISTORIA entrou
    // na regra de tipo).
    expect(PROMPT_VERSION_RESOLUCAO).toBe("resolucao-4");
  });
});

/**
 * A resolução por janela (slice 4.8). O agente passou a ser chamado uma vez por
 * janela, sobre as menções daquela janela — e recebe as anteriores como
 * contexto, para não decidir sobre a Rafa do minuto 2 sem saber que já houve
 * uma Rafa no minuto 1.
 */
describe("o que as janelas anteriores propuseram", () => {
  const pendente = {
    n: 1,
    mencao: { atomo: 0, papel: "sobre" as const, ordem: 0, citado: "Rafa" },
    candidatos: [
      { entidade: RAFFA, camada: "string" as const, similaridade: null, porque: [] },
      { entidade: RAPHA, camada: "string" as const, similaridade: null, porque: [] },
    ],
  };

  it("sem acumulado, o prompt sai igual ao de antes da fatia", () => {
    const semNada = montarPrompt([atomo("Rafa")], [pendente], [RAFFA, RAPHA]);
    const comLista = montarPrompt([atomo("Rafa")], [pendente], [RAFFA, RAPHA], undefined, []);
    expect(comLista).toBe(semNada);
  });

  it("com acumulado, ele entra como contexto — e antes dos átomos desta janela", () => {
    const p = montarPrompt([atomo("Rafa")], [pendente], [RAFFA, RAPHA], undefined, [
      { tipo: "FATO", texto: "combinei o slackline com a Raffa", sobre: "Raffa" },
    ]);

    expect(p).toContain("combinei o slackline com a Raffa");
    expect(p).toContain("não decida sobre eles");
    expect(p.indexOf("ANTES DESTA JANELA")).toBeLessThan(p.indexOf("ÁTOMOS DESTA SESSÃO:"));
  });

  it("o átomo anterior não vira menção a resolver", () => {
    // Ele já foi atribuído quando nasceu; reabrir a decisão a cada janela seria
    // pagar a mesma pergunta oito vezes — e podia trocar a resposta no meio.
    const p = montarPrompt([atomo("Rafa")], [pendente], [RAFFA, RAPHA], undefined, [
      { tipo: "FATO", texto: "combinei o slackline com a Raffa", sobre: "Raffa" },
    ]);
    expect(p.match(/MENÇÕES A DECIDIR:/g)).toHaveLength(1);
    expect(p.slice(p.indexOf("MENÇÕES EM DÚVIDA:"))).not.toContain("slackline com a Raffa");
  });
});

/**
 * A quinta camada (slice 4.9): o extrator leu o trecho com o dossiê do grafo na
 * mão e apontou um nó. Ele não decide — decide o agente 2 —, mas entra na
 * cabeça da união, e quando os dois discordam a revisão tem de ver.
 */
describe("o que o extrator apontou", () => {
  const GIAMPAOLO = no("Giampaolo Lepore");

  const comChave = (citado: string, chave: string | null) =>
    atomo("eu", { menciona: [cita(citado, chave)] });

  it("a chave do extrator vira candidato, na frente de todas", () => {
    const c = candidatosDe("Jean", [GIAMPAOLO], [], "giampaolo lepore");
    expect(c.doExtrator.map((e) => e.nome)).toEqual(["Giampaolo Lepore"]);
    expect(unir(c)[0]).toMatchObject({ camada: "extrator" });
  });

  it("chave que o catálogo não conhece cai fora em silêncio", () => {
    // Mesma regra que `comoCandidatos` aplica ao que o vetor devolve: candidato
    // que não existe seria um nome impossível de escolher na revisão.
    expect(candidatosDe("Jean", [GIAMPAOLO], [], "quem nunca existiu").doExtrator).toEqual([]);
  });

  it("o prompt diz o que o extrator apontou, por menção", async () => {
    responder({ referencias: [], perfil: [] });
    await resolverReferencias([comChave("Jean", "giampaolo lepore")], [no("eu"), GIAMPAOLO]);

    const prompt = String((chamar.mock.calls[0][0] as { prompt: string }).prompt);
    expect(prompt).toContain('Ele apontou a chave "giampaolo lepore"');
    expect(prompt).toContain("Ele não apontou nenhuma chave");
  });

  it("o agente concordando, a menção sai certa e apontando o nó", async () => {
    responder({
      referencias: [{ n: 2, entidade: "giampaolo lepore", certo: true, motivo: "é o sócio" }],
      perfil: [],
    });
    const r = await resolverReferencias(
      [comChave("Jean", "giampaolo lepore")],
      [no("eu"), GIAMPAOLO],
    );

    expect(r.menciona[0][0]).toMatchObject({
      citado: "Jean",
      entidade: "Giampaolo Lepore",
      conhecida: true,
      certo: true,
      camada: "extrator",
    });
  });

  it("os dois discordando, o agente 2 vence — e a dúvida aparece", async () => {
    // É o que a revisão tem de ver: o texto do átomo já saiu com o nome que o
    // extrator escolheu, e o agente 2 diz que é outro.
    // O grafo tem uma "Jean" de verdade: a grafia casa com ela, e o extrator
    // apontou o Giampaolo. É o par que faz os dois discordarem.
    responder({
      referencias: [{ n: 2, entidade: "jean", certo: true, motivo: "o contexto é o dela" }],
      perfil: [],
    });
    const r = await resolverReferencias(
      [comChave("Jean", "giampaolo lepore")],
      [no("eu"), GIAMPAOLO, no("Jean")],
    );

    expect(r.menciona[0][0]).toMatchObject({ entidade: "Jean", certo: false });
    expect(r.menciona[0][0].motivo).toContain("o extrator apontou");
    expect(r.menciona[0][0].motivo).toContain("o texto do átomo pode ter saído com o nome errado");
  });

  it("a espera de rate limit entra na chamada (o conserto que a 4.8 deixou)", async () => {
    // O agente passou a rodar em toda janela, na mesma rajada em que o STT
    // disputa o limite da conta. Falhar em vez de esperar era o lado errado da
    // linha do §5.3.
    chamar.mockRejectedValueOnce(Object.assign(new Error("rate limit"), { statusCode: 429 }));
    chamar.mockResolvedValueOnce({
      text: JSON.stringify({ referencias: [{ n: 1, entidade: "isinha", certo: true }], perfil: [] }),
      response: { modelId: "zai/glm-5.3-flash" },
    } as never);

    const r = await resolverReferencias([atomo("Isinha")], [no("Isinha")], { ate: Date.now() });

    // Sem orçamento para esperar, ela desiste na hora — e o prior segura a
    // menção, como sempre segurou.
    expect(r.sobre[0].entidade).toBe("Isinha");
    expect(chamar).toHaveBeenCalledTimes(1);
  });
});
