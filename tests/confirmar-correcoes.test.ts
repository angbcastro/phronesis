/**
 * A captura de correções pendurada no confirmar.
 *
 * O que se protege aqui não é o diff — esse tem teste próprio, puro, em
 * `correcoes.test.ts`. É a fiação: que o servidor entregue à apuração o que de
 * fato foi gravado, com os nomes finais, e que uma falha na captura **nunca**
 * atrapalhe a confirmação (critério 10). O grafo já recebeu os átomos quando
 * isto roda; o que se perde numa falha é material de calibração, não diário.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => ({ getJson: vi.fn() }));
vi.mock("@/lib/sessoes", () => ({
  buscarSessao: vi.fn(),
  atualizarSessao: vi.fn(async () => null),
}));
vi.mock("@/lib/atomos", () => ({
  gravarAtomos: vi.fn(async () => {}),
  gravarEntidades: vi.fn(async () => {}),
}));
vi.mock("@/lib/calibracao", () => ({ capturarCorrecoes: vi.fn(async () => 0) }));

import { POST } from "@/app/api/sessoes/[id]/confirmar/route";
import { capturarCorrecoes } from "@/lib/calibracao";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";

const SESSAO = "mtgn3zf7";

const referencia = (nome: string, conhecida = false) => ({
  citado: nome,
  entidade: nome,
  conhecida,
  certo: true,
  alternativas: [],
  motivo: "",
  porque: [],
});

const proposta = {
  sessao_id: SESSAO,
  atomos: [
    {
      id: `${SESSAO}-0`,
      indice: 0,
      texto: "Achei que ela fosse parar com isso",
      tipo: "FATO",
      sobre: referencia("ela"),
      menciona: [referencia("Pedro")],
      trechos: [{ texto: "achei que ela fosse parar", inicio_s: 24, fim_s: 27, ancora: "exata" }],
      perfila: [],
      prompt_version: "extracao-5",
      modelo: "zai/glm-5.3-flash",
    },
    {
      id: `${SESSAO}-1`,
      indice: 1,
      texto: "O relato é circular e confuso",
      tipo: "OPINIAO",
      sobre: referencia("eu"),
      menciona: [],
      trechos: [],
      perfila: [],
      prompt_version: "extracao-5",
      modelo: "zai/glm-5.3-flash",
    },
  ],
  entidades: [
    { nome: "ela", nome_normalizado: "ela", tipo: "Pessoa", conhecida: false, id: null, ocorrencias: 1, sessoes: 0, precisa_nome: true },
    { nome: "Pedro", nome_normalizado: "pedro", tipo: "Pessoa", conhecida: false, id: null, ocorrencias: 1, sessoes: 0, precisa_nome: false },
    { nome: "eu", nome_normalizado: "eu", tipo: "Pessoa", conhecida: false, id: null, ocorrencias: 1, sessoes: 0, precisa_nome: false },
  ],
  descartados: [],
  prompt_version: "extracao-5",
  modelo: "zai/glm-5.3-flash",
  prompt_version_resolucao: null,
  modelo_resolucao: null,
  granularidade: "palavra",
  criado_em: "2026-09-03T20:00:00.000Z",
};

const ctx = { params: Promise.resolve({ id: SESSAO }) };

const chamar = (corpo: unknown) =>
  POST(
    new Request(`http://localhost/api/sessoes/${SESSAO}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
    ctx,
  );

/** Rejeitei o átomo 1 e renomeei "ela" para "Marina". */
const corpoDaRevisao = (gestos?: unknown) => ({
  aprovados: [
    {
      indice: 0,
      texto: "Achei que ela fosse parar com isso",
      tipo: "FATO",
      sobre: "Marina",
      menciona: ["Pedro"],
    },
  ],
  entidades: [
    { nome: "Marina", tipo: "Pessoa" },
    { nome: "Pedro", tipo: "Pessoa" },
  ],
  ...(gestos === undefined ? {} : { gestos }),
});

const capturado = () => vi.mocked(capturarCorrecoes).mock.calls[0][0];

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue({ valor: proposta, etag: null } as never);
  vi.mocked(buscarSessao)
    .mockReset()
    .mockResolvedValue({
      id: SESSAO,
      status: "em_revisao",
      iniciada_em: "2026-09-03T02:49:33.716Z",
    } as never);
  vi.mocked(capturarCorrecoes).mockReset().mockResolvedValue(0);
});

describe("o que o confirmar entrega à apuração", () => {
  it("os átomos aprovados vão com os nomes finais, não com as chaves", async () => {
    await chamar(corpoDaRevisao());

    expect(capturado().confirmados).toEqual([
      {
        indice: 0,
        texto: "Achei que ela fosse parar com isso",
        tipo: "FATO",
        sobre: "Marina",
        menciona: ["Pedro"],
      },
    ]);
  });

  it("o átomo rejeitado simplesmente não está lá — é assim que a apuração o vê", async () => {
    await chamar(corpoDaRevisao());
    expect(capturado().confirmados.map((c) => c.indice)).not.toContain(1);
  });

  it("a proposta relida do R2 vai junto, para o diff ter os dois lados", async () => {
    await chamar(corpoDaRevisao());
    expect(capturado().proposta.sessao_id).toBe(SESSAO);
    expect(capturado().proposta.atomos).toHaveLength(2);
  });

  it("as entidades aprovadas vão com o tipo que eu escolhi", async () => {
    await chamar(corpoDaRevisao());
    expect(capturado().entidades).toEqual([
      { nome: "Marina", nome_normalizado: "marina", tipo: "Pessoa" },
      { nome: "Pedro", nome_normalizado: "pedro", tipo: "Pessoa" },
    ]);
  });

  it("os gestos chegam normalizados, com o campo inventado fora", async () => {
    await chamar(
      corpoDaRevisao({
        atomos: [{ indice: 0, campos: ["sobre", "cheiro"] }],
        entidades_recusadas: [],
        renomes: [{ de: "ela", para: "Marina" }],
        faltantes: [],
      }),
    );

    expect(capturado().gestos).toEqual({
      atomos: [{ indice: 0, campos: ["sobre"] }],
      entidades_recusadas: [],
      renomes: [{ de: "ela", para: "Marina" }],
      faltantes: [],
    });
  });

  it("corpo sem gestos continua confirmando, e a apuração recebe null", async () => {
    const r = await chamar(corpoDaRevisao());

    expect(r.status).toBe(200);
    expect(capturado().gestos).toBeNull();
  });
});

describe("a captura nunca atrapalha o confirmar (critério 10)", () => {
  it("falhar ao registrar não muda a resposta", async () => {
    vi.mocked(capturarCorrecoes).mockRejectedValue(new Error("R2 fora do ar"));

    const r = await chamar(corpoDaRevisao());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "confirmada", atomos: 1, rejeitados: 1 });
  });

  it("uma sessão já confirmada não apura de novo — a guarda de status vem antes", async () => {
    vi.mocked(buscarSessao).mockResolvedValue({ id: SESSAO, status: "confirmada" } as never);

    const r = await chamar(corpoDaRevisao());
    expect(await r.json()).toMatchObject({ ja_confirmada: true });
    expect(capturarCorrecoes).not.toHaveBeenCalled();
  });
});
