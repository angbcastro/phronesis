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
  TELAS,
  agentePorId,
  envelopeFaltando,
  passosDaTela,
  retrato,
} from "@/lib/agentes";
import type { Tela } from "@/lib/agentes";
import {
  BASE,
  FORMATO,
  INSTRUCOES_BASE,
  PROMPT_VERSION,
  montarPrompt,
  versaoDoPrompt,
} from "@/lib/extracao";
import { carimbo, configAgentes, resolver } from "@/lib/overrides";
import { getJson } from "@/lib/r2";
import { hashDeTexto } from "@/lib/regras";
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

  it("os doze ids do domínio têm exatamente um agente cada", () => {
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

  it("a versão sai sem sufixo nenhum", () => {
    expect(versaoDoPrompt()).toBe(PROMPT_VERSION);
    expect(versaoDoPrompt(null)).toBe("extracao-9");
  });

  it("resolver devolve a base e o modelo padrão, sem ir ao R2 pelo texto", async () => {
    const e = await resolver("extracao", { prompt: BASE, modelo: "zai/glm-5.3-flash" }, semOverride);
    expect(e).toEqual({ prompt: BASE, modelo: "zai/glm-5.3-flash", hash: null });
    expect(getJson).not.toHaveBeenCalled();
  });
});

// ──────────────── 3. o apêndice de regras saiu, e nada ficou no lugar ────────────────

describe("o prompt tem duas fontes, e não três (slice 7)", () => {
  it("montarPrompt não aceita mais uma lista de regras entre o texto e a base", () => {
    // A assinatura é a prova: o segundo parâmetro passou a ser a base, e o
    // apêndice deixou de existir. Um `montarPrompt(texto, regras, base)` de
    // antes da 7 quebraria aqui em vez de colar regra onde não vai mais.
    expect(montarPrompt("x", BASE)).toBe(BASE + "x");
  });

  it("a emenda entra no corpo do prompt, e é o override que a carrega", async () => {
    // O que a 4.6 colava a cada chamada agora está dentro do texto que
    // `efetivo` devolve — e por isso o carimbo tem um sufixo só.
    const editado = BASE.replace(
      "QUANTOS",
      ["QUANTOS", "Nunca corte a conclusão do átomo."].join("\n"),
    );
    const e = await resolver("extracao", { prompt: editado, modelo: "m" }, semOverride);
    expect(e.prompt).toContain("Nunca corte a conclusão do átomo.");
    expect(montarPrompt("x", e.prompt)).toContain("Nunca corte a conclusão do átomo.");
  });
});

// ───────────────────────────── 4. o carimbo ─────────────────────────────

describe("o carimbo diz por qual chave o hash resolve", () => {
  it("prompt editado leva `p`; regra aprovada, não", () => {
    expect(carimbo("resolucao-2", null)).toBe("resolucao-2");
    expect(carimbo("resolucao-2", "a1b2c3d4")).toBe("resolucao-2+pa1b2c3d4");
  });

  it("desde a slice 7 o carimbo tem um sufixo só: o do prompt em vigor", () => {
    // A 4.6 podia carimbar `extracao-9+pa1b2c3d4+a3f91c7d` — dois hashes, dois
    // objetos. O segundo era o apêndice de regras, que deixou de existir.
    // Carimbo antigo com os dois continua resolvendo: os dois snapshots são
    // imutáveis e `versaoDeRegras` continua de pé para ler o segundo.
    expect(versaoDoPrompt("a1b2c3d4")).toBe("extracao-9+pa1b2c3d4");
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
    expect(versaoDoPrompt(e.hash)).toBe("extracao-9");
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

describe("as duas telas desenham o sistema que existe", () => {
  const passos = (t: Tela) => passosDaTela(t);
  const todos = TELAS.flatMap(passos);
  const agentesDe = (t: Tela) => passos(t).flatMap((p) => (p.agente ? [p.agente] : []));

  it("as duas telas são os dois fluxos, sem repetir", () => {
    expect(TELAS.map((t) => t.fluxo)).toEqual(["ingestao", "consulta"]);
  });

  it("todo agente do registro tem um cartão, e todo cartão é um agente", () => {
    // Somando as duas telas: é o que faz um agente novo aparecer no painel em
    // vez de rodar invisível. A varredura da seção 1 cobra o outro lado.
    const desenhados = todos.flatMap((p) => (p.agente ? [p.agente] : []));
    expect(desenhados.slice().sort()).toEqual(AGENTES.map((a) => a.id).sort());
  });

  it("nenhum id de passo se repete, dentro de uma tela ou entre elas", () => {
    expect(new Set(todos.map((p) => p.id)).size).toBe(todos.length);
  });

  it("existe exatamente um passo humano, ele é a revisão, e ele está na ingestão (regra 5)", () => {
    const eu = todos.filter((p) => p.tipo === "eu");
    expect(eu).toHaveLength(1);
    expect(eu[0].id).toBe("revisao");
    expect(passos(TELAS[0]).some((p) => p.id === "revisao")).toBe(true);
  });

  /**
   * A volta é a realimentação escrita em palavra, e ela diz para onde volta.
   * Um destino que não existe viraria uma frase apontando para lugar nenhum —
   * era o que uma seta quebrada fazia no desenho antigo, e a única diferença é
   * que agora dá para testar sem medir pixel.
   */
  it("toda volta aponta para um passo que existe, inclusive os aninhados", () => {
    const ids = new Set(todos.map((p) => p.id));
    for (const p of todos) {
      if (!p.volta) continue;
      expect(ids, `${p.id} volta para "${p.volta.para}", que não é passo`).toContain(p.volta.para);
    }
    // Os dois que voltam para dentro da extração: sem achatar `dentro`, o teste
    // acima passaria vazio e não cobriria nada.
    const voltas = todos.flatMap((p) => (p.volta ? [`${p.id}→${p.volta.para}`] : []));
    expect(voltas).toContain("embedding→resolucao");
    expect(voltas).toContain("perfil→desempate");
  });

  /**
   * O pedido que gerou este desenho: o caminho de sair não se mistura com o de
   * entrar. O chat não escreve nada — nem por ferramenta —, e pô-lo de volta no
   * caminho de gravar tem de quebrar um teste em vez de só ficar confuso.
   */
  it("os fluxos não se misturam: a consulta é o chat e o título, e só", () => {
    const consulta = TELAS.find((t) => t.fluxo === "consulta")!;
    const ingestao = TELAS.find((t) => t.fluxo === "ingestao")!;
    expect(agentesDe(consulta).slice().sort()).toEqual(["chat", "titulo-chat"]);
    for (const id of agentesDe(consulta)) {
      expect(agentesDe(ingestao), `${id} aparece nos dois fluxos`).not.toContain(id);
    }
  });

  it("toda seção tem passo, e a espinha da ingestão termina no grafo", () => {
    for (const t of TELAS) {
      expect(t.secoes.length).toBeGreaterThan(0);
      for (const s of t.secoes) expect(s.passos.length, `${t.fluxo}/${s.id} está vazia`).toBeGreaterThan(0);
    }
    const espinha = TELAS[0].secoes[0];
    expect(espinha.forma).toBe("espinha");
    expect(espinha.passos[espinha.passos.length - 1].id).toBe("grafo");
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
    expect(versaoDoPrompt(e.hash)).toBe("extracao-9");
  });
});
