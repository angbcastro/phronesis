/**
 * O agente 4 — o que ele lê, o que ele pede ao modelo, e o que ele aceita de
 * volta.
 *
 * O risco desta fatia está declarado na spec e na migration 010: **ninguém
 * revisa antes de gravar**. Por isso o que se testa aqui, antes de qualquer
 * coisa, é o que impede uma resposta ruim de virar ficha — o parser recusando o
 * vazio, o corte do `TETO_RESUMO`, e a entidade sem átomo que nem chega ao
 * modelo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));
vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(async () => null),
  putJson: vi.fn(async () => ({ etag: null })),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

import { generateText } from "ai";
import {
  CAMPOS_DA_FICHA,
  EnriquecimentoError,
  INSTRUCOES,
  PROMPT_VERSION_ENRIQUECIMENTO,
  atomosDaEntidade,
  blocoDeAtomos,
  desfazerFicha,
  enriquecer,
  escreverFicha,
  enfileirar,
  enfileirarCanonicasComNovidade,
  gravarFicha,
  LEASE_MS,
  montarPrompt,
  parsearFicha,
  reivindicarProxima,
  rodarElo,
} from "@/lib/enriquecimento";
import type { AtomoDaEntidade } from "@/lib/enriquecimento";
import { modeloEnriquecimento } from "@/lib/modelos";
import { query } from "@/lib/neo4j";
import { NUNCA_ENRIQUECIDA, TETO_RESUMO } from "@/lib/tipos";

const consulta = vi.mocked(query);
const chamar = vi.mocked(generateText);

const RAPHA = { nome: "Rapha Bertoldo", tipo: "Pessoa" as const, aliases: ["Raffa"] };

const atomo = (extra: Partial<AtomoDaEntidade> = {}): AtomoDaEntidade => ({
  id: "a1",
  texto: "produziu o evento inteiro sozinho",
  tipo: "FATO",
  valido_em: "2026-08-01T00:00:00.000Z",
  sobre: true,
  ...extra,
});

const responder = (texto: string) =>
  chamar.mockResolvedValue({ text: texto, finishReason: "stop" } as never);

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  delete process.env.ENRIQUECIMENTO_MODEL;
  consulta.mockReset();
  consulta.mockResolvedValue([] as never);
  chamar.mockReset();
});

// ───────────────────────── o que ele lê do grafo ─────────────────────────

describe("os átomos que entram", () => {
  it("lê SOBRE e MENCIONA — e não :PERFILA, que é o filtro do agente 2", async () => {
    await atomosDaEntidade("rapha");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("[r:SOBRE|MENCIONA]");
    expect(cypher).not.toContain("PERFILA");
  });

  it("não tem teto: a fatia decidiu reler tudo em vez de acumular", async () => {
    // "Incremental" carregaria para sempre o que uma rodada ruim escreveu.
    await atomosDaEntidade("rapha");
    expect(String(consulta.mock.calls[0][0])).not.toContain("LIMIT");
  });

  it("só átomo ativo, do mais novo para o mais velho", async () => {
    await atomosDaEntidade("rapha");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain("coalesce(a.status, 'ativo') = 'ativo'");
    expect(cypher).toContain("ORDER BY valido_em DESC");
  });

  it("atravessa alias: a ficha de uma grafia fundida lê os átomos do vencedor", async () => {
    await atomosDaEntidade("raffa");
    const cypher = String(consulta.mock.calls[0][0]);
    expect(cypher).toContain(":FUNDIDA_EM");
    expect(cypher).toContain("coalesce(v, e) AS alvo");
    expect(consulta.mock.calls[0][1]).toEqual({ chave: "raffa" });
  });

  it("devolve o id do átomo — o retrato do \"eu\" precisa dele para as fontes (slice 10)", async () => {
    await atomosDaEntidade("rapha");
    expect(String(consulta.mock.calls[0][0])).toContain("RETURN a.id AS id, a.texto AS texto");
  });

  it("entidade sem nome não vai ao banco", async () => {
    expect(await atomosDaEntidade("   ")).toEqual([]);
    expect(consulta).not.toHaveBeenCalled();
  });

  it("átomo sem texto não entra — ele não tem o que dizer da entidade", async () => {
    consulta.mockResolvedValue([
      { texto: "", tipo: "FATO", valido_em: "", sobre: true },
      { texto: "vale", tipo: "FATO", valido_em: "", sobre: false },
    ] as never);
    expect(await atomosDaEntidade("rapha")).toHaveLength(1);
  });
});

// ───────────────────────── o que vai ao modelo ─────────────────────────

describe("o prompt", () => {
  it("o tipo e a data de cada átomo entram — os dois pesam na decisão", () => {
    const bloco = blocoDeAtomos([atomo()]);
    expect(bloco).toBe("- [FATO 2026-08-01] produziu o evento inteiro sozinho");
  });

  it("a menção de passagem é marcada como citada", () => {
    expect(blocoDeAtomos([atomo({ sobre: false })])).toContain("(citada)");
  });

  it("o id não entra no bloco da ficha: o prompt das outras entidades é o de antes (slice 10)", () => {
    // Byte a byte: numerar ou pôr o id aqui mudaria o `enriquecimento-1` sem
    // subir a versão. O retrato tem o bloco dele (`blocoNumerado`).
    const bloco = blocoDeAtomos([atomo({ id: "mv9x0000abcd" }), atomo({ sobre: false })]);
    expect(bloco).toBe(
      "- [FATO 2026-08-01] produziu o evento inteiro sozinho\n" +
        "- [FATO 2026-08-01] (citada) produziu o evento inteiro sozinho",
    );
    expect(montarPrompt(RAPHA, [atomo()])).toBe(
      `${INSTRUCOES}\n\nENTIDADE: Rapha Bertoldo (pessoa)\nTAMBÉM ESCRITA: Raffa\n\n` +
        `TUDO O QUE O DIÁRIO DIZ DELA (1 trecho(s), do mais novo para o mais velho):\n` +
        `- [FATO 2026-08-01] produziu o evento inteiro sozinho`,
    );
  });

  it("átomo sem data não inventa uma", () => {
    expect(blocoDeAtomos([atomo({ valido_em: "" })])).toBe(
      "- [FATO] produziu o evento inteiro sozinho",
    );
  });

  it("leva nome, tipo, grafias e a contagem de trechos", () => {
    const p = montarPrompt(RAPHA, [atomo(), atomo()]);
    expect(p).toContain("ENTIDADE: Rapha Bertoldo (pessoa)");
    expect(p).toContain("TAMBÉM ESCRITA: Raffa");
    expect(p).toContain("(2 trecho(s)");
  });

  it("o prompt do painel vence a base — é o que o /agentes edita", () => {
    expect(montarPrompt(RAPHA, [atomo()], "meu prompt").startsWith("meu prompt")).toBe(true);
  });

  it("a instrução do resumo é identidade, e diz o teto que o parser aplica", () => {
    // Se o resumo só descrever, a segunda passada volta a ser a regra e a fatia
    // não terá servido para nada — é a medida que a spec §5 manda olhar.
    expect(INSTRUCOES).toContain("O QUE A DISTINGUE DE OUTRA PARECIDA");
    expect(INSTRUCOES).toContain(`No máximo ${TETO_RESUMO} caracteres`);
  });

  it("a regra que mais importa está escrita: só o que os trechos sustentam", () => {
    expect(INSTRUCOES).toContain("SÓ AFIRME O QUE OS TRECHOS SUSTENTAM");
    expect(INSTRUCOES).toContain("Ninguém revisa este texto antes de ele ser gravado");
  });
});

// ───────────────────────── o que ele aceita de volta ─────────────────────────

describe("o parser", () => {
  const inteira = `{"resumo":"Produtor de eventos","contexto":"amigo","pode_ajudar_com":"produção","fizemos_juntos":"slackline"}`;

  it("lê os quatro campos de uma vez", () => {
    expect(parsearFicha(inteira)).toEqual({
      resumo: "Produtor de eventos",
      perfil: { contexto: "amigo", pode_ajudar_com: "produção", fizemos_juntos: "slackline" },
    });
  });

  it("tolera cerca de markdown e frase antes do JSON, como os outros agentes", () => {
    expect(parsearFicha("```json\nAqui está: " + inteira + "\n```").resumo).toBe(
      "Produtor de eventos",
    );
  });

  it("campo ausente volta vazio — o prompt diz que vazio é resposta legítima", () => {
    const f = parsearFicha(`{"resumo":"x"}`);
    expect(f.perfil).toEqual({ contexto: "", pode_ajudar_com: "", fizemos_juntos: "" });
  });

  it("corta o resumo em TETO_RESUMO, como gravarResumo faria", () => {
    const longo = `{"resumo":"${"a".repeat(TETO_RESUMO + 200)}","contexto":"x"}`;
    expect(parsearFicha(longo).resumo).toHaveLength(TETO_RESUMO);
  });

  it("os quatro vazios são recusados: gravar isso por cima da ficha seria perda", () => {
    expect(() => parsearFicha(`{"resumo":"","contexto":""}`)).toThrow(EnriquecimentoError);
  });

  it("resposta sem JSON nenhum é erro, e o erro carrega a amostra", () => {
    expect(() => parsearFicha("não consegui")).toThrow(/não consegui/);
  });

  it("campo que não é string não vira texto", () => {
    expect(parsearFicha(`{"resumo":"x","contexto":{"a":1}}`).perfil.contexto).toBe("");
  });
});

// ───────────────────────── a chamada ─────────────────────────

describe("escrever a ficha", () => {
  it("entidade sem átomo nenhum não vai ao modelo", async () => {
    // Pagar uma chamada para não ter o que dizer é desperdício, e sobrescrever
    // a ficha com o vazio seria perda.
    await expect(escreverFicha(RAPHA, [])).rejects.toThrow(EnriquecimentoError);
    expect(chamar).not.toHaveBeenCalled();
  });

  it("devolve a ficha, a contagem de átomos e a procedência (regra 7)", async () => {
    responder(`{"resumo":"Produtor","contexto":"amigo"}`);
    const f = await escreverFicha(RAPHA, [atomo(), atomo()]);
    expect(f.resumo).toBe("Produtor");
    expect(f.atomos).toBe(2);
    expect(f.prompt_version).toBe(PROMPT_VERSION_ENRIQUECIMENTO);
    // Contra `modeloEnriquecimento()`, e não contra um id escrito à mão: o
    // padrão troca por decisão minha (já trocou uma vez), e o que este teste
    // guarda é o carimbo existir e vir de quem faz a chamada — não qual modelo
    // está em cartaz.
    expect(f.modelo).toBe(modeloEnriquecimento());
  });

  it("o modelo sai por string, pelo Gateway (regra 8)", async () => {
    responder(`{"resumo":"x"}`);
    await escreverFicha(RAPHA, [atomo()]);
    expect(typeof (chamar.mock.calls[0][0] as { model: unknown }).model).toBe("string");
  });

  it("ENRIQUECIMENTO_MODEL separa este agente sem tocar em código", async () => {
    process.env.ENRIQUECIMENTO_MODEL = "openai/gpt-5";
    responder(`{"resumo":"x"}`);
    const f = await escreverFicha(RAPHA, [atomo()]);
    expect(f.modelo).toBe("openai/gpt-5");
  });

  it("não manda teto de saída: o raciocínio cresce com a entidade (4.12.1)", async () => {
    responder(`{"resumo":"x"}`);
    await escreverFicha(RAPHA, [atomo()]);
    expect(chamar.mock.calls[0][0]).not.toHaveProperty("maxOutputTokens");
  });

  it("`length` sem teto nosso é erro com diagnóstico, e não uma segunda chamada", async () => {
    // Com `temperature: 0`, repetir seria pagar duas vezes pela mesma falha.
    chamar.mockResolvedValue({
      text: `{"resumo":"cortad`,
      finishReason: "length",
      usage: { outputTokens: 32768 },
    } as never);

    await expect(escreverFicha(RAPHA, [atomo()])).rejects.toThrow(
      /teto de saída do próprio modelo.*finishReason=length.*saida=32768/,
    );
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  it("lê o JSON do pensamento quando o texto veio vazio e o orçamento sobrou", async () => {
    chamar.mockResolvedValue({
      text: "",
      reasoningText: `{"resumo":"do pensamento"}`,
      finishReason: "stop",
    } as never);
    expect((await escreverFicha(RAPHA, [atomo()])).resumo).toBe("do pensamento");
  });

  it("a espera de rate limit não tem prazo: ninguém está esperando na tela", async () => {
    // A fila pode dormir o quanto o Gateway pedir — é a diferença entre este
    // agente e os que rodam dentro da extração de uma janela.
    responder(`{"resumo":"x"}`);
    await escreverFicha(RAPHA, [atomo()]);
    expect((chamar.mock.calls[0][0] as { maxRetries: number }).maxRetries).toBe(0);
  });
});

// ───────────────────── a gravação, e a geração anterior ─────────────────────

describe("gravar a ficha", () => {
  beforeEach(() => consulta.mockResolvedValue([{ id: "e1", nome: "Rapha" }] as never));

  const ficha = {
    resumo: "Produtor",
    perfil: { contexto: "amigo", pode_ajudar_com: "produção", fizemos_juntos: "slackline" },
  };
  const cypher = () => String(consulta.mock.calls[0][0]);

  it("guarda os quatro `_anterior` ANTES de escrever por cima", async () => {
    await gravarFicha("rapha", ficha, 7);
    const c = cypher();
    for (const campo of CAMPOS_DA_FICHA) {
      expect(c).toContain(`alvo.${campo}_anterior = coalesce(alvo.${campo}, '')`);
      expect(c.indexOf(`${campo}_anterior = coalesce`)).toBeLessThan(
        c.indexOf(`alvo.${campo} = $${campo}`),
      );
    }
  });

  it("as escritas são cláusulas SET separadas — a ordem não pode depender de sutileza", async () => {
    // Numa cláusula só, a ordem de avaliação decidiria se existe geração para
    // voltar. É a decisão mais importante da fatia; ela não fica implícita.
    await gravarFicha("rapha", ficha, 1);
    expect(cypher().split("SET ").length - 1).toBe(3);
  });

  it("escreve os quatro campos e o estado da rodada", async () => {
    await gravarFicha("rapha", ficha, 7);
    const p = consulta.mock.calls[0][1] as Record<string, unknown>;
    expect(p).toMatchObject({
      chave: "rapha",
      resumo: "Produtor",
      contexto: "amigo",
      pode_ajudar_com: "produção",
      fizemos_juntos: "slackline",
      atomos: 7,
    });
    expect(cypher()).toContain("alvo.enriquecimento_estado = 'pronta'");
  });

  it("com `semEstado`, grava os campos e o `_anterior` sem tocar no estado (slice 10)", async () => {
    // É a fase 1 da rodada do "eu": marcar `pronta` aqui deixaria uma função
    // morta na fase 2 com o nó dizendo `pronta` e o retrato velho.
    await gravarFicha("eu", ficha, 7, new Date(), { semEstado: true });
    expect(cypher()).toContain("resumo_anterior = coalesce");
    expect(cypher()).not.toContain("enriquecimento_estado");
    expect(cypher().split("SET ").length - 1).toBe(2);
  });

  it("corta o resumo no servidor, como gravarResumo — regra que só vale na tela não é regra", async () => {
    await gravarFicha("rapha", { ...ficha, resumo: "a".repeat(TETO_RESUMO + 50) }, 1);
    const p = consulta.mock.calls[0][1] as { resumo: string };
    expect(p.resumo).toHaveLength(TETO_RESUMO);
  });

  it("atravessa alias: escrever no perdedor de uma fusão vai para o vencedor", async () => {
    await gravarFicha("raffa", ficha, 1);
    expect(cypher()).toContain("coalesce(v, e) AS alvo");
  });

  it("entidade fora do grafo é erro, e não escrita silenciosa", async () => {
    consulta.mockResolvedValue([] as never);
    await expect(gravarFicha("ninguem", ficha, 1)).rejects.toThrow(EnriquecimentoError);
  });
});

describe("o desfazer", () => {
  const cypher = () => String(consulta.mock.calls[0][0]);

  it("é uma TROCA: o `_anterior` vira ficha, e a ficha vira `_anterior`", async () => {
    consulta.mockResolvedValue([{ id: "e1", nome: "Rapha", tinha: true }] as never);
    await desfazerFicha("rapha");
    const c = cypher();
    for (const campo of CAMPOS_DA_FICHA) {
      expect(c).toContain(`alvo.${campo} = velho.${campo}`);
      expect(c).toContain(`alvo.${campo}_anterior = velho.atual_${campo}`);
    }
  });

  it("lê os dois lados antes de escrever — senão a troca vira no-op silencioso", async () => {
    consulta.mockResolvedValue([{ id: "e1", nome: "Rapha", tinha: true }] as never);
    await desfazerFicha("rapha");
    const c = cypher();
    expect(c.indexOf("AS velho")).toBeLessThan(c.indexOf("SET alvo."));
  });

  it("sem geração guardada devolve null, e não apaga a ficha contra quatro vazios", async () => {
    consulta.mockResolvedValue([{ id: "e1", nome: "Rapha", tinha: false }] as never);
    expect(await desfazerFicha("rapha")).toBeNull();
  });

  it("entidade fora do grafo é erro", async () => {
    consulta.mockResolvedValue([] as never);
    await expect(desfazerFicha("ninguem")).rejects.toThrow(EnriquecimentoError);
  });
});

describe("uma entidade do começo ao fim", () => {
  const RAPHA_NO = { ...RAPHA, nome_normalizado: "rapha bertoldo" };

  it("sem átomo nenhum não vai ao modelo — e a ficha fica intocada", async () => {
    // Pagar uma chamada para não ter o que dizer é desperdício; escrever o
    // vazio por cima seria perda.
    consulta.mockResolvedValue([] as never);
    const r = await enriquecer(RAPHA_NO);
    expect(chamar).not.toHaveBeenCalled();
    expect(r).toEqual({ atomos: 0, ficha: null });
    const escritas = consulta.mock.calls.map((c) => String(c[0]));
    expect(escritas.some((c) => c.includes("enriquecimento_estado = $estado"))).toBe(true);
    expect(escritas.some((c) => c.includes("resumo_anterior"))).toBe(false);
  });

  it("com átomos, escreve a ficha e a grava numa rodada só", async () => {
    consulta
      .mockResolvedValueOnce([
        { texto: "produziu o evento", tipo: "FATO", valido_em: "2026-08-01", sobre: true },
      ] as never)
      .mockResolvedValue([{ id: "e1", nome: "Rapha Bertoldo" }] as never);
    responder(`{"resumo":"Produtor","contexto":"amigo"}`);

    const r = await enriquecer(RAPHA_NO);
    expect(r.atomos).toBe(1);
    expect(r.ficha?.resumo).toBe("Produtor");
    expect(String(consulta.mock.calls[1][0])).toContain("resumo_anterior");
  });
});

// ───────────────────────────── a fila ─────────────────────────────

describe("enfileirar", () => {
  const cypher = () => String(consulta.mock.calls[0][0]);

  it("grava `na_fila` antes de qualquer trabalho — é o que faz fechar a aba não interromper", async () => {
    consulta.mockResolvedValue([{ chave: "a" }, { chave: "b" }] as never);
    expect(await enfileirar(["A", "B"])).toBe(2);
    expect(cypher()).toContain("alvo.enriquecimento_estado = 'na_fila'");
  });

  it("normaliza e deduplica: a mesma entidade marcada duas vezes entra uma", async () => {
    consulta.mockResolvedValue([{ chave: "rapha" }] as never);
    await enfileirar(["Rapha", "rapha", "  RAPHA "]);
    expect((consulta.mock.calls[0][1] as { chaves: string[] }).chaves).toEqual(["rapha"]);
  });

  it("atravessa alias e não enfileira nó fundido", async () => {
    consulta.mockResolvedValue([{ chave: "rapha" }] as never);
    await enfileirar(["raffa"]);
    expect(cypher()).toContain("coalesce(v, e) AS alvo");
    expect(cypher()).toContain("coalesce(alvo.status, 'ativa') <> 'fundida'");
  });

  it("lista vazia não vai ao banco", async () => {
    expect(await enfileirar([])).toBe(0);
    expect(consulta).not.toHaveBeenCalled();
  });
});

describe("a seleção da batida semanal (4.12.1)", () => {
  const cypher = () => String(consulta.mock.calls[0][0]);

  it("só canônicas, e nunca nó fundido", async () => {
    await enfileirarCanonicasComNovidade();
    expect(cypher()).toContain("coalesce(e.canonico, false) = true");
    expect(cypher()).toContain("coalesce(e.status, 'ativa') <> 'fundida'");
  });

  it("entra quem nunca rodou ou falhou", async () => {
    await enfileirarCanonicasComNovidade();
    expect(cypher()).toContain("coalesce(e.enriquecimento_estado, '') <> 'pronta'");
  });

  it("entra quem mudou de contagem — átomo novo, rejeitado ou movido por fusão", async () => {
    await enfileirarCanonicasComNovidade();
    expect(cypher()).toMatch(/\(a:Atomo\)-\[:SOBRE\|MENCIONA\]->\(e\)/);
    expect(cypher()).toContain("coalesce(a.status, 'ativo') = 'ativo'");
    expect(cypher()).toContain("ativos <> coalesce(e.enriquecimento_atomos, 0)");
  });

  it("entra quem tem átomo mais novo que a última ficha", async () => {
    await enfileirarCanonicasComNovidade();
    expect(cypher()).toContain("ultimo > coalesce(e.enriquecimento_em, '')");
  });

  it("as três regras são alternativas, e não exigências somadas", async () => {
    await enfileirarCanonicasComNovidade();
    const depois = cypher().slice(cypher().indexOf("WITH e, count"));
    expect(depois.match(/\n\s+OR /g)).toHaveLength(2);
  });

  it("não regrava quem já está na fila ou rodando — nem perde o lugar, nem roda duas vezes", async () => {
    await enfileirarCanonicasComNovidade();
    expect(cypher()).toContain("NOT (coalesce(e.enriquecimento_estado, '') IN ['na_fila', 'rodando'])");
  });

  it("marca `na_fila` com o carimbo, como o botão faz, e conta quem entrou", async () => {
    consulta.mockResolvedValueOnce([{ chave: "eu" }, { chave: "adapta" }] as never);
    const agora = new Date("2026-09-28T07:00:00.000Z");
    expect(await enfileirarCanonicasComNovidade(agora)).toBe(2);
    expect(cypher()).toContain("SET e.enriquecimento_estado = 'na_fila'");
    expect(consulta.mock.calls[0][1]).toEqual({ agora: agora.toISOString() });
  });
});

describe("reivindicar a próxima", () => {
  const AGORA = new Date("2026-09-08T12:00:00.000Z");
  const cypher = () => String(consulta.mock.calls[0][0]);
  const params = () => consulta.mock.calls[0][1] as { agora: string; limite: string };

  it("reivindica UMA, e a escrita é condicional ao estado", async () => {
    consulta.mockResolvedValue([{ chave: "rapha" }] as never);
    expect(await reivindicarProxima(AGORA)).toBe("rapha");
    expect(cypher()).toContain("LIMIT 1");
    expect(cypher()).toContain("e.enriquecimento_estado = 'na_fila'");
    expect(cypher()).toContain("SET e.enriquecimento_estado = 'rodando'");
  });

  it("`rodando` velho volta a ser reivindicável — é a retomada, e ela mora aqui", async () => {
    // Sem isto, a entidade cuja função morreu no meio ficaria travada para
    // sempre, e a fila pararia sem nada no log dizendo por quê.
    consulta.mockResolvedValue([] as never);
    await reivindicarProxima(AGORA);
    expect(cypher()).toContain("e.enriquecimento_estado = 'rodando'");
    expect(params().limite).toBe(new Date(AGORA.getTime() - LEASE_MS).toISOString());
  });

  it("`rodando` fresco não é reivindicado: o limite é o lease, não zero", async () => {
    consulta.mockResolvedValue([] as never);
    await reivindicarProxima(AGORA);
    expect(Date.parse(params().limite)).toBeLessThan(Date.parse(params().agora));
  });

  it("FIFO pelo carimbo: quem esperou mais vai primeiro", async () => {
    consulta.mockResolvedValue([] as never);
    await reivindicarProxima(AGORA);
    expect(cypher()).toMatch(/,\s+coalesce\(e\.enriquecimento_em, ''\) ASC LIMIT 1/);
  });

  it("o \"eu\" vai na frente de todos, antes do carimbo (slice 10)", async () => {
    // A rodada dele não cabe na margem da última ficha: na batida, ele tem de
    // sair na primeira volta, com o orçamento inteiro.
    consulta.mockResolvedValue([] as never);
    await reivindicarProxima(AGORA);
    const c = cypher();
    expect(c).toContain("ORDER BY e.nome_normalizado = 'eu' DESC");
    expect(c.indexOf("= 'eu' DESC")).toBeLessThan(c.indexOf("enriquecimento_em, '') ASC"));
    expect(c).not.toContain("<> 'eu'");
  });

  it("`semEu` tira o \"eu\" da reivindicação — fica para a continuação (slice 10)", async () => {
    consulta.mockResolvedValue([] as never);
    await reivindicarProxima(AGORA, { semEu: true });
    expect(cypher()).toContain("AND e.nome_normalizado <> 'eu'");
  });

  it("fila vazia devolve null, e é isso que para o encadeamento", async () => {
    consulta.mockResolvedValue([] as never);
    expect(await reivindicarProxima(AGORA)).toBeNull();
  });
});

describe("um elo", () => {
  const alvo = {
    id: "e1",
    nome: "Rapha Bertoldo",
    nome_normalizado: "rapha bertoldo",
    chaves: ["rapha bertoldo"],
    tipo: "Pessoa" as const,
    sessoes: 1,
    atomos: 2,
    aliases: [],
    resumo: "",
    canonico: false,
    perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
    enriquecimento: NUNCA_ENRIQUECIDA,
  };

  it("uma entidade que falha vira `falhou` com o motivo, e não derruba a fila", async () => {
    consulta.mockResolvedValueOnce([
      { texto: "produziu o evento", tipo: "FATO", valido_em: "2026-08-01", sobre: true },
    ] as never);
    chamar.mockRejectedValue(new Error("o Gateway recusou") as never);

    expect(await rodarElo("rapha bertoldo", [alvo])).toBeNull();
    const marcada = consulta.mock.calls.find((c) =>
      String(c[0]).includes("enriquecimento_estado = $estado"),
    );
    expect(marcada?.[1]).toMatchObject({ estado: "falhou" });
    expect(String((marcada?.[1] as { motivo: string }).motivo)).toContain("o Gateway recusou");
  });

  it("entidade que sumiu do catálogo entre a reivindicação e a leitura não fica presa", async () => {
    // Deixá-la em `rodando` a faria voltar pela retomada e sumir de novo, para
    // sempre.
    expect(await rodarElo("fantasma", [alvo])).toBeNull();
    expect(chamar).not.toHaveBeenCalled();
    expect(consulta.mock.calls[0][1]).toMatchObject({ estado: "falhou" });
  });
});
