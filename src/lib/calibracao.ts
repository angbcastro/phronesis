/**
 * Onde as correções vivem: o R2, e só o R2.
 *
 * **Por que não o grafo.** A regra 2 já bastaria, e não vale uma migration para
 * isto. Mas o motivo forte é outro: o grafo é o que eu vivi; correção é o que o
 * pipeline errou. Um `:Atomo` dizendo "o modelo escreveu FATO onde era OPINIAO"
 * apareceria numa busca por "o que eu aprendi" e apodreceria a coisa que o
 * sistema existe para fazer.
 *
 * Dois objetos, com papéis diferentes:
 *
 *   sessoes/<id>/correcoes.json   o registro permanente daquela revisão — uma
 *                                 fotografia do momento da confirmação
 *   calibracao/indice.json        a mesa de trabalho, acumulada e podável, onde
 *                                 `incorporada_em` é autoritativo
 *
 * **Quando roda:** dentro do `waitUntil`, depois de a resposta já ter saído.
 * O que destrava o `router.push("/")` da revisão é a resposta HTTP; pagar idas
 * ao R2 nos 60 s da revisão por material de meta seria pagar no lugar errado.
 * `waitUntil` morto perde as correções daquela sessão, sem recuperação — custo
 * assumido, e o diário não perde nada: os átomos já estão no grafo.
 */
import { generateText } from "ai";
import { chaveCorrecoes, chaveIndiceCalibracao, chaveTranscricao } from "./chaves";
import { apurarCorrecoes, indiceVazio, juntarNoIndice } from "./correcoes";
import { secoesDoPrompt } from "./extracao";
import {
  garantirGateway,
  modeloCalibracao,
  textoDaResposta,
} from "./modelos";
import { carimbo, efetivo } from "./overrides";
import { criarLocalizador } from "./offsets";
import { ConflitoR2Error, getJson, putJson } from "./r2";
import { gravarVersao } from "./regras";
import { MAX_REGRAS } from "./tipos";
import type { AtomoConfirmado, EntidadeConfirmada } from "./correcoes";
import type {
  Correcao,
  Extracao,
  Gestos,
  IndiceCalibracao,
  Regra,
  Transcricao,
} from "./tipos";

/** Mesmo teto do manifest: a concorrência aqui é ainda menor que a de lá. */
const TENTATIVAS_INDICE = 6;

export async function carregarIndice(): Promise<IndiceCalibracao> {
  const o = await getJson<IndiceCalibracao>(chaveIndiceCalibracao());
  return o?.valor ?? indiceVazio(new Date().toISOString());
}

/**
 * Read-modify-write condicional por etag, com o laço de espera de
 * `atualizarManifest` — e não uma imitação sem ele.
 *
 * O mutador roda **dentro** de cada tentativa, sobre o que acabou de ser lido.
 * É o que faz duas escritas quase simultâneas se somarem em vez de a segunda
 * apagar a primeira: quem perde a corrida relê o corrente e reaplica.
 */
export async function atualizarIndice(
  mutador: (i: IndiceCalibracao) => IndiceCalibracao,
): Promise<IndiceCalibracao> {
  const key = chaveIndiceCalibracao();

  for (let tentativa = 0; tentativa < TENTATIVAS_INDICE; tentativa++) {
    const atual = await getJson<IndiceCalibracao>(key);
    const base = atual?.valor ?? indiceVazio(new Date().toISOString());
    const novo = mutador(base);

    if (novo === base && atual) return base; // nada mudou

    try {
      await putJson(key, novo, atual?.etag ? { ifMatch: atual.etag } : { ifNoneMatch: "*" });
      return novo;
    } catch (e) {
      if (!(e instanceof ConflitoR2Error)) throw e;
      await new Promise((r) => setTimeout(r, 40 * 2 ** tentativa + Math.random() * 40));
    }
  }
  throw new Error(`Não consegui gravar o índice de calibração após ${TENTATIVAS_INDICE} tentativas`);
}

/**
 * Registra que eu abri `/calibracao` de fato — é o relógio da sugestão (§5 da
 * spec), e olhar já conta, aprovando regra ou não.
 *
 * **Não cria o índice.** Sem índice não há correção em aberto, e sem correção
 * em aberto a sugestão nunca acende: gravar um objeto só para anotar a visita
 * a uma tela vazia seria escrever por escrever.
 */
export async function marcarVisita(agora: string = new Date().toISOString()): Promise<void> {
  const atual = await getJson<IndiceCalibracao>(chaveIndiceCalibracao());
  if (!atual) return;

  await atualizarIndice((i) => ({ ...i, visitado_em: agora }));
}

/**
 * O que o "faltou um" precisa para nascer ancorado.
 *
 * A transcrição só é lida quando há o que casar — o caso comum é não haver
 * nenhum faltante, e uma ida ao R2 por sessão para não usar nada seria
 * desperdício puro. `semAvancar` porque estes trechos não têm ordem entre si:
 * são coisas soltas que eu digitei, não a narrativa da sessão.
 */
async function localizadorDe(
  sessao_id: string,
  gestos: Gestos | null,
): Promise<((texto: string) => { inicio_s: number | null }) | undefined> {
  if (!gestos || gestos.faltantes.length === 0) return undefined;

  const t = await getJson<Transcricao>(chaveTranscricao(sessao_id));
  if (!t) return undefined;

  const localizar = criarLocalizador(t.valor.palavras);
  return (texto: string) => localizar.semAvancar(texto);
}

/**
 * Apura e guarda o que eu corrigi naquela revisão.
 *
 * Nunca toca o Neo4j, nunca bloqueia o confirmar, e uma falha aqui nunca
 * desfaz o que já foi gravado no grafo. Devolve quantas correções nasceram —
 * só para a linha de log de quem chamou.
 */
export async function capturarCorrecoes(entrada: {
  proposta: Extracao;
  confirmados: readonly AtomoConfirmado[];
  entidades: readonly EntidadeConfirmada[];
  gestos: Gestos | null;
  em?: string;
}): Promise<number> {
  const em = entrada.em ?? new Date().toISOString();
  const sessao_id = entrada.proposta.sessao_id;

  const correcoes = apurarCorrecoes({
    proposta: entrada.proposta,
    confirmados: entrada.confirmados,
    entidades: entrada.entidades,
    gestos: entrada.gestos,
    em,
    localizar: await localizadorDe(sessao_id, entrada.gestos),
  });

  await gravarRegistroDaSessao(sessao_id, correcoes, em);
  if (correcoes.length > 0) {
    await atualizarIndice((i) => juntarNoIndice(i, correcoes, em));
  }
  return correcoes.length;
}

/**
 * O registro permanente, com `ifNoneMatch` como toda escrita de uma-vez-só
 * deste sistema: reenviar o confirmar não sobrescreve o que já está lá.
 *
 * Grava mesmo quando não houve correção nenhuma. O objeto vazio é o que
 * distingue "revisei e não corrigi nada" de "o `waitUntil` morreu antes de
 * apurar" — e sem essa distinção não dá para confiar no que o índice não tem.
 */
async function gravarRegistroDaSessao(sessao_id: string, correcoes: Correcao[], em: string) {
  try {
    await putJson(
      chaveCorrecoes(sessao_id),
      { sessao_id, correcoes, em },
      { ifNoneMatch: "*" },
    );
  } catch (e) {
    // Já existe: a revisão foi confirmada uma vez, e aquele registro vale.
    if (!(e instanceof ConflitoR2Error)) throw e;
  }
}

// ─────────────────── o agente 4: rascunha, nunca escreve ───────────────────

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_CALIBRACAO = "calibracao-1";

/** Teto duro: mais que isto não é rascunho, é reescrita do prompt. */
export const MAX_REGRAS_POR_RASCUNHO = 2;

/** Quantas correções vão ao modelo. Além disso a proposta vira resumo de resumo. */
const TETO_CORRECOES_NO_PROMPT = 40;

/** Quanto de cada lado da correção entra no prompt. */
const TETO_TEXTO = 400;

export class CalibracaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibracaoError";
  }
}

/**
 * Uma regra proposta, ainda não aprovada.
 *
 * `id` é atribuído aqui e nunca muda: é ele que torna "sobreviveu à minha
 * edição" bem definido — sobreviveu é o id ainda estar entre os que eu submeto.
 * `texto` é o único campo que a tela deixa editar; `cita` é do agente e
 * imutável, porque é a procedência do que motivou a regra.
 */
export interface RegraRascunhada {
  id: string;
  texto: string;
  cita: string[];
  substitui?: string;
}

export const INSTRUCOES = `Você lê correções que o dono de um diário falado fez À MÃO, na tela de revisão, sobre o que um extrator automático propôs. Sua tarefa é propor no máximo ${MAX_REGRAS_POR_RASCUNHO} regras novas para o prompt desse extrator.

O QUE É UMA REGRA BOA
Uma instrução curta, no imperativo, dirigida a quem extrai. Não é a descrição da correção nem um resumo do que aconteceu: é o que o extrator deveria ter feito e não fez. Se você não consegue escrevê-la sem citar um caso específico, ela não é uma regra.

AMARRAS — todas obrigatórias
1. No máximo ${MAX_REGRAS_POR_RASCUNHO} regras. Menos é melhor. NENHUMA é uma resposta legítima e frequente: o prompt atual foi calibrado em cinco versões e está em bom estado, então uma regra ruim custa mais do que a ausência dela ganha.
2. NUNCA proponha uma regra a partir de uma correção só. Sem repetição não há padrão — há um caso, e generalizar um caso piora o extrator em todos os outros.
3. Toda regra cita, em "cita", os ids das correções que a motivam. Sem ids, a regra não existe.
4. Regra que contradiz uma seção existente diz qual, em "substitui".
5. CONSERTO DE GRAFIA NÃO VIRA REGRA. Quando a correção só troca a escrita de um nome próprio ou de uma palavra ("Beijing" virou "Behring", "Jean" virou "Giam"), quem errou foi a transcrição do áudio, não o extrator — ele copiou fielmente o que recebeu. Nenhuma instrução faz o extrator adivinhar um nome que nunca chegou até ele. Ignore essas correções por completo.
6. Não proponha regra que já esteja escrita nas seções existentes ou nas regras em vigor. Repetir instrução não a torna mais forte.

Se nada no material sustentar uma regra, devolva {"regras":[]}.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"regras":[{"texto":"...","cita":["id","id"],"substitui":"NOME DA SEÇÃO"}]}
"substitui" é opcional; omita quando a regra não contradisser nada.`;

const ROTULO_CORRECAO: Record<string, string> = {
  rejeitado: "rejeitei o átomo inteiro",
  texto: "reescrevi o texto do átomo",
  tipo: "troquei o tipo do átomo",
  sujeito: "troquei o sujeito do átomo",
  mencao_adicionada: "acrescentei uma menção que faltava",
  mencao_removida: "tirei uma menção",
  entidade_recusada: "recusei uma entidade que o extrator listou",
  entidade_tipo: "corrigi o tipo proposto para a entidade",
  faltou: "isto foi dito e nenhum átomo cobriu",
};

const corta = (t: string) => (t.length <= TETO_TEXTO ? t : `${t.slice(0, TETO_TEXTO)}…`);

/** Uma correção como o agente a lê: o que eu fiz, e os dois lados. */
export function descreverCorrecao(c: Correcao): string {
  const partes = [`[${c.id}] ${ROTULO_CORRECAO[c.tipo] ?? c.tipo}`];
  if (c.tipo_atomo) partes.push(`tipo do átomo: ${c.tipo_atomo}`);
  if (c.antes !== "") partes.push(`veio: "${corta(c.antes)}"`);
  partes.push(c.depois !== "" ? `ficou: "${corta(c.depois)}"` : "ficou: (nada — foi removido)");
  return partes.join("\n  ");
}

/**
 * O `calibracao-1` propõe. **Não escreve nada** — devolve as regras e para.
 *
 * Mesmo molde do agente 3 (`perfil.rascunhar`), e pela mesma razão: o que ele
 * toca é a coisa que produz todo o resto. Perfil rascunhado errado contamina a
 * resolução; regra rascunhada errada contamina toda extração futura. Quem grava
 * é `POST /api/calibracao/regras`, e só com o meu toque.
 */
export async function rascunharRegras(
  correcoes: readonly Correcao[],
  emVigor: readonly Regra[],
): Promise<{
  regras: RegraRascunhada[];
  correcoes: number;
  modelo: string;
  prompt_version: string;
}> {
  if (correcoes.length < 2) {
    throw new CalibracaoError(
      "não há correção suficiente para propor regra — uma correção só é um caso, não um padrão",
    );
  }
  if (emVigor.length >= MAX_REGRAS) {
    throw new CalibracaoError(
      `o arquivo já tem ${MAX_REGRAS} regras, que é o teto — apague alguma antes de pedir outra`,
    );
  }

  garantirGateway();
  // O prompt e o modelo que eu editei no painel, ou a base do git (slice 4.7).
  const meu = await efetivo("calibracao", { prompt: INSTRUCOES, modelo: modeloCalibracao() });
  const modelo = meu.modelo;

  const material = correcoes.slice(0, TETO_CORRECOES_NO_PROMPT).map(descreverCorrecao).join("\n\n");
  const secoes = secoesDoPrompt();
  const atuais = emVigor.length === 0 ? "(nenhuma ainda)" : emVigor.map((r) => `- ${r.texto}`).join("\n");

  const prompt = `${meu.prompt}

SEÇÕES DO PROMPT ATUAL, que uma regra pode contradizer:
${secoes.join(", ")}

REGRAS JÁ EM VIGOR:
${atuais}

CORREÇÕES QUE EU FIZ:
${material}`;

  let bruto: string;
  try {
    const r = await generateText({
      // String de propósito: id em string sai pelo Gateway (regra 8).
      model: modelo,
      prompt,
      temperature: 0,
      maxOutputTokens: 4000,
    });
    // Cai no pensamento quando o modelo escreveu a resposta lá — mesmo modelo
    // de raciocínio da extração, mesmo modo de falha.
    bruto = textoDaResposta(r);
  } catch (e) {
    throw new CalibracaoError(e instanceof Error ? e.message : String(e));
  }

  return {
    regras: parsearRascunho(bruto, new Set(correcoes.map((c) => c.id)), secoes),
    correcoes: correcoes.length,
    modelo,
    prompt_version: carimbo(PROMPT_VERSION_CALIBRACAO, meu.hash),
  };
}

/**
 * Parser tolerante próprio, como os outros três agentes.
 *
 * As amarras são reaplicadas **aqui**, e não só no prompt: teto de duas regras,
 * citação obrigatória, e nunca uma regra tirada de uma correção só. Amarra que
 * vive apenas no texto do prompt é amarra que o modelo pode ignorar num dia
 * ruim — e o que ela protege é a coisa que produz todo o resto.
 */
export function parsearRascunho(
  bruto: string,
  idsValidos: ReadonlySet<string>,
  secoes: readonly string[],
): RegraRascunhada[] {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) return [];

  let cru: unknown;
  try {
    cru = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch {
    return [];
  }

  const lista = (cru as { regras?: unknown })?.regras;
  if (!Array.isArray(lista)) return [];

  const saida: RegraRascunhada[] = [];
  const carimbo = Date.now().toString(36);

  for (const item of lista) {
    const r = item as { texto?: unknown; cita?: unknown; substitui?: unknown };
    const texto = typeof r?.texto === "string" ? r.texto.trim() : "";
    if (texto === "") continue;

    // Só ids que de fato estão no material: id inventado pelo modelo faria
    // `incorporada_em` fechar uma correção que a regra nunca leu.
    const cita = [
      ...new Set(
        (Array.isArray(r.cita) ? r.cita : []).filter(
          (c): c is string => typeof c === "string" && idsValidos.has(c),
        ),
      ),
    ];
    // A amarra que mais importa: sem duas correções não há padrão.
    if (cita.length < 2) continue;

    const alvo = typeof r.substitui === "string" ? r.substitui.trim() : "";
    saida.push({
      id: `regra-${carimbo}-${saida.length + 1}`,
      texto,
      cita,
      // Seção inventada não vira `substitui`: ela iria para o prompt como
      // "isto substitui a seção X" apontando para nada.
      ...(secoes.includes(alvo) ? { substitui: alvo } : {}),
    });
    if (saida.length === MAX_REGRAS_POR_RASCUNHO) break;
  }
  return saida;
}

/**
 * Aprova uma composição de regras: grava o snapshot imutável, aponta
 * `regras_correntes` para ele e fecha as correções que as regras citam.
 *
 * **As três coisas no mesmo ciclo de retry.** `incorporada_em` só é
 * autoritativo no índice, e a escrita dele faz parte do mesmo read-modify-write
 * que troca `regras_correntes`: duas aprovações quase simultâneas só não se
 * destroem se o conteúdo novo for recalculado **dentro** de cada tentativa.
 */
export async function aprovarRegras(
  escolhidas: readonly Regra[],
  agora: string = new Date().toISOString(),
): Promise<{ hash: string | null; fechadas: number }> {
  const atual = await carregarIndice();
  const hash =
    escolhidas.length === 0
      ? null
      : await gravarVersao(escolhidas, atual.regras_correntes, agora);

  // A união dos `cita` de toda regra sobrevivente. Regra que eu cortei antes de
  // aprovar deixa as correções que a motivavam **em aberto**, e elas voltam na
  // próxima rodada — é o que faz "descartar" ser diferente de "endereçar".
  const citadas = new Set(escolhidas.flatMap((r) => r.cita));
  let fechadas = 0;

  await atualizarIndice((i) => {
    fechadas = 0;
    const correcoes = i.correcoes.map((c) => {
      if (c.incorporada_em !== null || !citadas.has(c.id) || hash === null) return c;
      fechadas++;
      return { ...c, incorporada_em: hash };
    });
    return { ...i, correcoes, regras_correntes: hash, atualizado_em: agora };
  });

  return { hash, fechadas };
}
