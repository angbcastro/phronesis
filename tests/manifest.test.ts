import { describe, expect, it } from "vitest";
import {
  extensaoDoChunk,
  manifestVazio,
  marcarTranscrito,
  pendentes,
  registrarChunk,
  reivindicarBloco,
  soltarBloco,
  tudoTranscrito,
} from "@/lib/manifest";
import { LEASE_BLOCO_MS } from "@/lib/tipos";

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

/**
 * A trava do bloco (slice 8).
 *
 * A existência de `chunk_NNN.json` só vale **depois** de o STT voltar, e entre o
 * pedido e a resposta havia uma janela de dezenas de segundos em que dois
 * workers podiam mandar o mesmo áudio: o `waitUntil` de `/chunks/:i/pronto` e o
 * laço de espera de `finalizarSessao`, que chega segundos depois do último
 * `/pronto`. O que se paga nessa janela é uma transcrição em dobro.
 */
describe("reivindicação de um bloco", () => {
  const agora = new Date("2026-09-17T21:00:00.000Z");
  const depois = (ms: number) => new Date(agora.getTime() + ms);

  it("bloco livre é reivindicado, e o manifest passa a dizer quem está nele", () => {
    const m = reivindicarBloco(comChunks(0), 0, agora);
    expect(m?.chunks[0].transcrevendo_em).toBe(agora.toISOString());
  });

  it("bloco com dono recente não é reivindicado — é aqui que se para de pagar em dobro", () => {
    const comDono = reivindicarBloco(comChunks(0), 0, agora)!;
    expect(reivindicarBloco(comDono, 0, depois(1000))).toBeNull();
  });

  it("lease vencido volta a ser reivindicável: o waitUntil que o pegou pode ter morrido", () => {
    const comDono = reivindicarBloco(comChunks(0), 0, agora)!;
    expect(reivindicarBloco(comDono, 0, depois(LEASE_BLOCO_MS + 1))).not.toBeNull();
  });

  it("bloco já transcrito nunca é reivindicado", () => {
    expect(reivindicarBloco(marcarTranscrito(comChunks(0), 0), 0, agora)).toBeNull();
  });

  it("bloco que não está no manifest não é reivindicado", () => {
    expect(reivindicarBloco(comChunks(0), 7, agora)).toBeNull();
  });

  /**
   * Escrito assim, `em` corrompido cai para o lado de reivindicar de novo:
   * bloco transcrito duas vezes custa uma chamada, bloco travado para sempre
   * custa a sessão. Mesmo raciocínio de `janela.reivindicar`.
   */
  it("carimbo corrompido não trava o bloco para sempre", () => {
    const m = comChunks(0);
    m.chunks[0] = { ...m.chunks[0], transcrevendo_em: "não é data" };
    expect(reivindicarBloco(m, 0, agora)).not.toBeNull();
  });

  it("transcrever solta o lease — bloco pronto não precisa de dono", () => {
    const comDono = reivindicarBloco(comChunks(0), 0, agora)!;
    expect(marcarTranscrito(comDono, 0).chunks[0].transcrevendo_em).toBeUndefined();
  });

  it("soltar devolve o bloco na hora, sem esperar o lease vencer", () => {
    const comDono = reivindicarBloco(comChunks(0), 0, agora)!;
    const solto = soltarBloco(comDono, 0);

    expect(solto.chunks[0].transcrevendo_em).toBeUndefined();
    expect(reivindicarBloco(solto, 0, depois(1000))).not.toBeNull();
  });

  it("soltar um bloco sem dono não mexe no manifest", () => {
    const m = comChunks(0);
    expect(soltarBloco(m, 0)).toBe(m);
  });

  it("reivindicar um bloco não mexe nos outros", () => {
    const m = reivindicarBloco(comChunks(0, 1), 0, agora)!;
    expect(m.chunks[1].transcrevendo_em).toBeUndefined();
  });
});
