/**
 * O relógio do sistema sobre si mesmo (slice 8).
 *
 * A fatia inteira existe para que o tempo entre o toque em parar e a revisão
 * abrir deixe de ser impressão e passe a ser um número gravado, sessão por
 * sessão, para sempre. Até aqui a previsão era "de um a dois minutos para
 * segundos", e previsão não é medição.
 *
 * **Três objetos, e o que impede o registro de inchar é a forma, não a
 * disciplina:**
 *
 *   sessoes/<id>/medidas.json   o detalhe daquela sessão. Passos e agentes são
 *                               **agregados**, não uma lista de eventos, e as
 *                               falhas têm teto: o tamanho máximo é conhecido.
 *                               Morre com a sessão (`chavesDaSessao`).
 *   medidas/indice.json         uma linha por sessão, com os números de
 *                               manchete. Podado por teto, como as correções.
 *                               **Sobrevive a apagar a sessão**, de propósito.
 *   medidas/<AAAA-MM>.json      o resumo do mês, escrito pela batida diária
 *                               **antes** da poda. Doze objetos por ano.
 *
 * **O que entra:** tempo por passo, falha (o que quebrou e por quê) e custo
 * (chamadas por agente, e tokens quando o Gateway devolve). **O que não entra:**
 * campo sem pergunta atrás. Cada número gravado responde a uma pergunta que eu
 * de fato faço — "onde foi o tempo", "isso piorou desde a emenda", "quantas
 * janelas ficaram para trás". Log de depuração genérico é o que apodrece.
 *
 * **Texto livre de erro fica no objeto da sessão**, que é limitado e some com
 * ela; o índice guarda código e contagem. É onde esse tipo de registro sempre
 * incha.
 *
 * **Como a instrumentação chega aos passos sem atravessar quinze assinaturas.**
 * `comMedicao` abre um `AsyncLocalStorage` no `waitUntil` que começa o trabalho,
 * e `medir`/`medirAgente`/`registrarFalha` escrevem no coletor daquele contexto.
 * **Fora de um contexto as três são transparentes** — chamam a função e devolvem
 * o resultado, sem tocar em rede nenhuma —, e é isso que faz o `pnpm test`
 * continuar exercitando `finalizarSessao` e `extrairSessao` sem gravar medida
 * nenhuma, e o chat, o confronto e o enriquecimento não pagarem por um registro
 * que não é deles.
 *
 * **Nada aqui pode derrubar o pipeline.** Uma falha ao gravar a medida vira uma
 * linha `[medidas]` no log e nada mais: o diário não pode ser perdido porque o
 * cronômetro tropeçou.
 *
 * **Relógios.** As três marcas do cliente vêm todas do relógio do navegador, e
 * é entre elas que a subtração acontece. Os passos do servidor são gravados como
 * **duração**, nunca como carimbo, justamente para que "instante do servidor
 * menos instante do cliente" não seja uma conta possível.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { chaveIndiceMedidas, chaveMedidas, chaveResumoMensal } from "./chaves";
import { atualizarJson } from "./etag";
import { ehLimiteDeTaxa } from "./limite";
import { carregarManifest } from "./manifest";
import { getJson, putJson } from "./r2";
import { codigoDeRede } from "./rede";
import { buscarSessao } from "./sessoes";
import { TETO_FALHAS_POR_SESSAO, TETO_LINHAS_MEDIDA, TETO_MOTIVO } from "./tipos";
import type {
  AgenteId,
  CaminhoDeEntrada,
  CodigoDeFalha,
  CustoDoAgente,
  CustoDoPasso,
  FalhaMedida,
  IndiceDeMedidas,
  LinhaDeMedida,
  MarcasDoCliente,
  MedidasDaSessao,
  PassoMedido,
  Resumo,
  ResumoMensal,
} from "./tipos";

// ─────────────────────────────── puro ───────────────────────────────

export function medidasVazias(
  sessao_id: string,
  caminho: CaminhoDeEntrada = "gravacao",
  agora: string = new Date().toISOString(),
): MedidasDaSessao {
  return {
    sessao_id,
    criado_em: agora,
    atualizado_em: agora,
    caminho,
    cliente: {},
    passos: {},
    agentes: {},
    falhas: [],
  };
}

/**
 * O objeto como ele veio do R2, com os buracos tapados.
 *
 * Mesmo papel de `normalizarIndice` na calibração: o objeto é mais velho que o
 * tipo mais cedo do que se imagina, e quem recebesse `passos` ausente estouraria
 * no primeiro `Object.entries`.
 */
export function normalizarMedidas(
  cru: MedidasDaSessao | undefined,
  sessao_id: string,
  caminho: CaminhoDeEntrada = "gravacao",
  agora: string = new Date().toISOString(),
): MedidasDaSessao {
  const vazio = medidasVazias(sessao_id, caminho, agora);
  if (!cru || typeof cru !== "object") return vazio;

  return {
    ...vazio,
    ...cru,
    sessao_id,
    caminho: cru.caminho ?? caminho,
    cliente: cru.cliente ?? {},
    passos: cru.passos ?? {},
    agentes: cru.agentes ?? {},
    falhas: Array.isArray(cru.falhas) ? cru.falhas : [],
  };
}

const somarCusto = (a: CustoDoPasso | undefined, ms: number): CustoDoPasso => ({
  n: (a?.n ?? 0) + 1,
  ms: (a?.ms ?? 0) + ms,
  pior_ms: Math.max(a?.pior_ms ?? 0, ms),
});

const somarAgente = (a: CustoDoAgente | undefined, b: CustoDoAgente): CustoDoAgente => {
  const entrada = (a?.entrada ?? 0) + (b.entrada ?? 0);
  const saida = (a?.saida ?? 0) + (b.saida ?? 0);
  return {
    n: (a?.n ?? 0) + b.n,
    ms: (a?.ms ?? 0) + b.ms,
    // Ausente continua ausente: zero diria "o Gateway devolveu zero token", que
    // é diferente de "este provedor não conta token".
    ...(entrada > 0 ? { entrada } : {}),
    ...(saida > 0 ? { saida } : {}),
  };
};

/**
 * Funde no objeto gravado o que um contexto acumulou.
 *
 * Puro, e por isso pode rodar dentro do laço de etag, reaplicado a cada
 * conflito: dois `waitUntil` medindo a mesma sessão ao mesmo tempo somam em vez
 * de um apagar o outro.
 */
export function fundirMedidas(
  base: MedidasDaSessao,
  parte: {
    caminho?: CaminhoDeEntrada;
    cliente?: MarcasDoCliente;
    passos?: Partial<Record<PassoMedido, CustoDoPasso>>;
    agentes?: Partial<Record<AgenteId, CustoDoAgente>>;
    falhas?: readonly FalhaMedida[];
  },
  agora: string = new Date().toISOString(),
): MedidasDaSessao {
  const passos = { ...base.passos };
  for (const [nome, custo] of Object.entries(parte.passos ?? {}) as [PassoMedido, CustoDoPasso][]) {
    const atual = passos[nome];
    passos[nome] = {
      n: (atual?.n ?? 0) + custo.n,
      ms: (atual?.ms ?? 0) + custo.ms,
      pior_ms: Math.max(atual?.pior_ms ?? 0, custo.pior_ms),
    };
  }

  const agentes = { ...base.agentes };
  for (const [id, custo] of Object.entries(parte.agentes ?? {}) as [AgenteId, CustoDoAgente][]) {
    agentes[id] = somarAgente(agentes[id], custo);
  }

  return {
    ...base,
    caminho: parte.caminho ?? base.caminho,
    cliente: { ...base.cliente, ...parte.cliente },
    passos,
    agentes,
    // As mais novas primeiro, e o teto corta o fim: numa sessão que falhou em
    // cascata, o que eu quero ver é o que quebrou por último.
    falhas: [...(parte.falhas ?? []), ...base.falhas].slice(0, TETO_FALHAS_POR_SESSAO),
    atualizado_em: agora,
  };
}

/** Diferença entre duas marcas do cliente, quando as duas existem e fazem sentido. */
const entre = (a: number | undefined, b: number | undefined): number | null =>
  typeof a === "number" && typeof b === "number" && b >= a ? b - a : null;

/**
 * O detalhe de uma sessão virando a linha que fica para sempre.
 *
 * `duracao_s` e `blocos` vêm de fora porque não são da medida: são da sessão e
 * do manifest, e sem eles os números não se comparam — trinta segundos de fala e
 * dezessete minutos não pagam a mesma espera.
 */
export function linhaDaSessao(
  m: MedidasDaSessao,
  contexto: { duracao_s: number | null; blocos: number },
): LinhaDeMedida {
  const passos: Partial<Record<PassoMedido, number>> = {};
  for (const [nome, custo] of Object.entries(m.passos) as [PassoMedido, CustoDoPasso][]) {
    passos[nome] = Math.round(custo.ms);
  }

  let chamadas = 0;
  let tokens = 0;
  for (const custo of Object.values(m.agentes) as CustoDoAgente[]) {
    chamadas += custo.n;
    tokens += (custo.entrada ?? 0) + (custo.saida ?? 0);
  }

  return {
    sessao_id: m.sessao_id,
    em: m.criado_em,
    caminho: m.caminho,
    duracao_s: contexto.duracao_s,
    espera_ms: entre(m.cliente.parou, m.cliente.revisou),
    fila_ms: entre(m.cliente.parou, m.cliente.fila_vazia),
    servidor_ms: entre(m.cliente.fila_vazia, m.cliente.revisou),
    blocos: contexto.blocos,
    passos,
    chamadas,
    // Zero é ausência de contagem, não contagem zero: nenhum provedor deste
    // sistema devolve uma chamada de zero token.
    tokens: tokens > 0 ? tokens : null,
    falhas: m.falhas.length,
    codigos: [...new Set(m.falhas.map((f) => f.codigo))],
  };
}

export const indiceVazio = (agora: string = new Date().toISOString()): IndiceDeMedidas => ({
  linhas: [],
  atualizado_em: agora,
});

export function normalizarIndiceDeMedidas(
  cru: IndiceDeMedidas | undefined,
  agora: string = new Date().toISOString(),
): IndiceDeMedidas {
  if (!cru || typeof cru !== "object" || !Array.isArray(cru.linhas)) return indiceVazio(agora);
  return { linhas: cru.linhas, atualizado_em: cru.atualizado_em ?? agora };
}

/**
 * Põe a linha no índice — **substituindo** a daquela sessão, se já houver.
 *
 * Substituir e não acrescentar porque a linha é escrita duas vezes no caminho
 * normal: uma quando o servidor termina, e outra quando o navegador manda a
 * marca da revisão aberta, que é o número que importa. Duas linhas para a mesma
 * sessão fariam a mediana do mês contar a mesma sessão duas vezes.
 */
export function juntarLinha(
  indice: IndiceDeMedidas,
  linha: LinhaDeMedida,
  agora: string = new Date().toISOString(),
): IndiceDeMedidas {
  const outras = indice.linhas.filter((l) => l.sessao_id !== linha.sessao_id);
  return {
    linhas: [linha, ...outras].slice(0, TETO_LINHAS_MEDIDA),
    atualizado_em: agora,
  };
}

/** A mediana e o pior caso de uma lista pequena. `null` quando não há nada a resumir. */
export function resumir(valores: readonly number[]): Resumo | null {
  const limpos = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (limpos.length === 0) return null;

  const meio = Math.floor(limpos.length / 2);
  const mediana =
    limpos.length % 2 === 1 ? limpos[meio] : Math.round((limpos[meio - 1] + limpos[meio]) / 2);

  return { n: limpos.length, mediana: Math.round(mediana), pior: limpos[limpos.length - 1] };
}

/** `2026-09-17T…` → `2026-09`. É por aqui que uma linha acha o mês dela. */
export const mesDe = (iso: string): string => iso.slice(0, 7);

/** As linhas de um mês viram o objeto que fica depois de o detalhe sumir. */
export function resumoDoMes(
  mes: string,
  linhas: readonly LinhaDeMedida[],
  gerado_em: string = new Date().toISOString(),
): ResumoMensal {
  const numeros = (campo: (l: LinhaDeMedida) => number | null | undefined): number[] =>
    linhas.map(campo).filter((v): v is number => typeof v === "number");

  const passos: Partial<Record<PassoMedido, Resumo>> = {};
  const nomes = new Set<PassoMedido>(
    linhas.flatMap((l) => Object.keys(l.passos ?? {}) as PassoMedido[]),
  );
  for (const nome of nomes) {
    const r = resumir(numeros((l) => l.passos?.[nome]));
    if (r) passos[nome] = r;
  }

  const codigos: Partial<Record<CodigoDeFalha, number>> = {};
  for (const l of linhas) {
    for (const c of l.codigos ?? []) codigos[c] = (codigos[c] ?? 0) + 1;
  }

  return {
    mes,
    gerado_em,
    n: linhas.length,
    espera_ms: resumir(numeros((l) => l.espera_ms)),
    fila_ms: resumir(numeros((l) => l.fila_ms)),
    servidor_ms: resumir(numeros((l) => l.servidor_ms)),
    chamadas: resumir(numeros((l) => l.chamadas)),
    passos,
    falhas: linhas.reduce((t, l) => t + (l.falhas ?? 0), 0),
    codigos,
  };
}

/**
 * Por que uma coisa falhou, no vocabulário fechado do índice.
 *
 * As três classes de falha que o §5 nomeia, na ordem em que elas se reconhecem:
 * rate limit primeiro, porque ele chega embrulhado e a mensagem dele pode ter
 * qualquer cara; rede depois, pelo código dentro do `cause`; e o resto é
 * serviço, que é o que "repetir vai falhar igual" quer dizer.
 */
export function codigoDaFalha(e: unknown): CodigoDeFalha {
  if (ehLimiteDeTaxa(e)) return "limite";
  if (codigoDeRede(e)) return "rede";
  return "servico";
}

const cortar = (t: string) => (t.length <= TETO_MOTIVO ? t : `${t.slice(0, TETO_MOTIVO)}…`);

/**
 * Antes de quando este sistema existe. Serve de piso para "isto é um epoch?".
 *
 * A guarda é mínima de propósito: relógio de navegador erra minutos, não dez
 * anos, e o que ela barra é lixo — `0`, `NaN`, segundos em vez de milissegundos.
 * A defesa contra o relógio que andou para trás no meio da espera é outra, e
 * está em `entre`: marca fora de ordem vira `null`, nunca número negativo.
 */
const EPOCH_MIN = Date.UTC(2026, 0, 1);
const EPOCH_MAX = EPOCH_MIN + 50 * 365 * 864e5;

const ehInstante = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > EPOCH_MIN && v < EPOCH_MAX;

/**
 * As marcas plausíveis de um corpo de requisição, e só elas.
 *
 * Mora aqui e não na rota porque rota do App Router só pode exportar handler —
 * e porque isto é puro, e puro se testa.
 */
export function marcasDoCorpo(corpo: unknown): MarcasDoCliente {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const saida: MarcasDoCliente = {};
  for (const nome of ["parou", "fila_vazia", "revisou"] as const) {
    if (ehInstante(c[nome])) saida[nome] = c[nome];
  }
  return saida;
}

// ───────────────────────── o contexto e a coleta ─────────────────────────

interface Coletor {
  sessao_id: string;
  caminho: CaminhoDeEntrada;
  passos: Partial<Record<PassoMedido, CustoDoPasso>>;
  agentes: Partial<Record<AgenteId, CustoDoAgente>>;
  falhas: FalhaMedida[];
}

const contexto = new AsyncLocalStorage<Coletor>();

/** Só para o teste saber se está medindo. Ninguém do pipeline precisa perguntar. */
export const medindo = (): boolean => contexto.getStore() !== undefined;

/**
 * Cronometra `fn` como um passo, dentro do contexto corrente.
 *
 * **Transparente fora de um contexto**: devolve `fn()` sem mais nada. É o que
 * permite instrumentar no meio do pipeline sem que um teste que chame
 * `finalizarSessao` direto passe a falar com o R2.
 *
 * Conta o tempo **também quando `fn` estoura**: uma janela que falhou depois de
 * 90 s custou 90 s, e esconder isso faria a soma mentir exatamente no caso que
 * eu quero investigar.
 */
export async function medir<T>(passo: PassoMedido, fn: () => Promise<T>): Promise<T> {
  const c = contexto.getStore();
  if (!c) return fn();

  const inicio = Date.now();
  try {
    return await fn();
  } finally {
    c.passos[passo] = somarCusto(c.passos[passo], Date.now() - inicio);
  }
}

/** O que uma resposta do Gateway diz sobre o próprio custo, nas duas formas que ele usa. */
interface UsoDoModelo {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    /** `embed`/`embedMany` contam num campo só. */
    tokens?: number;
  };
}

function tokensDe(r: unknown): { entrada?: number; saida?: number } {
  const u = (r as UsoDoModelo | null)?.usage;
  if (!u || typeof u !== "object") return {};

  const entrada = typeof u.inputTokens === "number" ? u.inputTokens : u.tokens;
  const saida = typeof u.outputTokens === "number" ? u.outputTokens : undefined;
  return {
    ...(typeof entrada === "number" && entrada > 0 ? { entrada } : {}),
    ...(typeof saida === "number" && saida > 0 ? { saida } : {}),
  };
}

/**
 * Cronometra e conta **uma chamada de modelo**, por agente.
 *
 * É daqui que sai a conta que a sessão `mtqoeoqh3e3724514q1f` pagou sem ninguém
 * saber: quatro chamadas de modelo para entregar uma. Os tokens entram quando o
 * Gateway os devolve, e ficam ausentes quando não — ausência é informação, zero
 * seria mentira.
 *
 * **A chamada que falha conta igual**, porque ela custou igual.
 */
export async function medirAgente<T>(agente: AgenteId, fn: () => Promise<T>): Promise<T> {
  const c = contexto.getStore();
  if (!c) return fn();

  const inicio = Date.now();
  let r: T;
  try {
    r = await fn();
  } catch (e) {
    c.agentes[agente] = somarAgente(c.agentes[agente], { n: 1, ms: Date.now() - inicio });
    throw e;
  }
  c.agentes[agente] = somarAgente(c.agentes[agente], {
    n: 1,
    ms: Date.now() - inicio,
    ...tokensDe(r),
  });
  return r;
}

/**
 * Registra o que quebrou, e por quê.
 *
 * `codigo` só vai explícito quando o erro não se classifica sozinho — a janela
 * presa, o orçamento que acabou, o bloco que voltou vazio. O resto sai de
 * `codigoDaFalha`, que é a mesma taxonomia do §5.
 */
export function registrarFalha(
  passo: PassoMedido,
  erro: unknown,
  codigo?: CodigoDeFalha,
  agora: string = new Date().toISOString(),
): void {
  const c = contexto.getStore();
  if (!c) return;

  c.falhas.unshift({
    passo,
    codigo: codigo ?? codigoDaFalha(erro),
    motivo: cortar(erro instanceof Error ? erro.message : String(erro)),
    em: agora,
  });
  if (c.falhas.length > TETO_FALHAS_POR_SESSAO) c.falhas.length = TETO_FALHAS_POR_SESSAO;
}

// ───────────────────────────── com R2 ─────────────────────────────

/**
 * Abre um contexto de medição, cronometra `fn` como `passo` e grava no fim.
 *
 * Quem chama são os `waitUntil` das rotas do pipeline, e só eles: é lá que um
 * pedaço de trabalho começa e termina, e é por isso que **uma invocação escreve
 * uma vez**. Chamada dentro de um contexto que já existe, ela vira `medir` — o
 * `/finalizar` que emenda na extração não abre um segundo registro.
 *
 * `fecha` manda escrever também a linha do índice, e vale para o fim de um
 * trabalho: o `/finalizar` e o `/extrair`. O `/pronto` não fecha nada — ele
 * roda trinta vezes por sessão, e trinta idas ao índice seriam pagar trinta
 * vezes por uma linha que ainda vai mudar.
 *
 * **Uma falha aqui nunca sobe.** O resultado de `fn` é o que importa; a medida é
 * o que se perde.
 *
 * **E ela descarrega no meio do caminho, não só no fim** (18/09). Gravar apenas
 * no `finally` deixava a medida cega exatamente onde ela é mais necessária:
 * função morta pelo `maxDuration` não chega ao `finally`, e o registro inteiro
 * daquela invocação se perde. Foi o que aconteceu com a sessão
 * `mu73d88b0w4u6o5d440j` — `espera_blocos` e `concatenar` **rodaram**
 * (`transcricao.json` e o `finalizado: true` provam) e não estão no objeto,
 * porque o `/finalizar` foi morto no meio da chamada seguinte.
 *
 * O que continua faltando numa invocação morta é o passo **de fora** —
 * `finalizar`, `pronto` —, que por definição não terminou. E essa ausência é
 * informação: passo de fora que falta é invocação que não voltou.
 */
export async function comMedicao<T>(
  sessao_id: string,
  passo: PassoMedido,
  fn: () => Promise<T>,
  { caminho = "gravacao", fecha = false }: { caminho?: CaminhoDeEntrada; fecha?: boolean } = {},
): Promise<T> {
  if (contexto.getStore()) return medir(passo, fn);

  const c: Coletor = { sessao_id, caminho, passos: {}, agentes: {}, falhas: [] };

  // Uma descarga por vez: duas gravações simultâneas sobre a mesma chave
  // brigariam no laço por etag à toa, e cada uma leva um pedaço diferente.
  let fila: Promise<void> = Promise.resolve();
  const enfileirar = (fecha: boolean): Promise<void> => (fila = fila.then(() => gravar(c, fecha)));

  const relogio = setInterval(() => void enfileirar(false), INTERVALO_DESCARGA_MS);
  // O trabalho é quem segura a função viva, nunca o cronômetro dela.
  (relogio as unknown as { unref?: () => void }).unref?.();

  try {
    return await contexto.run(c, () => medir(passo, fn));
  } finally {
    clearInterval(relogio);
    await enfileirar(fecha);
  }
}

/**
 * De quanto em quanto tempo o coletor descarrega o que já mediu.
 *
 * Trinta segundos é o teto do que uma invocação morta pode levar embora, e o
 * piso do que ela custa: uma passada de `/pronto` típica dura segundos e não
 * paga descarga nenhuma; a de 300 s paga dez, contra um registro inteiro
 * perdido.
 */
export const INTERVALO_DESCARGA_MS = 30_000;

/**
 * Tira do coletor o que ele acumulou, deixando-o zerado.
 *
 * **Drenar, e não copiar**, porque `fundirMedidas` soma: mandar duas vezes o
 * mesmo acumulado contaria o mesmo trabalho duas vezes. Cada descarga leva o
 * pedaço novo, e o objeto no R2 é a soma de todos eles.
 */
function drenar(c: Coletor): {
  passos: Partial<Record<PassoMedido, CustoDoPasso>>;
  agentes: Partial<Record<AgenteId, CustoDoAgente>>;
  falhas: FalhaMedida[];
} {
  const parte = { passos: c.passos, agentes: c.agentes, falhas: c.falhas };
  c.passos = {};
  c.agentes = {};
  c.falhas = [];
  return parte;
}

async function gravar(c: Coletor, fecha: boolean): Promise<void> {
  const agora = new Date().toISOString();
  const parte = drenar(c);
  const vazio =
    Object.keys(parte.passos).length === 0 &&
    Object.keys(parte.agentes).length === 0 &&
    parte.falhas.length === 0;
  // Descarga periódica sem nada novo não paga GET+PUT. A do fim paga, porque é
  // ela que fecha a linha do índice.
  if (vazio && !fecha) return;

  try {
    const { valor } = await atualizarJson<MedidasDaSessao>(
      chaveMedidas(c.sessao_id),
      (cru) => normalizarMedidas(cru, c.sessao_id, c.caminho, agora),
      (m) => fundirMedidas(m, { caminho: c.caminho, ...parte }, agora),
      { rotulo: `as medidas de ${c.sessao_id}` },
    );
    // O objeto que acabou de ser gravado, e não uma releitura dele: é o mesmo
    // conteúdo, e reler seria pagar um GET para descobrir o que se acabou de
    // escrever.
    if (fecha) await fecharLinha(c.sessao_id, valor);
  } catch (e) {
    // Devolve o que não entrou: a descarga é no meio do trabalho agora, e um
    // PUT que falhou aqui não pode apagar o que ele levou. A próxima descarga
    // — ou a do fim — tenta de novo com este pedaço junto.
    devolver(c, parte);
    // O cronômetro não pode custar a sessão.
    console.error(`[medidas] sessão ${c.sessao_id}: não consegui gravar a medida:`, e);
  }
}

/** Põe de volta no coletor o pedaço que não conseguiu ser gravado. */
function devolver(c: Coletor, parte: ReturnType<typeof drenar>): void {
  for (const [nome, custo] of Object.entries(parte.passos) as [PassoMedido, CustoDoPasso][]) {
    const atual = c.passos[nome];
    c.passos[nome] = {
      n: (atual?.n ?? 0) + custo.n,
      ms: (atual?.ms ?? 0) + custo.ms,
      pior_ms: Math.max(atual?.pior_ms ?? 0, custo.pior_ms),
    };
  }
  for (const [id, custo] of Object.entries(parte.agentes) as [AgenteId, CustoDoAgente][]) {
    c.agentes[id] = somarAgente(c.agentes[id], custo);
  }
  c.falhas = [...c.falhas, ...parte.falhas].slice(0, TETO_FALHAS_POR_SESSAO);
}

/** O detalhe de uma sessão, como ele está no R2. `null` quando nunca foi medida. */
export async function medidasDaSessao(sessao_id: string): Promise<MedidasDaSessao | null> {
  const o = await getJson<MedidasDaSessao>(chaveMedidas(sessao_id));
  return o ? normalizarMedidas(o.valor, sessao_id) : null;
}

/**
 * Grava as marcas que só o navegador sabe dar, e fecha a linha do índice.
 *
 * Chamada pela rota que o cliente bate: o `parou` e a `fila_vazia` num pedido,
 * o `revisou` no outro. A linha é reescrita em toda marca porque é a marca da
 * revisão aberta que completa o número — e `juntarLinha` substitui a linha
 * daquela sessão em vez de acrescentar outra.
 */
export async function marcarCliente(
  sessao_id: string,
  marcas: MarcasDoCliente,
  caminho?: CaminhoDeEntrada,
): Promise<MedidasDaSessao> {
  const agora = new Date().toISOString();
  const { valor } = await atualizarJson<MedidasDaSessao>(
    chaveMedidas(sessao_id),
    (cru) => normalizarMedidas(cru, sessao_id, caminho, agora),
    (m) => fundirMedidas(m, { cliente: marcas, ...(caminho ? { caminho } : {}) }, agora),
    { rotulo: `as medidas de ${sessao_id}` },
  );

  await fecharLinha(sessao_id, valor).catch((e) => {
    console.error(`[medidas] sessão ${sessao_id}: não consegui fechar a linha:`, e);
  });
  return valor;
}

/**
 * Escreve (ou reescreve) a linha daquela sessão no índice.
 *
 * `duracao_s` sai do `:Sessao` e `blocos` do manifest, e nenhum dos dois é da
 * medida: sem eles os números não se comparam, porque trinta segundos de fala e
 * dezessete minutos não pagam a mesma espera. São duas leituras, e elas
 * acontecem no máximo três vezes por sessão — no fim do `/finalizar` e a cada
 * marca do cliente.
 */
export async function fecharLinha(
  sessao_id: string,
  medidas?: MedidasDaSessao,
): Promise<LinhaDeMedida | null> {
  const m = medidas ?? (await medidasDaSessao(sessao_id));
  if (!m) return null;

  const [sessao, manifest] = await Promise.all([
    buscarSessao(sessao_id).catch(() => null),
    carregarManifest(sessao_id).catch(() => null),
  ]);

  const linha = linhaDaSessao(m, {
    duracao_s: sessao?.duracao_s ?? null,
    blocos: manifest?.chunks.length ?? 0,
  });

  await atualizarJson<IndiceDeMedidas>(
    chaveIndiceMedidas(),
    (cru) => normalizarIndiceDeMedidas(cru),
    (i) => juntarLinha(i, linha),
    { rotulo: "o índice de medidas" },
  );

  return linha;
}

/** O índice inteiro, normalizado. Quem lê nunca vê o `valor` cru. */
export async function carregarIndiceDeMedidas(): Promise<IndiceDeMedidas> {
  const o = await getJson<IndiceDeMedidas>(chaveIndiceMedidas());
  return normalizarIndiceDeMedidas(o?.valor);
}

/** Um resumo mensal já gravado. É por ele que a batida diária decide se reescreve. */
export async function resumoMensalGravado(mes: string): Promise<ResumoMensal | null> {
  const o = await getJson<ResumoMensal>(chaveResumoMensal(mes));
  return o?.valor ?? null;
}

/**
 * Escreve o resumo de cada mês que ainda está no índice — a batida diária.
 *
 * Roda **antes** da poda no sentido que importa: enquanto as linhas de um mês
 * estiverem no índice, o resumo dele é reescrito todo dia e fica mais completo.
 * Quando a poda começar a comer aquele mês, o resumo já gravado tem mais sessões
 * que o índice ainda mostra — e aí ele **não** é reescrito. É essa guarda, e não
 * a ordem de execução, que faz o detalhe de março sumir e a linha de março ficar.
 *
 * Devolve os meses escritos, só para a linha de log do cron.
 */
export async function resumirMeses(
  agora: string = new Date().toISOString(),
): Promise<{ mes: string; n: number }[]> {
  const { linhas } = await carregarIndiceDeMedidas();
  if (linhas.length === 0) return [];

  const porMes = new Map<string, LinhaDeMedida[]>();
  for (const l of linhas) {
    const mes = mesDe(l.em);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) continue;
    porMes.set(mes, [...(porMes.get(mes) ?? []), l]);
  }

  const escritos: { mes: string; n: number }[] = [];
  for (const [mes, doMes] of porMes) {
    const gravado = await resumoMensalGravado(mes);
    if (gravado && gravado.n > doMes.length) continue;

    const resumo = resumoDoMes(mes, doMes, agora);
    await putJson(chaveResumoMensal(mes), resumo);
    escritos.push({ mes, n: resumo.n });
  }
  return escritos;
}
