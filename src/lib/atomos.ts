/**
 * Escrita do conteúdo no grafo. **É o único módulo que cria `:Atomo`**, e só é
 * chamado pelo confirmar — nenhum átomo entra antes da revisão (regra 5).
 *
 * `:Entidade` também nasce aqui, mas não só: `fusao.ts` cria uma quando eu
 * semeio um nome à mão em `/entidades`, antes de falá-lo pela primeira vez.
 * Isso não fura a regra 5 — o que ela proíbe é o **pipeline** gravar sem passar
 * por mim, e semear é literalmente eu digitando e apertando criar.
 *
 * Quatro travas de idempotência trabalham juntas (regra 4):
 *
 *   id do átomo = `<sessao_id>-<índice>`   `MERGE` — confirmar duas vezes não duplica
 *   `campo` dentro do `MERGE` de :PERFILA    reconfirmar não dobra a aresta
 *   `nome_normalizado` único (constraint)   duas menções à mesma pessoa = um nó
 *   status na cláusula WHERE (em sessoes.ts) confirmar duas vezes não reprocessa
 *
 * Átomo rejeitado **não é gravado**. `status = 'rejeitado'` (regra 6) é para
 * tirar do grafo o que já entrou, não para registrar o que nunca entrou.
 *
 * **O átomo gravado ganha vetor** (slice 4.5), e ganha **depois** de estar no
 * grafo. Vetor é derivável do texto a qualquer momento, e por isso nada no
 * caminho do embedding pode impedir uma gravação de acontecer: falha do Gateway
 * deixa o átomo sem vetor e `POST /api/atomos/embutir` o alcança depois.
 */
import { embutirVarios } from "./embedding";
import { modeloEmbedding } from "./modelos";
import { query } from "./neo4j";
import { novoId } from "./sessoes";
import { CAMPOS_PERFIL, TIPOS_ENTIDADE } from "./tipos";
import type { CampoPerfil, TipoAtomo, TipoEntidade } from "./tipos";

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
  /**
   * O que este átomo diz do perfil de quem (migration 005). Entidade por
   * `nome_normalizado`, como `sobre` e `menciona`.
   */
  perfila: { entidade: string; campo: CampoPerfil }[];
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

  if (mencoes.length > 0) {
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

  await gravarPerfila(atomos);

  // **Depois de gravar, e nunca antes** (slice 4.5). O vetor é derivável do
  // texto a qualquer momento; a gravação não é. Falha do Gateway aqui deixa o
  // átomo no grafo sem vetor, e `POST /api/atomos/embutir` o alcança depois —
  // é a regra de precedência da slice inteira: nada no caminho do embedding
  // pode impedir uma gravação de acontecer.
  try {
    await embutirAtomos(atomos.map((a) => ({ id: a.id, texto: a.texto })));
  } catch (e) {
    console.error(
      `[atomos] ${atomos.length} átomo(s) gravados sem vetor; ` +
        `POST /api/atomos/embutir refaz. Causa:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/** Um átomo esperando vetor: o id para gravar, o texto para embutir. */
export interface AtomoParaEmbutir {
  id: string;
  texto: string;
}

/**
 * Calcula e grava o vetor destes átomos.
 *
 * **Só `a.texto` vira vetor** — nada de tipo, de entidade ou de sessão. As três
 * já são estrutura no grafo, e a divisão é essa: o corte estrutural é do grafo,
 * o semântico é do vetor. Enfiar o tipo no texto embutido faria dois APRENDIZADO
 * parecerem próximos por serem APRENDIZADO, que é exatamente o sinal que o grafo
 * já dá de graça e melhor.
 *
 * `embedding_modelo` vai junto do vetor, sempre: dois modelos no mesmo índice
 * não dão erro, dão vizinhança errada, e sem o campo não há como saber quem
 * refazer quando `EMBEDDING_MODEL` mudar.
 *
 * **Átomo que já tem vetor deste modelo não é reembutido.** A trava é uma
 * consulta antes da chamada, e não a boa vontade de quem chama: o retrofill já
 * chega com a lista filtrada, mas o confirmar chega com a sessão inteira, e
 * reconfirmar não pode pagar o Gateway de novo (regra 4).
 *
 * Devolve quantos foram gravados. Estoura quando o Gateway estoura — quem chama
 * decide se isso derruba alguma coisa, e no caminho do confirmar não derruba.
 */
export async function embutirAtomos(atomos: readonly AtomoParaEmbutir[]): Promise<number> {
  const candidatos = atomos.filter((a) => a.id !== "" && a.texto.trim() !== "");
  if (candidatos.length === 0) return 0;

  const faltantes = await idsSemVetor(candidatos.map((a) => a.id));
  const alvos = candidatos.filter((a) => faltantes.has(a.id));
  if (alvos.length === 0) return 0;

  const vetores = await embutirVarios(alvos.map((a) => a.texto));

  await query(
    `UNWIND $vetores AS v
     MATCH (a:Atomo { id: v.id })
     SET a.embedding = v.embedding, a.embedding_modelo = v.modelo`,
    {
      vetores: alvos.map((a, i) => ({
        id: a.id,
        embedding: vetores[i].embedding,
        modelo: vetores[i].modelo,
      })),
    },
  );

  return alvos.length;
}

/** A condição de "precisa de vetor", num lugar só. Ver `atomosSemVetor`. */
const FALTA_VETOR = `a.embedding IS NULL OR coalesce(a.embedding_modelo, '') <> $modelo`;

/** Destes ids, quais ainda precisam de vetor. */
async function idsSemVetor(ids: readonly string[]): Promise<Set<string>> {
  const linhas = await query<{ id: string }>(
    `MATCH (a:Atomo) WHERE a.id IN $ids AND (${FALTA_VETOR}) RETURN a.id AS id`,
    { ids, modelo: modeloEmbedding() },
  );
  return new Set(linhas.map((l) => l.id));
}

/**
 * Os átomos que ainda precisam de vetor — o que o retrofill pega.
 *
 * Duas condições, e a segunda é a que justifica `embedding_modelo` existir:
 * átomo sem vetor nenhum, e átomo cujo vetor veio de **outro** modelo. Trocar
 * `EMBEDDING_MODEL` sem isto deixaria o grafo com dois espaços vetoriais
 * misturados no mesmo índice — que não dá erro, dá vizinhança errada.
 *
 * Rodar duas vezes com o mesmo modelo devolve lista vazia na segunda: é a trava
 * de idempotência desta rota (regra 4).
 */
export async function atomosSemVetor(limite: number): Promise<AtomoParaEmbutir[]> {
  const modelo = modeloEmbedding();
  return query<AtomoParaEmbutir>(
    `MATCH (a:Atomo)
     WHERE ${FALTA_VETOR}
     RETURN a.id AS id, a.texto AS texto
     ORDER BY a.criado_em
     LIMIT $limite`,
    { modelo, limite },
  );
}

/**
 * As arestas `(:Atomo)-[:PERFILA { campo }]->(:Entidade)` (migration 005).
 *
 * Quem aponta é o agente de resolução, que já olha átomo e entidade juntos;
 * quem grava é aqui, no confirmar, junto com os átomos e nunca antes (regra 5).
 *
 * O `campo` vai **dentro** do `MERGE`, e é o que faz reconfirmar não criar
 * aresta repetida (regra 4): o par (átomo, campo, entidade) é a identidade da
 * aresta. Fora do `MERGE`, um `SET` depois criaria uma aresta nova a cada
 * confirmação.
 *
 * Atravessa alias como `:SOBRE` e `:MENCIONA`: proposta montada antes de eu
 * fundir duas entidades penduraria a marca num nó morto.
 */
async function gravarPerfila(atomos: AtomoParaGravar[]): Promise<void> {
  const marcas = atomos.flatMap((a) =>
    (a.perfila ?? [])
      .filter((m) => CAMPOS_PERFIL.includes(m.campo))
      .map((m) => ({ atomo_id: a.id, entidade: m.entidade, campo: m.campo })),
  );
  if (marcas.length === 0) return;

  await query(
    `UNWIND $marcas AS m
     MATCH (a:Atomo { id: m.atomo_id })
     MATCH (e:Entidade { nome_normalizado: m.entidade })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH a, coalesce(v, e) AS alvo, m
     MERGE (a)-[:PERFILA { campo: m.campo }]->(alvo)`,
    { marcas },
  );
}

/**
 * Quantos átomos ainda esperam vetor no grafo inteiro.
 *
 * Contagem própria, e não `atomosSemVetor().length`: aquela tem `LIMIT`, e um
 * "restam 200" que na verdade são 3.800 faria o retrofill parecer terminado
 * quando mal começou.
 */
export async function contarAtomosSemVetor(): Promise<number> {
  const r = await query<{ total: number }>(
    `MATCH (a:Atomo) WHERE ${FALTA_VETOR} RETURN count(a) AS total`,
    { modelo: modeloEmbedding() },
  );
  return r[0]?.total ?? 0;
}

/** Quantos átomos a sessão já tem no grafo. Usado para conferir o confirmar. */
export async function contarAtomos(sessao_id: string): Promise<number> {
  const r = await query<{ total: number }>(
    `MATCH (:Sessao { id: $sessao_id })-[:GEROU]->(a:Atomo) RETURN count(a) AS total`,
    { sessao_id },
  );
  return r[0]?.total ?? 0;
}
