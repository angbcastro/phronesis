/**
 * O que faltou, a pedido (slice 11).
 *
 * Quando o extrator deixa algo de fora, a revisão fechada ganha um "+": eu
 * escrevo em poucas palavras o que faltou, e o mesmo extrator relê a sessão
 * inteira com o foco apontado (`blocoDoPedido`, em `extracao.ts`). O átomo que
 * volta passa pelo processo de sempre — extração, identidade, âncora no áudio —
 * e entra no fim da lista, sem tocar no que eu já revisei.
 *
 * **Este módulo não fala com modelo nenhum**, como `janela.ts`: a chamada
 * continua morando em `extracao.ts`, e é o que deixa `tests/agentes.test.ts`
 * dizer que todo `generateText` pertence a um agente do registro. Aqui é o
 * resto: onde o pedido mora (`pedidos.json`), quem tem direito de fazê-lo, como
 * o que ele produziu ganha id, e como a leitura junta pedido e proposta.
 *
 * **Por que um objeto próprio** (§9): `extracao.json` é escrito uma vez, com
 * `If-None-Match`, e essa escrita única é a trava de idempotência da extração —
 * além de ser o que o extrator propôs sozinho, que é contra o que a calibração
 * compara. O pedido é um terceiro dono, que chega depois e pode chegar duas
 * vezes ao mesmo tempo, e por isso é escrito por etag (`atualizarJson`).
 *
 * Nada aqui toca o grafo: o átomo pedido só vira `:Atomo` no confirmar, como
 * qualquer outro (regra 5).
 */
import { chaveExtracao, chavePedidos, chaveTranscricao } from "./chaves";
import { agregarCandidatas, listarEntidades } from "./entidades";
import type { EntidadeDoGrafo } from "./entidades";
import { atualizarJson } from "./etag";
import { extrairJanela } from "./extracao";
import type { ResultadoDaJanela } from "./extracao";
import { medir, registrarFalha } from "./medidas";
import { getJson, putJson } from "./r2";
import { candidatasDaJanela, dossieDaJanela, entidadesJaAtribuidas } from "./recuperacao";
import type { Dossie } from "./recuperacao";
import { mencoesDe, sobreDe } from "./referencias";
import { hashDeTexto } from "./regras";
import { normalizarNome } from "./texto";
import type {
  AtomoProposto,
  EntidadeCandidata,
  EstadoPedido,
  Extracao,
  Gestos,
  Pedidos,
  Transcricao,
} from "./tipos";

/**
 * Quanto vale a reivindicação de um pedido.
 *
 * **O `maxDuration` da rota, e não o `LEASE_MS` da janela.** O pedido é uma
 * chamada só sobre a sessão inteira, e ela pode legitimamente levar o prazo da
 * função quase todo; um lease de 120 s liberaria o mesmo pedido para uma
 * segunda chamada enquanto a primeira ainda está trabalhando. Depois de 300 s
 * a função que o reivindicou está morta, e aí refazer é o certo.
 */
export const LEASE_PEDIDO_MS = 300_000;

// ---------- puro ----------

export function pedidosVazio(sessao_id: string): Pedidos {
  return {
    sessao_id,
    pedidos: [],
    atomos: [],
    entidades: [],
    descartados: [],
    atualizado_em: new Date(0).toISOString(),
  };
}

/**
 * A chave da idempotência: o hash do texto normalizado. "A conversa com a
 * Marina" e "a conversa com a marina." são o mesmo pedido; outra redação é
 * outro pedido — é como se pede de novo (§14).
 */
export const idDoPedido = (texto: string): string => hashDeTexto(normalizarNome(texto));

export const estadoDoPedido = (p: Pedidos, id: string): EstadoPedido | undefined =>
  p.pedidos.find((x) => x.id === id);

function comEstado(p: Pedidos, estado: EstadoPedido): Pedidos {
  const outros = p.pedidos.filter((x) => x.id !== estado.id);
  return { ...p, pedidos: [...outros, estado], atualizado_em: estado.em };
}

/**
 * Marca o pedido como meu, se ele estiver livre. A mesma pergunta de
 * `janela.reivindicar`: pronto não se refaz, em curso com lease fresco não se
 * refaz, e o resto — falhou, lease vencido, nunca pedido — se reivindica.
 *
 * Escrito como "o lease ainda está fresco?" pelo mesmo motivo de lá: com um
 * `em` corrompido a conta dá `NaN`, e o erro cai para o lado de refazer.
 */
export function reivindicarPedido(
  p: Pedidos,
  id: string,
  texto: string,
  agora: Date,
): Pedidos | null {
  const atual = estadoDoPedido(p, id);
  if (atual?.estado === "pronto") return null;
  if (atual?.estado === "em_curso" && agora.getTime() - Date.parse(atual.em) < LEASE_PEDIDO_MS) {
    return null;
  }
  return comEstado(p, { id, texto, estado: "em_curso", em: agora.toISOString(), indices: [] });
}

/**
 * Candidatas unidas pela chave, somando `ocorrencias`. A primeira lista vence
 * os outros campos — na leitura, é a da proposta.
 */
export function unirEntidades(
  primeiras: readonly EntidadeCandidata[],
  depois: readonly EntidadeCandidata[],
): EntidadeCandidata[] {
  const porChave = new Map<string, EntidadeCandidata>();
  for (const e of [...primeiras, ...depois]) {
    const ja = porChave.get(e.nome_normalizado);
    porChave.set(
      e.nome_normalizado,
      ja ? { ...ja, ocorrencias: ja.ocorrencias + e.ocorrencias } : { ...e },
    );
  }
  return [...porChave.values()];
}

/**
 * Soma o que o pedido produziu ao que já estava pedido.
 *
 * **Os ids são carimbados aqui, e não na extração** — o precedente é
 * `aplicarJanela`. O `n` de `<sessao_id>-<n>` sai de `base` (os átomos da
 * proposta, que não muda depois de escrita) mais os pedidos **deste instante**:
 * o mutador é reaplicado a cada conflito de etag, então dois pedidos
 * concorrentes não nascem com o mesmo id, e o `MERGE` do confirmar continua
 * idempotente (regra 4).
 *
 * `null` quando o pedido já não está em curso: outro worker o terminou (o lease
 * venceu e os dois correram), ou um `forcar` zerou `pedidos.json` no meio — a
 * proposta foi renumerada, e o átomo pedido colidiria com ela.
 */
export function aplicarPedido(
  p: Pedidos,
  id: string,
  r: ResultadoDaJanela,
  entidades: readonly EntidadeCandidata[],
  base: number,
  agora: Date,
): Pedidos | null {
  const atual = estadoDoPedido(p, id);
  if (atual?.estado !== "em_curso") return null;

  const inicio = base + p.atomos.length;
  const novos: AtomoProposto[] = r.novos.map((a, k) => ({
    ...a,
    id: `${p.sessao_id}-${inicio + k}`,
    indice: inicio + k,
    pedido: { id, texto: atual.texto },
  }));

  return comEstado(
    {
      ...p,
      atomos: [...p.atomos, ...novos],
      entidades: unirEntidades(p.entidades, entidades),
      descartados: [...p.descartados, ...r.descartados],
    },
    {
      id,
      texto: atual.texto,
      estado: "pronto",
      em: agora.toISOString(),
      indices: novos.map((a) => a.indice),
      prompt_version: r.prompt_version,
      modelo: r.modelo,
      prompt_version_resolucao: r.prompt_version_resolucao,
      modelo_resolucao: r.modelo_resolucao,
      candidatas: r.candidatas,
    },
  );
}

/** O pedido falhou. Fica registrado com o motivo, e o próximo igual o refaz. */
export function marcarFalhaPedido(
  p: Pedidos,
  id: string,
  motivo: string,
  agora: Date,
): Pedidos | null {
  const atual = estadoDoPedido(p, id);
  if (!atual) return null;
  return comEstado(p, { ...atual, estado: "falhou", em: agora.toISOString(), motivo });
}

/**
 * A proposta como a revisão a lê: a do extrator e, depois, os átomos pedidos.
 *
 * - **Átomos:** os da proposta, e depois os pedidos na ordem dos índices.
 * - **Candidatas:** unidas por chave, somando `ocorrencias`. As do pedido já
 *   foram agregadas na hora do pedido, com o catálogo que a chamada leu — é o
 *   que deixa esta junção pura, sem ir ao Neo4j.
 * - **Cabeçalho** (`prompt_version`, `modelo`, `truncada`, `criado_em`): o da
 *   proposta. Cada átomo já carrega a própria procedência (regra 7).
 *
 * Sem pedido, devolve **o mesmo objeto**: a revisão de quem nunca tocou no "+"
 * não muda um byte.
 */
export function juntarPedidos(extracao: Extracao, pedidos: Pedidos | null | undefined): Extracao {
  if (!pedidos || pedidos.atomos.length === 0) return extracao;
  return {
    ...extracao,
    atomos: [...extracao.atomos, ...[...pedidos.atomos].sort((a, b) => a.indice - b.indice)],
    entidades: unirEntidades(extracao.entidades, pedidos.entidades),
    descartados: [...extracao.descartados, ...pedidos.descartados],
  };
}

/**
 * Os gestos da revisão, restritos ao que o extrator propôs sozinho.
 *
 * A apuração julga a proposta **sem** os pedidos (§4.11), mas recusa e renome
 * de entidade chegam pelos gestos sem passar por ela: recusar uma candidata que
 * só um pedido trouxe viraria `entidade_recusada` do extrator, que nunca a
 * propôs sozinho. O que o pedido ensina chega pelo `faltou`, e os `faltantes`
 * passam inteiros.
 */
export function gestosDoExtrator(gestos: Gestos | null, extracao: Extracao): Gestos | null {
  if (!gestos) return null;
  const indices = new Set(extracao.atomos.map((a) => a.indice));
  const chaves = new Set(
    extracao.entidades.flatMap((e) => [e.nome_normalizado, normalizarNome(e.nome)]),
  );
  return {
    atomos: gestos.atomos.filter((a) => indices.has(a.indice)),
    entidades_recusadas: gestos.entidades_recusadas.filter((c) => chaves.has(normalizarNome(c))),
    renomes: gestos.renomes.filter((r) => chaves.has(normalizarNome(r.de))),
    faltantes: gestos.faltantes,
  };
}

/** Os átomos que um pedido produziu, para a resposta da rota. */
export const atomosDoPedido = (p: Pedidos, id: string): AtomoProposto[] =>
  p.atomos.filter((a) => a.pedido?.id === id);

// ---------- com R2 ----------

export async function carregarPedidos(sessao_id: string): Promise<Pedidos | null> {
  const o = await getJson<Pedidos>(chavePedidos(sessao_id));
  return o?.valor ?? null;
}

/** Aplica `mutador` a `pedidos.json` pelo laço de `etag.ts`; o mutador é puro. */
export async function atualizarPedidos(
  sessao_id: string,
  mutador: (p: Pedidos) => Pedidos | null,
): Promise<{ pedidos: Pedidos; mudou: boolean }> {
  const { valor, mudou } = await atualizarJson<Pedidos>(
    chavePedidos(sessao_id),
    (cru) => cru ?? pedidosVazio(sessao_id),
    mutador,
    { rotulo: `os pedidos de ${sessao_id}` },
  );
  return { pedidos: valor, mudou };
}

/**
 * Zera os pedidos — só o `forcar` da re-extração passa por aqui, junto com o
 * parcial. A proposta nova renumera tudo: re-extrair é recomeçar (§14).
 */
export const zerarPedidos = (sessao_id: string): Promise<unknown> =>
  putJson(chavePedidos(sessao_id), pedidosVazio(sessao_id));

/** A sessão ainda não tem `extracao.json`: a proposta está crescendo. */
export class SemPropostaFechadaError extends Error {
  constructor(sessao_id: string) {
    super(`a proposta da sessão ${sessao_id} ainda não fechou`);
    this.name = "SemPropostaFechadaError";
  }
}

export type ResultadoDoPedido =
  | { situacao: "pronto"; pedido: { id: string; texto: string; atomos: AtomoProposto[] } }
  /** Outro pedido igual está rodando agora, com lease fresco. */
  | { situacao: "em_curso" };

/**
 * Um pedido, de ponta a ponta: reivindica, lê a sessão inteira, chama o
 * extrator com o foco apontado, e **grava antes de responder**.
 *
 * Gravar antes é o que faz a resposta perdida não custar o átomo: com a tela
 * bloqueada no meio da espera, reabrir a revisão o traz, porque a leitura já
 * junta os pedidos.
 *
 * `ate` é o prazo da função, repassado à espera de rate limit (`limite.ts`).
 */
export async function pedir(
  sessao_id: string,
  texto: string,
  { ate }: { ate?: number } = {},
): Promise<ResultadoDoPedido> {
  const limpo = texto.trim();
  const id = idDoPedido(limpo);

  const extracao = await getJson<Extracao>(chaveExtracao(sessao_id));
  if (!extracao) throw new SemPropostaFechadaError(sessao_id);

  const { pedidos: reivindicado, mudou } = await atualizarPedidos(sessao_id, (p) =>
    reivindicarPedido(p, id, limpo, new Date()),
  );

  if (!mudou) {
    // O mesmo pedido de novo: pronto devolve o que já foi gravado, sem modelo.
    const estado = estadoDoPedido(reivindicado, id);
    if (estado?.estado === "pronto") {
      return {
        situacao: "pronto",
        pedido: { id, texto: estado.texto, atomos: atomosDoPedido(reivindicado, id) },
      };
    }
    return { situacao: "em_curso" };
  }

  try {
    const proposta = juntarPedidos(extracao.valor, reivindicado);
    const { resultado, entidades } = await procurar(sessao_id, limpo, proposta, ate);

    const { pedidos: gravado } = await atualizarPedidos(sessao_id, (p) =>
      aplicarPedido(p, id, resultado, entidades, extracao.valor.atomos.length, new Date()),
    );
    const estado = estadoDoPedido(gravado, id);
    if (estado?.estado !== "pronto") {
      throw new Error("a sessão foi re-extraída no meio do pedido — peça de novo");
    }

    console.log(
      `[pedido] sessão ${sessao_id} pedido ${id}: +${estado.indices.length} átomo(s), ` +
        `dossiê de ${resultado.candidatas.length} entidade(s)`,
    );
    return {
      situacao: "pronto",
      pedido: { id, texto: estado.texto, atomos: atomosDoPedido(gravado, id) },
    };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    registrarFalha("pedido", e);
    console.error(`[pedido] sessão ${sessao_id} pedido ${id} falhou:`, e);
    // A marca da falha é o que deixa o mesmo pedido ser refeito na hora, em vez
    // de esperar o lease vencer. Se nem ela gravar, o lease ainda cobre.
    await atualizarPedidos(sessao_id, (p) => marcarFalhaPedido(p, id, motivo, new Date())).catch(
      () => {},
    );
    throw e;
  }
}

/**
 * A chamada sobre a sessão inteira: a transcrição toda, o dossiê da sessão
 * toda, e o extrator com o pedido.
 *
 * `jaPropostos` vai inteiro, mas só a resolução o lê — é o prior de quem eu já
 * citei nesta sessão. O prompt do extrator não o vê (`blocoDoPedido`).
 */
async function procurar(
  sessao_id: string,
  texto: string,
  proposta: Extracao,
  ate: number | undefined,
): Promise<{ resultado: ResultadoDaJanela; entidades: EntidadeCandidata[] }> {
  const transcricao = await getJson<Transcricao>(chaveTranscricao(sessao_id));
  if (!transcricao) throw new Error("a transcrição desta sessão não está no R2");

  const catalogo = await medir("catalogo", () => listarEntidades());
  const dossie = await dossieDaSessao(sessao_id, transcricao.valor, proposta.atomos, catalogo);

  const resultado = await extrairJanela(transcricao.valor, {
    pedido: texto,
    jaPropostos: proposta.atomos,
    unica: true,
    ate,
    dossie,
    catalogo,
  });

  // Agregadas **agora**, com o catálogo que esta chamada já leu: é o que deixa
  // `juntarPedidos` pura na leitura.
  const entidades = agregarCandidatas(
    resultado.novos.flatMap((a) => [sobreDe(a), ...mencoesDe(a)]),
    catalogo,
    resultado.entidades,
  );
  return { resultado, entidades };
}

/**
 * O dossiê da sessão inteira: as candidatas de todos os blocos, unidas ao que a
 * sessão já atribuiu. Mesma precedência de `montarDossie`, em `pipeline.ts`:
 * tropeço na busca vira dossiê vazio, e o extrator se comporta como sem ele.
 */
async function dossieDaSessao(
  sessao_id: string,
  transcricao: Transcricao,
  jaPropostos: readonly AtomoProposto[],
  catalogo: EntidadeDoGrafo[],
): Promise<Dossie> {
  try {
    return dossieDaJanela({
      blocos: await medir("candidatas", () =>
        candidatasDaJanela(
          sessao_id,
          transcricao.blocos.map((b) => b.i),
          { catalogo },
        ),
      ),
      jaAtribuidas: entidadesJaAtribuidas(jaPropostos),
      catalogo,
    });
  } catch (e) {
    console.error(`[candidatas] sessão ${sessao_id} pedido: sem dossiê:`, e);
    return [];
  }
}
