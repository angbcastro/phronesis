import { describe, expect, it } from "vitest";
import {
  STATUS_ABERTOS,
  duracaoPorChunks,
  estaAberta,
  estaConcluida,
  estaPendenteDeRevisao,
  foiAbandonada,
  podeIrPara,
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

  it("deixa retomar ou processar uma sessão abandonada", () => {
    expect(podeIrPara("abandonada", "gravando")).toBe(true);
    expect(podeIrPara("abandonada", "finalizando")).toBe(true);
  });

  it("permite retry manual depois de erro no STT", () => {
    expect(podeIrPara("erro", "transcrevendo")).toBe(true);
  });
});

describe("abandono", () => {
  const agora = new Date("2026-08-23T20:00:00.000Z");
  const minAtras = (m: number) => new Date(agora.getTime() - m * 60_000).toISOString();

  it("marca abandonada sem bloco novo há mais de 10 min", () => {
    expect(foiAbandonada("gravando", minAtras(11), agora)).toBe(true);
  });

  it("não marca dentro da janela de 10 min", () => {
    expect(foiAbandonada("gravando", minAtras(9), agora)).toBe(false);
  });

  it("só se aplica a sessão em gravação", () => {
    expect(foiAbandonada("transcrevendo", minAtras(30), agora)).toBe(false);
  });

  it("sessão sem bloco nenhum não é abandonada", () => {
    expect(foiAbandonada("gravando", null, agora)).toBe(false);
  });
});

describe("classificação", () => {
  it("o chip de recuperação pega gravando, abandonada e erro", () => {
    expect((["gravando", "abandonada", "erro"] as const).every(estaAberta)).toBe(true);
    expect((["transcrito", "finalizando", "transcrevendo"] as const).some(estaAberta)).toBe(false);
  });

  it("converte contagem de blocos em segundos", () => {
    expect(duracaoPorChunks(30)).toBe(900); // 15 min
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

  it("em_revisao é pendência de revisão, e agora aparece no chip", () => {
    expect(estaPendenteDeRevisao("em_revisao")).toBe(true);
    expect(estaAberta("em_revisao")).toBe(true);
    expect(STATUS_ABERTOS).toEqual(["gravando", "abandonada", "erro", "em_revisao"]);
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
