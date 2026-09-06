/**
 * A janela (slice 4.8): o que decide quando uma fatia da sessão pode ser
 * extraída, quem tem direito de extraí-la, e como o que ela produziu se soma ao
 * que já estava lá.
 *
 * Três invariantes justificam este arquivo, e nenhuma delas aparece na tela:
 *
 *   1. **O id do átomo nunca se repete nem se renumera.** Ele é
 *      `<sessao_id>-<índice>` e é o que faz o `MERGE` do confirmar ser
 *      idempotente (regra 4). Uma janela que numerasse a partir do zero
 *      sobrescreveria os átomos da anterior no grafo, e só na hora de confirmar.
 *   2. **A janela só é extraída uma vez.** Dois `waitUntil` chegam ao mesmo
 *      bloco; sem o lease, os dois pagam a mesma chamada.
 *   3. **O `estende` não pode corromper a lista.** É o único caminho por onde
 *      uma resposta de modelo escreve sobre um átomo que já existe.
 */
import { describe, expect, it } from "vitest";
import {
  LEASE_MS,
  aplicarJanela,
  estadoDaJanela,
  indicesDa,
  janelasDe,
  marcarFalha,
  montarExtracao,
  parcialVazio,
  reivindicar,
  todasProntas,
} from "@/lib/janela";
import type { ResultadoDaJanela } from "@/lib/extracao";
import { JANELA_BLOCOS } from "@/lib/tipos";
import type {
  AtomoProposto,
  Janela,
  Manifest,
  Parcial,
  ReferenciaResolvida,
  Transcricao,
} from "@/lib/tipos";

const AGORA = new Date("2026-09-05T12:00:00.000Z");
const depois = (ms: number) => new Date(AGORA.getTime() + ms);

/** Um manifest com `total` blocos, os `transcritos` primeiros já transcritos. */
function manifest(total: number, transcritos = total, buraco?: number): Manifest {
  return {
    sessao_id: "s1",
    chunks: Array.from({ length: total }, (_, i) => ({
      i,
      bytes: 100,
      subido_em: AGORA.toISOString(),
      transcrito: i !== buraco && i < transcritos,
    })),
    finalizado: false,
  };
}

const ref = (nome: string, conhecida = false): ReferenciaResolvida => ({
  citado: nome,
  entidade: nome,
  conhecida,
  certo: true,
  alternativas: [],
  motivo: "",
  porque: [],
});

const atomo = (n: number, texto: string, sobre = "eu"): AtomoProposto => ({
  id: `s1-${n}`,
  indice: n,
  texto,
  tipo: "FATO",
  sobre: ref(sobre),
  menciona: [],
  perfila: [],
  trechos: [{ texto, inicio_s: n, fim_s: n + 1, ancora: "exata" }],
  prompt_version: "extracao-7",
  modelo: "zai/glm-5.3-flash",
});

/** Um resultado de janela: por padrão, um átomo novo e mais nada. */
function resultado(parcial: Partial<ResultadoDaJanela> = {}): ResultadoDaJanela {
  return {
    novos: [],
    estende: [],
    entidades: [],
    descartados: [],
    prompt_version: "extracao-7",
    modelo: "zai/glm-5.3-flash",
    prompt_version_resolucao: null,
    modelo_resolucao: null,
    catalogo: [],
    candidatas: [],
    ...parcial,
  };
}

const j = (n: number, de: number, ate: number): Janela => ({ n, de, ate });

describe("o fatiamento em janelas", () => {
  it("a janela é de 4 blocos — 2 minutos de fala", () => {
    expect(JANELA_BLOCOS).toBe(4);
  });

  it("sem bloco transcrito não há janela nenhuma", () => {
    expect(janelasDe(manifest(4, 0))).toEqual([]);
    expect(janelasDe(manifest(4, 0), { fechando: true })).toEqual([]);
  });

  it("durante a gravação, só janela cheia fecha", () => {
    expect(janelasDe(manifest(3))).toEqual([]);
    expect(janelasDe(manifest(4))).toEqual([j(0, 0, 3)]);
    expect(janelasDe(manifest(7))).toEqual([j(0, 0, 3)]);
    expect(janelasDe(manifest(8))).toEqual([j(0, 0, 3), j(1, 4, 7)]);
  });

  it("`fechando` acrescenta a janela do fim — e só ela pode ser curta", () => {
    expect(janelasDe(manifest(6), { fechando: true })).toEqual([j(0, 0, 3), j(1, 4, 5)]);
  });

  it("`fechando` não inventa janela vazia quando a conta fecha redonda", () => {
    expect(janelasDe(manifest(8), { fechando: true })).toEqual([j(0, 0, 3), j(1, 4, 7)]);
  });

  it("arquivo importado é um bloco só, e vira uma janela só", () => {
    // O caminho pelo qual a sessão importada continua saindo como sempre saiu:
    // uma janela que é a sessão inteira, sem acumulado, prompt sem bloco de
    // janela nenhum.
    expect(janelasDe(manifest(1), { fechando: true })).toEqual([j(0, 0, 0)]);
  });

  it("gravação curta demais para fechar janela sai inteira no finalizar", () => {
    expect(janelasDe(manifest(2))).toEqual([]);
    expect(janelasDe(manifest(2), { fechando: true })).toEqual([j(0, 0, 1)]);
  });

  it("buraco no meio corta o prefixo — janela não lê fala fora de ordem", () => {
    // Blocos 0,1,2,4,5 transcritos e o 3 ainda no STT: a janela 0 não fechou.
    // Fechá-la com o 4 no lugar do 3 seria montar o texto na ordem errada.
    const m = manifest(6, 6, 3);
    expect(janelasDe(m)).toEqual([]);
    expect(janelasDe(m, { fechando: true })).toEqual([j(0, 0, 2)]);
  });

  it("os índices de uma janela são o intervalo fechado", () => {
    expect(indicesDa(j(1, 4, 7))).toEqual([4, 5, 6, 7]);
    expect(indicesDa(j(0, 0, 0))).toEqual([0]);
  });
});

describe("o lease: quem tem direito de extrair a janela", () => {
  const livre = parcialVazio("s1");

  it("janela livre é reivindicada, e fica em curso", () => {
    const p = reivindicar(livre, j(0, 0, 3), AGORA);
    expect(estadoDaJanela(p!, 0)).toMatchObject({ estado: "em_curso", de: 0, ate: 3 });
  });

  it("janela já pronta não é reivindicada — nem depois de um ano", () => {
    const pronta = aplicarJanela(livre, j(0, 0, 3), resultado(), AGORA);
    expect(reivindicar(pronta, j(0, 0, 3), depois(LEASE_MS * 1000))).toBeNull();
  });

  it("janela em curso há pouco é de quem a pegou", () => {
    const meu = reivindicar(livre, j(0, 0, 3), AGORA)!;
    expect(reivindicar(meu, j(0, 0, 3), depois(LEASE_MS - 1))).toBeNull();
  });

  it("lease vencido volta ao mercado — o worker que a pegou morreu", () => {
    const meu = reivindicar(livre, j(0, 0, 3), AGORA)!;
    const outro = reivindicar(meu, j(0, 0, 3), depois(LEASE_MS + 1));
    expect(outro).not.toBeNull();
    expect(estadoDaJanela(outro!, 0)?.em).toBe(depois(LEASE_MS + 1).toISOString());
  });

  it("janela que falhou é retentada na hora, sem esperar o lease", () => {
    const falhou = marcarFalha(livre, j(0, 0, 3), "o modelo não devolveu JSON", AGORA);
    expect(estadoDaJanela(falhou, 0)).toMatchObject({ estado: "falhou", motivo: /JSON/ as never });
    expect(reivindicar(falhou, j(0, 0, 3), depois(1))).not.toBeNull();
  });

  it("carimbo de tempo corrompido reivindica em vez de travar para sempre", () => {
    // Janela extraída duas vezes custa uma chamada; janela travada custa a
    // sessão. O erro cai para o lado barato.
    const torto: Parcial = {
      ...livre,
      janelas: [{ ...j(0, 0, 3), estado: "em_curso", em: "não é data" }],
    };
    expect(reivindicar(torto, j(0, 0, 3), AGORA)).not.toBeNull();
  });

  it("reivindicar não mexe na janela do vizinho", () => {
    const p0 = reivindicar(livre, j(0, 0, 3), AGORA)!;
    const p1 = reivindicar(p0, j(1, 4, 7), AGORA)!;
    expect(p1.janelas.map((x) => x.n)).toEqual([0, 1]);
  });
});

describe("somar a janela ao acumulado", () => {
  it("os ids continuam de onde a janela anterior parou", () => {
    // A invariante mais cara deste arquivo: id repetido só apareceria no
    // confirmar, sobrescrevendo átomo no grafo.
    const p0 = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({ novos: [atomo(0, "primeiro"), atomo(1, "segundo")] }),
      AGORA,
    );
    const p1 = aplicarJanela(
      p0,
      j(1, 4, 7),
      // A extração numerou a partir do deslocamento que leu; o que vale é o
      // carimbo daqui, contra a lista que está sendo gravada.
      resultado({ novos: [atomo(0, "terceiro")] }),
      AGORA,
    );

    expect(p1.atomos.map((a) => a.id)).toEqual(["s1-0", "s1-1", "s1-2"]);
    expect(p1.atomos.map((a) => a.indice)).toEqual([0, 1, 2]);
    expect(p1.atomos.map((a) => a.texto)).toEqual(["primeiro", "segundo", "terceiro"]);
  });

  it("a janela fica pronta, com a procedência do que a produziu", () => {
    const p = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({ prompt_version: "extracao-7+a1b2c3d4", modelo: "zai/glm-5.3-flash" }),
      AGORA,
    );
    expect(estadoDaJanela(p, 0)).toMatchObject({
      estado: "pronta",
      prompt_version: "extracao-7+a1b2c3d4",
      modelo: "zai/glm-5.3-flash",
    });
  });

  it("`estende` engorda o átomo certo: texto novo, trechos somados", () => {
    // É o mecanismo que segura o volume da lista sem passada de costura no fim.
    const p0 = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({ novos: [atomo(0, "acordei cedo"), atomo(1, "o contrato atrasou")] }),
      AGORA,
    );
    const p1 = aplicarJanela(
      p0,
      j(1, 4, 7),
      resultado({
        estende: [
          {
            ref: 0,
            texto: "acordei cedo, pedalei e fui à sauna",
            trechos: [{ texto: "fui na sauna", inicio_s: 150, fim_s: 152, ancora: "exata" }],
          },
        ],
      }),
      AGORA,
    );

    expect(p1.atomos).toHaveLength(2);
    expect(p1.atomos[0].texto).toBe("acordei cedo, pedalei e fui à sauna");
    expect(p1.atomos[0].trechos.map((t) => t.texto)).toEqual(["acordei cedo", "fui na sauna"]);
    // O id e o vizinho ficam onde estavam.
    expect(p1.atomos[0].id).toBe("s1-0");
    expect(p1.atomos[1].texto).toBe("o contrato atrasou");
  });

  it("`estende` sem texto novo só acrescenta o trecho", () => {
    const p0 = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({ novos: [atomo(0, "acordei cedo")] }),
      AGORA,
    );
    const p1 = aplicarJanela(
      p0,
      j(1, 4, 7),
      resultado({
        estende: [
          { ref: 0, texto: "  ", trechos: [{ texto: "e a sauna", inicio_s: 9, fim_s: 10, ancora: "exata" }] },
        ],
      }),
      AGORA,
    );
    expect(p1.atomos[0].texto).toBe("acordei cedo");
    expect(p1.atomos[0].trechos).toHaveLength(2);
  });

  it("`estende` que aponta para fora da lista vira descarte, não corrupção", () => {
    const p = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({
        novos: [atomo(0, "único")],
        estende: [{ ref: 7, texto: "não existe", trechos: [] }],
      }),
      AGORA,
    );
    expect(p.atomos).toHaveLength(1);
    expect(p.atomos[0].texto).toBe("único");
    expect(p.descartados).toHaveLength(1);
    expect(p.descartados[0].motivo).toContain("7");
  });

  it("`estende` alcança átomo desta mesma janela? não: só o que já estava lá", () => {
    // A extensão é aplicada contra a lista que o prompt mostrou. Os átomos
    // novos vão para o fim dela, e um `ref` que só existiria depois deles é
    // exatamente o `ref` fora da faixa de cima.
    const p = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({ novos: [atomo(0, "novo")], estende: [{ ref: 0, texto: "?", trechos: [] }] }),
      AGORA,
    );
    expect(p.atomos[0].texto).toBe("novo");
    expect(p.descartados).toHaveLength(1);
  });

  it("descartados e dicas de entidade se somam janela a janela", () => {
    const p0 = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({
        entidades: [{ nome: "Exxmed", tipo: "PROJETO" }],
        descartados: [{ motivo: "texto vazio", bruto: {} }],
      }),
      AGORA,
    );
    const p1 = aplicarJanela(
      p0,
      j(1, 4, 7),
      resultado({
        entidades: [{ nome: "Rafa", tipo: "PESSOA" }],
        descartados: [{ motivo: "sem sujeito", bruto: {} }],
      }),
      AGORA,
    );
    expect(p1.entidades.map((e) => e.nome)).toEqual(["Exxmed", "Rafa"]);
    expect(p1.descartados).toHaveLength(2);
  });

  it("janela silenciosa fecha do mesmo jeito — silêncio não é falha", () => {
    const p = aplicarJanela(parcialVazio("s1"), j(0, 0, 3), resultado({ modelo: "" }), AGORA);
    expect(estadoDaJanela(p, 0)?.estado).toBe("pronta");
    expect(p.atomos).toEqual([]);
  });
});

describe("todas as janelas fecharam?", () => {
  const janelas = [j(0, 0, 3), j(1, 4, 5)];

  it("lista de janelas vazia não conta como pronta", () => {
    // Manifest vazio não é sessão extraída: quem responde por ela é o passe único.
    expect(todasProntas(parcialVazio("s1"), [])).toBe(false);
  });

  it("falta uma, não está pronta", () => {
    const p = aplicarJanela(parcialVazio("s1"), j(0, 0, 3), resultado(), AGORA);
    expect(todasProntas(p, janelas)).toBe(false);
  });

  it("janela que falhou não conta como pronta", () => {
    let p = aplicarJanela(parcialVazio("s1"), j(0, 0, 3), resultado(), AGORA);
    p = marcarFalha(p, j(1, 4, 5), "rate limit", AGORA);
    expect(todasProntas(p, janelas)).toBe(false);
  });

  it("todas prontas", () => {
    let p = aplicarJanela(parcialVazio("s1"), j(0, 0, 3), resultado(), AGORA);
    p = aplicarJanela(p, j(1, 4, 5), resultado(), AGORA);
    expect(todasProntas(p, janelas)).toBe(true);
  });
});

describe("do acumulado para a proposta", () => {
  const transcricao: Transcricao = {
    sessao_id: "s1",
    texto: "…",
    palavras: [],
    blocos: [],
    modelo: "xai/grok-stt",
    granularidade: "palavra",
  };

  const comAtomos = () => {
    let p = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({
        novos: [atomo(0, "primeiro", "Exxmed"), atomo(1, "segundo", "Exxmed")],
        entidades: [{ nome: "Exxmed", tipo: "PROJETO" }],
      }),
      AGORA,
    );
    p = aplicarJanela(
      p,
      j(1, 4, 7),
      resultado({
        novos: [atomo(0, "terceiro", "Rafa")],
        modelo: "zai/glm-5.3-flash",
        prompt_version_resolucao: "resolucao-2",
        modelo_resolucao: "zai/glm-5.3-flash",
      }),
      AGORA,
    );
    return p;
  };

  it("a lista acumulada é a proposta, na ordem em que nasceu", () => {
    const e = montarExtracao(comAtomos(), transcricao, []);
    expect(e.atomos.map((a) => a.texto)).toEqual(["primeiro", "segundo", "terceiro"]);
    expect(e.sessao_id).toBe("s1");
    expect(e.granularidade).toBe("palavra");
  });

  it("as candidatas saem das referências de todas as janelas, contadas juntas", () => {
    const e = montarExtracao(comAtomos(), transcricao, []);
    const exxmed = e.entidades.find((x) => x.nome === "Exxmed");
    expect(exxmed?.ocorrencias).toBe(2);
    expect(exxmed?.tipo).toBe("Projeto");
    expect(e.entidades.map((x) => x.nome).sort()).toEqual(["Exxmed", "Rafa"]);
  });

  it("o cabeçalho leva a procedência da última janela que chamou um modelo", () => {
    const e = montarExtracao(comAtomos(), transcricao, []);
    expect(e.prompt_version).toBe("extracao-7");
    expect(e.modelo).toBe("zai/glm-5.3-flash");
    expect(e.prompt_version_resolucao).toBe("resolucao-2");
  });

  it("sessão sem menção ambígua não carimba resolução nenhuma", () => {
    // Critério 5 da slice 4, vivo por janela: registrar uma versão que não
    // rodou seria mentira gravada na proposta.
    const p = aplicarJanela(parcialVazio("s1"), j(0, 0, 3), resultado(), AGORA);
    const e = montarExtracao(p, transcricao, []);
    expect(e.prompt_version_resolucao).toBeNull();
    expect(e.modelo_resolucao).toBeNull();
  });

  it("janela silenciosa não apaga a procedência da que falou", () => {
    let p = aplicarJanela(
      parcialVazio("s1"),
      j(0, 0, 3),
      resultado({ novos: [atomo(0, "algo")], modelo: "zai/glm-5.3-flash" }),
      AGORA,
    );
    p = aplicarJanela(p, j(1, 4, 5), resultado({ modelo: "" }), AGORA);
    expect(montarExtracao(p, transcricao, []).modelo).toBe("zai/glm-5.3-flash");
  });
});
