/**
 * O corredor entre parar de falar e revisar.
 *
 * O que se protege aqui é a única decisão dele que não é cosmética: **quando
 * empurrar a sessão**. Empurrar demais paga uma chamada de modelo à toa;
 * empurrar de menos deixa a sessão parada para sempre, com texto no R2 e
 * nenhuma proposta — que foi exatamente o beco em que `transcrito` ficou.
 */
import { describe, expect, it } from "vitest";
import { esperouDemais, TETO_DA_ESPERA_MS } from "@/client/espera";
import { deveSairParaRevisao, legenda, precisaFinalizar } from "@/components/Processando";

describe("quando o corredor chama /finalizar", () => {
  it("sessão que nunca foi fechada precisa — é o caminho normal do botão", () => {
    expect(precisaFinalizar("gravando")).toBe(true);
  });

  it("transcrita e sem proposta precisa: é o retry do waitUntil perdido", () => {
    expect(precisaFinalizar("transcrito")).toBe(true);
  });

  it("quebrada precisa — /finalizar é o retry manual", () => {
    expect(precisaFinalizar("erro")).toBe(true);
  });

  it("o que já está andando sozinho não é empurrado de novo", () => {
    for (const s of ["finalizando", "transcrevendo", "extraindo"]) {
      expect(precisaFinalizar(s), s).toBe(false);
    }
  });

  it("o que já acabou não é reprocessado", () => {
    for (const s of ["em_revisao", "confirmada"]) {
      expect(precisaFinalizar(s), s).toBe(false);
    }
  });
});

describe("o verbo do passo atual", () => {
  it("transcrita ou extraindo é a mesma espera, do meu lado", () => {
    expect(legenda("transcrito", false)).toBe("lendo o que você disse…");
    expect(legenda("extraindo", false)).toBe("lendo o que você disse…");
  });

  it("antes disso, o que está acontecendo é o áudio", () => {
    expect(legenda("finalizando", false)).toBe("guardando o áudio…");
    expect(legenda("transcrevendo", false)).toBe("transcrevendo…");
  });
});

/**
 * A tela batia para sempre (18/09).
 *
 * Ela só sabia falar em falha quando o **status** dizia `erro`, e sessão cuja
 * função morreu no `maxDuration` nunca chega a `erro`: fica em `extraindo` no
 * grafo. A sessão `mu73d88b0w4u6o5d440j` ficou assim, e o que eu vi foi "lendo
 * o que você disse…" sem fim — que parece lentidão e é trava.
 */
describe("até quando vale continuar perguntando", () => {
  it("dentro do tempo em que ainda pode haver alguém trabalhando, espera", () => {
    const abriu = 1_000_000;
    expect(esperouDemais(abriu, abriu)).toBe(false);
    // Os 300 s de `maxDuration` do `/finalizar` cabem inteiros dentro do teto:
    // chamar de travado antes disso faria eu reextrair uma sessão viva.
    expect(esperouDemais(abriu, abriu + 300_000)).toBe(false);
  });

  it("passado o teto, desiste de olhar", () => {
    const abriu = 1_000_000;
    expect(esperouDemais(abriu, abriu + TETO_DA_ESPERA_MS)).toBe(true);
    expect(esperouDemais(abriu, abriu + TETO_DA_ESPERA_MS + 1)).toBe(true);
  });
});

/**
 * A ponte saindo (slice 8.2).
 *
 * A tela de processamento deixou de esperar a proposta fechar: ela sai no
 * primeiro evento com átomo. A pergunta é só essa, e ela é pura — errar para
 * mais mandaria a revisão abrir vazia, errar para menos manteria a tela morta
 * que esta fatia existe para acabar.
 */
describe("quando a ponte sai para a revisão", () => {
  it("sem evento nenhum, fica", () => {
    expect(deveSairParaRevisao(null)).toBe(false);
    expect(deveSairParaRevisao(undefined)).toBe(false);
  });

  it("proposta sem átomo ainda não é o que mostrar", () => {
    expect(deveSairParaRevisao({ extracao: { atomos: [] } })).toBe(false);
  });

  it("um átomo basta — a espera passa a acontecer com a lista na frente", () => {
    expect(deveSairParaRevisao({ extracao: { atomos: [{}] } })).toBe(true);
  });
});
