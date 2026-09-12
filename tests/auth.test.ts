/**
 * A janela deslizante do cookie e a segunda credencial da porta única.
 *
 * As duas nasceram do deploy: sem a primeira o ritual morre de 90 em 90 dias
 * por prazo, e não por decisão; sem a segunda o cron da Vercel não entra —
 * e ele é quem faz o backup e quem impede a instância Aura de ser pausada por
 * 72 h de silêncio.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { credencialDeCron, precisaRenovar } from "@/lib/auth";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 12);

/** Um token com `restaS` segundos de vida pela frente. Só o `exp` importa. */
const tokenQueVence = (restaMs: number) =>
  `sessao.${Math.floor((AGORA + restaMs) / 1000)}.assinaturaNaoConferidaAqui`;

describe("a janela do cookie desliza", () => {
  it("não renova enquanto sobra mais de um terço dos 90 dias", () => {
    expect(precisaRenovar(tokenQueVence(90 * DIA), AGORA)).toBe(false);
    expect(precisaRenovar(tokenQueVence(31 * DIA), AGORA)).toBe(false);
  });

  it("renova quando a vida restante cai abaixo de 30 dias", () => {
    expect(precisaRenovar(tokenQueVence(29 * DIA), AGORA)).toBe(true);
    expect(precisaRenovar(tokenQueVence(1 * DIA), AGORA)).toBe(true);
  });

  /**
   * Não renovar é sempre a resposta segura: quem chama é o middleware, logo
   * depois de `tokenValido` ter aprovado, e um token que chegou aqui malformado
   * é sinal de coisa pior que um cookie vencido.
   */
  it("recusa renovar o que não sabe ler", () => {
    expect(precisaRenovar(undefined, AGORA)).toBe(false);
    expect(precisaRenovar("", AGORA)).toBe(false);
    expect(precisaRenovar("sessao.amanhã.assinatura", AGORA)).toBe(false);
    expect(precisaRenovar("sozinho", AGORA)).toBe(false);
  });
});

describe("a porta reconhece o cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "segredo-do-cron";
  });

  it("aceita o header exato que a Vercel manda", () => {
    expect(credencialDeCron("Bearer segredo-do-cron")).toBe(true);
  });

  it("recusa segredo errado, esquema errado e ausência", () => {
    expect(credencialDeCron("Bearer outro-segredo")).toBe(false);
    expect(credencialDeCron("Basic segredo-do-cron")).toBe(false);
    expect(credencialDeCron("segredo-do-cron")).toBe(false);
    expect(credencialDeCron(null)).toBe(false);
  });

  /**
   * O prefixo do segredo certo não pode passar. A comparação é de tempo
   * constante e começa por comprimento — este teste é o que impede alguém de
   * trocá-la por um `startsWith` algum dia.
   */
  it("recusa prefixo do segredo certo", () => {
    expect(credencialDeCron("Bearer segredo-do-cro")).toBe(false);
    expect(credencialDeCron("Bearer segredo-do-cronX")).toBe(false);
  });
});
