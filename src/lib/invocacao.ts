/**
 * Cache do tempo de **uma invocação**, e nada além disso (slice 8).
 *
 * O problema concreto: `configAgentes()` é um GET no R2 por chamada de agente, e
 * no desempate — que roda em `Promise.all`, uma menção por vez — são N GETs
 * simultâneos do **mesmo objeto**. O mesmo vale para toda pergunta que se repete
 * dentro de um `waitUntil` e cuja resposta não muda no meio dele.
 *
 * **A decisão declarada em `overrides.ts` não é revogada; ela é lida com mais
 * precisão.** O comentário de lá diz que não há cache porque cache por instância
 * faria "salvei no painel, vale na próxima" ser mentira — e continua valendo:
 * função serverless quente guarda estado de módulo entre requisições, e um cache
 * assim serviria o prompt velho depois de eu ter salvo o novo. Cache por
 * **invocação** não fura isso, porque a próxima invocação começa com o mapa
 * vazio e lê de novo. O que ele elimina é a repetição dentro do mesmo trabalho.
 *
 * **Fora de um contexto, `umaVezPorInvocacao` é transparente**: chama a função e
 * devolve o resultado, sem guardar nada. Quem abre o contexto são os `waitUntil`
 * do pipeline, e só eles — uma rota que escreve e relê no mesmo pedido leria o
 * que escreveu, e por isso nenhuma delas abre.
 *
 * **Promessa rejeitada sai do mapa.** Guardar a rejeição faria um tropeço de R2
 * no primeiro bloco condenar a invocação inteira, quando o certo é a segunda
 * pergunta tentar de novo.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const contexto = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Abre o escopo. Chamadas aninhadas reusam o de fora — o escopo é o trabalho. */
export function comInvocacao<T>(fn: () => Promise<T>): Promise<T> {
  if (contexto.getStore()) return fn();
  return contexto.run(new Map(), fn);
}

/**
 * A mesma pergunta, uma resposta só, enquanto durar esta invocação.
 *
 * Guarda a **promessa** e não o valor: é isso que faz N chamadas simultâneas —
 * o `Promise.all` do desempate — compartilharem uma ida ao R2 em vez de N.
 */
export function umaVezPorInvocacao<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const mapa = contexto.getStore();
  if (!mapa) return fn();

  const guardada = mapa.get(chave) as Promise<T> | undefined;
  if (guardada) return guardada;

  const nova = fn().catch((e) => {
    mapa.delete(chave);
    throw e;
  });
  mapa.set(chave, nova);
  return nova;
}

/** Só para o teste. Ninguém do pipeline precisa perguntar. */
export const dentroDeUmaInvocacao = (): boolean => contexto.getStore() !== undefined;
