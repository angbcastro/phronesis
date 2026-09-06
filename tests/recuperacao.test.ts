/**
 * O RAG por bloco (slice 4.9): quem o grafo acha que este trecho cita.
 *
 * O que importa testar aqui é o que a fatia promete e o que ela não pode
 * quebrar: que "giam" alcança "Giampaolo Lepore" **sem rede**, que grafo vazio
 * devolve dossiê vazio (e aí a extração sai igual à da 4.8), que o arquivo do
 * bloco é a trava de idempotência, e que a camada semântica caída fica marcada
 * em vez de ser cacheada como completa.
 *
 * A qualidade da lista eu avalio à mão, na revisão, sessão real por sessão real
 * — os pisos de 4 e 6 letras são heurística sem medição, e é assim que ficam.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(),
  putJson: vi.fn(),
}));

// A camada semântica é rede: embutir pelo Gateway e duas consultas de índice.
// Injetada à mão, como em `resolucao.test.ts`, pelo mesmo motivo — o que se
// testa é a regra de união, não a qualidade da vizinhança.
vi.mock("@/lib/entidades", async (original) => ({
  ...(await original<typeof import("@/lib/entidades")>()),
  candidatosSemanticos: vi.fn(async (textos: readonly string[]) => textos.map(() => [])),
  listarEntidades: vi.fn(async () => []),
}));

import { candidatosSemanticos, listarEntidades } from "@/lib/entidades";
import { getJson, putJson } from "@/lib/r2";
import {
  MIN_ALVO_PREFIXO,
  TETO_DO_DOSSIE,
  TETO_POR_BLOCO,
  candidatasDaJanela,
  candidatasDoBloco,
  candidatasPorGrafia,
  dossieDaJanela,
  entidadesJaAtribuidas,
  ngramas,
  recuperarCandidatas,
} from "@/lib/recuperacao";
import { tokenizar } from "@/lib/texto";
import type { CandidatasDoBloco } from "@/lib/recuperacao";
import type { EntidadeDoGrafo } from "@/lib/entidades";
import type { AtomoProposto } from "@/lib/tipos";

const semantica = vi.mocked(candidatosSemanticos);

const no = (nome: string, extra: Partial<EntidadeDoGrafo> = {}): EntidadeDoGrafo => {
  const chave = nome.toLowerCase();
  return {
    id: `id-${chave}`,
    nome,
    nome_normalizado: chave,
    chaves: [chave],
    tipo: "Pessoa",
    sessoes: 1,
    atomos: 1,
    aliases: [],
    perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
    ...extra,
  };
};

/** O caso medido em 04/09: o STT ouviu "Jean", e o nó é este. */
const GIAMPAOLO = no("Giampaolo Lepore", {
  nome_normalizado: "giampaolo lepore",
  chaves: ["giampaolo lepore"],
  perfil: { contexto: "sócio na Adapta", pode_ajudar_com: "", fizemos_juntos: "" },
});
const ADAPTA = no("Adapta", { tipo: "Projeto" });
const BEHRING = no("Behring Founders", {
  nome_normalizado: "behring founders",
  chaves: ["behring founders"],
  tipo: "Projeto",
});

const CATALOGO = [GIAMPAOLO, ADAPTA, BEHRING];

const chaves = (texto: string, catalogo = CATALOGO) =>
  candidatasPorGrafia(texto, catalogo).map((c) => c.chave);

describe("os n-gramas que valem ser procurados", () => {
  it("junta até três tokens — nome próprio raramente cabe em um", () => {
    const g = ngramas(tokenizar("falei com giampaolo lepore hoje"));
    expect(g).toContain("giampaolo lepore");
    expect(g).toContain("com giampaolo lepore");
  });

  it("token curto não entra sozinho: ele casaria com qualquer coisa", () => {
    expect(ngramas(["ana", "sim"])).not.toContain("ana");
    expect(ngramas(["ana", "sim"])).toContain("ana sim");
  });

  it("pronome não entra: ele aparece em toda sessão e não é nome de ninguém", () => {
    expect(ngramas(tokenizar("depois ela falou"))).not.toContain("ela");
    expect(ngramas(tokenizar("a gente foi"))).not.toContain("a gente");
  });
});

describe("as três camadas de string, sem rede nenhuma", () => {
  it("a grafia conhecida casa exato", () => {
    expect(chaves("o contrato da adapta atrasou")).toContain("adapta");
  });

  it("o alias casa exato também — a chave do catálogo já atravessa a fusão", () => {
    const exxmed = no("Exxmed", { chaves: ["exxmed", "exx med"] });
    expect(chaves("reunião com a exx med hoje", [exxmed])).toEqual(["exxmed"]);
  });

  it("**o caso da fatia**: 'giam' alcança 'Giampaolo Lepore' pelo prefixo", () => {
    // É o que nenhuma das duas defesas existentes pegava: o vocabulário do STT
    // ensina grafia de nome inteiro, e Levenshtein põe "giam" longe demais.
    const c = candidatasPorGrafia("falei com o giam sobre o contrato", CATALOGO);
    expect(c[0]).toMatchObject({ chave: "giampaolo lepore", camada: "prefixo" });
  });

  it("prefixo não alcança palavra curta: o piso é o que segura o falso positivo", () => {
    const curto = no("Rafa");
    expect(curto.nome_normalizado.length).toBeLessThan(MIN_ALVO_PREFIXO);
    expect(chaves("hoje o rafi apareceu", [curto])).toEqual([]);
  });

  it("o homófono vem pela camada parecida, de graça", () => {
    // "Bejewel" é o que o STT escreveu; o nó é "Behring Founders".
    const c = candidatasPorGrafia("o pessoal da behrin founders ligou", CATALOGO);
    expect(c.map((x) => x.chave)).toContain("behring founders");
  });

  it("grafo vazio devolve lista vazia — e aí nada muda em relação à 4.8", () => {
    expect(candidatasPorGrafia("falei com o giam", [])).toEqual([]);
  });

  it("o mesmo nó achado por duas camadas entra uma vez, pela mais forte", () => {
    // "adapta" casa exato; "adapt" também seria prefixo dela.
    const c = candidatasPorGrafia("a adapta e o adapt", [ADAPTA]);
    expect(c).toHaveLength(1);
    expect(c[0].camada).toBe("exato");
  });

  it("a lista tem teto: o bloco não guarda o catálogo inteiro", () => {
    const muitos = Array.from({ length: 40 }, (_, i) => no(`Pessoa${i}`));
    const texto = muitos.map((e) => e.nome).join(" ");
    expect(candidatasPorGrafia(texto, muitos).length).toBeLessThanOrEqual(TETO_POR_BLOCO);
  });
});

describe("a camada semântica entra por cima, e diz se rodou", () => {
  beforeEach(() => {
    semantica.mockReset();
    semantica.mockImplementation(async (textos) => textos.map(() => []));
  });

  it("catálogo vazio não chama o Gateway — e não há camada a refazer", async () => {
    const r = await candidatasDoBloco("qualquer coisa", []);
    expect(semantica).not.toHaveBeenCalled();
    expect(r).toEqual({ candidatas: [], semantico: true });
  });

  it("o que o vetor devolve vira candidata, atrás das camadas de string", async () => {
    semantica.mockResolvedValue([
      [{ chave: "behring founders", camada: "vizinhos", similaridade: 0.7, votos: 2, porque: [] }],
    ]);
    const { candidatas, semantico } = await candidatasDoBloco("a adapta cresceu", CATALOGO);

    expect(semantico).toBe(true);
    expect(candidatas.map((c) => c.camada)).toEqual(["exato", "vizinhos"]);
  });

  it("camada semântica sem resposta marca o bloco como degradado", async () => {
    const { semantico } = await candidatasDoBloco("a adapta cresceu", CATALOGO);
    expect(semantico).toBe(false);
  });
});

describe("o dossiê da janela", () => {
  it("as entidades já atribuídas nesta sessão vêm na frente de todas", () => {
    const d = dossieDaJanela({
      blocos: [[{ chave: "adapta", camada: "exato", score: 1 }]],
      jaAtribuidas: ["behring founders"],
      catalogo: CATALOGO,
    });
    expect(d.map((x) => x.entidade.nome_normalizado)).toEqual(["behring founders", "adapta"]);
    expect(d[0].camada).toBe("ja_nesta_sessao");
  });

  it("chave que não está no catálogo cai fora em silêncio", () => {
    // Entidade nova de uma janela anterior ainda não é nó: não há nome gravado
    // nem perfil para mostrar ao extrator.
    const d = dossieDaJanela({ jaAtribuidas: ["alguem que nao existe"], catalogo: CATALOGO });
    expect(d).toEqual([]);
  });

  it("sem bloco nenhum e sem sessão nenhuma, o dossiê é vazio", () => {
    expect(dossieDaJanela({ catalogo: CATALOGO })).toEqual([]);
  });

  it("tem teto — o dossiê é uma seleção, não o catálogo inteiro", () => {
    const muitos = Array.from({ length: TETO_DO_DOSSIE + 10 }, (_, i) => no(`Pessoa${i}`));
    const d = dossieDaJanela({
      blocos: [muitos.map((e) => ({ chave: e.nome_normalizado, camada: "exato" as const, score: 1 }))],
      catalogo: muitos,
    });
    expect(d).toHaveLength(TETO_DO_DOSSIE);
  });

  it("o que a janela anterior atribuiu sai dos átomos, nos dois formatos", () => {
    const atomo = (sobre: unknown, menciona: unknown[] = []): AtomoProposto =>
      ({ sobre, menciona }) as unknown as AtomoProposto;

    expect(
      entidadesJaAtribuidas([
        atomo({ citado: "Jean", entidade: "Giampaolo Lepore", conhecida: true }),
        // Formato anterior à slice 4: `sobre` era string.
        atomo("Adapta"),
      ]),
    ).toEqual(["giampaolo lepore", "adapta"]);
  });
});

describe("a trava de idempotência é o arquivo do bloco", () => {
  let r2: Map<string, { valor: unknown; etag: string }>;

  beforeEach(() => {
    r2 = new Map();
    vi.mocked(getJson).mockImplementation(async (key: string) => r2.get(key) ?? null);
    vi.mocked(putJson).mockImplementation(async (key: string, valor: unknown) => {
      r2.set(key, { valor, etag: "e1" });
      return { etag: "e1" };
    });
    vi.mocked(listarEntidades).mockResolvedValue(CATALOGO as never);
    semantica.mockReset();
    semantica.mockImplementation(async (textos) => textos.map(() => []));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const comBloco = (texto = "falei com o giam sobre a adapta") => {
    r2.set("sessoes/s1/chunk_000.json", {
      valor: { i: 0, texto, palavras: [], modelo: "xai/grok-stt", granularidade: "palavra" },
      etag: "b",
    });
  };

  const gravado = () => r2.get("sessoes/s1/candidatas_000.json")?.valor as CandidatasDoBloco;

  it("o bloco é consultado uma vez e gravado no lugar que o espelha", async () => {
    comBloco();
    const r = await recuperarCandidatas("s1", 0);

    expect(r?.candidatas.map((c) => c.chave)).toContain("giampaolo lepore");
    expect(gravado().i).toBe(0);
  });

  it("segunda passada não reconsulta o grafo nem regrava", async () => {
    comBloco();
    await recuperarCandidatas("s1", 0);
    vi.mocked(listarEntidades).mockClear();
    vi.mocked(putJson).mockClear();

    await recuperarCandidatas("s1", 0);
    expect(listarEntidades).not.toHaveBeenCalled();
    expect(putJson).not.toHaveBeenCalled();
  });

  it("bloco sem transcrição ainda não tem o que buscar, e isso não é falha", async () => {
    expect(await recuperarCandidatas("s1", 0)).toBeNull();
    expect(putJson).not.toHaveBeenCalled();
  });

  it("o catch-up refaz o degradado uma vez — e só uma", async () => {
    comBloco();
    await recuperarCandidatas("s1", 0);
    expect(gravado().semantico).toBe(false);

    // Agora o Gateway responde: o catch-up do /finalizar recupera a camada.
    semantica.mockResolvedValue([
      [{ chave: "adapta", camada: "perfil", similaridade: 0.5, votos: 1, porque: [] }],
    ]);
    await recuperarCandidatas("s1", 0, { refazerDegradado: true });
    expect(gravado()).toMatchObject({ semantico: true, refeito: true });

    // E o que continuar degradado depois de refeito não volta a ser refeito.
    semantica.mockImplementation(async (textos) => textos.map(() => []));
    r2.set("sessoes/s1/candidatas_000.json", {
      valor: { ...gravado(), semantico: false, refeito: true },
      etag: "e1",
    });
    vi.mocked(putJson).mockClear();
    await recuperarCandidatas("s1", 0, { refazerDegradado: true });
    expect(putJson).not.toHaveBeenCalled();
  });

  it("bloco que estoura não derruba a janela: o dossiê só fica menor", async () => {
    comBloco();
    r2.set("sessoes/s1/chunk_001.json", {
      valor: { i: 1, texto: "a adapta de novo", palavras: [], modelo: "m", granularidade: "palavra" },
      etag: "b",
    });
    vi.mocked(listarEntidades).mockRejectedValueOnce(new Error("Neo4j fora"));

    const blocos = await candidatasDaJanela("s1", [0, 1]);
    expect(blocos).toHaveLength(1);
  });
});
