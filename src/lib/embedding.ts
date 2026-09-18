/**
 * A porta do vetor (slice 4.5).
 *
 * É a primeira vez que este sistema compara duas coisas sem passar por letra.
 * Até aqui toda semelhança era grafia — `nome_normalizado` na slice 3,
 * `proximidade()` na 4 — e grafia não alcança dois átomos que dizem a mesma
 * coisa com palavras diferentes, nem uma pessoa cujo nome eu ainda não escrevi
 * do jeito que o grafo escreveu.
 *
 * **Este módulo não fala com o Neo4j.** Ele transforma texto em vetor e monta a
 * string canônica de uma entidade; quem guarda, indexa e consulta é
 * `atomos.ts`, `entidades.ts` e as rotas. É a mesma separação que já existe
 * entre `duplicatas.ts` (string pura, testável sem rede) e quem a usa — e é o
 * que deixa a montagem da fonte e o hash testáveis sem banco e sem Gateway.
 *
 * Sai pelo Gateway como todo o resto (regra 8): `embed`/`embedMany` do `ai`,
 * com id de modelo em **string** (`modelos.ts`). Zero dependência nova, zero
 * chave nova.
 *
 * **Nada aqui pode impedir uma gravação de acontecer.** O vetor é derivável do
 * texto a qualquer momento; um átomo sem vetor é um átomo que a rota de
 * retrofill alcança depois. Quem chama trata a falha como aviso, nunca como
 * motivo para derrubar um confirmar.
 *
 * **E nada aqui pode ficar pendurado** (18/09). As duas chamadas vão com o
 * `TETO_CHAMADA_MS` de `limite.ts`, pelo mesmo motivo que as quatro do caminho
 * automático: sem prazo próprio o único teto é o `headersTimeout` de 300 s do
 * undici, que é o `maxDuration` da rota — e uma chamada assim mata a função
 * antes de qualquer `catch`. Aqui não entra a escada de repetição do
 * `comEsperaDeLimite`: quem chama já engole a falha (`candidatosSemanticos`), e
 * o que faltava era o teto, não o retry.
 */
import { createHash } from "node:crypto";
import { embed, embedMany } from "ai";
import { TETO_CHAMADA_MS } from "./limite";
import { medirAgente } from "./medidas";
import { DIMENSAO_EMBEDDING, garantirGateway, modeloEmbedding } from "./modelos";
import { CAMPOS_PERFIL } from "./tipos";
import type { Perfil, TipoEntidade } from "./tipos";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Quantos textos vão numa chamada de `embedMany`.
 *
 * O SDK já quebra o pedido sozinho pelo teto do provedor; o lote daqui é sobre
 * outra coisa — o retrofill roda em cima de milhares de átomos, e um pedido
 * único de 4.000 textos é um `maxDuration` estourado sem nada gravado. Com
 * lote, cada volta já pode ser gravada, e uma falha no meio perde um lote.
 */
export const TAMANHO_DO_LOTE = 96;

/** Um vetor e o modelo que o produziu — os dois viajam juntos, sempre. */
export interface Vetor {
  embedding: number[];
  /** Vai gravado no nó: vetor de dois modelos no mesmo índice não dá erro,
   *  dá vizinhança errada, e sem o campo não há como saber quem refazer. */
  modelo: string;
}

/**
 * Vetor de um texto só. Usado quando há um só — a resolução e o retrofill usam
 * `embutirVarios`, que é uma chamada para o lote inteiro.
 */
export async function embutir(texto: string): Promise<Vetor> {
  garantirGateway();
  const modelo = modeloEmbedding();
  try {
    // String de propósito: id em string sai pelo Gateway (regra 8).
    const r = await medirAgente("embedding", () =>
      embed({ model: modelo, value: texto, abortSignal: AbortSignal.timeout(TETO_CHAMADA_MS) }),
    );
    return { embedding: conferirDimensao(r.embedding), modelo };
  } catch (e) {
    throw new EmbeddingError(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Vetores de uma lista, em lotes.
 *
 * A ordem da saída acompanha a da entrada — é assim que quem chama sabe de que
 * átomo é cada vetor sem carregar um id junto.
 */
export async function embutirVarios(textos: readonly string[]): Promise<Vetor[]> {
  if (textos.length === 0) return [];
  garantirGateway();
  const modelo = modeloEmbedding();

  const saida: Vetor[] = [];
  for (let i = 0; i < textos.length; i += TAMANHO_DO_LOTE) {
    const lote = textos.slice(i, i + TAMANHO_DO_LOTE);
    try {
      const r = await medirAgente("embedding", () =>
        embedMany({
          model: modelo,
          values: [...lote],
          abortSignal: AbortSignal.timeout(TETO_CHAMADA_MS),
        }),
      );
      for (const embedding of r.embeddings) {
        saida.push({ embedding: conferirDimensao(embedding), modelo });
      }
    } catch (e) {
      throw new EmbeddingError(
        `lote ${i}..${i + lote.length - 1}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return saida;
}

/**
 * Dimensão errada é o modo de falha silencioso desta slice: o índice recusa o
 * vetor com uma mensagem do banco, longe daqui, no meio de um confirmar. Trocar
 * `EMBEDDING_MODEL` por um modelo de outra dimensão tem que estourar na porta,
 * dizendo o que fazer — `DROP` e recriar os dois índices, por migration nova.
 */
function conferirDimensao(v: number[]): number[] {
  if (v.length !== DIMENSAO_EMBEDDING) {
    throw new EmbeddingError(
      `o modelo devolveu ${v.length} dimensões e os índices declaram ${DIMENSAO_EMBEDDING}. ` +
        `Trocar de modelo para outra dimensão pede DROP e recriar atomo_embedding e ` +
        `entidade_embedding, por migration nova.`,
    );
  }
  return v;
}

// ───────────────────── a string canônica da entidade ─────────────────────

/**
 * O que de uma entidade vira vetor. Estrutural de propósito: este módulo não
 * conhece `EntidadeDoGrafo` nem o Neo4j.
 */
export interface FonteDeEntidade {
  nome: string;
  tipo: TipoEntidade;
  aliases: readonly string[];
  perfil: Perfil;
}

const ROTULO: Record<string, string> = {
  contexto: "contexto",
  pode_ajudar_com: "pode ajudar com",
  fizemos_juntos: "fizemos juntos",
};

/**
 * `nome`, `tipo`, `aliases` e os três campos de perfil, numa string só.
 *
 * **Campo vazio é omitido**, e não presente e em branco: string vazia no meio
 * do texto é ruído com posição — o modelo vê um rótulo seguido de nada e não
 * tem como saber que aquilo não quer dizer nada.
 *
 * **O nó inteiro não entra.** `id`, `nome_normalizado` e `chaves` são
 * duplicação ou ruído. E `sessoes`/`atomos` são contagens que mudam a cada
 * confirmar sem que o significado da entidade mude — entrariam no hash e
 * forçariam reembutir o grafo inteiro toda sessão, de graça.
 *
 * **Os átomos da entidade ficam de fora, e isso é decisão.** Com átomos aqui,
 * um átomo atribuído errado viraria evidência para a próxima atribuição —
 * dissolvido num vetor que ninguém audita e do qual não dá para tirá-lo depois.
 * É a mesma realimentação que a slice 4 fechou ao decidir que o agente 3 nunca
 * escreve; a diferença entre aquela e a da camada 3b é **visibilidade**, e é ela
 * que decide o que entra.
 *
 * Os aliases vão ordenados porque o `collect(DISTINCT …)` do Cypher não promete
 * ordem, e ordem instável aqui é hash instável — a entidade sairia de dia toda
 * vez que ninguém a editou.
 */
export function fonteDaEntidade(e: FonteDeEntidade): string {
  const linhas = [e.nome.trim(), `tipo: ${e.tipo.toLowerCase()}`];

  const aliases = [...e.aliases]
    .map((a) => a.trim())
    .filter((a) => a !== "")
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (aliases.length > 0) linhas.push(`também escrito: ${aliases.join(", ")}`);

  for (const campo of CAMPOS_PERFIL) {
    const texto = (e.perfil[campo] ?? "").trim();
    if (texto !== "") linhas.push(`${ROTULO[campo]}: ${texto}`);
  }

  return linhas.join("\n");
}

/**
 * O hash da string canônica, que vai gravado em `embedding_fonte`.
 *
 * É o que torna o refresh idempotente **e** dispensa gancho nas cinco rotas que
 * mexem em entidade: hash bate, está em dia; não bate, reembute. Sem ele, cada
 * rota nova de entidade seria mais um lugar onde alguém esquece de invalidar o
 * vetor — e vetor velho não dá erro, dá vizinhança errada.
 *
 * Não é criptografia, é detecção de mudança: 16 hex de SHA-256 são 64 bits,
 * folgadíssimos para um grafo de milhares de nós, e cabem na tela de um log.
 */
export function hashDaFonte(fonte: string): string {
  return createHash("sha256").update(fonte, "utf8").digest("hex").slice(0, 16);
}
