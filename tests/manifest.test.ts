import { describe, expect, it } from "vitest";
import {
  extensaoDoChunk,
  manifestVazio,
  marcarTranscrito,
  pendentes,
  registrarChunk,
  tudoTranscrito,
} from "@/lib/manifest";

const entrada = (i: number, bytes = 90_000) => ({ i, bytes, subido_em: "2026-08-23T20:00:00.000Z" });

function comChunks(...indices: number[]) {
  return indices.reduce((m, i) => registrarChunk(m, entrada(i)), manifestVazio("s1"));
}

describe("registro de bloco", () => {
  it("guarda o bloco como ainda não transcrito", () => {
    const m = registrarChunk(manifestVazio("s1"), entrada(0));
    expect(m.chunks).toEqual([{ i: 0, bytes: 90_000, subido_em: entrada(0).subido_em, transcrito: false }]);
  });

  it("subir o mesmo bloco duas vezes não duplica a entrada", () => {
    const m = registrarChunk(comChunks(0), entrada(0));
    expect(m.chunks).toHaveLength(1);
  });

  it("reenviar um bloco já transcrito não o reabre para reprocessamento", () => {
    const m = marcarTranscrito(comChunks(0), 0);
    expect(registrarChunk(m, entrada(0)).chunks[0].transcrito).toBe(true);
  });

  it("mantém os blocos ordenados mesmo com chegada fora de ordem", () => {
    expect(comChunks(2, 0, 1).chunks.map((c) => c.i)).toEqual([0, 1, 2]);
  });
});

describe("estado da transcrição", () => {
  it("lista só o que falta transcrever", () => {
    const m = marcarTranscrito(comChunks(0, 1, 2), 1);
    expect(pendentes(m).map((c) => c.i)).toEqual([0, 2]);
  });

  it("marcar duas vezes o mesmo bloco não muda nada", () => {
    const m = marcarTranscrito(comChunks(0), 0);
    expect(marcarTranscrito(m, 0)).toBe(m);
  });

  it("manifest vazio conta como tudo transcrito", () => {
    expect(tudoTranscrito(manifestVazio("s1"))).toBe(true);
  });
});

describe("extensão do bloco no manifest", () => {
  it("bloco gravado não carrega extensão — webm é o padrão", () => {
    const m = registrarChunk(manifestVazio("s1"), { i: 0, bytes: 10, subido_em: "2026-08-27T12:00:00Z" });
    expect(m.chunks[0].ext).toBeUndefined();
    expect(extensaoDoChunk(m, 0)).toBe("webm");
  });

  it("guarda a extensão do arquivo importado", () => {
    const m = registrarChunk(manifestVazio("s1"), {
      i: 0,
      bytes: 10,
      subido_em: "2026-08-27T12:00:00Z",
      ext: "opus",
    });
    expect(extensaoDoChunk(m, 0)).toBe("opus");
  });

  // Regra 4: o /pronto pode ser reenviado, e não pode apagar o que já sabe.
  it("reenviar o mesmo bloco preserva a extensão", () => {
    const um = registrarChunk(manifestVazio("s1"), {
      i: 0,
      bytes: 10,
      subido_em: "2026-08-27T12:00:00Z",
      ext: "opus",
    });
    const dois = registrarChunk(um, { i: 0, bytes: 99, subido_em: "2026-08-27T12:01:00Z" });
    expect(extensaoDoChunk(dois, 0)).toBe("opus");
    expect(dois.chunks[0].bytes).toBe(99);
  });

  it("manifest antigo, sem o campo, continua legível", () => {
    expect(extensaoDoChunk({ sessao_id: "s1", chunks: [], finalizado: false }, 0)).toBe("webm");
  });
});
