/**
 * O cache do tempo de uma invocação (slice 8).
 *
 * Ele existe para uma coisa só — parar de pagar N GETs simultâneos do mesmo
 * objeto dentro do mesmo `waitUntil` — e o que este arquivo protege é a amarra
 * que o torna aceitável: **ele não sobrevive à invocação**. Um cache de módulo
 * faria "salvei o prompt no painel, vale na próxima sessão" ser mentira num
 * jeito que ninguém vê, e essa decisão está declarada em `overrides.ts` desde a
 * slice 4.7.
 */
import { describe, expect, it, vi } from "vitest";

import { comInvocacao, dentroDeUmaInvocacao, umaVezPorInvocacao } from "@/lib/invocacao";

describe("umaVezPorInvocacao", () => {
  it("fora de uma invocação, não guarda nada — é uma chamada direta", async () => {
    const ler = vi.fn(async () => "config");

    expect(dentroDeUmaInvocacao()).toBe(false);
    await umaVezPorInvocacao("k", ler);
    await umaVezPorInvocacao("k", ler);

    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("dentro, a mesma pergunta é lida uma vez só", async () => {
    const ler = vi.fn(async () => "config");

    const r = await comInvocacao(async () => {
      expect(dentroDeUmaInvocacao()).toBe(true);
      return [await umaVezPorInvocacao("k", ler), await umaVezPorInvocacao("k", ler)];
    });

    expect(ler).toHaveBeenCalledTimes(1);
    expect(r).toEqual(["config", "config"]);
  });

  it("N chamadas simultâneas dividem uma ida só — é o caso do desempate", async () => {
    // O desempate roda em `Promise.all`, uma menção por vez, e cada uma pedia a
    // configuração dos agentes: N GETs do mesmo objeto, ao mesmo tempo.
    const ler = vi.fn(async () => "config");

    await comInvocacao(() =>
      Promise.all([...Array(8)].map(() => umaVezPorInvocacao("agentes", ler))),
    );

    expect(ler).toHaveBeenCalledTimes(1);
  });

  it("a invocação seguinte lê de novo — é isso que preserva 'salvei, vale na próxima'", async () => {
    const ler = vi.fn(async () => "config");

    await comInvocacao(() => umaVezPorInvocacao("k", ler));
    await comInvocacao(() => umaVezPorInvocacao("k", ler));

    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("chaves diferentes não se confundem", async () => {
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");

    const r = await comInvocacao(async () => [
      await umaVezPorInvocacao("a", a),
      await umaVezPorInvocacao("b", b),
    ]);

    expect(r).toEqual(["a", "b"]);
  });

  it("falha não fica guardada: a pergunta seguinte tenta de novo", async () => {
    // Guardar a rejeição faria um tropeço de R2 no primeiro bloco condenar a
    // invocação inteira, quando o certo é a segunda pergunta tentar outra vez.
    const ler = vi.fn().mockRejectedValueOnce(new Error("R2 fora")).mockResolvedValue("config");

    const r = await comInvocacao(async () => {
      await umaVezPorInvocacao("k", ler).catch(() => null);
      return umaVezPorInvocacao("k", ler);
    });

    expect(r).toBe("config");
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("aninhada, reusa o escopo de fora — o escopo é o trabalho, não a chamada", async () => {
    const ler = vi.fn(async () => "config");

    await comInvocacao(async () => {
      await umaVezPorInvocacao("k", ler);
      await comInvocacao(() => umaVezPorInvocacao("k", ler));
    });

    expect(ler).toHaveBeenCalledTimes(1);
  });
});
