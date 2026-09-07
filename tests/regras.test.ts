/**
 * As regras aprovadas entrando no prompt, e as amarras que impedem isso de
 * estragar uma extração que já presta.
 *
 * O teste mais importante deste arquivo é o primeiro: **sem regra aprovada, o
 * prompt sai byte a byte igual ao de antes desta fatia**. É o que torna a slice
 * 4.6 um no-op até a minha primeira aprovação — e, portanto, incapaz de piorar
 * nada enquanto eu não mandar.
 */
import { describe, expect, it } from "vitest";
import {
  blocoDeRegras,
  montarPrompt,
  PROMPT_VERSION,
  secoesDoPrompt,
  versaoDoPrompt,
} from "@/lib/extracao";
import { hashDeRegras } from "@/lib/regras";
import { parsearRascunho, MAX_REGRAS_POR_RASCUNHO } from "@/lib/calibracao";
import { paraCalibrar, sugerirCalibracao, INTERVALO_SUGESTAO_DIAS, indiceVazio } from "@/lib/correcoes";
import type { AgenteCorrecao, Correcao, Regra } from "@/lib/tipos";

const regra = (texto: string, extra: Partial<Regra> = {}): Regra => ({
  id: "r1",
  texto,
  cita: ["c1", "c2"],
  aprovada_em: "2026-09-04T00:00:00.000Z",
  ...extra,
});

describe("sem regra aprovada, nada muda (critério 4)", () => {
  it("o bloco de regras é string vazia", () => {
    expect(blocoDeRegras([])).toBe("");
  });

  it("as duas metades se emendam sem nada entre elas", () => {
    // A junção exata: fim da última seção do prompt base, linha em branco,
    // cabeçalho FORMATO. Se algo se intrometer aqui, é aqui que aparece.
    expect(montarPrompt("x")).toContain("comentário sobre o material não é.\n\nFORMATO\n");
  });

  it("a versão sai sem sufixo", () => {
    expect(versaoDoPrompt([])).toBe(PROMPT_VERSION);
    expect(versaoDoPrompt([])).toBe("extracao-8");
  });
});

describe("com regra aprovada", () => {
  it("o bloco entra entre o prompt base e o FORMATO", () => {
    const p = montarPrompt("x", [regra("Nunca corte a conclusão do átomo.")]);
    const posRegra = p.indexOf("Nunca corte a conclusão do átomo.");
    const posFormato = p.indexOf("FORMATO\nResponda somente com JSON");

    expect(posRegra).toBeGreaterThan(p.indexOf("NÃO COMENTE A TRANSCRIÇÃO"));
    expect(posRegra).toBeLessThan(posFormato);
  });

  it("a regra que substitui uma seção diz qual, dentro do prompt", () => {
    const p = montarPrompt("x", [regra("Use OPINIAO quando eu avalio alguém.", { substitui: "OS CAMPOS" })]);
    expect(p).toContain("(isto substitui a seção OS CAMPOS)");
  });

  it("a versão ganha o sufixo do hash das regras usadas", () => {
    const v = versaoDoPrompt([regra("qualquer coisa")]);
    expect(v).toMatch(/^extracao-8\+[0-9a-f]{8}$/);
  });

  it("o hash sai do conteúdo, não da identidade do rascunho", () => {
    // Duas aprovações do mesmo texto têm de dar no mesmo prompt — senão o
    // snapshot imutável viraria uma versão nova a cada toque em aprovar.
    const a = hashDeRegras([regra("mesma coisa", { id: "r-aaa" })]);
    const b = hashDeRegras([regra("mesma coisa", { id: "r-bbb" })]);
    expect(a).toBe(b);
  });

  it("texto diferente é hash diferente", () => {
    expect(hashDeRegras([regra("uma coisa")])).not.toBe(hashDeRegras([regra("outra coisa")]));
  });

  it("a ordem das regras conta — é a ordem em que elas entram no prompt", () => {
    const um = [regra("a", { id: "1" }), regra("b", { id: "2" })];
    const outro = [regra("b", { id: "2" }), regra("a", { id: "1" })];
    expect(hashDeRegras(um)).not.toBe(hashDeRegras(outro));
  });
});

describe("as seções do prompt, lidas do próprio prompt", () => {
  it("acha os cabeçalhos, e só eles", () => {
    const secoes = secoesDoPrompt();
    expect(secoes).toContain("NOME DE ENTIDADE É NOME");
    expect(secoes).toContain("NÃO COMENTE A TRANSCRIÇÃO");
    expect(secoes).toContain("OS CAMPOS");
    // A seção da 007 tem acento no cabeçalho, e o `calibracao-1` precisa poder
    // citá-la: é ela que uma regra sobre volume de história contradiria.
    expect(secoes).toContain("A HISTÓRIA GUARDA O DETALHE");
    // Linha de conteúdo, ainda que comece com maiúscula, não é seção.
    expect(secoes.some((s) => s.includes("FATO        aconteceu"))).toBe(false);
  });
});

describe("as amarras do calibracao-1 valem no parser, não só no prompt", () => {
  const ids = new Set(["c1", "c2", "c3"]);
  const secoes = ["OS CAMPOS", "ENTIDADES"];

  const parsear = (bruto: string) => parsearRascunho(bruto, ids, secoes);

  it("regra tirada de uma correção só é descartada — um caso não é padrão", () => {
    const r = parsear(JSON.stringify({ regras: [{ texto: "faça isso", cita: ["c1"] }] }));
    expect(r).toEqual([]);
  });

  it("regra sem citação nenhuma não existe", () => {
    expect(parsear(JSON.stringify({ regras: [{ texto: "faça isso" }] }))).toEqual([]);
  });

  it("id que o modelo inventou não conta como citação", () => {
    // Contaria, e `incorporada_em` fecharia uma correção que a regra não leu.
    const r = parsear(JSON.stringify({ regras: [{ texto: "x", cita: ["c1", "inventado"] }] }));
    expect(r).toEqual([]);
  });

  it("citação repetida não vira duas", () => {
    const r = parsear(JSON.stringify({ regras: [{ texto: "x", cita: ["c1", "c1"] }] }));
    expect(r).toEqual([]);
  });

  it("mais de duas regras: só as duas primeiras passam", () => {
    const tres = [1, 2, 3].map((n) => ({ texto: `regra ${n}`, cita: ["c1", "c2"] }));
    expect(parsear(JSON.stringify({ regras: tres }))).toHaveLength(MAX_REGRAS_POR_RASCUNHO);
  });

  it("seção inventada não vira substitui — apontaria para nada no prompt", () => {
    const r = parsear(
      JSON.stringify({ regras: [{ texto: "x", cita: ["c1", "c2"], substitui: "SEÇÃO QUE NÃO EXISTE" }] }),
    );
    expect(r[0].substitui).toBeUndefined();
  });

  it("seção de verdade sobrevive", () => {
    const r = parsear(
      JSON.stringify({ regras: [{ texto: "x", cita: ["c1", "c2"], substitui: "OS CAMPOS" }] }),
    );
    expect(r[0].substitui).toBe("OS CAMPOS");
  });

  it("cada regra ganha um id próprio, que é o que sobrevive à minha edição", () => {
    const duas = [1, 2].map((n) => ({ texto: `regra ${n}`, cita: ["c1", "c2"] }));
    const r = parsear(JSON.stringify({ regras: duas }));
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
  });

  it("resposta sem JSON nenhum é lista vazia, não um erro", () => {
    expect(parsear("desculpe, não consegui")).toEqual([]);
    expect(parsear("")).toEqual([]);
  });

  it("cerca de markdown não atrapalha, como nos outros agentes", () => {
    const r = parsear('```json\n{"regras":[{"texto":"x","cita":["c1","c2"]}]}\n```');
    expect(r).toHaveLength(1);
  });

  it("lista vazia é resposta legítima", () => {
    expect(parsear(JSON.stringify({ regras: [] }))).toEqual([]);
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
    expect(sugerirCalibracao(i, emDias(NASCEU, 365))).toBe(false);
  });

  it("índice vazio nunca sugere", () => {
    expect(sugerirCalibracao(indiceVazio(NASCEU), emDias(NASCEU, 365))).toBe(false);
  });

  it("correção em aberto há mais de 3 semanas, sem visita, acende (critério 8)", () => {
    const i = { ...indiceVazio(NASCEU), correcoes: [correcao(NASCEU)] };
    expect(sugerirCalibracao(i, emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1))).toBe(true);
  });

  it("antes das 3 semanas, não acende", () => {
    const i = { ...indiceVazio(NASCEU), correcoes: [correcao(NASCEU)] };
    expect(sugerirCalibracao(i, emDias(NASCEU, INTERVALO_SUGESTAO_DIAS - 1))).toBe(false);
  });

  it("a contagem parte da correção em aberto MAIS ANTIGA, não da mais nova", () => {
    const i = {
      ...indiceVazio(NASCEU),
      correcoes: [correcao("2026-09-25T00:00:00.000Z"), correcao(NASCEU)],
    };
    expect(sugerirCalibracao(i, emDias(NASCEU, INTERVALO_SUGESTAO_DIAS + 1))).toBe(true);
  });

  it("ter aberto a tela apaga a sugestão por mais 3 semanas (critério 9)", () => {
    // Aprovando regra ou não: olhar já conta.
    const visita = "2026-09-24T00:00:00.000Z";
    const i = { ...indiceVazio(NASCEU), correcoes: [correcao(NASCEU)], visitado_em: visita };
    expect(sugerirCalibracao(i, emDias(visita, 1))).toBe(false);
    expect(sugerirCalibracao(i, emDias(visita, INTERVALO_SUGESTAO_DIAS + 1))).toBe(true);
  });
});

describe("o recorte que o calibracao-1 lê", () => {
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

  it("só as em aberto e só as do extrator — calibra um agente de cada vez", () => {
    const i = {
      ...indiceVazio("2026-09-04T00:00:00.000Z"),
      correcoes: [
        c("aberta-extracao", "extracao"),
        c("fechada-extracao", "extracao", "a3f91c7d"),
        c("aberta-resolucao", "resolucao"),
        c("aberta-grafo", "grafo"),
      ],
    };
    expect(paraCalibrar(i).map((x) => x.id)).toEqual(["aberta-extracao"]);
  });
});
