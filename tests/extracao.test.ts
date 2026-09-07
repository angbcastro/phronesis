import { describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  ancorar,
  ancorarTrechos,
  blocoDaJanela,
  blocoDasCandidatas,
  comoMencaoCrua,
  isolarJson,
  montarPrompt,
  normalizarTipo,
  orcamentoDaJanela,
  parsearResposta,
  tetoDaSegundaTentativa,
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
    porque: [],
  });
  return {
    sobre: crus.map((a) => ref(a.sobre.citado)),
    menciona: crus.map((a) => a.menciona.map((m) => ref(m.citado))),
    perfila: crus.map(() => []),
    modelo: null,
    prompt_version: null,
  };
};

const item = (extra: Record<string, unknown> = {}) => ({
  texto: "O contrato da Exxmed vai atrasar",
  tipo: "FATO",
  sobre: { citado: "Exxmed", chave: null },
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

  it("autoriza o detalhe na HISTORIA — sem isso a disciplina de volume a esmaga", () => {
    // O resto do prompt manda destilar ("prefira sempre o átomo maior e mais
    // organizado", "de 10 a 20"). A migration 007 abre uma exceção, e ela tem
    // que estar escrita: sob a regra geral, uma noite inteira vira uma linha.
    const p = montarPrompt("x");
    expect(p).toContain("HISTORIA");
    expect(p).toMatch(/A HISTÓRIA GUARDA O DETALHE/);
    expect(p).toMatch(/o único em que o texto pode ser longo/);
    expect(p).toMatch(/NÃO resuma/);
  });

  it("separa HISTORIA de ROTINA e de FATO, que é onde ela seria absorvida", () => {
    const p = montarPrompt("x");
    expect(p).toMatch(/Não é HISTORIA o dia comum[^\n]*ROTINA/);
    expect(p).toMatch(/Não é HISTORIA o fato solto[^\n]*FATO/);
  });

  it("oferece os quatro tipos de entidade, e diz o que separa ORGANIZACAO de PROJETO", () => {
    const p = montarPrompt("x");
    expect(p).toContain("PESSOA, ORGANIZACAO, PROJETO ou OBJETIVO");
    expect(p).toMatch(/não o trabalho que corre dentro dela, que é PROJETO/);
  });

  it("o sujeito da HISTORIA é eu, na mesma linha dos outros três", () => {
    expect(montarPrompt("x")).toContain("SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA → SEMPRE");
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

  it("conhece o tipo que a migration 007 acrescentou", () => {
    expect(normalizarTipo("HISTORIA")).toBe("HISTORIA");
    expect(normalizarTipo("história")).toBe("HISTORIA");
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
    const menciona = (v: unknown) =>
      parsearResposta(resposta([item({ menciona: v })])).atomos[0].menciona.map((m) => m.citado);
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
      sobre: { citado: "Exxmed", chave: null },
      menciona: [],
      trechos: ["o contrato da exxmed vai atrasar"],
    },
    {
      texto: "Isso me irritou",
      tipo: "SENTIMENTO",
      sobre: { citado: "Exxmed", chave: null },
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
        sobre: { citado: "eu", chave: null },
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
        sobre: { citado: "eu", chave: null },
        menciona: [],
        trechos: ["primeiro assunto", "o assunto de novo"],
      },
      {
        texto: "Teve um meio qualquer",
        tipo: "FATO",
        sobre: { citado: "eu", chave: null },
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

/**
 * O bloco da janela (slice 4.8) — o que transforma o prompt de sessão inteira
 * em prompt de trecho, sem mexer num byte de `INSTRUCOES_BASE`.
 */
describe("o bloco da janela", () => {
  const propostos = [
    { tipo: "ROTINA" as const, texto: "acordei cedo e pedalei", sobre: "eu" },
    { tipo: "FATO" as const, texto: "o contrato atrasou", sobre: "Exxmed" },
  ];

  it("some quando a janela é a sessão inteira e não há acumulado", () => {
    // É o que faz o arquivo importado, a gravação curta e o fallback de passe
    // único continuarem recebendo o prompt de antes desta fatia.
    expect(blocoDaJanela({ de_s: 0, ate_s: 900, unica: true, jaPropostos: [] })).toBe("");
    expect(blocoDaJanela(undefined)).toBe("");
  });

  it("sem contexto, o prompt sai igual ao de sempre", () => {
    const contexto = { de_s: 0, ate_s: 900, unica: true, jaPropostos: [] };
    expect(montarPrompt("bla", [], undefined, contexto)).toBe(montarPrompt("bla"));
  });

  it("diz de que minutos a janela é, e que a fala continua depois", () => {
    const b = blocoDaJanela({ de_s: 240, ate_s: 360, unica: false, jaPropostos: [] });
    expect(b).toContain("dos minutos 4 a 6");
    expect(b).toContain("a fala continua depois dele");
  });

  it("o orçamento é a proporção do prompt base, e escala com a duração", () => {
    // A base pede 10 a 20 numa sessão de 15 min; a janela pede a fatia dela.
    expect(orcamentoDaJanela(15 * 60)).toEqual([10, 20]);
    expect(orcamentoDaJanela(2 * 60)).toEqual([1, 3]);
    // Nunca zero: uma janela que pode render zero átomos não precisaria de teto,
    // mas pedir "de 0 a 1" convida o modelo a não fazer nada.
    expect(orcamentoDaJanela(5)[0]).toBe(1);
    expect(orcamentoDaJanela(5)[1]).toBeGreaterThan(orcamentoDaJanela(5)[0]);
  });

  it("mostra o acumulado numerado — é o que o `ref` do estende endereça", () => {
    const b = blocoDaJanela({ de_s: 120, ate_s: 240, unica: false, jaPropostos: propostos });
    expect(b).toContain("0. [ROTINA] acordei cedo e pedalei (sobre: eu)");
    expect(b).toContain("1. [FATO] o contrato atrasou (sobre: Exxmed)");
  });

  it("manda estender em vez de duplicar — é o que segura o volume da lista", () => {
    const b = blocoDaJanela({ de_s: 120, ate_s: 240, unica: false, jaPropostos: propostos });
    expect(b).toContain("estende");
    expect(b).toMatch(/ROTINA, que é no máximo UMA/);
  });

  it("sem acumulado não fala de estender: não há o que estender", () => {
    const b = blocoDaJanela({ de_s: 0, ate_s: 120, unica: false, jaPropostos: [] });
    expect(b).toContain("dos minutos 0 a 2");
    expect(b).not.toContain("estende");
  });

  it("o bloco entra antes do FORMATO, junto com as regras aprovadas", () => {
    const p = montarPrompt("bla", [], undefined, {
      de_s: 120,
      ate_s: 240,
      unica: false,
      jaPropostos: propostos,
    });
    expect(p.indexOf("ESTA JANELA")).toBeLessThan(p.indexOf("\nFORMATO\n"));
    expect(p.indexOf("NÃO COMENTE")).toBeLessThan(p.indexOf("ESTA JANELA"));
  });
});

describe("o bloco das candidatas (slice 4.9)", () => {
  const GIAMPAOLO = {
    id: "e1",
    nome: "Giampaolo Lepore",
    nome_normalizado: "giampaolo lepore",
    chaves: ["giampaolo lepore"],
    tipo: "Pessoa" as const,
    sessoes: 3,
    atomos: 7,
    aliases: ["Giam"],
    perfil: { contexto: "sócio na Adapta", pode_ajudar_com: "", fizemos_juntos: "" },
  };
  const dossie = [{ entidade: GIAMPAOLO, camada: "prefixo" as const, score: 0.5 }];

  it("dossiê vazio devolve vazio — e o prompt sai byte a byte igual ao da 4.8", () => {
    expect(blocoDasCandidatas([])).toBe("");
    expect(montarPrompt("bla", [], undefined, undefined, [])).toBe(montarPrompt("bla"));
  });

  it("lista chave, nome gravado, tipo, alias e contexto", () => {
    const b = blocoDasCandidatas(dossie);
    expect(b).toContain('chave "giampaolo lepore"');
    expect(b).toContain("Giampaolo Lepore (pessoa; também escrito: Giam)");
    expect(b).toContain("sócio na Adapta");
  });

  it("manda devolver a chave da lista, ou null — e nunca inventar uma", () => {
    const b = blocoDasCandidatas(dossie);
    expect(b).toContain('"citado"');
    expect(b).toContain('"chave"');
    expect(b).toMatch(/NUNCA invente chave fora da lista/);
  });

  it("manda o texto do átomo levar o nome gravado, e só o nome próprio", () => {
    const b = blocoDasCandidatas(dossie);
    expect(b).toContain("NOME GRAVADO");
    expect(b).toMatch(/Só o nome próprio se troca/);
  });

  it("não abre exceção na regra do sujeito de SENTIMENTO", () => {
    expect(blocoDasCandidatas(dossie)).toMatch(/SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA continuam/);
  });

  it("entra depois das regras e antes da janela, tudo antes do FORMATO", () => {
    const p = montarPrompt(
      "bla",
      [{ id: "r1", texto: "regra aprovada", cita: [], aprovada_em: "2026-09-06" }],
      undefined,
      { de_s: 120, ate_s: 240, unica: false, jaPropostos: [] },
      dossie,
    );
    expect(p.indexOf("AJUSTES QUE EU PEDI")).toBeLessThan(p.indexOf("QUEM O DIÁRIO JÁ CONHECE"));
    expect(p.indexOf("QUEM O DIÁRIO JÁ CONHECE")).toBeLessThan(p.indexOf("ESTA JANELA"));
    expect(p.indexOf("ESTA JANELA")).toBeLessThan(p.indexOf("\nFORMATO\n"));
  });
});

describe("a menção nas duas formas (slice 4.9)", () => {
  it("nome solto continua valendo — é o caminho sem dossiê, e o formato antigo", () => {
    expect(comoMencaoCrua("Exxmed")).toEqual({ citado: "Exxmed", chave: null });
    const { atomos } = parsearResposta(resposta([item({ sobre: "Exxmed" })]));
    expect(atomos[0].sobre).toEqual({ citado: "Exxmed", chave: null });
  });

  it("o par guarda a grafia falada E o nó — é o ponto da fatia", () => {
    const { atomos } = parsearResposta(
      resposta([item({ sobre: { citado: "Jean", chave: "Giampaolo Lepore" } })]),
    );
    // A chave sai normalizada: recusar por causa da caixa seria jogar fora a
    // resposta certa.
    expect(atomos[0].sobre).toEqual({ citado: "Jean", chave: "giampaolo lepore" });
  });

  it("menção sem citado nenhum não é menção", () => {
    expect(comoMencaoCrua({ chave: "", citado: "" })).toBeNull();
    expect(comoMencaoCrua(42)).toBeNull();
  });

  it("um SENTIMENTO não aponta para nó nenhum, por mais que a lista ofereça", () => {
    // A guarda do `eu` (4.8.1) do lado da extração: a lista de conhecidos na
    // frente do modelo é convite para pendurar sentimento em outra pessoa.
    const { atomos } = parsearResposta(
      resposta([
        item({ tipo: "SENTIMENTO", sobre: { citado: "Jean", chave: "giampaolo lepore" } }),
      ]),
    );
    expect(atomos[0].sobre).toEqual({ citado: "Jean", chave: null });
  });

  it("uma HISTORIA tampouco: quem a viveu comigo é menção, não sujeito", () => {
    // Mesma guarda, e aqui ela é mais tentadora ainda: a história é sobre a
    // noite com o Jean, e o modelo tem o nó do Jean na mão. O sujeito é meu; o
    // Jean fica em `menciona`, que é onde a marca de `fizemos_juntos` cai.
    const { atomos } = parsearResposta(
      resposta([
        item({
          tipo: "HISTORIA",
          sobre: { citado: "Jean", chave: "giampaolo lepore" },
          menciona: [{ citado: "Jean", chave: "giampaolo lepore" }],
        }),
      ]),
    );
    expect(atomos[0].sobre).toEqual({ citado: "Jean", chave: null });
    expect(atomos[0].menciona[0].chave).toBe("giampaolo lepore");
  });

  it("num FATO a chave fica: lá o sujeito é o assunto mesmo", () => {
    const { atomos } = parsearResposta(
      resposta([item({ tipo: "FATO", sobre: { citado: "Dapta", chave: "adapta" } })]),
    );
    expect(atomos[0].sobre.chave).toBe("adapta");
  });
});

describe("estende", () => {
  const comEstende = (itens: unknown[]) => JSON.stringify({ atomos: [], estende: itens });

  it("resposta sem a chave não é erro — a janela 0 não tem o que estender", () => {
    expect(parsearResposta(resposta([]))).toMatchObject({ estende: [] });
  });

  it("aceita a extensão que aponta para um átomo da lista", () => {
    const r = parsearResposta(comEstende([{ ref: 1, texto: "novo texto", trechos: ["e mais isso"] }]), 3);
    expect(r.estende).toEqual([{ ref: 1, texto: "novo texto", trechos: ["e mais isso"] }]);
    expect(r.descartados).toHaveLength(0);
  });

  it("`ref` fora da faixa vira descarte, e não escrita no átomo errado", () => {
    const r = parsearResposta(comEstende([{ ref: 5, texto: "x", trechos: [] }]), 2);
    expect(r.estende).toEqual([]);
    expect(r.descartados[0].motivo).toContain("não está na lista");
  });

  it("`ref` sem lista acumulada nenhuma é sempre inválida", () => {
    expect(parsearResposta(comEstende([{ ref: 0, texto: "x", trechos: [] }])).estende).toEqual([]);
  });

  it("extensão que não acrescenta nada é descartada", () => {
    const r = parsearResposta(comEstende([{ ref: 0, texto: "  ", trechos: [] }]), 1);
    expect(r.estende).toEqual([]);
    expect(r.descartados[0].motivo).toContain("não acrescenta nada");
  });

  it("só trecho novo, sem texto novo, é extensão legítima", () => {
    const r = parsearResposta(comEstende([{ ref: 0, texto: "", trechos: ["mais um pedaço"] }]), 1);
    expect(r.estende).toEqual([{ ref: 0, texto: "", trechos: ["mais um pedaço"] }]);
  });
});

describe("ancoragem por janela", () => {
  const t = transcricao("hoje o contrato da exxmed vai atrasar de novo e isso me irritou");
  const cru: AtomoCru[] = [
    {
      texto: "Isso me irritou",
      tipo: "SENTIMENTO",
      sobre: { citado: "eu", chave: null },
      menciona: [],
      trechos: ["isso me irritou"],
    },
  ];

  it("o deslocamento continua a numeração da janela anterior", () => {
    // Sem ele, a janela 1 numeraria a partir do zero e o `MERGE` do confirmar
    // sobrescreveria os átomos da janela 0 — e só na hora de confirmar.
    const [a] = ancorar("s1", cru, t, "m", novas(cru), PROMPT_VERSION, 7);
    expect(a.id).toBe("s1-7");
    expect(a.indice).toBe(7);
  });

  it("sem deslocamento, nada muda", () => {
    expect(ancorar("s1", cru, t, "m", novas(cru))[0].id).toBe("s1-0");
  });

  it("o trecho de um estende é casado com o áudio da própria janela", () => {
    const [tr] = ancorarTrechos(["isso me irritou"], t);
    expect(tr.ancora).toBe("exata");
    expect(tr.inicio_s).not.toBeNull();
  });

  it("trecho que não está na janela fica sem âncora, como qualquer outro", () => {
    expect(ancorarTrechos(["nada disso foi dito aqui"], t)[0]).toMatchObject({
      ancora: "nenhuma",
      inicio_s: null,
    });
  });
});

describe("com quanto orçamento a segunda tentativa vai", () => {
  /**
   * A primeira tentativa da janela 0 da sessão `mtqoeoqh3e3724514q1f` gastou os
   * 8000 tokens de saída inteiros pensando, com 5210 de entrada, e devolveu
   * zero caractere. A segunda foi idêntica — mesmo prompt, mesmo teto, e
   * `temperature: 0` — e falhou pelo mesmo motivo, do mesmo jeito.
   */
  it("dobra quando o raciocínio comeu o orçamento", () => {
    expect(tetoDaSegundaTentativa({ finishReason: "length", text: "" })).toBe(16000);
  });

  it("repete o mesmo teto nos outros casos", () => {
    // Resposta vazia com o modelo terminando por conta própria é intermitente:
    // aí a segunda tentativa idêntica é exatamente o certo a fazer.
    expect(tetoDaSegundaTentativa({ finishReason: "stop", text: "" })).toBe(8000);
    expect(tetoDaSegundaTentativa({})).toBe(8000);
  });
});
