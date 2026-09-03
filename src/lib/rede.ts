/**
 * Retry de conexão: a única defesa que este sistema tem contra link ruim.
 *
 * Tudo que ele faz sai por `fetch` — Neo4j pela HTTP Query API, R2 pela API S3,
 * modelo pelo AI Gateway. O undici derruba a conexão que não completa o
 * handshake em 10 s, e num link com meio segundo de latência e pico de 1,3 s
 * isso acontece: o erro é `UND_ERR_CONNECT_TIMEOUT` e o pedido nunca saiu.
 *
 * **Esses 10 s não são configuráveis.** O `fetch` do Node usa a cópia interna
 * do undici, e ela recusa um dispatcher vindo do pacote `undici` do npm — por
 * símbolo global ou pelo `init`, dá `UND_ERR_INVALID_ARG`. Aumentar o prazo
 * exigiria trocar a implementação de `fetch` do processo inteiro, o que
 * atropelaria o cache de fetch do Next.
 *
 * Não faz falta: quem conserta é o retry, não o prazo maior. Medido no link
 * que produziu o erro — o handshake frio falhou depois de 24,8 s, e as quatro
 * tentativas seguintes abriram em menos de 400 ms cada. Esperar mais na mesma
 * conexão morta não salva ninguém; abrir outra salva.
 */
import { atrasoBackoff } from "./backoff";

/** Teto do undici para abrir conexão, que não dá para mudar. Aqui só para a frase de erro. */
export const CONEXAO_TIMEOUT_MS = 10_000;
export const TENTATIVAS = 3;

/**
 * Códigos em que o pedido **comprovadamente não saiu**: a conexão nem chegou a
 * abrir. Repetir aqui não duplica nada, nem escrita (regra inviolável 4).
 */
const ANTES_DO_ENVIO = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * Códigos em que a conexão morreu e não dá para saber se o pedido chegou ao
 * outro lado. Só se repete quando a chamada é leitura pura.
 */
const DEPOIS_DE_ABRIR = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * O código do erro de rede, de dentro do `cause`.
 *
 * `fetch` falho vira sempre `TypeError: fetch failed` — a informação está uma
 * camada abaixo, no `cause`, e é ela que diz se dá para tentar de novo.
 */
export function codigoDeRede(e: unknown): string | null {
  const alvos = [(e as { cause?: unknown })?.cause, e];
  for (const alvo of alvos) {
    const code = (alvo as { code?: unknown })?.code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** Dá para tentar de novo sem risco de duplicar efeito? */
export function reconectavel(e: unknown, leitura: boolean): boolean {
  const code = codigoDeRede(e);
  if (!code) return false;
  return ANTES_DO_ENVIO.has(code) || (leitura && DEPOIS_DE_ABRIR.has(code));
}

/** Frase legível para a tela, quando o erro é de rede e não do serviço. */
export function descricaoDeRede(e: unknown): string | null {
  const code = codigoDeRede(e);
  if (!code) return null;
  if (code === "UND_ERR_CONNECT_TIMEOUT") {
    return `não consegui abrir conexão: ${TENTATIVAS} tentativas de ${CONEXAO_TIMEOUT_MS / 1000}s`;
  }
  return `falha de rede (${code})`;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpcoesRetry {
  /** Chamada sem efeito colateral: repete também quando a conexão cai no meio. */
  leitura?: boolean;
  tentativas?: number;
  /** Injetável no teste, para não dormir de verdade. */
  dormir?: (ms: number) => Promise<unknown>;
}

/**
 * Roda `fn`, repetindo enquanto o erro for de conexão e a repetição for segura.
 * Erro do serviço (Cypher inválido, 404 do R2) sobe na primeira — repetir o que
 * vai falhar de novo só faz a tela esperar mais.
 */
export async function comRetry<T>(
  rotulo: string,
  fn: () => Promise<T>,
  opcoes: OpcoesRetry = {},
): Promise<T> {
  const { leitura = false, tentativas = TENTATIVAS, dormir = espera } = opcoes;

  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      if (n >= tentativas - 1 || !reconectavel(e, leitura)) throw e;
      console.warn(`[rede] ${rotulo}: ${codigoDeRede(e)} — tentativa ${n + 2}/${tentativas}`);
      await dormir(atrasoBackoff(n));
    }
  }
}
