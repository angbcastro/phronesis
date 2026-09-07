import { describe, expect, it } from "vitest";
import {
  estaConcluida,
  estaPendenteDeRevisao,
  podeIrPara,
  podeReextrair,
  temTranscricao,
  terminouDeProcessar,
} from "@/lib/estados";

describe("transições", () => {
  it("segue o caminho feliz da slice", () => {
    expect(podeIrPara("gravando", "finalizando")).toBe(true);
    expect(podeIrPara("finalizando", "transcrevendo")).toBe(true);
    expect(podeIrPara("transcrevendo", "transcrito")).toBe(true);
  });

  it("não volta atrás de uma sessão já transcrita", () => {
    expect(podeIrPara("transcrito", "finalizando")).toBe(false);
    expect(podeIrPara("transcrito", "gravando")).toBe(false);
  });

  it("transcrito deixou de ser terminal: emenda na extração", () => {
    expect(podeIrPara("transcrito", "extraindo")).toBe(true);
    expect(podeIrPara("extraindo", "em_revisao")).toBe(true);
    expect(podeIrPara("em_revisao", "confirmada")).toBe(true);
  });

  it("confirmada é o fim da linha — nada a desfaz por transição", () => {
    expect(podeIrPara("confirmada", "em_revisao")).toBe(false);
    expect(podeIrPara("confirmada", "extraindo")).toBe(false);
    expect(podeIrPara("confirmada", "confirmada")).toBe(true);
  });

  it("extração que falhou pode ser tentada de novo", () => {
    expect(podeIrPara("extraindo", "erro")).toBe(true);
    expect(podeIrPara("erro", "extraindo")).toBe(true);
  });

  it("revisar de novo é permitido; a proposta é que não se sobrescreve", () => {
    expect(podeIrPara("em_revisao", "extraindo")).toBe(true);
  });

  it("permite repetir o estado atual — finalizar duas vezes não quebra", () => {
    expect(podeIrPara("finalizando", "finalizando")).toBe(true);
    expect(podeIrPara("transcrito", "transcrito")).toBe(true);
  });

  it("permite retry manual depois de erro no STT", () => {
    expect(podeIrPara("erro", "transcrevendo")).toBe(true);
  });
});

describe("o que cada estado significa para as telas", () => {
  it("concluída é confirmada — transcrever deixou de ser o fim", () => {
    expect(estaConcluida("confirmada")).toBe(true);
    expect(estaConcluida("transcrito")).toBe(false);
    expect(estaConcluida("em_revisao")).toBe(false);
  });

  it("a leitura para o polling assim que a transcrição existe", () => {
    // A extração corre atrás; a tela de leitura não espera por ela.
    for (const s of ["transcrito", "extraindo", "em_revisao", "confirmada"] as const) {
      expect(temTranscricao(s)).toBe(true);
    }
    for (const s of ["gravando", "transcrevendo", "erro"] as const) {
      expect(temTranscricao(s)).toBe(false);
    }
  });

  it("do erro dá para re-extrair — é de lá que o retry manual parte", () => {
    // A rota de extrair barrava em `temTranscricao`, que não inclui `erro`, e
    // respondia 409 dizendo não haver transcrição numa sessão cuja transcrição
    // estava intacta no R2. A máquina de estados já permitia `erro → extraindo`.
    expect(podeReextrair("erro")).toBe(true);
    expect(podeIrPara("erro", "extraindo")).toBe(true);

    for (const s of ["transcrito", "extraindo", "em_revisao", "confirmada"] as const) {
      expect(podeReextrair(s)).toBe(true);
    }
    // Antes de haver transcrição não há o que extrair, e aí o 409 está certo.
    for (const s of ["gravando", "finalizando", "transcrevendo"] as const) {
      expect(podeReextrair(s)).toBe(false);
    }
  });

  it("em_revisao é pendência de revisão: tem proposta esperando por mim", () => {
    expect(estaPendenteDeRevisao("em_revisao")).toBe(true);
    expect(estaPendenteDeRevisao("transcrito")).toBe(false);
    expect(estaPendenteDeRevisao("confirmada")).toBe(false);
  });

  /**
   * A mesma pergunta serve à guarda do `DELETE /api/sessoes/:id` (slice 4.10):
   * apagar no meio do pipeline correria com um `waitUntil` vivo, que voltaria a
   * gravar o que acabou de sumir — e sobraria um objeto órfão de uma sessão que
   * já saiu da lista, sem `LIST` no R2 para reencontrá-lo.
   */
  it("o apagar só é oferecido quando nada mais vai gravar sozinho", () => {
    for (const s of ["gravando", "finalizando", "transcrevendo", "transcrito", "extraindo"] as const) {
      expect(terminouDeProcessar(s)).toBe(false);
    }
    for (const s of ["em_revisao", "confirmada", "erro"] as const) {
      expect(terminouDeProcessar(s)).toBe(true);
    }
  });

  it("a leitura só para o polling quando nada mais muda sozinho", () => {
    // Parar em `transcrito` faria a tela nunca ver a extração terminar, e o
    // link para a revisão nunca apareceria.
    expect(terminouDeProcessar("transcrito")).toBe(false);
    expect(terminouDeProcessar("extraindo")).toBe(false);
    expect(terminouDeProcessar("em_revisao")).toBe(true);
    expect(terminouDeProcessar("confirmada")).toBe(true);
    expect(terminouDeProcessar("erro")).toBe(true);
  });
});
