/**
 * A porta do vetor.
 *
 * O que dá para testar sem rede é justamente o que decide a qualidade da
 * camada: **o que entra na string canônica** e **quando o hash muda**. A
 * vizinhança em si eu avalio à mão, olhando a lista — não há gabarito, fixture
 * nem percentual neste projeto, e não é aqui que um vai nascer.
 */
import { describe, expect, it } from "vitest";
import { fonteDaEntidade, hashDaFonte } from "@/lib/embedding";
import { DIMENSAO_EMBEDDING, MODELO_EMBEDDING_PADRAO, modeloEmbedding } from "@/lib/modelos";
import { PERFIL_VAZIO } from "@/lib/tipos";
import type { FonteDeEntidade } from "@/lib/embedding";

const entidade = (extra: Partial<FonteDeEntidade> = {}): FonteDeEntidade => ({
  nome: "Raffa",
  tipo: "Pessoa",
  aliases: [],
  perfil: { ...PERFIL_VAZIO },
  ...extra,
});

describe("a string canônica da entidade", () => {
  it("leva nome, tipo, aliases e os três campos de perfil", () => {
    const fonte = fonteDaEntidade(
      entidade({
        aliases: ["Raffael do Vale"],
        perfil: {
          contexto: "amigo de infância",
          pode_ajudar_com: "slackline",
          fizemos_juntos: "acampamos na serra",
        },
      }),
    );
    expect(fonte).toContain("Raffa");
    expect(fonte).toContain("tipo: pessoa");
    expect(fonte).toContain("também escrito: Raffael do Vale");
    expect(fonte).toContain("contexto: amigo de infância");
    expect(fonte).toContain("pode ajudar com: slackline");
    expect(fonte).toContain("fizemos juntos: acampamos na serra");
  });

  it("campo vazio é OMITIDO, e não presente em branco", () => {
    // String vazia no meio do texto é ruído com posição: o modelo vê um rótulo
    // seguido de nada e não tem como saber que aquilo não quer dizer nada.
    const fonte = fonteDaEntidade(entidade({ perfil: { ...PERFIL_VAZIO, contexto: "colega" } }));
    expect(fonte).toContain("contexto: colega");
    expect(fonte).not.toContain("pode ajudar com:");
    expect(fonte).not.toContain("fizemos juntos:");
  });

  it("sem alias, a linha de alias não existe", () => {
    expect(fonteDaEntidade(entidade())).not.toContain("também escrito");
  });

  it("a ordem dos aliases não muda o resultado", () => {
    // `collect(DISTINCT …)` do Cypher não promete ordem, e ordem instável aqui
    // é hash instável: a entidade sairia de dia sem ninguém a ter editado.
    const a = fonteDaEntidade(entidade({ aliases: ["Zé", "Ana", "Bia"] }));
    const b = fonteDaEntidade(entidade({ aliases: ["Bia", "Zé", "Ana"] }));
    expect(hashDaFonte(a)).toBe(hashDaFonte(b));
  });

  it("o nó inteiro NÃO entra — contagem de sessão não vira vetor", () => {
    // `sessoes` e `atomos` mudam a cada confirmar sem que o significado da
    // entidade mude. No hash, forçariam reembutir o grafo inteiro toda sessão.
    const fonte = fonteDaEntidade(entidade({ perfil: { ...PERFIL_VAZIO, contexto: "colega" } }));
    expect(fonte).not.toMatch(/sess(ão|ões)|átomo|id:|nome_normalizado/i);
  });
});

describe("o hash da fonte", () => {
  it("mesma entidade, mesmo hash — é o que dispensa gancho nas rotas", () => {
    expect(hashDaFonte(fonteDaEntidade(entidade()))).toBe(
      hashDaFonte(fonteDaEntidade(entidade())),
    );
  });

  it("editar o perfil muda o hash — a entidade sai de dia (critério 8)", () => {
    const antes = hashDaFonte(fonteDaEntidade(entidade()));
    const depois = hashDaFonte(
      fonteDaEntidade(entidade({ perfil: { ...PERFIL_VAZIO, fizemos_juntos: "slackline" } })),
    );
    expect(depois).not.toBe(antes);
  });

  it("renomear e ganhar alias também mudam o hash", () => {
    const base = hashDaFonte(fonteDaEntidade(entidade()));
    expect(hashDaFonte(fonteDaEntidade(entidade({ nome: "Raffa do Vale" })))).not.toBe(base);
    expect(hashDaFonte(fonteDaEntidade(entidade({ aliases: ["Rafa"] })))).not.toBe(base);
  });

  it("cabe num log e é estável entre execuções", () => {
    const h = hashDaFonte("qualquer coisa");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("o modelo de embedding", () => {
  it("é endereçado por string, pelo Gateway, e troca por variável", () => {
    const antes = process.env.EMBEDDING_MODEL;
    try {
      delete process.env.EMBEDDING_MODEL;
      expect(modeloEmbedding()).toBe(MODELO_EMBEDDING_PADRAO);

      process.env.EMBEDDING_MODEL = "cohere/embed-v4.0";
      expect(modeloEmbedding()).toBe("cohere/embed-v4.0");

      process.env.EMBEDDING_MODEL = "";
      expect(modeloEmbedding()).toBe(MODELO_EMBEDDING_PADRAO); // vazio é ausente
    } finally {
      if (antes === undefined) delete process.env.EMBEDDING_MODEL;
      else process.env.EMBEDDING_MODEL = antes;
    }
  });

  it("id mal escrito estoura antes de qualquer byte sair", () => {
    const antes = process.env.EMBEDDING_MODEL;
    try {
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";
      expect(() => modeloEmbedding()).toThrow(/Id de modelo inválido/);
    } finally {
      if (antes === undefined) delete process.env.EMBEDDING_MODEL;
      else process.env.EMBEDDING_MODEL = antes;
    }
  });

  it("a dimensão do padrão é a que a migration 006 declara", () => {
    // Medido contra o Gateway em 2026-09-02: openai/text-embedding-3-small
    // devolve 1536. É a única coisa desta slice que amarra o schema.
    expect(DIMENSAO_EMBEDDING).toBe(1536);
    expect(MODELO_EMBEDDING_PADRAO).toBe("openai/text-embedding-3-small");
  });
});
