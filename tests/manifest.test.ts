import { describe, expect, it } from "vitest";
import {
  bytesTotais,
  duracaoEstimadaS,
  manifestVazio,
  marcarFinalizado,
  marcarTranscrito,
  pendentes,
  proximoIndice,
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

  it("finalizar duas vezes devolve o mesmo manifest", () => {
    const m = marcarFinalizado(comChunks(0));
    expect(marcarFinalizado(m)).toBe(m);
  });
});

describe("retomada", () => {
  it("continua a numeração a partir do último bloco subido", () => {
    expect(proximoIndice(comChunks(0, 1, 2))).toBe(3);
  });

  it("começa do zero numa sessão sem bloco nenhum", () => {
    expect(proximoIndice(manifestVazio("s1"))).toBe(0);
  });

  it("não reaproveita índice de buraco no meio", () => {
    expect(proximoIndice(comChunks(0, 1, 5))).toBe(6);
  });
});

describe("números do chip", () => {
  it("estima a duração pela contagem de blocos de 30 s", () => {
    expect(duracaoEstimadaS(comChunks(0, 1, 2, 3))).toBe(120);
  });

  it("soma os bytes subidos", () => {
    expect(bytesTotais(comChunks(0, 1))).toBe(180_000);
  });
});
