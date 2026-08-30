import { describe, expect, it } from "vitest";
import {
  LIMIAR_APROXIMADO,
  acharExato,
  criarLocalizador,
  indexar,
  melhorJanela,
} from "@/lib/offsets";
import { tokenizar } from "@/lib/texto";
import type { Palavra } from "@/lib/tipos";

/** Uma palavra por segundo a partir de `de` — offsets fáceis de conferir a olho. */
function fala(texto: string, de = 0): Palavra[] {
  return texto.split(" ").map((palavra, i) => ({ palavra, inicio: de + i, fim: de + i + 0.5 }));
}

describe("índice de tokens", () => {
  it("mapeia cada token para a entrada de palavras[] que o produziu", () => {
    const palavras: Palavra[] = [{ palavra: "falei com o Rodozanco", inicio: 10, fim: 13 }];
    expect(indexar(palavras).map((t) => [t.token, t.palavra])).toEqual([
      ["falei", 0],
      ["com", 0],
      ["o", 0],
      ["rodozanco", 0],
    ]);
  });
});

describe("busca exata", () => {
  const tokens = tokenizar("hoje falei com o rodozanco sobre o contrato");

  it("acha a sequência contígua", () => {
    expect(acharExato(tokens, tokenizar("com o rodozanco"))).toBe(2);
  });

  it("recusa alvo maior que a transcrição", () => {
    expect(acharExato(tokenizar("oi"), tokenizar("oi tudo bem"))).toBe(-1);
  });

  it("dá a volta quando o cursor já passou da ocorrência", () => {
    // O modelo não devolve os átomos necessariamente na ordem em que foram ditos.
    expect(acharExato(tokens, tokenizar("hoje falei"), 5)).toBe(0);
  });
});

describe("janela aproximada", () => {
  it("acha a região com mais tokens em comum", () => {
    const tokens = tokenizar("bla bla o contrato da exxmed vai atrasar bla bla");
    const janela = melhorJanela(tokens, tokenizar("o contrato da exxmed"))!;
    expect(janela.inicio).toBe(2);
    expect(janela.comuns).toBe(4);
  });

  it("conta repetição uma vez só", () => {
    const janela = melhorJanela(tokenizar("a a a a"), tokenizar("a b"))!;
    expect(janela.comuns).toBe(1);
  });
});

describe("localizador", () => {
  it("trecho literal vira o segundo em que ele começa e termina", () => {
    const palavras = fala("hoje falei com o rodozanco sobre o contrato");
    const t = criarLocalizador(palavras)("falei com o rodozanco");
    expect(t).toEqual({ ancora: "exata", inicio_s: 1, fim_s: 4.5 });
  });

  it("casa apesar de acento e pontuação diferentes do STT", () => {
    const palavras = fala("a reuniao foi dificil");
    const t = criarLocalizador(palavras)("A reunião foi difícil.");
    expect(t.ancora).toBe("exata");
    expect(t.inicio_s).toBe(0);
  });

  it("na granularidade segmento o offset é o da frase inteira", () => {
    // O átomo registra a precisão que o provedor deu, não a que gostaríamos.
    const palavras: Palavra[] = [
      { palavra: "vamos testar o microfone", inicio: 0, fim: 3 },
      { palavra: "o contrato vai atrasar", inicio: 3, fim: 7 },
    ];
    const t = criarLocalizador(palavras)("o contrato vai atrasar");
    expect(t).toEqual({ ancora: "exata", inicio_s: 3, fim_s: 7 });
  });

  it("o cursor impede que toda repetição caia no mesmo ponto do áudio", () => {
    const palavras = fala("eu acho que sim e depois eu acho que nao");
    const localizar = criarLocalizador(palavras);
    expect(localizar("eu acho que").inicio_s).toBe(0);
    expect(localizar("eu acho que").inicio_s).toBe(6); // a segunda vez, não a primeira
  });

  it("aceita o trecho que o modelo reescreveu de leve", () => {
    const palavras = fala("entao eu falei com o rodozanco sobre o contrato da exxmed hoje");
    const t = criarLocalizador(palavras)("eu falei com Rodozanco sobre o contrato da Exxmed");
    expect(t.ancora).toBe("aproximada");
    expect(t.inicio_s).not.toBeNull();
  });

  it("trecho que não está na transcrição não ganha offset inventado", () => {
    // Procedência falsa é pior que procedência nenhuma: o átomo vai para a
    // revisão sem player, e é o primeiro a ser olhado com desconfiança.
    const palavras = fala("falei com o rodozanco sobre o contrato");
    const t = criarLocalizador(palavras)("comprei um carro vermelho ontem de manha");
    expect(t).toEqual({ ancora: "nenhuma", inicio_s: null, fim_s: null });
  });

  it("trecho vazio, ou transcrição vazia, não ancora", () => {
    expect(criarLocalizador(fala("oi tudo bem"))("")).toMatchObject({ ancora: "nenhuma" });
    expect(criarLocalizador([])("qualquer coisa")).toMatchObject({ ancora: "nenhuma" });
  });

  it("um trecho não encontrado não desalinha os seguintes", () => {
    const palavras = fala("primeira coisa dita e depois a segunda coisa dita");
    const localizar = criarLocalizador(palavras);
    expect(localizar("primeira coisa dita").inicio_s).toBe(0);
    expect(localizar("nada disso foi dito nesta sessao").ancora).toBe("nenhuma");
    expect(localizar("a segunda coisa dita").inicio_s).toBe(5);
  });

  it("offsets crescem com o áudio: um trecho do minuto 9 cai no minuto 9", () => {
    const palavras = fala("o que eu falei no minuto nove", 540);
    const t = criarLocalizador(palavras)("no minuto nove");
    expect(t.inicio_s).toBe(544);
    expect(t.fim_s).toBeCloseTo(546.5, 6);
  });

  it("o limiar é o que separa aproximada de nenhuma", () => {
    expect(LIMIAR_APROXIMADO).toBeGreaterThan(0.5);
    expect(LIMIAR_APROXIMADO).toBeLessThan(1);
  });
});
