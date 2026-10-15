/**
 * O fechamento do confirmar: a revisão deixa um recado, e a tela de gravar o
 * lê uma vez só — "guardado · 8 itens", por 3 s (`Specs/interface.md`, a
 * decisão 4).
 *
 * É fechamento, e não cobrança: diz o que acabou de acontecer, some sozinho, e
 * não volta. Por isso `sessionStorage`, e não parâmetro na URL — recarregar a
 * home não pode repetir o recado, e o endereço de `/` continua sendo só `/`.
 * Sem storage (aba privada, cota), não há recado, e nada mais muda.
 */
import { plural } from "@/lib/texto";

const CHAVE = "guardado";

/** Quanto tempo o recado fica na tela — o mesmo número da animação do CSS. */
export const DURACAO_GUARDADO_MS = 3000;

/** A revisão, no instante em que o confirmar deu certo. */
export function anunciarGuardado(itens: number): void {
  try {
    sessionStorage.setItem(CHAVE, String(itens));
  } catch {
    // Sem storage, sem recado: o confirmar já aconteceu, e é o que importa.
  }
}

/** Lê e apaga — o recado vale uma vez. `null` quando não há, ou é lixo. */
export function lerGuardado(): number | null {
  try {
    const v = sessionStorage.getItem(CHAVE);
    if (v === null) return null;
    sessionStorage.removeItem(CHAVE);
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * A frase. Zero item é sessão fechada sem nada no grafo — desmarcar tudo e
 * confirmar é uma saída válida, e "guardado · 0 itens" mentiria que algo foi.
 */
export const fraseGuardado = (itens: number): string =>
  itens === 0 ? "sessão fechada · nada entrou" : `guardado · ${plural(itens, "item", "itens")}`;
