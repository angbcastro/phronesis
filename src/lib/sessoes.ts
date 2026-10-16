/**
 * Repositório de :Sessao. Único label do grafo nesta slice.
 *
 * No grafo vai só a chave: manifest, áudio e texto vivem no R2 (regra 2).
 */
import { query, queryUm } from "./neo4j";
import { chaveTranscricao, prefixoSessao } from "./chaves";
import {
  LIMITE_LISTA_SESSOES,
  type AtomoProposto,
  type Sessao,
  type StatusSessao,
} from "./tipos";

/** id em base36: ordenável por tempo e casa com `idValido`. */
export function novoId(agora: number = Date.now()): string {
  const tempo = agora.toString(36);
  const aleatorio = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return `${tempo}${aleatorio}`.slice(0, 24);
}

export async function criarSessao(): Promise<Sessao> {
  const id = novoId();
  const sessao: Sessao = {
    id,
    iniciada_em: new Date().toISOString(),
    duracao_s: 0,
    status: "gravando",
    audio_key: prefixoSessao(id),
    transcricao_key: chaveTranscricao(id),
    chunks_total: 0,
  };

  await query(
    `CREATE (s:Sessao {
       id: $id, iniciada_em: $iniciada_em, duracao_s: $duracao_s, status: $status,
       audio_key: $audio_key, transcricao_key: $transcricao_key, chunks_total: $chunks_total
     })`,
    sessao as unknown as Record<string, unknown>,
  );

  return sessao;
}

export async function buscarSessao(id: string): Promise<Sessao | null> {
  const r = await queryUm<{ sessao: Sessao }>(
    `MATCH (s:Sessao { id: $id }) RETURN s { .* } AS sessao`,
    { id },
  );
  return r?.sessao ?? null;
}

interface Atualizacao {
  status?: StatusSessao;
  duracao_s?: number;
  chunks_total?: number;
}

/**
 * Atualiza a sessão só se o status atual estiver em `sePartirDe`.
 * É a guarda de idempotência das rotas: um segundo `finalizar` não
 * rebaixa uma sessão já `transcrito`.
 */
export async function atualizarSessao(
  id: string,
  mudanca: Atualizacao,
  sePartirDe?: StatusSessao[],
): Promise<Sessao | null> {
  const guarda = sePartirDe ? `AND s.status IN $de` : "";
  const r = await queryUm<{ sessao: Sessao }>(
    `MATCH (s:Sessao { id: $id })
     WHERE true ${guarda}
     SET s += $mudanca
     RETURN s { .* } AS sessao`,
    { id, mudanca, de: sePartirDe ?? [] },
  );
  return r?.sessao ?? null;
}

/**
 * Uma sessão na lista de `/sessoes`, com o que ela tem dentro (onda 4 da
 * interface): a linha começa pelo que eu disse, e a data é detalhe.
 */
export interface SessaoNaLista extends Sessao {
  /** O texto do primeiro item — o primeiro que eu disse. "" sem item. */
  frase: string;
  /**
   * Quantos itens: os átomos ativos no grafo (confirmada) ou os da proposta (em
   * revisão). `null` em sessão que não tem o que contar.
   */
  itens: number | null;
}

export interface PaginaDeSessoes {
  sessoes: SessaoNaLista[];
  /** Há sessões mais antigas que a última desta página. */
  mais: boolean;
  /** O `iniciada_em` da última lida — o `antes` da próxima página. */
  cursor: string | null;
}

/**
 * Sessão sem bloco nenhum não entra na lista: foi criada e largada antes de
 * gravar, e não é áudio nenhum. A que está gravando entra — o bloco dela só
 * conta quando sobe.
 */
export const apareceNaLista = (s: Pick<Sessao, "chunks_total" | "status">): boolean =>
  s.chunks_total > 0 || s.status === "gravando";

/**
 * Uma página da lista, da mais recente para a mais antiga, a partir de
 * `antes` (exclusivo). A lista é de onde se acha uma sessão e se força uma
 * re-extração, e a tela pede a página seguinte quando a rolagem chega ao fim.
 * Sessão descartada some daqui, e é só daqui: o nó continua no grafo, com os
 * átomos que ele gerou pendurados (regra 6).
 *
 * **O `mais` e o `cursor` são da leitura crua**, antes de `apareceNaLista`: com
 * o filtro antes, uma página que perdeu metade para sessões sem bloco
 * pareceria o fim da lista. Lê uma a mais que o limite para saber se há mais.
 *
 * A frase e a contagem das **confirmadas** vêm na mesma consulta: os átomos
 * dela estão no grafo, e o primeiro é o de menor `inicios_s[0]` — o primeiro
 * que eu disse —, com os sem âncora por último, na ordem do id. As em revisão
 * têm os átomos na proposta, no R2, e quem os lê é a rota.
 */
export async function paginaDeSessoes(
  antes: string | null = null,
  limite = LIMITE_LISTA_SESSOES,
): Promise<PaginaDeSessoes> {
  const linhas = await query<{ sessao: Sessao; itens: number; frase: string | null }>(
    `MATCH (s:Sessao)
     WHERE s.descartada_em IS NULL AND ($antes IS NULL OR s.iniciada_em < $antes)
     WITH s ORDER BY s.iniciada_em DESC LIMIT $lidas
     OPTIONAL MATCH (s)-[:GEROU]->(a:Atomo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
     WITH s, a ORDER BY coalesce(a.inicios_s[0], 1.0e12), toInteger(split(a.id, '-')[1])
     WITH s, collect(a.texto) AS textos
     RETURN s { .* } AS sessao, size(textos) AS itens, textos[0] AS frase
     ORDER BY s.iniciada_em DESC`,
    { antes, lidas: limite + 1 },
  );
  const lidas = linhas.slice(0, limite);
  return {
    mais: linhas.length > limite,
    cursor: lidas.length > 0 ? lidas[lidas.length - 1].sessao.iniciada_em : null,
    sessoes: lidas.map(({ sessao, itens, frase }) =>
      sessao.status === "confirmada"
        ? { ...sessao, frase: frase ?? "", itens: typeof itens === "number" ? itens : 0 }
        : { ...sessao, frase: "", itens: null },
    ),
  };
}

/** Quantas sessões a lista tem ao todo — o cabeçalho. O filtro é o de `apareceNaLista`. */
export async function contarSessoes(): Promise<number> {
  const r = await queryUm<{ total: number }>(
    `MATCH (s:Sessao)
     WHERE s.descartada_em IS NULL
       AND (coalesce(s.chunks_total, 0) > 0 OR s.status = 'gravando')
     RETURN count(s) AS total`,
    {},
  );
  return r?.total ?? 0;
}

/**
 * A frase da sessão em revisão: o primeiro item da proposta, pela mesma regra
 * do grafo — o de menor início ancorado, e os sem âncora por último, na ordem
 * do índice. "" quando a proposta está vazia.
 */
export function primeiroItem(
  atomos: readonly Pick<AtomoProposto, "texto" | "indice" | "trechos">[],
): string {
  const inicio = (a: Pick<AtomoProposto, "trechos">) =>
    (a.trechos ?? []).find((t) => t.inicio_s !== null)?.inicio_s ?? Number.POSITIVE_INFINITY;
  const ordem = [...atomos].sort((a, b) => inicio(a) - inicio(b) || a.indice - b.indice);
  return ordem[0]?.texto ?? "";
}

/**
 * A sessão sai da lista, e os objetos dela saem do R2 (quem apaga é a rota).
 *
 * **Sem `DELETE` no grafo**, e não por conservadorismo: a regra 6 proíbe apagar
 * átomo, e um `DETACH DELETE` no `:Sessao` levaria junto o `GEROU` e orfanaria
 * os átomos de uma sessão já confirmada. O nó fica, marcado.
 *
 * A consequência aceita: `audio_key` e `transcricao_key` de uma sessão
 * descartada passam a apontar para objetos que não existem mais. A procedência
 * do átomo continua verdadeira sobre o que ele foi; o que sumiu foi o material.
 */
export async function descartarSessao(id: string): Promise<Sessao | null> {
  const r = await queryUm<{ sessao: Sessao }>(
    `MATCH (s:Sessao { id: $id })
     SET s.descartada_em = $em
     RETURN s { .* } AS sessao`,
    { id, em: new Date().toISOString() },
  );
  return r?.sessao ?? null;
}

