/**
 * O agente `confronto` — relações entre átomos ao longo do tempo (slice 5).
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
 * **Retroativo e incremental pelo mesmo caminho.** Não há um modo "só o que é
 * novo" separado de um modo "varre tudo": todo átomo com `confronto_estado`
 * ausente ou `'falhou'` é candidato à próxima rodada, então rodar a fila
 * algumas vezes cobre o histórico inteiro, e rodar de novo no dia seguinte
 * cobre o que se acumulou.
 *
 * **Todos os tipos de átomo entram**, por decisão da entrevista — o agente
 * decide caso a caso se a comparação faz sentido, em vez de uma lista fixa de
 * tipos elegíveis excluir de antemão um caso que faria sentido.
 *
 * **Sempre do mais novo para o mais antigo.** Um átomo só busca candidatos com
 * `valido_em` estritamente anterior ao seu — a aresta nasce
 * `(mais_novo)-[:TIPO]->(mais_antigo)`, e processar em ordem crescente de
 * `valido_em` (a fila reivindica o mais antigo pendente primeiro) evita
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
  type CandidatoDeConfronto,
  type EstadoConfronto,
  type RelacaoDecidida,
  type TipoAtomo,
  type TipoRelacaoConfronto,
} from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_CONFRONTO = "confronto-1";

const MAX_TOKENS_SAIDA = 1500;
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
 */
export const PISO_CONFRONTO = 0.45;

/** Quantos vizinhos buscar antes do piso cortar — mesma ordem de `ALCANCE.vizinhos`. */
export const K_CANDIDATOS = 8;

/** Um átomo como a fila o vê para processar — sem `similaridade`, que só existe para candidato. */
export interface AtomoAlvo {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
}

/**
 * Os átomos mais antigos e parecidos com `atomoId`, acima do piso.
 *
 * `2 * score - 1` desfaz a normalização do índice vetorial do Neo4j (`[0,1]`)
 * de volta para cosseno puro — mesma conta de `entidades.ts`. A comparação de
 * `valido_em` é lexicográfica sobre ISO 8601, que ordena como data sem
 * conversão nenhuma; string vazia (átomo sem data) nunca é "anterior" a nada,
 * então um átomo sem `valido_em` não vira candidato de ninguém.
 */
export async function candidatosDeConfronto(
  atomoId: string,
  piso: number = PISO_CONFRONTO,
  k: number = K_CANDIDATOS,
): Promise<CandidatoDeConfronto[]> {
  return query<CandidatoDeConfronto>(
    `MATCH (alvo:Atomo { id: $atomoId })
     WHERE alvo.embedding IS NOT NULL
     CALL db.index.vector.queryNodes('atomo_embedding', $k, alvo.embedding) YIELD node AS candidato, score
     WITH alvo, candidato, 2 * score - 1 AS similaridade
     WHERE similaridade >= $piso
       AND candidato.id <> alvo.id
       AND coalesce(candidato.status, 'ativo') = 'ativo'
       AND coalesce(candidato.valido_em, '') <> ''
       AND coalesce(candidato.valido_em, '') < coalesce(alvo.valido_em, '')
     RETURN candidato.id AS id, candidato.texto AS texto, candidato.tipo AS tipo,
            candidato.valido_em AS valido_em, similaridade
     ORDER BY similaridade DESC`,
    { atomoId, k, piso },
  );
}

// ──────────────────────── o que o modelo recebe ────────────────────────

export const INSTRUCOES = `Você lê um diário pessoal falado e decide como um trecho novo se relaciona com trechos mais antigos sobre o mesmo assunto.

Para cada trecho antigo listado, escolha UMA relação:

ATUALIZA — o novo substitui a posição do antigo: ainda é a MESMA afirmação específica, mas ela mudou.
CONTRADIZ — o novo se opõe diretamente ao antigo.
CONFIRMA — o novo repete a mesma afirmação específica, sem acrescentar nem mudar nada.
COMPLEMENTA — o novo acrescenta informação nova e compatível sobre o mesmo assunto, sem mudar nem repetir o que o antigo já dizia.
NENHUMA — os dois não têm relação que valha registrar, mesmo que pareçam parecidos por serem sobre o mesmo tema.

REGRAS
- Compare a AFIRMAÇÃO, não o assunto. Dois trechos sobre a mesma pessoa ou projeto que dizem coisas independentes são NENHUMA, não COMPLEMENTA.
- NENHUMA é a resposta mais comum. Só relacione quando a ligação é clara o bastante para eu confiar sem reler os dois trechos.
- Trecho mais novo é sempre quem atualiza, contradiz, confirma ou complementa — nunca o contrário.
- "motivo" é uma frase curta, em português, dizendo o que nos dois trechos sustenta a relação escolhida.
- "confianca" é um número de 0 a 1, e reflete o quanto você tem certeza da relação escolhida — não da existência do assunto em comum.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"relacoes":[{"n":1,"tipo":"ATUALIZA","confianca":0.8,"motivo":"..."}]}

Só inclua no array os trechos cuja relação NÃO é NENHUMA. Trecho sem relação simplesmente não aparece na lista — lista vazia é resposta legítima e comum.`;

/** O bloco de candidatos, numerado — o número é o que "n" na resposta referencia. */
export function blocoDeCandidatos(candidatos: readonly CandidatoDeConfronto[]): string {
  return candidatos
    .map((c, i) => {
      const quando = c.valido_em === "" ? "" : ` ${c.valido_em.slice(0, 10)}`;
      return `${i + 1}. [${c.tipo}${quando}] ${c.texto}`;
    })
    .join("\n");
}

export function montarPrompt(
  atomo: Pick<AtomoAlvo, "texto" | "tipo" | "valido_em">,
  candidatos: readonly CandidatoDeConfronto[],
  base: string = INSTRUCOES,
): string {
  const quando = atomo.valido_em === "" ? "" : ` (${atomo.valido_em.slice(0, 10)})`;
  return `${base}

TRECHO NOVO [${atomo.tipo}]${quando}: ${atomo.texto}

TRECHOS MAIS ANTIGOS (numerados, do mais parecido para o menos parecido):
${blocoDeCandidatos(candidatos)}`;
}

// ──────────────────────── o que o modelo devolve ────────────────────────

interface JulgamentoCru {
  n?: unknown;
  tipo?: unknown;
  confianca?: unknown;
  motivo?: unknown;
}

/**
 * Tolerante como os outros agentes: cerca de markdown, frase antes do JSON,
 * lista solta ou envelope `{"relacoes":[...]}`. Candidato fora do intervalo
 * (`n` inválido) ou tipo que não é um dos quatro é descartado em silêncio — é
 * a mesma decisão de `parsearFicha`: um item ruim não derruba a rodada
 * inteira, e lista vazia (nenhuma relação) é a resposta mais comum, não uma
 * falha.
 */
export function parsearRelacoes(
  bruto: string,
  candidatos: readonly CandidatoDeConfronto[],
): RelacaoDecidida[] {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const abreLista = semCerca.indexOf("[");
  const comecoValido = inicio === -1 ? abreLista : abreLista === -1 ? inicio : Math.min(inicio, abreLista);
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
      ? ((cru as { relacoes: JulgamentoCru[] }).relacoes)
      : [];

  const saida: RelacaoDecidida[] = [];
  for (const j of lista) {
    const n = typeof j.n === "number" ? j.n : Number(j.n);
    const candidato = Number.isInteger(n) ? candidatos[n - 1] : undefined;
    if (!candidato || !ehTipoRelacaoConfronto(j.tipo)) continue;

    const confianca =
      typeof j.confianca === "number" && Number.isFinite(j.confianca)
        ? Math.min(1, Math.max(0, j.confianca))
        : 0;

    saida.push({
      candidato_id: candidato.id,
      tipo: j.tipo,
      confianca,
      motivo: typeof j.motivo === "string" ? j.motivo.trim().slice(0, TETO_MOTIVO_RELACAO) : "",
    });
  }
  return saida;
}

export interface Decisao {
  relacoes: RelacaoDecidida[];
  modelo: string;
  prompt_version: string;
}

/**
 * O agente decide. **Não grava nada** — quem grava é `gravarRelacoes`, no elo
 * da fila, do mesmo jeito que `escreverFicha`/`gravarFicha` se separam em
 * `enriquecimento.ts`.
 *
 * `comEsperaDeLimite` **sem `ate`**: ninguém está esperando do outro lado da
 * tela — nem no cron, nem no "rodar agora" — então a fila pode dormir o quanto
 * o Gateway pedir, mesma decisão do enriquecimento.
 */
export async function decidirRelacoes(
  atomo: Pick<AtomoAlvo, "texto" | "tipo" | "valido_em">,
  candidatos: readonly CandidatoDeConfronto[],
): Promise<Decisao> {
  garantirGateway();
  const meu = await efetivo("confronto", { prompt: INSTRUCOES, modelo: modeloConfronto() });
  const prompt = montarPrompt(atomo, candidatos, meu.prompt);

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

  return {
    relacoes: parsearRelacoes(textoDaResposta(r), candidatos),
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
        relacoes: doTipo.map((r) => ({ candidato_id: r.candidato_id, motivo: r.motivo, confianca: r.confianca })),
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

/** Marca a falha sem tocar em relação nenhuma — a próxima varredura tenta de novo. */
export async function marcarFalha(atomoId: string, motivo: string, agora: Date = new Date()): Promise<void> {
  await query(
    `MATCH (a:Atomo { id: $atomoId })
     SET a.confronto_estado = 'falhou',
         a.confronto_em = $agora,
         a.confronto_motivo = $motivo`,
    { atomoId, agora: agora.toISOString(), motivo: motivo.slice(0, TETO_MOTIVO) },
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

// ──────────────────────────── a fila ────────────────────────────

/**
 * Quanto vale a reivindicação de um átomo — mesma conta de `LEASE_MS` em
 * `enriquecimento.ts`: o teto de execução da rota que segura o `waitUntil`,
 * porque depois dele a função que reivindicou está morta com certeza.
 */
export const LEASE_MS = 300_000;

/**
 * Reivindica **um** átomo pendente: sem `confronto_estado`, `'falhou'`, ou
 * `'rodando'` com o carimbo vencido — mesma retomada de
 * `reivindicarProxima`. Do mais antigo `valido_em` para o mais novo, para uma
 * relação nunca ser decidida antes de o átomo do qual ela dependeria existir.
 */
export async function reivindicarProximoAtomo(agora: Date = new Date()): Promise<string | null> {
  const r = await query<{ id: string }>(
    `MATCH (a:Atomo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
       AND a.embedding IS NOT NULL
       AND (
         a.confronto_estado IS NULL
         OR a.confronto_estado = 'falhou'
         OR (a.confronto_estado = 'rodando' AND coalesce(a.confronto_em, '') < $limite)
       )
     WITH a ORDER BY coalesce(a.valido_em, a.criado_em, '') ASC LIMIT 1
     SET a.confronto_estado = 'rodando', a.confronto_em = $agora
     RETURN a.id AS id`,
    {
      agora: agora.toISOString(),
      limite: new Date(agora.getTime() - LEASE_MS).toISOString(),
    },
  );

  const id = r[0]?.id;
  return typeof id === "string" && id !== "" ? id : null;
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

/** Quantos átomos ainda esperam — o que a tela usa para saber se recarrega. */
export async function tamanhoDaFilaDeConfronto(): Promise<number> {
  const r = await query<{ quantas: number }>(
    `MATCH (a:Atomo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
       AND (a.confronto_estado IS NULL OR a.confronto_estado IN ['falhou', 'rodando'])
     RETURN count(a) AS quantas`,
  );
  return r[0]?.quantas ?? 0;
}

export interface Rodada {
  candidatos: number;
  relacoes: number;
}

/**
 * O caminho de um átomo já reivindicado: buscar candidatos, decidir, gravar.
 *
 * **Sem candidato acima do piso, não vai ao modelo** — mesmo espírito de
 * custo-consciente de `decidir()` em `resolucao.ts`: paga uma chamada só
 * quando há o que julgar, e o átomo sai `processado` com zero relações.
 */
export async function processarAtomo(atomoId: string, agora: Date = new Date()): Promise<Rodada> {
  const alvo = await queryUm<AtomoAlvo>(
    `MATCH (a:Atomo { id: $atomoId })
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo, coalesce(a.valido_em, '') AS valido_em`,
    { atomoId },
  );
  if (!alvo) throw new ConfrontoError(`átomo "${atomoId}" não está mais no grafo`);

  const candidatos = await candidatosDeConfronto(atomoId);
  if (candidatos.length === 0) {
    await gravarRelacoes(atomoId, [], randomUUID(), "", "", agora);
    return { candidatos: 0, relacoes: 0 };
  }

  const decisao = await decidirRelacoes(alvo, candidatos);
  await gravarRelacoes(atomoId, decisao.relacoes, randomUUID(), decisao.modelo, decisao.prompt_version, agora);
  return { candidatos: candidatos.length, relacoes: decisao.relacoes.length };
}

/**
 * Um elo: reivindica o próximo átomo pendente e roda. `null` quando a fila
 * está vazia — é o sinal para quem chama parar de encadear.
 *
 * **Falhar aqui não derruba a fila.** O átomo fica `falhou` com o motivo na
 * própria linha, e a próxima varredura tenta de novo — mesmo contrato de
 * `rodarElo` em `enriquecimento.ts`.
 */
export async function rodarElo(agora: Date = new Date()): Promise<{ id: string; rodada: Rodada | null } | null> {
  const id = await reivindicarProximoAtomo(agora);
  if (!id) return null;

  try {
    const rodada = await processarAtomo(id, agora);
    return { id, rodada };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`[confronto] ${id} falhou:`, e);
    await marcarFalha(id, motivo, agora);
    return { id, rodada: null };
  }
}
