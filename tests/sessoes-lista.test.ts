/**
 * A lista de sessões — a porta de serviço de onde se força uma re-extração.
 *
 * O que importa testar aqui é para onde cada sessão leva, quais delas podem ser
 * reextraídas — reextrair uma sessão já confirmada produziria uma proposta que
 * ninguém pode confirmar, porque `confirmada` não volta para `em_revisao` — e
 * quais têm transcrição para ler, já que essa tela saiu da jornada de gravar e
 * agora só se alcança daqui.
 */
import { describe, expect, it } from "vitest";
import {
  destino,
  duracao,
  jaRevisada,
  podeLerTranscricao,
  podeReextrair,
  quando,
} from "@/components/Sessoes";

const sessao = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "mtgn3zf7",
  iniciada_em: "2026-08-31T02:49:33.716Z",
  duracao_s: 165,
  status,
  chunks_total: 6,
  ...extra,
});

describe("quando o áudio foi gravado", () => {
  it("mostra dia, mês e hora, no fuso de quem lê", () => {
    // 02:49Z é 23:49 do dia anterior em São Paulo. O que importa é o horário
    // local: é quando eu gravei, não quando o servidor registrou.
    const iso = "2026-08-31T02:49:33.716Z";
    const dia = String(new Date(iso).getDate()).padStart(2, "0");
    const texto = quando(iso);
    expect(texto).toContain(dia);
    expect(texto).toMatch(/[a-z]{3}/i);
    expect(texto).toMatch(/\d{2}:\d{2}/);
  });

  it("data quebrada não quebra a lista", () => {
    expect(quando("não é data")).toBe("data desconhecida");
  });
});

describe("duração", () => {
  it("usa minuto a partir de um minuto, e segundo abaixo disso", () => {
    expect(duracao(165)).toBe("3 min");
    expect(duracao(44)).toBe("44 s");
  });

  it("sessão de duração zero não vira '0 s'", () => {
    // Áudio existe; zero é o valor que o nó tinha antes de finalizar.
    expect(duracao(0)).toBe("1 s");
  });
});

describe("para onde a sessão leva", () => {
  it("extraída e não confirmada abre direto na revisão", () => {
    expect(destino(sessao("em_revisao"))).toBe("/sessao/mtgn3zf7/revisar");
  });

  it("com transcrição pronta e nada pendente, abre no texto literal", () => {
    expect(destino(sessao("transcrito"))).toBe("/sessao/mtgn3zf7/transcricao");
    expect(destino(sessao("confirmada"))).toBe("/sessao/mtgn3zf7/transcricao");
  });

  it("ainda processando (ou quebrada) abre na tela de processamento", () => {
    // É lá que se vê em que passo parou — e, no caso de `gravando`, é lá que a
    // finalização é disparada.
    for (const s of ["gravando", "finalizando", "transcrevendo", "erro"]) {
      expect(destino(sessao(s)), s).toBe("/sessao/mtgn3zf7");
    }
  });
});

describe("o botão de transcrição", () => {
  it("aparece quando o texto inteiro já está no R2", () => {
    for (const s of ["transcrito", "extraindo", "em_revisao", "confirmada"]) {
      expect(podeLerTranscricao(sessao(s)), s).toBe(true);
    }
  });

  it("não aparece antes de a transcrição existir", () => {
    // Texto crescendo é a tela de processamento, não esta.
    for (const s of ["gravando", "finalizando", "transcrevendo", "erro"]) {
      expect(podeLerTranscricao(sessao(s)), s).toBe(false);
    }
  });
});

describe("quem pode ser reextraída", () => {
  it("sessão com transcrição pronta pode", () => {
    for (const s of ["transcrito", "extraindo", "em_revisao", "erro"]) {
      expect(podeReextrair(sessao(s)), s).toBe(true);
    }
  });

  it("sessão confirmada não — os átomos já estão no grafo", () => {
    // `confirmada` não volta para `em_revisao`, então a proposta nova nasceria
    // morta: não haveria como confirmá-la.
    expect(podeReextrair(sessao("confirmada"))).toBe(false);
  });

  it("sessão sem transcrição também não", () => {
    for (const s of ["gravando", "finalizando", "transcrevendo"]) {
      expect(podeReextrair(sessao(s)), s).toBe(false);
    }
  });
});

/**
 * A cor verde da lista, que é o único lugar onde o sistema diz o que falta
 * revisar desde que o chip saiu da tela de gravar.
 *
 * Pintar de verde uma sessão que ainda tem trabalho é pior que não pintar
 * nada: eu passaria por ela achando que estava resolvida.
 */
describe("qual sessão já foi revisada", () => {
  it("só a confirmada — é o único estado terminal da máquina", () => {
    expect(jaRevisada(sessao("confirmada"))).toBe(true);
  });

  it("proposta esperando revisão não conta como revisada", () => {
    expect(jaRevisada(sessao("em_revisao"))).toBe(false);
  });

  it("nada mais conta", () => {
    for (const s of [
      "gravando",
      "finalizando",
      "transcrevendo",
      "transcrito",
      "extraindo",
      "erro",
    ]) {
      expect(jaRevisada(sessao(s)), s).toBe(false);
    }
  });
});
