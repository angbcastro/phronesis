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
 * **Desde a slice 7 este módulo faz as duas pontas do laço para qualquer
 * agente**, e não só para a extração: ele captura, e é dele que saem os dois
 * passos da calibração — o `calibracao-2`, que enxerga o padrão, e a aprovação
 * da emenda que o `redacao-1` escreveu.
 *
 * **Quando roda:** dentro do `waitUntil`, depois de a resposta já ter saído.
 * O que destrava o `router.push("/")` da revisão é a resposta HTTP; pagar idas
 * ao R2 nos 60 s da revisão por material de meta seria pagar no lugar errado.
 * `waitUntil` morto perde as correções daquela sessão, sem recuperação — custo
 * assumido, e o diário não perde nada: os átomos já estão no grafo.
 */
import { generateText } from "ai";
import { chaveCorrecoes, chaveIndiceCalibracao, chaveTranscricao } from "./chaves";
import {
  apurarCorrecoes,
  juntarNoIndice,
  marcarVisitaDe,
  normalizarIndice,
  paraCalibrar,
} from "./correcoes";
import {
  garantirGateway,
  modeloCalibracao,
  textoDaResposta,
} from "./modelos";
import { aplicarEdicoes, secaoDoEnvelope, secoesDe } from "./redacao";
import { carimbo, efetivo, gravarOverride } from "./overrides";
import { atualizarJson } from "./etag";
import { criarLocalizador } from "./offsets";
import { ConflitoR2Error, getJson, putJson } from "./r2";
import { regrasEmVigor } from "./regras";
import { MAX_PADROES_POR_RODADA } from "./tipos";
import type { AtomoConfirmado, EntidadeConfirmada } from "./correcoes";
import type {
  AgenteId,
  Correcao,
  Edicao,
  Extracao,
  Gestos,
  IndiceCalibracao,
  Padrao,
  Transcricao,
} from "./tipos";

/**
 * O índice, normalizado. **Nunca o `valor` cru.**
 *
 * O objeto no R2 é mais velho que o tipo: o da 4.6 não tem `padroes`, e quem
 * recebesse isso estouraria no primeiro `.filter`. `normalizarIndice` é o único
 * lugar que sabe disso, e é por onde todo leitor passa.
 */
export async function carregarIndice(): Promise<IndiceCalibracao> {
  const o = await getJson<IndiceCalibracao>(chaveIndiceCalibracao());
  return normalizarIndice(o?.valor, new Date().toISOString());
}

/**
 * Read-modify-write condicional por etag (`etag.ts`).
 *
 * O mutador roda **dentro** de cada tentativa, sobre o que acabou de ser lido.
 * É o que faz duas escritas quase simultâneas se somarem em vez de a segunda
 * apagar a primeira: quem perde a corrida relê o corrente e reaplica.
 *
 * A normalização vai no `normalizar` do laço, e não só em `carregarIndice`,
 * pelo mesmo motivo: o mutador roda sobre o que acabou de ser lido, e o que
 * acabou de ser lido pode ser o objeto da 4.6, sem `padroes`.
 */
export async function atualizarIndice(
  mutador: (i: IndiceCalibracao) => IndiceCalibracao,
): Promise<IndiceCalibracao> {
  const { valor } = await atualizarJson<IndiceCalibracao>(
    chaveIndiceCalibracao(),
    (cru) => normalizarIndice(cru, new Date().toISOString()),
    mutador,
    { rotulo: "o índice de calibração" },
  );
  return valor;
}

/**
 * Registra que eu abri a calibração **de um agente** de fato — é o relógio da
 * sugestão, e olhar já conta, aprovando emenda ou não.
 *
 * **Por agente desde a slice 7.** Com um relógio só, abrir a tela de um agente
 * adiava por três semanas a sugestão de todos os outros, e o material deles
 * ficava parado sem nada acender.
 *
 * **Não cria o índice.** Sem índice não há correção em aberto, e sem correção
 * em aberto a sugestão nunca acende: gravar um objeto só para anotar a visita
 * a uma tela vazia seria escrever por escrever.
 */
export async function marcarVisita(
  agente: AgenteId,
  agora: string = new Date().toISOString(),
): Promise<void> {
  const atual = await getJson<IndiceCalibracao>(chaveIndiceCalibracao());
  if (!atual) return;

  await atualizarIndice((i) => marcarVisitaDe(i, agente, agora));
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

// ────────────── o agente que enxerga o padrão: rascunha, nunca escreve ──────────────

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_CALIBRACAO = "calibracao-2";

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

/** Um padrão recém-proposto, ainda sem `confirmado_em`. */
export type PadraoRascunhado = Omit<Padrao, "confirmado_em" | "aplicado_em">;

export const INSTRUCOES = `Você lê correções que o dono de um diário falado fez À MÃO, na saída de um agente automático. Sua tarefa é dizer que PADRÃO elas revelam — o que esse agente faz de errado, repetidamente, e que ele deveria passar a fazer diferente.

Você não escreve o prompt do agente. Outro passo faz isso, depois de o dono confirmar o que você achou. O que você entrega é a pauta: uma frase curta, no imperativo, dirigida a quem executa aquele agente.

O QUE É UM PADRÃO BOM
O que o agente deveria ter feito e não fez, dito de um jeito que vale para o próximo caso e não só para os que você leu. Não é a descrição da correção nem um resumo do que aconteceu. Se você não consegue escrevê-lo sem citar um caso específico, não é um padrão.

AMARRAS — todas obrigatórias
1. No máximo ${MAX_PADROES_POR_RODADA} padrões. Menos é melhor. NENHUM é uma resposta legítima e frequente: o prompt deste agente está em bom estado, e um padrão ruim custa mais do que a ausência dele ganha.
2. NUNCA proponha um padrão a partir de uma correção só. Sem repetição não há padrão — há um caso, e generalizar um caso piora o agente em todos os outros.
3. Todo padrão cita, em "cita", os ids das correções que o motivam. Sem ids, o padrão não existe.
4. Padrão que contradiz uma seção existente do prompt diz qual, em "substitui".
5. CONSERTO DE GRAFIA NÃO VIRA PADRÃO. Quando a correção só troca a escrita de um nome próprio ou de uma palavra ("Beijing" virou "Behring", "Jean" virou "Giam"), quem errou foi a transcrição do áudio, não este agente — ele copiou fielmente o que recebeu. Nenhuma instrução faz um agente adivinhar um nome que nunca chegou até ele. Ignore essas correções por completo.
6. Não proponha padrão que já esteja escrito nas seções do prompt atual. Repetir instrução não a torna mais forte.

Se nada no material sustentar um padrão, devolva {"padroes":[]}.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"padroes":[{"texto":"...","cita":["id","id"],"substitui":"NOME DA SEÇÃO"}]}
"substitui" é opcional; omita quando o padrão não contradisser nada.`;

const ROTULO_CORRECAO: Record<string, string> = {
  rejeitado: "rejeitei o átomo inteiro",
  texto: "reescrevi o texto do átomo",
  tipo: "troquei o tipo do átomo",
  sujeito: "troquei o sujeito do átomo",
  mencao_adicionada: "acrescentei uma menção que faltava",
  mencao_removida: "tirei uma menção",
  entidade_recusada: "recusei uma entidade que o agente listou",
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
 * O `calibracao-2` propõe padrões. **Não escreve nada** — devolve e para.
 *
 * Paramétrico por agente desde a slice 7: `papel` e `prompt` vêm de quem chama,
 * que é a rota, que os lê do registro (`agentes.ts`) e de `efetivo(agente, …)`.
 * Este módulo não importa o registro, pela mesma razão que `overrides.ts` não o
 * importa — o registro importa todo agente, e o ciclo fecharia.
 */
export async function rascunharPadroes(entrada: {
  agente: AgenteId;
  papel: string;
  /** O prompt **em vigor** daquele agente: é dele que saem as seções. */
  prompt: string;
  correcoes: readonly Correcao[];
}): Promise<{
  padroes: PadraoRascunhado[];
  correcoes: number;
  modelo: string;
  prompt_version: string;
}> {
  if (entrada.correcoes.length < 2) {
    throw new CalibracaoError(
      "não há correção suficiente para enxergar padrão — uma correção só é um caso, não um padrão",
    );
  }

  garantirGateway();
  // O prompt e o modelo que eu editei no painel, ou a base do git (slice 4.7).
  const meu = await efetivo("calibracao", { prompt: INSTRUCOES, modelo: modeloCalibracao() });

  const material = entrada.correcoes
    .slice(0, TETO_CORRECOES_NO_PROMPT)
    .map(descreverCorrecao)
    .join("\n\n");
  const secoes = secoesDe(entrada.prompt);

  const prompt = `${meu.prompt}

O AGENTE QUE PRODUZIU ISTO
${entrada.papel}

SEÇÕES DO PROMPT DELE, que um padrão pode contradizer:
${secoes.length === 0 ? "(este prompt não tem seções)" : secoes.join(", ")}

CORREÇÕES QUE EU FIZ:
${material}`;

  let bruto: string;
  try {
    const r = await generateText({
      // String de propósito: id em string sai pelo Gateway (regra 8).
      model: meu.modelo,
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
    padroes: parsearRascunho(bruto, {
      agente: entrada.agente,
      ids: new Set(entrada.correcoes.map((c) => c.id)),
      secoes,
    }),
    correcoes: entrada.correcoes.length,
    modelo: meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_CALIBRACAO, meu.hash),
  };
}

/**
 * Parser tolerante próprio, como os outros agentes.
 *
 * As amarras são reaplicadas **aqui**, e não só no prompt: teto de dois
 * padrões, citação obrigatória, e nunca um padrão tirado de uma correção só.
 * Amarra que vive apenas no texto do prompt é amarra que o modelo pode ignorar
 * num dia ruim — e o que ela protege é a coisa que produz todo o resto.
 */
export function parsearRascunho(
  bruto: string,
  contexto: { agente: AgenteId; ids: ReadonlySet<string>; secoes: readonly string[] },
  agora: string = new Date().toISOString(),
): PadraoRascunhado[] {
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

  const lista = (cru as { padroes?: unknown })?.padroes;
  if (!Array.isArray(lista)) return [];

  const saida: PadraoRascunhado[] = [];
  const selo = Date.now().toString(36);

  for (const item of lista) {
    const r = item as { texto?: unknown; cita?: unknown; substitui?: unknown };
    const texto = typeof r?.texto === "string" ? r.texto.trim() : "";
    if (texto === "") continue;

    // Só ids que de fato estão no material: id inventado pelo modelo faria
    // `incorporada_em` fechar uma correção que a emenda nunca leu.
    const cita = [
      ...new Set(
        (Array.isArray(r.cita) ? r.cita : []).filter(
          (c): c is string => typeof c === "string" && contexto.ids.has(c),
        ),
      ),
    ];
    // A amarra que mais importa: sem duas correções não há padrão.
    if (cita.length < 2) continue;

    const alvo = typeof r.substitui === "string" ? r.substitui.trim() : "";
    saida.push({
      id: `padrao-${selo}-${saida.length + 1}`,
      agente: contexto.agente,
      texto,
      cita,
      criado_em: agora,
      // Seção inventada não vira `substitui`: ela iria ao redator como "isto
      // contradiz a seção X" apontando para nada.
      ...(contexto.secoes.some((s) => s.trim() === alvo) ? { substitui: alvo } : {}),
    });
    if (saida.length === MAX_PADROES_POR_RODADA) break;
  }
  return saida;
}

// ─────────────────────────── a pauta, e a emenda ───────────────────────────

/**
 * Guarda a pauta que eu confirmei: a **lista inteira** que deve valer para
 * aquele agente, não um delta.
 *
 * Mesma semântica que `POST /api/calibracao/regras` tinha na 4.6, e pelo mesmo
 * motivo: descartar é submeter sem aquele id, editar é submeter o texto novo
 * com o mesmo id, e lista vazia larga tudo. "Sobreviveu à minha edição" é o id
 * ainda estar na lista — daí ele ser atribuído no rascunho e nunca editável.
 *
 * **Padrão que eu corto deixa as correções que o motivavam em aberto**, e elas
 * voltam no próximo rascunho. É o que faz "descartar" ser diferente de
 * "endereçar".
 */
export async function confirmarPadroes(
  agente: AgenteId,
  escolhidos: readonly PadraoRascunhado[],
  agora: string = new Date().toISOString(),
): Promise<Padrao[]> {
  const confirmados: Padrao[] = escolhidos.map((p) => ({
    ...p,
    agente,
    confirmado_em: agora,
    aplicado_em: null,
  }));

  await atualizarIndice((i) => ({
    ...i,
    // Os de outros agentes ficam; os deste são substituídos pelo que eu mandei.
    // Um padrão já aplicado nunca é mexido: ele é histórico, não pauta.
    padroes: [
      ...i.padroes.filter((p) => p.agente !== agente || p.aplicado_em !== null),
      ...confirmados,
    ],
    atualizado_em: agora,
  }));

  return confirmados;
}

/** A pauta viva de um agente: confirmada por mim e ainda não aplicada. */
export const pautaDe = (indice: IndiceCalibracao, agente: AgenteId): Padrao[] =>
  indice.padroes.filter(
    (p) => p.agente === agente && p.confirmado_em !== null && p.aplicado_em === null,
  );

/**
 * Aprova a emenda: grava o prompt novo e fecha o que ele endereçou.
 *
 * **O texto chega pronto**, aplicado por `aplicarEdicoes` em quem chamou — a
 * rota, que o mostrou na tela e recebeu de volta o meu toque. Reaplicar aqui
 * faria duas implementações da mesma coisa, com a da tela vencendo calada: o
 * mesmo argumento que pôs `referencias.ts` num módulo só.
 *
 * A escrita do prompt vai **antes** do índice, e a ordem é deliberada: o que
 * importa é o prompt novo estar valendo. Se o índice falhar depois, os padrões
 * voltam no próximo rascunho e as correções seguem em aberto — barulho, não
 * perda. Ao contrário, um índice dizendo "endereçado" e apontando para um
 * prompt que nunca foi gravado seria desaprender em silêncio.
 */
export async function aprovarEmenda(
  agente: AgenteId,
  texto: string,
  padroes: readonly string[],
  agora: string = new Date().toISOString(),
): Promise<{ hash: string | null; fechadas: number }> {
  const over = await gravarOverride(agente, { prompt: texto }, agora);
  const hash = over.prompt_hash ?? null;
  if (hash === null) return { hash: null, fechadas: 0 };

  const selo = `p${hash}`;
  const aplicados = new Set(padroes);
  let fechadas = 0;

  await atualizarIndice((i) => {
    fechadas = 0;
    const citadas = new Set(i.padroes.filter((p) => aplicados.has(p.id)).flatMap((p) => p.cita));

    const correcoes = i.correcoes.map((c) => {
      if (c.incorporada_em !== null || !citadas.has(c.id)) return c;
      fechadas++;
      return { ...c, incorporada_em: selo };
    });

    return {
      ...i,
      correcoes,
      padroes: i.padroes.map((p) =>
        aplicados.has(p.id) && p.aplicado_em === null ? { ...p, aplicado_em: selo } : p,
      ),
      atualizado_em: agora,
    };
  });

  return { hash, fechadas };
}

/**
 * A pauta de um agente, com a **dobra** das regras da 4.6 — só na extração, e
 * só enquanto ela não tiver sido aplicada.
 *
 * A dobra existe porque tirar o apêndice do caminho de montagem mudaria o
 * prompt da extração em silêncio: ele simplesmente deixaria de ser colado, e a
 * primeira sessão depois do deploy sairia extraída por um prompt do qual eu
 * nunca tirei nada. Ela aparece como pauta **já confirmada**, para eu mandar o
 * redator incorporá-la ao corpo do prompt; aplicada uma vez, some para sempre,
 * porque o padrão fica no índice com `aplicado_em` preenchido.
 */
export async function pautaComDobra(
  indice: IndiceCalibracao,
  agente: AgenteId,
  agora: string = new Date().toISOString(),
): Promise<Padrao[]> {
  const viva = pautaDe(indice, agente);
  if (agente !== "extracao") return viva;

  const jaDobrou = indice.padroes.some((p) => p.agente === "extracao" && p.id.startsWith("dobra-"));
  if (jaDobrou) return viva;

  const antigas = await regrasEmVigor();
  if (antigas.length === 0) return viva;

  return [
    ...antigas.map((r) => ({
      id: `dobra-${r.id}`,
      agente: "extracao" as const,
      texto: r.texto,
      cita: r.cita,
      ...(r.substitui ? { substitui: r.substitui } : {}),
      criado_em: r.aprovada_em ?? agora,
      confirmado_em: r.aprovada_em ?? agora,
      aplicado_em: null,
    })),
    ...viva,
  ];
}

/** Reexportados para as rotas, que montam o passo da redação em cima deles. */
export { aplicarEdicoes, paraCalibrar, secaoDoEnvelope };
export type { Edicao };
