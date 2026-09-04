/**
 * A apuração de correções: o diff entre o que a proposta dizia e o que eu
 * aprovei.
 *
 * O que estes testes protegem é o que a fatia 4.6 promete e nenhuma tela
 * mostra: que uma correção minha nunca se perde (critérios 1 e 2) e que uma
 * correção que eu não fiz nunca aparece (critério 3). Correção-fantasma é pior
 * que correção perdida — ela vira regra no prompt, e o prompt é o que produz
 * tudo o mais.
 */
import { describe, expect, it } from "vitest";
import { normalizarNome } from "@/lib/texto";
import {
  apurarCorrecoes,
  indiceVazio,
  juntarNoIndice,
  normalizarGestos,
  podarIndice,
} from "@/lib/correcoes";
import type { AtomoConfirmado, EntidadeConfirmada } from "@/lib/correcoes";
import type {
  AtomoProposto,
  Correcao,
  EntidadeCandidata,
  Extracao,
  Gestos,
  TipoAtomo,
  TipoEntidade,
} from "@/lib/tipos";

const SESSAO = "mtgn3zf7";
const EM = "2026-09-03T21:00:00.000Z";

const referencia = (nome: string, conhecida = false) => ({
  citado: nome,
  entidade: nome,
  conhecida,
  certo: true,
  alternativas: [] as string[],
  motivo: "",
  porque: [],
});

function atomo(
  indice: number,
  campos: {
    texto?: string;
    tipo?: TipoAtomo;
    sobre?: string;
    conhecida?: boolean;
    menciona?: string[];
    inicio_s?: number | null;
  } = {},
): AtomoProposto {
  const inicio = campos.inicio_s === undefined ? 24 : campos.inicio_s;
  return {
    id: `${SESSAO}-${indice}`,
    indice,
    texto: campos.texto ?? "Terminei o esboço do relatório",
    tipo: campos.tipo ?? "FATO",
    sobre: referencia(campos.sobre ?? "eu", campos.conhecida ?? false),
    menciona: (campos.menciona ?? []).map((m) => referencia(m)),
    trechos: [
      {
        texto: "terminei o esboço",
        inicio_s: inicio,
        fim_s: inicio === null ? null : inicio + 3,
        ancora: inicio === null ? "nenhuma" : "exata",
      },
    ],
    perfila: [],
    prompt_version: "extracao-5",
    modelo: "zai/glm-5.3-flash",
  } as AtomoProposto;
}

const candidata = (
  nome: string,
  campos: { tipo?: TipoEntidade; conhecida?: boolean } = {},
): EntidadeCandidata => ({
  nome,
  nome_normalizado: normalizarNome(nome),
  tipo: campos.tipo ?? "Pessoa",
  conhecida: campos.conhecida ?? false,
  id: campos.conhecida ? "e1" : null,
  ocorrencias: 1,
  sessoes: campos.conhecida ? 3 : 0,
  precisa_nome: false,
});

function proposta(
  atomos: AtomoProposto[],
  entidades: EntidadeCandidata[] = [candidata("eu")],
  sessao_id = SESSAO,
): Extracao {
  return {
    sessao_id,
    atomos,
    entidades,
    descartados: [],
    prompt_version: "extracao-5",
    modelo: "zai/glm-5.3-flash",
    prompt_version_resolucao: null,
    modelo_resolucao: null,
    granularidade: "palavra",
    criado_em: "2026-09-03T20:00:00.000Z",
  };
}

const confirmado = (
  indice: number,
  campos: Partial<Omit<AtomoConfirmado, "indice">> = {},
): AtomoConfirmado => ({
  indice,
  texto: campos.texto ?? "Terminei o esboço do relatório",
  tipo: campos.tipo ?? "FATO",
  sobre: campos.sobre ?? "eu",
  menciona: campos.menciona ?? [],
});

const entidade = (nome: string, tipo: TipoEntidade = "Pessoa"): EntidadeConfirmada => ({
  nome,
  nome_normalizado: normalizarNome(nome),
  tipo,
});

const gestos = (parcial: Partial<Gestos> = {}): Gestos => ({
  atomos: [],
  entidades_recusadas: [],
  renomes: [],
  faltantes: [],
  ...parcial,
});

function apurar(entrada: {
  proposta: Extracao;
  confirmados?: AtomoConfirmado[];
  entidades?: EntidadeConfirmada[];
  gestos?: Gestos | null;
  localizar?: (texto: string) => { inicio_s: number | null };
}): Correcao[] {
  return apurarCorrecoes({
    proposta: entrada.proposta,
    confirmados: entrada.confirmados ?? [],
    entidades: entrada.entidades ?? [entidade("eu")],
    gestos: entrada.gestos ?? null,
    em: EM,
    localizar: entrada.localizar,
  });
}

const tipos = (cs: Correcao[]) => cs.map((c) => c.tipo).sort();
const doTipo = (cs: Correcao[], tipo: string) => cs.filter((c) => c.tipo === tipo);

describe("correção de átomo (critério 1)", () => {
  it("desmarcar um átomo registra o texto que foi rejeitado", () => {
    const p = proposta([atomo(0, { texto: "O texto é confuso e circular" }), atomo(1)]);
    const cs = apurar({ proposta: p, confirmados: [confirmado(1)] });

    expect(tipos(cs)).toEqual(["rejeitado"]);
    expect(cs[0]).toMatchObject({
      id: `${SESSAO}-0|rejeitado`,
      atomo_id: `${SESSAO}-0`,
      agente: "extracao",
      antes: "O texto é confuso e circular",
      depois: "",
      tocado: true,
      incorporada_em: null,
    });
  });

  it("editar o texto guarda os dois lados, e o gesto diz que fui eu", () => {
    const p = proposta([atomo(0, { texto: "Falei com o Pedro" })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { texto: "Combinei o prazo com o Pedro" })],
      gestos: gestos({ atomos: [{ indice: 0, campos: ["texto"] }] }),
    });

    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({
      tipo: "texto",
      antes: "Falei com o Pedro",
      depois: "Combinei o prazo com o Pedro",
      tocado: true,
    });
  });

  it("trocar o tipo é do extrator, e carrega o tipo proposto junto", () => {
    const p = proposta([atomo(0, { tipo: "FATO" })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { tipo: "OPINIAO" })],
      gestos: gestos({ atomos: [{ indice: 0, campos: ["tipo"] }] }),
    });

    expect(cs[0]).toMatchObject({
      tipo: "tipo",
      agente: "extracao",
      antes: "FATO",
      depois: "OPINIAO",
      tipo_atomo: "FATO",
    });
  });

  it("rejeitar um e trocar o tipo de outro dá as duas correções — o critério 1 inteiro", () => {
    const p = proposta([atomo(0), atomo(1, { tipo: "FATO" })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(1, { tipo: "APRENDIZADO" })],
      gestos: gestos({ atomos: [{ indice: 1, campos: ["tipo"] }] }),
    });

    expect(tipos(cs)).toEqual(["rejeitado", "tipo"]);
  });

  it("a procedência é a do átomo da proposta, e as âncoras vão junto (regra 7)", () => {
    const p = proposta([atomo(0, { inicio_s: 137 })]);
    const cs = apurar({ proposta: p, confirmados: [] });

    expect(cs[0]).toMatchObject({
      prompt_version: "extracao-5",
      modelo: "zai/glm-5.3-flash",
      inicios_s: [137],
    });
  });

  it("átomo sem âncora vira correção sem âncora, e não uma inventada", () => {
    const p = proposta([atomo(0, { inicio_s: null })]);
    expect(apurar({ proposta: p, confirmados: [] })[0].inicios_s).toEqual([]);
  });
});

describe("trocar o sujeito e as menções", () => {
  it("sujeito de candidata nova é erro do extrator", () => {
    const p = proposta(
      [atomo(0, { sobre: "Rafa", conhecida: false })],
      [candidata("Rafa"), candidata("eu")],
    );
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Marina" })],
      entidades: [entidade("Marina")],
      gestos: gestos({ atomos: [{ indice: 0, campos: ["sobre"] }] }),
    });

    expect(cs[0]).toMatchObject({
      tipo: "sujeito",
      agente: "extracao",
      antes: "Rafa",
      depois: "Marina",
      tocado: true,
    });
  });

  it("sujeito que o grafo já conhecia é erro da resolução", () => {
    const p = proposta(
      [atomo(0, { sobre: "Rafa", conhecida: true })],
      [candidata("Rafa", { conhecida: true }), candidata("Rapha", { conhecida: true })],
    );
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Rapha" })],
      entidades: [entidade("Rapha")],
      gestos: gestos({ atomos: [{ indice: 0, campos: ["sobre"] }] }),
    });

    expect(cs[0]).toMatchObject({ tipo: "sujeito", agente: "resolucao" });
  });

  it("menção acrescentada é sempre do extrator, mesmo em átomo de entidade conhecida", () => {
    // Não há referência original para a resolução ter errado: o extrator
    // simplesmente não listou aquela menção.
    const p = proposta(
      [atomo(0, { sobre: "Isinha", conhecida: true })],
      [candidata("Isinha", { conhecida: true })],
    );
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Isinha", menciona: ["Giam"] })],
      entidades: [entidade("Isinha"), entidade("Giam")],
      gestos: gestos({ atomos: [{ indice: 0, campos: ["menciona"] }] }),
    });

    expect(cs[0]).toMatchObject({ tipo: "mencao_adicionada", agente: "extracao" });
  });

  it("menção removida continua seguindo o átomo — ali a resolução pode ter errado", () => {
    const p = proposta(
      [atomo(0, { sobre: "Isinha", conhecida: true, menciona: ["Pedro"] })],
      [candidata("Isinha", { conhecida: true })],
    );
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Isinha", menciona: [] })],
      entidades: [entidade("Isinha")],
    });

    expect(cs[0]).toMatchObject({ tipo: "mencao_removida", agente: "resolucao" });
  });

  it("acrescentar e tirar menção no mesmo átomo são duas correções, não uma", () => {
    const p = proposta([atomo(0, { menciona: ["Pedro"] })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { menciona: ["Marina"] })],
      gestos: gestos({ atomos: [{ indice: 0, campos: ["menciona"] }] }),
    });

    expect(tipos(cs)).toEqual(["mencao_adicionada", "mencao_removida"]);
    expect(doTipo(cs, "mencao_adicionada")[0].depois).toBe("Marina");
    expect(doTipo(cs, "mencao_removida")[0].antes).toBe("Pedro");
    expect(new Set(cs.map((c) => c.id)).size).toBe(2);
  });

  it("duas menções acrescentadas ao mesmo átomo cabem numa correção só", () => {
    const p = proposta([atomo(0)]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { menciona: ["Marina", "Pedro"] })],
    });

    expect(cs).toHaveLength(1);
    expect(cs[0].depois).toBe("Marina, Pedro");
  });

  it("promover uma menção a sujeito é uma correção, não três", () => {
    const p = proposta([atomo(0, { sobre: "eu", menciona: ["Pedro"] })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Pedro", menciona: [] })],
      gestos: gestos({ atomos: [{ indice: 0, campos: ["sobre"] }] }),
    });

    expect(tipos(cs)).toEqual(["sujeito"]);
  });
});

describe("canonização não é correção (critério 3)", () => {
  it("a mesma grafia com caixa e acento diferentes não produz nada", () => {
    const p = proposta([atomo(0, { sobre: "marina", menciona: ["joao"] })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Marina", menciona: ["João"] })],
      entidades: [entidade("Marina")],
    });

    expect(cs).toEqual([]);
  });

  it("átomo aprovado sem eu tocar em nada não produz correção nenhuma", () => {
    const p = proposta([atomo(0), atomo(1)]);
    const cs = apurar({ proposta: p, confirmados: [confirmado(0), confirmado(1)] });
    expect(cs).toEqual([]);
  });

  it("chave diferente sem o gesto é registrada, mas como inferida", () => {
    // Travessia de alias: digitei "Raffa" e o catálogo resolveu para o
    // vencedor da fusão. Registra — mas a tela precisa saber que ninguém viu.
    const p = proposta([atomo(0, { sobre: "Raffa", conhecida: true })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Rapha" })],
      gestos: gestos(),
    });

    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ tipo: "sujeito", tocado: false });
  });
});

describe("correção de entidade (critério 2)", () => {
  it("renomear duas entidades na mesma sessão dá duas correções distintas", () => {
    const p = proposta([atomo(0)], [candidata("ela"), candidata("meu chefe")]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0)],
      gestos: gestos({
        renomes: [
          { de: "ela", para: "Marina" },
          { de: "meu chefe", para: "Rodrigo" },
        ],
      }),
    });

    const renomes = doTipo(cs, "entidade_renomeada");
    expect(renomes).toHaveLength(2);
    expect(new Set(renomes.map((c) => c.id)).size).toBe(2);
    expect(renomes.map((c) => `${c.antes}→${c.depois}`).sort()).toEqual([
      "ela→Marina",
      "meu chefe→Rodrigo",
    ]);
  });

  it("a mesma entidade renomeada em duas sessões não colapsa num id só", () => {
    const uma = apurar({
      proposta: proposta([atomo(0)], [candidata("ela")]),
      confirmados: [confirmado(0)],
      gestos: gestos({ renomes: [{ de: "ela", para: "Marina" }] }),
    });
    const outra = apurarCorrecoes({
      proposta: proposta([], [candidata("ela")], "mtgo3kaf5"),
      confirmados: [],
      entidades: [],
      gestos: gestos({ renomes: [{ de: "ela", para: "Marina" }] }),
      em: EM,
    });

    expect(uma[0].id).not.toBe(outra[0].id);
  });

  it("renome de pronome é do extrator; renome de grafia é higiene do grafo", () => {
    const cs = apurar({
      proposta: proposta([atomo(0)], [candidata("ela"), candidata("Rodrigão")]),
      confirmados: [confirmado(0)],
      gestos: gestos({
        renomes: [
          { de: "ela", para: "Marina" },
          { de: "Rodrigão", para: "Rodrigo" },
        ],
      }),
    });

    const porNome = new Map(doTipo(cs, "entidade_renomeada").map((c) => [c.antes, c.agente]));
    expect(porNome.get("ela")).toBe("extracao");
    expect(porNome.get("Rodrigão")).toBe("grafo");
  });

  it("renomear não vira também correção de sujeito no átomo que a cita", () => {
    const p = proposta([atomo(0, { sobre: "ela" })], [candidata("ela")]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { sobre: "Marina" })],
      entidades: [entidade("Marina")],
      gestos: gestos({ renomes: [{ de: "ela", para: "Marina" }] }),
    });

    expect(tipos(cs)).toEqual(["entidade_renomeada"]);
  });

  it("renome que só muda caixa ou acento não é correção nenhuma", () => {
    const cs = apurar({
      proposta: proposta([atomo(0)], [candidata("marina")]),
      confirmados: [confirmado(0)],
      gestos: gestos({ renomes: [{ de: "marina", para: "Marina" }] }),
    });

    expect(cs).toEqual([]);
  });

  it("desmarcar a candidata é recusa, e não vira também menção removida", () => {
    const p = proposta(
      [atomo(0, { menciona: ["o relatório"] })],
      [candidata("eu"), candidata("o relatório", { tipo: "Projeto" })],
    );
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { menciona: [] })],
      gestos: gestos({ entidades_recusadas: ["o relatório"] }),
    });

    expect(tipos(cs)).toEqual(["entidade_recusada"]);
    expect(cs[0]).toMatchObject({
      agente: "extracao",
      entidade_chave: "o relatorio",
      antes: "o relatório",
      depois: "",
      atomo_id: null,
    });
  });

  it("recusa sem gesto nenhum não é inventada a partir do valor", () => {
    const p = proposta(
      [atomo(0, { menciona: ["o relatório"] })],
      [candidata("eu"), candidata("o relatório", { tipo: "Projeto" })],
    );
    const cs = apurar({ proposta: p, confirmados: [confirmado(0, { menciona: [] })] });

    expect(tipos(cs)).toEqual(["mencao_removida"]);
  });

  it("trocar o tipo de uma candidata nova é derivável sem gesto", () => {
    const p = proposta([atomo(0)], [candidata("eu"), candidata("Phronesis")]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0)],
      entidades: [entidade("eu"), entidade("Phronesis", "Projeto")],
    });

    expect(cs[0]).toMatchObject({
      tipo: "entidade_tipo",
      agente: "extracao",
      antes: "Pessoa",
      depois: "Projeto",
      entidade_chave: "phronesis",
    });
  });

  it("o tipo de uma entidade que o grafo já conhece é do grafo, não meu", () => {
    const p = proposta([atomo(0)], [candidata("Phronesis", { conhecida: true })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0)],
      entidades: [entidade("Phronesis", "Projeto")],
    });

    expect(cs).toEqual([]);
  });
});

describe("faltou um (spec §6)", () => {
  it("casando com a transcrição, nasce ancorado", () => {
    const cs = apurar({
      proposta: proposta([atomo(0)]),
      confirmados: [confirmado(0)],
      gestos: gestos({ faltantes: [{ texto: "esqueci de dizer do médico" }] }),
      localizar: () => ({ inicio_s: 412 }),
    });

    expect(cs[0]).toMatchObject({
      tipo: "faltou",
      agente: "extracao",
      antes: "",
      depois: "esqueci de dizer do médico",
      inicios_s: [412],
      atomo_id: null,
    });
  });

  it("não casando, vale como texto e fica sem âncora", () => {
    const cs = apurar({
      proposta: proposta([]),
      gestos: gestos({ faltantes: [{ texto: "o que eu não falei em voz alta" }] }),
      localizar: () => ({ inicio_s: null }),
    });

    expect(cs[0].inicios_s).toEqual([]);
  });

  it("dois faltantes diferentes não se sobrescrevem", () => {
    const cs = apurar({
      proposta: proposta([]),
      gestos: gestos({
        faltantes: [{ texto: "faltou o médico" }, { texto: "faltou a conversa com a Marina" }],
      }),
    });

    expect(cs).toHaveLength(2);
    expect(new Set(cs.map((c) => c.id)).size).toBe(2);
  });
});

describe("corpo sem gestos continua confirmando", () => {
  it("infere pelo valor e marca tudo como não tocado", () => {
    const p = proposta([atomo(0, { texto: "antes", tipo: "FATO" })]);
    const cs = apurar({
      proposta: p,
      confirmados: [confirmado(0, { texto: "depois", tipo: "OPINIAO" })],
      gestos: null,
    });

    expect(tipos(cs)).toEqual(["texto", "tipo"]);
    expect(cs.every((c) => c.tocado === false)).toBe(true);
  });
});

describe("ler os gestos do corpo sem confiar em nada", () => {
  it("corpo sem gestos é null, não um erro", () => {
    expect(normalizarGestos(undefined)).toBeNull();
    expect(normalizarGestos("gestos")).toBeNull();
  });

  it("campo inventado não entra, e o resto sobrevive", () => {
    const g = normalizarGestos({
      atomos: [{ indice: 0, campos: ["texto", "cor"] }, { indice: "x", campos: [] }],
      entidades_recusadas: ["ela", "", 7],
      renomes: [{ de: "ela", para: "Marina" }, { de: "", para: "x" }],
      faltantes: [{ texto: "  algo  " }, { texto: "" }],
    });

    expect(g).toEqual({
      atomos: [{ indice: 0, campos: ["texto"] }],
      entidades_recusadas: ["ela"],
      renomes: [{ de: "ela", para: "Marina" }],
      faltantes: [{ texto: "algo" }],
    });
  });
});

describe("o índice acumula", () => {
  const correcao = (id: string, fechada = false): Correcao =>
    ({
      id,
      sessao_id: SESSAO,
      atomo_id: null,
      entidade_chave: null,
      agente: "extracao",
      tipo: "texto",
      antes: "a",
      depois: "b",
      tipo_atomo: null,
      texto_proposto: "",
      inicios_s: [],
      prompt_version: "extracao-5",
      modelo: "m",
      tocado: true,
      em: EM,
      incorporada_em: fechada ? "a3f91c7d" : null,
    }) as Correcao;

  it("as mais novas entram na frente", () => {
    const i = juntarNoIndice(
      { ...indiceVazio(EM), correcoes: [correcao("velha")] },
      [correcao("nova")],
      EM,
    );
    expect(i.correcoes.map((c) => c.id)).toEqual(["nova", "velha"]);
  });

  it("id que já está no índice não é reaberto — incorporada_em é autoritativo aqui", () => {
    const antes = { ...indiceVazio(EM), correcoes: [correcao("x", true)] };
    const depois = juntarNoIndice(antes, [correcao("x")], EM);

    expect(depois.correcoes).toHaveLength(1);
    expect(depois.correcoes[0].incorporada_em).toBe("a3f91c7d");
    expect(depois).toBe(antes); // nada entrou: o objeto nem é reconstruído
  });

  it("a eviction come as fechadas antes das abertas", () => {
    const lista = [correcao("a1"), correcao("f1", true), correcao("a2"), correcao("f2", true)];
    expect(podarIndice(lista, 2).map((c) => c.id)).toEqual(["a1", "a2"]);
  });

  it("sem fechada nenhuma, some a aberta mais velha", () => {
    const lista = [correcao("nova"), correcao("meio"), correcao("velha")];
    expect(podarIndice(lista, 2).map((c) => c.id)).toEqual(["nova", "meio"]);
  });

  it("dentro do teto, nada é cortado", () => {
    const lista = [correcao("a"), correcao("b")];
    expect(podarIndice(lista, 500)).toHaveLength(2);
  });
});
