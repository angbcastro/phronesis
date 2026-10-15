/**
 * A normalização mora num lugar só porque duas coisas dependem dela e não
 * podem divergir: o casamento de offsets e o `nome_normalizado`, que é chave
 * única no banco. Se divergissem, "Rodozanco" acharia o áudio certo e ainda
 * assim criaria um segundo nó no grafo.
 */
import { describe, expect, it } from "vitest";
import { normalizar, plural, reescreverNomes, tokenizar } from "@/lib/texto";

describe("normalização", () => {
  it("tira acento, caixa e pontuação — o modelo pontua do jeito dele", () => {
    expect(normalizar("Reunião, difícil!")).toBe("reuniao  dificil");
    expect(tokenizar("Reunião, difícil!")).toEqual(["reuniao", "dificil"]);
  });

  it("mantém número, que é parte de nome de verdade", () => {
    expect(tokenizar("Projeto 2026")).toEqual(["projeto", "2026"]);
  });

  it("texto sem letra nenhuma vira lista vazia, não ['']", () => {
    expect(tokenizar("… — !")).toEqual([]);
    expect(tokenizar("")).toEqual([]);
  });
});

describe("reescreverNomes — o nome no texto acompanha a entidade", () => {
  const nomes = (sobre: string, ...menciona: string[]) => ({ sobre, menciona });

  it("troca o sujeito, sem caixa nem acento", () => {
    expect(
      reescreverNomes(
        "nicolle borsato topou revisar o deck.",
        nomes("Nicolle Borsato"),
        nomes("Nicolle Salgado"),
      ),
    ).toBe("Nicolle Salgado topou revisar o deck.");
    expect(reescreverNomes("Falei com o Mário.", nomes("eu", "Mario"), nomes("eu", "Márcio"))).toBe(
      "Falei com o Márcio.",
    );
  });

  it("troca a menção quando saiu uma e entrou uma", () => {
    expect(
      reescreverNomes(
        "Jantei com Nicolle Borsato e Raffa.",
        nomes("eu", "Nicolle Borsato", "Raffa"),
        nomes("eu", "Raffa", "Nicolle Salgado"),
      ),
    ).toBe("Jantei com Nicolle Salgado e Raffa.");
  });

  it("duas saindo e duas entrando: não adivinha qual virou qual", () => {
    const texto = "Ana e Bia vieram.";
    expect(reescreverNomes(texto, nomes("eu", "Ana", "Bia"), nomes("eu", "Carla", "Duda"))).toBe(texto);
  });

  it("palavra inteira: o nome dentro de outra palavra não é o nome", () => {
    expect(reescreverNomes("Ana e Mariana.", nomes("Ana"), nomes("Bia"))).toBe("Bia e Mariana.");
  });

  it("nunca troca eu nem pronome", () => {
    expect(reescreverNomes("Eu falei com ela.", nomes("eu"), nomes("Marina"))).toBe("Eu falei com ela.");
    expect(reescreverNomes("Ela me ligou.", nomes("ela"), nomes("Marina"))).toBe("Ela me ligou.");
    expect(reescreverNomes("Marina me ligou.", nomes("Marina"), nomes("eu"))).toBe("Marina me ligou.");
  });

  it("nome que não aparece inteiro no texto fica como está", () => {
    expect(reescreverNomes("A Nic topou.", nomes("Nicolle Borsato"), nomes("Nicolle Salgado"))).toBe(
      "A Nic topou.",
    );
    expect(reescreverNomes("Nicolle topou.", nomes("Nicolle Borsato"), nomes("Nicolle Salgado"))).toBe(
      "Nicolle topou.",
    );
  });

  it("o sujeito que virou menção continua no texto", () => {
    const texto = "Raffa contou da Ana.";
    expect(reescreverNomes(texto, nomes("Raffa", "Ana"), nomes("Ana", "Raffa"))).toBe(texto);
  });

  it("sem mudança de referência, o texto é o mesmo", () => {
    const texto = "Raffa contou.";
    expect(reescreverNomes(texto, nomes("Raffa"), nomes("raffa"))).toBe(texto);
  });
});

describe("o plural das telas", () => {
  it("um é singular; zero e muitos são plural", () => {
    expect(plural(1, "item", "itens")).toBe("1 item");
    expect(plural(3, "item", "itens")).toBe("3 itens");
    expect(plural(0, "sessão", "sessões")).toBe("0 sessões");
  });
});
