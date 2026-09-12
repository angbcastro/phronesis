/**
 * O dump diário do grafo para o R2.
 *
 * Aura Free não tem backup gerenciado, e o grafo é a única cópia do que o
 * diário virou: os áudios e as transcrições estão no R2, mas átomo, entidade,
 * ficha e aresta existem num lugar só. Uma batida por dia grava tudo isso como
 * JSON ao lado do áudio que o originou.
 *
 * A mesma batida tem um segundo efeito, e ele não é acessório: instância Aura
 * Free é **pausada após 72 h sem atividade**, e pausada o hostname deixa de
 * resolver — três dias sem falar e o app responde 502 até alguém despausar no
 * console. Uma consulta por dia zera esse relógio.
 *
 * **Não há caminho de volta nesta fatia.** Restaurar é escrever de novo nós e
 * arestas num banco vazio, e isso não está construído — decisão declarada, e o
 * §14 a carrega como dívida. O que existe aqui é a cópia; o dia em que ela
 * precisar ser usada vai custar trabalho.
 */
import { chaveBackup } from "./chaves";
import { query } from "./neo4j";
import { putJson } from "./r2";

export interface NoDoDump {
  labels: string[];
  props: Record<string, unknown>;
}

export interface ArestaDoDump {
  de: string;
  tipo: string;
  para: string;
  props: Record<string, unknown>;
}

export interface DumpGrafo {
  gerado_em: string;
  nos: NoDoDump[];
  arestas: ArestaDoDump[];
}

/**
 * O vetor fica de fora, e a exclusão acontece **no Cypher**.
 *
 * São 1536 floats por nó — ~12 KB de propriedade, ~48 MB num grafo de 4.000
 * átomos (§14). Excluir em JavaScript ainda faria esses megabytes atravessarem
 * a Query API a cada madrugada para serem jogados fora na função; a lista de
 * pares `[chave, valor]` os deixa no banco.
 *
 * É legítimo excluir porque o vetor é **derivado**: `passadaDeVetores()` o
 * refaz a partir do texto, por hash (§8.4). O dump carrega o que só existe
 * uma vez, não o que se recalcula.
 */
const PROPS_SEM_VETOR = `[k IN keys(n) WHERE k <> 'embedding' | [k, n[k]]]`;

/** Pares `[chave, valor]` do Cypher viram objeto. Puro, para caber em teste. */
export function objetoDePares(pares: [string, unknown][]): Record<string, unknown> {
  return Object.fromEntries(pares);
}

export function montarDump(
  nos: { labels: string[]; pares: [string, unknown][] }[],
  arestas: ArestaDoDump[],
  agora: Date = new Date(),
): DumpGrafo {
  return {
    gerado_em: agora.toISOString(),
    nos: nos.map((n) => ({ labels: n.labels, props: objetoDePares(n.pares) })),
    arestas,
  };
}

/**
 * A chave gira pelo dia do mês, e é isso que faz a janela se podar sozinha.
 *
 * `r2.ts` não tem `LIST`, por decisão — e um backup que precisasse listar para
 * saber o que apagar abriria essa exceção pelo motivo mais banal que existe.
 * Sobrescrevendo `grafo-07.json` todo dia 7, sobram entre 28 e 31 cópias sem
 * nenhum LIST e sem nenhum DELETE.
 */
export async function gerarBackup(agora: Date = new Date()): Promise<{ key: string; nos: number }> {
  const nos = await query<{ labels: string[]; pares: [string, unknown][] }>(
    `MATCH (n) RETURN labels(n) AS labels, ${PROPS_SEM_VETOR} AS pares`,
  );

  // Nó sem `id` não tem como ser referenciado por uma aresta, e nenhum label
  // deste schema nasce sem ele — a guarda existe para a aresta órfã não entrar
  // calada no dump e mentir sobre estar completa.
  const arestas = await query<ArestaDoDump>(
    `MATCH (a)-[r]->(b)
     WHERE a.id IS NOT NULL AND b.id IS NOT NULL
     RETURN a.id AS de, type(r) AS tipo, b.id AS para, properties(r) AS props`,
  );

  const dump = montarDump(nos, arestas, agora);
  const key = chaveBackup(agora);
  await putJson(key, dump);

  console.log(`[backup] ${key}: ${dump.nos.length} nós, ${dump.arestas.length} arestas`);
  return { key, nos: dump.nos.length };
}
