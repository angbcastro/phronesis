/**
 * A emenda: o que o `redacao-1` pode fazer com um prompt, e — sobretudo — o que
 * ele não consegue fazer.
 *
 * **O teste mais importante deste arquivo é "seção que ninguém citou volta byte
 * a byte".** É a promessa inteira da slice 7: o pedido foi ajuste incremental,
 * e a resposta não foi pedir bom comportamento no prompt, foi tirar do redator
 * a possibilidade de se comportar mal — ele devolve emendas por seção, e o que
 * ele não nomeia nunca sai do servidor.
 *
 * Os outros testes são as amarras do parser, e valem pela mesma razão de sempre:
 * amarra que vive só no texto do prompt é amarra que o modelo ignora num dia
 * ruim, e o que estas protegem é a coisa que produz todo o resto.
 */
import { describe, expect, it } from "vitest";
import {
  aplicarEdicoes,
  ehCabecalho,
  fatiar,
  parsearEdicoes,
  RedacaoError,
  secaoDoEnvelope,
  secoesDe,
} from "@/lib/redacao";
import { MAX_SECOES_POR_EMENDA } from "@/lib/tipos";
import type { Edicao } from "@/lib/tipos";

/** Um prompt com a forma dos deste sistema: abertura, seções, FORMATO no fim. */
const PROMPT = [
  "Você lê um trecho e devolve o que importa.",
  "",
  "QUANTOS",
  "De um a cinco. Menos é melhor.",
  "",
  "O QUE MERECE",
  "O que eu não lembraria sozinho daqui a seis meses.",
  "Trivialidade do dia junta num item só.",
  "",
  "FORMATO",
  'Responda só JSON: {"atomos":[],"entidades":[]}',
].join("\n");

const edicao = (e: Partial<Edicao> = {}): Edicao => ({
  secao: "QUANTOS",
  operacao: "acrescentar",
  texto: "Nunca corte a conclusão.",
  padrao: "p1",
  ...e,
});

// ─────────────────────────── o corte em seções ───────────────────────────

describe("o prompt se divide em seções pelo cabeçalho", () => {
  it("cabeçalho é linha inteira em caixa alta, e conteúdo não é", () => {
    expect(ehCabecalho("O QUE MERECE")).toBe(true);
    expect(ehCabecalho("A HISTÓRIA GUARDA O DETALHE")).toBe(true);
    expect(ehCabecalho("De um a cinco. Menos é melhor.")).toBe(false);
    expect(ehCabecalho("FATO")).toBe(true);
    // Curto demais para ser cabeçalho: evita pegar sigla solta no meio do texto.
    expect(ehCabecalho("OK")).toBe(false);
  });

  it("acha os cabeçalhos na ordem, e só eles", () => {
    expect(secoesDe(PROMPT)).toEqual(["QUANTOS", "O QUE MERECE", "FORMATO"]);
  });

  it("as fronteiras recortam o texto original, sem remontar linha nenhuma", () => {
    // Remontar com `join` normalizaria \\r\\n e espaço no fim de linha, e aí
    // "volta byte a byte" deixaria de ser verdade no caso que ninguém olharia.
    for (const s of fatiar(PROMPT)) {
      expect(PROMPT.slice(s.inicio, s.fim)).toBe(s.nome + s.corpo);
    }
  });

  it("prompt sem cabeçalho nenhum não tem seção — e não estoura", () => {
    expect(secoesDe("faça o que eu mando")).toEqual([]);
    expect(fatiar("faça o que eu mando")).toEqual([]);
  });
});

describe("a seção do envelope é achada pelo conteúdo, não pelo nome", () => {
  it("acha a que contém as chaves do parser", () => {
    expect(secaoDoEnvelope(PROMPT, ["atomos", "entidades"])).toBe("FORMATO");
  });

  it("um cabeçalho renomeado por mim continua sendo achado", () => {
    // Eu posso ter reescrito o prompt no painel e chamado o FORMATO de outra
    // coisa. O que define a seção é ela pedir o JSON, não o nome dela.
    const meu = PROMPT.replace("FORMATO", "COMO RESPONDER");
    expect(secaoDoEnvelope(meu, ["atomos", "entidades"])).toBe("COMO RESPONDER");
  });

  it("agente sem envelope não tem seção protegida", () => {
    expect(secaoDoEnvelope(PROMPT, [])).toBeNull();
  });
});

// ────────────────── a garantia: o que não foi citado não muda ──────────────────

describe("seção que ninguém citou volta byte a byte", () => {
  /** As seções intocadas, recortadas do texto — é a comparação que vale. */
  const intocadas = (antes: string, depois: string, mexidas: string[]) => {
    const a = fatiar(antes).filter((s) => !mexidas.includes(s.nome.trim()));
    const d = new Map(fatiar(depois).map((s) => [s.nome.trim(), s]));
    return a.map((s) => [s.nome + s.corpo, (d.get(s.nome.trim())?.nome ?? "") + (d.get(s.nome.trim())?.corpo ?? "")]);
  };

  it("acrescentar numa seção não toca em nenhuma outra", () => {
    const saida = aplicarEdicoes(PROMPT, [edicao()]);
    for (const [antes, depois] of intocadas(PROMPT, saida, ["QUANTOS"])) {
      expect(depois).toBe(antes);
    }
  });

  it("reescrever uma seção não toca em nenhuma outra", () => {
    const saida = aplicarEdicoes(PROMPT, [
      edicao({ secao: "O QUE MERECE", operacao: "reescrever", texto: "Só o que eu decidi." }),
    ]);
    for (const [antes, depois] of intocadas(PROMPT, saida, ["O QUE MERECE"])) {
      expect(depois).toBe(antes);
    }
    expect(saida).not.toContain("Trivialidade do dia junta num item só.");
  });

  it("duas edições em seções diferentes deixam a terceira intacta", () => {
    const saida = aplicarEdicoes(PROMPT, [
      edicao(),
      edicao({ secao: "O QUE MERECE", operacao: "reescrever", texto: "Só o que eu decidi." }),
    ]);
    for (const [antes, depois] of intocadas(PROMPT, saida, ["QUANTOS", "O QUE MERECE"])) {
      expect(depois).toBe(antes);
    }
  });

  it("lista de edições vazia devolve o prompt idêntico, e não uma cópia normalizada", () => {
    expect(aplicarEdicoes(PROMPT, [])).toBe(PROMPT);
  });
});

describe("o que cada operação faz com o corpo", () => {
  it("acrescentar preserva o que já estava e põe o novo no fim", () => {
    const saida = aplicarEdicoes(PROMPT, [
      edicao({ secao: "O QUE MERECE", operacao: "acrescentar", texto: "Decisão sempre entra." }),
    ]);
    const corpo = fatiar(saida).find((s) => s.nome === "O QUE MERECE")!.corpo;
    expect(corpo).toContain("Trivialidade do dia junta num item só.");
    expect(corpo.trimEnd().endsWith("Decisão sempre entra.")).toBe(true);
  });

  it("reescrever substitui o corpo inteiro e mantém o cabeçalho", () => {
    const saida = aplicarEdicoes(PROMPT, [
      edicao({ secao: "QUANTOS", operacao: "reescrever", texto: "De um a três." }),
    ]);
    expect(saida).toContain("QUANTOS\nDe um a três.\n");
    expect(saida).not.toContain("De um a cinco.");
  });

  it("criar entra ANTES da seção do envelope, nunca depois dela", () => {
    // Foi o primeiro defeito desta fatia. Seção nova depois do FORMATO seria
    // lida como parte do exemplo de JSON — a mesma armadilha que
    // `inserirAntesDoFormato` evitava desde a 4.6.
    const saida = aplicarEdicoes(
      PROMPT,
      [edicao({ secao: "O TOM", operacao: "criar", texto: "Escreva como eu falo." })],
      { antesDe: "FORMATO" },
    );
    expect(saida.indexOf("O TOM")).toBeLessThan(saida.indexOf("FORMATO"));
    expect(saida).toContain("Escreva como eu falo.");
    expect(secoesDe(saida)).toEqual(["QUANTOS", "O QUE MERECE", "O TOM", "FORMATO"]);
  });

  it("sem seção de envelope, criar vai para o fim — que aí é o lugar certo", () => {
    const saida = aplicarEdicoes(
      PROMPT,
      [edicao({ secao: "O TOM", operacao: "criar", texto: "Escreva como eu falo." })],
      { antesDe: null },
    );
    expect(secoesDe(saida)).toEqual(["QUANTOS", "O QUE MERECE", "FORMATO", "O TOM"]);
  });

  it("seção que não existe faz a emenda inteira falhar, e não uma parcial", () => {
    // Emenda parcial é a única saída pior que emenda nenhuma: eu aprovaria
    // achando que os dois padrões entraram, e só um teria entrado.
    expect(() =>
      aplicarEdicoes(PROMPT, [edicao(), edicao({ secao: "SEÇÃO QUE NÃO EXISTE" })]),
    ).toThrow(RedacaoError);
    // E o prompt continua de pé: a função é pura, não muda nada antes de falhar.
    expect(secoesDe(PROMPT)).toEqual(["QUANTOS", "O QUE MERECE", "FORMATO"]);
  });
});

// ────────────────────────── as amarras do parser ──────────────────────────

describe("as amarras do redacao-1 valem no parser, não só no prompt", () => {
  const contexto = {
    secoes: ["QUANTOS", "O QUE MERECE", "FORMATO"],
    padroes: new Set(["p1", "p2"]),
    protegida: "FORMATO",
  };

  const parsear = (edicoes: unknown[]) =>
    parsearEdicoes(JSON.stringify({ edicoes }), contexto);

  const item = (e: Record<string, unknown> = {}) => ({
    secao: "QUANTOS",
    operacao: "acrescentar",
    texto: "faça isso",
    padrao: "p1",
    ...e,
  });

  it("apagar não existe — e é a ausência que é a amarra", () => {
    // Apagar uma seção inteira é decisão minha, no editor de `/agentes`,
    // olhando o texto. Nunca efeito de um padrão confirmado em três segundos.
    expect(parsear([item({ operacao: "apagar" })])).toEqual([]);
    expect(parsear([item({ operacao: "substituir" })])).toEqual([]);
  });

  it("a seção do envelope é intocável", () => {
    // `envelopeFaltando` continua sendo a última porta, mas ele checa se as
    // chaves estão lá, não se o exemplo de JSON continua legível.
    expect(parsear([item({ secao: "FORMATO", operacao: "reescrever" })])).toEqual([]);
  });

  it("seção que não existe no prompt corrente é recusada", () => {
    expect(parsear([item({ secao: "SEÇÃO INVENTADA" })])).toEqual([]);
  });

  it("criar sobre uma seção que já existe é reescrever disfarçado, e cai", () => {
    expect(parsear([item({ secao: "QUANTOS", operacao: "criar" })])).toEqual([]);
  });

  it("criar uma seção nova passa", () => {
    expect(parsear([item({ secao: "O TOM", operacao: "criar" })])).toHaveLength(1);
  });

  it("padrão que eu não confirmei é recusado", () => {
    // Passaria, e `incorporada_em` fecharia correções que a emenda nunca leu.
    expect(parsear([item({ padrao: "p-inventado" })])).toEqual([]);
    expect(parsear([item({ padrao: "" })])).toEqual([]);
  });

  it("duas edições na mesma seção viram uma — a segunda venceria em silêncio", () => {
    expect(parsear([item(), item({ texto: "outra coisa" })])).toHaveLength(1);
  });

  it("mais seções do que o teto: só as primeiras passam", () => {
    const tres = [
      item(),
      item({ secao: "O QUE MERECE" }),
      item({ secao: "O TOM", operacao: "criar" }),
    ];
    expect(parsear(tres)).toHaveLength(MAX_SECOES_POR_EMENDA);
  });

  it("edição sem texto não é edição", () => {
    expect(parsear([item({ texto: "" })])).toEqual([]);
    expect(parsear([item({ texto: "   " })])).toEqual([]);
  });

  it("resposta sem JSON nenhum é lista vazia, não um erro", () => {
    expect(parsearEdicoes("desculpe, não consegui", contexto)).toEqual([]);
    expect(parsearEdicoes("", contexto)).toEqual([]);
  });

  it("cerca de markdown não atrapalha, como nos outros agentes", () => {
    const bruto = '```json\n{"edicoes":[{"secao":"QUANTOS","operacao":"acrescentar","texto":"x","padrao":"p1"}]}\n```';
    expect(parsearEdicoes(bruto, contexto)).toHaveLength(1);
  });

  it("nenhuma edição é resposta legítima", () => {
    expect(parsear([])).toEqual([]);
  });

  it("agente sem seção protegida não protege nada", () => {
    const semEnvelope = { ...contexto, protegida: null };
    expect(parsearEdicoes(JSON.stringify({ edicoes: [item({ secao: "FORMATO" })] }), semEnvelope))
      .toHaveLength(1);
  });
});

// ──────────────── o caminho inteiro, do parser ao texto final ────────────────

describe("do JSON do modelo ao prompt novo", () => {
  it("o que o parser aceita, aplicar aceita — e o resto do prompt não se move", () => {
    const bruto = JSON.stringify({
      edicoes: [
        { secao: "QUANTOS", operacao: "acrescentar", texto: "Nunca corte a conclusão.", padrao: "p1" },
        { secao: "FORMATO", operacao: "reescrever", texto: "manda qualquer coisa", padrao: "p1" },
      ],
    });
    const edicoes = parsearEdicoes(bruto, {
      secoes: ["QUANTOS", "O QUE MERECE", "FORMATO"],
      padroes: new Set(["p1"]),
      protegida: "FORMATO",
    });

    // A do FORMATO caiu no parser; só a legítima chegou aqui.
    expect(edicoes).toHaveLength(1);

    const saida = aplicarEdicoes(PROMPT, edicoes, { antesDe: "FORMATO" });
    expect(saida).toContain("Nunca corte a conclusão.");
    // O envelope continua pedindo o que o parser da extração sabe ler.
    expect(saida).toContain('{"atomos":[],"entidades":[]}');
    expect(saida).not.toContain("manda qualquer coisa");
  });
});
