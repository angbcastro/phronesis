/**
 * Por onde o vocabulário viaja até o modelo.
 *
 * A chave do `providerOptions` acompanha o provedor automaticamente, mas o
 * **nome da opção não**. Antes desta tabela o nome estava escrito à mão em
 * `stt.ts`: trocar `STT_MODEL` fazia o vocabulário sumir sem avisar, ou pior,
 * mandava uma opção desconhecida e derrubava a transcrição.
 *
 * Que a lista de fato muda a grafia da saída está medido — `ARCHITECTURE.md`
 * §4.4. Aqui só se testa a entrega.
 */
import { describe, expect, it } from "vitest";
import {
  MODELO_STT_PADRAO,
  opcoesDeVocabulario,
  provedorAceitaVocabulario,
} from "@/lib/modelos";

describe("a opção que carrega o vocabulário", () => {
  it("o provedor padrão de hoje recebe a lista", () => {
    expect(provedorAceitaVocabulario(MODELO_STT_PADRAO)).toBe(true);
    expect(opcoesDeVocabulario(MODELO_STT_PADRAO, ["Rodozanco"])).toEqual({
      xai: { keyterm: ["Rodozanco"] },
    });
  });

  it("a chave do mapa é o provedor, não o modelo", () => {
    expect(opcoesDeVocabulario("deepgram/nova-3", ["Exxmed"])).toEqual({
      deepgram: { keyterm: ["Exxmed"] },
    });
  });

  it("provedor desconhecido não recebe opção nenhuma", () => {
    // Silêncio é o padrão seguro: uma transcrição sem vocabulário é muito
    // melhor que nenhuma, e `keyterm` não é opção de todo mundo.
    expect(opcoesDeVocabulario("google/gemini-3.5-transcribe", ["Rodozanco"])).toBeUndefined();
    expect(provedorAceitaVocabulario("google/gemini-3.5-transcribe")).toBe(false);
  });

  it("lista vazia não vira providerOptions", () => {
    expect(opcoesDeVocabulario(MODELO_STT_PADRAO, [])).toBeUndefined();
  });

  it("id inválido estoura aqui, não numa chamada com áudio carregado", () => {
    expect(() => opcoesDeVocabulario("grok-stt", ["x"])).toThrow(/Id de modelo inválido/);
  });
});
