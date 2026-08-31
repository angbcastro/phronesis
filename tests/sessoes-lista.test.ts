/**
 * A lista de áudios — a porta de serviço de onde se força uma re-extração.
 *
 * O que importa testar aqui é para onde cada sessão leva e quais delas podem
 * ser reextraídas: reextrair uma sessão já confirmada produziria uma proposta
 * que ninguém pode confirmar, porque `confirmada` não volta para `em_revisao`.
 */
import { describe, expect, it } from "vitest";
import { destino, duracao, podeReextrair, quando } from "@/components/Sessoes";

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

  it("o resto abre na leitura", () => {
    expect(destino(sessao("transcrito"))).toBe("/sessao/mtgn3zf7");
    expect(destino(sessao("confirmada"))).toBe("/sessao/mtgn3zf7");
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
    for (const s of ["gravando", "finalizando", "transcrevendo", "abandonada"]) {
      expect(podeReextrair(sessao(s)), s).toBe(false);
    }
  });
});
