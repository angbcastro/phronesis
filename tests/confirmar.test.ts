/**
 * O confirmar: a única porta de escrita no grafo.
 *
 * O caso que motivou metade destes testes: renomear "ela" para um nome de
 * verdade na revisão devolvia 400, porque o servidor exigia que o sujeito
 * estivesse entre as entidades da proposta e a lista não tinha como crescer.
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

import { POST } from "@/app/api/sessoes/[id]/confirmar/route";
import { gravarAtomos, gravarEntidades } from "@/lib/atomos";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import type { AtomoParaGravar, EntidadeParaGravar } from "@/lib/atomos";

const SESSAO = "mtgn3zf7";

const atomoProposto = (indice: number, sobre: string, menciona: string[] = []) => ({
  id: `${SESSAO}-${indice}`,
  indice,
  texto: "Achei que ela fosse parar com isso",
  tipo: "FATO",
  sobre,
  menciona,
  trechos: [{ texto: "achei que ela fosse parar", inicio_s: 24, fim_s: 27, ancora: "exata" }],
  prompt_version: "extracao-4",
  modelo: "zai/glm-5.3-flash",
});

const proposta = {
  sessao_id: SESSAO,
  atomos: [atomoProposto(0, "ela", ["ela", "Pedro"]), atomoProposto(1, "eu")],
  entidades: [
    { nome: "ela", nome_normalizado: "ela", tipo: "Pessoa", conhecida: false, id: null, ocorrencias: 3, sessoes: 0, precisa_nome: true },
    { nome: "Pedro", nome_normalizado: "pedro", tipo: "Pessoa", conhecida: false, id: null, ocorrencias: 1, sessoes: 0, precisa_nome: false },
    { nome: "eu", nome_normalizado: "eu", tipo: "Pessoa", conhecida: false, id: null, ocorrencias: 1, sessoes: 0, precisa_nome: false },
  ],
  descartados: [],
  prompt_version: "extracao-4",
  modelo: "zai/glm-5.3-flash",
  granularidade: "segmento",
  criado_em: "2026-08-31T03:00:00.000Z",
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

const atomosGravados = () => vi.mocked(gravarAtomos).mock.calls[0][1] as AtomoParaGravar[];
const entidadesGravadas = () => vi.mocked(gravarEntidades).mock.calls[0][0] as EntidadeParaGravar[];

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue({ valor: proposta, etag: null } as never);
  vi.mocked(buscarSessao)
    .mockReset()
    .mockResolvedValue({
      id: SESSAO,
      status: "em_revisao",
      iniciada_em: "2026-08-31T02:49:33.716Z",
    } as never);
  vi.mocked(gravarAtomos).mockReset().mockResolvedValue(undefined);
  vi.mocked(gravarEntidades).mockReset().mockResolvedValue(undefined);
});

describe("renomear a entidade na revisão", () => {
  it("aceita o nome novo — era o bug que devolvia 400", async () => {
    const r = await chamar({
      aprovados: [{ indice: 0, texto: "Achei que ela fosse parar", tipo: "FATO", sobre: "Marina", menciona: ["Pedro"] }],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }, { nome: "Pedro", tipo: "Pessoa" }],
    });

    expect(r.status).toBe(200);
    expect(entidadesGravadas().map((e) => e.nome).sort()).toEqual(["Marina", "Pedro"]);
    expect(atomosGravados()[0].sobre).toBe("marina");
  });

  it("o tipo escolhido na tela é respeitado", async () => {
    await chamar({
      aprovados: [{ indice: 0, texto: "t", tipo: "FATO", sobre: "o relacionamento", menciona: [] }],
      entidades: [{ nome: "o relacionamento", tipo: "OBJETIVO" }],
    });
    expect(entidadesGravadas()[0].tipo).toBe("Objetivo");
  });

  it("tipo inválido cai em Pessoa em vez de estourar", async () => {
    await chamar({
      aprovados: [{ indice: 0, texto: "t", tipo: "FATO", sobre: "Marina", menciona: [] }],
      entidades: [{ nome: "Marina", tipo: "EMPRESA" }],
    });
    expect(entidadesGravadas()[0].tipo).toBe("Pessoa");
  });
});

describe("pronome não entra no grafo", () => {
  it("recusa entidade que continua sendo pronome", async () => {
    // A trava da tela pode ser burlada chamando a rota direto.
    const r = await chamar({
      aprovados: [{ indice: 0, texto: "t", tipo: "FATO", sobre: "ela", menciona: [] }],
      entidades: [{ nome: "ela", tipo: "Pessoa" }],
    });

    expect(r.status).toBe(400);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/pronome/);
    expect(gravarAtomos).not.toHaveBeenCalled();
  });

  it('"eu" passa — é entidade legítima', async () => {
    const r = await chamar({
      aprovados: [{ indice: 1, texto: "t", tipo: "SENTIMENTO", sobre: "eu", menciona: [] }],
      entidades: [{ nome: "eu", tipo: "Pessoa" }],
    });
    expect(r.status).toBe(200);
  });
});

describe("procedência e integridade", () => {
  it("offsets e modelo vêm da proposta, não do corpo", async () => {
    await chamar({
      aprovados: [
        {
          indice: 0,
          texto: "t",
          tipo: "FATO",
          sobre: "Marina",
          menciona: [],
          // o navegador tentando mentir:
          inicios_s: [999],
          modelo: "modelo-inventado",
          prompt_version: "v-falsa",
        },
      ],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }],
    });

    const a = atomosGravados()[0];
    expect(a.inicios_s).toEqual([24]);
    expect(a.modelo).toBe("zai/glm-5.3-flash");
    expect(a.prompt_version).toBe("extracao-4");
    expect(a.id).toBe(`${SESSAO}-0`);
  });

  it("sujeito fora da lista aprovada é recusado", async () => {
    const r = await chamar({
      aprovados: [{ indice: 0, texto: "t", tipo: "FATO", sobre: "Fulano", menciona: [] }],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }],
    });
    expect(r.status).toBe(400);
  });

  it("menção igual ao sujeito é descartada", async () => {
    await chamar({
      aprovados: [{ indice: 0, texto: "t", tipo: "FATO", sobre: "Marina", menciona: ["Marina", "Pedro"] }],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }, { nome: "Pedro", tipo: "Pessoa" }],
    });
    expect(atomosGravados()[0].menciona).toEqual(["pedro"]);
  });

  it("entidade aprovada sem átomo que a use não vira nó órfão", async () => {
    await chamar({
      aprovados: [{ indice: 0, texto: "t", tipo: "FATO", sobre: "Marina", menciona: [] }],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }, { nome: "Pedro", tipo: "Pessoa" }],
    });
    expect(entidadesGravadas().map((e) => e.nome)).toEqual(["Marina"]);
  });

  it("átomo rejeitado não chega ao grafo", async () => {
    await chamar({
      aprovados: [{ indice: 1, texto: "t", tipo: "SENTIMENTO", sobre: "eu", menciona: [] }],
      entidades: [{ nome: "eu", tipo: "Pessoa" }],
    });
    const ids = atomosGravados().map((a) => a.id);
    expect(ids).toEqual([`${SESSAO}-1`]);
  });
});

describe("as marcas de perfil (migration 005)", () => {
  const comPerfil = (perfila: unknown[]) => ({
    aprovados: [
      { indice: 0, texto: "t", tipo: "FATO", sobre: "Marina", menciona: ["Pedro"], perfila },
    ],
    entidades: [
      { nome: "Marina", tipo: "Pessoa" },
      { nome: "Pedro", tipo: "Pessoa" },
    ],
  });

  it("a marca chega ao grafo com a entidade normalizada (critério 6)", async () => {
    await chamar(comPerfil([{ entidade: "Pedro", campo: "pode_ajudar_com" }]));
    expect(atomosGravados()[0].perfila).toEqual([
      { entidade: "pedro", campo: "pode_ajudar_com" },
    ]);
  });

  it("campo fora do schema é descartado, como a menção fora da lista", async () => {
    await chamar(comPerfil([{ entidade: "Pedro", campo: "cor_favorita" }]));
    expect(atomosGravados()[0].perfila).toEqual([]);
  });

  it("marca para entidade não aprovada não vira aresta pendurada em nada", async () => {
    await chamar(comPerfil([{ entidade: "Alguém Que Eu Desmarquei", campo: "contexto" }]));
    expect(atomosGravados()[0].perfila).toEqual([]);
  });

  it("a mesma marca duas vezes vira uma (regra 4)", async () => {
    await chamar(
      comPerfil([
        { entidade: "Pedro", campo: "contexto" },
        { entidade: "PEDRO", campo: "contexto" },
      ]),
    );
    expect(atomosGravados()[0].perfila).toHaveLength(1);
  });

  it("a entidade só marcada por perfil ainda vira nó — a aresta precisa de destino", async () => {
    await chamar({
      aprovados: [
        {
          indice: 0,
          texto: "t",
          tipo: "FATO",
          sobre: "Marina",
          menciona: [],
          perfila: [{ entidade: "Pedro", campo: "fizemos_juntos" }],
        },
      ],
      entidades: [
        { nome: "Marina", tipo: "Pessoa" },
        { nome: "Pedro", tipo: "Pessoa" },
      ],
    });
    expect(entidadesGravadas().map((e) => e.nome).sort()).toEqual(["Marina", "Pedro"]);
  });

  it("proposta antiga, sem marca nenhuma, grava lista vazia (critério 10)", async () => {
    await chamar({
      aprovados: [{ indice: 0, texto: "t", tipo: "FATO", sobre: "Marina", menciona: [] }],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }],
    });
    expect(atomosGravados()[0].perfila).toEqual([]);
  });
});

describe("guardas de estado", () => {
  it("confirmar duas vezes não reprocessa", async () => {
    vi.mocked(buscarSessao).mockResolvedValue({
      id: SESSAO,
      status: "confirmada",
      iniciada_em: "2026-08-31T02:49:33.716Z",
    } as never);

    const r = await chamar({ aprovados: [], entidades: [] });
    expect(await r.json()).toMatchObject({ ja_confirmada: true });
    expect(gravarAtomos).not.toHaveBeenCalled();
  });

  it("sessão que ainda não foi extraída não tem o que confirmar", async () => {
    vi.mocked(buscarSessao).mockResolvedValue({
      id: SESSAO,
      status: "transcrito",
      iniciada_em: "2026-08-31T02:49:33.716Z",
    } as never);

    const r = await chamar({ aprovados: [], entidades: [] });
    expect(r.status).toBe(409);
  });
});
