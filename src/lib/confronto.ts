/**
 * O agente `confronto` — relações entre átomos ao longo do tempo (slice 5,
 * calibrado na 5.1).
 *
 * **O que ele faz:** para cada átomo, busca átomos mais antigos parecidos por
 * vetor e decide, para cada um, se o novo `ATUALIZA`, `CONTRADIZ`, `CONFIRMA`
 * ou `COMPLEMENTA` o antigo — ou se não há relação que valha registrar.
 *
 * **Por que ele existe.** É o pilar "Confrontar" que `Specs/visao.md` sempre
 * descreveu — perceber que uma posição mudou — e que nunca tinha saído do
 * papel: `ARCHITECTURE.md` listava `:ATUALIZA`/`:CONTRADIZ`/`:CONFIRMA` como
 * não existentes desde a slice 2. Sem isto, uma pergunta como "como minha
 * opinião sobre X mudou" não tem o que ler além de reler átomo por átomo.
 *
 * **Nunca em tempo real.** Ele não roda quando um átomo é confirmado — só
 * periodicamente (`GET /api/cron/confronto`, cron próprio) e sob demanda
 * (`POST /api/confronto/rodar`). É decisão da entrevista: comparar contra o
 * grafo inteiro é um trabalho de fundo, não um passo do caminho crítico da
 * gravação.
 *
 * **Em lote, com acervo compartilhado (5.1).** Uma chamada julga até
 * `ALVOS_POR_LOTE` átomos de uma vez: o texto de cada átomo envolvido — alvo
 * ou candidato — vai **uma vez só**, num acervo numerado, e depois a lista de
 * pares a julgar. O desenho de um-alvo-por-chamada mandava o mesmo texto de
 * candidato 3,3 vezes numa varredura completa (medido: 47.322 chars enviados
 * para 14.431 distintos), e gastava 39 chamadas onde agora bastam ~4.
 *
 * **A entidade entra para barrar, não para ligar (5.1).** Cada átomo do acervo
 * mostra as entidades que ele aponta, sem o `"eu"`. Elas existem para o modelo
 * poder recusar um par cujos referentes ("a empresa", "o negócio", "ela") são
 * diferentes ou desconhecidos — nunca para justificar uma relação. A revisão à
 * mão das 21 primeiras relações mostrou os dois lados disso: os dois falsos
 * positivos de referente não compartilhavam entidade nenhuma, e o terceiro
 * falso positivo compartilhava duas pessoas e mesmo assim não tinha relação.
 *
 * **Retroativo e incremental pelo mesmo caminho.** Não há um modo "só o que é
 * novo" separado de um modo "varre tudo": todo átomo com `confronto_estado`
 * ausente ou `'falhou'` é candidato à próxima rodada, então rodar a fila
 * algumas vezes cobre o histórico inteiro, e rodar de novo no dia seguinte
 * cobre o que se acumulou. `reprocessarTudo` devolve o grafo inteiro à fila —
 * é o que torna uma troca de prompt aplicável ao que já foi julgado.
 *
 * **Todos os tipos de átomo entram**, por decisão da entrevista — o agente
 * decide caso a caso se a comparação faz sentido, em vez de uma lista fixa de
 * tipos elegíveis excluir de antemão um caso que faria sentido.
 *
 * **Sempre do mais novo para o mais antigo.** Um átomo só busca candidatos com
 * `valido_em` estritamente anterior ao seu — a aresta nasce
 * `(mais_novo)-[:TIPO]->(mais_antigo)`, e processar em ordem crescente de
 * `valido_em` (a fila reivindica os mais antigos pendentes primeiro) evita
 * avaliar um átomo recente antes de um antigo do qual ele dependeria.
 *
 * **Ele escreve sozinho, sem tela de aprovação** — mesmo padrão do agente 4
 * (`enriquecimento.ts`). A regra 5 do `CLAUDE.md` continua inteira: ela fala
 * de átomo e da tela de revisão, e nenhum átomo entra no grafo por aqui — o
 * que entra é a relação ENTRE átomos já confirmados.
 *
 * **O desfazer é por átomo, uma geração**, e a geração é sempre única por
 * construção: toda gravação começa apagando as relações de saída que aquele
 * átomo já tinha, e só então escreve as novas. Isso cobre de graça o caso de
 * uma rodada morrer entre gravar e marcar `processado` — a próxima tentativa
 * substitui em vez de duplicar (regra 4). `confronto_execucao` é o carimbo de
 * auditoria (que rodada tocou este átomo por último), não uma chave que o
 * desfazer precise casar: desfazer apaga o que existe agora, porque só existe
 * uma geração viva por vez.
 *
 * **O estado mora no átomo, e a fila é estado idempotente mais `waitUntil`**
 * — mesmo mecanismo da fila de enriquecimento, que é o da transcrição por
 * blocos: fechar a aba não interrompe nada, porque o que decide a próxima
 * reivindicação é o grafo, não o navegador.
 */
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloConfronto,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { query, queryUm } from "./neo4j";
import { carimbo, efetivo } from "./overrides";
import {
  TIPOS_RELACAO_CONFRONTO,
  ehTipoRelacaoConfronto,
  type AtomoNoAcervo,
  type CandidatoDeConfronto,
  type EstadoConfronto,
  type RelacaoDecidida,
  type TipoAtomo,
  type TipoRelacaoConfronto,
} from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_CONFRONTO = "confronto-2";

/**
 * Dimensionado para o lote: dez alvos podem render ~30 pares julgados, e o
 * teto de 1.500 da slice 5 era para um alvo só.
 */
const MAX_TOKENS_SAIDA = 4000;
const FATOR_DE_FOLGA = 2;
const AMOSTRA_ERRO = 400;

/** O erro cabe na linha do átomo; a causa inteira fica no log. */
export const TETO_MOTIVO = 300;

/** O motivo de uma relação — mais curto, porque são vários por rodada. */
export const TETO_MOTIVO_RELACAO = 300;

export class ConfrontoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfrontoError";
  }
}

// ──────────────────────── candidatos ────────────────────────

/**
 * **Ponto de partida** para o piso de similaridade — o mesmo de
 * `PISO_VIZINHOS` em `resolucao.ts`, que já mede a mesma coisa (proximidade
 * de texto de átomo por cosseno). Independente daquele porque as duas fatias
 * podem precisar de calibragem diferente: aqui o texto INTEIRO do candidato
 * entra no prompt, e um piso frouxo custa tokens, não só ruído.
 *
 * **Medido inerte na 5.1**, e mantido mesmo assim: das 21 primeiras relações,
 * o par menos parecido tinha 0,728 — o piso nunca cortou nada, quem seleciona
 * é o top-`K_CANDIDATOS` do índice. Subi-lo até onde cortaria os falsos
 * positivos (0,77) levaria junto duas das três `CONTRADIZ` aprovadas, e é por
 * isso que o conserto da 5.1 é o prompt, não este número.
 */
export const PISO_CONFRONTO = 0.45;

/** Quantos vizinhos buscar antes do piso cortar — mesma ordem de `ALCANCE.vizinhos`. */
export const K_CANDIDATOS = 8;

/**
 * Quantos átomos um lote julga de uma vez.
 *
 * Dez porque o ganho do acervo compartilhado vem da repetição do candidato —
 * e ela só aparece quando alvos vizinhos no tempo entram juntos, que é
 * exatamente o que a ordem da fila (do `valido_em` mais antigo para o mais
 * novo) garante. Número, não tamanho: um lote com uma `HISTORIA` longa cresce
 * junto, e o teto disso é o §14.
 */
export const ALVOS_POR_LOTE = 10;

/**
 * O piso de confiança do `COMPLEMENTA` — e só dele (slice 5.1).
 *
 * A revisão à mão das 21 primeiras relações achou cinco erradas, e **todas as
 * cinco eram `COMPLEMENTA`**; as seis que não eram (`ATUALIZA`, `CONFIRMA`,
 * `CONTRADIZ`) passaram inteiras. Um piso global foi medido e recusado: das
 * reprovadas, três estavam em 0,6 e duas em 0,7, mas havia três aprovadas em
 * 0,6 e três em 0,7 — não há corte limpo que sirva para os quatro tipos.
 *
 * É `limiarPadrao` no registro de `agentes.ts`, então este número é o da base
 * do git e o painel de `/agentes` o sobrescreve sem deploy — que é o que uma
 * calibração precisa ser.
 */
export const LIMIAR_COMPLEMENTA = 0.7;

/** Um átomo como a fila o vê para processar. */
export type AtomoAlvo = AtomoNoAcervo;

interface LinhaDeAtomo {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  sobre: string[];
  cita: string[];
}

const comEntidades = (l: LinhaDeAtomo): AtomoNoAcervo => ({
  id: l.id,
  texto: l.texto,
  tipo: l.tipo,
  valido_em: l.valido_em,
  entidades: { sobre: l.sobre ?? [], cita: l.cita ?? [] },
});

/**
 * O trecho de Cypher que pendura as entidades de um átomo, sem o `"eu"`.
 *
 * Dois `OPTIONAL MATCH` e não um com `type(r)`: o `SOBRE` e o `MENCIONA` viram
 * listas separadas porque o prompt as apresenta separadas — saber que um
 * trecho **é sobre** a Behring pesa mais, na hora de recusar um referente, do
 * que saber que ele a cita de passagem.
 */
const ENTIDADES_DE = (no: string) => `
     OPTIONAL MATCH (${no})-[:SOBRE]->(s:Entidade) WHERE toLower(coalesce(s.nome, '')) <> 'eu'
     OPTIONAL MATCH (${no})-[:MENCIONA]->(m:Entidade) WHERE toLower(coalesce(m.nome, '')) <> 'eu'`;

/**
 * Os alvos do lote, na forma do acervo. Os que sumiram do grafo entre a
 * reivindicação e agora simplesmente não voltam — quem chamou compara.
 */
export async function alvosDoLote(atomoIds: readonly string[]): Promise<AtomoAlvo[]> {
  const linhas = await query<LinhaDeAtomo>(
    `UNWIND $ids AS alvoId
     MATCH (a:Atomo { id: alvoId })${ENTIDADES_DE("a")}
     WITH a, collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, sobre, cita`,
    { ids: [...atomoIds] },
  );
  return linhas.map(comEntidades);
}

/**
 * Os átomos mais antigos e parecidos com cada alvo, acima do piso.
 *
 * `2 * score - 1` desfaz a normalização do índice vetorial do Neo4j (`[0,1]`)
 * de volta para cosseno puro — mesma conta de `entidades.ts`. A comparação de
 * `valido_em` é lexicográfica sobre ISO 8601, que ordena como data sem
 * conversão nenhuma; string vazia (átomo sem data) nunca é "anterior" a nada,
 * então um átomo sem `valido_em` não vira candidato de ninguém.
 *
 * Uma consulta para o lote inteiro, e não uma por alvo: a busca vetorial é
 * barata, mas dez idas ao Aura por lote não são.
 */
export async function candidatosDeLote(
  atomoIds: readonly string[],
  piso: number = PISO_CONFRONTO,
  k: number = K_CANDIDATOS,
): Promise<Record<string, CandidatoDeConfronto[]>> {
  const linhas = await query<LinhaDeAtomo & { alvo_id: string; similaridade: number }>(
    `UNWIND $ids AS alvoId
     MATCH (alvo:Atomo { id: alvoId })
     WHERE alvo.embedding IS NOT NULL
     CALL db.index.vector.queryNodes('atomo_embedding', $k, alvo.embedding) YIELD node AS candidato, score
     WITH alvo, candidato, 2 * score - 1 AS similaridade
     WHERE similaridade >= $piso
       AND candidato.id <> alvo.id
       AND coalesce(candidato.status, 'ativo') = 'ativo'
       AND coalesce(candidato.valido_em, '') <> ''
       AND coalesce(candidato.valido_em, '') < coalesce(alvo.valido_em, '')${ENTIDADES_DE("candidato")}
     WITH alvo, candidato, similaridade,
          collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN alvo.id AS alvo_id, candidato.id AS id, candidato.texto AS texto,
            candidato.tipo AS tipo, coalesce(candidato.valido_em, '') AS valido_em,
            similaridade, sobre, cita
     ORDER BY alvo_id, similaridade DESC`,
    { ids: [...atomoIds], k, piso },
  );

  const porAlvo: Record<string, CandidatoDeConfronto[]> = {};
  for (const l of linhas) {
    (porAlvo[l.alvo_id] ??= []).push({ ...comEntidades(l), similaridade: l.similaridade });
  }
  return porAlvo;
}

// ──────────────────────── o que o modelo recebe ────────────────────────

export const INSTRUCOES = `Você lê um diário pessoal falado. Cada trecho é uma afirmação que eu registrei num dia. Seu trabalho é dizer, para cada par de trechos, como o mais novo se relaciona com o mais antigo — e, na maior parte dos pares, a resposta é que não se relaciona.

NENHUMA — o padrão. Os dois não têm relação que valha registrar, mesmo falando da mesma pessoa, do mesmo projeto, do mesmo dia ou do mesmo tema.
ATUALIZA — o mais novo substitui a posição do mais antigo: é a MESMA afirmação específica, e ela mudou.
CONTRADIZ — o mais novo se opõe diretamente ao mais antigo.
CONFIRMA — o mais novo sustenta a mesma afirmação do mais antigo: repetindo-a, ou trazendo resultado, evidência ou consequência que mostra que ela se cumpriu.
COMPLEMENTA — o mais novo acrescenta informação nova sobre o MESMO fato, episódio ou decisão específica, já nomeada no mais antigo.

O PORTÃO — antes de escolher qualquer coisa que não seja NENHUMA
Diga, numa frase, qual afirmação específica os dois trechos têm em comum, usando palavras que aparecem nos DOIS. Se você não conseguir escrever essa frase, é NENHUMA. Essa frase é o "motivo".

O QUE NÃO É MOTIVO, NUNCA
- Falarem da mesma pessoa, do mesmo projeto ou da mesma organização.
- Serem do mesmo dia, da mesma sessão ou da mesma época.
- Serem sobre o mesmo tema — trabalho, tempo, mulheres, estudo, dinheiro.
- Descreverem o mesmo tipo de sentimento, o mesmo padrão de comportamento ou a mesma dinâmica psicológica.
O diário é meu: quase todo trecho é sobre mim, e parecer parecido é o normal, não é evidência.

REFERENTE — não presuma
"A empresa", "o negócio", "ela", "aquilo", "a conversa" só são a mesma coisa em dois trechos quando os DOIS a nomeiam. As entidades de cada trecho estão no acervo para isso: elas servem para você DESCARTAR um par cujos referentes são diferentes ou desconhecidos, nunca para justificar uma relação. Dois trechos que citam a mesma pessoa continuam sendo NENHUMA se não disserem a mesma coisa sobre ela.

NÃO GENERALIZE
Não invente o tema, o padrão ou a leitura que liga os dois trechos. Se a ligação só existe depois de uma frase sua que nenhum dos dois trechos diz, é NENHUMA.

DIREÇÃO
O trecho mais novo é sempre quem atualiza, contradiz, confirma ou complementa. Nunca o contrário.

CONFIANÇA
"confianca" é um número de 0 a 1 e mede o quanto você tem certeza DA RELAÇÃO escolhida — não de os dois trechos terem assunto em comum.

FORMATO
Responda somente com JSON, sem texto antes ou depois. Cada item usa os números do acervo:
{"relacoes":[{"novo":7,"velho":3,"tipo":"ATUALIZA","confianca":0.8,"motivo":"..."}]}

Só inclua os pares cuja relação NÃO é NENHUMA. Par sem relação simplesmente não aparece na lista — lista vazia é resposta legítima, e frequente.`;

/** Um par a julgar, pelos números do acervo. */
export interface Par {
  novo: number;
  velho: number;
}

export interface Lote {
  /** A ordem É a numeração: o átomo `n` do prompt é `acervo[n - 1]`. */
  acervo: AtomoNoAcervo[];
  pares: Par[];
}

/**
 * O acervo numerado e a lista de pares.
 *
 * **Cada átomo entra uma vez só**, mesmo aparecendo como alvo de um par e
 * candidato de outro — é daí que vem a economia medida na 5.1. Alvo sem
 * candidato não entra: ele não gera par nenhum, e sai `processado` sem passar
 * pelo modelo.
 */
export function montarLote(
  alvos: readonly AtomoAlvo[],
  candidatosPorAlvo: Readonly<Record<string, CandidatoDeConfronto[]>>,
): Lote {
  const acervo: AtomoNoAcervo[] = [];
  const indice = new Map<string, number>();

  const numero = (a: AtomoNoAcervo): number => {
    const visto = indice.get(a.id);
    if (visto !== undefined) return visto;
    acervo.push(a);
    indice.set(a.id, acervo.length);
    return acervo.length;
  };

  const pares: Par[] = [];
  for (const alvo of alvos) {
    const candidatos = candidatosPorAlvo[alvo.id] ?? [];
    if (candidatos.length === 0) continue;
    const novo = numero(alvo);
    for (const c of candidatos) pares.push({ novo, velho: numero(c) });
  }

  return { acervo, pares };
}

/** O cabeçalho de um átomo no acervo: tipo, data e as entidades que ele aponta. */
export function apresentar(a: AtomoNoAcervo): string {
  const quando = a.valido_em === "" ? "" : ` ${a.valido_em.slice(0, 10)}`;
  const partes: string[] = [];
  if (a.entidades.sobre.length > 0) partes.push(`sobre: ${a.entidades.sobre.join(", ")}`);
  if (a.entidades.cita.length > 0) partes.push(`cita: ${a.entidades.cita.join(", ")}`);
  // "sem entidade nomeada" é dito, e não omitido: é o lado ausente do contraste
  // que faz o modelo recusar um referente presumido.
  return `[${a.tipo}${quando} · ${partes.length === 0 ? "sem entidade nomeada" : partes.join(" · ")}]`;
}

export function blocoDoAcervo(acervo: readonly AtomoNoAcervo[]): string {
  return acervo.map((a, i) => `${i + 1}. ${apresentar(a)} ${a.texto}`).join("\n");
}

export function blocoDosPares(pares: readonly Par[]): string {
  return pares.map((p) => `${p.novo} → ${p.velho}`).join("\n");
}

export function montarPrompt(lote: Lote, base: string = INSTRUCOES): string {
  return `${base}

ACERVO (cada trecho aparece uma vez, numerado):
${blocoDoAcervo(lote.acervo)}

PARES A JULGAR (novo → antigo):
${blocoDosPares(lote.pares)}`;
}

// ──────────────────────── o que o modelo devolve ────────────────────────

interface JulgamentoCru {
  novo?: unknown;
  velho?: unknown;
  tipo?: unknown;
  confianca?: unknown;
  motivo?: unknown;
}

export interface Julgadas {
  /** As relações a gravar, pelo id do átomo mais novo. */
  porAlvo: Map<string, RelacaoDecidida[]>;
  /** Quantas `COMPLEMENTA` o piso de confiança derrubou. */
  descartadas: number;
}

const inteiro = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/**
 * Tolerante como os outros agentes: cerca de markdown, frase antes do JSON,
 * lista solta ou envelope `{"relacoes":[...]}`.
 *
 * **Descarta em silêncio, sem derrubar a rodada** — mesma decisão de
 * `parsearFicha`: número fora do acervo, tipo que não é um dos quatro, e
 * **par que não foi perguntado**. Este último é novo na 5.1 e é o que impede
 * o modelo de inventar uma comparação entre dois átomos que ele viu no acervo
 * mas que ninguém pediu para comparar — inclusive uma na direção errada, do
 * velho para o novo.
 */
export function parsearRelacoes(
  bruto: string,
  lote: Lote,
  limiarComplementa: number = LIMIAR_COMPLEMENTA,
): Julgadas {
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

  const pedidos = new Set(lote.pares.map((p) => `${p.novo}→${p.velho}`));
  const porAlvo = new Map<string, RelacaoDecidida[]>();
  let descartadas = 0;

  for (const j of lista) {
    const novo = inteiro(j.novo);
    const velho = inteiro(j.velho);
    if (!Number.isInteger(novo) || !Number.isInteger(velho)) continue;
    if (!pedidos.has(`${novo}→${velho}`)) continue;
    if (!ehTipoRelacaoConfronto(j.tipo)) continue;

    const confianca =
      typeof j.confianca === "number" && Number.isFinite(j.confianca)
        ? Math.min(1, Math.max(0, j.confianca))
        : 0;

    // O piso só existe para COMPLEMENTA: é o único tipo que a revisão à mão
    // reprovou, e um piso para os quatro foi medido e recusado (5.1).
    if (j.tipo === "COMPLEMENTA" && confianca < limiarComplementa) {
      descartadas++;
      continue;
    }

    const alvoId = lote.acervo[novo - 1].id;
    const doAlvo = porAlvo.get(alvoId) ?? [];
    doAlvo.push({
      candidato_id: lote.acervo[velho - 1].id,
      tipo: j.tipo,
      confianca,
      motivo: typeof j.motivo === "string" ? j.motivo.trim().slice(0, TETO_MOTIVO_RELACAO) : "",
    });
    porAlvo.set(alvoId, doAlvo);
  }

  return { porAlvo, descartadas };
}

export interface Decisao extends Julgadas {
  modelo: string;
  prompt_version: string;
}

/**
 * O agente decide o lote inteiro numa chamada. **Não grava nada** — quem grava
 * é `gravarRelacoes`, alvo por alvo, do mesmo jeito que `escreverFicha` e
 * `gravarFicha` se separam em `enriquecimento.ts`.
 *
 * `comEsperaDeLimite` **sem `ate`**: ninguém está esperando do outro lado da
 * tela — nem no cron, nem no "rodar agora" — então a fila pode dormir o quanto
 * o Gateway pedir, mesma decisão do enriquecimento.
 */
export async function decidirLote(lote: Lote): Promise<Decisao> {
  garantirGateway();
  const meu = await efetivo("confronto", {
    prompt: INSTRUCOES,
    modelo: modeloConfronto(),
    limiar: LIMIAR_COMPLEMENTA,
  });
  const prompt = montarPrompt(lote, meu.prompt);

  const chamar = (teto: number) =>
    comEsperaDeLimite(`confronto ${meu.modelo}`, () =>
      generateText({
        // String de propósito: id em string sai pelo Gateway (regra 8).
        model: meu.modelo,
        prompt,
        temperature: 0,
        maxOutputTokens: teto,
        maxRetries: 0,
      }),
    );

  let r = await chamar(MAX_TOKENS_SAIDA);
  if (faltouOrcamento(r)) {
    console.warn(
      `[confronto] o raciocínio comeu o orçamento; repetindo com teto de ` +
        `${MAX_TOKENS_SAIDA * FATOR_DE_FOLGA}.`,
      diagnostico(r),
    );
    r = await chamar(MAX_TOKENS_SAIDA * FATOR_DE_FOLGA);
  }

  if (veioDoPensamento(r)) {
    console.warn(`[confronto] texto vazio, lendo o JSON do pensamento.`, diagnostico(r));
  }

  const julgadas = parsearRelacoes(
    textoDaResposta(r),
    lote,
    meu.limiar ?? LIMIAR_COMPLEMENTA,
  );

  return {
    ...julgadas,
    modelo: r.response?.modelId ?? meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_CONFRONTO, meu.hash),
  };
}

// ──────────────────────── a gravação, e o desfazer ────────────────────────

/**
 * Grava as relações desta rodada e marca o átomo `processado`.
 *
 * **Apaga a geração anterior antes de escrever a nova.** É o que faz "uma
 * geração" ser verdade mesmo se uma rodada passada morreu entre gravar e
 * marcar `processado`: a tentativa seguinte substitui em vez de duplicar ou
 * deixar um tipo de relação órfão de uma decisão anterior diferente.
 *
 * Neo4j não aceita tipo de relação vindo de parâmetro — por isso uma consulta
 * por tipo, com o literal saindo de `TIPOS_RELACAO_CONFRONTO`, nunca do
 * modelo. Mesmo padrão de `statementDeEntidade` em `atomos.ts`.
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
    `MATCH (alvo:Atomo { id: $atomoId })-[r:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]->()
     DELETE r`,
    { atomoId },
  );

  for (const tipo of TIPOS_RELACAO_CONFRONTO) {
    const doTipo = relacoes.filter((r) => r.tipo === tipo);
    if (doTipo.length === 0) continue;

    await query(
      `UNWIND $relacoes AS r
       MATCH (alvo:Atomo { id: $atomoId })
       MATCH (candidato:Atomo { id: r.candidato_id })
       MERGE (alvo)-[rel:${tipo}]->(candidato)
       SET rel.execucao = $execucao,
           rel.motivo = r.motivo,
           rel.confianca = r.confianca,
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
          candidato_id: r.candidato_id,
          motivo: r.motivo,
          confianca: r.confianca,
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
 * Marca a falha do lote sem tocar em relação nenhuma — a próxima varredura
 * tenta de novo.
 *
 * **Só marca quem ainda está `rodando`**: se o lote morreu no meio, os alvos
 * que já saíram `processado` ficam como estão, e a varredura seguinte não
 * repete um julgamento que já custou uma chamada.
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
 * O desfazer: apaga as relações de saída deste átomo e limpa o estado — ele
 * volta a ser "nunca tentado" e reentra na próxima varredura.
 *
 * `null` quando o átomo nunca foi processado — a tela não oferece o botão
 * nesse caso, mesma disciplina de `desfazerFicha`.
 */
export async function desfazerConfronto(atomoId: string): Promise<Desfeito | null> {
  const r = await queryUm<{ id: string; relacoes: number; tinha: boolean }>(
    `MATCH (a:Atomo { id: $atomoId })
     WITH a, coalesce(a.confronto_estado, '') <> '' AS tinha
     OPTIONAL MATCH (a)-[rel:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]->()
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
 * O `desfazerConfronto` aplicado ao grafo inteiro (slice 5.1): apaga todas as
 * relações de confronto e devolve todo átomo tocado à fila.
 *
 * **É o que torna uma troca de prompt aplicável ao passado.** Sem isto,
 * `confronto-2` só alcançaria átomo novo, e o único gabarito que existe — as
 * relações que eu já julguei à mão — ficaria congelado no prompt velho.
 *
 * Destrutivo e sem desfazer próprio; o contrapeso é que a varredura reconstrói
 * o que apagou, e que a tela pede dois toques.
 */
export async function reprocessarTudo(): Promise<Reprocessado> {
  const r = await queryUm<Reprocessado>(
    `MATCH (a:Atomo)
     WHERE a.confronto_estado IS NOT NULL
     OPTIONAL MATCH (a)-[rel:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]->()
     WITH collect(DISTINCT a) AS atomos, collect(rel) AS relacoes
     FOREACH (r IN relacoes | DELETE r)
     FOREACH (a IN atomos |
       REMOVE a.confronto_estado, a.confronto_em, a.confronto_execucao, a.confronto_motivo)
     RETURN size(atomos) AS atomos, size(relacoes) AS relacoes`,
  );
  return r ?? { atomos: 0, relacoes: 0 };
}

// ──────────────────────────── a fila ────────────────────────────

/**
 * Quanto vale a reivindicação de um átomo — mesma conta de `LEASE_MS` em
 * `enriquecimento.ts`: o teto de execução da rota que segura o `waitUntil`,
 * porque depois dele a função que reivindicou está morta com certeza.
 */
export const LEASE_MS = 300_000;

/**
 * Reivindica até `n` átomos pendentes: sem `confronto_estado`, `'falhou'`, ou
 * `'rodando'` com o carimbo vencido — mesma retomada de `reivindicarProxima`.
 * Do `valido_em` mais antigo para o mais novo, para uma relação nunca ser
 * decidida antes de o átomo do qual ela dependeria existir — e, de quebra,
 * para os alvos de um mesmo lote serem vizinhos no tempo, que é quando eles
 * compartilham candidato e o acervo compensa.
 */
export async function reivindicarProximosAtomos(
  n: number = ALVOS_POR_LOTE,
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

/** Um átomo tocado pela última rodada, como a tela de `/confronto` o mostra. */
export interface AtomoRecente {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  estado: EstadoConfronto;
  em: string;
  motivo: string;
  /** O tipo de cada relação de saída que ele tem agora — vazio é resultado legítimo e comum. */
  tipos: TipoRelacaoConfronto[];
}

/**
 * Os átomos mais recentemente tocados pela varredura, `processado` ou
 * `falhou` — nunca `rodando`, que é só o *lease* em curso. `left(a.texto, 180)`
 * é o mesmo corte de `TAMANHO_DO_TRECHO` em `entidades.ts`: a tela mostra uma
 * linha, não o átomo inteiro.
 */
export async function recentes(limite = 20): Promise<AtomoRecente[]> {
  return query<AtomoRecente>(
    `MATCH (a:Atomo)
     WHERE a.confronto_estado IN ['processado', 'falhou']
     OPTIONAL MATCH (a)-[r:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]->()
     WITH a, [t IN collect(type(r)) WHERE t IS NOT NULL] AS tipos
     RETURN a.id AS id, left(a.texto, 180) AS texto, a.tipo AS tipo,
            a.confronto_estado AS estado, a.confronto_em AS em,
            coalesce(a.confronto_motivo, '') AS motivo, tipos
     ORDER BY a.confronto_em DESC
     LIMIT $limite`,
    { limite },
  );
}

/**
 * Quantos átomos ainda esperam — o que a tela usa para saber se recarrega.
 *
 * **Conta o mesmo que a reivindicação pega**, `embedding` incluído (5.1): sem
 * essa condição, um grafo com retrofill de vetor pendente mostraria uma fila
 * que nunca anda, porque `reivindicarProximosAtomos` pula exatamente os átomos
 * que a contagem estaria somando.
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

export interface Rodada {
  alvos: number;
  pares: number;
  relacoes: number;
  descartadas: number;
}

/**
 * O caminho de um lote já reivindicado: buscar candidatos, montar o acervo,
 * decidir, gravar alvo por alvo.
 *
 * **Alvo sem candidato não vai ao modelo** — mesmo espírito custo-consciente de
 * `decidir()` em `resolucao.ts`: ele sai `processado` com zero relações, e o
 * lote só paga uma chamada se sobrar par para julgar.
 */
export async function processarLote(
  atomoIds: readonly string[],
  agora: Date = new Date(),
): Promise<Rodada> {
  const alvos = await alvosDoLote(atomoIds);

  // Reivindicado e sumido entre uma coisa e outra: marca e segue. Deixá-lo
  // `rodando` faria a fila esperar o lease inteiro por um átomo que não existe.
  const achados = new Set(alvos.map((a) => a.id));
  const sumiram = atomoIds.filter((id) => !achados.has(id));
  if (sumiram.length > 0) {
    await marcarFalhaEmLote(sumiram, "átomo não está mais no grafo", agora);
  }
  if (alvos.length === 0) return { alvos: 0, pares: 0, relacoes: 0, descartadas: 0 };

  const candidatos = await candidatosDeLote(alvos.map((a) => a.id));
  const lote = montarLote(alvos, candidatos);
  const execucao = randomUUID();

  const comCandidato = alvos.filter((a) => (candidatos[a.id] ?? []).length > 0);
  for (const a of alvos) {
    if ((candidatos[a.id] ?? []).length === 0) {
      await gravarRelacoes(a.id, [], execucao, "", "", agora);
    }
  }
  if (comCandidato.length === 0) {
    return { alvos: alvos.length, pares: 0, relacoes: 0, descartadas: 0 };
  }

  const decisao = await decidirLote(lote);

  let relacoes = 0;
  for (const a of comCandidato) {
    const doAlvo = decisao.porAlvo.get(a.id) ?? [];
    relacoes += doAlvo.length;
    await gravarRelacoes(a.id, doAlvo, execucao, decisao.modelo, decisao.prompt_version, agora);
  }

  return {
    alvos: alvos.length,
    pares: lote.pares.length,
    relacoes,
    descartadas: decisao.descartadas,
  };
}

/**
 * Um elo: reivindica o próximo lote pendente e roda. `null` quando a fila
 * está vazia — é o sinal para quem chama parar de encadear.
 *
 * **Falhar aqui não derruba a fila.** Os átomos do lote ficam `falhou` com o
 * motivo na própria linha, e a próxima varredura tenta de novo — mesmo
 * contrato de `rodarElo` em `enriquecimento.ts`. O preço de julgar em lote é
 * que a falha é do lote inteiro: dez linhas com o mesmo motivo em `/confronto`
 * são uma falha, não dez.
 */
export async function rodarElo(
  agora: Date = new Date(),
): Promise<{ ids: string[]; rodada: Rodada | null } | null> {
  const ids = await reivindicarProximosAtomos(ALVOS_POR_LOTE, agora);
  if (ids.length === 0) return null;

  try {
    const rodada = await processarLote(ids, agora);
    console.log(
      `[confronto] lote de ${rodada.alvos} átomo(s), ${rodada.pares} par(es): ` +
        `${rodada.relacoes} relação(ões)` +
        (rodada.descartadas > 0 ? `, ${rodada.descartadas} COMPLEMENTA abaixo do limiar` : ""),
    );
    return { ids, rodada };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`[confronto] lote de ${ids.length} átomo(s) falhou:`, e);
    await marcarFalhaEmLote(ids, motivo, agora);
    return { ids, rodada: null };
  }
}
