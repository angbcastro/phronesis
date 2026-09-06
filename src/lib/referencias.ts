/**
 * A ponte entre os dois formatos de proposta.
 *
 * `AtomoProposto.sobre` era o nome cru que o extrator escreveu; desde a slice 4
 * é uma `ReferenciaResolvida`, porque a atribuição passou a ser **por menção** e
 * um nome só não tem como dizer que dois "Rafa" da mesma sessão são pessoas
 * diferentes.
 *
 * As propostas que já estavam esperando no R2 continuam no formato antigo, e
 * re-extrair todas para poder abrir a tela seria pagar uma chamada de modelo por
 * uma mudança de forma. Então este módulo lê os dois: string vira referência com
 * `certo: true` — o que o extrator disse era tudo o que havia, e destacá-la como
 * duvidosa seria inventar uma dúvida que ninguém teve.
 *
 * Módulo puro e do lado do cliente também: a revisão precisa da mesma leitura
 * que o confirmar. Duas implementações divergiriam, e a da tela venceria calada.
 */
import { normalizarNome } from "./texto";
import { CAMADAS_DE_CANDIDATO } from "./tipos";
import type { AtomoProposto, Camada, ReferenciaResolvida } from "./tipos";

/** Camada que a proposta afirma, quando é uma das que existem. */
const camadaDe = (v: unknown): Camada | undefined =>
  typeof v === "string" && (CAMADAS_DE_CANDIDATO as readonly string[]).includes(v)
    ? (v as Camada)
    : undefined;

/**
 * Uma referência a partir do que estiver gravado.
 *
 * `conhecida` do formato antigo sai do casamento de nome contra as entidades da
 * própria proposta — é a informação que existia lá, e é a mesma que a revisão
 * mostrava antes desta slice.
 */
export function comoReferencia(
  valor: ReferenciaResolvida | string | null | undefined,
  conhecidas: ReadonlySet<string> = new Set(),
): ReferenciaResolvida {
  if (valor && typeof valor === "object") {
    return {
      citado: String(valor.citado ?? valor.entidade ?? ""),
      entidade: String(valor.entidade ?? valor.citado ?? ""),
      conhecida: valor.conhecida === true,
      // Ausente conta como certo: o campo nasceu na slice 4, e a falta dele é
      // proposta antiga, não dúvida.
      certo: valor.certo !== false,
      alternativas: Array.isArray(valor.alternativas)
        ? valor.alternativas.filter((a): a is string => typeof a === "string")
        : [],
      motivo: typeof valor.motivo === "string" ? valor.motivo : "",
      // Nasceu na slice 4.5; proposta anterior não tem, e ausente é lista
      // vazia — a revisão simplesmente não mostra o "porque" naquela sessão.
      porque: Array.isArray(valor.porque) ? valor.porque : [],
      // Nasceu na 4.8.1, e some quando não é uma das camadas conhecidas: a tela
      // deixa de dizer de onde veio a sugestão, e não inventa uma origem.
      camada: camadaDe(valor.camada),
    };
  }

  const nome = typeof valor === "string" ? valor : "";
  return {
    citado: nome,
    entidade: nome,
    conhecida: conhecidas.has(normalizarNome(nome)),
    certo: true,
    alternativas: [],
    motivo: "",
    porque: [],
  };
}

/** O sujeito do átomo, nos dois formatos. */
export const sobreDe = (a: AtomoProposto, conhecidas?: ReadonlySet<string>): ReferenciaResolvida =>
  comoReferencia(a.sobre, conhecidas);

/** As menções do átomo, nos dois formatos. Lista ausente é lista vazia. */
export function mencoesDe(
  a: AtomoProposto,
  conhecidas?: ReadonlySet<string>,
): ReferenciaResolvida[] {
  const lista = (a.menciona ?? []) as (ReferenciaResolvida | string)[];
  return lista.map((m) => comoReferencia(m, conhecidas));
}
