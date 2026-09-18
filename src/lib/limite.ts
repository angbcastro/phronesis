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
 *
 * **E há uma quarta classe de falha, medida em 2026-09-18: a chamada que não
 * volta.** A sessão `mu73d88b0w4u6o5d440j` (203 s de fala) gastou 300.116 ms
 * numa única extração que o Gateway nunca respondeu, e morreu no `headersTimeout`
 * do undici — que é **300 s, o mesmo `maxDuration` da rota**. Quando esse teto
 * dispara não sobra orçamento nenhum para o `catch` gravar a falha, marcar a
 * sessão como `erro` ou tentar outro caminho: a função é morta no meio e a sessão
 * fica presa em `extraindo` para sempre, com a tela batendo. Tudo o mais naquela
 * sessão foi rápido — STT 7,2 s somados, catálogo 88 ms, camada semântica 513 ms.
 *
 * Daí o `AbortSignal` desta camada. Ela é quem tem o `ate`, então é quem sabe
 * quanto tempo uma chamada pode custar sem comer o orçamento de quem espera. O
 * prazo é **por tentativa**, não pelo conjunto: cada ida ao Gateway ganha o seu.
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
 * Quanto uma única chamada de modelo pode custar quando quem chama não tem prazo.
 *
 * O caso é a janela que fecha **durante a fala**, em `/chunks/:i/pronto`: ali
 * `avancarJanelas` vai sem `ate` de propósito, porque esperar o rate limit passar
 * é de graça enquanto eu ainda estou falando (§5.3). Só que "esperar é de graça"
 * vale para a espera **entre** tentativas, não para uma chamada pendurada: a rota
 * tem 300 s de `maxDuration` do mesmo jeito, e uma chamada só nunca pode comer a
 * função inteira — foi exatamente o que aconteceu em 18/09.
 *
 * **90 s, e o número vem da aritmética do orçamento.** Fica abaixo dos 120 s de
 * `ORCAMENTO_JANELAS_MS`, então na janela do fim quem manda continua sendo o
 * orçamento de quem chamou; e no `/pronto` deixa a corrente daquela passada —
 * STT, extração, resolução, os desempates em paralelo — caber nos 300 s.
 */
export const TETO_CHAMADA_MS = 90_000;

/**
 * O que fica reservado, dentro do `ate`, para o `catch` de quem chamou gravar.
 *
 * Um prazo que termina junto com o orçamento não serve de nada: é o defeito que
 * esta fatia conserta, só que menor. Quando a chamada é cortada, ainda falta
 * escrever `parcial.json`, o objeto de medidas e o estado da sessão — e os três
 * são laços por etag, que podem repetir.
 */
export const FOLGA_PARA_GRAVAR_MS = 5_000;

/**
 * A chamada não voltou no prazo, e fui eu quem a cortou.
 *
 * Existe para não se confundir com nada: **não é** limite de taxa e **não é**
 * falha transitória. Um `overloaded` passa sozinho em segundos e merece a escada
 * curta; uma chamada que ficou 90 s pendurada e foi cortada por mim já gastou
 * tudo o que havia para gastar, e repetir é a maneira de transformar um defeito
 * em três. Ela sobe na primeira, como o modelo inexistente e o JSON inválido.
 */
export class PrazoDeChamadaError extends Error {
  constructor(
    readonly rotulo: string,
    readonly prazo_ms: number,
    opcoes?: { cause?: unknown },
  ) {
    super(
      prazo_ms <= 0
        ? `${rotulo}: sem orçamento para chamar o modelo`
        : `${rotulo}: a chamada não voltou em ${Math.round(prazo_ms / 1000)}s`,
      opcoes,
    );
    this.name = "PrazoDeChamadaError";
  }
}

/** Foi o meu prazo que cortou esta chamada? Reconhece pela forma, como os outros dois. */
export function ehPrazoDeChamada(e: unknown): boolean {
  return cadeia(e).some(
    (alvo) =>
      alvo !== null &&
      typeof alvo === "object" &&
      (alvo as { name?: unknown }).name === "PrazoDeChamadaError",
  );
}

/**
 * O relógio de uma tentativa: um sinal que corta a chamada e a memória de quem
 * o disparou.
 *
 * `AbortSignal.timeout` faria o mesmo em uma linha e foi recusado por duas
 * coisas: o timer dele sobrevive à chamada que voltou depressa, e daqui não dá
 * para distinguir "estourou o meu prazo" de "o sinal veio de fora" — que é
 * justamente a pergunta que decide se o erro entra na escada ou sobe.
 */
function relogioDaChamada(ms: number): {
  sinal: AbortSignal;
  estourou: () => boolean;
  parar: () => void;
} {
  const controle = new AbortController();
  let estourou = false;
  const t = setTimeout(() => {
    estourou = true;
    controle.abort();
  }, ms);
  return { sinal: controle.signal, estourou: () => estourou, parar: () => clearTimeout(t) };
}

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
 *
 * **O meu próprio corte nunca entra aqui**, e a guarda é a primeira linha. Sem
 * ela o conserto viraria o defeito: `UND_ERR_HEADERS_TIMEOUT` já está em
 * `DEPOIS_DE_ABRIR` (`rede.ts`), então uma chamada pendurada seria lida como
 * blip de rede e repetida duas vezes — três chamadas de 90 s onde havia uma, e
 * no caminho sem `ate` a função morre antes de qualquer uma delas voltar.
 */
export function ehTransitorio(e: unknown): boolean {
  if (ehPrazoDeChamada(e)) return false;
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
   *
   * Desde 18/09 ele manda também no prazo **da chamada**, não só no da espera
   * entre tentativas: é a mesma pergunta — quanto tempo eu ainda tenho — feita
   * sobre a parte que de fato consumiu os 300 s daquela sessão.
   */
  ate?: number;
  /** Teto de uma chamada. Só se mexe nele em teste; o padrão é `TETO_CHAMADA_MS`. */
  tetoDaChamada?: number;
}

/**
 * Quanto esta tentativa pode durar: o que sobra do orçamento, nunca mais que o
 * teto. Sem `ate`, o teto sozinho — que é o caso da janela que fecha durante a
 * fala.
 */
export function prazoDaChamada(
  ate: number | undefined,
  teto: number = TETO_CHAMADA_MS,
  agora: number = Date.now(),
): number {
  if (ate === undefined) return teto;
  return Math.min(teto, ate - agora - FOLGA_PARA_GRAVAR_MS);
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
 *
 * **E toda tentativa vai com prazo** (18/09). `fn` recebe um `AbortSignal` e o
 * repassa ao `generateText`/`transcribe`; quando ele dispara, o erro que sobe é
 * `PrazoDeChamadaError`, que não é nem limite nem transitório e por isso não
 * ganha escada nenhuma. O sinal é **passado**, e não uma corrida por fora,
 * porque cortar o socket é o que faz a chamada terminar — e chamada que termina
 * é chamada que `medirAgente` consegue contar. Corrida por fora deixaria a
 * promessa pendurada e o custo dela fora do registro, justamente no caso que a
 * slice 8 existe para medir.
 *
 * Quem ignora o sinal continua sem teto, e é deliberado: o chat já traz o seu,
 * vindo do botão de cancelar da tela.
 */
export async function comEsperaDeLimite<T>(
  rotulo: string,
  fn: (sinal: AbortSignal) => Promise<T>,
  opcoes: OpcoesLimite = {},
): Promise<T> {
  const {
    tentativas = TENTATIVAS,
    tentativasTransitorias = TENTATIVAS_TRANSITORIA,
    dormir = dormirDeVerdade,
    ate,
    tetoDaChamada = TETO_CHAMADA_MS,
  } = opcoes;

  let deLimite = 0;
  let transitorias = 0;

  for (;;) {
    const prazo = prazoDaChamada(ate, tetoDaChamada);
    // Chamar sem orçamento é o jeito de a função morrer no meio em vez de
    // falhar: quem chamou já não tem tempo nem de gravar o que deu errado.
    if (prazo <= 0) {
      console.warn(`[limite] ${rotulo}: sem orçamento para chamar o modelo`);
      throw new PrazoDeChamadaError(rotulo, 0);
    }

    const relogio = relogioDaChamada(prazo);
    try {
      return await fn(relogio.sinal);
    } catch (e) {
      if (relogio.estourou()) {
        console.error(
          `[limite] ${rotulo}: a chamada não voltou em ${Math.round(prazo / 1000)}s — cortada.`,
        );
        throw new PrazoDeChamadaError(rotulo, prazo, { cause: e });
      }

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
    } finally {
      // O relógio é de **uma** tentativa: a próxima ganha o seu, com o que
      // sobrou do orçamento depois desta espera.
      relogio.parar();
    }
  }
}
