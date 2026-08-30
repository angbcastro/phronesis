import { describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  ancorar,
  isolarJson,
  montarPrompt,
  normalizarTipo,
  parsearResposta,
} from "@/lib/extracao";
import type { AtomoCru, Palavra, Transcricao } from "@/lib/tipos";

const item = (extra: Record<string, unknown> = {}) => ({
  texto: "O contrato da Exxmed vai atrasar",
  tipo: "FATO",
  sobre: "Exxmed",
  menciona: [],
  trecho: "o contrato da exxmed vai atrasar",
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
    expect(p).toContain("COPIADO LITERALMENTE");
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
        item({ trecho: "  " }),
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

  it("menciona ausente ou malformado vira lista vazia, não quebra", () => {
    expect(parsearResposta(resposta([item({ menciona: undefined })])).atomos[0].menciona).toEqual([]);
    expect(parsearResposta(resposta([item({ menciona: "Exxmed" })])).atomos[0].menciona).toEqual([]);
    expect(parsearResposta(resposta([item({ menciona: ["Exxmed", "", 7] })])).atomos[0].menciona).toEqual([
      "Exxmed",
    ]);
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
      trecho: "o contrato da exxmed vai atrasar",
    },
    {
      texto: "Isso me irritou",
      tipo: "SENTIMENTO",
      sobre: "Exxmed",
      menciona: [],
      trecho: "isso me irritou",
    },
  ];

  it("id é determinístico — é o que fará o MERGE não duplicar", () => {
    expect(ancorar("mt7dlh0q", crus, t, "zai/glm-5.3-flash").map((a) => a.id)).toEqual([
      "mt7dlh0q-0",
      "mt7dlh0q-1",
    ]);
  });

  it("todo átomo carrega prompt_version e modelo (regra 7)", () => {
    for (const a of ancorar("s1", crus, t, "zai/glm-5.3-flash")) {
      expect(a.prompt_version).toBe(PROMPT_VERSION);
      expect(a.modelo).toBe("zai/glm-5.3-flash");
    }
  });

  it("os offsets vêm da transcrição, na ordem em que foram ditos", () => {
    const [primeiro, segundo] = ancorar("s1", crus, t, "m");
    expect(primeiro.inicio_s).toBe(1);
    expect(segundo.inicio_s!).toBeGreaterThan(primeiro.fim_s!);
    expect(primeiro.ancora).toBe("exata");
  });

  it("átomo que o modelo inventou fica sem offset, não com offset falso", () => {
    const inventado: AtomoCru[] = [{ ...crus[0], trecho: "comprei um carro vermelho ontem" }];
    const [a] = ancorar("s1", inventado, t, "m");
    expect(a).toMatchObject({ ancora: "nenhuma", inicio_s: null, fim_s: null });
  });

  it("preserva o texto do modelo, que não é o trecho do áudio", () => {
    // `texto` é a afirmação; `trecho` é a prova dela na transcrição.
    const [a] = ancorar("s1", crus, t, "m");
    expect(a.texto).toBe("O contrato da Exxmed vai atrasar");
    expect(a.trecho).toBe("o contrato da exxmed vai atrasar");
  });
});
