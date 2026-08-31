import { describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  ancorar,
  isolarJson,
  montarPrompt,
  normalizarTipo,
  parsearResposta,
} from "@/lib/extracao";
import type { Atribuicoes } from "@/lib/resolucao";
import type { AtomoCru, Palavra, Transcricao } from "@/lib/tipos";

/**
 * As atribuições que um grafo vazio produz: toda menção vira entidade nova, sem
 * nenhuma chamada de modelo. `ancorar` só costura o que o agente 2 decidiu — o
 * que se testa aqui é a costura e a âncora, não a decisão.
 */
const novas = (crus: AtomoCru[]): Atribuicoes => {
  const ref = (nome: string) => ({
    citado: nome,
    entidade: nome,
    conhecida: false,
    certo: true,
    alternativas: [],
    motivo: "",
  });
  return {
    sobre: crus.map((a) => ref(a.sobre)),
    menciona: crus.map((a) => a.menciona.map(ref)),
    perfila: crus.map(() => []),
    modelo: null,
    prompt_version: null,
  };
};

const item = (extra: Record<string, unknown> = {}) => ({
  texto: "O contrato da Exxmed vai atrasar",
  tipo: "FATO",
  sobre: "Exxmed",
  menciona: [],
  trechos: ["o contrato da exxmed vai atrasar"],
  ...extra,
});

const resposta = (itens: unknown[]) => JSON.stringify({ atomos: itens });

function transcricao(texto: string): Transcricao {
  const palavras: Palavra[] = texto
    .split(" ")
    .map((palavra, i) => ({ palavra, inicio: i, fim: i + 0.5 }));
  return {
    sessao_id: "mt7dlh0q",
    texto,
    palavras,
    blocos: [],
    modelo: "xai/grok-stt",
    granularidade: "segmento",
  };
}

describe("prompt", () => {
  it("manda a transcrição e exige o trecho literal — é o que vira offset", () => {
    const p = montarPrompt("falei com o Rodozanco");
    expect(p).toContain("falei com o Rodozanco");
    expect(p).toContain("COPIADOS LITERALMENTE");
  });

  it("manda selecionar, não picar — é o que quebrou na primeira extração real", () => {
    const p = montarPrompt("x");
    expect(p).toContain("10 a 20");
    expect(p).toMatch(/um átomo por frase, está errado/);
    expect(p).toContain("ROTINA");
  });

  it("tem versão, que vai gravada em todo átomo (regra 7)", () => {
    expect(PROMPT_VERSION).toMatch(/\S/);
  });
});

describe("isolar o JSON", () => {
  it("tira a cerca de markdown", () => {
    expect(JSON.parse(isolarJson('```json\n{"atomos":[]}\n```'))).toEqual({ atomos: [] });
  });

  it("ignora a frase que o modelo emenda antes", () => {
    expect(JSON.parse(isolarJson('Claro! Aqui está:\n{"atomos":[]}'))).toEqual({ atomos: [] });
  });

  it("resposta sem JSON nenhum estoura", () => {
    expect(() => isolarJson("desculpe, não consegui")).toThrow(/sem JSON/);
  });
});

describe("tipo do átomo", () => {
  it("aceita com acento e em qualquer caixa", () => {
    expect(normalizarTipo("OPINIÃO")).toBe("OPINIAO");
    expect(normalizarTipo(" sentimento ")).toBe("SENTIMENTO");
  });

  it("conhece os dois tipos que a migration 003 acrescentou", () => {
    expect(normalizarTipo("DECISAO")).toBe("DECISAO");
    expect(normalizarTipo("decisão")).toBe("DECISAO");
    expect(normalizarTipo("ROTINA")).toBe("ROTINA");
  });

  it("recusa o que não está no contrato do schema", () => {
    expect(normalizarTipo("REFLEXAO")).toBeNull();
    expect(normalizarTipo(null)).toBeNull();
  });
});

describe("parse", () => {
  it("aceita a lista solta, sem o envelope", () => {
    expect(parsearResposta(JSON.stringify([item()])).atomos).toHaveLength(1);
  });

  it("JSON quebrado estoura — não devolve lista vazia como se estivesse tudo bem", () => {
    expect(() => parsearResposta("{isso não é json")).toThrow(/JSON/);
  });

  it("resposta sem a lista estoura", () => {
    expect(() => parsearResposta('{"resultado":"nenhum"}')).toThrow(/atomos/);
  });

  it("item ruim é descartado com motivo, sem derrubar os bons", () => {
    const { atomos, descartados } = parsearResposta(
      resposta([
        item(),
        item({ tipo: "REFLEXAO" }),
        item({ trechos: ["  "] }),
        item({ texto: "" }),
        item({ sobre: "" }),
        "isto não é um objeto",
      ]),
    );
    expect(atomos).toHaveLength(1);
    expect(descartados.map((d) => d.motivo)).toEqual([
      "tipo desconhecido: REFLEXAO",
      "sem trecho — não haveria como ligar ao áudio",
      "texto vazio",
      "sem sujeito",
      "item não é objeto",
    ]);
  });

  it("trecho solto em string vira lista de um — erro de forma não perde conteúdo", () => {
    const { atomos } = parsearResposta(
      resposta([item({ trechos: "o contrato da exxmed vai atrasar" })]),
    );
    expect(atomos[0].trechos).toEqual(["o contrato da exxmed vai atrasar"]);
  });

  it("menciona ausente ou malformado não quebra o átomo", () => {
    const menciona = (v: unknown) => parsearResposta(resposta([item({ menciona: v })])).atomos[0].menciona;
    expect(menciona(undefined)).toEqual([]);
    expect(menciona(42)).toEqual([]);
    expect(menciona(["Exxmed", "", 7])).toEqual(["Exxmed"]);
    // String solta vira lista de um, como em `trechos`: erro de forma do modelo
    // não é motivo para jogar fora uma menção boa.
    expect(menciona("Exxmed")).toEqual(["Exxmed"]);
  });
});

describe("ancoragem", () => {
  const t = transcricao("hoje o contrato da exxmed vai atrasar de novo e isso me irritou");
  const crus: AtomoCru[] = [
    {
      texto: "O contrato da Exxmed vai atrasar",
      tipo: "FATO",
      sobre: "Exxmed",
      menciona: [],
      trechos: ["o contrato da exxmed vai atrasar"],
    },
    {
      texto: "Isso me irritou",
      tipo: "SENTIMENTO",
      sobre: "Exxmed",
      menciona: [],
      trechos: ["isso me irritou"],
    },
  ];

  it("id é determinístico — é o que fará o MERGE não duplicar", () => {
    expect(ancorar("mt7dlh0q", crus, t, "zai/glm-5.3-flash", novas(crus)).map((a) => a.id)).toEqual([
      "mt7dlh0q-0",
      "mt7dlh0q-1",
    ]);
  });

  it("todo átomo carrega prompt_version e modelo (regra 7)", () => {
    for (const a of ancorar("s1", crus, t, "zai/glm-5.3-flash", novas(crus))) {
      expect(a.prompt_version).toBe(PROMPT_VERSION);
      expect(a.modelo).toBe("zai/glm-5.3-flash");
    }
  });

  it("os offsets vêm da transcrição, na ordem em que foram ditos", () => {
    const [primeiro, segundo] = ancorar("s1", crus, t, "m", novas(crus));
    expect(primeiro.trechos[0].inicio_s).toBe(1);
    expect(segundo.trechos[0].inicio_s!).toBeGreaterThan(primeiro.trechos[0].fim_s!);
    expect(primeiro.trechos[0].ancora).toBe("exata");
  });

  it("átomo que o modelo inventou fica sem offset, não com offset falso", () => {
    const inventado: AtomoCru[] = [{ ...crus[0], trechos: ["comprei um carro vermelho ontem"] }];
    const [a] = ancorar("s1", inventado, t, "m", novas(inventado));
    expect(a.trechos[0]).toMatchObject({ ancora: "nenhuma", inicio_s: null, fim_s: null });
  });

  it("preserva o texto do modelo, que não é o trecho do áudio", () => {
    // `texto` é a afirmação; `trechos` são a prova dela na transcrição.
    const [a] = ancorar("s1", crus, t, "m", novas(crus));
    expect(a.texto).toBe("O contrato da Exxmed vai atrasar");
    expect(a.trechos[0].texto).toBe("o contrato da exxmed vai atrasar");
  });

  it("um átomo que junta dois momentos ancora nos dois", () => {
    // É o caso que a migration 003 existe para suportar: o mesmo assunto dito
    // no começo e retomado no fim vira um átomo só, com duas âncoras.
    const sessao = transcricao(
      "fui treinar de manha e depois um monte de coisa aconteceu e no fim treinar tem me segurado",
    );
    const junto: AtomoCru[] = [
      {
        texto: "Treinei, e treinar tem me segurado",
        tipo: "SENTIMENTO",
        sobre: "eu",
        menciona: [],
        trechos: ["fui treinar de manha", "treinar tem me segurado"],
      },
    ];
    const [a] = ancorar("s1", junto, sessao, "m", novas(junto));
    expect(a.trechos).toHaveLength(2);
    expect(a.trechos.every((tr) => tr.ancora === "exata")).toBe(true);
    expect(a.trechos[1].inicio_s!).toBeGreaterThan(a.trechos[0].fim_s!);
  });

  it("o segundo trecho não empurra o cursor e desalinha o átomo seguinte", () => {
    // Sem `semAvancar`, o átomo que junta o fim da sessão jogaria a busca do
    // próximo para depois dele, e o próximo cairia na volta ou em nada.
    const sessao = transcricao("primeiro assunto e um meio qualquer e por fim o assunto de novo");
    const atomos: AtomoCru[] = [
      {
        texto: "O assunto, do começo ao fim",
        tipo: "FATO",
        sobre: "eu",
        menciona: [],
        trechos: ["primeiro assunto", "o assunto de novo"],
      },
      {
        texto: "Teve um meio qualquer",
        tipo: "FATO",
        sobre: "eu",
        menciona: [],
        trechos: ["um meio qualquer"],
      },
    ];
    const [, segundo] = ancorar("s1", atomos, sessao, "m", novas(atomos));
    expect(segundo.trechos[0].ancora).toBe("exata");
    expect(segundo.trechos[0].inicio_s).toBe(3); // "um" é a 4a palavra (índice 3)
  });
});

describe("resposta ilegível deixa rastro", () => {
  it("o erro carrega o que o modelo devolveu, não só que falhou", () => {
    // Sem isto, "não é JSON" é indiagnosticável depois do fato — foi o que
    // aconteceu na sessão mtgo3kaf5, em que o raciocínio do modelo comeu o
    // orçamento de saída e sobrou texto nenhum.
    expect(() => parsearResposta("desculpe, não consegui extrair nada")).toThrow(
      /desculpe, não consegui/,
    );
  });

  it("resposta vazia é dita como vazia, não como texto em branco", () => {
    expect(() => parsearResposta("   ")).toThrow(/resposta vazia/);
  });

  it("o erro diz quantos caracteres vieram", () => {
    expect(() => parsearResposta("abc")).toThrow(/3 caractere/);
  });
});

describe("prompt não deixa o modelo comentar o material", () => {
  it("proíbe átomo sobre a transcrição e oferece a lista vazia como saída", () => {
    const p = montarPrompt("x");
    expect(p).toMatch(/NÃO COMENTE A TRANSCRIÇÃO/);
    expect(p).toContain('{"atomos":[],"entidades":[]}');
  });
});
