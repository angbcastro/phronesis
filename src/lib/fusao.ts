/**
 * Escrita de higiene no grafo: fundir, renomear, recusar.
 *
 * **Fundir é criar alias, não apagar** (regra 6). O nó perdedor fica, ganha
 * `status = 'fundida'` e uma aresta `:FUNDIDA_EM` para o vencedor; as arestas
 * `:SOBRE` e `:MENCIONA` migram por `MERGE`, então átomo que citava as duas
 * grafias fica com uma aresta, não duas.
 *
 * O ponto do desenho: como o perdedor mantém o `nome_normalizado` — constraint
 * única desde a 002 —, a grafia morta **nunca renasce como nó novo**. Dita
 * outra vez numa sessão futura, ela casa com o alias e a resolução segue até o
 * vencedor (`buscarConhecidas`, em `entidades.ts`). A fusão é o mecanismo de
 * alias, não um efeito colateral dele.
 *
 * Nada aqui é automático: quem funde sou eu, na tela. Fundir duas pessoas
 * diferentes é irreversível num sistema que não desfaz, e o custo do erro é
 * assimétrico — duas entidades a mais é grafo um pouco sujo, uma fusão errada é
 * grafo mentindo.
 */
import { query } from "./neo4j";
import { novoId } from "./sessoes";
import { normalizarNome } from "./texto";

export const STATUS_ENTIDADE_ATIVA = "ativa";
export const STATUS_ENTIDADE_FUNDIDA = "fundida";

export class FusaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FusaoError";
  }
}

export interface ResultadoFusao {
  vencedora: string;
  perdedora: string;
  atomos_migrados: number;
}

/**
 * Funde `perdedora` em `vencedora`, as duas por `nome_normalizado`.
 *
 * Idempotente: a guarda de `status` faz a segunda chamada não achar nada para
 * migrar e devolver zero, sem quebrar.
 */
export async function fundir(
  chaveVencedora: string,
  chavePerdedora: string,
): Promise<ResultadoFusao> {
  const vencedora = normalizarNome(chaveVencedora);
  const perdedora = normalizarNome(chavePerdedora);

  if (vencedora === "" || perdedora === "") {
    throw new FusaoError("fundir exige as duas entidades");
  }
  if (vencedora === perdedora) {
    throw new FusaoError("uma entidade não se funde nela mesma");
  }

  // As duas existem, e a perdedora ainda não foi fundida em outra coisa.
  const par = await query<{ v: string | null; p: string | null; jaFundida: boolean }>(
    `OPTIONAL MATCH (v:Entidade { nome_normalizado: $vencedora })
     OPTIONAL MATCH (p:Entidade { nome_normalizado: $perdedora })
     RETURN v.id AS v, p.id AS p,
            coalesce(p.status, 'ativa') = 'fundida' AS jaFundida`,
    { vencedora, perdedora },
  );
  const linha = par[0];
  if (!linha?.v) throw new FusaoError(`"${chaveVencedora}" não está no grafo`);
  if (!linha?.p) throw new FusaoError(`"${chavePerdedora}" não está no grafo`);
  if (linha.jaFundida) {
    return { vencedora, perdedora, atomos_migrados: 0 };
  }

  // Migra o que aponta para a perdedora. Uma consulta por tipo de aresta, com o
  // tipo literal: Neo4j não aceita tipo de relação vindo de parâmetro, e a
  // alternativa (subquery com UNION para escolher o tipo) é bem mais frágil do
  // que repetir duas linhas. `MERGE` no destino, porque o átomo que citava as
  // duas grafias não pode acabar com a aresta dobrada.
  let migrados = 0;
  for (const tipo of ["SOBRE", "MENCIONA"] as const) {
    const r = await query<{ n: number }>(
      `MATCH (p:Entidade { nome_normalizado: $perdedora })
       MATCH (v:Entidade { nome_normalizado: $vencedora })
       MATCH (a:Atomo)-[r:${tipo}]->(p)
       MERGE (a)-[:${tipo}]->(v)
       DELETE r
       RETURN count(DISTINCT a) AS n`,
      { vencedora, perdedora },
    );
    migrados += r[0]?.n ?? 0;
  }

  // Um átomo podia citar as duas grafias: sujeito numa, menção na outra. Depois
  // da migração isso viraria :SOBRE e :MENCIONA para o mesmo nó, e o contrato
  // do schema não admite — o sujeito vence, a menção redundante cai.
  await query(
    `MATCH (a:Atomo)-[m:MENCIONA]->(v:Entidade { nome_normalizado: $vencedora })
     WHERE (a)-[:SOBRE]->(v)
     DELETE m`,
    { vencedora },
  );

  // O alias. `status` e a aresta são o que faz toda leitura pular este nó.
  await query(
    `MATCH (p:Entidade { nome_normalizado: $perdedora })
     MATCH (v:Entidade { nome_normalizado: $vencedora })
     SET p.status = $fundida, p.fundida_em = $agora
     MERGE (p)-[:FUNDIDA_EM]->(v)`,
    {
      vencedora,
      perdedora,
      fundida: STATUS_ENTIDADE_FUNDIDA,
      agora: new Date().toISOString(),
    },
  );

  return { vencedora, perdedora, atomos_migrados: migrados };
}

/**
 * Renomear é fundir consigo mesma sob outro nome.
 *
 * O nó ganha o nome novo e a chave nova; a grafia velha fica como **alias
 * apontando para ele**, o que resolve o limite que existia até aqui — renomear
 * uma entidade que já está no grafo criava um segundo nó, porque a resolução
 * casa por `nome_normalizado`. Agora "meu pai" dito de novo cai no nó do nome
 * de verdade.
 */
export async function renomear(chaveAtual: string, nomeNovo: string): Promise<void> {
  const atual = normalizarNome(chaveAtual);
  const novo = nomeNovo.trim();
  const chaveNova = normalizarNome(novo);

  if (atual === "") throw new FusaoError("renomear exige a entidade");
  if (chaveNova === "") throw new FusaoError("o nome novo não pode ser vazio");
  if (atual === chaveNova) {
    // Só mudou a caixa ou a pontuação: troca o nome de exibição e pronto,
    // porque a chave é a mesma e não há alias a criar.
    await query(
      `MATCH (e:Entidade { nome_normalizado: $atual }) SET e.nome = $novo`,
      { atual, novo },
    );
    return;
  }

  const conflito = await query<{ id: string }>(
    `MATCH (e:Entidade { nome_normalizado: $chaveNova }) RETURN e.id AS id`,
    { chaveNova },
  );
  if (conflito.length > 0) {
    throw new FusaoError(
      `já existe uma entidade chamada "${novo}" — em vez de renomear, funda as duas`,
    );
  }

  // O nó assume o nome novo, e nasce um alias com a grafia velha apontando para
  // ele. O alias precisa de id próprio: `entidade_id` é constraint única.
  await query(
    `MATCH (e:Entidade { nome_normalizado: $atual })
     SET e.nome = $novo, e.nome_normalizado = $chaveNova
     CREATE (alias:Entidade {
       id: $idAlias, nome: $nomeVelho, nome_normalizado: $atual,
       criado_em: $agora, status: $fundida, fundida_em: $agora
     })
     MERGE (alias)-[:FUNDIDA_EM]->(e)`,
    {
      atual,
      chaveNova,
      novo,
      nomeVelho: chaveAtual,
      idAlias: novoId(),
      agora: new Date().toISOString(),
      fundida: STATUS_ENTIDADE_FUNDIDA,
    },
  );
}

/**
 * "Essas duas são pessoas diferentes." Grava para não voltar a ser perguntado.
 *
 * Sem isso a tela vira cobrança: a mesma sugestão toda vez que eu peço
 * duplicatas. Ignorar é saída válida (visão §5.3); ignorar a mesma pergunta
 * doze vezes não é.
 *
 * Uma aresta só, em direção arbitrária — quem lê consulta nos dois sentidos.
 */
export async function marcarDistintas(chaveA: string, chaveB: string): Promise<void> {
  const a = normalizarNome(chaveA);
  const b = normalizarNome(chaveB);
  if (a === "" || b === "") throw new FusaoError("marcar distintas exige as duas entidades");
  if (a === b) throw new FusaoError("uma entidade não é distinta dela mesma");

  await query(
    `MATCH (x:Entidade { nome_normalizado: $a })
     MATCH (y:Entidade { nome_normalizado: $b })
     MERGE (x)-[:DISTINTA_DE]->(y)`,
    { a, b },
  );
}

/** Os pares que eu já disse serem coisas diferentes, nos dois sentidos. */
export async function paresDistintos(): Promise<Set<string>> {
  const linhas = await query<{ a: string; b: string }>(
    `MATCH (x:Entidade)-[:DISTINTA_DE]-(y:Entidade)
     RETURN x.nome_normalizado AS a, y.nome_normalizado AS b`,
  );
  const pares = new Set<string>();
  for (const l of linhas) {
    pares.add(chaveDoPar(l.a, l.b));
  }
  return pares;
}

/** Chave estável de um par, independente da ordem em que ele veio. */
export const chaveDoPar = (a: string, b: string): string => [a, b].sort().join("|");
