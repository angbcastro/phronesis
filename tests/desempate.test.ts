/**
 * A segunda passada (slice 4.11).
 *
 * O que importa testar aqui é o que ela **vê** e o que ela faz quando o modelo
 * não coopera. A qualidade da decisão eu avalio à mão, na revisão, sessão real
 * por sessão real — como toda avaliação de qualidade deste projeto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));

import { generateText } from "ai";
import {
  INSTRUCOES,
  PROMPT_VERSION_DESEMPATE,
  desempatar,
  montarPrompt,
  parsearResposta,
} from "@/lib/desempate";
import type { MencaoEmDuvida } from "@/lib/desempate";
import { NUNCA_ENRIQUECIDA } from "@/lib/tipos";
import type { EntidadeDoGrafo } from "@/lib/entidades";
import { normalizarNome } from "@/lib/texto";

const chamar = vi.mocked(generateText);

const responder = (corpo: unknown) =>
  chamar.mockResolvedValue({
    text: JSON.stringify(corpo),
    response: { modelId: "zai/glm-5.3-flash" },
  } as never);

const no = (nome: string, extra: Partial<EntidadeDoGrafo> = {}): EntidadeDoGrafo => {
  const chave = normalizarNome(nome);
  return {
    id: `id-${chave}`,
    nome,
    nome_normalizado: chave,
    chaves: [chave],
    tipo: "Pessoa",
    sessoes: 2,
    atomos: 3,
    aliases: [],
    resumo: "",
    canonico: false,
    enriquecimento: NUNCA_ENRIQUECIDA,
    perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
    ...extra,
  };
};

const RAFFA = no("Raffa", {
  aliases: ["Rafa"],
  resumo: "Amigo de fora do trabalho.",
  perfil: {
    contexto: "amigo de fora do trabalho",
    pode_ajudar_com: "",
    fizemos_juntos: "slackline no parque, todo sábado",
  },
});

const RAPHA = no("Rapha", {
  canonico: true,
  enriquecimento: NUNCA_ENRIQUECIDA,
  perfil: {
    contexto: "sócio no evento",
    pode_ajudar_com: "produção de evento",
    fizemos_juntos: "",
  },
});

const mencao = (extra: Partial<MencaoEmDuvida> = {}): MencaoEmDuvida => ({
  atomo: "Fui no parque andar de slackline com o Rafa",
  tipo: "FATO",
  citado: "Rafa",
  papel: "menciona",
  escolhida: "raffa",
  motivo: "nada no átomo separa os dois",
  confianca: 0.4,
  candidatos: [RAFFA, RAPHA],
  ...extra,
});

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "gw-teste";
  chamar.mockReset();
});

describe("o que a segunda passada vê, e a primeira não via", () => {
  /**
   * É a razão de ela existir. O perfil não saiu do sistema na 4.11 — ele saiu
   * do caminho comum, e voltou aqui, para os poucos candidatos de uma menção.
   * É essa linha que tornou o `TETO_PERFIL` desnecessário.
   */
  it("leva os três campos de perfil, sem teto, de cada candidato", () => {
    const p = montarPrompt(mencao());
    expect(p).toContain("slackline no parque, todo sábado");
    expect(p).toContain("produção de evento");
    expect(p).toContain("amigo de fora do trabalho");
    expect(p).toContain("sócio no evento");
  });

  it("leva o resumo, as grafias e a marca de ficha oficial", () => {
    const p = montarPrompt(mencao());
    expect(p).toContain("Amigo de fora do trabalho.");
    expect(p).toContain("também escrito: Rafa");
    expect(p).toContain("FICHA OFICIAL");
  });

  it("leva o átomo, a grafia citada e o que a primeira leitura disse", () => {
    const p = montarPrompt(mencao());
    expect(p).toContain("Fui no parque andar de slackline com o Rafa");
    expect(p).toContain('o extrator escreveu "Rafa"');
    expect(p).toContain('respondeu "raffa" com confiança 0.40');
    expect(p).toContain("nada no átomo separa os dois");
  });

  it("primeira leitura sem resposta é dita como tal, e não como escolha vazia", () => {
    const p = montarPrompt(mencao({ escolhida: "", motivo: "", confianca: 0 }));
    expect(p).toContain("não respondeu por esta menção");
  });

  /**
   * Entidade nascida num confirmar e nunca editada. Dizer que a ficha está em
   * branco é melhor que um candidato que aparece como uma linha só: se todos
   * vierem assim, o agente tem que marcar dúvida, não escolher no escuro.
   */
  it("candidato sem ficha nenhuma diz que está em branco", () => {
    const p = montarPrompt(mencao({ candidatos: [no("Pedro")] }));
    expect(p).toContain("(ficha em branco)");
  });

  it("o prompt é editável, e a base do git é o padrão", () => {
    expect(montarPrompt(mencao())).toContain(INSTRUCOES.slice(0, 40));
    expect(montarPrompt(mencao(), "MEU PROMPT")).toContain("MEU PROMPT");
  });
});

describe("a resposta", () => {
  it("lê chave, dúvida e motivo", () => {
    expect(parsearResposta('{"entidade":"raffa","duvida":false,"motivo":"o slackline"}')).toEqual({
      entidade: "raffa",
      duvida: false,
      motivo: "o slackline",
    });
  });

  it("aceita cerca de markdown e frase antes, como os outros agentes", () => {
    const r = parsearResposta('Claro!\n```json\n{"entidade":"NOVA","duvida":true}\n```');
    expect(r.entidade).toBe("NOVA");
  });

  /**
   * O agente que esqueceu de responder o campo não me autorizou a gravar
   * calado. É a mesma escolha que faz o fallback ser sempre o caso conservador.
   */
  it("dúvida ausente conta como dúvida, e não como certeza", () => {
    expect(parsearResposta('{"entidade":"raffa"}').duvida).toBe(true);
  });

  it("resposta sem JSON estoura", () => {
    expect(() => parsearResposta("desculpe")).toThrow(/sem JSON/);
  });
});

describe("a chamada", () => {
  it("devolve a chave, a dúvida e a procedência", async () => {
    responder({ entidade: "raffa", duvida: false, motivo: "o slackline é dele" });
    const r = await desempatar(mencao());

    expect(r).toMatchObject({
      entidade: "raffa",
      duvida: false,
      motivo: "o slackline é dele",
      prompt_version: PROMPT_VERSION_DESEMPATE,
    });
  });

  /**
   * Falhar aqui não derrubar nada é o mesmo contrato do agente 2: quem chamou
   * fica com a resposta da primeira passada, já marcada como dúvida — que é
   * exatamente o que o limiar tinha dito sobre aquela menção.
   */
  it("falha devolve null em vez de estourar", async () => {
    chamar.mockRejectedValue(new Error("Gateway fora"));
    expect(await desempatar(mencao())).toBeNull();
  });

  it("resposta sem JSON também devolve null", async () => {
    chamar.mockResolvedValue({ text: "não consegui" } as never);
    expect(await desempatar(mencao())).toBeNull();
  });

  it("o modelo vai como string — é o que faz a chamada sair pelo Gateway", async () => {
    responder({ entidade: "raffa", duvida: false, motivo: "" });
    await desempatar(mencao());
    expect(typeof (chamar.mock.calls[0][0] as { model: unknown }).model).toBe("string");
  });
});
