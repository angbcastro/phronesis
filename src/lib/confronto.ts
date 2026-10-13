/**
 * O agente `confronto` — relações entre átomos ao longo do tempo (slice 5,
 * calibrado na 5.1, alargado na 5.2).
 *
 * **O que ele faz:** para cada átomo, busca os cem mais parecidos do grafo
 * inteiro e decide, para cada par, se o mais novo dos dois `ATUALIZA`,
 * `CONTRADIZ`, `CONFIRMA` ou `COMPLEMENTA` o mais antigo — e em que camada:
 * `forte` (a afirmação comum se escreve com palavras dos dois) ou `sutil`
 * (ligação real que pede uma inferência). Na maior parte dos pares, nenhuma.
 *
 * **Por que ele existe.** É o pilar "Confrontar" de `Specs/visao.md` —
 * perceber que uma posição mudou, e depois de quê. Sem isto, "como minha
 * opinião sobre X mudou" não tem o que ler além de reler átomo por átomo.
 *
 * **O horizonte largo é da 5.2**, e veio de três travas que estavam no código:
 * top-8 por vetor, comparação só contra data estritamente anterior — e como
 * `valido_em` é o início da sessão, dois átomos da mesma gravação nunca se
 * comparavam —, e um prompt que recusava ligação por mesma pessoa e mesmo
 * comportamento. Agora são cem candidatos, mais antigos **e** mais novos, da
 * mesma sessão também; e o que antes era recusado vai para a camada sutil, que
 * o chat lê como ligação provável. A 5.1 escolheu precisão sobre cobertura, e a
 * escolha continua: a cobertura não é paga em precisão, é rotulada.
 *
 * **A direção é do código, nunca do modelo.** A aresta nasce sempre
 * `(mais_novo)-[:TIPO]->(mais_antigo)`, e `ehMaisNovo` decide qual é qual:
 * data, e na mesma sessão o segundo do áudio. O prompt mostra cada par já
 * orientado e pede a relação do ponto de vista do mais novo.
 *
 * **Nunca no caminho crítico.** Ele roda no cron próprio, sob demanda
 * (`POST /api/confronto/rodar`) e, desde a 5.2, disparado de fundo quando eu
 * confirmo uma sessão — em `waitUntil`, sem a revisão esperar nada.
 *
 * **Um alvo por chamada (5.2).** O acervo compartilhado da 5.1 economizava
 * repetição com oito candidatos por alvo; com cem, dez alvos viravam mil pares
 * numa chamada. O elo reivindica `ALVOS_POR_ELO` átomos e os julga em paralelo,
 * e **a falha é por alvo**.
 *
 * **Uma geração por átomo, pelo `dono` (migration 013).** Até a 5.1 a rodada de
 * um átomo só escrevia arestas que saíam dele, e "uma geração" era "apagar as de
 * saída". Agora a rodada também escreve aresta que **chega** ao alvo — o par com
 * um átomo mais novo —, e o que diz de qual rodada ela é é o `dono`. Toda
 * gravação começa apagando as arestas do agente cujo dono é o alvo; isso cobre
 * de graça o caso de uma rodada morrer entre gravar e marcar `processado` (regra
 * 4). E o par que já tem aresta viva de outra rodada não é julgado de novo.
 *
 * **O que eu edito fica congelado, e o que eu apago não volta.** Aresta com
 * `origem: 'eu'` o agente nunca toca — nem na rodada, nem no desfazer, nem no
 * reprocessar; o par com `CONFRONTO_RECUSADO` nunca mais é candidato. As duas
 * coisas nascem em `editarRelacao`, que é a tela de `/confronto` escrevendo.
 *
 * **Ele escreve sozinho, sem tela de aprovação** — mesmo padrão do
 * enriquecimento. A regra 5 do `CLAUDE.md` continua inteira: nenhum átomo entra
 * no grafo por aqui, só a relação entre átomos já confirmados.
 *
 * **O estado mora no átomo, e a fila é estado idempotente mais `waitUntil`** —
 * fechar a aba não interrompe nada, porque o que decide a próxima reivindicação
 * é o grafo, não o navegador.
 */
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  garantirGateway,
  modeloConfronto,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { query, queryUm } from "./neo4j";
import { carimbo, efetivo } from "./overrides";
import {
  TIPOS_RELACAO_CONFRONTO,
  ehCamadaConfronto,
  ehTipoRelacaoConfronto,
  type AcaoNaRelacao,
  type AtomoNoAcervo,
  type AtomoNoRadial,
  type CamadaConfronto,
  type CandidatoDeConfronto,
  type EstadoConfronto,
  type OrigemRelacao,
  type RadialDeAtomo,
  type RelacaoDecidida,
  type RelacaoLida,
  type RelacaoNoRadial,
  type TipoAtomo,
  type TipoRelacaoConfronto,
} from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_CONFRONTO = "confronto-3";

/**
 * Sem teto que morda (5.2): a mesma decisão da resolução em 30/09. No deepseek
 * o custo é de centavos, e o teto por agente só empurrava a mesma falha —
 * raciocínio maior que o orçamento — para quando a entrada crescesse. Com cem
 * candidatos por alvo, ela cresceu. O limite que sobra é o relógio (`ate`).
 */
const MAX_TOKENS_SAIDA = 100_000;
const AMOSTRA_ERRO = 400;

/** O erro cabe na linha do átomo; a causa inteira fica no log. */
export const TETO_MOTIVO = 300;

/** O motivo de uma relação. */
export const TETO_MOTIVO_RELACAO = 300;

/** O literal das quatro, para os `MATCH` — sai da constante fechada, nunca do modelo. */
const QUATRO = TIPOS_RELACAO_CONFRONTO.join("|");

export class ConfrontoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfrontoError";
  }
}

// ──────────────────────── candidatos ────────────────────────

/**
 * Quantos vizinhos o índice devolve por alvo (5.2) — "o mais importante é olhar
 * pra um horizonte amplo, e apenas 8 átomos é uma quantidade muito muito
 * baixa". O corte por relevância é o próprio ranking do vetor; sem piso de
 * similaridade, que a 5.1 mediu inerte (o par menos parecido de uma varredura
 * inteira dava 0,728).
 */
export const K_CANDIDATOS = 100;

/**
 * Quantos átomos um elo julga, em paralelo, cada um na sua chamada.
 *
 * Cinco porque cada chamada leva cem trechos e pode passar de um minuto: cinco
 * em paralelo cabem no prazo da função, e não empilham pedidos o bastante para
 * acordar o rate limit da conta (`limite.ts`).
 */
export const ALVOS_POR_ELO = 5;

/**
 * Quantas relações a rodada de um átomo grava (5.2), contadas as que eu já
 * congelei nele. Forte primeiro, depois por confiança.
 *
 * É da rodada do átomo: as arestas que rodadas de outros átomos apontam para
 * ele não contam, e não teriam como — elas nascem em outra chamada.
 */
export const TETO_RELACOES_POR_ATOMO = 7;

/**
 * O piso de confiança do `COMPLEMENTA` forte (slice 5.1).
 *
 * A revisão à mão das 21 primeiras relações achou cinco erradas, e todas as
 * cinco eram `COMPLEMENTA`. **Desde a 5.2, abaixo dele a relação desce para
 * sutil em vez de sumir** — o erro fica rotulado, e o chat o lê com ressalva.
 *
 * É `limiarPadrao` no registro de `agentes.ts`: o painel de `/agentes` o
 * sobrescreve sem deploy.
 */
export const LIMIAR_COMPLEMENTA = 0.7;

/**
 * O prazo de um elo, contado de quando ele começa — dentro do `maxDuration` de
 * 300 s das duas portas, com folga para o `catch` gravar.
 */
export const PRAZO_DO_ELO_MS = 280_000;

/** Um átomo como a fila o vê para processar. */
export interface AtomoAlvo extends AtomoNoAcervo {
  /** Quantas relações eu já congelei nele — entram no teto de 7. */
  congeladas: number;
}

interface LinhaDeAtomo {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  sessao_id: string;
  inicio_s: number | null;
  sobre: string[];
  cita: string[];
}

const comEntidades = (l: LinhaDeAtomo): AtomoNoAcervo => ({
  id: l.id,
  texto: l.texto,
  tipo: l.tipo,
  valido_em: l.valido_em,
  entidades: { sobre: l.sobre ?? [], cita: l.cita ?? [] },
  sessao_id: l.sessao_id ?? "",
  inicio_s: typeof l.inicio_s === "number" ? l.inicio_s : null,
});

/**
 * O trecho de Cypher que pendura as entidades de um átomo, sem o `"eu"`.
 *
 * Dois `OPTIONAL MATCH` e não um com `type(r)`: o `SOBRE` e o `MENCIONA` viram
 * listas separadas porque o prompt as apresenta separadas.
 */
const ENTIDADES_DE = (no: string) => `
     OPTIONAL MATCH (${no})-[:SOBRE]->(s:Entidade) WHERE toLower(coalesce(s.nome, '')) <> 'eu'
     OPTIONAL MATCH (${no})-[:MENCIONA]->(m:Entidade) WHERE toLower(coalesce(m.nome, '')) <> 'eu'`;

/**
 * Os alvos do elo. Os que sumiram do grafo entre a reivindicação e agora
 * simplesmente não voltam — quem chamou compara.
 */
export async function alvosDoLote(atomoIds: readonly string[]): Promise<AtomoAlvo[]> {
  const linhas = await query<LinhaDeAtomo & { congeladas: number }>(
    `UNWIND $ids AS alvoId
     MATCH (a:Atomo { id: alvoId })
     OPTIONAL MATCH (sessao:Sessao)-[:GEROU]->(a)
     OPTIONAL MATCH (a)-[c:${QUATRO}]-(:Atomo) WHERE c.origem = 'eu'
     WITH a, sessao, count(DISTINCT c) AS congeladas${ENTIDADES_DE("a")}
     WITH a, sessao, congeladas, collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, coalesce(sessao.id, '') AS sessao_id,
            a.inicios_s[0] AS inicio_s, congeladas, sobre, cita`,
    { ids: [...atomoIds] },
  );
  return linhas.map((l) => ({ ...comEntidades(l), congeladas: Number(l.congeladas) || 0 }));
}

/**
 * Os cem mais parecidos com cada alvo, **sem filtro de data** (5.2).
 *
 * `2 * score - 1` desfaz a normalização do índice vetorial (`[0,1]`) de volta
 * para cosseno. `$k` é um a mais que `K_CANDIDATOS` porque o próprio alvo volta
 * no topo da busca.
 *
 * Fora do par, antes de o modelo ver: a recusa minha, em qualquer direção; a
 * aresta que eu congelei; e a aresta viva que **outra** rodada escreveu — um
 * par, um julgamento vivo. A aresta cujo dono é o próprio alvo fica: ela é da
 * geração que esta rodada vai substituir. Candidato sem data também fica de
 * fora: sem data não há como dizer quem é o mais novo.
 *
 * Uma consulta para o elo inteiro, e não uma por alvo.
 */
export async function candidatosDeLote(
  atomoIds: readonly string[],
  k: number = K_CANDIDATOS,
): Promise<Record<string, CandidatoDeConfronto[]>> {
  const linhas = await query<LinhaDeAtomo & { alvo_id: string; similaridade: number }>(
    `UNWIND $ids AS alvoId
     MATCH (alvo:Atomo { id: alvoId })
     WHERE alvo.embedding IS NOT NULL
     CALL db.index.vector.queryNodes('atomo_embedding', $k, alvo.embedding) YIELD node AS candidato, score
     WITH alvo, candidato, 2 * score - 1 AS similaridade
     WHERE candidato.id <> alvo.id
       AND coalesce(candidato.status, 'ativo') = 'ativo'
       AND coalesce(candidato.valido_em, '') <> ''
       AND NOT EXISTS { MATCH (alvo)-[:CONFRONTO_RECUSADO]-(candidato) }
       AND NOT EXISTS {
         MATCH (alvo)-[r:${QUATRO}]-(candidato)
         WHERE coalesce(r.origem, 'agente') = 'eu'
            OR coalesce(r.dono, startNode(r).id) <> alvo.id
       }
     OPTIONAL MATCH (sessao:Sessao)-[:GEROU]->(candidato)
     WITH alvo, candidato, similaridade, sessao${ENTIDADES_DE("candidato")}
     WITH alvo, candidato, similaridade, sessao,
          collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN alvo.id AS alvo_id, candidato.id AS id, candidato.texto AS texto,
            candidato.tipo AS tipo, coalesce(candidato.valido_em, '') AS valido_em,
            coalesce(sessao.id, '') AS sessao_id, candidato.inicios_s[0] AS inicio_s,
            similaridade, sobre, cita
     ORDER BY alvo_id, similaridade DESC`,
    { ids: [...atomoIds], k: k + 1 },
  );

  const porAlvo: Record<string, CandidatoDeConfronto[]> = {};
  for (const l of linhas) {
    (porAlvo[l.alvo_id] ??= []).push({ ...comEntidades(l), similaridade: l.similaridade });
  }
  return porAlvo;
}

/**
 * Dois alvos do mesmo elo podem se ter como candidato um do outro. O par fica
 * com o primeiro, e o segundo não o julga — sem isso, as duas chamadas
 * paralelas poderiam gravar dois tipos para o mesmo par.
 */
export function repartirPares(
  alvos: readonly AtomoNoAcervo[],
  candidatosPorAlvo: Readonly<Record<string, CandidatoDeConfronto[]>>,
): Record<string, CandidatoDeConfronto[]> {
  const tomados = new Set<string>();
  const chave = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const repartido: Record<string, CandidatoDeConfronto[]> = {};
  for (const alvo of alvos) {
    const seus = (candidatosPorAlvo[alvo.id] ?? []).filter((c) => !tomados.has(chave(alvo.id, c.id)));
    for (const c of seus) tomados.add(chave(alvo.id, c.id));
    repartido[alvo.id] = seus;
  }
  return repartido;
}

// ──────────────────────── a ordem do par ────────────────────────

/**
 * `a` é mais novo que `b`? **É o código que decide, nunca o modelo** (5.2).
 *
 * Data primeiro — `valido_em` é ISO 8601, que ordena como texto. Com a mesma
 * data, que é o caso da mesma sessão (`valido_em` é o início dela), quem foi
 * dito depois: o primeiro segundo do áudio. Átomo sem âncora fica antes de
 * qualquer um ancorado. O empate final é pelo id: arbitrário, mas estável —
 * o mesmo par sai sempre na mesma direção.
 */
export function ehMaisNovo(a: AtomoNoAcervo, b: AtomoNoAcervo): boolean {
  if (a.valido_em !== b.valido_em) return a.valido_em > b.valido_em;
  const ia = a.inicio_s ?? -1;
  const ib = b.inicio_s ?? -1;
  if (ia !== ib) return ia > ib;
  return a.id > b.id;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Onde o candidato está em relação ao alvo, como o prompt diz: "mais antigo ·
 * 3 dias antes", "mais novo · mesma sessão, dito depois". É o que dá ao modelo
 * as relações entre os dias sem ele precisar fazer conta de data.
 */
export function distancia(alvo: AtomoNoAcervo, c: AtomoNoAcervo): string {
  const novo = ehMaisNovo(c, alvo);
  const lado = novo ? "mais novo" : "mais antigo";
  const quando = novo ? "depois" : "antes";

  if (alvo.sessao_id !== "" && alvo.sessao_id === c.sessao_id) {
    return `${lado} · mesma sessão, dito ${quando}`;
  }

  const ta = new Date(alvo.valido_em).getTime();
  const tc = new Date(c.valido_em).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tc)) return lado;

  const dias = Math.round(Math.abs(tc - ta) / DIA_MS);
  const quanto =
    dias === 0
      ? "mesmo dia"
      : dias === 1
        ? `1 dia ${quando}`
        : dias < 60
          ? `${dias} dias ${quando}`
          : dias < 730
            ? `${Math.round(dias / 30)} meses ${quando}`
            : `${Math.round(dias / 365)} anos ${quando}`;
  return `${lado} · ${quanto}`;
}

// ──────────────────────── o que o modelo recebe ────────────────────────

export const INSTRUCOES = `Você lê um diário pessoal falado. Cada trecho é algo que eu registrei num dia. Você recebe UM trecho em julgamento e uma lista de outros trechos do diário, os mais parecidos com ele — uns mais antigos, uns mais novos, uns da mesma gravação. Para cada par (o trecho em julgamento e um da lista), diga como o MAIS NOVO dos dois se relaciona com o MAIS ANTIGO. Na maior parte dos pares, a resposta é que não se relaciona.

OS TIPOS
NENHUMA — o padrão. Os dois não têm relação que valha registrar, mesmo falando da mesma pessoa, do mesmo projeto, do mesmo dia ou do mesmo tema.
ATUALIZA — o mais novo substitui a posição do mais antigo: é a MESMA afirmação específica, e ela mudou.
CONTRADIZ — o mais novo se opõe diretamente ao mais antigo. Inclui o que aconteceu desmentindo um medo, uma expectativa ou um plano registrado antes.
CONFIRMA — o mais novo sustenta a afirmação do mais antigo: repetindo-a, ou trazendo resultado, evidência ou consequência que mostra que ela se cumpriu. Inclui o que aconteceu cumprindo um medo, uma expectativa ou um plano registrado antes.
COMPLEMENTA — o mais novo acrescenta informação nova sobre a mesma coisa específica do mais antigo: o mesmo fato, episódio ou decisão. Inclui o fato que explica ou dá contexto a um sentimento, o sentimento que é a reação a um fato, e as partes de um mesmo episódio contadas em trechos diferentes.

A ORDEM DO PAR
Cada trecho da lista diz se é mais antigo ou mais novo que o trecho em julgamento, e a que distância. A relação é sempre dita do ponto de vista do mais novo: se o da lista é mais novo, é ele que atualiza, contradiz, confirma ou complementa o trecho em julgamento. Trechos da mesma gravação valem como qualquer outro par — o que foi dito depois é o mais novo.

DUAS CAMADAS
Toda relação vai numa de duas camadas: forte ou sutil.

FORTE
Escreva, numa frase, qual afirmação específica os dois trechos têm em comum, usando palavras que aparecem nos DOIS. Se você consegue, a relação é forte, e essa frase é o "motivo".

SUTIL
A ligação é real, mas só aparece juntando os dois trechos: nenhum dos dois a diz com as palavras do outro. É o caso de um sentimento e do fato que o provocou quando um não cita o outro; da mesma pessoa e do mesmo comportamento dela em dois momentos; de uma expectativa e do que aconteceu depois, contados com palavras diferentes.
A ligação sutil tem que estar ancorada no que os dois trechos DIZEM. O motivo aponta o que está em cada um — "aqui: …; ali: …" — e nunca dá nome ao que os liga. Nada de padrão, traço, tendência, diagnóstico ou leitura psicológica: se para justificar a ligação você precisaria escrever uma interpretação sobre mim, é NENHUMA.

O QUE NÃO É MOTIVO NUNCA
- Só falarem da mesma pessoa, do mesmo projeto ou da mesma organização.
- Só serem do mesmo dia, da mesma gravação ou da mesma época.
- Só serem sobre o mesmo tema — trabalho, tempo, mulheres, estudo, dinheiro.
O diário é meu: quase todo trecho é sobre mim, e parecer parecido é o normal, não é evidência. Em qualquer camada, a ligação é entre o que os dois trechos dizem, não entre os assuntos deles.

REFERENTE
"A empresa", "o negócio", "ela", "aquilo", "a conversa" só são a mesma coisa em dois trechos quando os DOIS a nomeiam, ou quando são da mesma gravação e o contexto não deixa dúvida. As entidades de cada trecho estão ao lado dele para você DESCARTAR um par cujos referentes são diferentes ou desconhecidos, nunca para justificar uma relação.

QUANTAS
No máximo ${TETO_RELACOES_POR_ATOMO} relações. Se houver mais, fique com as fortes e, entre as sutis, com as de que tem mais certeza.

CONFIANÇA
"confianca" é um número de 0 a 1 e mede o quanto você tem certeza DA RELAÇÃO escolhida — do tipo e da camada —, não de os dois trechos terem assunto em comum.

FORMATO
Responda somente com JSON, sem texto antes ou depois. "n" é o número do trecho na lista:
{"relacoes":[{"n":3,"tipo":"COMPLEMENTA","camada":"forte","confianca":0.8,"motivo":"..."}]}

Só inclua os pares cuja relação NÃO é NENHUMA. Lista vazia é resposta legítima, e frequente.`;

/** O cabeçalho de um átomo: tipo, data e as entidades que ele aponta. */
export function apresentar(a: AtomoNoAcervo): string {
  const quando = a.valido_em === "" ? "" : ` ${a.valido_em.slice(0, 10)}`;
  const partes: string[] = [];
  if (a.entidades.sobre.length > 0) partes.push(`sobre: ${a.entidades.sobre.join(", ")}`);
  if (a.entidades.cita.length > 0) partes.push(`cita: ${a.entidades.cita.join(", ")}`);
  // "sem entidade nomeada" é dito, e não omitido: é o lado ausente do contraste
  // que faz o modelo recusar um referente presumido.
  return `[${a.tipo}${quando} · ${partes.length === 0 ? "sem entidade nomeada" : partes.join(" · ")}]`;
}

export function blocoDosCandidatos(
  alvo: AtomoNoAcervo,
  candidatos: readonly AtomoNoAcervo[],
): string {
  return candidatos
    .map((c, i) => `${i + 1}. (${distancia(alvo, c)}) ${apresentar(c)} ${c.texto}`)
    .join("\n");
}

export function montarPrompt(
  alvo: AtomoNoAcervo,
  candidatos: readonly AtomoNoAcervo[],
  base: string = INSTRUCOES,
): string {
  return `${base}

O TRECHO EM JULGAMENTO
${apresentar(alvo)} ${alvo.texto}

OS OUTROS TRECHOS (numerados; cada um diz se é mais antigo ou mais novo que o trecho em julgamento)
${blocoDosCandidatos(alvo, candidatos)}`;
}

// ──────────────────────── o que o modelo devolve ────────────────────────

interface JulgamentoCru {
  n?: unknown;
  tipo?: unknown;
  camada?: unknown;
  confianca?: unknown;
  motivo?: unknown;
}

export interface Julgadas {
  relacoes: RelacaoDecidida[];
  /** Quantas `COMPLEMENTA` fortes o piso de confiança mandou para a camada sutil. */
  rebaixadas: number;
  /** Quantas o teto de relações por átomo cortou. */
  cortadas: number;
}

export interface OpcoesDoParser {
  limiarComplementa?: number;
  /** Quantas a rodada pode gravar — o teto menos as que eu já congelei. */
  teto?: number;
}

/**
 * Tolerante como os outros agentes: cerca de markdown, frase antes do JSON,
 * lista solta ou envelope `{"relacoes":[...]}`.
 *
 * **Descarta em silêncio, sem derrubar a rodada:** `n` fora da lista, `n`
 * repetido (fica o primeiro), tipo que não é um dos quatro. **A camada
 * inválida vira sutil** — na dúvida, a camada que o chat lê com ressalva. E a
 * direção nunca vem do modelo: o par é orientado aqui, por `ehMaisNovo`.
 */
export function parsearRelacoes(
  bruto: string,
  alvo: AtomoNoAcervo,
  candidatos: readonly AtomoNoAcervo[],
  opcoes: OpcoesDoParser = {},
): Julgadas {
  const limiar = opcoes.limiarComplementa ?? LIMIAR_COMPLEMENTA;
  const teto = Math.max(0, opcoes.teto ?? TETO_RELACOES_POR_ATOMO);

  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const abreLista = semCerca.indexOf("[");
  const comecoValido =
    inicio === -1 ? abreLista : abreLista === -1 ? inicio : Math.min(inicio, abreLista);
  const fim = Math.max(semCerca.lastIndexOf("}"), semCerca.lastIndexOf("]"));
  if (comecoValido === -1 || fim <= comecoValido) {
    throw new ConfrontoError(`resposta sem JSON reconhecível: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }

  let cru: unknown;
  try {
    cru = JSON.parse(semCerca.slice(comecoValido, fim + 1));
  } catch (e) {
    throw new ConfrontoError(
      `JSON inválido: ${e instanceof Error ? e.message : String(e)} — ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }

  const lista: JulgamentoCru[] = Array.isArray(cru)
    ? (cru as JulgamentoCru[])
    : Array.isArray((cru as { relacoes?: unknown })?.relacoes)
      ? (cru as { relacoes: JulgamentoCru[] }).relacoes
      : [];

  const vistos = new Set<number>();
  const todas: RelacaoDecidida[] = [];
  let rebaixadas = 0;

  for (const j of lista) {
    const n = typeof j.n === "number" ? j.n : Number(j.n);
    if (!Number.isInteger(n) || n < 1 || n > candidatos.length) continue;
    if (vistos.has(n)) continue;
    if (!ehTipoRelacaoConfronto(j.tipo)) continue;
    vistos.add(n);

    const confianca =
      typeof j.confianca === "number" && Number.isFinite(j.confianca)
        ? Math.min(1, Math.max(0, j.confianca))
        : 0;

    let camada: CamadaConfronto = ehCamadaConfronto(j.camada) ? j.camada : "sutil";
    // O piso existe para o COMPLEMENTA forte: é o único tipo que a revisão à
    // mão reprovou (5.1). Desde a 5.2 ele rebaixa em vez de descartar.
    if (j.tipo === "COMPLEMENTA" && camada === "forte" && confianca < limiar) {
      camada = "sutil";
      rebaixadas++;
    }

    const c = candidatos[n - 1];
    const candidatoEhNovo = ehMaisNovo(c, alvo);
    todas.push({
      novo_id: candidatoEhNovo ? c.id : alvo.id,
      velho_id: candidatoEhNovo ? alvo.id : c.id,
      tipo: j.tipo,
      camada,
      confianca,
      motivo: typeof j.motivo === "string" ? j.motivo.trim().slice(0, TETO_MOTIVO_RELACAO) : "",
    });
  }

  // O teto: forte primeiro, depois por confiança. `sort` é estável, então o
  // empate fica na ordem em que o modelo respondeu.
  const ordenadas = [...todas].sort(
    (a, b) =>
      Number(b.camada === "forte") - Number(a.camada === "forte") || b.confianca - a.confianca,
  );
  const relacoes = ordenadas.slice(0, teto);

  return { relacoes, rebaixadas, cortadas: ordenadas.length - relacoes.length };
}

export interface Decisao extends Julgadas {
  modelo: string;
  prompt_version: string;
  /** O que a chamada gastou — para o log e para a comparação de modelos. */
  tokens: { entrada: number | null; saida: number | null; raciocinio: number | null };
}

export interface OpcoesDoJuiz {
  /** O prazo do elo (`limite.ts`). */
  ate?: number;
  /** Quantas a rodada pode gravar — o teto menos as que eu já congelei. */
  teto?: number;
  /**
   * Um modelo dado direto, com o prompt e o limiar **da base**, sem ler o
   * painel. É a comparação de modelos (`scripts/comparar-confronto.ts`): ela
   * mede a base do git contra modelos que eu ainda não escolhi, e um override
   * salvo no painel misturaria as duas coisas.
   */
  modelo?: string;
}

/**
 * O agente julga um alvo contra os seus candidatos, numa chamada. **Não lê o
 * grafo nem grava nada** — recebe os trechos como dado, e é o que o deixa
 * pronto para julgar, numa fatia futura, um átomo da proposta que ainda não foi
 * gravado (as perguntas pós-gravação da visão §3).
 *
 * `ate` é o prazo do elo: uma chamada lenta não pode comer a função inteira
 * (`limite.ts`). A espera do rate limit dorme dentro dele.
 */
export async function decidirAlvo(
  alvo: AtomoNoAcervo,
  candidatos: readonly AtomoNoAcervo[],
  opcoes: OpcoesDoJuiz = {},
): Promise<Decisao> {
  garantirGateway();
  const meu =
    opcoes.modelo !== undefined
      ? { prompt: INSTRUCOES, modelo: opcoes.modelo, limiar: LIMIAR_COMPLEMENTA, hash: null }
      : await efetivo("confronto", {
          prompt: INSTRUCOES,
          modelo: modeloConfronto(),
          limiar: LIMIAR_COMPLEMENTA,
        });
  const prompt = montarPrompt(alvo, candidatos, meu.prompt);

  const r = await comEsperaDeLimite(
    `confronto ${meu.modelo}`,
    (sinal) =>
      generateText({
        // String de propósito: id em string sai pelo Gateway (regra 8).
        model: meu.modelo,
        prompt,
        temperature: 0,
        maxOutputTokens: MAX_TOKENS_SAIDA,
        maxRetries: 0,
        abortSignal: sinal,
      }),
    { ate: opcoes.ate },
  );
  // Sem segunda tentativa dobrada: o teto já passa do limite do modelo, e
  // repetir seria determinístico. Se ainda vier cortado, o parse falha e o
  // diagnóstico mostra `finishReason=length`.

  if (veioDoPensamento(r)) {
    console.warn(`[confronto] texto vazio, lendo o JSON do pensamento.`, diagnostico(r));
  }

  let julgadas: Julgadas;
  try {
    julgadas = parsearRelacoes(textoDaResposta(r), alvo, candidatos, {
      limiarComplementa: meu.limiar ?? LIMIAR_COMPLEMENTA,
      teto: opcoes.teto,
    });
  } catch (e) {
    console.error(`[confronto] resposta ilegível para ${alvo.id}.`, diagnostico(r));
    throw e;
  }

  const n = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    ...julgadas,
    modelo: r.response?.modelId ?? meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_CONFRONTO, meu.hash),
    tokens: {
      entrada: n(r.usage?.inputTokens),
      saida: n(r.usage?.outputTokens),
      raciocinio: n(r.usage?.outputTokenDetails?.reasoningTokens),
    },
  };
}

// ──────────────────────── a gravação, e o desfazer ────────────────────────

/**
 * Grava as relações desta rodada e marca o átomo `processado`.
 *
 * **Apaga a geração anterior antes de escrever a nova** — as arestas do agente
 * cujo `dono` é o alvo, nas duas direções (migration 013). Congeladas,
 * recusas e arestas de outras rodadas ficam.
 *
 * **A escrita confere de novo o que a busca de candidatos já tinha conferido**:
 * que o par não tem recusa nem aresta minha ou de outra rodada. Entre a busca e
 * a gravação passa uma chamada de modelo inteira, e eu posso ter apagado uma
 * relação na tela nesse meio-tempo.
 *
 * Neo4j não aceita tipo de relação vindo de parâmetro — por isso uma consulta
 * por tipo, com o literal saindo de `TIPOS_RELACAO_CONFRONTO`, nunca do modelo.
 */
export async function gravarRelacoes(
  atomoId: string,
  relacoes: readonly RelacaoDecidida[],
  execucao: string,
  modelo: string,
  prompt_version: string,
  agora: Date = new Date(),
): Promise<void> {
  await query(
    `MATCH (alvo:Atomo { id: $atomoId })-[r:${QUATRO}]-(:Atomo)
     WHERE coalesce(r.origem, 'agente') = 'agente'
       AND coalesce(r.dono, startNode(r).id) = $atomoId
     DELETE r`,
    { atomoId },
  );

  for (const tipo of TIPOS_RELACAO_CONFRONTO) {
    const doTipo = relacoes.filter((r) => r.tipo === tipo);
    if (doTipo.length === 0) continue;

    await query(
      `UNWIND $relacoes AS r
       MATCH (novo:Atomo { id: r.novo_id })
       MATCH (velho:Atomo { id: r.velho_id })
       WHERE NOT EXISTS { MATCH (novo)-[:CONFRONTO_RECUSADO]-(velho) }
         AND NOT EXISTS {
           MATCH (novo)-[x:${QUATRO}]-(velho)
           WHERE coalesce(x.origem, 'agente') = 'eu'
              OR coalesce(x.dono, startNode(x).id) <> $atomoId
         }
       MERGE (novo)-[rel:${tipo}]->(velho)
       SET rel.execucao = $execucao,
           rel.motivo = r.motivo,
           rel.confianca = r.confianca,
           rel.camada = r.camada,
           rel.origem = 'agente',
           rel.dono = $atomoId,
           rel.criado_em = $agora,
           rel.modelo = $modelo,
           rel.prompt_version = $prompt_version`,
      {
        atomoId,
        execucao,
        modelo,
        prompt_version,
        agora: agora.toISOString(),
        relacoes: doTipo.map((r) => ({
          novo_id: r.novo_id,
          velho_id: r.velho_id,
          motivo: r.motivo,
          confianca: r.confianca,
          camada: r.camada,
        })),
      },
    );
  }

  await query(
    `MATCH (a:Atomo { id: $atomoId })
     SET a.confronto_estado = 'processado',
         a.confronto_em = $agora,
         a.confronto_execucao = $execucao,
         a.confronto_motivo = ''`,
    { atomoId, agora: agora.toISOString(), execucao },
  );
}

/**
 * Marca a falha sem tocar em relação nenhuma — a próxima varredura tenta de
 * novo. **Só marca quem ainda está `rodando`**: quem já saiu `processado` fica.
 */
export async function marcarFalhaEmLote(
  atomoIds: readonly string[],
  motivo: string,
  agora: Date = new Date(),
): Promise<void> {
  await query(
    `UNWIND $ids AS atomoId
     MATCH (a:Atomo { id: atomoId })
     WHERE a.confronto_estado = 'rodando'
     SET a.confronto_estado = 'falhou',
         a.confronto_em = $agora,
         a.confronto_motivo = $motivo`,
    { ids: [...atomoIds], agora: agora.toISOString(), motivo: motivo.slice(0, TETO_MOTIVO) },
  );
}

export interface Desfeito {
  id: string;
  relacoes: number;
}

/**
 * O desfazer: apaga o que a rodada deste átomo escreveu e limpa o estado — ele
 * volta a ser "nunca tentado" e reentra na próxima varredura. As relações que
 * eu congelei ficam.
 *
 * `null` quando o átomo nunca foi processado.
 */
export async function desfazerConfronto(atomoId: string): Promise<Desfeito | null> {
  const r = await queryUm<{ id: string; relacoes: number; tinha: boolean }>(
    `MATCH (a:Atomo { id: $atomoId })
     WITH a, coalesce(a.confronto_estado, '') <> '' AS tinha
     OPTIONAL MATCH (a)-[rel:${QUATRO}]-(:Atomo)
     WHERE coalesce(rel.origem, 'agente') = 'agente'
       AND coalesce(rel.dono, startNode(rel).id) = a.id
     WITH a, tinha, collect(rel) AS relacoes
     FOREACH (r IN relacoes | DELETE r)
     REMOVE a.confronto_estado, a.confronto_em, a.confronto_execucao, a.confronto_motivo
     RETURN a.id AS id, size(relacoes) AS relacoes, tinha`,
    { atomoId },
  );
  if (!r) throw new ConfrontoError(`átomo "${atomoId}" não está no grafo`);
  return r.tinha ? { id: r.id, relacoes: r.relacoes } : null;
}

export interface Reprocessado {
  atomos: number;
  relacoes: number;
}

/**
 * Apaga todas as relações **do agente** e devolve todo átomo tocado à fila
 * (slice 5.1). É o que torna uma troca de prompt aplicável ao passado.
 *
 * As que eu congelei e as minhas recusas ficam (5.2): elas são o gabarito, e
 * reprocessar não é razão para eu corrigir o mesmo erro de novo.
 */
export async function reprocessarTudo(): Promise<Reprocessado> {
  const r = await queryUm<Reprocessado>(
    `OPTIONAL MATCH (a:Atomo) WHERE a.confronto_estado IS NOT NULL
     WITH collect(DISTINCT a) AS atomos
     OPTIONAL MATCH (:Atomo)-[rel:${QUATRO}]->(:Atomo)
     WHERE coalesce(rel.origem, 'agente') = 'agente'
     WITH atomos, collect(rel) AS relacoes
     FOREACH (r IN relacoes | DELETE r)
     FOREACH (a IN atomos |
       REMOVE a.confronto_estado, a.confronto_em, a.confronto_execucao, a.confronto_motivo)
     RETURN size(atomos) AS atomos, size(relacoes) AS relacoes`,
  );
  return r ?? { atomos: 0, relacoes: 0 };
}

// ──────────────────────────── a fila ────────────────────────────

/** O teto de execução da rota que segura o `waitUntil` — mesma conta do enriquecimento. */
export const LEASE_MS = 300_000;

/**
 * Reivindica até `n` átomos pendentes: sem `confronto_estado`, `'falhou'`, ou
 * `'rodando'` com o carimbo vencido. Do `valido_em` mais antigo para o mais
 * novo — o que eu acabei de gravar entra atrás do que já esperava.
 */
export async function reivindicarProximosAtomos(
  n: number = ALVOS_POR_ELO,
  agora: Date = new Date(),
): Promise<string[]> {
  const r = await query<{ id: string }>(
    `MATCH (a:Atomo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
       AND a.embedding IS NOT NULL
       AND (
         a.confronto_estado IS NULL
         OR a.confronto_estado = 'falhou'
         OR (a.confronto_estado = 'rodando' AND coalesce(a.confronto_em, '') < $limite)
       )
     WITH a ORDER BY coalesce(a.valido_em, a.criado_em, '') ASC LIMIT $n
     SET a.confronto_estado = 'rodando', a.confronto_em = $agora
     RETURN a.id AS id`,
    {
      n,
      agora: agora.toISOString(),
      limite: new Date(agora.getTime() - LEASE_MS).toISOString(),
    },
  );

  return r.map((linha) => linha.id).filter((id): id is string => typeof id === "string" && id !== "");
}

/** Um átomo tocado pela varredura, como a lista de `/confronto` o mostra. */
export interface AtomoRecente {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  estado: EstadoConfronto;
  em: string;
  motivo: string;
  /** Quantas relações o átomo tem agora, de qualquer rodada e minhas, por camada. */
  fortes: number;
  sutis: number;
}

/**
 * Os átomos mais recentemente tocados pela varredura — nunca `rodando`, que é
 * só o lease em curso. `left(a.texto, 180)` é o corte de uma linha.
 */
export async function recentes(limite = 20): Promise<AtomoRecente[]> {
  return query<AtomoRecente>(
    `MATCH (a:Atomo)
     WHERE a.confronto_estado IN ['processado', 'falhou']
     WITH a ORDER BY a.confronto_em DESC LIMIT $limite
     OPTIONAL MATCH (a)-[r:${QUATRO}]-(:Atomo)
     WITH a, collect(coalesce(r.camada, 'forte')) AS camadas
     RETURN a.id AS id, left(a.texto, 180) AS texto, a.tipo AS tipo,
            a.confronto_estado AS estado, a.confronto_em AS em,
            coalesce(a.confronto_motivo, '') AS motivo,
            size([c IN camadas WHERE c = 'forte']) AS fortes,
            size([c IN camadas WHERE c = 'sutil']) AS sutis
     ORDER BY em DESC`,
    { limite },
  );
}

/**
 * Quantos átomos ainda esperam. **Conta o mesmo que a reivindicação pega**,
 * `embedding` incluído (5.1).
 */
export async function tamanhoDaFilaDeConfronto(): Promise<number> {
  const r = await query<{ quantas: number }>(
    `MATCH (a:Atomo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
       AND a.embedding IS NOT NULL
       AND (a.confronto_estado IS NULL OR a.confronto_estado IN ['falhou', 'rodando'])
     RETURN count(a) AS quantas`,
  );
  return r[0]?.quantas ?? 0;
}

/**
 * Há um elo rodando agora? — um átomo `rodando` com o lease em dia.
 *
 * É o que impede o disparo do confirmar (5.2) de multiplicar as correntes:
 * cada corrente se autoencadeia até a fila esvaziar, e três sessões
 * confirmadas durante um reprocessar grande virariam três correntes de cinco
 * chamadas paralelas cada. Entre um elo e o seguinte há um instante sem
 * ninguém `rodando`, e nele uma segunda corrente pode nascer — o preço é
 * pagar em dobro por um tempo, nunca gravar em dobro (o lease separa os alvos).
 */
export async function haEloRodando(agora: Date = new Date()): Promise<boolean> {
  const r = await query<{ quantas: number }>(
    `MATCH (a:Atomo)
     WHERE a.confronto_estado = 'rodando' AND coalesce(a.confronto_em, '') >= $limite
     RETURN count(a) AS quantas`,
    { limite: new Date(agora.getTime() - LEASE_MS).toISOString() },
  );
  return (r[0]?.quantas ?? 0) > 0;
}

export interface Rodada {
  alvos: number;
  pares: number;
  relacoes: number;
  rebaixadas: number;
  cortadas: number;
  falhas: number;
}

const RODADA_VAZIA: Rodada = { alvos: 0, pares: 0, relacoes: 0, rebaixadas: 0, cortadas: 0, falhas: 0 };

/**
 * Um alvo, do candidato à gravação. **Falhar aqui é do alvo**, não do elo: ele
 * sai `falhou` com o motivo na linha, e os outros quatro seguem.
 *
 * **Alvo sem candidato, sem data ou com o teto já cheio de relações minhas não
 * vai ao modelo** — sai `processado` sem pagar a chamada.
 */
async function julgarEGravar(
  alvo: AtomoAlvo,
  candidatos: readonly CandidatoDeConfronto[],
  execucao: string,
  agora: Date,
  ate: number,
): Promise<Rodada> {
  const teto = TETO_RELACOES_POR_ATOMO - alvo.congeladas;
  try {
    if (candidatos.length === 0 || alvo.valido_em === "" || teto <= 0) {
      await gravarRelacoes(alvo.id, [], execucao, "", "", agora);
      return { ...RODADA_VAZIA, alvos: 1 };
    }

    const decisao = await decidirAlvo(alvo, candidatos, { ate, teto });
    await gravarRelacoes(
      alvo.id,
      decisao.relacoes,
      execucao,
      decisao.modelo,
      decisao.prompt_version,
      agora,
    );
    return {
      alvos: 1,
      pares: candidatos.length,
      relacoes: decisao.relacoes.length,
      rebaixadas: decisao.rebaixadas,
      cortadas: decisao.cortadas,
      falhas: 0,
    };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`[confronto] ${alvo.id} falhou:`, e);
    await marcarFalhaEmLote([alvo.id], motivo, agora).catch((e2) =>
      console.error(`[confronto] nem a falha de ${alvo.id} consegui marcar:`, e2),
    );
    return { ...RODADA_VAZIA, alvos: 1, pares: candidatos.length, falhas: 1 };
  }
}

/**
 * O caminho de um elo já reivindicado: buscar candidatos para todos numa
 * consulta, repartir os pares que dois alvos compartilham, e julgar cada alvo
 * na sua chamada, em paralelo.
 */
export async function processarElo(
  atomoIds: readonly string[],
  agora: Date = new Date(),
  ate: number = agora.getTime() + PRAZO_DO_ELO_MS,
): Promise<Rodada> {
  const alvos = await alvosDoLote(atomoIds);

  // Reivindicado e sumido entre uma coisa e outra: marca e segue. Deixá-lo
  // `rodando` faria a fila esperar o lease inteiro por um átomo que não existe.
  const achados = new Set(alvos.map((a) => a.id));
  const sumiram = atomoIds.filter((id) => !achados.has(id));
  if (sumiram.length > 0) {
    await marcarFalhaEmLote(sumiram, "átomo não está mais no grafo", agora);
  }
  if (alvos.length === 0) return RODADA_VAZIA;

  const candidatos = repartirPares(alvos, await candidatosDeLote(alvos.map((a) => a.id)));
  const execucao = randomUUID();

  const rodadas = await Promise.all(
    alvos.map((a) => julgarEGravar(a, candidatos[a.id] ?? [], execucao, agora, ate)),
  );

  return rodadas.reduce(
    (soma, r) => ({
      alvos: soma.alvos + r.alvos,
      pares: soma.pares + r.pares,
      relacoes: soma.relacoes + r.relacoes,
      rebaixadas: soma.rebaixadas + r.rebaixadas,
      cortadas: soma.cortadas + r.cortadas,
      falhas: soma.falhas + r.falhas,
    }),
    RODADA_VAZIA,
  );
}

/**
 * Um elo: reivindica os próximos pendentes e roda. `null` quando a fila está
 * vazia — é o sinal para quem chama parar de encadear.
 *
 * **Falhar aqui não derruba a fila.** O que falha por alvo já foi marcado
 * dentro de `processarElo`; o que sobe até aqui é o que quebrou antes de os
 * alvos se separarem (a busca de candidatos, o Aura fora), e aí todos os
 * reivindicados ficam `falhou` com o mesmo motivo.
 */
export async function rodarElo(
  agora: Date = new Date(),
  ate: number = agora.getTime() + PRAZO_DO_ELO_MS,
): Promise<{ ids: string[]; rodada: Rodada | null } | null> {
  const ids = await reivindicarProximosAtomos(ALVOS_POR_ELO, agora);
  if (ids.length === 0) return null;

  try {
    const rodada = await processarElo(ids, agora, ate);
    console.log(
      `[confronto] elo de ${rodada.alvos} átomo(s), ${rodada.pares} par(es): ` +
        `${rodada.relacoes} relação(ões)` +
        (rodada.rebaixadas > 0 ? `, ${rodada.rebaixadas} COMPLEMENTA rebaixada(s) para sutil` : "") +
        (rodada.cortadas > 0 ? `, ${rodada.cortadas} cortada(s) pelo teto` : "") +
        (rodada.falhas > 0 ? `, ${rodada.falhas} falha(s)` : ""),
    );
    return { ids, rodada };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`[confronto] elo de ${ids.length} átomo(s) falhou:`, e);
    await marcarFalhaEmLote(ids, motivo, agora);
    return { ids, rodada: null };
  }
}

// ──────────────────────── o radial, e a minha edição ────────────────────────

interface LinhaDoCentro {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  sessao_id: string;
  estado: EstadoConfronto | null;
  em: string;
  motivo_falha: string;
}

interface LinhaDoVizinho extends Omit<RelacaoNoRadial, "camada" | "origem"> {
  camada: string;
  origem: string;
  v_id: string;
  v_texto: string;
  v_tipo: TipoAtomo;
  v_valido_em: string;
  v_sessao_id: string;
}

const camadaDe = (v: unknown): CamadaConfronto => (ehCamadaConfronto(v) ? v : "forte");
const origemDe = (v: unknown): OrigemRelacao => (v === "eu" ? "eu" : "agente");

/**
 * O que o radial de `/confronto` desenha: o átomo e todas as relações dele,
 * nas duas direções, com os vizinhos. `null` quando o átomo não existe.
 *
 * Vizinho arquivado ou rejeitado não aparece — a mesma regra do chat.
 */
export async function lerRadial(atomoId: string): Promise<RadialDeAtomo | null> {
  const centro = await queryUm<LinhaDoCentro>(
    `MATCH (a:Atomo { id: $id })
     OPTIONAL MATCH (sessao:Sessao)-[:GEROU]->(a)
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, coalesce(sessao.id, '') AS sessao_id,
            a.confronto_estado AS estado, coalesce(a.confronto_em, '') AS em,
            coalesce(a.confronto_motivo, '') AS motivo_falha
     LIMIT 1`,
    { id: atomoId },
  );
  if (!centro) return null;

  const linhas = await query<LinhaDoVizinho>(
    `MATCH (a:Atomo { id: $id })-[r:${QUATRO}]-(v:Atomo)
     WHERE coalesce(v.status, 'ativo') = 'ativo'
     OPTIONAL MATCH (sessao:Sessao)-[:GEROU]->(v)
     RETURN startNode(r).id AS novo_id, endNode(r).id AS velho_id, type(r) AS tipo,
            coalesce(r.camada, 'forte') AS camada, coalesce(r.origem, 'agente') AS origem,
            coalesce(r.confianca, 0) AS confianca, coalesce(r.motivo, '') AS motivo,
            coalesce(r.modelo, '') AS modelo, coalesce(r.prompt_version, '') AS prompt_version,
            coalesce(r.criado_em, '') AS criado_em, coalesce(r.editado_em, '') AS editado_em,
            v.id AS v_id, v.texto AS v_texto, v.tipo AS v_tipo,
            coalesce(v.valido_em, '') AS v_valido_em, coalesce(sessao.id, '') AS v_sessao_id`,
    { id: atomoId },
  );

  const vizinhos = new Map<string, AtomoNoRadial>();
  const relacoes: RelacaoNoRadial[] = [];
  for (const l of linhas) {
    if (!ehTipoRelacaoConfronto(l.tipo)) continue;
    vizinhos.set(l.v_id, {
      id: l.v_id,
      texto: l.v_texto ?? "",
      tipo: l.v_tipo,
      valido_em: l.v_valido_em,
      sessao_id: l.v_sessao_id,
    });
    relacoes.push({
      novo_id: l.novo_id,
      velho_id: l.velho_id,
      tipo: l.tipo,
      camada: camadaDe(l.camada),
      origem: origemDe(l.origem),
      confianca: Number(l.confianca) || 0,
      motivo: l.motivo,
      modelo: l.modelo,
      prompt_version: l.prompt_version,
      criado_em: l.criado_em,
      editado_em: l.editado_em,
    });
  }

  return {
    centro: { ...centro, texto: centro.texto ?? "" },
    vizinhos: [...vizinhos.values()],
    relacoes,
  };
}

interface LinhaDaRelacao {
  tipo: string;
  camada: string;
  origem: string;
  confianca: number;
  motivo: string;
  modelo: string;
  prompt_version: string;
  criado_em: string;
  editado_em: string;
  original_tipo: string | null;
  original_camada: string | null;
  original_motivo: string | null;
  novo_texto: string;
  novo_tipo: TipoAtomo;
  novo_valido_em: string;
  novo_sessao_id: string;
  novo_inicios_s: number[];
  velho_texto: string;
  velho_tipo: TipoAtomo;
  velho_valido_em: string;
}

/**
 * A relação entre dois átomos, inteira — o que a edição precisa para saber o
 * que mudou e o que a correção precisa para ensinar. `null` quando não existe.
 *
 * `original_*` é o que o agente tinha gravado, guardado na minha primeira
 * edição (migration 013). Antes dela, o original é o próprio valor.
 */
export async function lerRelacao(novoId: string, velhoId: string): Promise<RelacaoLida | null> {
  const l = await queryUm<LinhaDaRelacao>(
    `MATCH (novo:Atomo { id: $novo })-[r:${QUATRO}]->(velho:Atomo { id: $velho })
     OPTIONAL MATCH (sessao:Sessao)-[:GEROU]->(novo)
     RETURN type(r) AS tipo, coalesce(r.camada, 'forte') AS camada,
            coalesce(r.origem, 'agente') AS origem, coalesce(r.confianca, 0) AS confianca,
            coalesce(r.motivo, '') AS motivo, coalesce(r.modelo, '') AS modelo,
            coalesce(r.prompt_version, '') AS prompt_version,
            coalesce(r.criado_em, '') AS criado_em, coalesce(r.editado_em, '') AS editado_em,
            r.original_tipo AS original_tipo, r.original_camada AS original_camada,
            r.original_motivo AS original_motivo,
            novo.texto AS novo_texto, novo.tipo AS novo_tipo,
            coalesce(novo.valido_em, '') AS novo_valido_em,
            coalesce(sessao.id, '') AS novo_sessao_id,
            coalesce(novo.inicios_s, []) AS novo_inicios_s,
            velho.texto AS velho_texto, velho.tipo AS velho_tipo,
            coalesce(velho.valido_em, '') AS velho_valido_em
     LIMIT 1`,
    { novo: novoId, velho: velhoId },
  );
  if (!l || !ehTipoRelacaoConfronto(l.tipo)) return null;

  const tipo = l.tipo;
  const camada = camadaDe(l.camada);
  return {
    novo_id: novoId,
    velho_id: velhoId,
    tipo,
    camada,
    origem: origemDe(l.origem),
    confianca: Number(l.confianca) || 0,
    motivo: l.motivo,
    modelo: l.modelo,
    prompt_version: l.prompt_version,
    criado_em: l.criado_em,
    editado_em: l.editado_em,
    original: {
      tipo: ehTipoRelacaoConfronto(l.original_tipo) ? l.original_tipo : tipo,
      camada: ehCamadaConfronto(l.original_camada) ? l.original_camada : camada,
      motivo: typeof l.original_motivo === "string" ? l.original_motivo : l.motivo,
    },
    novo: {
      id: novoId,
      texto: l.novo_texto ?? "",
      tipo: l.novo_tipo,
      valido_em: l.novo_valido_em,
      sessao_id: l.novo_sessao_id,
      inicios_s: Array.isArray(l.novo_inicios_s) ? l.novo_inicios_s.map(Number) : [],
    },
    velho: {
      id: velhoId,
      texto: l.velho_texto ?? "",
      tipo: l.velho_tipo,
      valido_em: l.velho_valido_em,
    },
  };
}

/**
 * O trecho de Cypher que guarda o que o agente gravou, só na primeira edição —
 * `coalesce` deixa o original de pé nas seguintes.
 */
const GUARDA_O_ORIGINAL = (r: string) => `
       SET ${r}.original_tipo = coalesce(${r}.original_tipo, type(${r})),
           ${r}.original_camada = coalesce(${r}.original_camada, ${r}.camada, 'forte'),
           ${r}.original_motivo = coalesce(${r}.original_motivo, ${r}.motivo, '')`;

/**
 * A minha edição de uma relação em `/confronto`. **Congela** a aresta
 * (`origem: 'eu'`), ou a apaga deixando a recusa do par.
 *
 * Devolve a relação como estava e como ficou (`null` na recusa) — quem chama
 * transforma isso em correção para o laço de calibração (`correcoes.ts`).
 *
 * Trocar o tipo é apagar e recriar, porque o tipo É a relação no Neo4j; as
 * propriedades vão junto, e o literal dos dois tipos sai da constante fechada.
 */
export async function editarRelacao(
  novoId: string,
  velhoId: string,
  acao: AcaoNaRelacao,
  valor: string,
  agora: Date = new Date(),
): Promise<{ antes: RelacaoLida; depois: RelacaoLida | null }> {
  const antes = await lerRelacao(novoId, velhoId);
  if (!antes) throw new ConfrontoError("essa relação não existe mais");

  const params = { novo: novoId, velho: velhoId, agora: agora.toISOString() };
  const casar = `MATCH (novo:Atomo { id: $novo })-[r:${antes.tipo}]->(velho:Atomo { id: $velho })`;

  if (acao === "recusar") {
    await query(
      `${casar}
       DELETE r
       MERGE (novo)-[x:CONFRONTO_RECUSADO]->(velho)
       ON CREATE SET x.em = $agora, x.tipo = $tipo`,
      { ...params, tipo: antes.tipo },
    );
    return { antes, depois: null };
  }

  if (acao === "tipo") {
    if (!ehTipoRelacaoConfronto(valor)) throw new ConfrontoError(`tipo inválido: "${valor}"`);
    if (valor !== antes.tipo) {
      await query(
        `${casar}${GUARDA_O_ORIGINAL("r")}
         WITH novo, velho, r, properties(r) AS p
         DELETE r
         CREATE (novo)-[n:${valor}]->(velho)
         SET n = p, n.origem = 'eu', n.editado_em = $agora`,
        params,
      );
    }
  } else if (acao === "camada") {
    if (!ehCamadaConfronto(valor)) throw new ConfrontoError(`camada inválida: "${valor}"`);
    await query(
      `${casar}${GUARDA_O_ORIGINAL("r")}
       SET r.camada = $valor, r.origem = 'eu', r.editado_em = $agora`,
      { ...params, valor },
    );
  } else {
    const motivo = valor.trim().slice(0, TETO_MOTIVO_RELACAO);
    if (motivo === "") throw new ConfrontoError("motivo vazio — para tirar a relação, apague");
    await query(
      `${casar}${GUARDA_O_ORIGINAL("r")}
       SET r.motivo = $valor, r.origem = 'eu', r.editado_em = $agora`,
      { ...params, valor: motivo },
    );
  }

  const depois = await lerRelacao(novoId, velhoId);
  return { antes, depois };
}
