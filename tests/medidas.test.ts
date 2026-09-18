/**
 * O registro de medida (slice 8).
 *
 * O que este arquivo protege é a única coisa que torna a medida útil: que ela
 * **não minta**. Um registro que conta a mesma sessão duas vezes, que soma a
 * espera com o relógio errado, ou que cresce sem teto é pior que registro
 * nenhum — ele decide onde eu vou mexer no código.
 *
 * Três promessas:
 *
 *   1. o tamanho é limitado por construção — passos e agentes agregados, falhas
 *      com teto, texto livre só no objeto da sessão;
 *   2. a linha de uma sessão é **uma**, por mais vezes que ela seja escrita;
 *   3. fora de um contexto de medição, instrumentar é transparente: nem uma ida
 *      à rede, nem um efeito.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(async () => null),
  putJson: vi.fn(async () => ({ etag: null })),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

// `fecharLinha` lê o `:Sessao` e o manifest para saber quanto eu falei e
// quantos blocos foram — sem isso os números não se comparam.
vi.mock("@/lib/sessoes", () => ({
  buscarSessao: vi.fn(async () => ({ id: "mtgn3zf7", status: "em_revisao", duracao_s: 900 })),
}));

import { getJson, putJson } from "@/lib/r2";
import {
  codigoDaFalha,
  comMedicao,
  INTERVALO_DESCARGA_MS,
  fundirMedidas,
  indiceVazio,
  juntarLinha,
  linhaDaSessao,
  medidasVazias,
  medindo,
  medir,
  medirAgente,
  mesDe,
  normalizarIndiceDeMedidas,
  normalizarMedidas,
  registrarFalha,
  resumir,
  resumoDoMes,
} from "@/lib/medidas";
import { TETO_FALHAS_POR_SESSAO, TETO_LINHAS_MEDIDA } from "@/lib/tipos";
import type { LinhaDeMedida, MedidasDaSessao } from "@/lib/tipos";

const SESSAO = "mtgn3zf7";
const EM = "2026-09-17T21:00:00.000Z";

const medidas = (parcial: Partial<MedidasDaSessao> = {}): MedidasDaSessao => ({
  ...medidasVazias(SESSAO, "gravacao", EM),
  ...parcial,
});

// ─────────────────────── o tamanho, que é a forma ───────────────────────

describe("o objeto da sessão não cresce", () => {
  it("soma passos em vez de listar eventos, e guarda o pior caso", () => {
    let m = medidas();
    m = fundirMedidas(m, { passos: { stt: { n: 1, ms: 1000, pior_ms: 1000 } } }, EM);
    m = fundirMedidas(m, { passos: { stt: { n: 1, ms: 31_000, pior_ms: 31_000 } } }, EM);

    // Trinta blocos não viram trinta entradas: viram uma com n=30.
    expect(m.passos.stt).toEqual({ n: 2, ms: 32_000, pior_ms: 31_000 });
  });

  it("o pior caso existe porque a soma o esconde", () => {
    // 2 s × 30 e 1 s × 29 + 31 s somam quase o mesmo e pedem consertos opostos.
    const parelho = [...Array(30)].reduce<MedidasDaSessao>(
      (m) => fundirMedidas(m, { passos: { stt: { n: 1, ms: 2000, pior_ms: 2000 } } }, EM),
      medidas(),
    );
    expect(parelho.passos.stt?.pior_ms).toBe(2000);
  });

  it("soma tokens por agente, e ausente continua ausente", () => {
    let m = medidas();
    m = fundirMedidas(m, { agentes: { extracao: { n: 1, ms: 500, entrada: 100, saida: 20 } } }, EM);
    m = fundirMedidas(m, { agentes: { extracao: { n: 1, ms: 700, entrada: 50, saida: 10 } } }, EM);
    m = fundirMedidas(m, { agentes: { stt: { n: 1, ms: 900 } } }, EM);

    expect(m.agentes.extracao).toEqual({ n: 2, ms: 1200, entrada: 150, saida: 30 });
    // Zero diria "o Gateway devolveu zero token", que é diferente de "este
    // provedor não conta token".
    expect(m.agentes.stt).toEqual({ n: 1, ms: 900 });
  });

  it("as falhas têm teto, e as mais novas ficam", () => {
    const falha = (i: number) =>
      ({ passo: "janela", codigo: "servico", motivo: `erro ${i}`, em: EM }) as const;

    let m = medidas();
    for (let i = 0; i < TETO_FALHAS_POR_SESSAO + 5; i++) {
      m = fundirMedidas(m, { falhas: [falha(i)] }, EM);
    }

    expect(m.falhas).toHaveLength(TETO_FALHAS_POR_SESSAO);
    expect(m.falhas[0].motivo).toBe(`erro ${TETO_FALHAS_POR_SESSAO + 4}`);
  });

  it("normaliza o objeto sem os campos do tipo — ele é mais velho que o tipo", () => {
    const m = normalizarMedidas({ sessao_id: SESSAO } as MedidasDaSessao, SESSAO, "gravacao", EM);
    expect(m.passos).toEqual({});
    expect(m.agentes).toEqual({});
    expect(m.falhas).toEqual([]);
    expect(m.cliente).toEqual({});
  });
});

// ─────────────────────────── a linha do índice ───────────────────────────

describe("a linha de uma sessão", () => {
  it("o número da fatia é parar → revisão, e sai das marcas do mesmo relógio", () => {
    const m = medidas({ cliente: { parou: 1_000_000, fila_vazia: 1_002_500, revisou: 1_009_000 } });
    const l = linhaDaSessao(m, { duracao_s: 900, blocos: 30 });

    expect(l.espera_ms).toBe(9000);
    expect(l.fila_ms).toBe(2500);
    expect(l.servidor_ms).toBe(6500);
  });

  it("marca que falta é null, e não zero — zero seria 'abriu na hora'", () => {
    const l = linhaDaSessao(medidas({ cliente: { parou: 1_000_000 } }), {
      duracao_s: null,
      blocos: 0,
    });
    expect(l.espera_ms).toBeNull();
    expect(l.servidor_ms).toBeNull();
  });

  it("marca fora de ordem não vira número negativo", () => {
    // Relógio que andou para trás no meio (troca de fuso, ajuste de NTP).
    const l = linhaDaSessao(medidas({ cliente: { parou: 2_000_000, revisou: 1_000_000 } }), {
      duracao_s: null,
      blocos: 0,
    });
    expect(l.espera_ms).toBeNull();
  });

  it("soma as chamadas de todos os agentes — é a conta de 'quatro para entregar uma'", () => {
    const m = medidas({
      agentes: {
        stt: { n: 30, ms: 60_000 },
        extracao: { n: 4, ms: 40_000, entrada: 5000, saida: 900 },
        resolucao: { n: 2, ms: 8000, entrada: 800, saida: 100 },
      },
    });
    const l = linhaDaSessao(m, { duracao_s: 900, blocos: 30 });

    expect(l.chamadas).toBe(36);
    expect(l.tokens).toBe(6800);
  });

  it("sem token nenhum o campo é null, e não zero", () => {
    const m = medidas({ agentes: { stt: { n: 3, ms: 900 } } });
    expect(linhaDaSessao(m, { duracao_s: 60, blocos: 2 }).tokens).toBeNull();
  });

  it("leva o tempo por passo, que é o 'onde foi o tempo' sem o objeto da sessão", () => {
    const m = medidas({
      passos: {
        stt: { n: 30, ms: 61_400, pior_ms: 9000 },
        janela: { n: 8, ms: 40_000, pior_ms: 12_000 },
      },
    });
    expect(linhaDaSessao(m, { duracao_s: 900, blocos: 30 }).passos).toEqual({
      stt: 61_400,
      janela: 40_000,
    });
  });

  it("leva código de falha e contagem, nunca o texto livre", () => {
    const m = medidas({
      falhas: [
        { passo: "janela", codigo: "janela_presa", motivo: "a janela 3 não fechou", em: EM },
        { passo: "stt", codigo: "limite", motivo: "429 do Gateway", em: EM },
        { passo: "stt", codigo: "limite", motivo: "429 de novo", em: EM },
      ],
    });
    const l = linhaDaSessao(m, { duracao_s: 900, blocos: 30 });

    expect(l.falhas).toBe(3);
    expect(l.codigos.sort()).toEqual(["janela_presa", "limite"]);
    expect(JSON.stringify(l)).not.toContain("não fechou");
  });
});

describe("o índice", () => {
  const linha = (sessao_id: string, espera_ms: number, em = EM): LinhaDeMedida => ({
    sessao_id,
    em,
    caminho: "gravacao",
    duracao_s: 900,
    espera_ms,
    fila_ms: null,
    servidor_ms: null,
    blocos: 30,
    passos: { stt: 1000 },
    chamadas: 10,
    tokens: null,
    falhas: 0,
    codigos: [],
  });

  it("substitui a linha da mesma sessão em vez de acrescentar outra", () => {
    // A linha é escrita duas vezes no caminho normal: quando o servidor termina
    // e quando o navegador manda a marca da revisão aberta.
    let i = juntarLinha(indiceVazio(EM), linha(SESSAO, 0), EM);
    i = juntarLinha(i, linha(SESSAO, 9000), EM);

    expect(i.linhas).toHaveLength(1);
    expect(i.linhas[0].espera_ms).toBe(9000);
  });

  it("guarda a mais recente na frente e poda pelo teto", () => {
    let i = indiceVazio(EM);
    for (let n = 0; n < TETO_LINHAS_MEDIDA + 10; n++) i = juntarLinha(i, linha(`s${n}`, n), EM);

    expect(i.linhas).toHaveLength(TETO_LINHAS_MEDIDA);
    expect(i.linhas[0].sessao_id).toBe(`s${TETO_LINHAS_MEDIDA + 9}`);
  });

  it("índice sem linhas, ou de outro formato, lê como vazio", () => {
    expect(normalizarIndiceDeMedidas(undefined, EM).linhas).toEqual([]);
    expect(normalizarIndiceDeMedidas({} as never, EM).linhas).toEqual([]);
  });
});

// ─────────────────────────── o resumo do mês ───────────────────────────

describe("o resumo do mês", () => {
  it("mediana de lista ímpar é o do meio; de par, a média dos dois", () => {
    expect(resumir([3, 1, 2])).toEqual({ n: 3, mediana: 2, pior: 3 });
    expect(resumir([10, 20, 30, 40])).toEqual({ n: 4, mediana: 25, pior: 40 });
  });

  it("sem nada a resumir devolve null, e não um zero que mente", () => {
    expect(resumir([])).toBeNull();
    expect(resumir([NaN])).toBeNull();
  });

  it("resume espera, chamadas e cada passo, e conta os códigos de falha", () => {
    const l = (espera: number | null, stt: number, codigos: LinhaDeMedida["codigos"]) =>
      ({
        sessao_id: `s${espera}`,
        em: "2026-09-17T10:00:00.000Z",
        caminho: "gravacao",
        duracao_s: 900,
        espera_ms: espera,
        fila_ms: null,
        servidor_ms: null,
        blocos: 30,
        passos: { stt },
        chamadas: 12,
        tokens: null,
        falhas: codigos.length,
        codigos,
      }) as LinhaDeMedida;

    const r = resumoDoMes("2026-09", [l(9000, 100, []), l(21_000, 300, ["limite"]), l(null, 200, ["limite"])], EM);

    expect(r.n).toBe(3);
    // A sessão sem marca não entra na mediana da espera — e entra na do passo.
    expect(r.espera_ms).toEqual({ n: 2, mediana: 15_000, pior: 21_000 });
    expect(r.passos.stt).toEqual({ n: 3, mediana: 200, pior: 300 });
    expect(r.chamadas).toEqual({ n: 3, mediana: 12, pior: 12 });
    expect(r.falhas).toBe(2);
    expect(r.codigos).toEqual({ limite: 2 });
  });

  it("acha o mês de uma linha pelo começo do ISO", () => {
    expect(mesDe("2026-09-17T21:00:00.000Z")).toBe("2026-09");
  });
});

// ─────────────────── a classificação, que é a do §5 ───────────────────

describe("por que falhou", () => {
  it("rate limit do Gateway é 'limite' — ele é o único que o relógio conserta", () => {
    expect(codigoDaFalha({ name: "GatewayRateLimitError" })).toBe("limite");
    expect(codigoDaFalha({ statusCode: 429 })).toBe("limite");
  });

  it("conexão que não abriu é 'rede'", () => {
    const e = new TypeError("fetch failed");
    (e as { cause?: unknown }).cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
    expect(codigoDaFalha(e)).toBe("rede");
  });

  it("o resto é serviço — repetir vai falhar igual", () => {
    expect(codigoDaFalha(new Error("modelo não existe"))).toBe("servico");
  });
});

// ─────────── fora de contexto, instrumentar não faz nada ───────────

describe("sem contexto de medição", () => {
  it("não está medindo", () => {
    expect(medindo()).toBe(false);
  });

  it("`medir` devolve o valor e não toca em rede nenhuma", async () => {
    await expect(medir("janela", async () => 42)).resolves.toBe(42);
  });

  it("`medirAgente` devolve o valor", async () => {
    await expect(medirAgente("extracao", async () => "ok")).resolves.toBe("ok");
  });

  it("`medir` deixa o erro passar inteiro", async () => {
    await expect(medir("janela", async () => Promise.reject(new Error("caiu")))).rejects.toThrow(
      "caiu",
    );
  });

  it("`registrarFalha` é um no-op silencioso", () => {
    expect(() => registrarFalha("janela", new Error("caiu"))).not.toThrow();
  });
});

// ─────────── dentro de um contexto, a medida é gravada uma vez ───────────

describe("comMedicao", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockReset().mockResolvedValue(null);
    vi.mocked(putJson).mockReset().mockResolvedValue({ etag: null });
  });

  /** O que foi gravado em `sessoes/<id>/medidas.json`, na última escrita. */
  const gravado = (): MedidasDaSessao => {
    const daSessao = vi
      .mocked(putJson)
      .mock.calls.filter((c) => String(c[0]).endsWith("/medidas.json"));
    return daSessao[daSessao.length - 1]?.[1] as MedidasDaSessao;
  };

  it("cronometra o passo de fora e grava uma vez por invocação", async () => {
    const r = await comMedicao(SESSAO, "pronto", async () => {
      expect(medindo()).toBe(true);
      return "feito";
    });

    expect(r).toBe("feito");
    // Uma invocação, uma escrita. Sem `fecha`, o índice não é tocado.
    expect(vi.mocked(putJson).mock.calls).toHaveLength(1);
    expect(gravado().passos.pronto?.n).toBe(1);
  });

  it("recolhe passo, agente e falha de dentro do trabalho", async () => {
    await comMedicao(SESSAO, "finalizar", async () => {
      await medir("stt", async () => "bloco");
      await medirAgente("extracao", async () => ({ usage: { inputTokens: 900, outputTokens: 80 } }));
      registrarFalha("janela", new Error("a janela 3 não fechou"), "janela_presa");
    });

    const m = gravado();
    expect(m.passos.stt?.n).toBe(1);
    expect(m.agentes.extracao).toMatchObject({ n: 1, entrada: 900, saida: 80 });
    expect(m.falhas[0]).toMatchObject({ codigo: "janela_presa", passo: "janela" });
  });

  it("conta a chamada que falhou — ela custou igual", async () => {
    await comMedicao(SESSAO, "finalizar", async () => {
      await medirAgente("resolucao", async () => {
        throw new Error("429");
      }).catch(() => {});
    });

    expect(gravado().agentes.resolucao?.n).toBe(1);
  });

  it("`embed` conta tokens num campo só, e ele entra como entrada", async () => {
    await comMedicao(SESSAO, "pronto", () =>
      medirAgente("embedding", async () => ({ usage: { tokens: 40 } })),
    );

    expect(gravado().agentes.embedding).toMatchObject({ n: 1, entrada: 40 });
  });

  it("aninhada, vira passo — o `/finalizar` que emenda na extração não abre um segundo registro", async () => {
    await comMedicao(SESSAO, "finalizar", () =>
      comMedicao(SESSAO, "extrair", async () => "emendou"),
    );

    expect(vi.mocked(putJson).mock.calls).toHaveLength(1);
    const m = gravado();
    expect(m.passos.finalizar?.n).toBe(1);
    expect(m.passos.extrair?.n).toBe(1);
  });

  it("uma falha ao gravar a medida não derruba o trabalho", async () => {
    vi.mocked(putJson).mockRejectedValue(new Error("R2 fora do ar"));
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(comMedicao(SESSAO, "pronto", async () => "o áudio está salvo")).resolves.toBe(
      "o áudio está salvo",
    );
    expect(erros).toHaveBeenCalled();
    erros.mockRestore();
  });

  it("o erro do trabalho sobe inteiro, e a medida daquilo que rodou fica", async () => {
    await expect(
      comMedicao(SESSAO, "finalizar", async () => {
        await medir("stt", async () => "um bloco");
        throw new Error("caiu depois");
      }),
    ).rejects.toThrow("caiu depois");

    expect(gravado().passos.stt?.n).toBe(1);
  });

  /**
   * O buraco que a sessão `mu73d88b0w4u6o5d440j` abriu: função morta pelo
   * `maxDuration` não chega ao `finally`, e gravar só lá levava o registro
   * inteiro daquela invocação embora. `espera_blocos` e `concatenar` rodaram
   * naquela sessão e não estão no objeto.
   */
  it("descarrega no meio do trabalho, e o passo de fora ainda não está lá", async () => {
    vi.useFakeTimers();
    try {
      await comMedicao(SESSAO, "finalizar", async () => {
        await medir("espera_blocos", async () => "os blocos chegaram");
        await vi.advanceTimersByTimeAsync(INTERVALO_DESCARGA_MS);

        const noMeio = gravado();
        expect(noMeio.passos.espera_blocos?.n).toBe(1);
        // O de fora não terminou, então não está — e é essa ausência que diz
        // "esta invocação não voltou".
        expect(noMeio.passos.finalizar).toBeUndefined();
        return "ok";
      });
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * `fundirMedidas` soma, então descarga que copiasse em vez de drenar contaria
   * o mesmo trabalho duas vezes — e a medida passaria a mentir para cima.
   */
  it("o que já foi descarregado não é contado de novo no fim", async () => {
    const deposito = new Map<string, unknown>();
    vi.mocked(getJson).mockImplementation(async (key: string) =>
      deposito.has(key) ? { valor: deposito.get(key), etag: null } : null,
    );
    vi.mocked(putJson).mockImplementation(async (key: string, valor: unknown) => {
      deposito.set(key, valor);
      return { etag: null };
    });

    vi.useFakeTimers();
    try {
      await comMedicao(SESSAO, "finalizar", async () => {
        await medir("espera_blocos", async () => "chegaram");
        await vi.advanceTimersByTimeAsync(INTERVALO_DESCARGA_MS);
        await medir("concatenar", async () => "concatenou");
      });
    } finally {
      vi.useRealTimers();
    }

    const m = gravado();
    expect(m.passos.espera_blocos?.n).toBe(1);
    expect(m.passos.concatenar?.n).toBe(1);
    expect(m.passos.finalizar?.n).toBe(1);
  });

  it("descarga que falha devolve o pedaço, e ele entra na gravação seguinte", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(putJson).mockRejectedValueOnce(new Error("R2 fora do ar"));

    vi.useFakeTimers();
    try {
      await comMedicao(SESSAO, "finalizar", async () => {
        await medir("espera_blocos", async () => "chegaram");
        await vi.advanceTimersByTimeAsync(INTERVALO_DESCARGA_MS);
      });
    } finally {
      vi.useRealTimers();
    }

    // A primeira descarga se perdeu no R2; o passo não se perdeu com ela.
    expect(gravado().passos.espera_blocos?.n).toBe(1);
    expect(erros).toHaveBeenCalled();
    erros.mockRestore();
  });

  it("com `fecha`, a linha vai ao índice com a duração e os blocos", async () => {
    vi.mocked(getJson).mockImplementation(async (key: string) =>
      key.endsWith("/manifest.json")
        ? { valor: { sessao_id: SESSAO, chunks: [{ i: 0 }, { i: 1 }], finalizado: true }, etag: null }
        : null,
    );

    await comMedicao(SESSAO, "finalizar", async () => "ok", { fecha: true });

    const doIndice = vi
      .mocked(putJson)
      .mock.calls.find((c) => c[0] === "medidas/indice.json")?.[1] as { linhas: LinhaDeMedida[] };

    expect(doIndice.linhas[0]).toMatchObject({ sessao_id: SESSAO, duracao_s: 900, blocos: 2 });
  });
});
