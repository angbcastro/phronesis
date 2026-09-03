/**
 * Os gestos que só o navegador testemunhou.
 *
 * `gestos` não carrega valor nenhum — carrega o registro do toque. O que estes
 * testes protegem é a fronteira: o que é gesto viaja, o que é valor não, e
 * nada aqui inventa correção que eu não fiz.
 */
import { describe, expect, it } from "vitest";
import { montarGestos } from "@/components/Revisao";
import { normalizarNome } from "@/lib/texto";
import type { EntidadeCandidata, TipoEntidade } from "@/lib/tipos";

const candidata = (nome: string, tipo: TipoEntidade = "Pessoa"): EntidadeCandidata => ({
  nome,
  nome_normalizado: normalizarNome(nome),
  tipo,
  conhecida: false,
  id: null,
  ocorrencias: 1,
  sessoes: 0,
  precisa_nome: false,
});

/** Sem renome nenhum: cada candidata fica como veio. */
const comoVeio = (e: EntidadeCandidata) => ({ nome: e.nome });

const montar = (entrada: Parameters<typeof montarGestos>[0]) => montarGestos(entrada);

describe("o campo que eu toquei", () => {
  it("a chave existir é o gesto — o valor não vem junto", () => {
    const g = montar({
      edicoes: { 0: { tipo: "OPINIAO" }, 3: { texto: "outro", menciona: ["Marina"] } },
      entidades: [],
      finalDe: comoVeio,
      recusadas: new Set(),
    });

    expect(g.atomos).toEqual([
      { indice: 0, campos: ["tipo"] },
      { indice: 3, campos: ["texto", "menciona"] },
    ]);
  });

  it("editor aberto e fechado sem mexer em nada não vira gesto", () => {
    const g = montar({ edicoes: { 2: {} }, entidades: [], finalDe: comoVeio, recusadas: new Set() });
    expect(g.atomos).toEqual([]);
  });

  it("campo que voltou ao valor original ainda é gesto — eu toquei nele", () => {
    // De propósito: o servidor compara valor e não acha diferença nenhuma, e
    // nenhuma correção nasce. O gesto só serviria para distinguir canonização.
    const g = montar({
      edicoes: { 1: { sobre: "eu" } },
      entidades: [],
      finalDe: comoVeio,
      recusadas: new Set(),
    });
    expect(g.atomos).toEqual([{ indice: 1, campos: ["sobre"] }]);
  });
});

describe("o par original→final de um renome", () => {
  it("vai inteiro, porque o POST manda só o final", () => {
    const ela = candidata("ela");
    const g = montar({
      edicoes: {},
      entidades: [ela, candidata("Pedro")],
      finalDe: (e) => ({ nome: e.nome_normalizado === "ela" ? "Marina" : e.nome }),
      recusadas: new Set(),
    });

    expect(g.renomes).toEqual([{ de: "ela", para: "Marina" }]);
  });

  it("caixa e acento não são renome — a mesma trava do servidor", () => {
    const g = montar({
      edicoes: {},
      entidades: [candidata("rodrigo")],
      finalDe: () => ({ nome: "Rodrigo" }),
      recusadas: new Set(),
    });

    expect(g.renomes).toEqual([]);
  });

  it("nome apagado não vira renome para lugar nenhum", () => {
    const g = montar({
      edicoes: {},
      entidades: [candidata("ela")],
      finalDe: () => ({ nome: "   " }),
      recusadas: new Set(),
    });

    expect(g.renomes).toEqual([]);
  });
});

describe("a entidade que eu recusei", () => {
  it("viaja pela chave da proposta, que é por onde o servidor a acha", () => {
    const g = montar({
      edicoes: {},
      entidades: [candidata("o relatório", "Projeto"), candidata("Pedro")],
      finalDe: comoVeio,
      recusadas: new Set(["o relatorio"]),
    });

    expect(g.entidades_recusadas).toEqual(["o relatorio"]);
  });

  it("candidata que ninguém desmarcou não entra", () => {
    const g = montar({
      edicoes: {},
      entidades: [candidata("Pedro")],
      finalDe: comoVeio,
      recusadas: new Set(),
    });

    expect(g.entidades_recusadas).toEqual([]);
  });
});

describe("o corpo mínimo", () => {
  it("revisão em que eu não toquei em nada manda os quatro campos vazios", () => {
    const g = montar({
      edicoes: {},
      entidades: [candidata("eu")],
      finalDe: comoVeio,
      recusadas: new Set(),
    });

    expect(g).toEqual({ atomos: [], entidades_recusadas: [], renomes: [], faltantes: [] });
  });
});
