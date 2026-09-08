/**
 * O painel dos agentes, e as amarras que impedem esta fatia de estragar o que
 * já funciona.
 *
 * Dois testes carregam o arquivo inteiro:
 *
 *   1. **a varredura** — todo `generateText`/`transcribe`/`embed` de `src/`
 *      pertence a um agente do registro. É o que impede um agente novo de
 *      nascer funcionando e invisível: rodando em toda sessão, cobrando, e sem
 *      caixa no painel nem prompt que eu possa ler. Mesmo desenho de
 *      `tests/gateway.test.ts`;
 *   2. **o no-op** — sem override, todo prompt sai byte a byte igual ao de
 *      antes desta fatia. É o que torna a slice incapaz de piorar nada
 *      enquanto eu não mandar.
 *
 * Se um deles te barrou, o conserto é registrar o agente ou desfazer a
 * mudança de texto — não afrouxar o teste.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => ({
  getJson: vi.fn(),
  putJson: vi.fn(async () => ({ etag: null })),
  ConflitoR2Error: class ConflitoR2Error extends Error {},
}));

import {
  AGENTES,
  ARESTAS,
  NOS,
  agentePorId,
  envelopeFaltando,
  retrato,
} from "@/lib/agentes";
import {
  BASE,
  FORMATO,
  INSTRUCOES_BASE,
  PROMPT_VERSION,
  comRegras,
  montarPrompt,
  versaoDoPrompt,
} from "@/lib/extracao";
import { carimbo, configAgentes, resolver } from "@/lib/overrides";
import { tracar } from "@/components/Agentes";
import type { Caixa } from "@/components/Agentes";
import { getJson } from "@/lib/r2";
import { hashDeRegras, hashDeTexto } from "@/lib/regras";
import { AGENTE_IDS, ehAgenteId } from "@/lib/tipos";
import type { ConfigAgentes, Regra } from "@/lib/tipos";

const regra = (texto: string): Regra => ({
  id: "r1",
  texto,
  cita: ["c1", "c2"],
  aprovada_em: "2026-09-04T00:00:00.000Z",
});

const semOverride: ConfigAgentes = { overrides: {}, atualizado_em: "" };

// ───────────────────────────── 1. a varredura ─────────────────────────────

/** As funções do SDK que gastam dinheiro. Quem chama uma tem de ser um agente. */
const CHAMA_MODELO = /\b(?:generateText|streamText|generateObject|transcribe|embedMany|embed)\s*\(/;

function arquivosDeCodigo(raiz: string): string[] {
  return readdirSync(raiz, { recursive: true, encoding: "utf8" })
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .map((p) => join(raiz, p).split("\\").join("/"));
}

describe("todo agente está no painel", () => {
  const fontes = arquivosDeCodigo("src");

  it("varre um conjunto de arquivos que não está vazio", () => {
    // Sem isto, um erro de caminho faria o teste abaixo passar sem olhar nada.
    expect(fontes.length).toBeGreaterThan(20);
    expect(fontes).toContain("src/lib/extracao.ts");
  });

  it("todo arquivo que chama modelo pertence a um agente registrado", () => {
    const chamam = fontes.filter((f) => {
      const src = readFileSync(f, "utf8");
      // `modelos.ts` só documenta os nomes num comentário, e o registro fala
      // dos módulos numa string: nenhum dos dois chama nada.
      if (f === "src/lib/modelos.ts" || f === "src/lib/agentes.ts") return false;
      return CHAMA_MODELO.test(src);
    });

    const registrados = new Set(AGENTES.map((a) => a.modulo));
    const orfaos = chamam.filter((f) => !registrados.has(f));

    expect(
      orfaos,
      `estes arquivos chamam modelo e não são nenhum agente do painel: ${orfaos.join(", ")}. ` +
        "Acrescente o agente em src/lib/agentes.ts — senão ele roda invisível.",
    ).toEqual([]);
  });

  it("todo agente registrado aponta para um arquivo que de fato chama modelo", () => {
    for (const a of AGENTES) {
      expect(fontes, `${a.id} aponta para ${a.modulo}, que não existe`).toContain(a.modulo);
      expect(CHAMA_MODELO.test(readFileSync(a.modulo, "utf8")), `${a.modulo} não chama modelo`).toBe(
        true,
      );
    }
  });

  it("os oito ids do domínio têm exatamente um agente cada", () => {
    expect(AGENTES.map((a) => a.id).sort()).toEqual([...AGENTE_IDS].sort());
    expect(new Set(AGENTES.map((a) => a.modulo)).size).toBe(AGENTES.length);
    for (const id of AGENTE_IDS) expect(agentePorId(id)).toBeDefined();
    expect(ehAgenteId("inventado")).toBe(false);
  });
});

// ───────────────────────────── 2. o no-op ─────────────────────────────

describe("sem override, nada muda", () => {
  it("a base é a emenda exata das duas metades de antes", () => {
    expect(BASE).toBe(INSTRUCOES_BASE + FORMATO);
    expect(BASE).toContain("comentário sobre o material não é.\n\nFORMATO\n");
  });

  it("montarPrompt sem base explícita é o de sempre", () => {
    expect(montarPrompt("olá")).toBe(INSTRUCOES_BASE + FORMATO + "olá");
  });

  it("comRegras sem regra devolve a base intocada", () => {
    expect(comRegras(BASE, [])).toBe(BASE);
  });

  it("a versão sai sem sufixo nenhum", () => {
    expect(versaoDoPrompt([])).toBe(PROMPT_VERSION);
    expect(versaoDoPrompt([], null)).toBe("extracao-9");
  });

  it("resolver devolve a base e o modelo padrão, sem ir ao R2 pelo texto", async () => {
    const e = await resolver("extracao", { prompt: BASE, modelo: "zai/glm-5.3-flash" }, semOverride);
    expect(e).toEqual({ prompt: BASE, modelo: "zai/glm-5.3-flash", hash: null });
    expect(getJson).not.toHaveBeenCalled();
  });
});

// ──────────────────── 3. o bloco de regras continua no lugar ────────────────────

describe("as regras aprovadas continuam entrando antes do FORMATO", () => {
  const r = regra("Nunca corte a conclusão do átomo.");

  it("a emenda é a mesma de quando eram duas constantes", () => {
    // O contrato exato da 4.6: base, bloco, FORMATO — nesta ordem.
    expect(comRegras(BASE, [r])).toBe(
      INSTRUCOES_BASE + comRegras(BASE, [r]).slice(INSTRUCOES_BASE.length),
    );
    const p = montarPrompt("x", [r]);
    expect(p.indexOf(r.texto)).toBeGreaterThan(p.indexOf("NÃO COMENTE A TRANSCRIÇÃO"));
    expect(p.indexOf(r.texto)).toBeLessThan(p.indexOf("FORMATO\nResponda somente com JSON"));
  });

  it("num prompt editado que perdeu o cabeçalho, a regra vai para o fim e não some", () => {
    const editado = "Faça o que eu mando e devolva atomos e entidades.";
    const saida = comRegras(editado, [r]);
    expect(saida.startsWith(editado)).toBe(true);
    expect(saida).toContain(r.texto);
  });

  it("a versão com regra é a de antes: sufixo sem prefixo", () => {
    expect(versaoDoPrompt([r])).toBe(`extracao-9+${hashDeRegras([r])}`);
  });
});

// ───────────────────────────── 4. o carimbo ─────────────────────────────

describe("o carimbo diz por qual chave o hash resolve", () => {
  it("prompt editado leva `p`; regra aprovada, não", () => {
    expect(carimbo("resolucao-2", null)).toBe("resolucao-2");
    expect(carimbo("resolucao-2", "a1b2c3d4")).toBe("resolucao-2+pa1b2c3d4");
  });

  it("prompt editado e regra aprovada carregam os dois sufixos, nesta ordem", () => {
    const r = regra("Junte o que é o mesmo assunto.");
    expect(versaoDoPrompt([r], "a1b2c3d4")).toBe(`extracao-9+pa1b2c3d4+${hashDeRegras([r])}`);
  });

  it("o hash sai do conteúdo: mesmo texto, mesmo hash; texto de volta, carimbo de volta", () => {
    expect(hashDeTexto("abc")).toBe(hashDeTexto("abc"));
    expect(hashDeTexto("abc")).not.toBe(hashDeTexto("abd"));
    expect(hashDeTexto(BASE)).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ─────────────────────── 5. o guarda-corpo do envelope ───────────────────────

describe("o envelope não pode ser quebrado", () => {
  it("a base de cada agente passa na própria validação", () => {
    for (const a of AGENTES) {
      if (a.base === null) continue;
      expect(envelopeFaltando(a, a.base), `${a.id} não pede o próprio envelope`).toEqual([]);
    }
  });

  it("um prompt que deixou de pedir o JSON é recusado, dizendo qual chave falta", () => {
    const extracao = agentePorId("extracao")!;
    expect(envelopeFaltando(extracao, "Devolva o que quiser.")).toEqual(["atomos", "entidades"]);
    expect(envelopeFaltando(extracao, 'Devolva {"atomos":[]}')).toEqual(["entidades"]);
  });

  it("quem não tem prompt não tem envelope a cobrar", () => {
    for (const id of ["stt", "embedding"] as const) {
      const a = agentePorId(id)!;
      expect(a.base).toBeNull();
      expect(a.envelope).toEqual([]);
    }
  });
});

// ───────────────────────────── 6. o override ─────────────────────────────

describe("com override", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockReset();
  });

  const cfg = (over: ConfigAgentes["overrides"]): ConfigAgentes => ({
    overrides: over,
    atualizado_em: "2026-09-04T12:00:00.000Z",
  });

  it("o prompt editado vence a base, e o hash vai no retorno", async () => {
    vi.mocked(getJson).mockResolvedValue({
      valor: { agente: "extracao", hash: "a1b2c3d4", texto: "meu prompt", anterior: null, criada_em: "" },
      etag: null,
    } as never);

    const e = await resolver(
      "extracao",
      { prompt: BASE, modelo: "zai/glm-5.3-flash" },
      cfg({ extracao: { prompt_hash: "a1b2c3d4", modelo: null, atualizado_em: "" } }),
    );
    expect(e.prompt).toBe("meu prompt");
    expect(e.hash).toBe("a1b2c3d4");
  });

  it("ponteiro que não resolve texto cai na base — e o hash volta null junto", async () => {
    // Carimbar uma versão que não foi a usada é procedência falsa, que é pior
    // que procedência nenhuma. O átomo tem de sair dizendo "extracao-9".
    vi.mocked(getJson).mockResolvedValue(null as never);

    const e = await resolver(
      "extracao",
      { prompt: BASE, modelo: "zai/glm-5.3-flash" },
      cfg({ extracao: { prompt_hash: "a1b2c3d4", modelo: null, atualizado_em: "" } }),
    );
    expect(e.prompt).toBe(BASE);
    expect(e.hash).toBeNull();
    expect(versaoDoPrompt([], e.hash)).toBe("extracao-9");
  });

  it("o modelo editado vence a variável de ambiente", async () => {
    const e = await resolver(
      "resolucao",
      { prompt: "x", modelo: "zai/glm-5.3-flash" },
      cfg({ resolucao: { prompt_hash: null, modelo: "openai/gpt-5", atualizado_em: "" } }),
    );
    expect(e.modelo).toBe("openai/gpt-5");
    expect(e.hash).toBeNull();
  });

  it("quem não tem prompt não vai buscar texto nenhum, mesmo com hash no índice", async () => {
    const e = await resolver(
      "stt",
      { modelo: "xai/grok-stt" },
      cfg({ stt: { prompt_hash: "a1b2c3d4", modelo: null, atualizado_em: "" } }),
    );
    expect(e.hash).toBeNull();
    expect(getJson).not.toHaveBeenCalled();
  });

  /**
   * O limiar é o terceiro campo do override (slice 4.11), com a mesma regra dos
   * dois: ausente = a base do git. Ele existe porque é número para eu mexer
   * olhando a revisão, sessão real por sessão real — e trocá-lo não pode ser
   * deploy.
   */
  it("o limiar editado vence o do git", async () => {
    const e = await resolver(
      "resolucao",
      { prompt: "x", modelo: "zai/glm-5.3-flash", limiar: 0.7 },
      cfg({ resolucao: { prompt_hash: null, modelo: null, limiar: 0.9, atualizado_em: "" } }),
    );
    expect(e.limiar).toBe(0.9);
  });

  it("limiar ausente no índice devolve o do git", async () => {
    const e = await resolver(
      "resolucao",
      { prompt: "x", modelo: "zai/glm-5.3-flash", limiar: 0.7 },
      cfg({ resolucao: { prompt_hash: null, modelo: "openai/gpt-5", atualizado_em: "" } }),
    );
    expect(e.limiar).toBe(0.7);
  });

  /**
   * O arquivo é meu, mas um typo nele não pode desligar a segunda passada em
   * silêncio: número fora de [0,1] conta como se não estivesse lá.
   */
  it("limiar sem sentido no arquivo é ignorado como se não existisse", async () => {
    for (const ruim of [7, -1, "0.9", null]) {
      const e = await resolver(
        "resolucao",
        { prompt: "x", modelo: "zai/glm-5.3-flash", limiar: 0.7 },
        cfg({
          resolucao: {
            prompt_hash: null,
            modelo: null,
            limiar: ruim as never,
            atualizado_em: "",
          },
        }),
      );
      expect(e.limiar).toBe(0.7);
    }
  });

  it("quem não tem limiar não ganha um: o campo some do retorno", async () => {
    const e = await resolver(
      "extracao",
      { prompt: BASE, modelo: "zai/glm-5.3-flash" },
      cfg({ extracao: { prompt_hash: null, modelo: null, limiar: 0.9, atualizado_em: "" } }),
    );
    expect(e.limiar).toBeUndefined();
  });
});

// ───────────────────────────── 7. o desenho ─────────────────────────────

describe("o fluxo desenha o sistema que existe", () => {
  const ids = new Set(NOS.map((n) => n.id));

  it("toda aresta liga dois nós que existem", () => {
    for (const e of ARESTAS) {
      expect(ids, `aresta saindo de "${e.de}", que não é nó`).toContain(e.de);
      expect(ids, `aresta chegando em "${e.para}", que não é nó`).toContain(e.para);
    }
  });

  it("todo agente do registro tem uma caixa, e toda caixa de agente é um agente", () => {
    const desenhados = NOS.flatMap((n) => (n.agente ? [n.agente] : []));
    expect(desenhados.sort()).toEqual(AGENTES.map((a) => a.id).sort());
  });

  it("nó não repete id, nem casa na grade", () => {
    expect(new Set(NOS.map((n) => n.id)).size).toBe(NOS.length);
    expect(new Set(NOS.map((n) => `${n.linha}:${n.coluna}`)).size).toBe(NOS.length);
  });

  it("toda aresta de ida liga linhas vizinhas — senão ela atravessa uma caixa", () => {
    // É o invariante que segura o desenho de pé. O roteador faz cotovelo (desce,
    // atravessa, desce), e o trecho horizontal corre na altura do meio entre as
    // duas linhas: se elas não forem vizinhas, esse meio cai em cima da caixa
    // que está entre elas. Realimentação é a exceção, e passa por fora da grade.
    const linha = new Map(NOS.map((n) => [n.id, n.linha]));
    for (const e of ARESTAS) {
      if (e.volta) continue;
      const salto = Math.abs(linha.get(e.para)! - linha.get(e.de)!);
      expect(salto, `${e.de} → ${e.para} pula ${salto} linhas`).toBeLessThanOrEqual(1);
    }
  });

  it("a realimentação sempre sobe: ela volta para uma linha anterior", () => {
    const linha = new Map(NOS.map((n) => [n.id, n.linha]));
    for (const e of ARESTAS.filter((x) => x.volta)) {
      expect(linha.get(e.para)!, `${e.de} → ${e.para} não sobe`).toBeLessThan(linha.get(e.de)!);
    }
  });

  it("existe exatamente um nó humano, e ele é a revisão (regra 5)", () => {
    const eu = NOS.filter((n) => n.tipo === "eu");
    expect(eu).toHaveLength(1);
    expect(eu[0].id).toBe("revisao");
  });

  it("todo nó é alcançável a partir do áudio, ignorando a direção", () => {
    // Nó solto no desenho é agente que eu esqueci de ligar em alguma coisa — e
    // ele apareceria flutuando, sem seta, parecendo decoração.
    const vizinhos = new Map<string, string[]>(NOS.map((n) => [n.id, []]));
    for (const e of ARESTAS) {
      vizinhos.get(e.de)!.push(e.para);
      vizinhos.get(e.para)!.push(e.de);
    }
    const vistos = new Set(["audio"]);
    const fila = ["audio"];
    while (fila.length > 0) {
      for (const v of vizinhos.get(fila.pop()!)!) {
        if (!vistos.has(v)) {
          vistos.add(v);
          fila.push(v);
        }
      }
    }
    expect([...ids].filter((i) => !vistos.has(i))).toEqual([]);
  });
});

// ───────────────────────────── 8. o retrato ─────────────────────────────

describe("o retrato que a tela recebe", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockReset().mockResolvedValue(null as never);
  });

  it("sem override, ninguém está editado e o efetivo é o padrão", async () => {
    const r = await retrato(semOverride);
    expect(r).toHaveLength(AGENTES.length);
    for (const a of r) {
      expect(a.promptEditado, `${a.id} apareceu editado sem override`).toBe(false);
      expect(a.modeloEditado).toBe(false);
      expect(a.modelo).toBe(a.modeloPadrao);
      expect(a.prompt).toBe(a.base);
    }
  });

  it("o embedding vem travado, com o motivo escrito", async () => {
    const e = (await retrato(semOverride)).find((a) => a.id === "embedding")!;
    expect(e.modeloEditavel).toBe(false);
    expect(e.travado).toMatch(/migration/);
  });

  it("o STT diz se o provedor escolhido tem canal de vocabulário", async () => {
    const s = (await retrato(semOverride)).find((a) => a.id === "stt")!;
    expect(typeof s.aceitaVocabulario).toBe("boolean");
    expect(s.prompt).toBeNull();
  });
});

// ─────────────────────── 9. a degradação quando o R2 cai ───────────────────────

describe("R2 fora do ar não derruba agente nenhum", () => {
  it("configAgentes devolve vazio em vez de propagar o erro", async () => {
    // A promessa da fatia: sem override, o agente sai byte a byte igual ao de
    // antes dela — e "sem override" tem de incluir "não consegui perguntar".
    vi.mocked(getJson).mockReset().mockRejectedValue(new Error("R2 fora do ar") as never);

    const cfg = await configAgentes();
    expect(cfg).toEqual({ overrides: {}, atualizado_em: "" });

    const e = await resolver("extracao", { prompt: BASE, modelo: "zai/glm-5.3-flash" }, cfg);
    expect(e.prompt).toBe(BASE);
    expect(versaoDoPrompt([], e.hash)).toBe("extracao-9");
  });
});

// ─────────────────────── 10. a geometria das setas ───────────────────────

/**
 * O desenho não tem browser que o teste possa medir, mas a matemática dele é
 * pura — e é onde uma seta apontando para o lugar errado nasceria.
 */
describe("o traço de uma seta", () => {
  const caixa = (x: number, y: number): Caixa => ({ x, y, w: 80, h: 40 });
  const LARGURA = 400;

  it("descendo na mesma coluna, é uma reta vertical de baixo para cima", () => {
    const d = tracar(caixa(160, 0), caixa(160, 100), false, LARGURA).d;
    expect(d).toBe("M 200 40 L 200 100");
  });

  it("descendo e mudando de coluna, é cotovelo — nunca diagonal", () => {
    const { d } = tracar(caixa(20, 0), caixa(300, 100), false, LARGURA);
    // Desce, atravessa na altura do meio, desce de novo: quatro pontos.
    expect(d.match(/L/g)).toHaveLength(3);
    expect(d).toContain("L 60 70 L 340 70");
  });

  it("na mesma linha, sai pela lateral da caixa e não pelo meio dela", () => {
    const { d } = tracar(caixa(0, 50), caixa(200, 50), false, LARGURA);
    expect(d).toBe("M 80 70 L 200 70");
  });

  it("a mesma linha ao contrário sai pela outra lateral", () => {
    const { d } = tracar(caixa(200, 50), caixa(0, 50), false, LARGURA);
    expect(d).toBe("M 200 70 L 80 70");
  });

  it("a realimentação é curva, e sai pelo lado da parede mais próxima", () => {
    // Origem à direita do meio: a curva sobe por fora, pela direita.
    const direita = tracar(caixa(300, 400), caixa(300, 40), true, LARGURA);
    expect(direita.d.startsWith("M 380 420 C")).toBe(true);
    expect(direita.rx).toBeGreaterThan(380);

    // Origem à esquerda: pela esquerda, e sem sair do palco.
    const esquerda = tracar(caixa(10, 400), caixa(160, 40), true, LARGURA);
    expect(esquerda.d.startsWith("M 10 420 C")).toBe(true);
    expect(esquerda.rx).toBeGreaterThanOrEqual(0);
  });

  it("a curva de volta nunca escapa do palco, nem num palco estreito", () => {
    for (const largura of [200, 400, 900]) {
      for (const x of [0, largura / 2 - 40, largura - 80]) {
        const { rx } = tracar(caixa(x, 300), caixa(x, 20), true, largura);
        expect(rx).toBeGreaterThanOrEqual(0);
        expect(rx).toBeLessThanOrEqual(largura);
      }
    }
  });
});
