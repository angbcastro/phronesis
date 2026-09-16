/**
 * A porta única da troca de modo na tela de gravar: abrir e fechar o chat
 * dentro de uma View Transition.
 *
 * **Por que a API do navegador e não mais CSS.** A caixa do chat ia do rodapé
 * ao centro interpolando `top`, `bottom`, `left`, `right`, `max-width` e o
 * raio — seis propriedades de layout, recalculadas a cada quadro, com uma lista
 * rolável dentro. A View Transition fotografa o antes e o depois e morfa a bola
 * e a caixa do ponto inicial ao de destino numa linha do tempo só, no
 * compositor. A transição de geometria continua no `globals.css` e não é
 * legado: é o caminho de quem não tem a API, e o de quem pediu menos movimento.
 *
 * **`flushSync` não é zelo, é o que faz existir.** `startViewTransition`
 * fotografa o "depois" quando o callback termina. Com o batch normal do React o
 * DOM ainda não mudou nessa hora: as duas fotos saem iguais, a transição não
 * anima nada, e a tela pula para o estado novo depois — um corte pior que o de
 * antes.
 *
 * **`prefers-reduced-motion` é decidido aqui, e não no CSS.** Quem pediu menos
 * movimento não entra na View Transition de jeito nenhum; volta ao caminho
 * antigo inteiro, onde o `@media` do `globals.css` já resolve com `1ms`.
 */
import { flushSync } from "react-dom";

/**
 * O tipo mínimo, declarado aqui porque o `lib.dom` desta versão do TypeScript
 * ainda não conhece a API. Só o que este arquivo usa — e não `any`, que
 * esconderia um erro de digitação no nome do método.
 */
interface ComTransicao {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
}

/** Há View Transition disponível *e* o sistema não pediu menos movimento. */
export function usaTransicao(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof (document as ComTransicao).startViewTransition !== "function") return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Roda a mudança dentro de uma View Transition, ou direto quando não há. */
export function comTransicao(mudar: () => void): void {
  if (!usaTransicao()) {
    mudar();
    return;
  }
  (document as ComTransicao).startViewTransition?.(() => flushSync(mudar));
}
