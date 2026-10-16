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
  contaDaSessao,
  contagem,
  destino,
  duracao,
  fundirPrimeiraPagina,
  jaRevisada,
  linhasDaSessao,
  podeApagar,
  podeLerTranscricao,
  podeReextrair,
  quando,
  rotuloStatus,
} from "@/components/Sessoes";
import { STATUS_SESSAO } from "@/lib/tipos";

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
    // dia/mês, que é como eu leio (`dataEHora`, em `dia.ts`).
    expect(texto).toMatch(/\d{2}\/\d{2}/);
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

describe("o status como se fala", () => {
  it("nenhum status chega à tela com sublinhado", () => {
    for (const s of STATUS_SESSAO) expect(rotuloStatus(s)).not.toContain("_");
  });

  it("em revisão leva o acento", () => {
    expect(rotuloStatus("em_revisao")).toBe("em revisão");
  });

  it("status que o mapa não conhece aparece cru, em vez de sumir", () => {
    expect(rotuloStatus("descartada")).toBe("descartada");
  });
});

describe("a contagem do cabeçalho", () => {
  it("é o total da lista — no singular quando é uma", () => {
    // A primeira página traz o total (onda 4): "as 50 mais recentes" saiu
    // junto com o teto.
    expect(contagem(51)).toBe("51 sessões");
    expect(contagem(1)).toBe("1 sessão");
  });
});

/**
 * A linha começa pelo que eu disse (onda 4 da interface): a frase em cima, e a
 * data como detalhe. Sem item ainda, a data sobe — é ela que identifica.
 */
describe("a linha da sessão", () => {
  it("a frase em cima, e embaixo a data, a duração, o status e os itens", () => {
    const l = linhasDaSessao(sessao("confirmada", { frase: "acordei cedo", itens: 8 }));
    expect(l.cima).toBe("acordei cedo");
    expect(l.baixo[0]).toBe(quando("2026-08-31T02:49:33.716Z"));
    expect(l.baixo.slice(1)).toEqual(["3 min", "confirmada", "8 itens"]);
  });

  it("sem frase, a data sobe e não se repete embaixo", () => {
    const l = linhasDaSessao(sessao("transcrito"));
    expect(l.cima).toBe(quando("2026-08-31T02:49:33.716Z"));
    expect(l.baixo).toEqual(["3 min", "transcrito"]);
  });

  it("em revisão conta o que espera revisão; sem contagem, nada", () => {
    expect(contaDaSessao({ status: "em_revisao", itens: 5 })).toBe("5 para revisar");
    expect(contaDaSessao({ status: "confirmada", itens: 1 })).toBe("1 item");
    expect(contaDaSessao({ status: "confirmada", itens: 0 })).toBe("0 itens");
    expect(contaDaSessao({ status: "transcrito", itens: null })).toBe("");
    expect(contaDaSessao({ status: "transcrito" })).toBe("");
  });
});

describe("a releitura da primeira página", () => {
  const s = (id: string, iniciada_em: string, status = "confirmada") =>
    sessao(status, { id, iniciada_em });

  it("na primeira vez, é a página", () => {
    const p = [s("b", "2026-10-02"), s("a", "2026-10-01")];
    expect(fundirPrimeiraPagina(null, p, "2026-10-01")).toEqual(p);
  });

  it("as páginas que eu já rolei ficam, e a primeira se atualiza", () => {
    const tela = [s("c", "2026-10-03", "extraindo"), s("b", "2026-10-02"), s("a", "2026-09-01")];
    const primeira = [s("d", "2026-10-04"), s("c", "2026-10-03", "em_revisao")];
    const r = fundirPrimeiraPagina(tela, primeira, "2026-10-03");
    expect(r.map((x) => x.id)).toEqual(["d", "c", "b", "a"]);
    expect(r[1].status).toBe("em_revisao");
  });

  it("o que sumiu da faixa da primeira página sai da tela", () => {
    const tela = [s("c", "2026-10-03"), s("b", "2026-10-02"), s("a", "2026-09-01")];
    const primeira = [s("c", "2026-10-03"), s("a", "2026-09-01")];
    expect(fundirPrimeiraPagina(tela, primeira, "2026-09-01").map((x) => x.id)).toEqual(["c", "a"]);
  });
});

describe("para onde a sessão leva", () => {
  it("extraída e não confirmada abre direto na revisão", () => {
    expect(destino(sessao("em_revisao"))).toBe("/sessao/mtgn3zf7/revisar");
  });

  it("confirmada abre no texto literal — é o que sobrou dela", () => {
    expect(destino(sessao("confirmada"))).toBe("/sessao/mtgn3zf7/transcricao");
  });

  it("transcrita e não extraída abre no corredor, não no texto literal", () => {
    // Era um beco: a sessão tinha texto no R2, nenhuma proposta, e nada em tela
    // nenhuma que disparasse a extração. O corredor empurra e abre a revisão.
    expect(destino(sessao("transcrito"))).toBe("/sessao/mtgn3zf7");
  });

  it("ainda processando (ou quebrada) abre na tela de processamento", () => {
    // É lá que se vê em que passo parou — e, no caso de `gravando`, é lá que a
    // finalização é disparada.
    for (const s of ["gravando", "finalizando", "transcrevendo", "extraindo", "erro"]) {
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

/**
 * O botão de apagar (slice 4.10). Ele existe porque calibrar gera sessão de
 * teste, e uma sessão de 17 min fatiada são 35 objetos no R2: limpar à mão no
 * console não é caminho.
 */
describe("quem pode ser apagada", () => {
  it("sessão que já terminou de processar pode — inclusive a confirmada", () => {
    for (const s of ["em_revisao", "confirmada", "erro"]) {
      expect(podeApagar(sessao(s)), s).toBe(true);
    }
  });

  // A mesma guarda que a rota aplica com 409: um `waitUntil` vivo voltaria a
  // gravar o que acabou de sumir, e sobraria objeto órfão sem `LIST` que o ache.
  it("sessão no meio do pipeline não — o botão nem aparece", () => {
    for (const s of ["gravando", "finalizando", "transcrevendo", "transcrito", "extraindo"]) {
      expect(podeApagar(sessao(s)), s).toBe(false);
    }
  });
});
