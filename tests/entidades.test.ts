import { describe, expect, it } from "vitest";
import {
  TIPO_PADRAO,
  agregarCandidatas,
  ehPronome,
  normalizarNome,
  normalizarTipoEntidade,
  tipoDosLabels,
} from "@/lib/entidades";
import { NUNCA_ENRIQUECIDA } from "@/lib/tipos";
import type { EntidadeDoGrafo } from "@/lib/entidades";
import type { ReferenciaResolvida } from "@/lib/tipos";

/** Uma referência já atribuída, como o agente 2 a devolve. */
const ref = (entidade: string, extra: Partial<ReferenciaResolvida> = {}): ReferenciaResolvida => ({
  citado: entidade,
  entidade,
  conhecida: false,
  certo: true,
  porque: [],
  alternativas: [],
  motivo: "",
  ...extra,
});

const no = (nome: string, extra: Partial<EntidadeDoGrafo> = {}): EntidadeDoGrafo => {
  const chave = normalizarNome(nome);
  return {
    id: `id-${chave}`,
    nome,
    nome_normalizado: chave,
    chaves: [chave],
    tipo: "Pessoa",
    sessoes: 1,
    atomos: 1,
    aliases: [],
    resumo: "",
    canonico: false,
    enriquecimento: NUNCA_ENRIQUECIDA,
    perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
    ...extra,
  };
};

describe("nome normalizado", () => {
  it("é a chave que faz a segunda sessão achar o nó da primeira", () => {
    expect(normalizarNome("Rodozanco")).toBe("rodozanco");
    expect(normalizarNome("  RODOZANCO, ")).toBe("rodozanco");
    expect(normalizarNome("José da Silva")).toBe("jose da silva");
  });

  it("colapsa o espaço que a pontuação deixa para trás", () => {
    expect(normalizarNome("Exx-Med")).toBe("exx med");
  });

  it("nome sem letra nenhuma vira string vazia, não entidade fantasma", () => {
    expect(normalizarNome("…")).toBe("");
  });
});

describe("tipo da entidade", () => {
  it("aceita o que o extrator manda, em qualquer caixa", () => {
    expect(normalizarTipoEntidade("PESSOA")).toBe("Pessoa");
    expect(normalizarTipoEntidade("projeto")).toBe("Projeto");
    expect(normalizarTipoEntidade("Objetivo")).toBe("Objetivo");
  });

  it("conhece o label que a migration 007 acrescentou, com acento e sem", () => {
    // O label é ASCII porque vai literal na consulta; o que o modelo devolve
    // vem acentuado. `normalizarNome` tira o acento antes de comparar, e é o
    // que faz "ORGANIZAÇÃO" achar `:Organizacao`.
    expect(normalizarTipoEntidade("ORGANIZACAO")).toBe("Organizacao");
    expect(normalizarTipoEntidade("organização")).toBe("Organizacao");
    expect(tipoDosLabels(["Entidade", "Organizacao"])).toBe("Organizacao");
  });

  it("recusa o que não é label do schema", () => {
    expect(normalizarTipoEntidade("EMPRESA")).toBeNull();
    expect(normalizarTipoEntidade(42)).toBeNull();
  });

  it("lê o tipo dos labels do nó, ignorando :Entidade", () => {
    expect(tipoDosLabels(["Entidade", "Projeto"])).toBe("Projeto");
    expect(tipoDosLabels(["Entidade"])).toBe(TIPO_PADRAO);
  });
});

describe("a visão agregada da revisão", () => {
  it("conta quantas referências caíram em cada entidade", () => {
    const c = agregarCandidatas([ref("Rodozanco"), ref("Exxmed"), ref("Exxmed")], []);
    expect(c.map((e) => [e.nome_normalizado, e.ocorrencias])).toEqual([
      ["rodozanco", 1],
      ["exxmed", 2],
    ]);
  });

  it("variações de grafia são a mesma linha; a primeira vira o nome", () => {
    const c = agregarCandidatas([ref("Rodozanco"), ref("RODOZANCO,")], []);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ nome: "Rodozanco", ocorrencias: 2 });
  });

  it('"eu" é entidade como qualquer outra', () => {
    const [e] = agregarCandidatas([ref("eu")], [], [{ nome: "eu", tipo: "PESSOA" }]);
    expect(e).toMatchObject({ nome: "eu", nome_normalizado: "eu", tipo: "Pessoa" });
  });

  it("usa o tipo que o extrator propôs para entidade nova", () => {
    const [e] = agregarCandidatas([ref("Phronesis")], [], [{ nome: "Phronesis", tipo: "PROJETO" }]);
    expect(e.tipo).toBe("Projeto");
  });

  it("sem proposta, ou com proposta inválida, cai no padrão", () => {
    expect(agregarCandidatas([ref("Rodozanco")], [])[0].tipo).toBe(TIPO_PADRAO);
    expect(agregarCandidatas([ref("X")], [], [{ nome: "X", tipo: "EMPRESA" }])[0].tipo).toBe(
      TIPO_PADRAO,
    );
  });

  it("entidade que o modelo listou e nenhuma referência aponta não entra", () => {
    // Seria nó órfão no grafo: ninguém aponta para ela.
    expect(
      agregarCandidatas([ref("Rodozanco")], [], [{ nome: "Ninguém", tipo: "PESSOA" }]),
    ).toHaveLength(1);
  });

  it("referência vazia não vira entidade", () => {
    expect(agregarCandidatas([ref("  ")], [])).toEqual([]);
  });

  it("entidade já no grafo volta conhecida, com o id e as sessões do nó", () => {
    const [e] = agregarCandidatas([ref("rodozanco,")], [no("Rodozanco", { sessoes: 3 })]);
    expect(e).toMatchObject({
      conhecida: true,
      id: "id-rodozanco",
      nome: "Rodozanco",
      sessoes: 3,
    });
  });

  it("o que está no grafo vence o que o extrator propôs", () => {
    // Mudar o tipo de uma entidade existente é edição na revisão, não efeito
    // colateral de uma extração.
    const [e] = agregarCandidatas(
      [ref("Exxmed")],
      [no("Exxmed", { tipo: "Projeto" })],
      [{ nome: "Exxmed", tipo: "PESSOA" }],
    );
    expect(e.tipo).toBe("Projeto");
  });

  it("uma grafia fundida agrega na linha do vencedor, não numa própria", () => {
    // É o que faz a fusão valer para o futuro: dita de novo, a grafia morta
    // resolve até o vencedor em vez de renascer como nó.
    const c = agregarCandidatas(
      [ref("Exxmed"), ref("Exx Med")],
      [no("Exxmed", { chaves: ["exxmed", "exx med"], aliases: ["Exx Med"] })],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ nome: "Exxmed", ocorrencias: 2, conhecida: true });
  });

  it("entidade nova volta sem id — quem cria é o confirmar", () => {
    const [e] = agregarCandidatas([ref("Marina")], []);
    expect(e).toMatchObject({ conhecida: false, id: null, sessoes: 0, tipo: TIPO_PADRAO });
  });
});

describe("pronome não vira nó", () => {
  it("reconhece o que o extrator devolve quando não sabe quem é", () => {
    for (const p of ["ela", "Ele", "eles", "a gente", "esse cara", "ALGUÉM", "essa pessoa"]) {
      expect(ehPronome(p), p).toBe(true);
    }
  });

  it('"eu" não é pronome aqui — é entidade legítima, decisão tomada', () => {
    expect(ehPronome("eu")).toBe(false);
  });

  it("nome de verdade passa", () => {
    for (const n of ["Marina", "Rodozanco", "Pedro", "Exxmed"]) {
      expect(ehPronome(n), n).toBe(false);
    }
  });

  it("candidata nova com nome de pronome pede nome na revisão", () => {
    const [e] = agregarCandidatas([ref("ela")], []);
    expect(e).toMatchObject({ conhecida: false, precisa_nome: true });
  });

  it("candidata com nome de verdade não pede nada", () => {
    expect(agregarCandidatas([ref("Marina")], [])[0].precisa_nome).toBe(false);
  });

  it("entidade já no grafo nunca pede nome — ela já passou por uma revisão", () => {
    const [e] = agregarCandidatas([ref("ela")], [no("Ela Fitzgerald", { chaves: ["ela"] })]);
    expect(e).toMatchObject({ conhecida: true, precisa_nome: false });
  });
});
