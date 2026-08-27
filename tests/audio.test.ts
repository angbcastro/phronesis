import { describe, expect, it } from "vitest";
import {
  BYTES_MAX,
  DURACAO_MAX_S,
  EXTENSOES_ACEITAS,
  extensaoAceita,
  formatoDeArquivo,
  motivoRecusa,
} from "@/lib/audio";

describe("formato de arquivo importado", () => {
  it("resolve pelo mime quando o navegador informa", () => {
    expect(formatoDeArquivo("nota.opus", "audio/ogg")).toEqual({ ext: "opus", mime: "audio/ogg" });
    expect(formatoDeArquivo("memo.m4a", "audio/mp4")).toEqual({ ext: "m4a", mime: "audio/mp4" });
    expect(formatoDeArquivo("velho.mp3", "audio/mpeg")).toEqual({ ext: "mp3", mime: "audio/mpeg" });
  });

  // O caso que motivou o desenho: áudio de WhatsApp chega sem `type` no File.
  it("cai para a extensão quando o mime vem vazio", () => {
    expect(formatoDeArquivo("PTT-20260827-WA0003.opus", "")).toEqual({
      ext: "opus",
      mime: "audio/ogg",
    });
    expect(formatoDeArquivo("gravacao.m4a", "")).toEqual({ ext: "m4a", mime: "audio/mp4" });
  });

  it("a extensão vence um mime genérico que não diz nada", () => {
    expect(formatoDeArquivo("nota.opus", "application/octet-stream")).toEqual({
      ext: "opus",
      mime: "audio/ogg",
    });
  });

  it("normaliza extensão em maiúscula e caminho com pontos no nome", () => {
    expect(formatoDeArquivo("Memo 2026.08.27.M4A", "")?.ext).toBe("m4a");
  });

  it("aceita o webm que a própria gravação produz", () => {
    expect(formatoDeArquivo("chunk.webm", "audio/webm;codecs=opus")?.ext).toBe("webm");
  });

  it("recusa o que não é áudio, mesmo com extensão plausível no nome", () => {
    expect(formatoDeArquivo("relatorio.pdf", "application/pdf")).toBeNull();
    expect(formatoDeArquivo("audio.opus.exe", "")).toBeNull();
    expect(formatoDeArquivo("sem-extensao", "")).toBeNull();
  });

  it("recusa vídeo: o pipeline manda os bytes crus para o STT", () => {
    expect(formatoDeArquivo("clipe.mp4", "video/mp4")).toBeNull();
  });
});

describe("extensão aceita — a lista que a rota valida", () => {
  it("aceita toda extensão da tabela", () => {
    for (const ext of EXTENSOES_ACEITAS) expect(extensaoAceita(ext)).toBe(true);
  });

  it("recusa extensão inventada por cliente adulterado", () => {
    expect(extensaoAceita("exe")).toBe(false);
    expect(extensaoAceita("../../etc/passwd")).toBe(false);
    expect(extensaoAceita("")).toBe(false);
  });
});

describe("limites", () => {
  it("aceita um diário de 20 min em opus", () => {
    expect(motivoRecusa(4 * 1024 * 1024, 1200)).toBeNull();
  });

  it("recusa arquivo grande demais para o STT", () => {
    expect(motivoRecusa(BYTES_MAX + 1, 600)).toMatch(/grande/i);
  });

  it("recusa áudio longo demais", () => {
    expect(motivoRecusa(1024, DURACAO_MAX_S + 1)).toMatch(/long/i);
  });

  // A duração vem do <audio> do navegador, que devolve NaN ou Infinity em
  // container sem cabeçalho de duração. Não é motivo para recusar.
  it("deixa passar duração desconhecida", () => {
    expect(motivoRecusa(1024, NaN)).toBeNull();
    expect(motivoRecusa(1024, Infinity)).toBeNull();
  });

  it("recusa arquivo vazio", () => {
    expect(motivoRecusa(0, 10)).toMatch(/vazio/i);
  });
});
