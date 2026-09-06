/**
 * A ponte entre os dois formatos de proposta.
 *
 * Critério 10 da slice 4: proposta antiga ainda abre na revisão. As duas
 * sessões que estavam em `em_revisao` quando a slice começou guardam `sobre`
 * como string; re-extrair todas só para poder abrir a tela seria pagar uma
 * chamada de modelo por uma mudança de forma.
 */
import { describe, expect, it } from "vitest";
import { comoReferencia, mencoesDe, sobreDe } from "@/lib/referencias";
import type { AtomoProposto, ReferenciaResolvida } from "@/lib/tipos";

const conhecidas = new Set(["isinha", "eu"]);

/** Uma proposta do formato antigo, como está gravada no R2 hoje. */
const antigo = {
  id: "s1-0",
  indice: 0,
  texto: "A Isinha me contou do processo",
  tipo: "FATO",
  sobre: "Isinha",
  menciona: ["eu"],
  trechos: [],
  prompt_version: "extracao-5",
  modelo: "zai/glm-5.3-flash",
} as unknown as AtomoProposto;

const nova: ReferenciaResolvida = {
  citado: "Rafa",
  entidade: "Raffa",
  conhecida: true,
  certo: false,
  alternativas: ["Rapha"],
  motivo: "slackline",
  porque: [],
};

describe("formato antigo", () => {
  it("string vira referência com certo: true — não havia dúvida a inventar", () => {
    expect(sobreDe(antigo, conhecidas)).toEqual({
      citado: "Isinha",
      entidade: "Isinha",
      conhecida: true,
      certo: true,
      alternativas: [],
      motivo: "",
      // Nasceu na slice 4.5. Proposta antiga não tem, e ausente é lista vazia:
      // a revisão simplesmente não mostra o porquê naquela sessão.
      porque: [],
    });
  });

  it("`conhecida` sai do casamento contra as entidades da própria proposta", () => {
    expect(comoReferencia("Marina", conhecidas).conhecida).toBe(false);
    expect(comoReferencia("ISINHA,", conhecidas).conhecida).toBe(true);
  });

  it("a lista de menções também é lida", () => {
    expect(mencoesDe(antigo, conhecidas).map((m) => m.entidade)).toEqual(["eu"]);
  });
});

describe("formato novo", () => {
  it("passa inteiro, com a dúvida e as alternativas", () => {
    expect(comoReferencia(nova)).toEqual(nova);
  });

  it("`certo` ausente conta como certo: o campo nasceu nesta slice", () => {
    const semCampo = { citado: "x", entidade: "x", conhecida: false, alternativas: [], motivo: "" };
    expect(comoReferencia(semCampo as unknown as ReferenciaResolvida).certo).toBe(true);
  });

  it("`certo: false` é preservado — é o que a revisão destaca", () => {
    expect(comoReferencia(nova).certo).toBe(false);
  });
});

describe("proposta torta não derruba a tela", () => {
  it("menções ausentes viram lista vazia", () => {
    const sem = { ...antigo, menciona: undefined } as unknown as AtomoProposto;
    expect(mencoesDe(sem)).toEqual([]);
  });

  it("sujeito ausente vira referência vazia, não exceção", () => {
    expect(comoReferencia(undefined).entidade).toBe("");
  });

  it("alternativas que não são texto caem fora", () => {
    const sujo = { ...nova, alternativas: ["Rapha", 7, null] } as unknown as ReferenciaResolvida;
    expect(comoReferencia(sujo).alternativas).toEqual(["Rapha"]);
  });
});

/**
 * A camada nasceu na 4.8.1, e é o que deixa a tela dizer **por que** aquele
 * nome foi escolhido — "a grafia bateu" contra "dois átomos seus votaram". O
 * campo é opcional e assim fica: proposta anterior não tem, e ausente é "não sei
 * de onde veio", que é a mesma degradação de `certo` e `porque`.
 */
describe("de que camada veio a sugestão", () => {
  it("proposta antiga não tem camada, e nenhuma é inventada", () => {
    expect(sobreDe(antigo, conhecidas).camada).toBeUndefined();
    expect(comoReferencia({ ...nova, camada: undefined }).camada).toBeUndefined();
  });

  it("camada conhecida passa inteira", () => {
    expect(comoReferencia({ ...nova, camada: "vizinhos" }).camada).toBe("vizinhos");
  });

  it("camada que não existe some, em vez de chegar à tela sem frase", () => {
    // `FRASE_DA_CAMADA` é um `Record<Camada, string>`: um valor de fora da lista
    // viraria `undefined` no meio da linha de procedência.
    const sujo = { ...nova, camada: "extrator" } as unknown as ReferenciaResolvida;
    expect(comoReferencia(sujo).camada).toBeUndefined();
  });
});
