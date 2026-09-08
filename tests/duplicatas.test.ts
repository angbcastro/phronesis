/**
 * Quem parece ser a mesma coisa que quem.
 *
 * O que importa testar aqui é o **viés** da camada determinística: ela não pode
 * deixar passar grafia diferente da mesma coisa, e não pode tratar nome
 * parecido como se fosse duplicata. Ela só propõe — quem decide sou eu, na
 * tela — mas uma proposta ruim toda vez treina a mão a aceitar sem ler, e aí a
 * fusão errada acontece por inércia.
 */
import { describe, expect, it } from "vitest";
import { distancia, extrairJson, parecidas, proximidade } from "@/lib/duplicatas";
import { chaveDoPar } from "@/lib/fusao";
import type { EntidadeDoGrafo } from "@/lib/entidades";

const ent = (nome: string, extra: Partial<EntidadeDoGrafo> = {}): EntidadeDoGrafo => {
  const chave = nome.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return {
    id: `id-${nome}`,
    nome,
    nome_normalizado: chave,
    chaves: [chave],
    tipo: "Pessoa",
    sessoes: 1,
    atomos: 1,
    aliases: [],
    resumo: "",
    canonico: false,
    perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
    ...extra,
  };
};

describe("distância de edição", () => {
  it("igual é zero", () => {
    expect(distancia("exxmed", "exxmed")).toBe(0);
  });

  it("conta troca, inserção e remoção", () => {
    expect(distancia("rodozanco", "rodozanko")).toBe(1);
    expect(distancia("ana", "anaa")).toBe(1);
    expect(distancia("", "abc")).toBe(3);
  });
});

describe("o que vale uma segunda olhada", () => {
  it("mesma grafia sem os espaços é o caso mais forte", () => {
    const p = proximidade("Exxmed", "Exx Med");
    expect(p?.valor).toBe(1);
    expect(p?.motivo).toContain("espaços");
  });

  it("acento e caixa não fazem par — a normalização já os resolveu", () => {
    // "João" e "joao" têm a mesma chave, então nem chegam aqui como dois nós.
    expect(proximidade("João", "joao")).toBeNull();
  });

  it("uma letra em nome longo entra", () => {
    expect(proximidade("Rodozanco", "Rodozanko")?.valor).toBeGreaterThan(0.8);
  });

  it("uma letra em nome curto NÃO entra — é ruído", () => {
    // "Ana" e "Ane" são duas pessoas muito mais vezes do que são erro de grafia.
    expect(proximidade("Ana", "Ane")).toBeNull();
  });

  it("nome composto que compartilha um pedaço entra", () => {
    const p = proximidade("Maria Silva", "Maria Silva Costa");
    expect(p?.motivo).toContain("maria");
  });

  it("nomes sem nada a ver ficam de fora", () => {
    expect(proximidade("Isinha", "Rodozanco")).toBeNull();
  });
});

describe("os pares oferecidos", () => {
  const grafo = [ent("Exxmed"), ent("Exx Med"), ent("Marina"), ent("Mariana"), ent("Isinha")];

  it("acha a duplicata óbvia e ordena pelo mais parecido", () => {
    const pares = parecidas(grafo);
    expect(pares[0].a).toBe("exxmed");
    expect(pares[0].b).toBe("exx med");
  });

  it("Marina e Mariana chegam a ser propostos — e é o modelo que decide", () => {
    // A camada de string não tem como saber; ela só evita mandar N² pares.
    // Recusar isso é trabalho da camada 2, e depois meu.
    const pares = parecidas(grafo);
    expect(pares.some((p) => chaveDoPar(p.a, p.b) === chaveDoPar("marina", "mariana"))).toBe(true);
  });

  it("o que eu já recusei não volta", () => {
    const pares = parecidas(grafo, new Set([chaveDoPar("marina", "mariana")]));
    expect(pares.some((p) => chaveDoPar(p.a, p.b) === chaveDoPar("marina", "mariana"))).toBe(false);
    // e o resto continua lá
    expect(pares.some((p) => p.a === "exxmed")).toBe(true);
  });

  it("uma entidade sozinha não faz par", () => {
    expect(parecidas([ent("Isinha")])).toEqual([]);
  });
});

describe("a resposta do modelo", () => {
  it("aceita array puro", () => {
    expect(extrairJson('[{"a":"x","b":"y","mesma":true}]')).toHaveLength(1);
  });

  it("aceita array embrulhado em cerca de markdown", () => {
    expect(extrairJson('```json\n[{"a":"x","b":"y","mesma":false}]\n```')).toHaveLength(1);
  });

  it("aceita array com conversa em volta — modelo de raciocínio fala demais", () => {
    expect(extrairJson('Pensando bem... [{"a":"x","b":"y","mesma":true}] espero ter ajudado')).toHaveLength(1);
  });

  it("resposta sem array nenhum estoura, não devolve vazio calado", () => {
    expect(() => extrairJson("não consegui")).toThrow(/sem array JSON/);
  });
});
