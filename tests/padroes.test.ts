/**
 * O primeiro passo da calibração: o padrão que as minhas correções revelam, e
 * as amarras que impedem isso de estragar um prompt que já presta.
 *
 * Era `regras.test.ts` até a slice 7, quando o apêndice virou emenda. O que
 * mudou de nome mudou de destino, não de disciplina: as amarras são as mesmas —
 * nunca a partir de uma correção só, sempre citando os ids, teto de dois por
 * rodada — e continuam valendo **no parser**, porque amarra que vive só no
 * texto do prompt é amarra que o modelo ignora num dia ruim.
 *
 * O recorte por agente é a fatia inteira num teste só: até a 7 isto era uma
 * constante `"extracao"` cravada, e era o que deixava `resolucao` acumulando
 * correção etiquetada sem consumidor desde a 4.6.
 */
import { describe, expect, it } from "vitest";
import { BASE, montarPrompt, PROMPT_VERSION, versaoDoPrompt } from "@/lib/extracao";
import { parsearRascunho } from "@/lib/calibracao";
import { secoesDe } from "@/lib/redacao";
import {
  abertasPorAgente,
  indiceVazio,
  INTERVALO_SUGESTAO_DIAS,
  marcarVisitaDe,
  normalizarIndice,
  paraCalibrar,
  sugerirAlgum,
  sugerirCalibracao,
  visitaDe,
} from "@/lib/correcoes";
import { MAX_PADROES_POR_RODADA } from "@/lib/tipos";
import type { AgenteCorrecao, Correcao } from "@/lib/tipos";

describe("o apêndice saiu, e o prompt base não mudou (slice 7)", () => {
  it("as duas metades se emendam sem nada entre elas", () => {
    // A junção exata: fim da última seção do prompt base, linha em branco,
    // cabeçalho FORMATO. Se algo se intrometer aqui, é aqui que aparece — e
    // desde a 7 nada se intromete, porque não há mais bloco a injetar.
    expect(montarPrompt("x")).toContain("comentário sobre o material não é.\n\nFORMATO\n");
  });

  it("nada de AJUSTES QUE EU PEDI: o que era apêndice virou emenda no corpo", () => {
    expect(montarPrompt("x")).not.toContain("AJUSTES QUE EU PEDI");
  });

  it("a versão sai sem sufixo", () => {
    expect(versaoDoPrompt()).toBe(PROMPT_VERSION);
    expect(versaoDoPrompt()).toBe("extracao-9");
  });
});

describe("as seções do prompt, lidas do próprio prompt", () => {
  it("acha os cabeçalhos, e só eles", () => {
    const secoes = secoesDe(BASE);
    expect(secoes).toContain("NOME DE ENTIDADE É NOME");
    expect(secoes).toContain("NÃO COMENTE A TRANSCRIÇÃO");
    expect(secoes).toContain("OS CAMPOS");
    // A seção da 007 tem acento no cabeçalho, e o `calibracao-2` precisa poder
    // citá-la: é ela que um padrão sobre volume de história contradiria.
    expect(secoes).toContain("A HISTÓRIA GUARDA O DETALHE");
    // Linha de conteúdo, ainda que comece com maiúscula, não é seção.
    expect(secoes.some((s) => s.includes("FATO        aconteceu"))).toBe(false);
  });

  it("vale para o prompt de qualquer agente, não só o da extração", () => {
    // É o que faz a calibração ser paramétrica: `secoesDe` não sabe de quem é
    // o texto que recebeu, e é por isso que ela saiu de `extracao.ts`.
    const prompt = ["COMO DECIDIR", "vá fundo", "FORMATO", "json"].join("\n");
    expect(secoesDe(prompt)).toEqual(["COMO DECIDIR", "FORMATO"]);
  });
});

describe("as amarras do calibracao-2 valem no parser, não só no prompt", () => {
  const ids = new Set(["c1", "c2", "c3"]);
  const secoes = ["OS CAMPOS", "ENTIDADES"];

  const parsear = (bruto: string) =>
    parsearRascunho(bruto, { agente: "extracao", ids, secoes });

  it("padrão tirado de uma correção só é descartado — um caso não é padrão", () => {
    const r = parsear(JSON.stringify({ padroes: [{ texto: "faça isso", cita: ["c1"] }] }));
    expect(r).toEqual([]);
  });

  it("padrão sem citação nenhuma não existe", () => {
    expect(parsear(JSON.stringify({ padroes: [{ texto: "faça isso" }] }))).toEqual([]);
  });

  it("id que o modelo inventou não conta como citação", () => {
    // Contaria, e `incorporada_em` fecharia uma correção que a emenda não leu.
    const r = parsear(JSON.stringify({ padroes: [{ texto: "x", cita: ["c1", "inventado"] }] }));
    expect(r).toEqual([]);
  });

  it("citação repetida não vira duas", () => {
    const r = parsear(JSON.stringify({ padroes: [{ texto: "x", cita: ["c1", "c1"] }] }));
    expect(r).toEqual([]);
  });

  it("mais de dois padrões: só os dois primeiros passam", () => {
    const tres = [1, 2, 3].map((n) => ({ texto: `padrão ${n}`, cita: ["c1", "c2"] }));
    expect(parsear(JSON.stringify({ padroes: tres }))).toHaveLength(MAX_PADROES_POR_RODADA);
  });

  it("seção inventada não vira substitui — apontaria para nada no prompt", () => {
    const r = parsear(
      JSON.stringify({ padroes: [{ texto: "x", cita: ["c1", "c2"], substitui: "SEÇÃO QUE NÃO EXISTE" }] }),
    );
    expect(r[0].substitui).toBeUndefined();
  });

  it("seção de verdade sobrevive", () => {
    const r = parsear(
      JSON.stringify({ padroes: [{ texto: "x", cita: ["c1", "c2"], substitui: "OS CAMPOS" }] }),
    );
    expect(r[0].substitui).toBe("OS CAMPOS");
  });

  it("cada padrão ganha um id próprio, que é o que sobrevive à minha edição", () => {
    const duas = [1, 2].map((n) => ({ texto: `padrão ${n}`, cita: ["c1", "c2"] }));
    const r = parsear(JSON.stringify({ padroes: duas }));
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
  });

  it("resposta sem JSON nenhum é lista vazia, não um erro", () => {
    expect(parsear("desculpe, não consegui")).toEqual([]);
    expect(parsear("")).toEqual([]);
  });

  it("cerca de markdown não atrapalha, como nos outros agentes", () => {
    const r = parsear('```json\n{"padroes":[{"texto":"x","cita":["c1","c2"]}]}\n```');
    expect(r).toHaveLength(1);
  });

  it("lista vazia é resposta legítima", () => {
    expect(parsear(JSON.stringify({ padroes: [] }))).toEqual([]);
  });
});

describe("a sugestão de calibrar", () => {
  const correcao = (em: string, extra: Partial<Correcao> = {}): Correcao =>
    ({
      id: `c-${em}`,
      sessao_id: "s1",
      atomo_id: null,
      entidade_chave: null,
      agente: "extracao" as AgenteCorrecao,
      tipo: "texto",
      antes: "a",
      depois: "b",
      tipo_atomo: null,
      texto_proposto: "",
      inicios_s: [],
      prompt_version: "extracao-7",
      modelo: "m",
      tocado: true,
      em,
      incorporada_em: null,
      ...extra,
    }) as Correcao;

  const emDias = (base: string, dias: number) =>
    new Date(new Date(base).getTime() + dias * 24 * 60 * 60 * 1000).getTime();

  const NASCEU = "2026-09-04T00:00:00.000Z";

  it("índice sem correção em aberto nunca sugere, não importa o tempo (critério 7)", () => {
    const i = {
      ...indiceVazio(NASCEU),
      correcoes: [correcao(NASCEU, { incorporada_em: "a3f91c7d" })],
    };
    expect(sugerirCalibracao(i, "extracao", emDias(NASCEU, 365))).toBe(false);
  });

  it("índice vazio nunca sugere", () => {
    expect(sugerirCalibracao(indiceVazio(NASCEU), "extracao", emDias(NASCEU, 365))).toBe(false);
  });

  it("correção em aberto há mais de 3 semanas, sem visita, acende (critério 8)", () => {
    const i = { ...indiceVazio(NASCEU), correcoes: [correcao(NASCEU)] };
    expect(sugerirCalibracao(i, "extracao", emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1))).toBe(true);
  });

  it("antes das 3 semanas, não acende", () => {
    const i = { ...indiceVazio(NASCEU), correcoes: [correcao(NASCEU)] };
    expect(sugerirCalibracao(i, "extracao", emDias(NASCEU, INTERVALO_SUGESTAO_DIAS - 1))).toBe(false);
  });

  it("a contagem parte da correção em aberto MAIS ANTIGA, não da mais nova", () => {
    const i = {
      ...indiceVazio(NASCEU),
      correcoes: [correcao("2026-09-25T00:00:00.000Z"), correcao(NASCEU)],
    };
    expect(sugerirCalibracao(i, "extracao", emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1))).toBe(true);
  });

  it("ter aberto a tela apaga a sugestão por mais 3 semanas (critério 9)", () => {
    // Aprovando regra ou não: olhar já conta.
    const visita = "2026-09-24T00:00:00.000Z";
    const i = { ...indiceVazio(NASCEU), correcoes: [correcao(NASCEU)], visitado_em: visita };
    expect(sugerirCalibracao(i, "extracao", emDias(visita, 1))).toBe(false);
    expect(sugerirCalibracao(i, "extracao", emDias(visita, INTERVALO_SUGESTAO_DIAS + 1))).toBe(true);
  });
});

describe("o recorte que o calibracao-2 lê", () => {
  const c = (id: string, agente: AgenteCorrecao, incorporada_em: string | null = null): Correcao =>
    ({
      id,
      sessao_id: "s1",
      atomo_id: null,
      entidade_chave: null,
      agente,
      tipo: "texto",
      antes: "a",
      depois: "b",
      tipo_atomo: null,
      texto_proposto: "",
      inicios_s: [],
      prompt_version: "extracao-7",
      modelo: "m",
      tocado: true,
      em: "2026-09-04T00:00:00.000Z",
      incorporada_em,
    }) as Correcao;

  it("só as em aberto e só as daquele agente", () => {
    const i = {
      ...indiceVazio("2026-09-04T00:00:00.000Z"),
      correcoes: [
        c("aberta-extracao", "extracao"),
        c("fechada-extracao", "extracao", "a3f91c7d"),
        c("aberta-resolucao", "resolucao"),
        c("aberta-grafo", "grafo"),
      ],
    };
    expect(paraCalibrar(i, "extracao").map((x) => x.id)).toEqual(["aberta-extracao"]);
  });

  it("a resolução deixa de acumular sem consumidor — ela tem o próprio recorte", () => {
    // O item de §14 que esta fatia apaga: `resolucao` e `grafo` acumulavam
    // etiquetados desde a 4.6 porque `paraCalibrar` tinha "extracao" cravado.
    const i = {
      ...indiceVazio("2026-09-04T00:00:00.000Z"),
      correcoes: [c("aberta-extracao", "extracao"), c("aberta-resolucao", "resolucao")],
    };
    expect(paraCalibrar(i, "resolucao").map((x) => x.id)).toEqual(["aberta-resolucao"]);
  });

  it("o mapa da porta conta por agente, `grafo` incluído", () => {
    const i = {
      ...indiceVazio("2026-09-04T00:00:00.000Z"),
      correcoes: [
        c("a", "extracao"),
        c("b", "extracao"),
        c("c", "resolucao"),
        c("d", "grafo"),
        c("e", "extracao", "pa1b2c3d4"),
      ],
    };
    expect(abertasPorAgente(i)).toEqual({ extracao: 2, resolucao: 1, grafo: 1 });
  });
});

describe("o relógio da sugestão é por agente (slice 7)", () => {
  const c = (id: string, agente: AgenteCorrecao, em: string): Correcao =>
    ({
      id,
      sessao_id: "s1",
      atomo_id: null,
      entidade_chave: null,
      agente,
      tipo: "texto",
      antes: "a",
      depois: "b",
      tipo_atomo: null,
      texto_proposto: "",
      inicios_s: [],
      prompt_version: "extracao-9",
      modelo: "m",
      tocado: true,
      em,
      incorporada_em: null,
    }) as Correcao;

  const NASCEU = "2026-09-04T00:00:00.000Z";
  const emDias = (base: string, dias: number) =>
    new Date(new Date(base).getTime() + dias * 24 * 60 * 60 * 1000).getTime();

  const doisAgentes = {
    ...indiceVazio(NASCEU),
    correcoes: [c("x", "extracao", NASCEU), c("y", "resolucao", NASCEU)],
  };

  it("abrir a tela de um agente NÃO adia a sugestão do outro", () => {
    // O defeito que a 4.6 tinha com um relógio só: eu olhava a extração e o
    // material da resolução ficava três semanas parado sem nada acender.
    const depois = marcarVisitaDe(doisAgentes, "extracao", "2026-09-25T00:00:00.000Z");
    const agora = emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1);

    expect(sugerirCalibracao(depois, "extracao", agora)).toBe(false);
    expect(sugerirCalibracao(depois, "resolucao", agora)).toBe(true);
  });

  it("a gaveta acende quando ALGUM agente tem o que olhar", () => {
    const depois = marcarVisitaDe(doisAgentes, "extracao", "2026-09-25T00:00:00.000Z");
    expect(sugerirAlgum(depois, emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1))).toBe(true);
  });

  it("correção de `grafo` sozinha nunca acende nada", () => {
    // Era o terceiro defeito da 4.6: `sugerirCalibracao` contava todas as
    // abertas, mas a tela só sabia rascunhar a partir das de `extracao` — uma
    // sessão só de renome acendia "tem o que olhar" e levava a uma tela vazia.
    const so = { ...indiceVazio(NASCEU), correcoes: [c("g", "grafo", NASCEU)] };
    expect(sugerirAlgum(so, emDias(NASCEU, 365))).toBe(false);
  });

  it("índice gravado antes da 7 traz uma string, e ela vale para todos", () => {
    // Leitura conservadora: ela adia a sugestão, nunca a antecipa.
    const velho = { ...doisAgentes, visitado_em: "2026-09-25T00:00:00.000Z" };
    expect(visitaDe(velho, "extracao")).toBe("2026-09-25T00:00:00.000Z");
    expect(visitaDe(velho, "resolucao")).toBe("2026-09-25T00:00:00.000Z");
    expect(sugerirAlgum(velho, emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1))).toBe(false);
  });

  it("marcar a visita de um agente não apaga a do outro", () => {
    const um = marcarVisitaDe(doisAgentes, "extracao", "2026-09-10T00:00:00.000Z");
    const dois = marcarVisitaDe(um, "resolucao", "2026-09-11T00:00:00.000Z");
    expect(visitaDe(dois, "extracao")).toBe("2026-09-10T00:00:00.000Z");
    expect(visitaDe(dois, "resolucao")).toBe("2026-09-11T00:00:00.000Z");
  });

  it("a primeira visita depois da 7 CARREGA a string velha para os outros agentes", () => {
    // Era o buraco: colapsar a string para `{}` antes de gravar a chave nova
    // apagava a visita de todo mundo que não fosse o agente que eu abri — e aí
    // abrir a tela de um **antecipava** a sugestão dos outros, o oposto do que
    // a leitura conservadora promete.
    const velho = { ...doisAgentes, visitado_em: "2026-09-25T00:00:00.000Z" };
    const depois = marcarVisitaDe(velho, "extracao", "2026-09-26T00:00:00.000Z");

    expect(visitaDe(depois, "extracao")).toBe("2026-09-26T00:00:00.000Z");
    expect(visitaDe(depois, "resolucao")).toBe("2026-09-25T00:00:00.000Z");
    // E a sugestão continua adiada para quem eu não abri.
    expect(sugerirCalibracao(depois, "resolucao", emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1))).toBe(
      false,
    );
  });
});

describe("o índice do R2 é mais velho que o tipo (slice 7)", () => {
  /** Como o objeto ficou gravado na 4.6: com `regras_correntes`, sem `padroes`. */
  const daQuatroSeis = {
    correcoes: [],
    regras_correntes: "a3f91c7d",
    visitado_em: "2026-09-25T00:00:00.000Z",
    atualizado_em: "2026-09-25T00:00:00.000Z",
  };

  it("objeto sem `padroes` ganha lista vazia em vez de estourar no primeiro filter", () => {
    // Sem isto, `GET /api/calibracao` devolvia 500 para quem já tivesse
    // corrigido qualquer coisa antes da 7 — e continuava devolvendo, porque
    // `marcarVisita` e `confirmarPadroes` quebram na mesma linha.
    const i = normalizarIndice(daQuatroSeis, "2026-10-01T00:00:00.000Z");
    expect(i.padroes).toEqual([]);
    expect(() => i.padroes.filter((p) => p.agente === "extracao")).not.toThrow();
  });

  it("a string de `visitado_em` passa como está — quem lê conhece as três formas", () => {
    expect(normalizarIndice(daQuatroSeis, "2026-10-01T00:00:00.000Z").visitado_em).toBe(
      "2026-09-25T00:00:00.000Z",
    );
  });

  it("objeto ausente ou lixo vira índice vazio, e não um meio-índice", () => {
    for (const bruto of [null, undefined, "não é objeto", 42]) {
      const i = normalizarIndice(bruto, "2026-10-01T00:00:00.000Z");
      expect(i.correcoes).toEqual([]);
      expect(i.padroes).toEqual([]);
    }
  });

  it("campo com o tipo errado não vence o molde", () => {
    // `{...vazio, ...bruto}` devolveria o `undefined` do objeto velho para o
    // campo que o molde tinha preenchido — o bug que isto existe para não ter.
    const i = normalizarIndice(
      { correcoes: "não é lista", padroes: null, atualizado_em: 7 },
      "2026-10-01T00:00:00.000Z",
    );
    expect(i.correcoes).toEqual([]);
    expect(i.padroes).toEqual([]);
    expect(i.atualizado_em).toBe("2026-10-01T00:00:00.000Z");
  });
});
