/**
 * O grafo de entidades como as outras camadas o enxergam: quem existe, com que
 * nome, que tipo e que perfil — e como as menções de uma sessão se agregam numa
 * lista para a revisão.
 *
 * **Nada é escrito aqui.** Este módulo só lê: `:Entidade` nasce no confirmar
 * (`atomos.ts`) ou quando eu semeio um nome à mão (`fusao.ts`). Antes da
 * confirmação na revisão o grafo não recebe nada (regra 5).
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
import { query } from "./neo4j";
import { ehPronome, normalizarNome } from "./texto";
import { TIPOS_ENTIDADE } from "./tipos";
import type {
  EntidadeCandidata,
  EntidadePropostaFrase,
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
   * Todas as grafias que resolvem para este nó: a própria e as já fundidas
   * nele. É por esta lista que o casamento exato atravessa alias sem uma
   * segunda consulta.
   */
  chaves: string[];
  tipo: TipoEntidade;
  sessoes: number;
  atomos: number;
  /** Grafias que já foram fundidas nesta — o histórico do nome. */
  aliases: string[];
  /** Os três campos da migration 005. Campo ausente no grafo é string vazia. */
  perfil: Perfil;
}

interface LinhaGrafo extends Omit<EntidadeDoGrafo, "tipo" | "perfil" | "chaves"> {
  labels: string[];
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
 * Campo de perfil ausente segue a mesma regra (005).
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
            collect(DISTINCT alias.nome) AS aliases,
            collect(DISTINCT alias.nome_normalizado) AS chaves_alias,
            coalesce(e.contexto, '') AS contexto,
            coalesce(e.pode_ajudar_com, '') AS pode_ajudar_com,
            coalesce(e.fizemos_juntos, '') AS fizemos_juntos
     ORDER BY sessoes DESC, e.nome`,
  );

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    nome_normalizado: l.nome_normalizado,
    chaves: [
      l.nome_normalizado,
      ...(l.chaves_alias ?? []).filter((c) => typeof c === "string" && c !== ""),
    ],
    tipo: tipoDosLabels(l.labels ?? []),
    sessoes: l.sessoes ?? 0,
    atomos: l.atomos ?? 0,
    aliases: (l.aliases ?? []).filter((n) => typeof n === "string"),
    perfil: {
      contexto: limpo(l.contexto),
      pode_ajudar_com: limpo(l.pode_ajudar_com),
      fizemos_juntos: limpo(l.fizemos_juntos),
    },
  }));
}

/**
 * Os nomes que vão para o vocabulário do STT, do mais falado para o menos.
 *
 * Ordem por número de sessões: o nome que eu falo toda semana é o que o modelo
 * mais precisa acertar, e o teto de 100 termos obriga a escolher. Desempate
 * pelo nome, para a lista não dançar entre duas chamadas — cache com TTL não
 * ajuda se a mesma consulta devolve ordens diferentes.
 *
 * Alias não entra: mandar a grafia que eu já rejeitei ensinaria o STT a
 * reproduzi-la.
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
