import { describe, expect, it } from "vitest";
import {
  chaveChunkAudio,
  chaveChunkTranscricao,
  chaveManifest,
  chaveTranscricao,
  chavesDaSessao,
  idValido,
  indiceChunk,
} from "@/lib/chaves";
import { novoId } from "@/lib/sessoes";
import type { Manifest } from "@/lib/tipos";

describe("layout do R2", () => {
  it("monta as chaves do jeito que a spec descreve", () => {
    expect(chaveManifest("abc123xy")).toBe("sessoes/abc123xy/manifest.json");
    expect(chaveChunkAudio("abc123xy", 0)).toBe("sessoes/abc123xy/chunk_000.webm");
    expect(chaveChunkTranscricao("abc123xy", 0)).toBe("sessoes/abc123xy/chunk_000.json");
    expect(chaveTranscricao("abc123xy")).toBe("sessoes/abc123xy/transcricao.json");
  });

  it("preenche o índice com zeros até três dígitos", () => {
    expect(indiceChunk(7)).toBe("007");
    expect(indiceChunk(29)).toBe("029");
  });

  it("uma sessão de 15 min chega ao bloco 29 sem estourar o formato", () => {
    expect(chaveChunkAudio("abc123xy", 29)).toBe("sessoes/abc123xy/chunk_029.webm");
  });

  it("passa de três dígitos sem truncar em sessões longas", () => {
    expect(indiceChunk(1000)).toBe("1000");
  });

  it("recusa índice inválido em vez de montar chave torta", () => {
    expect(() => indiceChunk(-1)).toThrow();
    expect(() => indiceChunk(1.5)).toThrow();
  });
});

describe("id de sessão", () => {
  it("aceita o formato que o sistema gera", () => {
    expect(idValido(novoId())).toBe(true);
  });

  it("barra travessia de caminho e caractere estranho", () => {
    expect(idValido("../../segredo")).toBe(false);
    expect(idValido("abc/def")).toBe(false);
    expect(idValido("ABC12345")).toBe(false);
    expect(idValido("curto")).toBe(false);
  });

  it("gera ids distintos em chamadas seguidas", () => {
    const ids = new Set(Array.from({ length: 200 }, () => novoId()));
    expect(ids.size).toBe(200);
  });

  it("ordena por tempo: id mais novo é lexicograficamente maior", () => {
    const antes = novoId(new Date("2026-01-01").getTime());
    const depois = novoId(new Date("2026-08-23").getTime());
    expect(depois > antes).toBe(true);
  });
});

describe("chave do bloco com extensão — áudio importado", () => {
  it("mantém webm quando ninguém passa extensão: a gravação não muda", () => {
    expect(chaveChunkAudio("abc123xy", 0)).toBe("sessoes/abc123xy/chunk_000.webm");
  });

  it("usa a extensão do arquivo importado", () => {
    expect(chaveChunkAudio("abc123xy", 0, "opus")).toBe("sessoes/abc123xy/chunk_000.opus");
    expect(chaveChunkAudio("abc123xy", 0, "m4a")).toBe("sessoes/abc123xy/chunk_000.m4a");
  });

  // A extensão vira caminho no R2; cliente adulterado não pode escrever fora.
  it("recusa extensão fora da lista em vez de montar chave torta", () => {
    expect(() => chaveChunkAudio("abc123xy", 0, "exe")).toThrow();
    expect(() => chaveChunkAudio("abc123xy", 0, "../../segredo")).toThrow();
  });
});

describe("as chaves de uma sessão inteira — o que o apagar percorre", () => {
  const manifest = (chunks: { i: number; ext?: string }[]): Manifest => ({
    sessao_id: "abc123xy",
    chunks: chunks.map((c) => ({ ...c, bytes: 1, subido_em: "2026-09-07T00:00:00Z", transcrito: true })),
    finalizado: true,
  });

  it("enumera os três objetos de cada bloco, com a extensão que o bloco tem", () => {
    const chaves = chavesDaSessao(manifest([{ i: 0, ext: "wav" }, { i: 1, ext: "wav" }]));
    expect(chaves).toContain("sessoes/abc123xy/chunk_000.wav");
    expect(chaves).toContain("sessoes/abc123xy/chunk_000.json");
    expect(chaves).toContain("sessoes/abc123xy/candidatas_000.json");
    expect(chaves).toContain("sessoes/abc123xy/chunk_001.wav");
  });

  // Manifest de antes da importação existir não tem `ext`, e o áudio dele está
  // em `.webm`. Procurar noutra extensão deixaria o objeto para trás.
  it("cai em webm no bloco sem extensão declarada", () => {
    expect(chavesDaSessao(manifest([{ i: 0 }]))).toContain("sessoes/abc123xy/chunk_000.webm");
  });

  it("enumera as fixas mesmo quando elas podem não existir", () => {
    const chaves = chavesDaSessao(manifest([]));
    expect(chaves).toEqual(
      expect.arrayContaining([
        "sessoes/abc123xy/transcricao.json",
        "sessoes/abc123xy/parcial.json",
        "sessoes/abc123xy/extracao.json",
        "sessoes/abc123xy/extracao-anterior.json",
        "sessoes/abc123xy/correcoes.json",
        "sessoes/abc123xy/manifest.json",
      ]),
    );
  });

  /**
   * O manifest é quem sabe quais blocos existem, e `r2.ts` não tem `LIST`:
   * apagá-lo primeiro deixaria trinta e cinco objetos inalcançáveis para sempre.
   */
  it("põe o manifest por último — é ele que enumera os blocos", () => {
    const chaves = chavesDaSessao(manifest([{ i: 0, ext: "wav" }]));
    expect(chaves[chaves.length - 1]).toBe("sessoes/abc123xy/manifest.json");
  });

  // Correção é material de calibração, não dado de sessão. Apagar seria
  // desaprender — e o índice é de todas as sessões, não desta.
  it("não toca no índice de calibração", () => {
    expect(chavesDaSessao(manifest([{ i: 0 }])).join(" ")).not.toContain("calibracao/");
  });

  it("uma sessão de 17 min fatiada dá 35 blocos e 111 objetos", () => {
    const trinta = Array.from({ length: 35 }, (_, i) => ({ i, ext: "wav" }));
    expect(chavesDaSessao(manifest(trinta))).toHaveLength(35 * 3 + 6);
  });
});
