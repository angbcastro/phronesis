/**
 * O grafo de entidades como as outras camadas o enxergam: quem existe, com que
 * nome, que tipo e que perfil — e como as menções de uma sessão se agregam numa
 * lista para a revisão.
 *
 * **Conteúdo não é escrito aqui.** Este módulo lê: `:Entidade` nasce no
 * confirmar (`atomos.ts`) ou quando eu semeio um nome à mão (`fusao.ts`). Antes
 * da confirmação na revisão o grafo não recebe nada (regra 5).
 *
 * A exceção é o **vetor** (slice 4.5). `garantirEmbeddings()` escreve
 * `embedding`, `embedding_modelo` e `embedding_fonte`, e isso não fura a regra
 * 5: nada ali é conteúdo, é derivado. O vetor é uma função do que já está no
 * grafo — apagá-lo e recalculá-lo não perde nada, e nenhuma afirmação nova
 * entra por esse caminho.
 *
 * **A resolução mudou de lugar na slice 4.** Até a 3, `coletar()` colapsava
 * todas as menções ao mesmo nome numa candidata só, válida para a sessão
 * inteira, e o casamento era por `nome_normalizado`. Isso deixou de servir: dois
 * átomos da mesma sessão dizendo "Rafa" podem ser duas pessoas, e uma candidata
 * por nome não tem como expressar isso. Quem atribui agora é `resolucao.ts`,
 * menção por menção; aqui ficou o catálogo que ele lê (`listarEntidades`) e a
 * agregação que a revisão mostra (`agregarCandidatas`).
 *
 * A trava contra o grafo apodrecido continua não sendo este código: é a
 * constraint de `nome_normalizado` único, que vale entre **todas** as entidades.
 * Duas menções à mesma pessoa não viram dois nós nem em corrida, porque quem
 * garante é o banco (migration 002).
 */
import { embutirVarios, fonteDaEntidade, hashDaFonte } from "./embedding";
import { modeloEmbedding } from "./modelos";
import { query } from "./neo4j";
import { ehPronome, normalizarNome } from "./texto";
import { PERFIL_VAZIO, TIPOS_ENTIDADE } from "./tipos";
import type {
  EntidadeCandidata,
  EntidadePropostaFrase,
  Evidencia,
  Perfil,
  ReferenciaResolvida,
  TipoEntidade,
} from "./tipos";

/** Tipo de quem o extrator não classificou. Num diário falado, quase sempre acerta. */
export const TIPO_PADRAO: TipoEntidade = "Pessoa";

// A normalização e a lista de pronomes moram em `texto.ts`: a revisão, no
// navegador, precisa das duas para montar o payload com as mesmas chaves.
export { ehPronome, normalizarNome };
export type { EntidadePropostaFrase };

/** "PESSOA", "pessoa", "Pessoa" — tudo a mesma coisa. Fora da lista, `null`. */
export function normalizarTipoEntidade(valor: unknown): TipoEntidade | null {
  if (typeof valor !== "string") return null;
  const alvo = normalizarNome(valor);
  return TIPOS_ENTIDADE.find((t) => normalizarNome(t) === alvo) ?? null;
}

/** O label que não é `:Entidade`. Nó sem tipo reconhecível cai no padrão. */
export function tipoDosLabels(labels: string[]): TipoEntidade {
  return TIPOS_ENTIDADE.find((t) => labels.includes(t)) ?? TIPO_PADRAO;
}

/**
 * Uma entidade como a tela de manutenção a mostra — e como o agente de
 * resolução a lê. É o mesmo objeto de propósito: duas consultas quase iguais
 * divergiriam, e a que o agente lê é a que decide a quem o átomo pertence.
 */
export interface EntidadeDoGrafo {
  id: string;
  nome: string;
  nome_normalizado: string;
  /**
   * Todas as grafias que resolvem para este nó: a própria, as que estão em
   * `e.aliases` e as dos nós já fundidos nele. É por esta lista que o casamento
   * exato atravessa alias sem uma segunda consulta.
   */
  chaves: string[];
  tipo: TipoEntidade;
  sessoes: number;
  atomos: number;
  /**
   * As grafias desta entidade — o histórico do nome, e o que o STT costuma
   * errar.
   *
   * **Duas fontes desde a 4.11**, e a lista é a união delas: a propriedade
   * `e.aliases` (a grafia que eu confirmo na revisão, o nome velho de um
   * renome, e o que eu escrevo à mão em `/entidades`) e os nós que perderam uma
   * **fusão de verdade**, que continuam sendo nó porque são o registro de uma
   * decisão minha. A migration 009 converteu as grafias que eram nó; o que
   * sobrou de `:FUNDIDA_EM` é fusão real.
   */
  aliases: string[];
  /**
   * O retrato de identidade (009) — o que os dois agentes leem por padrão desde
   * a 4.11. Vazio é estado válido, e é o que toda entidade tem até eu escrever
   * à mão em `/entidades`.
   */
  resumo: string;
  /** "Esta é a ficha oficial desta entidade." Marcada à mão; ausente = false. */
  canonico: boolean;
  /** Os três campos da migration 005. Campo ausente no grafo é string vazia. */
  perfil: Perfil;
}

interface LinhaGrafo
  extends Omit<
    EntidadeDoGrafo,
    "tipo" | "perfil" | "chaves" | "aliases" | "resumo" | "canonico"
  > {
  labels: string[];
  resumo: string | null;
  canonico: boolean | null;
  /** `e.aliases` — as grafias que moram na propriedade (009). */
  aliases_prop: string[];
  /** `alias.nome` dos nós que perderam uma fusão real. */
  aliases: string[];
  chaves_alias: string[];
  contexto: string | null;
  pode_ajudar_com: string | null;
  fizemos_juntos: string | null;
}

const limpo = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Tudo que está no grafo e continua valendo.
 *
 * Nó fundido não aparece como linha própria: ele vira `aliases` do vencedor (o
 * nome, para eu ler) e entra em `chaves` (a grafia normalizada, para o
 * casamento). `status` ausente conta como ativa — os nós criados antes da
 * migration 004 não têm o campo, e a defesa fica na leitura em vez de numa
 * migração de dado que não protegeria o nó que um deploy antigo criasse amanhã.
 * Campo de perfil ausente segue a mesma regra (005), e `aliases` ausente é `[]`
 * pela mesma razão (009).
 *
 * **É aqui que o casamento exato passou a atravessar a propriedade** (4.11).
 * `acharPorChave` não mudou uma linha: ela já varria `chaves` em memória, e a
 * única diferença é de onde `chaves` vem. Nenhuma consulta a mais, nenhum
 * índice a mais — a grafia que era nó, e casava pelo índice único de
 * `nome_normalizado`, agora casa por esta lista.
 *
 * **A ordem põe o canônico na frente** (009). Ela serve `/entidades`, que é onde
 * eu marco a ficha oficial e quero vê-la em cima; e serve o desempate
 * determinístico da resolução, onde dois candidatos empatados são decididos pela
 * ordem em que este catálogo os entrega.
 */
export async function listarEntidades(): Promise<EntidadeDoGrafo[]> {
  const linhas = await query<LinhaGrafo>(
    `MATCH (e:Entidade)
     WHERE coalesce(e.status, 'ativa') <> 'fundida'
     OPTIONAL MATCH (e)<-[:SOBRE|:MENCIONA]-(a:Atomo)
     OPTIONAL MATCH (e)<-[:SOBRE|:MENCIONA]-(:Atomo)<-[:GEROU]-(s:Sessao)
     OPTIONAL MATCH (alias:Entidade)-[:FUNDIDA_EM]->(e)
     RETURN e.id AS id, e.nome AS nome, e.nome_normalizado AS nome_normalizado,
            labels(e) AS labels,
            count(DISTINCT a) AS atomos,
            count(DISTINCT s) AS sessoes,
            coalesce(e.aliases, []) AS aliases_prop,
            collect(DISTINCT alias.nome) AS aliases,
            collect(DISTINCT alias.nome_normalizado) AS chaves_alias,
            coalesce(e.resumo, '') AS resumo,
            coalesce(e.canonico, false) AS canonico,
            coalesce(e.contexto, '') AS contexto,
            coalesce(e.pode_ajudar_com, '') AS pode_ajudar_com,
            coalesce(e.fizemos_juntos, '') AS fizemos_juntos
     ORDER BY canonico DESC, sessoes DESC, e.nome`,
  );

  return linhas.map((l) => {
    // A união das duas fontes, sem repetir a mesma grafia: a propriedade e os
    // nós de fusão real podem dizer a mesma coisa, e a lista é para eu ler.
    //
    // **A primeira vista vence**, e por isso a propriedade vem antes: é ela que
    // eu edito em `/entidades`, e é a caixa que eu escrevi que tem de aparecer.
    const porGrafia = new Map<string, string>();
    for (const n of [...(l.aliases_prop ?? []), ...(l.aliases ?? [])]) {
      if (typeof n !== "string" || n.trim() === "") continue;
      const k = normalizarNome(n);
      if (k !== "" && !porGrafia.has(k)) porGrafia.set(k, n.trim());
    }
    const aliases = [...porGrafia.values()];

    return {
      id: l.id,
      nome: l.nome,
      nome_normalizado: l.nome_normalizado,
      chaves: [
        ...new Set([
          l.nome_normalizado,
          ...aliases.map(normalizarNome),
          ...(l.chaves_alias ?? []).filter((c) => typeof c === "string" && c !== ""),
        ]),
      ].filter((c) => c !== ""),
      tipo: tipoDosLabels(l.labels ?? []),
      sessoes: l.sessoes ?? 0,
      atomos: l.atomos ?? 0,
      aliases,
      resumo: limpo(l.resumo),
      canonico: l.canonico === true,
      perfil: {
        contexto: limpo(l.contexto),
        pode_ajudar_com: limpo(l.pode_ajudar_com),
        fizemos_juntos: limpo(l.fizemos_juntos),
      },
    };
  });
}

/**
 * Os nomes que vão para o vocabulário do STT, do mais falado para o menos.
 *
 * Ordem por número de sessões: o nome que eu falo toda semana é o que o modelo
 * mais precisa acertar, e o teto de 100 termos obriga a escolher. Desempate
 * pelo nome, para a lista não dançar entre duas chamadas — cache com TTL não
 * ajuda se a mesma consulta devolve ordens diferentes.
 *
 * **Alias não entra, e desde a 4.11 isso é explícito.** Mandar a grafia que eu
 * já rejeitei ensinaria o STT a reproduzi-la. Até a 009 isso saía de graça: a
 * grafia era um nó com `status = 'fundida'`, e o filtro de status a deixava de
 * fora sem que ninguém precisasse decidir nada. Agora ela é item de
 * `e.aliases`, no mesmo nó do nome bom — então a consulta lê **só `e.nome`**, e
 * o array nunca é tocado. O filtro de status fica pelo que ele ainda cobre: o
 * perdedor de uma fusão real, que continua sendo nó.
 */
export async function nomesParaVocabulario(limite: number): Promise<string[]> {
  const linhas = await query<{ nome: string }>(
    `MATCH (e:Entidade)
     WHERE coalesce(e.status, 'ativa') <> 'fundida'
     OPTIONAL MATCH (e)<-[:SOBRE|:MENCIONA]-(:Atomo)<-[:GEROU]-(s:Sessao)
     WITH e, count(DISTINCT s) AS sessoes
     RETURN e.nome AS nome
     ORDER BY sessoes DESC, e.nome
     LIMIT $limite`,
    { limite },
  );
  return linhas.map((l) => l.nome).filter((n) => typeof n === "string" && n.trim() !== "");
}

/** O nó cujo conjunto de grafias contém esta chave. Atravessa alias de graça. */
export function acharPorChave(
  chave: string,
  catalogo: readonly EntidadeDoGrafo[],
): EntidadeDoGrafo | undefined {
  if (chave === "") return undefined;
  return catalogo.find((e) => e.chaves.includes(chave));
}

/**
 * A visão agregada que a revisão mostra: uma linha por entidade, com quantas
 * menções caíram nela.
 *
 * A atribuição de cada menção vive no átomo (`ReferenciaResolvida`); esta lista
 * é onde eu ainda decido se uma entidade **nova** vira nó. Entidade que nenhuma
 * referência aponta não entra — seria nó órfão no grafo.
 *
 * A primeira grafia vista vence como nome de exibição de uma entidade nova;
 * quando ela já existe no grafo, o grafo vence: nome gravado e tipo dos labels.
 * O extrator propor `:Pessoa` para algo que já é `:Projeto` não muda o nó.
 */
export function agregarCandidatas(
  refs: readonly ReferenciaResolvida[],
  catalogo: readonly EntidadeDoGrafo[],
  propostas: readonly EntidadePropostaFrase[] = [],
): EntidadeCandidata[] {
  const tipos = new Map<string, TipoEntidade>();
  for (const p of propostas) {
    const chave = normalizarNome(p.nome ?? "");
    const tipo = normalizarTipoEntidade(p.tipo);
    if (chave !== "" && tipo && !tipos.has(chave)) tipos.set(chave, tipo);
  }

  const porChave = new Map<string, EntidadeCandidata>();

  for (const ref of refs) {
    const chaveCitada = normalizarNome(ref.entidade);
    if (chaveCitada === "") continue;

    const no = acharPorChave(chaveCitada, catalogo);
    const chave = no?.nome_normalizado ?? chaveCitada;

    const existente = porChave.get(chave);
    if (existente) {
      existente.ocorrencias++;
      continue;
    }

    porChave.set(
      chave,
      no
        ? {
            nome: no.nome,
            nome_normalizado: chave,
            tipo: no.tipo,
            conhecida: true,
            id: no.id,
            ocorrencias: 1,
            sessoes: no.sessoes,
            // Entidade que já está no grafo passou por uma revisão minha: se o
            // nome dela é o que é, foi porque eu deixei.
            precisa_nome: false,
          }
        : {
            nome: ref.entidade.trim(),
            nome_normalizado: chave,
            tipo: tipos.get(chave) ?? tipos.get(normalizarNome(ref.citado)) ?? TIPO_PADRAO,
            conhecida: false,
            id: null,
            ocorrencias: 1,
            sessoes: 0,
            precisa_nome: ehPronome(chave),
          },
    );
  }

  return [...porChave.values()];
}

// ──────────────────── Slice 4.5: o vetor da entidade ────────────────────

/** O que sobrou de uma entidade depois de tirar o que não vira vetor. */
interface LinhaFonte {
  id: string;
  nome: string;
  labels: string[];
  /** As duas fontes de grafia, já unidas pela consulta (009). */
  aliases: string[];
  contexto: string | null;
  pode_ajudar_com: string | null;
  fizemos_juntos: string | null;
  embedding_fonte: string | null;
  embedding_modelo: string | null;
}

export interface ResumoEmbeddings {
  /** Quantas entidades ativas foram olhadas. */
  conferidas: number;
  /** Quantas saíram de dia e foram reembutidas. */
  embutidas: number;
  modelo: string;
}

/**
 * Põe em dia o vetor das entidades — e só das que saíram de dia.
 *
 * **A comparação é de hash, e é ela que decide quem reembute.** Editar o perfil
 * em `/entidades`, fundir, renomear, trocar o tipo, semear um nome: seis
 * caminhos mexem em entidade, e nenhum precisa lembrar de invalidar o vetor. A
 * string canônica muda, o hash muda, e a próxima passada por aqui reembute.
 *
 * **Quem faz essa próxima passada acontecer é `passadaDeVetores`**, logo abaixo,
 * chamada em `waitUntil` pelo confirmar e pelas oito rotas de `/entidades`
 * (4.8.1). Até a 4.8 a única chamadora era `POST /api/entidades/embutir`, que
 * nenhuma tela chama: a "próxima passada" descrita aqui não existia, e entidade
 * nascida num confirmar ficava sem vetor **para sempre** — a camada 3a
 * (candidatos por perfil) era código que não podia achar nada.
 *
 * O argumento contra o gancho continua registrado, e é bom: um lugar a mais
 * onde alguém esquece de invalidar. Ele não se aplica aqui porque **o gancho
 * não invalida nada** — quem decide é o hash. Esquecer um call site custa
 * atraso, não vetor velho: a próxima passada de qualquer outro alcança. É
 * exatamente isso que `embedding_fonte` compra.
 *
 * Três razões para reembutir, e as três são a mesma pergunta ("o que está
 * gravado corresponde ao que a entidade é hoje?"):
 *
 *   vetor ausente          entidade que nunca passou por aqui
 *   `embedding_fonte` ≠    perfil, nome, alias ou tipo mudaram
 *   `embedding_modelo` ≠   `EMBEDDING_MODEL` mudou; misturar dois espaços
 *                          vetoriais no mesmo índice não dá erro, dá
 *                          vizinhança errada
 *
 * Não editar nada não reembute nada: rodar duas vezes seguidas devolve
 * `embutidas: 0` na segunda (regra 4).
 *
 * Entidade fundida fica de fora: ela não é candidata a nada, e o vetor dela
 * seria peso morto no índice.
 */
export async function garantirEmbeddings(limite = 500): Promise<ResumoEmbeddings> {
  const modelo = modeloEmbedding();

  const linhas = await query<LinhaFonte>(
    `MATCH (e:Entidade)
     WHERE coalesce(e.status, 'ativa') <> 'fundida'
     OPTIONAL MATCH (alias:Entidade)-[:FUNDIDA_EM]->(e)
     RETURN e.id AS id, e.nome AS nome, labels(e) AS labels,
            coalesce(e.aliases, []) + collect(DISTINCT alias.nome) AS aliases,
            e.contexto AS contexto, e.pode_ajudar_com AS pode_ajudar_com,
            e.fizemos_juntos AS fizemos_juntos,
            e.embedding_fonte AS embedding_fonte,
            e.embedding_modelo AS embedding_modelo
     ORDER BY e.nome
     LIMIT $limite`,
    { limite },
  );

  const foraDeDia = linhas.flatMap((l) => {
    const fonte = fonteDaEntidade({
      nome: l.nome,
      tipo: tipoDosLabels(l.labels ?? []),
      aliases: (l.aliases ?? []).filter((a): a is string => typeof a === "string" && a !== ""),
      perfil: {
        ...PERFIL_VAZIO,
        contexto: limpo(l.contexto),
        pode_ajudar_com: limpo(l.pode_ajudar_com),
        fizemos_juntos: limpo(l.fizemos_juntos),
      },
    });
    const hash = hashDaFonte(fonte);
    const emDia = l.embedding_fonte === hash && l.embedding_modelo === modelo;
    return emDia ? [] : [{ id: l.id, fonte, hash }];
  });

  if (foraDeDia.length === 0) {
    return { conferidas: linhas.length, embutidas: 0, modelo };
  }

  const vetores = await embutirVarios(foraDeDia.map((e) => e.fonte));

  await query(
    `UNWIND $entidades AS v
     MATCH (e:Entidade { id: v.id })
     SET e.embedding = v.embedding,
         e.embedding_modelo = v.modelo,
         e.embedding_fonte = v.fonte`,
    {
      entidades: foraDeDia.map((e, i) => ({
        id: e.id,
        fonte: e.hash,
        embedding: vetores[i].embedding,
        modelo: vetores[i].modelo,
      })),
    },
  );

  return { conferidas: linhas.length, embutidas: foraDeDia.length, modelo };
}

/**
 * Uma passada de `garantirEmbeddings()` **fora do caminho da resposta**.
 *
 * Sempre em `waitUntil`, sempre engolindo a falha: nada no caminho do vetor
 * pode impedir uma gravação, que é a mesma precedência do embedding de átomo
 * (4.10). O sinal de que falhou é a linha `[entidades]` no log — e é mais uma
 * coisa acontecendo depois do clique que eu não vejo (§14).
 *
 * Rodar com nada fora de dia custa **uma consulta e zero chamada de modelo**: a
 * comparação de hash acontece no cliente, e a passada nem chega a escrever.
 * Por isso o gancho pode ser generoso — chamar à toa é barato, esquecer de
 * chamar é a camada 3a calada.
 */
export async function passadaDeVetores(origem: string): Promise<void> {
  try {
    const r = await garantirEmbeddings();
    if (r.embutidas > 0) {
      console.log(`[entidades] ${origem}: ${r.embutidas} entidade(s) reembutida(s)`);
    }
  } catch (e) {
    console.error(`[entidades] ${origem}: não consegui pôr os vetores em dia:`, e);
  }
}

// ─────────────── Slice 4.5: as duas camadas semânticas ───────────────

/** Uma entidade que uma camada semântica indicou, e por quê. */
export interface CandidatoSemantico {
  /** `nome_normalizado` do nó, já atravessando fusão. */
  chave: string;
  camada: "perfil" | "vizinhos";
  /** Cosseno. O melhor da camada para esta entidade. */
  similaridade: number;
  /** Quantos átomos vizinhos votaram nela. Sempre 1 na camada de perfil. */
  votos: number;
  /** Os átomos que a elegeram. Vazio na camada de perfil — lá não há átomo. */
  porque: Evidencia[];
}

/** Quanto do texto do átomo vizinho entra no `porque`. */
const TAMANHO_DO_TRECHO = 180;

/** Quantos átomos aparecem no `porque` de um candidato. Três cabem na tela. */
export const MAX_EVIDENCIAS = 3;

/**
 * O ajuste de espaço de score, num lugar só.
 *
 * `db.index.vector.queryNodes` com cosseno devolve o score **normalizado** para
 * [0,1]: `(1 + cosseno) / 2`. É o que explica o 0,500 da sondagem de 2026-09-02
 * — dois vetores ortogonais. As consultas daqui devolvem o cosseno de volta,
 * porque é nesse espaço que os pisos de `resolucao.ts` vivem: é o que
 * `cosineSimilarity` do pacote `ai` fala, e por isso é o único número que eu
 * consigo conferir à mão fora do banco.
 */
const COSSENO = "2 * score - 1";

/**
 * Camada 3a — **perfil parecido**: o texto do átomo contra o vetor da entidade.
 *
 * Pega a entidade **com perfil e sem átomo**: o Rapha no dia seguinte ao passo
 * zero, que nenhuma camada de string alcança porque a grafia que eu falo não é
 * a que está gravada, e que a 3b não alcança porque ela ainda não tem átomo
 * nenhum para votar nela.
 *
 * A comparação é **assimétrica** — texto corrido de um lado, string canônica
 * curta do outro —, e é por isso que o piso dela se calibra separado do da 3b.
 * O mesmo número não significa a mesma coisa nas duas.
 */
export async function candidatosPorPerfil(
  vetores: readonly (readonly number[])[],
  piso: number,
  k: number,
): Promise<CandidatoSemantico[][]> {
  const saida: CandidatoSemantico[][] = vetores.map(() => []);
  if (vetores.length === 0) return saida;

  const linhas = await query<{ i: number; chave: string; similaridade: number }>(
    `UNWIND $vetores AS v
     CALL db.index.vector.queryNodes('entidade_embedding', $k, v.vetor) YIELD node, score
     WITH v.i AS i, node AS e, ${COSSENO} AS similaridade
     WHERE similaridade >= $piso
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(vencedor:Entidade)
     WITH i, coalesce(vencedor, e) AS alvo, similaridade
     RETURN i, alvo.nome_normalizado AS chave, max(similaridade) AS similaridade
     ORDER BY i, similaridade DESC`,
    { vetores: vetores.map((vetor, i) => ({ i, vetor })), piso, k },
  );

  for (const l of linhas) {
    if (!saida[l.i] || typeof l.chave !== "string" || l.chave === "") continue;
    saida[l.i].push({
      chave: l.chave,
      camada: "perfil",
      similaridade: l.similaridade,
      votos: 1,
      porque: [],
    });
  }
  return saida;
}

/**
 * Camada 3b — **os vizinhos votam**: o texto do átomo contra os outros átomos,
 * e cada vizinho vota na entidade a que ele já pertence (`:SOBRE`/`:MENCIONA`).
 *
 * Pega o buraco **oposto** ao da 3a: a entidade com átomos e **sem** perfil —
 * que é todo o grafo de hoje. As duas cobrem lados contrários, e é por isso que
 * as duas ficam.
 *
 * Devolve os ids, as datas e os trechos dos átomos que elegeram cada candidato.
 * Isso não é enfeite: esta camada herda atribuição passada, e o `porque` é o
 * que a torna corrigível em vez de silenciosa. **Sem ele, esta camada não
 * entra.**
 *
 * O `collect` é `DISTINCT` pelo mesmo motivo que o `count`: se um átomo
 * apontasse para a entidade por `:SOBRE` **e** por `:MENCIONA`, o `MATCH`
 * daria duas linhas e o mesmo átomo apareceria duas vezes na evidência. Hoje o
 * par é impossível — `atomos.ts` e `fusao.ts` descartam a menção redundante —,
 * mas é invariante mantida a distância, e a evidência é o que sustenta a
 * camada inteira.
 *
 * Um detalhe que só aparece ao reextrair uma sessão já confirmada: os átomos
 * dela estão no grafo e votam em si mesmos, com similaridade perto de 1. Não é
 * defeito — a atribuição que eu confirmei é evidência boa —, mas explica por
 * que a mesma sessão reextraída sugere com mais confiança do que sugeriu da
 * primeira vez.
 */
export async function candidatosPorVizinhos(
  vetores: readonly (readonly number[])[],
  piso: number,
  k: number,
): Promise<CandidatoSemantico[][]> {
  const saida: CandidatoSemantico[][] = vetores.map(() => []);
  if (vetores.length === 0) return saida;

  const linhas = await query<{
    i: number;
    chave: string;
    similaridade: number;
    votos: number;
    porque: Evidencia[];
  }>(
    `UNWIND $vetores AS v
     CALL db.index.vector.queryNodes('atomo_embedding', $k, v.vetor) YIELD node, score
     WITH v.i AS i, node AS a, ${COSSENO} AS similaridade
     WHERE similaridade >= $piso AND coalesce(a.status, 'ativo') = 'ativo'
     MATCH (a)-[:SOBRE|:MENCIONA]->(e:Entidade)
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(vencedor:Entidade)
     WITH i, coalesce(vencedor, e) AS alvo, a, similaridade
     ORDER BY similaridade DESC
     RETURN i, alvo.nome_normalizado AS chave,
            count(DISTINCT a) AS votos,
            max(similaridade) AS similaridade,
            collect(DISTINCT { atomo_id: a.id,
                      valido_em: coalesce(a.valido_em, ''),
                      texto: left(a.texto, $trecho),
                      similaridade: similaridade })[0..$evidencias] AS porque
     ORDER BY i, votos DESC, similaridade DESC`,
    {
      vetores: vetores.map((vetor, i) => ({ i, vetor })),
      piso,
      k,
      trecho: TAMANHO_DO_TRECHO,
      evidencias: MAX_EVIDENCIAS,
    },
  );

  for (const l of linhas) {
    if (!saida[l.i] || typeof l.chave !== "string" || l.chave === "") continue;
    saida[l.i].push({
      chave: l.chave,
      camada: "vizinhos",
      similaridade: l.similaridade,
      votos: l.votos ?? 0,
      porque: Array.isArray(l.porque) ? l.porque : [],
    });
  }
  return saida;
}

/** Os pisos de cada camada semântica, em cosseno. Quem calibra é `resolucao.ts`. */
export interface PisosSemanticos {
  perfil: number;
  vizinhos: number;
}

/** Quantos nós cada índice devolve **antes** do piso cortar. */
export interface AlcanceSemantico {
  perfis: number;
  vizinhos: number;
}

/**
 * Os candidatos semânticos de cada átomo de uma sessão: embutir o texto, e
 * perguntar aos dois índices quem se parece com ele.
 *
 * Mora aqui, e não em `resolucao.ts`, para manter a divisão que a slice 4.5
 * escolheu: `embedding.ts` é a porta do Gateway e não sabe o que é um nó;
 * `resolucao.ts` decide o que fazer com candidato e não fala com o Gateway nem
 * escreve Cypher; e este módulo, que já é o grafo de entidades como as outras
 * camadas o enxergam, é quem junta as duas pontas.
 *
 * **Falhar aqui não derruba nada.** Índice que ainda não existe, Gateway fora
 * do ar, átomo sem texto: em qualquer desses casos a sessão volta com as duas
 * camadas de string, que é exatamente o comportamento da slice 4. O vetor é
 * aditivo por construção — ele só acrescenta candidato, nunca é condição para
 * haver algum. É também o que permite este código ir ao ar antes da migration
 * 006 rodar.
 */
export async function candidatosSemanticos(
  textos: readonly string[],
  pisos: PisosSemanticos,
  alcance: AlcanceSemantico,
): Promise<CandidatoSemantico[][]> {
  const vazio = textos.map(() => [] as CandidatoSemantico[]);
  if (textos.length === 0) return vazio;

  try {
    const vetores = (await embutirVarios(textos)).map((v) => v.embedding);
    const [perfil, vizinhos] = await Promise.all([
      candidatosPorPerfil(vetores, pisos.perfil, alcance.perfis),
      candidatosPorVizinhos(vetores, pisos.vizinhos, alcance.vizinhos),
    ]);
    return textos.map((_, i) => [...(perfil[i] ?? []), ...(vizinhos[i] ?? [])]);
  } catch (e) {
    console.error(
      "[entidades] camada semântica indisponível nesta sessão; " +
        "a resolução segue só com as camadas de string. Causa:",
      e instanceof Error ? e.message : e,
    );
    return vazio;
  }
}
