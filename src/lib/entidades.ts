/**
 * Resolução de entidade: achar no grafo o que já existe.
 *
 * "Rodozanco" na segunda sessão tem que encontrar o nó da primeira. O
 * casamento é por `nome_normalizado` (minúsculas, sem acento, sem pontuação —
 * `texto.ts`), contra as `:Entidade` que já estão lá.
 *
 * **Resolução, não deduplicação.** Juntar "Exxmed" com "Exx Med" exige
 * semântica e é slice 3. Aqui, nome diferente é entidade diferente.
 *
 * **Nada é escrito.** Este módulo só lê: a criação dos nós acontece no
 * confirmar, depois da revisão (regra 5). O que ele devolve é uma lista de
 * candidatas, cada uma dizendo se já existe ou se seria nova.
 *
 * A trava contra o grafo apodrecido não é este código: é a constraint de
 * `nome_normalizado` único, que vale entre **todas** as entidades. Duas
 * menções à mesma pessoa não viram dois nós nem em corrida, porque quem
 * garante é o banco (migration 002).
 */
import { query } from "./neo4j";
import { tokenizar } from "./texto";
import { TIPOS_ENTIDADE } from "./tipos";
import type { AtomoCru, EntidadeCandidata, TipoEntidade } from "./tipos";

/** Tipo de quem o extrator não classificou. Num diário falado, quase sempre acerta. */
export const TIPO_PADRAO: TipoEntidade = "Pessoa";

/**
 * A chave única do grafo. Mesma normalização que o casamento de offsets usa —
 * ver `texto.ts` para o porquê de morar num lugar só.
 */
export const normalizarNome = (nome: string): string => tokenizar(nome).join(" ");

/** "PESSOA", "pessoa", "Pessoa" — tudo a mesma coisa. Fora da lista, `null`. */
export function normalizarTipoEntidade(valor: unknown): TipoEntidade | null {
  if (typeof valor !== "string") return null;
  const alvo = normalizarNome(valor);
  return TIPOS_ENTIDADE.find((t) => normalizarNome(t) === alvo) ?? null;
}

/** O que o extrator propôs sobre uma entidade, antes de olhar o grafo. */
export interface EntidadePropostaFrase {
  nome: string;
  tipo?: unknown;
}

interface Coletada {
  nome: string;
  nome_normalizado: string;
  tipo: TipoEntidade;
  ocorrencias: number;
}

/**
 * Junta as entidades citadas pelos átomos com os tipos que o extrator propôs.
 *
 * A contagem sai dos átomos, não da lista de tipos: é ela que diz o que a
 * sessão de fato menciona. Entidade que o modelo listou e nenhum átomo cita
 * não entra — seria um nó órfão no grafo.
 *
 * A primeira grafia vista vence como nome de exibição. `nome_normalizado` é
 * quem une as variações.
 */
export function coletar(
  atomos: AtomoCru[],
  propostas: EntidadePropostaFrase[] = [],
): Coletada[] {
  const tipos = new Map<string, TipoEntidade>();
  for (const p of propostas) {
    const chave = normalizarNome(p.nome ?? "");
    const tipo = normalizarTipoEntidade(p.tipo);
    if (chave !== "" && tipo && !tipos.has(chave)) tipos.set(chave, tipo);
  }

  const porChave = new Map<string, Coletada>();

  const contar = (nome: string) => {
    const chave = normalizarNome(nome);
    if (chave === "") return;
    const existente = porChave.get(chave);
    if (existente) {
      existente.ocorrencias++;
      return;
    }
    porChave.set(chave, {
      nome: nome.trim(),
      nome_normalizado: chave,
      tipo: tipos.get(chave) ?? TIPO_PADRAO,
      ocorrencias: 1,
    });
  };

  for (const atomo of atomos) {
    contar(atomo.sobre);
    for (const m of atomo.menciona) contar(m);
  }

  return [...porChave.values()];
}

interface LinhaEntidade {
  id: string;
  nome: string;
  nome_normalizado: string;
  labels: string[];
  /** Em quantas sessões passadas ela apareceu. */
  sessoes: number;
}

/** O label que não é `:Entidade`. Nó sem tipo reconhecível cai no padrão. */
export function tipoDosLabels(labels: string[]): TipoEntidade {
  return TIPOS_ENTIDADE.find((t) => labels.includes(t)) ?? TIPO_PADRAO;
}

/**
 * Uma consulta só para a sessão inteira, não uma por entidade.
 *
 * `sessoes` é o que a revisão mostra para eu decidir se a entidade vira nó:
 * "conhecida (3 sessões)" contra "nova, citada 1x". `OPTIONAL MATCH` porque
 * entidade pode existir sem átomo apontando para ela — foi criada numa revisão
 * e os átomos dela foram todos rejeitados depois.
 */
export async function buscarConhecidas(chaves: string[]): Promise<LinhaEntidade[]> {
  if (chaves.length === 0) return [];
  return query<LinhaEntidade>(
    `MATCH (e:Entidade)
     WHERE e.nome_normalizado IN $chaves
     OPTIONAL MATCH (e)<-[:SOBRE|:MENCIONA]-(:Atomo)<-[:GEROU]-(s:Sessao)
     RETURN e.id AS id, e.nome AS nome, e.nome_normalizado AS nome_normalizado,
            labels(e) AS labels, count(DISTINCT s) AS sessoes`,
    { chaves },
  );
}

/**
 * Confronta as candidatas com o grafo.
 *
 * Quando a entidade já existe, o que está no grafo vence: o nome com a grafia
 * já gravada e o tipo dos labels do nó. O extrator propor `:Pessoa` para algo
 * que já é `:Projeto` não muda o nó — e mudar o tipo de uma entidade existente
 * é edição na revisão, não efeito colateral de uma extração.
 */
export async function resolver(coletadas: Coletada[]): Promise<EntidadeCandidata[]> {
  const conhecidas = new Map(
    (await buscarConhecidas(coletadas.map((c) => c.nome_normalizado))).map((e) => [
      e.nome_normalizado,
      e,
    ]),
  );

  return coletadas.map((c) => {
    const no = conhecidas.get(c.nome_normalizado);
    return no
      ? {
          nome: no.nome,
          nome_normalizado: c.nome_normalizado,
          tipo: tipoDosLabels(no.labels ?? []),
          conhecida: true,
          id: no.id,
          ocorrencias: c.ocorrencias,
          sessoes: no.sessoes ?? 0,
        }
      : { ...c, conhecida: false, id: null, sessoes: 0 };
  });
}

/** Atalho do caminho inteiro: dos átomos crus às candidatas resolvidas. */
export async function resolverEntidades(
  atomos: AtomoCru[],
  propostas: EntidadePropostaFrase[] = [],
): Promise<EntidadeCandidata[]> {
  return resolver(coletar(atomos, propostas));
}
