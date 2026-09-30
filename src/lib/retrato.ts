/**
 * O agente `retrato-1` — o retrato do "eu" — e a rodada que o escreve
 * (slice 10).
 *
 * **Por que o "eu" tem um retrato, e não a ficha.** A ficha de quatro campos
 * serve às outras entidades e não serve a ele: 85% dos átomos ativos são do
 * "eu" (128 de 151 em 23/09), ele é sujeito de todo `SENTIMENTO`,
 * `APRENDIZADO`, `HISTORIA` e `ROTINA` por regra da extração, e a ficha dele
 * saiu com 1391 caracteres a partir de ~49 mil — `fizemos_juntos` vazio, porque
 * não existe "o que fiz junto comigo mesmo". E os campos de perfil viram o
 * vetor da entidade: um retrato longo neles estouraria a entrada do modelo de
 * embedding e derrubaria o lote de vetores de **todas** as entidades.
 *
 * **Onde mora.** O retrato é texto longo, e vai para o R2 (`retrato/eu.json`),
 * com uma geração anterior (`retrato/eu.anterior.json`) para o desfazer. O nó
 * "eu" continua com `resumo` e `contexto` **curtos**, escritos na fase 1 da
 * mesma rodada — o vetor, a listagem de `/entidades` e o `buscar_entidades` do
 * chat não mudam. `pode_ajudar_com` e `fizemos_juntos` do "eu" são gravados
 * vazios (o que estava lá vai para o `_anterior`).
 *
 * **O prompt tem duas partes, e a ordem é o desenho.** Um prefixo comum — as
 * regras de escrita e TODOS os átomos do "eu", numerados — igual em toda chamada
 * da rodada, e um sufixo com a tarefa e o formato daquela chamada. O formato
 * mora no sufixo porque são três (`{resumo, contexto}`, `{texto, fontes}`,
 * `{dimensoes}`), e qualquer coisa que muda entre chamadas antes dos átomos
 * quebra o cache do provedor no primeiro byte diferente. Medido em 23/09: a
 * segunda chamada com o mesmo bloco leu 14.080 dos 14.128 tokens de entrada do
 * cache, que custa ~40× menos.
 *
 * Por isso a rodada tem duas fases:
 *
 *   1. `resumo` + `contexto`, sozinha — ela escreve o cache;
 *   2. o Agora e cada dimensão, em paralelo — todas leem o cache.
 *
 * **Paralelo não está medido.** Os 14.080 de 23/09 vieram de duas chamadas em
 * sequência; com sete a treze ao mesmo tempo, o Gateway pode distribuí-las por
 * backends diferentes, e o cache de um não serve ao outro. O log de cada chamada
 * diz `cache=` (`diagnostico`) — é onde se olha.
 *
 * **O estado só vira `pronta` no fim.** Fase 1 grava os campos do nó sem tocar
 * no estado; fase 2 grava `eu.anterior.json` e depois `eu.json`; só então
 * `pronta`. Morrer em qualquer ponto antes deixa o "eu" em `rodando`, e o lease
 * o traz de volta.
 */
import { generateText } from "ai";
import { chaveRetrato, chaveRetratoAnterior } from "./chaves";
import type { EntidadeDoGrafo } from "./entidades";
import {
  CHAVE_EU,
  TETO_MOTIVO,
  desfazerFicha,
  gravarFicha,
  marcarPronta,
  type AtomoDaEntidade,
  type EntidadeEscrita,
  type Rodada,
} from "./enriquecimento";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloRetrato,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { query } from "./neo4j";
import { carimbo, efetivo } from "./overrides";
import { getJson, putJson } from "./r2";
import {
  RetratoError,
  gravarSugestao,
  lerConfigRetrato,
  proporDimensoes,
} from "./retrato-dimensoes";
import { ID_AGORA, TETO_RESUMO } from "./tipos";
import type {
  ConfigRetrato,
  DimensaoDoRetrato,
  RetratoDoEu,
  SecaoDoRetrato,
  TipoAtomo,
} from "./tipos";

export { RetratoError };

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_RETRATO = "retrato-1";

/** Quantas fontes uma seção guarda. É o que o (i) mostra. */
export const MAX_FONTES = 8;

/**
 * O teto do `contexto` do nó "eu". O `resumo` já tem o seu (`TETO_RESUMO`).
 *
 * É o que mantém o vetor do "eu" do tamanho do das outras entidades: os campos
 * de perfil entram na string canônica que vira embedding (`fonteDaEntidade`), e
 * foi o risco de estourá-la que tirou o retrato do nó.
 */
export const TETO_CONTEXTO_EU = 800;

/** Quanto da resposta crua entra no log quando o parse falha. */
const AMOSTRA_ERRO = 400;

// ──────────────────────── o prefixo comum ────────────────────────

/**
 * As regras de escrita — a parte do prefixo que o painel edita.
 *
 * **"Só afirme o que os trechos sustentam" é a regra que mais importa**, pela
 * mesma razão da 4.12: ninguém revisa antes de gravar. A defesa é a mesma
 * também: eu leio depois, e o desfazer está a um toque.
 *
 * Os formatos não moram aqui: são sufixos fixos no código, porque três parsers
 * dependem deles. Por isso o envelope deste agente é vazio.
 */
export const INSTRUCOES = `Você escreve o retrato do dono de um diário pessoal falado — quem ele é, a partir de tudo o que ele mesmo registrou. Abaixo estão TODOS os trechos do diário que falam dele, numerados, do mais novo para o mais velho. Cada chamada pede uma parte do retrato; a tarefa e o formato vêm depois dos trechos.

REGRAS
- SÓ AFIRME O QUE OS TRECHOS SUSTENTAM. Não deduza, não complete com o que "costuma ser", não generalize a partir de um trecho só. Ninguém revisa este texto antes de ele ser gravado.
- Escreva na terceira pessoa, direto, sem floreio. É uma anotação para ser lida rápido, não um perfil elogioso.
- O que se repete importa mais do que o que apareceu uma vez.
- Trecho mais novo vence trecho mais velho quando os dois se contradizem — e a mudança é informação: diga que mudou, e quando.
- Datas por mês e ano ("em agosto de 2026", "desde julho de 2026"). Nunca o dia, e nunca o número do trecho dentro do texto.
- Sem material para o que foi pedido, a resposta é vazia. Vazio é resposta legítima; inventar para preencher é o pior que você pode fazer aqui.`;

/**
 * O bloco de átomos do retrato: **numerado**, e o número volta como fonte.
 *
 * Próprio do retrato, e não o `blocoDeAtomos` da ficha: aquele monta o prompt
 * de toda ficha, e numerá-lo mudaria o `enriquecimento-1` sem subir a versão.
 * A linha `n` é o átomo `ids[n-1]`; o id fica fora do prompt — o modelo cita
 * números curtos, e o código devolve o id.
 */
export function blocoNumerado(atomos: readonly AtomoDaEntidade[]): {
  bloco: string;
  ids: string[];
} {
  const linhas = atomos.map((a, i) => {
    const quando = a.valido_em === "" ? "" : ` ${a.valido_em.slice(0, 10)}`;
    return `${i + 1}. [${a.tipo}${quando}]${a.sobre ? "" : " (citado)"} ${a.texto}`;
  });
  return { bloco: linhas.join("\n"), ids: atomos.map((a) => a.id) };
}

/** O prefixo: igual, byte a byte, em toda chamada de uma rodada. */
export function montarPrefixo(regras: string, bloco: string, quantos: number): string {
  return `${regras}

TUDO O QUE O DIÁRIO DIZ DO DONO (${quantos} trecho(s), numerados, do mais novo para o mais velho):
${bloco}`;
}

// ──────────────────────── os sufixos ────────────────────────

/** A fase 1: os dois campos curtos do nó. */
export const SUFIXO_FICHA = `TAREFA DESTA CHAMADA: A FICHA CURTA

Escreva dois campos curtos sobre o dono do diário. Eles são lidos por outros agentes a cada gravação e viram o vetor de busca dele — por isso curtos.

resumo — quem ele é, em poucas frases: o que faz, onde está, o que o ocupa. No máximo ${TETO_RESUMO} caracteres.
contexto — o momento de vida dele: a situação, o que está acontecendo. No máximo ${TETO_CONTEXTO_EU} caracteres.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"resumo":"...","contexto":"..."}`;

const FORMATO_SECAO = `texto — tão longo quanto o material pede, e não mais. Pode ter parágrafos.
fontes — os números dos trechos PRINCIPAIS que sustentam o texto, no máximo ${MAX_FONTES}. Só números que aparecem na lista acima.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"texto":"...","fontes":[12,40]}`;

/** O Agora: as últimas ~4 semanas antes do átomo mais recente. */
export function sufixoAgora(ultimo: string): string {
  const quando = ultimo === "" ? "" : ` (o mais recente é de ${ultimo.slice(0, 10)})`;
  return `TAREFA DESTA CHAMADA: A SEÇÃO "AGORA"

O momento atual do dono do diário: o que o ocupa, como ele está, o que está em jogo. Olhe sobretudo os trechos das quatro semanas antes do mais recente${quando}; os mais velhos só entram para dizer o que mudou até aqui.

${FORMATO_SECAO}`;
}

/** Uma dimensão: o que é hoje, e o que mudou, com mês e ano. */
export function sufixoDimensao(d: DimensaoDoRetrato): string {
  const entra = d.o_que_entra === "" ? "" : `\nO que entra nesta seção: ${d.o_que_entra}\n`;
  return `TAREFA DESTA CHAMADA: A SEÇÃO "${d.nome}"
${entra}
Escreva o que ele é hoje nesta dimensão e o que mudou, com mês e ano. Comece pelo presente; a mudança vem depois, em ordem. Use só os trechos que pertencem a esta dimensão e ignore os outros. Se nenhum trecho pertence a ela, texto vazio e fontes vazias.

${FORMATO_SECAO}`;
}

// ──────────────────────── o que volta ────────────────────────

function isolarJson(bruto: string): Record<string, unknown> {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) {
    throw new RetratoError(`resposta sem JSON reconhecível: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }
  try {
    return JSON.parse(semCerca.slice(inicio, fim + 1)) as Record<string, unknown>;
  } catch (e) {
    throw new RetratoError(
      `JSON inválido: ${e instanceof Error ? e.message : String(e)} — ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }
}

const limpo = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A fase 1. Os dois vazios são recusados: gravar isso por cima seria perda. */
export function parsearFichaCurta(bruto: string): { resumo: string; contexto: string } {
  const v = isolarJson(bruto);
  const ficha = {
    resumo: limpo(v.resumo).slice(0, TETO_RESUMO),
    contexto: limpo(v.contexto).slice(0, TETO_CONTEXTO_EU),
  };
  if (ficha.resumo === "" && ficha.contexto === "") {
    throw new RetratoError(`os dois campos voltaram vazios: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }
  return ficha;
}

/**
 * Uma seção: o texto, e as fontes de número para id.
 *
 * **Número que não existe no bloco é descartado**, e quantos saem no retorno —
 * o log diz. Aceita número e string de número (`"12"`): modelo que cita entre
 * aspas citou do mesmo jeito. Texto vazio é resposta legítima — a dimensão sem
 * material — e aí as fontes vão vazias também: fonte sem texto não sustenta nada.
 */
export function parsearSecao(
  bruto: string,
  ids: readonly string[],
): { texto: string; fontes: string[]; descartadas: number } {
  const v = isolarJson(bruto);
  const texto = limpo(v.texto);
  const cruas = Array.isArray(v.fontes) ? v.fontes : [];
  if (texto === "") return { texto: "", fontes: [], descartadas: 0 };

  const fontes: string[] = [];
  let descartadas = 0;
  for (const f of cruas) {
    const n = typeof f === "number" ? f : typeof f === "string" ? Number(f.trim()) : NaN;
    const id = Number.isInteger(n) && n >= 1 && n <= ids.length ? ids[n - 1] : undefined;
    if (!id) {
      descartadas++;
      continue;
    }
    if (!fontes.includes(id) && fontes.length < MAX_FONTES) fontes.push(id);
  }
  return { texto, fontes, descartadas };
}

// ──────────────────────── a chamada ────────────────────────

interface Chamada {
  texto: string;
  modelo: string;
}

/**
 * Uma chamada da rodada. Mesma disciplina do agente 4: sem teto de saída
 * (4.12.1), `length` é erro com diagnóstico e não segunda chamada, e a espera
 * de rate limit não tem prazo — não há ninguém do outro lado da tela.
 */
async function chamar(rotulo: string, modelo: string, prompt: string): Promise<Chamada> {
  const inicio = Date.now();
  const r = await comEsperaDeLimite(`retrato ${rotulo} ${modelo}`, () =>
    generateText({
      // String de propósito: id em string sai pelo Gateway (regra 8).
      model: modelo,
      prompt,
      temperature: 0,
      maxRetries: 0,
    }),
  );
  console.log(`[retrato] ${rotulo}: ${Date.now() - inicio} ms — ${diagnostico(r)}`);

  if (faltouOrcamento(r)) {
    throw new RetratoError(
      `a resposta bateu o teto de saída do próprio modelo (${modelo}): ${diagnostico(r)}`,
    );
  }
  if (veioDoPensamento(r)) {
    console.warn(`[retrato] ${rotulo}: texto vazio, lendo o JSON do pensamento.`);
  }
  return { texto: textoDaResposta(r), modelo: r.response?.modelId ?? modelo };
}

// ──────────────────────── o R2 ────────────────────────

/** O retrato do R2 como ele deveria ser, ou `null`. Seção torta some. */
export function normalizarRetrato(cru: unknown): RetratoDoEu | null {
  if (!cru || typeof cru !== "object") return null;
  const r = cru as Partial<RetratoDoEu>;
  if (!r.secoes || typeof r.secoes !== "object") return null;

  const secoes: Record<string, SecaoDoRetrato> = {};
  for (const [id, s] of Object.entries(r.secoes)) {
    if (!s || typeof s !== "object" || typeof s.texto !== "string") continue;
    secoes[id] = {
      texto: s.texto,
      fontes: Array.isArray(s.fontes) ? s.fontes.filter((f): f is string => typeof f === "string") : [],
      atomos: typeof s.atomos === "number" ? s.atomos : 0,
      ate: typeof s.ate === "string" ? s.ate : "",
      prompt_version: typeof s.prompt_version === "string" ? s.prompt_version : "",
      modelo: typeof s.modelo === "string" ? s.modelo : "",
      escrito_em: typeof s.escrito_em === "string" ? s.escrito_em : "",
    };
  }
  return {
    secoes,
    escrito_em: typeof r.escrito_em === "string" ? r.escrito_em : "",
    atomos: typeof r.atomos === "number" ? r.atomos : 0,
    modelo: typeof r.modelo === "string" ? r.modelo : "",
  };
}

export async function lerRetrato(): Promise<RetratoDoEu | null> {
  const o = await getJson<RetratoDoEu>(chaveRetrato());
  return normalizarRetrato(o?.valor);
}

/** Existe geração anterior no R2? É metade do que acende o desfazer do "eu". */
export async function temRetratoAnterior(): Promise<boolean> {
  return normalizarRetrato((await getJson<RetratoDoEu>(chaveRetratoAnterior()))?.valor) !== null;
}

/**
 * A escrita da rodada: `eu.anterior.json` ← o atual, depois `eu.json` ← o novo.
 *
 * Morrer entre as duas deixa as duas iguais ao antigo: nada perdido, e o
 * desfazer vira no-op até a próxima rodada. A ordem inversa perderia o antigo.
 */
export async function escreverRetrato(novo: RetratoDoEu): Promise<void> {
  const atual = await getJson<RetratoDoEu>(chaveRetrato());
  if (atual && normalizarRetrato(atual.valor)) {
    await putJson(chaveRetratoAnterior(), atual.valor);
  }
  await putJson(chaveRetrato(), novo);
}

// ──────────────────────── a rodada ────────────────────────

/** O que a rodada leu, montado uma vez — o prefixo e a tradução número → id. */
interface Leitura {
  prefixo: string;
  ids: string[];
  /** `valido_em` do átomo mais recente: o `ate` de toda seção desta rodada. */
  ate: string;
}

function lerPrefixo(atomos: readonly AtomoDaEntidade[], regras: string): Leitura {
  const { bloco, ids } = blocoNumerado(atomos);
  return {
    prefixo: montarPrefixo(regras, bloco, atomos.length),
    ids,
    ate: atomos.find((a) => a.valido_em !== "")?.valido_em ?? "",
  };
}

/** Uma seção escrita, ou o motivo de não ter saído. */
type Resultado =
  | { id: string; ok: true; secao: SecaoDoRetrato }
  | { id: string; ok: false; motivo: string };

/**
 * A rodada do "eu", do começo ao fim. Chamada por `enriquecer()` quando a
 * entidade é o "eu" — o `{ chave }` da tela e o elo da fila passam por lá.
 *
 * **Falha parcial não derruba a rodada.** Uma dimensão que falha mantém o texto
 * anterior, o motivo vai para o log e para `enriquecimento_motivo`, e o estado
 * fica `pronta` com o motivo visível. **Falha da fase 1 é falha da rodada
 * inteira**: sobe, quem chama marca `falhou`, e nada é escrito no R2 — as
 * seções não se escrevem sobre um nó que ficou para trás.
 *
 * **A primeira rodada, sem dimensões aprovadas**, escreve a ficha curta e o
 * Agora, pede a proposta, e a tela me chama para aprovar.
 */
export async function rodadaDoEu(
  e: Pick<EntidadeDoGrafo, "nome" | "nome_normalizado">,
  atomos: readonly AtomoDaEntidade[],
  agora: Date = new Date(),
): Promise<Rodada> {
  garantirGateway();
  const comeco = Date.now();

  const [meu, config] = await Promise.all([
    efetivo("retrato", { prompt: INSTRUCOES, modelo: modeloRetrato() }),
    lerConfigRetrato(),
  ]);
  const versao = carimbo(PROMPT_VERSION_RETRATO, meu.hash);
  const { prefixo, ids, ate } = lerPrefixo(atomos, meu.prompt);

  // ── fase 1: sozinha, e é ela que escreve o cache ──
  const f1 = await chamar("ficha", meu.modelo, `${prefixo}\n\n${SUFIXO_FICHA}`);
  const curta = parsearFichaCurta(f1.texto);
  await gravarFicha(
    e.nome_normalizado,
    {
      resumo: curta.resumo,
      perfil: { contexto: curta.contexto, pode_ajudar_com: "", fizemos_juntos: "" },
    },
    atomos.length,
    agora,
    { semEstado: true },
  );
  const fase1 = Date.now() - comeco;

  // ── fase 2: o Agora e cada dimensão, em paralelo, lendo o cache ──
  const anterior = await lerRetrato();
  const pedidas: { id: string; rotulo: string; sufixo: string }[] = [
    { id: ID_AGORA, rotulo: "Agora", sufixo: sufixoAgora(ate) },
    ...config.dimensoes.map((d) => ({ id: d.id, rotulo: d.nome, sufixo: sufixoDimensao(d) })),
  ];

  const secoes = Promise.all(
    pedidas.map(async (p): Promise<Resultado> => {
      try {
        const r = await chamar(p.rotulo, meu.modelo, `${prefixo}\n\n${p.sufixo}`);
        const s = parsearSecao(r.texto, ids);
        if (s.descartadas > 0) {
          console.warn(`[retrato] ${p.rotulo}: ${s.descartadas} fonte(s) fora do bloco, descartada(s).`);
        }
        return {
          id: p.id,
          ok: true,
          secao: {
            texto: s.texto,
            fontes: s.fontes,
            atomos: atomos.length,
            ate,
            prompt_version: versao,
            modelo: r.modelo,
            escrito_em: agora.toISOString(),
          },
        };
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        console.error(`[retrato] ${p.rotulo} falhou — a seção fica com o texto anterior:`, err);
        return { id: p.id, ok: false, motivo: `${p.rotulo}: ${motivo}` };
      }
    }),
  );

  // A proposta roda junto, sobre o mesmo prefixo, quando é a rodada que pede:
  // nenhuma dimensão aprovada e nenhuma sugestão esperando por mim.
  const proposta =
    config.dimensoes.length === 0 && config.sugestao === null
      ? proporDimensoes(prefixo, config.dimensoes).then(
          (p) => gravarSugestao(p.dimensoes, agora.toISOString()).then(() => null),
          (err: unknown) => {
            console.error("[retrato] a proposta de dimensões falhou:", err);
            return `proposta de dimensões: ${err instanceof Error ? err.message : String(err)}`;
          },
        )
      : Promise.resolve(null);

  const [resultados, falhaDaProposta] = await Promise.all([secoes, proposta]);
  const fase2 = Date.now() - comeco - fase1;

  const novo: RetratoDoEu = {
    secoes: {},
    escrito_em: agora.toISOString(),
    atomos: atomos.length,
    modelo: f1.modelo,
  };
  const falhas: string[] = [];
  for (const r of resultados) {
    if (r.ok) {
      novo.secoes[r.id] = r.secao;
    } else {
      falhas.push(r.motivo);
      const velha = anterior?.secoes[r.id];
      if (velha) novo.secoes[r.id] = velha;
    }
  }
  if (falhaDaProposta) falhas.push(falhaDaProposta);

  await escreverRetrato(novo);

  // ── só agora `pronta` ──
  const motivo =
    falhas.length === 0 ? "" : `${falhas.length} parte(s) falharam: ${falhas.join("; ")}`;
  await marcarPronta(e.nome_normalizado, atomos.length, motivo.slice(0, TETO_MOTIVO), agora);

  const ok = resultados.filter((r) => r.ok).length;
  console.log(
    `[retrato] ${e.nome}: ${atomos.length} átomo(s), ${ok}/${resultados.length} seção(ões) — ` +
      `fase 1 ${fase1} ms, fase 2 ${fase2} ms, total ${Date.now() - comeco} ms — ${versao}`,
  );

  return {
    atomos: atomos.length,
    ficha: {
      resumo: curta.resumo,
      perfil: { contexto: curta.contexto, pode_ajudar_com: "", fizemos_juntos: "" },
      atomos: atomos.length,
      modelo: f1.modelo,
      prompt_version: versao,
    },
    retrato: { secoes: ok, falhas: falhas.length },
  };
}

/**
 * A proposta sozinha, pela tela: o mesmo prefixo, uma chamada, a sugestão
 * gravada ao lado da lista atual.
 */
export async function pedirProposta(
  atomos: readonly AtomoDaEntidade[],
  agora: Date = new Date(),
): Promise<ConfigRetrato> {
  if (atomos.length === 0) throw new RetratoError("nenhum átomo fala do \"eu\" ainda");
  garantirGateway();
  const [meu, config] = await Promise.all([
    efetivo("retrato", { prompt: INSTRUCOES, modelo: modeloRetrato() }),
    lerConfigRetrato(),
  ]);
  const { prefixo } = lerPrefixo(atomos, meu.prompt);
  const p = await proporDimensoes(prefixo, config.dimensoes);
  return gravarSugestao(p.dimensoes, agora.toISOString());
}

// ──────────────────────── o desfazer ────────────────────────

/** Desfazer com a rodada em `rodando` — a rota responde 409. */
export class RetratoOcupadoError extends RetratoError {
  constructor() {
    super("o retrato está sendo escrito agora — espere a rodada terminar para desfazer");
    this.name = "RetratoOcupadoError";
  }
}

/** Qual lado trocou. É o que a rota diz, e o que conserta à mão quando falha. */
export interface Desfeito {
  /** `eu.json` ↔ `eu.anterior.json` trocaram. */
  r2: boolean;
  /** Os quatro `_anterior` do nó trocaram — `null` quando não havia geração. */
  no: EntidadeEscrita | null;
}

/** O nó falhou depois de o R2 trocar. A mensagem diz qual lado trocou. */
export class DesfazerPelaMetadeError extends RetratoError {
  constructor(causa: string) {
    super(
      `o retrato no R2 foi trocado, mas o nó "eu" não: ${causa}. ` +
        `Tocar de novo não conserta — trocaria o R2 de volta e o nó para a frente.`,
    );
    this.name = "DesfazerPelaMetadeError";
  }
}

/**
 * O desfazer do "eu": **um botão, os dois lados** — os `_anterior` do nó e
 * `eu.json` ↔ `eu.anterior.json`. Uma rodada é uma coisa só, e desfazer meia
 * rodada deixaria o nó de uma geração e o retrato de outra.
 *
 * Mesma semântica da migration 010: uma geração, e é uma **troca** — um toque
 * acidental se conserta com outro. Ordem: o R2 primeiro, o nó depois.
 *
 * **A troca não é atômica** entre Neo4j e R2, nem dentro do R2 (são dois PUTs).
 * Se o nó falhar depois de o R2 trocar, sobe `DesfazerPelaMetadeError` dizendo
 * isso (§14).
 */
export async function desfazerRetrato(): Promise<Desfeito> {
  const estado = await query<{ estado: string | null }>(
    `MATCH (e:Entidade { nome_normalizado: $chave })
     RETURN e.enriquecimento_estado AS estado`,
    { chave: CHAVE_EU },
  );
  if (estado[0]?.estado === "rodando") throw new RetratoOcupadoError();

  const [atual, anterior] = await Promise.all([
    getJson<RetratoDoEu>(chaveRetrato()),
    getJson<RetratoDoEu>(chaveRetratoAnterior()),
  ]);

  let r2 = false;
  if (atual && anterior && normalizarRetrato(anterior.valor)) {
    // `If-Match`: uma rodada que escreveu entre a leitura e aqui ganha, e o
    // desfazer falha em vez de trocar o retrato novo por um de duas gerações.
    await putJson(chaveRetrato(), anterior.valor, atual.etag ? { ifMatch: atual.etag } : {});
    await putJson(chaveRetratoAnterior(), atual.valor);
    r2 = true;
  }

  let no: EntidadeEscrita | null;
  try {
    no = await desfazerFicha(CHAVE_EU);
  } catch (err) {
    if (!r2) throw err;
    throw new DesfazerPelaMetadeError(err instanceof Error ? err.message : String(err));
  }
  return { r2, no };
}

// ──────────────────────── o (i) ────────────────────────

/** Uma fonte como o (i) a mostra: o átomo pelo id, lido do grafo agora. */
export interface FonteDoRetrato {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  /**
   * `ativo`, `rejeitado` ou `arquivado`. O átomo que saiu depois **aparece
   * riscado, e não some**: o (i) diz o que sustentou a seção quando ela foi
   * escrita.
   */
  status: string;
}

/** Quantos ids uma leitura aceita: o (i) de uma seção são até `MAX_FONTES`. */
export const TETO_IDS_FONTES = 64;

/** As fontes, na ordem dos ids pedidos. Id que não existe mais some sem erro. */
export async function lerFontes(ids: readonly string[]): Promise<FonteDoRetrato[]> {
  const limpos = [...new Set(ids.filter((i) => typeof i === "string" && i !== ""))].slice(
    0,
    TETO_IDS_FONTES,
  );
  if (limpos.length === 0) return [];

  const linhas = await query<FonteDoRetrato>(
    `UNWIND $ids AS id
     MATCH (a:Atomo { id: id })
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em,
            coalesce(a.status, 'ativo') AS status`,
    { ids: limpos },
  );
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return limpos.flatMap((id) => (porId.has(id) ? [porId.get(id)!] : []));
}
