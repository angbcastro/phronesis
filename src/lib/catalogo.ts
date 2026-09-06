/**
 * O catálogo de entidades no navegador: buscar, e resolver o que eu digitei.
 *
 * A revisão precisa de duas coisas que o `<datalist>` não dava: achar por
 * **trecho** ("nan" acha "Fernanda"), e atravessar **alias** — a grafia que já
 * foi fundida em outra continua sendo o nome que eu lembro, e digitá-la tem de
 * cair no vencedor da fusão em vez de renascer como nó novo.
 *
 * A regra de resolução é a mesma de `acharPorChave` (`entidades.ts`), que não dá
 * para reusar aqui porque aquele módulo fala com o Neo4j e este roda no
 * navegador. O que impede as duas de divergirem é a fonte: as duas casam sobre
 * `chaves`, que a rota já devolve pronta, e as duas normalizam por
 * `normalizarNome` — a mesma função que produz o `nome_normalizado` gravado no
 * banco. Normalização própria aqui criaria nó duplicado, que é exatamente o que
 * `texto.ts` existe para impedir.
 *
 * Módulo puro e do lado do cliente: não fala com rede, banco nem modelo.
 */
import { normalizarNome } from "./texto";
import type { TipoEntidade } from "./tipos";

/**
 * Uma entidade como `GET /api/entidades` a devolve — o subconjunto que a busca
 * usa. É o que `listarEntidades()` monta **sem o `perfil`**: a revisão não o lê,
 * e ele é o campo mais pesado da resposta.
 *
 * Isto foi comentário mentindo até a 4.8.1: a rota devolvia `listarEntidades()`
 * inteiro, com os três campos, e a revisão baixava o perfil do grafo todo a cada
 * abertura. Quem quer os campos agora pede `?perfil=1`, que é o que `/entidades`
 * faz.
 */
export interface EntidadeDoCatalogo {
  nome: string;
  nome_normalizado: string;
  /** A grafia própria e as já fundidas nela. É por aqui que o alias resolve. */
  chaves: string[];
  tipo: TipoEntidade;
  sessoes: number;
  /** Grafias já fundidas nesta — o histórico do nome, para eu ler. */
  aliases: string[];
}

export interface Catalogo {
  lista: EntidadeDoCatalogo[];
  /** Toda chave — própria e de alias — apontando para o nó que vale hoje. */
  porChave: Map<string, EntidadeDoCatalogo>;
}

export const CATALOGO_VAZIO: Catalogo = { lista: [], porChave: new Map() };

/**
 * Indexa cada chave, não só o `nome_normalizado`.
 *
 * Duas entidades não podem compartilhar chave — a constraint de unicidade do
 * banco garante isso —, então a primeira a chegar vence e a colisão não tem
 * como acontecer com dado vindo do grafo.
 */
export function montarCatalogo(entidades: EntidadeDoCatalogo[]): Catalogo {
  const porChave = new Map<string, EntidadeDoCatalogo>();
  for (const e of entidades) {
    for (const chave of [e.nome_normalizado, ...(e.chaves ?? [])]) {
      if (chave && !porChave.has(chave)) porChave.set(chave, e);
    }
  }
  return { lista: entidades, porChave };
}

/**
 * O casamento exato: é ele que decide entre reusar um nó e criar outro.
 *
 * "Se eu não escolher nenhuma da lista, cria uma nova — a não ser que case
 * exato com alguma do grafo." Casar exato inclui casar por alias, por acento e
 * por caixa: "jose", "José" e uma grafia já fundida chegam todas no mesmo nó.
 */
export function resolver(c: Catalogo, nome: string): EntidadeDoCatalogo | null {
  const chave = normalizarNome(nome);
  return chave === "" ? null : (c.porChave.get(chave) ?? null);
}

/**
 * Busca por trecho sobre o nome **e** sobre os apelidos.
 *
 * Termo vazio devolve o catálogo inteiro: apagar a barra é como eu peço para
 * ver tudo. Quem começa com o termo vem antes de quem só o contém no meio —
 * digitar "ra" tem de mostrar "Rafa" antes de "Fernanda". Empate desempata por
 * sessões, que é a ordem em que a rota já devolve.
 */
export function buscar(
  c: Catalogo,
  termo: string,
  filtro: TipoEntidade | "todas" = "todas",
): EntidadeDoCatalogo[] {
  const alvo = normalizarNome(termo);
  const doTipo = c.lista.filter((e) => filtro === "todas" || e.tipo === filtro);
  if (alvo === "") return [...doTipo].sort(porRelevancia(alvo));

  return doTipo.filter((e) => chavesDe(e).some((k) => k.includes(alvo))).sort(porRelevancia(alvo));
}

/**
 * Por qual apelido esta entidade entrou no resultado.
 *
 * Sem isto, digitar "Rapha" traz uma linha escrita "Raffael" e nada explica o
 * porquê — a linha parece um erro da busca em vez de um alias funcionando.
 */
export function apelidoQueCasa(e: EntidadeDoCatalogo, termo: string): string | null {
  const alvo = normalizarNome(termo);
  if (alvo === "" || e.nome_normalizado.includes(alvo)) return null;
  return (e.aliases ?? []).find((a) => normalizarNome(a).includes(alvo)) ?? null;
}

const chavesDe = (e: EntidadeDoCatalogo): string[] => [
  e.nome_normalizado,
  ...(e.chaves ?? []),
  ...(e.aliases ?? []).map(normalizarNome),
];

const porRelevancia =
  (alvo: string) =>
  (a: EntidadeDoCatalogo, b: EntidadeDoCatalogo): number => {
    const prefixo = Number(comeca(b, alvo)) - Number(comeca(a, alvo));
    if (prefixo !== 0) return prefixo;
    if (b.sessoes !== a.sessoes) return b.sessoes - a.sessoes;
    return a.nome.localeCompare(b.nome);
  };

const comeca = (e: EntidadeDoCatalogo, alvo: string): boolean =>
  alvo !== "" && chavesDe(e).some((k) => k.startsWith(alvo));
