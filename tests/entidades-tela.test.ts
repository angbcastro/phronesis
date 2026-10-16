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
import {
  candidatasParaFundir,
  filaParada,
  moverRascunhos,
  peneirar,
  rascunhosDe,
  selo,
  semRascunhosDe,
  textoDoEstado,
  valorNoGrafo,
} from "@/components/Entidades";
import type { Entidade } from "@/components/Entidades";
import { normalizarNome } from "@/lib/texto";
import { LEASE_ENRIQUECIMENTO_MS, NUNCA_ENRIQUECIDA, PERFIL_VAZIO } from "@/lib/tipos";
import type { Enriquecimento, TipoEntidade } from "@/lib/tipos";

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
    expect(cheia).toContain("7 átomos");
  });

  it("a data sai em dia/mês/ano, que é como eu leio", () => {
    // O ano só aparece fora do ano corrente (`dataCurta`, em `dia.ts`): o
    // teste não pode depender de em que ano roda.
    const s = selo({ ...NUNCA_ENRIQUECIDA, estado: "pronta", atomos: 2, em: "2026-09-14T10:00:00Z" });
    expect(s).toMatch(/em 14\/09(\/2026)?$/);
  });
});

describe("a fila parada (4.12.1)", () => {
  const AGORA = Date.parse("2026-09-29T12:00:00.000Z");
  const ha = (ms: number) => new Date(AGORA - ms).toISOString();
  const est = (estado: Enriquecimento["estado"], em: string): Enriquecimento => ({
    ...NUNCA_ENRIQUECIDA,
    estado,
    em,
  });

  it("na fila sem ninguém rodando é parada — é o 23/09", () => {
    expect(filaParada([est("na_fila", ha(11 * 3600_000)), est("pronta", ha(1000))], AGORA)).toBe(true);
  });

  it("uma rodando fresca quer dizer que a corrente está viva", () => {
    expect(filaParada([est("na_fila", ha(60_000)), est("rodando", ha(20_000))], AGORA)).toBe(false);
  });

  it("rodando mais velha que o lease não segura nada: a reivindicação já a devolve", () => {
    const velha = est("rodando", ha(LEASE_ENRIQUECIMENTO_MS + 1));
    expect(filaParada([velha], AGORA)).toBe(true);
    expect(filaParada([est("na_fila", ha(60_000)), velha], AGORA)).toBe(true);
  });

  it("rodando um instante antes de o lease vencer ainda é corrente viva", () => {
    expect(filaParada([est("rodando", ha(LEASE_ENRIQUECIMENTO_MS - 1))], AGORA)).toBe(false);
  });

  it("sem nada esperando não há o que retomar", () => {
    expect(filaParada([est("pronta", ha(1000)), est("falhou", ha(1000)), { ...NUNCA_ENRIQUECIDA }], AGORA)).toBe(false);
    expect(filaParada([], AGORA)).toBe(false);
  });
});

/**
 * A ficha salva sozinha ao sair do campo (onda 4 da interface), e o rascunho
 * que não gravou é da entidade dele: `desfazer` numa ficha levava o texto que
 * eu tinha deixado em outra.
 */
describe("os rascunhos da ficha", () => {
  const textos = {
    "marina|resumo": "colega",
    "marina|contexto": "do time",
    "rafa|resumo": "amigo",
    "marinaldo|resumo": "outro",
  };

  it("os de uma entidade, e só os dela — a chave que começa igual não conta", () => {
    expect(rascunhosDe(textos, "marina").sort()).toEqual(["marina|contexto", "marina|resumo"]);
  });

  it("limpar uma entidade não toca as outras", () => {
    expect(semRascunhosDe(textos, "marina")).toEqual({
      "rafa|resumo": "amigo",
      "marinaldo|resumo": "outro",
    });
  });

  it("renomear leva os rascunhos para a chave nova", () => {
    expect(moverRascunhos(textos, "rafa", "rafael")).toMatchObject({ "rafael|resumo": "amigo" });
    expect(moverRascunhos(textos, "rafa", "rafael")).not.toHaveProperty("rafa|resumo");
    expect(moverRascunhos(textos, "rafa", "rafa")).toBe(textos);
  });

  it("o valor do grafo de cada campo é o que o rascunho enfrenta", () => {
    const e = ent("Marina", { resumo: "colega" });
    expect(valorNoGrafo(e, "nome")).toBe("Marina");
    expect(valorNoGrafo(e, "resumo")).toBe("colega");
    expect(valorNoGrafo(e, "contexto")).toBe("");
  });

  it("o estado ao lado do rótulo diz o que houve, e o motivo da falha", () => {
    expect(textoDoEstado(undefined)).toBe("");
    expect(textoDoEstado({ estado: "salvando" })).toBe("salvando…");
    expect(textoDoEstado({ estado: "salvo" })).toBe("salvo");
    expect(textoDoEstado({ estado: "falhou", motivo: "sem resposta" })).toBe("não salvou — sem resposta");
  });
});
