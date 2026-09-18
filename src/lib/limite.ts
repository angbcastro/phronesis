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
 * 2. **Repetir depressa não ajuda — alimenta o limite.** O AI SDK repete
 *    sozinho (`maxRetries`), mas em segundos, e o que chegava aqui era o
 *    `RetryError` embrulhando o `GatewayRateLimitError` depois de três
 *    tentativas rápidas. Empilhado com as três esperas daqui, isso dava **nove
 *    chamadas 429 em ~2 min** — foi o que a sessão `mtqoeoqh3e3724514q1f`
 *    gastou para descobrir que o limite estava ativo. Por isso as três chamadas
 *    embrulhadas por este módulo (`stt.ts`, `extracao.ts`, `resolucao.ts`)
 *    passam `maxRetries: 0`: contra 429 a única repetição que destrava é a
 *    longa, que é a que está aqui. Quem **não** tem esta camada — `perfil.ts`,
 *    `calibracao.ts`, `duplicatas.ts` — continua com o retry do SDK, que lá é o
 *    único que existe e cobre o blip de rede.
 * 3. **A janela é de dezenas de segundos.** Uma espera de 75 s destravou o que
 *    três tentativas seguidas não destravaram. Daí `ESPERAS_MS`.
 *
 * **Desde a slice 8 são duas escadas, e não uma.** O módulo tratava tudo que não
 * fosse 429 como definitivo, e isso vinha do fato de ele ter nascido de uma
 * medição só. Um 502 do Gateway ou um socket que morreu no meio passam sozinhos
 * em segundos, e derrubar a janela por eles ficou caro quando o penhasco virou
 * erro: `ESPERAS_TRANSITORIA_MS` é a escada curta, com contador próprio, para um
 * blip de rede no começo não gastar a paciência que o 429 vai precisar depois.
 *
 * **O limite de 02/09 era do free tier**, e desde a compra de créditos ele não
 * reapareceu (§5.3). A escada longa fica porque o custo dela é zero enquanto o
 * limite não volta — e porque conta gratuita é um estado ao qual se pode voltar.
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
import { codigoDeRede } from "./rede";

/**
 * Quanto esperar antes de cada nova tentativa **de 429**. Duas esperas, não
 * cinco: o teto real é o `maxDuration` da rota que está segurando o `waitUntil`
 * (300 s), e `finalizarSessao` ainda precisa de tempo para a extração depois.
 */
export const ESPERAS_MS = [20_000, 60_000];

/** Uma tentativa a mais que o número de esperas. */
export const TENTATIVAS = ESPERAS_MS.length + 1;

/**
 * A outra escada, e ela é curta: segundos, não dezenas de segundos (slice 8).
 *
 * As esperas longas acima foram calibradas contra **uma** falha — o 429 do free
 * tier, medido em 02/09 —, e o módulo tratava todo o resto como definitivo: um
 * 502 do Gateway, um socket que morreu no meio da resposta, um `overloaded` do
 * provedor derrubavam a janela na primeira. Isso é caro pelo lado oposto: a
 * janela vai para `falhou`, e desde que o penhasco virou erro (§4.6) uma falha
 * boba de rede passa a custar a sessão inteira.
 *
 * Duas esperas de segundos consertam o blip sem nunca se confundir com o limite
 * de taxa, que é o único caso em que esperar **muito** é o conserto certo.
 */
export const ESPERAS_TRANSITORIA_MS = [1_000, 3_000];

export const TENTATIVAS_TRANSITORIA = ESPERAS_TRANSITORIA_MS.length + 1;

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

/**
 * Falha que **passa sozinha**, mas não é limite de taxa (slice 8).
 *
 * Três formas, e nenhuma delas importa pacote de provedor (regra 8): o código de
 * rede dentro do `cause`, que é o mesmo que `rede.ts` já sabe ler; o status 5xx
 * ou 408, que é o serviço dizendo "não fui eu, foi agora"; e o `overloaded` que
 * alguns provedores mandam com corpo em vez de status.
 *
 * **Fora desta lista nada é repetido**, e é a amarra que importa: um id de
 * modelo errado, um prompt que estoura o contexto e um JSON inválido falham
 * igual na segunda vez, e repetir só faz a tela esperar mais.
 */
export function ehTransitorio(e: unknown): boolean {
  return cadeia(e).some((alvo) => {
    if (codigoDeRede(alvo)) return true;
    if (alvo === null || typeof alvo !== "object") return false;
    const o = alvo as { statusCode?: unknown; type?: unknown; message?: unknown };
    if (typeof o.statusCode === "number" && (o.statusCode >= 500 || o.statusCode === 408)) {
      return true;
    }
    return (
      o.type === "overloaded_error" ||
      (typeof o.message === "string" && /\boverloaded\b/i.test(o.message))
    );
  });
}

/** A espera da tentativa `n` (0-based), com o mesmo jitter da fila de upload. */
export function esperaDoLimite(n: number, aleatorio: number = Math.random()): number {
  return comJitter(ESPERAS_MS, n, aleatorio);
}

/** A espera curta da tentativa `n`, para a falha que passa sozinha. */
export function esperaTransitoria(n: number, aleatorio: number = Math.random()): number {
  return comJitter(ESPERAS_TRANSITORIA_MS, n, aleatorio);
}

function comJitter(escada: readonly number[], n: number, aleatorio: number): number {
  const base = escada[Math.min(Math.max(n, 0), escada.length - 1)];
  return Math.round(base + base * 0.25 * aleatorio);
}

const dormirDeVerdade = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpcoesLimite {
  /** Tentativas contra o 429. A escada longa. */
  tentativas?: number;
  /** Tentativas contra a falha que passa sozinha. A escada curta. */
  tentativasTransitorias?: number;
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
 * Roda `fn`, esperando e repetindo enquanto valer a pena esperar.
 *
 * **Duas escadas, e a diferença é o diagnóstico** (slice 8). O 429 leva a escada
 * longa, de dezenas de segundos, porque foi isso que a medição de 02/09 mostrou
 * ser preciso. Qualquer outra falha transitória — conexão que caiu, 5xx do
 * Gateway, provedor sobrecarregado — leva a escada curta, de segundos: ela passa
 * sozinha depressa, e pagar 20 s por ela é atraso puro no meio da finalização.
 *
 * Os dois contadores são **separados** de propósito: um blip de rede no começo
 * não pode gastar a paciência que o 429 vai precisar depois.
 *
 * **O que não é nem um nem outro sobe na primeira.** Modelo inexistente, prompt
 * que estoura o contexto, resposta sem JSON: repetir vai falhar igual.
 */
export async function comEsperaDeLimite<T>(
  rotulo: string,
  fn: () => Promise<T>,
  opcoes: OpcoesLimite = {},
): Promise<T> {
  const {
    tentativas = TENTATIVAS,
    tentativasTransitorias = TENTATIVAS_TRANSITORIA,
    dormir = dormirDeVerdade,
    ate,
  } = opcoes;

  let deLimite = 0;
  let transitorias = 0;

  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const limite = ehLimiteDeTaxa(e);
      if (!limite && !ehTransitorio(e)) throw e;

      const n = limite ? deLimite : transitorias;
      const teto = limite ? tentativas : tentativasTransitorias;
      if (n >= teto - 1) throw e;

      const espera = limite ? esperaDoLimite(n) : esperaTransitoria(n);
      if (ate !== undefined && Date.now() + espera > ate) {
        console.warn(`[limite] ${rotulo}: sem orçamento para esperar ${Math.round(espera / 1000)}s`);
        throw e;
      }

      console.warn(
        limite
          ? `[limite] ${rotulo}: rate limit do Gateway — esperando ${Math.round(espera / 1000)}s,` +
              ` tentativa ${n + 2}/${teto}`
          : `[limite] ${rotulo}: falha transitória — esperando ${espera}ms,` +
              ` tentativa ${n + 2}/${teto}`,
      );
      await dormir(espera);

      if (limite) deLimite++;
      else transitorias++;
    }
  }
}
