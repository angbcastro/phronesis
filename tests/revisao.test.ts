/**
 * As duas lógicas puras da revisão: achar o áudio, e montar o corpo do confirmar.
 *
 * Do segundo absoluto para o bloco certo do áudio.
 *
 * É o que o botão de escutar depende. Errar aqui toca o pedaço errado, e a
 * revisão inteira deixa de ser confiável — "mostrar a origem, sempre" é
 * princípio de UX da visão, não enfeite.
 */
import { describe, expect, it } from "vitest";
import { localizarNoAudio, montarCorpoDoConfirmar } from "@/components/Revisao";
import { CATALOGO_VAZIO, montarCatalogo } from "@/lib/catalogo";
import type { AtomoEditado } from "@/components/Revisao";
import type { BlocoAbsoluto, TipoEntidade } from "@/lib/tipos";

/** Sessão gravada: um bloco a cada 30 s. */
const gravada: BlocoAbsoluto[] = [
  { i: 0, texto: "", offset_s: 0 },
  { i: 1, texto: "", offset_s: 30 },
  { i: 2, texto: "", offset_s: 60 },
];

/** Sessão importada: um bloco só, cobrindo o arquivo inteiro. */
const importada: BlocoAbsoluto[] = [{ i: 0, texto: "", offset_s: 0 }];

describe("localizar no áudio", () => {
  it("acha o bloco que contém o segundo, e o offset dentro dele", () => {
    expect(localizarNoAudio(gravada, 0)).toEqual({ i: 0, dentro: 0 });
    expect(localizarNoAudio(gravada, 12.5)).toEqual({ i: 0, dentro: 12.5 });
    expect(localizarNoAudio(gravada, 42)).toEqual({ i: 1, dentro: 12 });
    expect(localizarNoAudio(gravada, 61)).toEqual({ i: 2, dentro: 1 });
  });

  it("a borda do bloco pertence ao bloco que começa nela", () => {
    expect(localizarNoAudio(gravada, 30)).toEqual({ i: 1, dentro: 0 });
    expect(localizarNoAudio(gravada, 29.9)).toEqual({ i: 0, dentro: 29.9 });
  });

  it("sessão importada tem um bloco só — o offset é o segundo absoluto", () => {
    // Sem isso, um trecho no minuto 9 de um arquivo importado procuraria o
    // bloco 18, que não existe, e o player ficaria mudo.
    expect(localizarNoAudio(importada, 540)).toEqual({ i: 0, dentro: 540 });
  });

  it("segundo antes do primeiro bloco cai no primeiro, não em lugar nenhum", () => {
    expect(localizarNoAudio(gravada, -5)).toEqual({ i: 0, dentro: 0 });
  });

  it("sem bloco nenhum, não há o que tocar", () => {
    expect(localizarNoAudio([], 10)).toBeNull();
  });

  it("não depende da ordem em que os blocos chegam", () => {
    const fora = [gravada[2], gravada[0], gravada[1]];
    expect(localizarNoAudio(fora, 42)).toEqual({ i: 1, dentro: 12 });
  });
});

/**
 * O corpo do confirmar — a última tradução antes do grafo.
 *
 * Erro aqui não aparece na tela: a menção que eu acrescentei some porque o
 * servidor descarta em silêncio o que não estiver na lista de entidades, ou o
 * nome que eu digitei vira um segundo nó ao lado do que já existia. Só se
 * descobre olhando o grafo dias depois, e aí não há como saber qual sessão fez.
 */
describe("montar o corpo do confirmar", () => {
  const grafo = montarCatalogo([
    {
      nome: "Raffael",
      nome_normalizado: "raffael",
      chaves: ["raffael", "rapha"],
      tipo: "Pessoa",
      sessoes: 9,
      aliases: ["Rapha"],
    },
    {
      nome: "Rodozanco",
      nome_normalizado: "rodozanco",
      chaves: ["rodozanco"],
      tipo: "Projeto",
      sessoes: 6,
      aliases: [],
    },
  ]);

  const atomo = (extra: Partial<AtomoEditado> = {}): AtomoEditado => ({
    indice: 0,
    texto: "pedalei de manhã",
    tipo: "FATO",
    sobre: "eu",
    menciona: [],
    perfila: [],
    ...extra,
  });

  const montar = (
    aprovados: AtomoEditado[],
    entidades: { nome: string; tipo: TipoEntidade }[] = [{ nome: "eu", tipo: "Pessoa" }],
    recusadas: string[] = [],
  ) =>
    montarCorpoDoConfirmar({
      aprovados,
      entidades,
      recusadas: new Set(recusadas),
      catalogo: grafo,
    });

  it("menção acrescentada à mão entra na lista de entidades, não só no átomo", () => {
    // Sem isto o servidor descarta a menção sem uma palavra, e a correção que
    // eu acabei de fazer na tela não chega ao grafo.
    const corpo = montar([atomo({ menciona: ["Marina"] })]);
    expect(corpo.aprovados[0].menciona).toEqual(["Marina"]);
    expect(corpo.entidades).toContainEqual({ nome: "Marina", tipo: "Pessoa" });
  });

  it("nome que casa exato com o grafo sai com a grafia e o tipo do nó", () => {
    // "rodozanco" digitado em minúscula não pode criar um segundo projeto.
    const corpo = montar([atomo({ sobre: "rodozanco" })]);
    expect(corpo.aprovados[0].sobre).toBe("Rodozanco");
    expect(corpo.entidades).toContainEqual({ nome: "Rodozanco", tipo: "Projeto" });
  });

  it("alias digitado à mão cai no vencedor da fusão", () => {
    const corpo = montar([atomo({ menciona: ["Rapha"] })]);
    expect(corpo.aprovados[0].menciona).toEqual(["Raffael"]);
    expect(corpo.entidades).toContainEqual({ nome: "Raffael", tipo: "Pessoa" });
  });

  it("nome que não existe vai como eu escrevi, e nasce entidade nova", () => {
    const corpo = montar([atomo({ sobre: "Bidu" })]);
    expect(corpo.aprovados[0].sobre).toBe("Bidu");
    expect(corpo.entidades).toContainEqual({ nome: "Bidu", tipo: "Pessoa" });
  });

  it("menção igual ao sujeito não é enviada duas vezes", () => {
    const corpo = montar([atomo({ sobre: "Raffael", menciona: ["rapha", "Raffael"] })]);
    expect(corpo.aprovados[0].menciona).toEqual([]);
  });

  it("menção repetida colapsa numa só", () => {
    const corpo = montar([atomo({ menciona: ["Rapha", "Raffael"] })]);
    expect(corpo.aprovados[0].menciona).toEqual(["Raffael"]);
  });

  it("menção vazia — a linha que eu abri e não preenchi — é ignorada", () => {
    const corpo = montar([atomo({ menciona: ["", "   "] })]);
    expect(corpo.aprovados[0].menciona).toEqual([]);
  });

  it("entidade desmarcada no rodapé fica só no texto do átomo", () => {
    // É o que o checkbox de lá promete, e ele não pode valer só para o sujeito.
    const corpo = montar([atomo({ menciona: ["Raffael"] })], [{ nome: "eu", tipo: "Pessoa" }], [
      "raffael",
    ]);
    expect(corpo.aprovados[0].menciona).toEqual([]);
    expect(corpo.entidades.map((e) => e.nome)).not.toContain("Raffael");
  });

  it("marca de perfil sobre entidade que não vai virar nó é descartada", () => {
    const corpo = montar(
      [atomo({ perfila: [{ entidade: "Raffael", campo: "fizemos_juntos" }] })],
      [{ nome: "eu", tipo: "Pessoa" }],
      ["raffael"],
    );
    expect(corpo.aprovados[0].perfila).toEqual([]);
  });

  it("marca de perfil sobre entidade citada sai com a grafia do grafo", () => {
    const corpo = montar([
      atomo({ menciona: ["Rapha"], perfila: [{ entidade: "Rapha", campo: "fizemos_juntos" }] }),
    ]);
    expect(corpo.aprovados[0].perfila).toEqual([
      { entidade: "Raffael", campo: "fizemos_juntos" },
    ]);
  });

  it("a mesma entidade citada por dois átomos entra uma vez só", () => {
    const corpo = montar([
      atomo({ indice: 0, menciona: ["Raffael"] }),
      atomo({ indice: 1, menciona: ["rapha"] }),
    ]);
    expect(corpo.entidades.filter((e) => e.nome === "Raffael")).toHaveLength(1);
  });

  it("sem grafo nenhum, tudo passa como foi escrito", () => {
    // A rota `/api/entidades` pode falhar; a revisão não pode parar por isso.
    const corpo = montarCorpoDoConfirmar({
      aprovados: [atomo({ sobre: "rodozanco", menciona: ["Rapha"] })],
      entidades: [{ nome: "eu", tipo: "Pessoa" }],
      recusadas: new Set(),
      catalogo: CATALOGO_VAZIO,
    });
    expect(corpo.aprovados[0].sobre).toBe("rodozanco");
    expect(corpo.aprovados[0].menciona).toEqual(["Rapha"]);
  });
});
