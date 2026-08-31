/**
 * O vocabulário gerado das entidades (slice 3).
 *
 * Duas coisas precisam estar travadas por teste. A primeira é a **ordem de
 * precedência**: o arquivo vence as vagas do teto, porque ele tem nome que eu
 * ainda não falei e entidade só existe depois que eu falo. A segunda é que
 * **grafo fora do ar não derruba transcrição** — o vocabulário é otimização, e
 * a instância Aura Free pausa sozinha.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/entidades", () => ({ nomesParaVocabulario: vi.fn(async () => []) }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => "") }));

import { readFile } from "node:fs/promises";
import { nomesParaVocabulario } from "@/lib/entidades";
import { esquecerVocabulario, keyterms, termoUtil, TTL_MS, vocabulario } from "@/lib/vocabulario";

const doGrafo = vi.mocked(nomesParaVocabulario);
const doArquivo = vi.mocked(readFile);

beforeEach(() => {
  esquecerVocabulario();
  doGrafo.mockReset();
  doGrafo.mockResolvedValue([]);
  doArquivo.mockReset();
  doArquivo.mockResolvedValue("" as never);
});

describe("união do arquivo com o grafo", () => {
  it("junta os dois, com o arquivo na frente", async () => {
    doArquivo.mockResolvedValue("Phronesis\nRodozanco\n" as never);
    doGrafo.mockResolvedValue(["Isinha", "Exxmed"]);

    expect(await vocabulario()).toEqual(["Phronesis", "Rodozanco", "Isinha", "Exxmed"]);
  });

  it("nome que está nos dois entra uma vez só", async () => {
    doArquivo.mockResolvedValue("Exxmed\n" as never);
    doGrafo.mockResolvedValue(["exxmed", "Isinha"]);

    expect(await vocabulario()).toEqual(["Exxmed", "Isinha"]);
  });

  it("o arquivo vence as vagas quando o teto aperta", async () => {
    // O grafo pode ter 300 entidades; as 100 vagas não podem empurrar para fora
    // o nome de cliente que eu escrevi à mão e ainda não falei uma vez sequer.
    doArquivo.mockResolvedValue("Rodozanco\n" as never);
    doGrafo.mockResolvedValue(Array.from({ length: 250 }, (_, i) => `Entidade${i}`));

    const lista = await vocabulario();
    expect(lista[0]).toBe("Rodozanco");
    expect(lista).toHaveLength(100);
  });
});

describe("grafo indisponível", () => {
  it("cai no arquivo em vez de estourar", async () => {
    // Aura Free pausa sozinha e o hostname para de resolver. Se essa falha
    // subisse, uma sessão inteira deixaria de ser transcrita por causa de uma
    // otimização de grafia.
    doArquivo.mockResolvedValue("Rodozanco\n" as never);
    doGrafo.mockRejectedValue(new Error("ENOTFOUND"));

    expect(await vocabulario()).toEqual(["Rodozanco"]);
  });

  it("os dois fora do ar dão lista vazia, e a transcrição segue sem keyterm", async () => {
    doArquivo.mockRejectedValue(new Error("sem arquivo") as never);
    doGrafo.mockRejectedValue(new Error("ENOTFOUND"));

    expect(await vocabulario()).toEqual([]);
  });
});

describe("cache", () => {
  it("não pergunta ao grafo a cada bloco de 30 s", async () => {
    doGrafo.mockResolvedValue(["Isinha"]);
    await vocabulario(1000);
    await vocabulario(1000 + TTL_MS - 1);
    expect(doGrafo).toHaveBeenCalledTimes(1);
  });

  it("mas expira — nome confirmado hoje chega ao STT sem redeploy", async () => {
    doGrafo.mockResolvedValue(["Isinha"]);
    await vocabulario(1000);
    await vocabulario(1000 + TTL_MS + 1);
    expect(doGrafo).toHaveBeenCalledTimes(2);
  });
});

describe("termo que não vale a pena mandar", () => {
  it("`eu` é entidade legítima e keyterm péssimo", () => {
    // Decisão tomada: "eu" é uma :Pessoa como qualquer outra. Como termo de
    // biasing seria só uma palavra comuníssima empurrada para dentro do modelo.
    expect(termoUtil("eu")).toBe(false);
    expect(keyterms(["eu", "Isinha"])).toEqual(["Isinha"]);
  });

  it("pronome que virou nó também não vai", () => {
    expect(termoUtil("ela")).toBe(false);
  });

  it("palavra comum de uma sílaba só fica de fora", () => {
    // Ensinar o STT a ouvir "casa" com mais força piora tudo em troca de nada.
    expect(termoUtil("casa")).toBe(false);
    expect(termoUtil("trabalho")).toBe(false);
  });

  it("mas nome composto passa mesmo contendo palavra comum", () => {
    expect(termoUtil("Casa do Norte")).toBe(true);
    expect(termoUtil("Maria Pai")).toBe(true);
  });

  it("nome próprio incomum é exatamente o alvo", () => {
    expect(termoUtil("Rodozanco")).toBe(true);
    expect(termoUtil("Exxmed")).toBe(true);
  });
});
