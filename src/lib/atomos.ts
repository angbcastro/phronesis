/**
 * Escrita do conteúdo no grafo. **É o único módulo que cria `:Atomo` e
 * `:Entidade`**, e só é chamado pelo confirmar — nada entra antes da revisão
 * (regra 5).
 *
 * Três travas de idempotência trabalham juntas (regra 4):
 *
 *   id do átomo = `<sessao_id>-<índice>`   `MERGE` — confirmar duas vezes não duplica
 *   `nome_normalizado` único (constraint)   duas menções à mesma pessoa = um nó
 *   status na cláusula WHERE (em sessoes.ts) confirmar duas vezes não reprocessa
 *
 * Átomo rejeitado **não é gravado**. `status = 'rejeitado'` (regra 6) é para
 * tirar do grafo o que já entrou, não para registrar o que nunca entrou.
 */
import { query } from "./neo4j";
import { novoId } from "./sessoes";
import { TIPOS_ENTIDADE } from "./tipos";
import type { TipoAtomo, TipoEntidade } from "./tipos";

/** Estado de um átomo recém-gravado. Deleção é soft (regra 6). */
export const STATUS_ATOMO_ATIVO = "ativo";

export interface EntidadeParaGravar {
  nome: string;
  nome_normalizado: string;
  tipo: TipoEntidade;
}

export interface AtomoParaGravar {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  /** Listas paralelas, uma entrada por âncora (migration 003). */
  inicios_s: number[];
  fins_s: number[];
  ancoras: string[];
  sobre: string;
  menciona: string[];
  prompt_version: string;
  modelo: string;
}

/**
 * Neo4j não aceita label vindo de parâmetro, e este projeto não depende de
 * APOC. A saída é uma consulta por tipo, com o label literal — seguro porque
 * o valor sai de `TIPOS_ENTIDADE`, uma constante fechada, e nunca do cliente.
 */
function statementDeEntidade(tipo: TipoEntidade): string {
  if (!TIPOS_ENTIDADE.includes(tipo)) throw new Error(`Tipo de entidade inválido: ${tipo}`);
  return `
    UNWIND $entidades AS e
    MERGE (n:Entidade { nome_normalizado: e.nome_normalizado })
    ON CREATE SET n:${tipo}, n.id = e.id, n.nome = e.nome, n.criado_em = $agora
    RETURN count(n) AS gravadas`;
}

/**
 * Cria o que falta e devolve o que já existia intacto.
 *
 * `ON CREATE` é deliberado: entidade que já existe mantém a grafia e os labels
 * que tem. Uma extração não renomeia nem troca o tipo de nada — isso é edição
 * explícita, e não existe nesta slice.
 */
export async function gravarEntidades(entidades: EntidadeParaGravar[]): Promise<void> {
  const agora = new Date().toISOString();

  for (const tipo of TIPOS_ENTIDADE) {
    const doTipo = entidades.filter((e) => e.tipo === tipo);
    if (doTipo.length === 0) continue;

    await query(statementDeEntidade(tipo), {
      entidades: doTipo.map((e) => ({ ...e, id: novoId() })),
      agora,
    });
  }
}

/**
 * Grava os átomos aprovados e as arestas.
 *
 * `valido_em` recebe a data da sessão, não a de agora: é o eixo do "como eu
 * estava em julho". `criado_em` só no `ON CREATE` — reconfirmar não reescreve
 * a data de nascimento do átomo.
 *
 * As menções vão numa consulta à parte porque `UNWIND` de lista vazia mataria
 * a linha inteira, e átomo sem menção é o caso comum.
 *
 * **As arestas atravessam alias** (slice 3): se o nome resolvido for um nó já
 * fundido, quem recebe a aresta é o vencedor da fusão. A trava está aqui, no
 * servidor, e não só na tela — a mesma razão pela qual o confirmar recusa
 * pronome de novo em vez de confiar na revisão. Sem isso, uma proposta montada
 * antes de eu fundir duas entidades penduraria átomo num nó morto.
 *
 * A menção que colidir com o sujeito depois da travessia é descartada: dois
 * nomes distintos podem virar o mesmo nó, e `:SOBRE` + `:MENCIONA` para a mesma
 * entidade não é contrato que o schema admita.
 */
export async function gravarAtomos(
  sessao_id: string,
  atomos: AtomoParaGravar[],
  valido_em: string,
): Promise<void> {
  if (atomos.length === 0) return;
  const agora = new Date().toISOString();

  await query(
    `MATCH (s:Sessao { id: $sessao_id })
     UNWIND $atomos AS a
     MERGE (at:Atomo { id: a.id })
     ON CREATE SET at.criado_em = $agora
     SET at.texto = a.texto,
         at.tipo = a.tipo,
         at.inicios_s = a.inicios_s,
         at.fins_s = a.fins_s,
         at.ancoras = a.ancoras,
         at.valido_em = $valido_em,
         at.status = $status,
         at.prompt_version = a.prompt_version,
         at.modelo = a.modelo
     MERGE (s)-[:GEROU]->(at)
     WITH at, a
     MATCH (e:Entidade { nome_normalizado: a.sobre })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH at, coalesce(v, e) AS alvo
     MERGE (at)-[:SOBRE]->(alvo)`,
    { sessao_id, atomos, agora, valido_em, status: STATUS_ATOMO_ATIVO },
  );

  const mencoes = atomos.flatMap((a) =>
    a.menciona.map((entidade) => ({ atomo_id: a.id, entidade })),
  );
  if (mencoes.length === 0) return;

  await query(
    `UNWIND $mencoes AS m
     MATCH (a:Atomo { id: m.atomo_id })
     MATCH (e:Entidade { nome_normalizado: m.entidade })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH a, coalesce(v, e) AS alvo
     WHERE NOT (a)-[:SOBRE]->(alvo)
     MERGE (a)-[:MENCIONA]->(alvo)`,
    { mencoes },
  );
}

/** Quantos átomos a sessão já tem no grafo. Usado para conferir o confirmar. */
export async function contarAtomos(sessao_id: string): Promise<number> {
  const r = await query<{ total: number }>(
    `MATCH (:Sessao { id: $sessao_id })-[:GEROU]->(a:Atomo) RETURN count(a) AS total`,
    { sessao_id },
  );
  return r[0]?.total ?? 0;
}
