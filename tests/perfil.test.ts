/**
 * Os três campos de perfil, e o agente 3 que os rascunha.
 *
 * O risco que estes testes guardam está declarado na slice 4 §6: **o perfil é
 * exatamente o que o agente 2 lê para desambiguar.** Perfil escrito errado
 * contamina toda atribuição futura, e o erro se realimenta. Por isso o que se
 * testa aqui, antes de qualquer coisa, é que o rascunho **não escreve**.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/neo4j", () => ({ query: vi.fn(async () => []) }));

import { generateText } from "ai";
import {
  PROMPT_VERSION_PERFIL,
  PerfilError,
  atomosMarcados,
  extrairTexto,
  gravarCampo,
  normalizarCampo,
  rascunhar,
} from "@/lib/perfil";
import { query } from "@/lib/neo4j";

const consulta = vi.mocked(query);
const chamar = vi.mocked(generateText);
const cypher = () => String(consulta.mock.calls[0][0]);
const params = () => consulta.mock.calls[0][1] as Record<string, unknown>;

const marcados = [{ texto: "O Rapha produziu o evento inteiro", tipo: "FATO", valido_em: "2026-08-01" }];

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  consulta.mockReset();
  consulta.mockResolvedValue([{ id: "e1", nome: "Rapha" }] as never);
  chamar.mockReset();
});

describe("qual campo é", () => {
  it("aceita os três do schema, em qualquer caixa", () => {
    expect(normalizarCampo("CONTEXTO")).toBe("contexto");
    expect(normalizarCampo(" pode_ajudar_com ")).toBe("pode_ajudar_com");
    expect(normalizarCampo("fizemos_juntos")).toBe("fizemos_juntos");
  });

  it("recusa o que não está na migration 005", () => {
    expect(normalizarCampo("cor_favorita")).toBeNull();
    expect(normalizarCampo(42)).toBeNull();
  });
});

describe("gravar um campo", () => {
  it("o nome do campo é literal, nunca parâmetro — Neo4j não aceita", async () => {
    await gravarCampo("rapha", "fizemos_juntos", "slackline no parque");
    expect(cypher()).toContain("SET alvo.fizemos_juntos = $texto");
  });

  it("atravessa alias: gravar numa grafia fundida vai para o vencedor", async () => {
    // Senão o texto ficaria num nó que nenhuma leitura enxerga.
    await gravarCampo("exx med", "contexto", "cliente");
    expect(cypher()).toContain("OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)");
    expect(cypher()).toContain("coalesce(v, e) AS alvo");
  });

  /**
   * O `TETO_PERFIL = 300` morreu na 4.11. Ele existia porque os três campos de
   * TODAS as entidades entravam no prompt do agente 2 a cada resolução; esse
   * consumo saiu do caminho comum, e os campos só aparecem agora na segunda
   * passada, para os candidatos de uma menção em dúvida.
   */
  it("não corta mais: o teto de 300 saiu com o consumo que o justificava", async () => {
    const longo = "x".repeat(900);
    const { texto } = await gravarCampo("rapha", "contexto", longo);
    expect(texto).toBe(longo);
    expect(String(params().texto)).toHaveLength(900);
  });

  it("texto vazio limpa o campo — apagar o que escrevi errado é legítimo", async () => {
    const { texto } = await gravarCampo("rapha", "contexto", "   ");
    expect(texto).toBe("");
  });

  it("entidade que não existe estoura com o nome dela", async () => {
    consulta.mockResolvedValue([] as never);
    await expect(gravarCampo("ninguem", "contexto", "x")).rejects.toThrow(/não está no grafo/);
  });

  it("sem entidade não vai ao banco", async () => {
    await expect(gravarCampo("  ", "contexto", "x")).rejects.toBeInstanceOf(PerfilError);
    expect(consulta).not.toHaveBeenCalled();
  });
});

describe("os átomos que marcaram o campo", () => {
  it("procura pela aresta com o campo, não por todas as arestas", async () => {
    await atomosMarcados("rapha", "pode_ajudar_com");
    expect(cypher()).toContain("[p:PERFILA { campo: $campo }]");
    expect(params().campo).toBe("pode_ajudar_com");
  });

  it("ignora átomo rejeitado ou arquivado (deleção é soft, regra 6)", async () => {
    await atomosMarcados("rapha", "contexto");
    expect(cypher()).toContain("coalesce(a.status, 'ativo') = 'ativo'");
  });

  it("campo inválido não vai ao banco", async () => {
    expect(await atomosMarcados("rapha", "cor" as never)).toEqual([]);
    expect(consulta).not.toHaveBeenCalled();
  });
});

describe("o agente 3 propõe, e só", () => {
  it("não escreve nada no grafo (critério 7)", async () => {
    chamar.mockResolvedValue({ text: '{"texto":"produz eventos"}' } as never);
    await rascunhar("Rapha", "pode_ajudar_com", "", marcados);
    expect(consulta).not.toHaveBeenCalled();
  });

  it("devolve o texto com a procedência do prompt (regra 7)", async () => {
    chamar.mockResolvedValue({ text: '{"texto":"produz eventos"}' } as never);
    const r = await rascunhar("Rapha", "pode_ajudar_com", "", marcados);
    expect(r).toMatchObject({
      texto: "produz eventos",
      atomos: 1,
      prompt_version: PROMPT_VERSION_PERFIL,
    });
  });

  it("o texto atual vai no prompt, para ser preservado e não substituído", async () => {
    // O campo é escrito à mão por mim; o agente acrescenta, não julga por cima.
    chamar.mockResolvedValue({ text: '{"texto":"x"}' } as never);
    await rascunhar("Rapha", "contexto", "sócio no evento", marcados);
    const prompt = String((chamar.mock.calls[0][0] as { prompt: string }).prompt);
    expect(prompt).toContain("sócio no evento");
    expect(prompt).toContain("O Rapha produziu o evento inteiro");
  });

  it("não corta o que propõe — quem pede concisão é o prompt, não o código", async () => {
    // O `slice()` daqui saiu com o `TETO_PERFIL` na 4.11. O "no máximo 300
    // caracteres" continua no texto do prompt, agora como número literal: ele
    // nunca foi o corte, é instrução de concisão, e é texto calibrado.
    chamar.mockResolvedValue({ text: JSON.stringify({ texto: "y".repeat(900) }) } as never);
    const r = await rascunhar("Rapha", "contexto", "", marcados);
    expect(r.texto).toHaveLength(900);
  });

  it("sem átomo marcado não há o que rascunhar, e ninguém é chamado", async () => {
    await expect(rascunhar("Rapha", "contexto", "", [])).rejects.toThrow(/nenhum átomo marcou/);
    expect(chamar).not.toHaveBeenCalled();
  });
});

describe("a resposta do agente 3", () => {
  it("lê o JSON que o prompt pediu", () => {
    expect(extrairTexto('{"texto":"amigo, mora comigo"}')).toBe("amigo, mora comigo");
  });

  it("aceita cerca de markdown em volta", () => {
    expect(extrairTexto('```json\n{"texto":"colega"}\n```')).toBe("colega");
  });

  it("texto solto, sem envelope, ainda serve — quem julga sou eu na tela", () => {
    expect(extrairTexto("colega de trabalho")).toBe("colega de trabalho");
  });

  it("resposta vazia é erro, não campo apagado em silêncio", () => {
    expect(() => extrairTexto("   ")).toThrow(PerfilError);
  });
});
