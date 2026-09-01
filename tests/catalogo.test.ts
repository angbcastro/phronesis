/**
 * A busca de entidade da revisão, e o casamento que decide reusar ou criar.
 *
 * Dois riscos moram aqui, e os dois são silenciosos. Se `resolver` deixar de
 * casar, digitar o nome de uma entidade que já existe cria um segundo nó com
 * outra grafia e o grafo passa a ter dois "Rafael" — o problema que a slice 3
 * inteira existe para não ter. Se ele deixar de atravessar alias, a grafia que
 * eu fundi mês passado ressuscita como nó novo na sessão de hoje.
 */
import { describe, expect, it } from "vitest";
import { apelidoQueCasa, buscar, montarCatalogo, resolver } from "@/lib/catalogo";
import { normalizarNome } from "@/lib/texto";
import type { EntidadeDoCatalogo } from "@/lib/catalogo";
import type { EntidadeDoGrafo } from "@/lib/entidades";

/**
 * Trava de deriva: o que o catálogo pede tem de caber no que a rota devolve.
 * O tipo do servidor entra só como tipo (`import type`, apagado na compilação),
 * então este arquivo continua sem tocar em Neo4j nenhum.
 */
const _cabe = (e: EntidadeDoGrafo): EntidadeDoCatalogo => e;
void _cabe;

const ent = (
  nome: string,
  extra: Partial<EntidadeDoCatalogo> = {},
): EntidadeDoCatalogo => ({
  nome,
  nome_normalizado: normalizarNome(nome),
  chaves: [],
  tipo: "Pessoa",
  sessoes: 0,
  aliases: [],
  ...extra,
});

const grafo = [
  ent("Raffael", { chaves: ["raffael", "rapha"], aliases: ["Rapha"], sessoes: 9 }),
  ent("Fernanda", { chaves: ["fernanda"], sessoes: 4 }),
  ent("José", { chaves: ["jose"], sessoes: 2 }),
  ent("Rodozanco", { chaves: ["rodozanco"], tipo: "Projeto", sessoes: 6 }),
  ent("Rafa", { chaves: ["rafa"], sessoes: 1 }),
  ent("Ana", { chaves: ["ana"], sessoes: 0 }),
];

const c = montarCatalogo(grafo);

describe("resolver — casou exato, é o nó que já existe", () => {
  it("casa por caixa e por acento", () => {
    expect(resolver(c, "RAFFAEL")?.nome).toBe("Raffael");
    expect(resolver(c, "jose")?.nome).toBe("José");
    expect(resolver(c, "José")?.nome).toBe("José");
  });

  it("atravessa alias: a grafia fundida cai no vencedor da fusão", () => {
    // Sem isto, digitar "Rapha" ressuscitaria um nó que eu já fundi.
    expect(resolver(c, "Rapha")?.nome).toBe("Raffael");
  });

  it("nome que não existe é nome novo — não é para casar por parecença", () => {
    // "Rafa" e "Raffael" se parecem, e é justamente por isso que a decisão
    // não pode ser da máquina aqui: fundir por palpite não tem desfazer.
    expect(resolver(c, "Raffa")).toBeNull();
    expect(resolver(c, "")).toBeNull();
    expect(resolver(c, "   ")).toBeNull();
  });
});

describe("buscar — a lista que aparece quando eu digito", () => {
  it("casa por trecho no meio da palavra, não só pelo começo", () => {
    // O `<datalist>` de antes só fazia prefixo em alguns navegadores.
    expect(buscar(c, "nan").map((e) => e.nome)).toEqual(["Fernanda"]);
  });

  it("sem acento acha com acento", () => {
    expect(buscar(c, "jose").map((e) => e.nome)).toEqual(["José"]);
  });

  it("acha pelo apelido e devolve o nó que vale hoje", () => {
    expect(buscar(c, "rapha").map((e) => e.nome)).toEqual(["Raffael"]);
    expect(apelidoQueCasa(grafo[0], "rapha")).toBe("Rapha");
    expect(apelidoQueCasa(grafo[0], "raff")).toBeNull();
  });

  it("quem começa com o termo vem antes de quem só o contém", () => {
    // "Ana" tem zero sessões e ainda assim vem primeiro: quem eu comecei a
    // digitar é quem eu estou procurando, por mais raro que ele seja.
    expect(buscar(c, "an").map((e) => e.nome)).toEqual(["Ana", "Rodozanco", "Fernanda"]);
  });

  it("empate de prefixo desempata por sessões", () => {
    expect(buscar(c, "ra").map((e) => e.nome)).toEqual(["Raffael", "Rafa"]);
  });

  it("termo vazio devolve o grafo inteiro, mais falado primeiro", () => {
    // Apagar a barra é como eu peço para ver tudo.
    expect(buscar(c, "").map((e) => e.nome)).toEqual([
      "Raffael",
      "Rodozanco",
      "Fernanda",
      "José",
      "Rafa",
      "Ana",
    ]);
  });

  it("o filtro de tipo corta a lista", () => {
    expect(buscar(c, "", "Projeto").map((e) => e.nome)).toEqual(["Rodozanco"]);
    expect(buscar(c, "rodo", "Pessoa")).toEqual([]);
  });

  it("catálogo vazio não estoura", () => {
    expect(buscar(montarCatalogo([]), "rafa")).toEqual([]);
  });
});
