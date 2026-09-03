/**
 * O rate limit do AI Gateway, e a espera que o transforma em atraso em vez de
 * sessão perdida.
 *
 * **Medido em 2026-09-02**, na conta deste projeto, contra um bloco real:
 *
 *   GatewayRateLimitError: Free tier requests on this model are rate-limited.
 *
 * Três coisas que a medição mostrou, e que mudam o desenho:
 *
 * 1. **O limite é da conta, não do modelo.** Ele apareceu primeiro no
 *    `google/gemini-3.5-transcribe` e, na mesma janela, derrubou também o
 *    `xai/grok-stt` — que `ARCHITECTURE.md` §4.2.1 listava como "sem rate
 *    limit". Não adianta trocar de modelo para escapar.
 * 2. **O AI SDK já tentou e já desistiu.** Ele repete sozinho (`maxRetries`),
 *    mas em segundos; o que chega aqui é o `RetryError` que embrulha o
 *    `GatewayRateLimitError` depois de três tentativas rápidas. Repetir mais
 *    depressa não ajuda — só faz o limite durar mais.
 * 3. **A janela é de dezenas de segundos.** Uma espera de 75 s destravou o que
 *    três tentativas seguidas não destravaram. Daí `ESPERAS_MS`.
 *
 * Por que um módulo próprio, e não `rede.ts`: lá a pergunta é "o pedido chegou
 * a sair?", e a resposta decide se repetir duplica efeito. Aqui o pedido saiu,
 * foi recusado inteiro, e repetir é seguro — o que falta é **quando**. São
 * regras diferentes sobre erros diferentes, e juntá-las faria `rede.ts`
 * classificar 429 como "erro do serviço: nunca repete", que é o oposto do certo.
 *
 * **Nada aqui importa `@ai-sdk/gateway`** (regra inviolável 8: nenhum pacote de
 * provedor nas dependências). O erro é reconhecido pela forma — `name`, `type`,
 * `statusCode` —, como `modelos.ts` faz com `RespostaDoModelo`. Se o SDK mudar
 * o formato, `tests/limite.test.ts` é quem avisa.
 */
import { atrasoBackoff } from "./backoff";

/**
 * Quanto esperar antes de cada nova tentativa. Duas esperas, não cinco: o teto
 * real é o `maxDuration` da rota que está segurando o `waitUntil` (300 s), e
 * `finalizarSessao` ainda precisa de tempo para a extração depois.
 */
export const ESPERAS_MS = [20_000, 60_000];

/** Uma tentativa a mais que o número de esperas. */
export const TENTATIVAS = ESPERAS_MS.length + 1;

/**
 * O erro vem embrulhado: `RetryError` do AI SDK guarda o original em
 * `lastError` e a lista em `errors`, e cada camada pode ter `cause`. Procurar
 * só na superfície acharia "Failed after 3 attempts" e mais nada.
 */
function cadeia(e: unknown, profundidade = 0): unknown[] {
  if (e === null || typeof e !== "object" || profundidade > 5) return [e];

  const o = e as { lastError?: unknown; errors?: unknown; cause?: unknown };
  const filhos = [
    ...(Array.isArray(o.errors) ? o.errors : []),
    ...(o.lastError === undefined ? [] : [o.lastError]),
    ...(o.cause === undefined ? [] : [o.cause]),
  ];

  return [e, ...filhos.flatMap((f) => cadeia(f, profundidade + 1))];
}

/**
 * É o Gateway dizendo "devagar"?
 *
 * Reconhece pela forma, em três sinais independentes, porque o SDK constrói o
 * erro com os três e nenhum deles é garantido a sobreviver a um embrulho:
 * `name`, `type` e `statusCode`. A mensagem é o último recurso.
 */
export function ehLimiteDeTaxa(e: unknown): boolean {
  return cadeia(e).some((alvo) => {
    if (alvo === null || typeof alvo !== "object") return false;
    const o = alvo as { name?: unknown; type?: unknown; statusCode?: unknown; message?: unknown };
    return (
      o.name === "GatewayRateLimitError" ||
      o.type === "rate_limit_exceeded" ||
      o.statusCode === 429 ||
      (typeof o.message === "string" && /\brate[- ]?limit/i.test(o.message))
    );
  });
}

/** A espera da tentativa `n` (0-based), com o mesmo jitter da fila de upload. */
export function esperaDoLimite(n: number, aleatorio: number = Math.random()): number {
  const base = ESPERAS_MS[Math.min(Math.max(n, 0), ESPERAS_MS.length - 1)];
  return Math.round(base + base * 0.25 * aleatorio);
}

const dormirDeVerdade = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpcoesLimite {
  tentativas?: number;
  /** Injetável no teste, para não dormir de verdade. */
  dormir?: (ms: number) => Promise<unknown>;
  /**
   * Instante (epoch ms) depois do qual não vale mais esperar. Quem chama dentro
   * de um `waitUntil` com prazo — `finalizarSessao` — passa o seu, para a espera
   * não comer o orçamento inteiro da função e o bloco morrer sem sequer o log.
   */
  ate?: number;
}

/**
 * Roda `fn`, esperando e repetindo enquanto o erro for rate limit do Gateway.
 * Qualquer outro erro sobe na primeira — este módulo tem uma opinião só.
 */
export async function comEsperaDeLimite<T>(
  rotulo: string,
  fn: () => Promise<T>,
  opcoes: OpcoesLimite = {},
): Promise<T> {
  const { tentativas = TENTATIVAS, dormir = dormirDeVerdade, ate } = opcoes;

  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      if (n >= tentativas - 1 || !ehLimiteDeTaxa(e)) throw e;

      const espera = esperaDoLimite(n);
      if (ate !== undefined && Date.now() + espera > ate) {
        console.warn(`[limite] ${rotulo}: sem orçamento para esperar ${Math.round(espera / 1000)}s`);
        throw e;
      }

      console.warn(
        `[limite] ${rotulo}: rate limit do Gateway — esperando ${Math.round(espera / 1000)}s,` +
          ` tentativa ${n + 2}/${tentativas}`,
      );
      await dormir(espera);
    }
  }
}
