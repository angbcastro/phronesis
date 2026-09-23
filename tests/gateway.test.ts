/**
 * Guarda da porta única de modelo.
 *
 * Regra inviolável: todo tráfego de LLM — STT, extração, deduplicação, o que
 * vier — sai pelo Vercel AI Gateway. O SDK resolve `model` em string pelo
 * provedor global, que é o Gateway; o que fura a porta é importar um pacote de
 * provedor e passar o objeto de modelo, porque aí a chamada vai direto e o
 * Gateway nunca a vê.
 *
 * Este teste falha quando alguém fura — de propósito ou sem perceber. Não é
 * decoração: é o que sustenta a promessa de "uma chave, um lugar para ver
 * custo". Se ele te barrou, o conserto é usar `src/lib/modelos.ts`, não
 * afrouxar o teste.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODELO_EMBEDDING_PADRAO,
  MODELO_CHAT_PADRAO,
  MODELO_EXTRACAO_PADRAO,
  MODELO_STT_PADRAO,
  modeloChat,
  modeloEmbedding,
  modeloExtracao,
  modeloPerfil,
  modeloResolucao,
  modeloStt,
  provedorAceitaVocabulario,
  provedorDe,
  validarIdDeModelo,
} from "@/lib/modelos";

/** Pacotes que falam direto com provedor, sem passar pelo Gateway. */
const IMPORT_PROIBIDO =
  /(?:from\s+|require\(\s*|import\(\s*)["'](@ai-sdk\/(?!gateway["'])[a-z0-9-]+|openai|@anthropic-ai\/[a-z0-9-]+|@google\/[a-z0-9-]+|@google-cloud\/[a-z0-9-]+|groq-sdk|cohere-ai|@mistralai\/[a-z0-9-]+|ollama|replicate|@huggingface\/[a-z0-9-]+)["']/;

/** Endpoint de provedor escrito à mão — o Gateway tem endereço próprio. */
const HOST_PROIBIDO =
  /https?:\/\/[^"'`\s]*(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.x\.ai|api\.groq\.com|api\.mistral\.ai|api\.cohere\.(?:ai|com)|api\.deepseek\.com|openrouter\.ai|api-inference\.huggingface\.co)/;

/** Chave de provedor. Só `AI_GATEWAY_API_KEY` é legítima. */
const CHAVE_PROIBIDA =
  /\b(?:OPENAI|ANTHROPIC|XAI|GROQ|MISTRAL|COHERE|DEEPSEEK|GEMINI|HUGGINGFACE|STT|LLM)_API_KEY\b/;

function arquivosDeCodigo(raiz: string): string[] {
  return readdirSync(raiz, { recursive: true, encoding: "utf8" })
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .map((p) => join(raiz, p));
}

const FONTES = [...arquivosDeCodigo("src"), ...arquivosDeCodigo("scripts")];

describe("porta única de modelo", () => {
  it("varre um conjunto de arquivos que não está vazio", () => {
    // Sem isto, um erro de caminho faria os testes abaixo passarem sem olhar nada.
    expect(FONTES.length).toBeGreaterThan(20);
    expect(FONTES).toContain(join("src", "lib", "stt.ts"));
  });

  it.each(["IMPORT_PROIBIDO", "HOST_PROIBIDO", "CHAVE_PROIBIDA"] as const)(
    "os próprios padrões (%s) pegam o que deveriam",
    (nome) => {
      const amostras = {
        IMPORT_PROIBIDO: [
          { re: IMPORT_PROIBIDO, mau: 'import { openai } from "@ai-sdk/openai";', bom: 'import { gateway } from "@ai-sdk/gateway";' },
        ],
        HOST_PROIBIDO: [
          { re: HOST_PROIBIDO, mau: 'fetch("https://api.openai.com/v1/audio")', bom: 'fetch("https://ai-gateway.vercel.sh/v4/ai")' },
        ],
        CHAVE_PROIBIDA: [
          { re: CHAVE_PROIBIDA, mau: "process.env.OPENAI_API_KEY", bom: "process.env.AI_GATEWAY_API_KEY" },
        ],
      }[nome];

      for (const { re, mau, bom } of amostras) {
        expect(re.test(mau)).toBe(true);
        expect(re.test(bom)).toBe(false);
      }
    },
  );

  it("nenhum arquivo importa pacote de provedor", () => {
    const culpados = FONTES.filter((f) => IMPORT_PROIBIDO.test(readFileSync(f, "utf8")));
    expect(culpados, `importe modelo por id de string e passe por src/lib/modelos.ts`).toEqual([]);
  });

  it("nenhum arquivo chama endpoint de provedor direto", () => {
    const culpados = FONTES.filter((f) => HOST_PROIBIDO.test(readFileSync(f, "utf8")));
    expect(culpados, `o endereço do Gateway é o único que o código conhece`).toEqual([]);
  });

  it("nenhum arquivo lê chave de provedor", () => {
    const culpados = FONTES.filter((f) => CHAVE_PROIBIDA.test(readFileSync(f, "utf8")));
    expect(culpados, `a única chave de modelo é AI_GATEWAY_API_KEY`).toEqual([]);
  });

  it("nenhum pacote de provedor nas dependências", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const todas = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const proibidas = todas.filter((d) =>
      IMPORT_PROIBIDO.test(`from "${d}"`),
    );
    expect(proibidas).toEqual([]);
    expect(todas).toContain("ai"); // é por ele que o Gateway entra
  });

  it("o .env.example não oferece chave de provedor", () => {
    const exemplo = readFileSync(".env.example", "utf8");
    expect(CHAVE_PROIBIDA.test(exemplo)).toBe(false);
    expect(exemplo).toContain("AI_GATEWAY_API_KEY");
    // A slice 4.5 acrescentou um modelo, não uma chave: `EMBEDDING_MODEL` é id,
    // e continua sendo `AI_GATEWAY_API_KEY` que paga por ele.
    expect(exemplo).toContain("EMBEDDING_MODEL");
  });

  it("o smoke usa o mesmo modelo padrão que a lib", () => {
    // O script roda solto no node e não importa de src/; o padrão é escrito
    // duas vezes. Este teste é o que impede as duas de divergirem.
    const smoke = readFileSync(join("scripts", "smoke.ts"), "utf8");
    expect(smoke).toContain(MODELO_STT_PADRAO);
  });

  it("o smoke conhece os mesmos provedores de vocabulário que a lib", () => {
    // Mesma duplicação, mesmo risco: se um provedor entrar no mapa de
    // `modelos.ts` e não aqui, o smoke passa a avisar que o vocabulário não é
    // mandado justamente quando ele está sendo mandado.
    const smoke = readFileSync(join("scripts", "smoke.ts"), "utf8");
    for (const provedor of ["xai", "deepgram"]) {
      expect(provedorAceitaVocabulario(`${provedor}/qualquer-modelo`)).toBe(true);
      expect(smoke).toContain(`"${provedor}"`);
    }
    // E o contrário: provedor fora do mapa não recebe opção nenhuma. Medido no
    // Gemini, que engole a opção sem avisar (ARCHITECTURE §4.4).
    expect(provedorAceitaVocabulario("google/gemini-3.5-transcribe")).toBe(false);
  });
});

describe("endereçamento de modelo", () => {
  it("aceita id no formato provedor/modelo", () => {
    expect(validarIdDeModelo("xai/grok-stt")).toBe("xai/grok-stt");
    expect(validarIdDeModelo("  openai/whisper-1  ")).toBe("openai/whisper-1");
  });

  it("recusa id sem provedor — seria uma chamada sem dono", () => {
    expect(() => validarIdDeModelo("grok-stt")).toThrow(/Id de modelo inválido/);
    expect(() => validarIdDeModelo("")).toThrow(/Id de modelo inválido/);
    expect(() => validarIdDeModelo("xai/")).toThrow(/Id de modelo inválido/);
  });

  it("extrai o provedor, que é a chave de providerOptions", () => {
    expect(provedorDe("xai/grok-stt")).toBe("xai");
    expect(provedorDe("OpenAI/whisper-1")).toBe("openai");
  });

  it("STT_MODEL troca de provedor sem tocar em código", () => {
    const antes = process.env.STT_MODEL;
    try {
      delete process.env.STT_MODEL;
      expect(modeloStt()).toBe(MODELO_STT_PADRAO);

      process.env.STT_MODEL = "openai/whisper-1";
      expect(modeloStt()).toBe("openai/whisper-1");

      process.env.STT_MODEL = "";
      expect(modeloStt()).toBe(MODELO_STT_PADRAO); // vazio é ausente
    } finally {
      if (antes === undefined) delete process.env.STT_MODEL;
      else process.env.STT_MODEL = antes;
    }
  });

  it("EXTRACAO_MODEL troca de provedor sem tocar em código", () => {
    const antes = process.env.EXTRACAO_MODEL;
    try {
      delete process.env.EXTRACAO_MODEL;
      expect(modeloExtracao()).toBe(MODELO_EXTRACAO_PADRAO);

      process.env.EXTRACAO_MODEL = "openai/gpt-4o-mini";
      expect(modeloExtracao()).toBe("openai/gpt-4o-mini");

      process.env.EXTRACAO_MODEL = "";
      expect(modeloExtracao()).toBe(MODELO_EXTRACAO_PADRAO); // vazio é ausente
    } finally {
      if (antes === undefined) delete process.env.EXTRACAO_MODEL;
      else process.env.EXTRACAO_MODEL = antes;
    }
  });

  /**
   * O chat deixou de herdar o padrão da extração na slice 9: trocar o modelo da
   * extração mudava a resposta do chat em silêncio. O id pode até ser o mesmo —
   * o que este teste guarda é que um não arrasta o outro.
   */
  it("CHAT_MODEL tem padrão próprio, e a extração não o arrasta", () => {
    const antes = process.env.CHAT_MODEL;
    const antesExtracao = process.env.EXTRACAO_MODEL;
    try {
      delete process.env.CHAT_MODEL;
      process.env.EXTRACAO_MODEL = "openai/gpt-4o-mini";
      expect(modeloChat()).toBe(MODELO_CHAT_PADRAO);

      process.env.CHAT_MODEL = "zai/glm-5.3-air";
      expect(modeloChat()).toBe("zai/glm-5.3-air");
    } finally {
      if (antes === undefined) delete process.env.CHAT_MODEL;
      else process.env.CHAT_MODEL = antes;
      if (antesExtracao === undefined) delete process.env.EXTRACAO_MODEL;
      else process.env.EXTRACAO_MODEL = antesExtracao;
    }
  });

  it.each([
    ["RESOLUCAO_MODEL", modeloResolucao],
    ["PERFIL_MODEL", modeloPerfil],
  ] as const)("%s cai no modelo da extração quando não é declarada", (nome, ler) => {
    // Os agentes da slice 4 fazem o mesmo tipo de trabalho que a extração — ler
    // português e devolver JSON curto. Um id próprio fixo aqui seria mais um
    // lugar para desatualizar; a variável separa quando eu quiser separar.
    const antes = process.env[nome];
    const antesExtracao = process.env.EXTRACAO_MODEL;
    try {
      delete process.env[nome];
      delete process.env.EXTRACAO_MODEL;
      expect(ler()).toBe(MODELO_EXTRACAO_PADRAO);

      process.env.EXTRACAO_MODEL = "openai/gpt-4o-mini";
      expect(ler()).toBe("openai/gpt-4o-mini");

      process.env[nome] = "zai/glm-5.3-air";
      expect(ler()).toBe("zai/glm-5.3-air");

      process.env[nome] = "";
      expect(ler()).toBe("openai/gpt-4o-mini"); // vazio é ausente
    } finally {
      if (antes === undefined) delete process.env[nome];
      else process.env[nome] = antes;
      if (antesExtracao === undefined) delete process.env.EXTRACAO_MODEL;
      else process.env.EXTRACAO_MODEL = antesExtracao;
    }
  });

  it("os modelos padrão são endereçáveis pelo Gateway", () => {
    expect(validarIdDeModelo(MODELO_STT_PADRAO)).toBe(MODELO_STT_PADRAO);
    expect(validarIdDeModelo(MODELO_EXTRACAO_PADRAO)).toBe(MODELO_EXTRACAO_PADRAO);
    // Embedding também sai pela porta única (slice 4.5): id em string, mesma
    // chave, nenhuma dependência nova. `embed`/`embedMany` vêm do pacote `ai`.
    expect(validarIdDeModelo(MODELO_EMBEDDING_PADRAO)).toBe(MODELO_EMBEDDING_PADRAO);
    expect(validarIdDeModelo(modeloEmbedding())).toBe(modeloEmbedding());
  });

  it("STT_MODEL mal escrito estoura antes de qualquer byte sair", () => {
    const antes = process.env.STT_MODEL;
    try {
      process.env.STT_MODEL = "grok-stt";
      expect(() => modeloStt()).toThrow(/Id de modelo inválido/);
    } finally {
      if (antes === undefined) delete process.env.STT_MODEL;
      else process.env.STT_MODEL = antes;
    }
  });
});
