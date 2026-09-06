/**
 * As lógicas puras da revisão: achar o áudio, montar o corpo do confirmar, e
 * separar o que a tela tem de destacar — a dúvida e a procedência da sugestão.
 *
 * Do segundo absoluto para o bloco certo do áudio.
 *
 * É o que o botão de escutar depende. Errar aqui toca o pedaço errado, e a
 * revisão inteira deixa de ser confiável — "mostrar a origem, sempre" é
 * princípio de UX da visão, não enfeite.
 */
import { describe, expect, it } from "vitest";
import {
  FRASE_DA_CAMADA,
  herdadasDoAtomo,
  incertasDoAtomo,
  localizarNoAudio,
  montarCorpoDoConfirmar,
  ondeEstaA,
  referenciasDoAtomo,
} from "@/components/Revisao";
import { CATALOGO_VAZIO, montarCatalogo } from "@/lib/catalogo";
import { CAMADAS_DE_CANDIDATO } from "@/lib/tipos";
import type { AtomoEditado } from "@/components/Revisao";
import type {
  AtomoProposto,
  BlocoAbsoluto,
  Evidencia,
  ReferenciaResolvida,
  TipoEntidade,
} from "@/lib/tipos";

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

/**
 * O que a tela destaca — a dúvida e a procedência da sugestão (slice 4.8.1).
 *
 * Dois defeitos moravam aqui, e os dois eram silenciosos. A revisão lia tudo do
 * sujeito, então discordância do agente 2 sobre uma **menção** não aparecia em
 * lugar nenhum — o `ARCHITECTURE.md` §4.7 prometia o contrário com todas as
 * letras. E o `porque` só saía na dúvida, quando é justamente no caminho comum
 * (`certo: true`) que a camada dos vizinhos mais herda atribuição passada.
 *
 * A terceira coisa que se testa aqui é a armadilha do índice: a menção casa com
 * a referência **por posição**, e sugestão na linha errada é pior que sugestão
 * nenhuma.
 */
describe("as referências que a tela destaca", () => {
  const ref = (r: Partial<ReferenciaResolvida> & { entidade: string }): ReferenciaResolvida => ({
    citado: r.entidade,
    conhecida: true,
    certo: true,
    alternativas: [],
    motivo: "",
    porque: [],
    ...r,
  });

  const evidencia = (texto: string): Evidencia => ({
    atomo_id: "a1",
    valido_em: "2026-08-12",
    texto,
    similaridade: 0.82,
  });

  const proposto = (
    sobre: ReferenciaResolvida,
    menciona: ReferenciaResolvida[] = [],
  ): AtomoProposto => ({
    id: "s1-0",
    indice: 0,
    texto: "conversei com ele sobre o Rodozanco",
    tipo: "FATO",
    sobre,
    menciona,
    trechos: [],
    perfila: [],
    prompt_version: "extracao-6",
    modelo: "zai/glm-5.3-flash",
  });

  it("a dúvida sobre uma menção conta — até aqui só o sujeito contava", () => {
    // O caso que a validação de ponta a ponta achou: o agente 2 devolve
    // `certo: false` por menção, a revisão lia só o do sujeito, e a
    // discordância passava com o átomo aprovado e nada na tela.
    const a = proposto(ref({ entidade: "eu" }), [
      ref({ entidade: "Raffael", certo: false, motivo: "dois candidatos com o mesmo peso" }),
    ]);

    const incertas = incertasDoAtomo(a);
    expect(incertas).toHaveLength(1);
    expect(incertas[0].papel).toBe("menciona");
    expect(incertas[0].ordem).toBe(0);
    expect(incertas[0].ref.motivo).toBe("dois candidatos com o mesmo peso");
  });

  it("sujeito e menção incertos no mesmo átomo viram duas linhas, não duas telas", () => {
    // O formato é a mitigação declarada do custo: um parágrafo por átomo, uma
    // linha por referência. A tela tem 60 s.
    const a = proposto(ref({ entidade: "Raffael", certo: false }), [
      ref({ entidade: "Rodozanco" }),
      ref({ entidade: "Giampaolo", certo: false }),
    ]);

    expect(incertasDoAtomo(a).map(ondeEstaA)).toEqual(["sobre", "menção 2"]);
  });

  it("átomo sem dúvida nenhuma não destaca nada", () => {
    expect(incertasDoAtomo(proposto(ref({ entidade: "eu" }), [ref({ entidade: "Raffael" })]))).toEqual(
      [],
    );
  });

  it("a ordem é a da tela: o sujeito primeiro, e as menções na posição delas", () => {
    // É esta ordem que faz `ordem` casar com a barra pesquisável daquela menção.
    const a = proposto(ref({ entidade: "eu" }), [
      ref({ entidade: "Raffael" }),
      ref({ entidade: "Rodozanco" }),
    ]);

    expect(referenciasDoAtomo(a).map((i) => [i.papel, i.ordem, i.ref.entidade])).toEqual([
      ["sobre", -1, "eu"],
      ["menciona", 0, "Raffael"],
      ["menciona", 1, "Rodozanco"],
    ]);
  });

  it("mexer na lista de menções tira as menções da conta — é a trava do índice", () => {
    // A armadilha, e ela é silenciosa: acrescentar ou remover uma menção
    // desloca a posição, e a sugestão da menção 1 apareceria na linha da 2,
    // dizendo "escolhi Raffael" ao lado de outro nome. A partir da primeira
    // edição o átomo fica só com a dúvida do sujeito, que é um valor só e não
    // desloca.
    const a = proposto(ref({ entidade: "eu", certo: false }), [
      ref({ entidade: "Raffael", certo: false }),
    ]);

    expect(incertasDoAtomo(a, undefined, false).map(ondeEstaA)).toEqual(["sobre", "menção 1"]);
    expect(incertasDoAtomo(a, undefined, true).map(ondeEstaA)).toEqual(["sobre"]);
    expect(referenciasDoAtomo(a, undefined, true)).toHaveLength(1);
  });

  it("a procedência aparece com o agente certo — não só quando ele hesitou", () => {
    // O laço que o §4.10 declara: átomo passado vota no próximo, e a única
    // coisa que torna isso aceitável é estar na tela. Estava na tela só na
    // dúvida, que é onde a herança menos acontece.
    const a = proposto(
      ref({
        entidade: "Raffael",
        certo: true,
        camada: "vizinhos",
        porque: [evidencia("almocei com o Raffael")],
      }),
    );

    const herdadas = herdadasDoAtomo(a);
    expect(herdadas).toHaveLength(1);
    expect(herdadas[0].ref.camada).toBe("vizinhos");
  });

  it("a camada do perfil aparece mesmo sem evidência — ela não traz átomo junto", () => {
    // `candidatosPorPerfil` casa contra o texto do perfil, não contra átomos:
    // `porque` vem vazio, e sem olhar a camada a sugestão ficaria muda.
    const a = proposto(ref({ entidade: "Raffael", camada: "perfil" }));
    expect(herdadasDoAtomo(a).map((i) => i.ref.camada)).toEqual(["perfil"]);
  });

  it("a grafia que bateu fica de fora — ali nada foi herdado", () => {
    // `exato` e `string` são o que eu mesmo falei. Uma linha em todo átomo
    // viraria ruído na tela mais apertada do sistema.
    expect(herdadasDoAtomo(proposto(ref({ entidade: "Raffael", camada: "exato" })))).toEqual([]);
    expect(herdadasDoAtomo(proposto(ref({ entidade: "Raffael", camada: "string" })))).toEqual([]);
  });

  it("proposta antiga, sem camada, não inventa procedência", () => {
    expect(herdadasDoAtomo(proposto(ref({ entidade: "Raffael" })))).toEqual([]);
  });

  it("toda camada tem o que dizer de si — a 4.9 acrescenta uma e não pode esquecer da frase", () => {
    for (const c of CAMADAS_DE_CANDIDATO) {
      expect(FRASE_DA_CAMADA[c]).toBeTruthy();
    }
  });
});
