/**
 * A tela de entidades — o que a lista mostra, em que ordem, e com quem cada
 * entidade pode ser fundida.
 *
 * Duas funções puras, e as duas guardam decisões que só aparecem na tela: que
 * a busca daqui **atravessa alias** (digitar a grafia antiga tem de achar a
 * vencedora da fusão, senão a única forma de encontrar uma entidade renomeada é
 * lembrar do nome novo); que **sem termo a ordem é a de mais falada**, e não a
 * canônica-primeiro que a rota devolve para desempate de agente; e que a
 * própria entidade **nunca** aparece entre as candidatas a fundir com ela
 * mesma — `fusao.ts` recusa a auto-fusão no servidor, e um botão que só existe
 * para dar erro é pior que nenhum botão.
 *
 * Sem DOM: não há jsdom neste projeto, e o que vale testar aqui é a regra, não
 * a marcação.
 */
import { describe, expect, it } from "vitest";
import { candidatasParaFundir, peneirar, selo } from "@/components/Entidades";
import type { Entidade } from "@/components/Entidades";
import { normalizarNome } from "@/lib/texto";
import { NUNCA_ENRIQUECIDA, PERFIL_VAZIO } from "@/lib/tipos";
import type { TipoEntidade } from "@/lib/tipos";

const ent = (nome: string, extra: Partial<Entidade> = {}): Entidade => ({
  id: `id-${normalizarNome(nome)}`,
  nome,
  nome_normalizado: normalizarNome(nome),
  chaves: [normalizarNome(nome)],
  tipo: "Pessoa" as TipoEntidade,
  sessoes: 1,
  atomos: 1,
  aliases: [],
  resumo: "",
  canonico: false,
  perfil: { ...PERFIL_VAZIO },
  enriquecimento: { ...NUNCA_ENRIQUECIDA },
  ...extra,
});

const tudo = { termo: "", tipo: "todas" as const, semResumo: false };
const nomes = (lista: Entidade[]) => lista.map((e) => e.nome);

describe("o que a lista mostra", () => {
  it("sem termo, a ordem é a de mais falada", () => {
    // A rota devolve canônico primeiro, depois sessões: boa para o desempate do
    // agente 2, ruim para o olho. O que eu quero ver em cima é o que eu mais
    // falo.
    const lista = [
      ent("Fernanda", { atomos: 3 }),
      ent("Giampaolo", { atomos: 42 }),
      ent("Isinha", { atomos: 31 }),
    ];
    expect(nomes(peneirar(lista, tudo))).toEqual(["Giampaolo", "Isinha", "Fernanda"]);
  });

  it("empate de átomos desempata pelo nome, e não pela ordem de chegada", () => {
    const lista = [ent("Rafael", { atomos: 5 }), ent("Bruno", { atomos: 5 })];
    expect(nomes(peneirar(lista, tudo))).toEqual(["Bruno", "Rafael"]);
  });

  it("acha por trecho no meio da palavra", () => {
    const lista = [ent("Fernanda"), ent("Giampaolo")];
    expect(nomes(peneirar(lista, { ...tudo, termo: "nan" }))).toEqual(["Fernanda"]);
  });

  it("atravessa alias: a grafia antiga acha a vencedora da fusão", () => {
    // É o caso que justifica reusar `catalogo.ts` em vez de filtrar por nome
    // aqui: depois de fundir "Rapha" em "Raffael", "Rapha" continua sendo o
    // nome que eu lembro.
    const lista = [
      ent("Raffael", { aliases: ["Rapha"], chaves: ["raffael", "rapha"] }),
      ent("Giampaolo"),
    ];
    expect(nomes(peneirar(lista, { ...tudo, termo: "rapha" }))).toEqual(["Raffael"]);
  });

  it("com termo, quem começa com ele vem antes de quem só o contém", () => {
    // Ordenar por volume aqui jogaria o casamento quase exato para o meio da
    // lista — com termo, relevância vence "mais falada".
    const lista = [ent("Barbara", { atomos: 90 }), ent("Rafa", { atomos: 2 })];
    expect(nomes(peneirar(lista, { ...tudo, termo: "ra" }))).toEqual(["Rafa", "Barbara"]);
  });

  it("o filtro de tipo e o de resumo se combinam", () => {
    const lista = [
      ent("Isinha", { atomos: 10 }),
      ent("Giampaolo", { atomos: 20, resumo: "colega de trabalho" }),
      ent("Phronesis", { tipo: "Projeto", atomos: 30 }),
    ];
    expect(nomes(peneirar(lista, { ...tudo, tipo: "Pessoa" }))).toEqual(["Giampaolo", "Isinha"]);
    expect(nomes(peneirar(lista, { ...tudo, semResumo: true }))).toEqual([
      "Phronesis",
      "Isinha",
    ]);
    expect(nomes(peneirar(lista, { termo: "", tipo: "Pessoa", semResumo: true }))).toEqual([
      "Isinha",
    ]);
  });

  it("recorte que não casa com ninguém devolve lista vazia, não a lista inteira", () => {
    const lista = [ent("Isinha"), ent("Giampaolo")];
    expect(peneirar(lista, { ...tudo, termo: "zzz" })).toEqual([]);
  });
});

describe("com quem fundir", () => {
  it("a própria entidade nunca é candidata a fundir consigo mesma", () => {
    const isinha = ent("Isinha");
    const lista = [isinha, ent("Isinha Castro")];
    const achadas = candidatasParaFundir(lista, isinha, "isi");
    expect(nomes(achadas)).toEqual(["Isinha Castro"]);
  });

  it("nem quando o termo é o nome dela inteiro", () => {
    const isinha = ent("Isinha");
    expect(candidatasParaFundir([isinha], isinha, "Isinha")).toEqual([]);
  });

  it("termo vazio oferece o resto do grafo, que é o caso de quem não lembra o nome", () => {
    const isinha = ent("Isinha");
    const lista = [isinha, ent("Giampaolo"), ent("Fernanda")];
    expect(nomes(candidatasParaFundir(lista, isinha, "")).sort()).toEqual([
      "Fernanda",
      "Giampaolo",
    ]);
  });

  it("acha a candidata por alias, que é o caso em que a fusão à mão ganha da automática", () => {
    // A camada de string de `/duplicatas` compara os dois NOMES; ela não olha
    // alias. Fundir à mão olha, e é por isso que ela alcança par que a busca
    // automática nunca propõe.
    const isinha = ent("Isinha");
    const lista = [isinha, ent("Isabela", { aliases: ["Bela"], chaves: ["isabela", "bela"] })];
    expect(nomes(candidatasParaFundir(lista, isinha, "bela"))).toEqual(["Isabela"]);
  });
});

describe("o selo da fila, na linha", () => {
  it("nunca enriquecida não vira selo nenhum", () => {
    // É o estado de quase todo o grafo: um selo em toda linha não informa nada.
    expect(selo(NUNCA_ENRIQUECIDA)).toBe("");
  });

  it("a que falhou diz o motivo na própria linha", () => {
    expect(selo({ ...NUNCA_ENRIQUECIDA, estado: "falhou", motivo: "sem resposta" })).toContain(
      "sem resposta",
    );
  });

  it("falha sem motivo registrado não vira selo mudo", () => {
    expect(selo({ ...NUNCA_ENRIQUECIDA, estado: "falhou" })).toContain("sem motivo registrado");
  });

  it("pronta sem átomo se distingue de pronta com ficha", () => {
    const vazia = selo({ ...NUNCA_ENRIQUECIDA, estado: "pronta", atomos: 0 });
    const cheia = selo({ ...NUNCA_ENRIQUECIDA, estado: "pronta", atomos: 7 });
    expect(vazia).toContain("sem átomo para ler");
    expect(cheia).toContain("7 átomo(s)");
  });

  it("a data sai em dia/mês/ano, que é como eu leio", () => {
    const s = selo({ ...NUNCA_ENRIQUECIDA, estado: "pronta", atomos: 2, em: "2026-09-14T10:00:00Z" });
    expect(s).toContain("14/09/2026");
  });
});
