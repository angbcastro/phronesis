/**
 * A página da lista de sessões (onda 4 da interface): o cursor, o `mais`, e a
 * frase e a contagem que a linha mostra.
 *
 * O que erraria calado aqui é o `mais` contado depois do filtro da sessão sem
 * bloco — uma página que perdeu metade para sessões largadas pareceria o fim
 * da lista, e a rolagem pararia com sessões antigas escondidas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neo4j", () => ({
  query: vi.fn(async () => []),
  queryUm: vi.fn(async () => null),
}));

import { query } from "@/lib/neo4j";
import { apareceNaLista, paginaDeSessoes, primeiroItem } from "@/lib/sessoes";
import type { AtomoProposto } from "@/lib/tipos";

const consulta = vi.mocked(query);

const linha = (id: string, iniciada_em: string, status: string, extra: Record<string, unknown> = {}) => ({
  sessao: { id, iniciada_em, status, duracao_s: 60, chunks_total: 2, audio_key: "", transcricao_key: "" },
  itens: 0,
  frase: null,
  ...extra,
});

beforeEach(() => {
  consulta.mockReset();
  consulta.mockResolvedValue([] as never);
});

describe("paginaDeSessoes", () => {
  it("lê uma a mais que o limite, e é ela que diz que há mais", async () => {
    consulta.mockResolvedValue([
      linha("c", "2026-10-03", "confirmada"),
      linha("b", "2026-10-02", "confirmada"),
      linha("a", "2026-10-01", "confirmada"),
    ] as never);
    const p = await paginaDeSessoes(null, 2);
    expect(consulta.mock.calls[0][1]).toMatchObject({ antes: null, lidas: 3 });
    expect(p.sessoes.map((s) => s.id)).toEqual(["c", "b"]);
    expect(p.mais).toBe(true);
    expect(p.cursor).toBe("2026-10-02");
  });

  it("a última página não tem mais, e o cursor é a última lida", async () => {
    consulta.mockResolvedValue([linha("a", "2026-10-01", "transcrito")] as never);
    const p = await paginaDeSessoes("2026-10-02", 2);
    expect(consulta.mock.calls[0][1]).toMatchObject({ antes: "2026-10-02" });
    expect(p.mais).toBe(false);
    expect(p.cursor).toBe("2026-10-01");
  });

  it("o cursor é da leitura crua: a sessão sem bloco conta, mesmo que a rota a esconda", async () => {
    consulta.mockResolvedValue([
      linha("b", "2026-10-02", "confirmada"),
      linha("a", "2026-10-01", "erro", { sessao: { ...linha("a", "2026-10-01", "erro").sessao, chunks_total: 0 } }),
      linha("z", "2026-09-30", "confirmada"),
    ] as never);
    const p = await paginaDeSessoes(null, 2);
    expect(p.cursor).toBe("2026-10-01");
    expect(p.mais).toBe(true);
    expect(p.sessoes.filter(apareceNaLista).map((s) => s.id)).toEqual(["b"]);
  });

  it("só a confirmada leva frase e contagem do grafo", async () => {
    consulta.mockResolvedValue([
      linha("b", "2026-10-02", "confirmada", { itens: 8, frase: "acordei cedo" }),
      linha("a", "2026-10-01", "em_revisao", { itens: 3, frase: "não devia vir" }),
    ] as never);
    const p = await paginaDeSessoes(null, 5);
    expect(p.sessoes[0]).toMatchObject({ frase: "acordei cedo", itens: 8 });
    expect(p.sessoes[1]).toMatchObject({ frase: "", itens: null });
  });

  it("o primeiro item no grafo é o primeiro que eu disse, e só os ativos contam", async () => {
    await paginaDeSessoes();
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("coalesce(a.status, 'ativo') = 'ativo'");
    expect(cypher).toContain("ORDER BY coalesce(a.inicios_s[0], 1.0e12)");
    expect(cypher).toContain("s.iniciada_em < $antes");
  });
});

describe("primeiroItem da proposta", () => {
  const atomo = (indice: number, texto: string, inicios: (number | null)[]) =>
    ({
      indice,
      texto,
      trechos: inicios.map((inicio_s) => ({ texto: "", inicio_s, fim_s: null, ancora: "exata" })),
    }) as unknown as Pick<AtomoProposto, "texto" | "indice" | "trechos">;

  it("é o de menor início ancorado, e não o primeiro extraído", () => {
    expect(primeiroItem([atomo(0, "depois", [120]), atomo(1, "antes", [12])])).toBe("antes");
  });

  it("o trecho sem âncora não conta como início; sem âncora nenhuma vai por último", () => {
    expect(primeiroItem([atomo(0, "sem", [null]), atomo(1, "com", [null, 300])])).toBe("com");
    expect(primeiroItem([atomo(2, "b", []), atomo(1, "a", [])])).toBe("a");
  });

  it("proposta vazia não tem frase", () => {
    expect(primeiroItem([])).toBe("");
  });
});
