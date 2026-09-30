/**
 * O retrato do "eu" (slice 10) — o que ele pede ao modelo, o que aceita de
 * volta, e a ordem em que grava.
 *
 * O risco é o mesmo da 4.12: **ninguém revisa antes de gravar**. Por isso o que
 * se testa primeiro é o que impede uma resposta ruim de virar retrato — a fonte
 * que não existe descartada, a falha parcial mantendo o texto anterior, a falha
 * da fase 1 não escrevendo nada — e a ordem que faz uma função morta no meio
 * voltar pelo lease em vez de ficar dizendo `pronta` com o retrato velho.
 *
 * A qualidade do texto não se testa aqui: quem julga sou eu, lendo (CLAUDE.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** O R2 em memória, com etag e as duas condições que o sistema usa. */
const loja = vi.hoisted(() => {
  const objetos = new Map<string, { valor: unknown; etag: string }>();
  let n = 0;
  const eventos: string[] = [];
  return { objetos, eventos, proximo: () => `"e${++n}"` };
});

vi.mock("ai", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, generateText: vi.fn() };
});
vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));
vi.mock("@/lib/r2", () => {
  class ConflitoR2Error extends Error {}
  return {
    ConflitoR2Error,
    getJson: vi.fn(async (key: string) => {
      const o = loja.objetos.get(key);
      return o ? { valor: structuredClone(o.valor), etag: o.etag } : null;
    }),
    putJson: vi.fn(
      async (key: string, valor: unknown, op: { ifMatch?: string; ifNoneMatch?: string } = {}) => {
        const atual = loja.objetos.get(key);
        if (op.ifNoneMatch === "*" && atual) throw new ConflitoR2Error("existe");
        if (op.ifMatch && atual?.etag !== op.ifMatch) throw new ConflitoR2Error("etag");
        const etag = loja.proximo();
        loja.objetos.set(key, { valor: structuredClone(valor), etag });
        loja.eventos.push(`put ${key}`);
        return { etag };
      },
    ),
  };
});
vi.mock("@/lib/entidades", () => ({
  listarEntidades: vi.fn(async () => []),
  acharPorChave: vi.fn(() => null),
}));
vi.mock("@/lib/embedding", () => ({ embutir: vi.fn() }));

import { generateText } from "ai";
import { chaveConfigRetrato, chaveRetrato, chaveRetratoAnterior } from "@/lib/chaves";
import { NOTA_DO_EU, lerRetratoDoEu, respostaDasEntidades } from "@/lib/chat";
import { enriquecer, type AtomoDaEntidade } from "@/lib/enriquecimento";
import { query } from "@/lib/neo4j";
import {
  DesfazerPelaMetadeError,
  MAX_FONTES,
  PROMPT_VERSION_RETRATO,
  RetratoOcupadoError,
  SUFIXO_FICHA,
  blocoNumerado,
  desfazerRetrato,
  parsearFichaCurta,
  parsearSecao,
  rodadaDoEu,
  sufixoAgora,
  sufixoDimensao,
} from "@/lib/retrato";
import {
  INSTRUCOES as INSTRUCOES_DIMENSOES,
  limparDimensoesDaTela,
  parsearDimensoes,
  slugDimensao,
} from "@/lib/retrato-dimensoes";
import { ID_AGORA, mesAno, type ConfigRetrato, type RetratoDoEu } from "@/lib/tipos";

const chamar = vi.mocked(generateText);
const consulta = vi.mocked(query);

const EU = { nome: "eu", nome_normalizado: "eu" };
const AGORA = new Date("2026-09-29T12:00:00.000Z");

const atomo = (n: number, extra: Partial<AtomoDaEntidade> = {}): AtomoDaEntidade => ({
  id: `a${n}`,
  texto: `trecho ${n}`,
  tipo: "FATO",
  valido_em: `2026-09-${String(28 - n).padStart(2, "0")}T00:00:00.000Z`,
  sobre: true,
  ...extra,
});
const ATOMOS = [atomo(1), atomo(2), atomo(3)];

const CONFIG: ConfigRetrato = {
  dimensoes: [
    { id: "corpo", nome: "Corpo e treino", o_que_entra: "treino, sono, saúde" },
    { id: "trabalho", nome: "Trabalho", o_que_entra: "a Adapta e o que eu faço nela" },
  ],
  sugestao: null,
  atualizado_em: "",
};

/** O modelo, respondendo pela tarefa que o sufixo pede. */
function modeloQueResponde(falhar: (prompt: string) => boolean = () => false) {
  chamar.mockImplementation((async (a: { prompt: string }) => {
    const p = a.prompt;
    loja.eventos.push(`modelo ${p.slice(p.lastIndexOf("TAREFA DESTA CHAMADA"), p.lastIndexOf("TAREFA DESTA CHAMADA") + 50)}`);
    if (falhar(p)) throw new Error("o Gateway recusou");
    const t = p.includes("A FICHA CURTA")
      ? `{"resumo":"Fundador da Adapta","contexto":"setembro puxado"}`
      : p.includes("PROPOR AS DIMENSÕES")
        ? `{"dimensoes":[{"nome":"Corpo","o_que_entra":"treino"},{"nome":"Agora","o_que_entra":"x"}]}`
        : p.includes('SEÇÃO "AGORA"')
          ? `{"texto":"Em setembro de 2026, ocupado.","fontes":[1,2]}`
          : `{"texto":"Treina três vezes por semana desde agosto de 2026.","fontes":[3,99]}`;
    return { text: t, finishReason: "stop", usage: {} };
  }) as never);
}

/** O grafo: as escritas se registram na mesma linha do tempo do R2. */
function grafo(estado = "pronta") {
  consulta.mockImplementation((async (cypher: string) => {
    if (cypher.includes("resumo_anterior = coalesce")) {
      loja.eventos.push("grafo ficha");
      return [{ id: "e-eu", nome: "eu" }];
    }
    if (cypher.includes("enriquecimento_estado = 'pronta'")) {
      loja.eventos.push("grafo pronta");
      return [];
    }
    if (cypher.includes("RETURN e.enriquecimento_estado AS estado")) return [{ estado }];
    if (cypher.includes("AS velho")) {
      loja.eventos.push("grafo desfazer");
      return [{ id: "e-eu", nome: "eu", tinha: true }];
    }
    if (cypher.includes("UNWIND $ids AS id")) {
      return [
        { id: "a1", texto: "trecho 1", tipo: "FATO", valido_em: "2026-09-27", status: "ativo" },
        { id: "a3", texto: "trecho 3", tipo: "ROTINA", valido_em: "2026-09-25", status: "rejeitado" },
      ];
    }
    return [];
  }) as never);
}

const guardar = (key: string, valor: unknown) =>
  loja.objetos.set(key, { valor: structuredClone(valor), etag: loja.proximo() });

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  delete process.env.RETRATO_MODEL;
  loja.objetos.clear();
  loja.eventos.length = 0;
  chamar.mockReset();
  consulta.mockReset();
  consulta.mockResolvedValue([] as never);
});

// ───────────────────────── o id de dimensão ─────────────────────────

describe("o id de uma dimensão", () => {
  it("sai do nome, sem acento e com hífen", () => {
    expect(slugDimensao("Corpo e Treino")).toBe("corpo-e-treino");
  });

  it("`agora` nunca sai do gerador: é a seção fixa", () => {
    expect(slugDimensao("Agora")).toBe("agora-2");
    expect(slugDimensao("  AGORA! ")).toBe("agora-2");
  });

  it("colisão ganha sufixo em vez de pisar a outra", () => {
    expect(slugDimensao("Corpo", new Set(["corpo", "corpo-2"]))).toBe("corpo-3");
  });

  it("nome sem letra nenhuma ainda ganha id", () => {
    expect(slugDimensao("!!!")).toBe("dimensao");
  });
});

describe("a lista editada na tela", () => {
  it("mantém o id que veio — renomear preserva a seção", () => {
    const l = limparDimensoesDaTela([{ id: "corpo", nome: "Saúde", o_que_entra: "x" }]);
    expect(l).toEqual([{ id: "corpo", nome: "Saúde", o_que_entra: "x" }]);
  });

  it("dimensão nova ganha id pelo nome, sem roubar o de quem já existia", () => {
    const l = limparDimensoesDaTela([
      { nome: "Corpo", o_que_entra: "" },
      { id: "corpo", nome: "Saúde", o_que_entra: "" },
    ]);
    expect(l.map((d) => d.id)).toEqual(["corpo-2", "corpo"]);
  });

  it("o cliente não consegue mandar `agora` como id", () => {
    const [d] = limparDimensoesDaTela([{ id: "agora", nome: "Agora", o_que_entra: "" }]);
    expect(d.id).not.toBe(ID_AGORA);
  });

  it("dimensão sem nome é recusada inteira", () => {
    expect(() => limparDimensoesDaTela([{ nome: "  ", o_que_entra: "x" }])).toThrow(/nome/);
  });
});

// ───────────────────────── o que vai ao modelo ─────────────────────────

describe("o prompt", () => {
  it("o bloco é numerado, e o número volta como id fora do prompt", () => {
    const { bloco, ids } = blocoNumerado([atomo(1), atomo(2, { sobre: false })]);
    expect(bloco).toBe("1. [FATO 2026-09-27] trecho 1\n2. [FATO 2026-09-26] (citado) trecho 2");
    expect(ids).toEqual(["a1", "a2"]);
    expect(bloco).not.toContain("a1");
  });

  it("o formato mora no sufixo: nenhum dos três aparece antes dos átomos", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA);

    const prompts = chamar.mock.calls.map((c) => (c[0] as { prompt: string }).prompt);
    for (const p of prompts) {
      const prefixo = p.slice(0, p.indexOf("TAREFA DESTA CHAMADA"));
      expect(prefixo).not.toContain("FORMATO");
      expect(prefixo).not.toContain('"texto"');
    }
  });

  it("o prefixo é byte a byte o mesmo em todas as chamadas da rodada — é o que o cache lê", async () => {
    guardar(chaveConfigRetrato(), { ...CONFIG, dimensoes: [] }); // a rodada que pede a proposta
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA);

    const prefixos = chamar.mock.calls.map((c) => {
      const p = (c[0] as { prompt: string }).prompt;
      return p.slice(0, p.indexOf("TAREFA DESTA CHAMADA"));
    });
    expect(prefixos.length).toBe(3); // ficha, Agora, proposta
    expect(new Set(prefixos).size).toBe(1);
  });

  it("o Agora diz a data do átomo mais recente, e a dimensão diz o que entra nela", () => {
    expect(sufixoAgora("2026-09-27T00:00:00.000Z")).toContain("o mais recente é de 2026-09-27");
    expect(sufixoDimensao(CONFIG.dimensoes[0])).toContain("treino, sono, saúde");
  });

  it("sem teto de saída, modelo por string, pelo Gateway (4.12.1, regra 8)", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA);
    for (const [a] of chamar.mock.calls) {
      expect(a).not.toHaveProperty("maxOutputTokens");
      expect(typeof (a as { model: unknown }).model).toBe("string");
    }
  });

  it("RETRATO_MODEL troca o modelo dos dois agentes sem tocar em código", async () => {
    process.env.RETRATO_MODEL = "openai/gpt-5";
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA); // sem dimensões: ficha, Agora e proposta
    const modelos = chamar.mock.calls.map((c) => (c[0] as { model: string }).model);
    expect(new Set(modelos)).toEqual(new Set(["openai/gpt-5"]));
  });
});

// ───────────────────────── o que volta ─────────────────────────

describe("o parser da seção", () => {
  const ids = ["a1", "a2", "a3"];

  it("texto e fontes, de número para id", () => {
    expect(parsearSecao(`{"texto":"x","fontes":[3,1]}`, ids)).toEqual({
      texto: "x",
      fontes: ["a3", "a1"],
      descartadas: 0,
    });
  });

  it("número que não existe no bloco é descartado, e contado", () => {
    const s = parsearSecao(`{"texto":"x","fontes":[0,2,4,"3","abc",2.5]}`, ids);
    expect(s.fontes).toEqual(["a2", "a3"]);
    expect(s.descartadas).toBe(4);
  });

  it(`no máximo ${MAX_FONTES} fontes, sem repetir`, () => {
    const muitos = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const s = parsearSecao(
      `{"texto":"x","fontes":[1,1,2,3,4,5,6,7,8,9,10,11]}`,
      muitos,
    );
    expect(s.fontes).toHaveLength(MAX_FONTES);
    expect(new Set(s.fontes).size).toBe(MAX_FONTES);
  });

  it("dimensão sem material volta vazia — e sem fontes", () => {
    expect(parsearSecao(`{"texto":"","fontes":[1]}`, ids)).toEqual({
      texto: "",
      fontes: [],
      descartadas: 0,
    });
  });

  it("tolera cerca de markdown; resposta sem JSON é erro com amostra", () => {
    expect(parsearSecao('```json\n{"texto":"y","fontes":[]}\n```', ids).texto).toBe("y");
    expect(() => parsearSecao("não sei", ids)).toThrow(/não sei/);
  });

  it("a ficha curta recusa os dois vazios: gravar isso por cima seria perda", () => {
    expect(() => parsearFichaCurta(`{"resumo":"","contexto":""}`)).toThrow();
    expect(parsearFichaCurta(`{"resumo":"r"}`)).toEqual({ resumo: "r", contexto: "" });
  });
});

describe("o parser da proposta", () => {
  it("os ids saem do código, e `Agora` vira `agora-2`", () => {
    const d = parsearDimensoes(
      `{"dimensoes":[{"nome":"Corpo","o_que_entra":"treino"},{"nome":"Agora","o_que_entra":"x"}]}`,
    );
    expect(d.map((x) => x.id)).toEqual(["corpo", "agora-2"]);
  });

  it("nome que já existe na lista em vigor herda o id dela — aceitar mantém a seção", () => {
    const d = parsearDimensoes(
      `{"dimensoes":[{"nome":"corpo e TREINO","o_que_entra":"x"},{"nome":"Família","o_que_entra":"y"}]}`,
      CONFIG.dimensoes,
    );
    expect(d.map((x) => x.id)).toEqual(["corpo", "familia"]);
  });

  it("repetida e sem nome saem; lista sem nada aproveitável é erro", () => {
    const d = parsearDimensoes(
      `{"dimensoes":[{"nome":"A"},{"nome":"a"},{"nome":""},{"o_que_entra":"x"}]}`,
    );
    expect(d).toHaveLength(1);
    expect(() => parsearDimensoes(`{"dimensoes":[]}`)).toThrow();
  });

  it("o prompt da proposta pede o próprio envelope", () => {
    for (const chave of ["dimensoes", "nome", "o_que_entra"]) {
      expect(INSTRUCOES_DIMENSOES).toContain(chave);
    }
  });
});

// ───────────────────────── a rodada ─────────────────────────

describe("a rodada do \"eu\"", () => {
  it("escreve o Agora e cada dimensão, com procedência (regra 7)", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    grafo();
    modeloQueResponde();
    const r = await rodadaDoEu(EU, ATOMOS, AGORA);

    const escrito = loja.objetos.get(chaveRetrato())!.valor as RetratoDoEu;
    expect(Object.keys(escrito.secoes).sort()).toEqual(["agora", "corpo", "trabalho"]);
    expect(escrito.secoes.agora.fontes).toEqual(["a1", "a2"]);
    // O 99 não existe no bloco de três: descartado.
    expect(escrito.secoes.corpo.fontes).toEqual(["a3"]);
    expect(escrito.secoes.corpo.prompt_version).toBe(PROMPT_VERSION_RETRATO);
    expect(escrito.secoes.corpo.ate).toBe(ATOMOS[0].valido_em);
    expect(escrito.secoes.corpo.atomos).toBe(3);
    expect(r).toMatchObject({ atomos: 3, retrato: { secoes: 3, falhas: 0 } });
  });

  it("a fase 1 grava só resumo e contexto — os dois de perfil vão vazios", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA);

    const [cypher, p] = consulta.mock.calls.find((c) =>
      String(c[0]).includes("resumo_anterior = coalesce"),
    )!;
    expect(p).toMatchObject({
      resumo: "Fundador da Adapta",
      contexto: "setembro puxado",
      pode_ajudar_com: "",
      fizemos_juntos: "",
    });
    // Sem o estado: quem marca `pronta` é o fim da rodada.
    expect(String(cypher)).not.toContain("enriquecimento_estado");
  });

  it("a ordem: ficha → cache → eu.anterior.json → eu.json → pronta", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    guardar(chaveRetrato(), { secoes: { agora: { texto: "velho", fontes: [] } }, escrito_em: "", atomos: 1, modelo: "" });
    loja.eventos.length = 0;
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA);

    const e = loja.eventos.filter((x) => !x.startsWith("put config"));
    expect(e[0]).toMatch(/^modelo TAREFA DESTA CHAMADA: A FICHA CURTA/);
    expect(e[1]).toBe("grafo ficha");
    const anterior = e.indexOf(`put ${chaveRetratoAnterior()}`);
    const atual = e.indexOf(`put ${chaveRetrato()}`);
    const pronta = e.indexOf("grafo pronta");
    expect(anterior).toBeGreaterThan(1);
    expect(atual).toBeGreaterThan(anterior);
    expect(pronta).toBeGreaterThan(atual);
    // As seções rodaram depois da ficha, todas antes da escrita no R2.
    expect(e.slice(2, anterior).every((x) => x.startsWith("modelo"))).toBe(true);
    expect((loja.objetos.get(chaveRetratoAnterior())!.valor as RetratoDoEu).secoes.agora.texto).toBe(
      "velho",
    );
  });

  it("falha parcial: a seção que falhou fica com o texto anterior, e o motivo vai para a linha", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    const velha = {
      texto: "Treinava pouco.",
      fontes: ["a9"],
      atomos: 1,
      ate: "2026-08-01",
      prompt_version: "retrato-1",
      modelo: "m",
      escrito_em: "2026-09-01",
    };
    guardar(chaveRetrato(), { secoes: { corpo: velha }, escrito_em: "", atomos: 1, modelo: "" });
    grafo();
    modeloQueResponde((p) => p.includes('SEÇÃO "Corpo e treino"'));
    const r = await rodadaDoEu(EU, ATOMOS, AGORA);

    const escrito = loja.objetos.get(chaveRetrato())!.valor as RetratoDoEu;
    expect(escrito.secoes.corpo).toEqual(velha);
    expect(escrito.secoes.trabalho.texto).toContain("Treina");
    const [, p] = consulta.mock.calls.find((c) =>
      String(c[0]).includes("enriquecimento_estado = 'pronta'"),
    )!;
    expect((p as { motivo: string }).motivo).toMatch(/Corpo e treino: o Gateway recusou/);
    expect(r.retrato).toEqual({ secoes: 2, falhas: 1 });
  });

  it("falha da fase 1 é falha da rodada: sobe, e nada vai para o R2", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    grafo();
    modeloQueResponde((p) => p.includes("A FICHA CURTA"));
    await expect(rodadaDoEu(EU, ATOMOS, AGORA)).rejects.toThrow(/o Gateway recusou/);
    expect(loja.objetos.has(chaveRetrato())).toBe(false);
    expect(loja.eventos).not.toContain("grafo ficha");
    expect(loja.eventos).not.toContain("grafo pronta");
  });

  it("a primeira rodada, sem dimensões, escreve o Agora e pede a proposta — que vai para `sugestao`", async () => {
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA);

    const escrito = loja.objetos.get(chaveRetrato())!.valor as RetratoDoEu;
    expect(Object.keys(escrito.secoes)).toEqual([ID_AGORA]);
    const cfg = loja.objetos.get(chaveConfigRetrato())!.valor as ConfigRetrato;
    expect(cfg.dimensoes).toEqual([]); // nunca sem eu aceitar
    expect(cfg.sugestao?.map((d) => d.id)).toEqual(["corpo", "agora-2"]);
  });

  it("com sugestão esperando por mim, a rodada não propõe de novo", async () => {
    guardar(chaveConfigRetrato(), { dimensoes: [], sugestao: CONFIG.dimensoes, atualizado_em: "" });
    grafo();
    modeloQueResponde();
    await rodadaDoEu(EU, ATOMOS, AGORA);
    const pediu = chamar.mock.calls.some((c) =>
      (c[0] as { prompt: string }).prompt.includes("PROPOR AS DIMENSÕES"),
    );
    expect(pediu).toBe(false);
  });

  it("`enriquecer` desvia o \"eu\" para o retrato — e o prompt da ficha nunca sai", async () => {
    grafo();
    modeloQueResponde();
    consulta.mockImplementationOnce((async () =>
      ATOMOS.map((a) => ({ ...a }))) as never);
    await enriquecer({ ...EU, tipo: "Pessoa", aliases: [] });
    const prompts = chamar.mock.calls.map((c) => (c[0] as { prompt: string }).prompt);
    expect(prompts.some((p) => p.includes(SUFIXO_FICHA))).toBe(true);
    expect(prompts.some((p) => p.includes("devolve os quatro campos da ficha"))).toBe(false);
  });
});

// ───────────────────────── o desfazer ─────────────────────────

describe("o desfazer do \"eu\"", () => {
  const retrato = (texto: string): RetratoDoEu => ({
    secoes: { agora: { texto, fontes: [], atomos: 1, ate: "", prompt_version: "", modelo: "", escrito_em: "" } },
    escrito_em: "",
    atomos: 1,
    modelo: "",
  });

  it("troca os dois lados: eu.json ↔ eu.anterior.json, e os `_anterior` do nó", async () => {
    guardar(chaveRetrato(), retrato("novo"));
    guardar(chaveRetratoAnterior(), retrato("velho"));
    grafo();
    const r = await desfazerRetrato();

    expect(r.r2).toBe(true);
    expect(r.no).toEqual({ id: "e-eu", nome: "eu" });
    expect((loja.objetos.get(chaveRetrato())!.valor as RetratoDoEu).secoes.agora.texto).toBe("velho");
    expect((loja.objetos.get(chaveRetratoAnterior())!.valor as RetratoDoEu).secoes.agora.texto).toBe(
      "novo",
    );
    // O R2 primeiro, o nó depois.
    expect(loja.eventos.indexOf("grafo desfazer")).toBeGreaterThan(
      loja.eventos.indexOf(`put ${chaveRetratoAnterior()}`),
    );
  });

  it("é uma troca: um segundo toque volta ao que era", async () => {
    guardar(chaveRetrato(), retrato("novo"));
    guardar(chaveRetratoAnterior(), retrato("velho"));
    grafo();
    await desfazerRetrato();
    await desfazerRetrato();
    expect((loja.objetos.get(chaveRetrato())!.valor as RetratoDoEu).secoes.agora.texto).toBe("novo");
  });

  it("com a rodada em `rodando`, recusa — 409 na rota", async () => {
    guardar(chaveRetrato(), retrato("novo"));
    guardar(chaveRetratoAnterior(), retrato("velho"));
    grafo("rodando");
    await expect(desfazerRetrato()).rejects.toBeInstanceOf(RetratoOcupadoError);
    expect((loja.objetos.get(chaveRetrato())!.valor as RetratoDoEu).secoes.agora.texto).toBe("novo");
  });

  it("o nó falhando depois de o R2 trocar diz qual lado trocou", async () => {
    guardar(chaveRetrato(), retrato("novo"));
    guardar(chaveRetratoAnterior(), retrato("velho"));
    grafo();
    const antes = consulta.getMockImplementation()!;
    consulta.mockImplementation((async (c: string, p: unknown) => {
      if (c.includes("AS velho")) throw new Error("Aura fora do ar");
      return antes(c, p as never);
    }) as never);
    await expect(desfazerRetrato()).rejects.toBeInstanceOf(DesfazerPelaMetadeError);
    await expect(desfazerRetrato()).rejects.toThrow(/R2 foi trocado, mas o nó "eu" não/);
  });

  it("sem geração no R2, troca só o nó — e diz que o R2 não trocou", async () => {
    guardar(chaveRetrato(), retrato("novo"));
    grafo();
    const r = await desfazerRetrato();
    expect(r.r2).toBe(false);
    expect(r.no).not.toBeNull();
  });
});

// ───────────────────────── o chat ─────────────────────────

describe("ler_retrato", () => {
  const escrito = (): RetratoDoEu => ({
    secoes: {
      agora: {
        texto: "Setembro puxado.",
        fontes: ["a1"],
        atomos: 3,
        ate: "2026-09-27T00:00:00.000Z",
        prompt_version: "retrato-1",
        modelo: "m",
        escrito_em: "",
      },
      corpo: {
        texto: "Treina três vezes por semana.",
        fontes: ["a1", "a3"],
        atomos: 3,
        ate: "2026-09-27T00:00:00.000Z",
        prompt_version: "retrato-1",
        modelo: "m",
        escrito_em: "",
      },
      trabalho: { texto: "", fontes: [], atomos: 3, ate: "", prompt_version: "", modelo: "", escrito_em: "" },
    },
    escrito_em: "",
    atomos: 3,
    modelo: "m",
  });

  it("sem argumento: o Agora, com o até, e a lista de dimensões", async () => {
    guardar(chaveRetrato(), escrito());
    guardar(chaveConfigRetrato(), CONFIG);
    const r = await lerRetratoDoEu();
    expect(r.resposta).toContain("AGORA (até set/2026):\nSetembro puxado.");
    expect(r.resposta).toContain("- corpo — Corpo e treino: treino, sono, saúde");
    expect(r.resposta).toContain("- trabalho — Trabalho: a Adapta e o que eu faço nela (vazia)");
    expect(r.resposta).not.toContain("Treina três vezes");
    expect(r.leitura).toMatchObject({ dimensao: null, nome: "Agora" });
  });

  it("com argumento: só aquela seção, e as fontes com id — a rejeitada, dita", async () => {
    guardar(chaveRetrato(), escrito());
    guardar(chaveConfigRetrato(), CONFIG);
    grafo();
    const r = await lerRetratoDoEu("Corpo e treino");
    expect(r.resposta).toContain("CORPO E TREINO (até set/2026):\nTreina três vezes por semana.");
    expect(r.resposta).toContain("[id a1 · FATO · 2026-09-27] trecho 1");
    expect(r.resposta).toContain("[id a3 · ROTINA · 2026-09-25] trecho 3 (rejeitado depois)");
    expect(r.resposta).not.toContain("Setembro puxado");
    expect(r.leitura).toMatchObject({ dimensao: "corpo", nome: "Corpo e treino" });
    expect(r.fontes.map((f) => f.id)).toEqual(["a1", "a3"]);
  });

  it("aceita o id tanto quanto o nome", async () => {
    guardar(chaveRetrato(), escrito());
    guardar(chaveConfigRetrato(), CONFIG);
    grafo();
    expect((await lerRetratoDoEu("corpo")).leitura.dimensao).toBe("corpo");
  });

  it("seção vazia e retrato não escrito voltam com aviso, dizendo qual dos dois", async () => {
    guardar(chaveConfigRetrato(), CONFIG);
    expect((await lerRetratoDoEu("corpo")).aviso).toMatch(/ainda não foi escrito.*buscar_atomos/);
    guardar(chaveRetrato(), escrito());
    expect((await lerRetratoDoEu("trabalho")).aviso).toMatch(/está vazia.*buscar_atomos/);
  });

  it("dimensão que saiu da lista não é alcançável, como na tela", async () => {
    guardar(chaveRetrato(), escrito());
    guardar(chaveConfigRetrato(), { ...CONFIG, dimensoes: [CONFIG.dimensoes[1]] });
    const r = await lerRetratoDoEu("corpo");
    expect(r.aviso).toMatch(/não existe dimensão "corpo"/);
  });

  it("buscar_entidades com o \"eu\" leva a nota escrita pelo código", () => {
    const texto = respostaDasEntidades({
      entidades: [
        {
          id: "e-eu",
          nome: "eu",
          tipo: "Pessoa",
          aliases: [],
          resumo: "Fundador da Adapta",
          perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
          atomos: 3,
          sessoes: 1,
          primeira: "",
          ultima: "",
          junto_com: [],
        },
      ],
      nota: NOTA_DO_EU,
    });
    expect(texto).toContain("Fundador da Adapta");
    expect(texto.endsWith(NOTA_DO_EU)).toBe(true);
  });
});

describe("o até", () => {
  it("mês e ano, e nada quando não é data", () => {
    expect(mesAno("2026-09-27T00:00:00.000Z")).toBe("set/2026");
    expect(mesAno("")).toBe("");
    expect(mesAno("ontem")).toBe("");
  });
});

describe("a tela do retrato", async () => {
  const { moverDimensao, secoesVisiveis } = await import("@/components/RetratoDoEu");

  it("o Agora primeiro, depois as dimensões na ordem aprovada — e a removida não aparece", () => {
    const secao = { texto: "x", fontes: [], atomos: 1, ate: "", prompt_version: "", modelo: "", escrito_em: "" };
    const r: RetratoDoEu = {
      secoes: { agora: secao, corpo: secao, removida: secao },
      escrito_em: "",
      atomos: 1,
      modelo: "",
    };
    const v = secoesVisiveis(r, CONFIG);
    expect(v.map((s) => s.id)).toEqual(["agora", "corpo", "trabalho"]);
    // Dimensão nova, sem seção ainda: aparece, dizendo que vem na próxima rodada.
    expect(v[2].secao).toBeNull();
  });

  it("sem retrato escrito, as seções aparecem vazias em vez de sumir", () => {
    expect(secoesVisiveis(null, CONFIG).every((s) => s.secao === null)).toBe(true);
  });

  it("reordenar troca com a vizinha, e não sai dos limites", () => {
    expect(moverDimensao(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moverDimensao(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("o selo da linha", async () => {
  const { selo } = await import("@/components/Entidades");

  it("`pronta` com motivo mostra o motivo — é a falha parcial do retrato", () => {
    const e = { estado: "pronta" as const, motivo: "1 parte(s) falharam: Corpo: 429", em: "2026-09-29T00:00:00.000Z", atomos: 151, tem_anterior: true };
    expect(selo(e)).toBe(" · ficha de 151 átomo(s) em 29/09/2026 — 1 parte(s) falharam: Corpo: 429");
    expect(selo({ ...e, motivo: "" })).toBe(" · ficha de 151 átomo(s) em 29/09/2026");
  });
});
