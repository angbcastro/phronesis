/**
 * O agente `chat` — a pergunta em texto livre que consulta o grafo (slice 6).
 *
 * **O que ele faz:** lê a minha pergunta, decide sozinho quais buscas fazer,
 * encadeia até `TETO_FERRAMENTAS` chamadas, e só então escreve a resposta.
 *
 * **Por que é agente e não pipeline.** A entrevista desenhou primeiro um passo
 * fixo — extrair filtros da pergunta, depois uma busca determinística — e o
 * recusou contra exemplo real: "como eu estava depois que terminei com a
 * Isinha" exige *achar a data do término numa busca* para só então filtrar por
 * ela na seguinte. Nenhum pipeline de passo fixo cobre isso sem virar, na
 * prática, um agente disfarçado; então ele é um agente declarado.
 *
 * **Três ferramentas, compostas.** Quatro ferramentas de dimensão única
 * (semântica, entidade, período, confronto) foram desenhadas e recusadas: uma
 * pergunta composta — "o que eu fiz, aprendi e conquistei em agosto" — exigiria
 * encadear e cruzar à mão o que um parâmetro de lista resolve numa chamada só.
 * A terceira (slice 9) não reverte isso: é outro substantivo — a ficha da
 * entidade —, com índice e contagens próprios.
 *
 *   buscar_atomos        texto (vetor), entidade, tipo[], desde, ate — todos
 *                        opcionais, todos combináveis
 *   historico_do_atomo   a cadeia de ATUALIZA/CONTRADIZ/CONFIRMA/COMPLEMENTA
 *                        em volta de um átomo, nas duas direções
 *   buscar_entidades     nome, texto (vetor de perfil), tipo — a ficha, as
 *                        contagens e quem co-ocorre
 *
 * **Só leitura, e nem por ferramenta** (regra 5 do CLAUDE.md). Uma ferramenta
 * de escrita com confirmação — arquivar um átomo direto do chat — foi
 * considerada e recusada: espalhar o lugar onde escrita acontece para mais uma
 * tela não tinha pedido real por trás.
 *
 * **O rastro é o produto, junto com a resposta.** Cada chamada, com os
 * parâmetros usados e o que voltou, vira `PassoDeFerramenta` e fica guardada na
 * mensagem — é o que o botão (i) abre. Uma lista plana dos átomos citados (o
 * padrão que a revisão já usa) foi recusada: com até oito chamadas, saber *por
 * que* um átomo apareceu importa mais do que saber que ele apareceu.
 *
 * **Ele não sabe que conversa existe.** Persistência, título e R2 são de
 * `conversas.ts`; aqui entra uma lista de mensagens e sai um texto com rastro.
 * É a mesma separação de `decidirLote`/`gravarRelacoes` no confronto, e é o que
 * deixa o loop testável sem R2 nenhum.
 */
import { generateText, jsonSchema, tool } from "ai";
import { embutir } from "./embedding";
import { acharPorChave, listarEntidades, type EntidadeDoGrafo } from "./entidades";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloChat,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { query } from "./neo4j";
import { carimbo, efetivo } from "./overrides";
import { PISO_PERFIL } from "./resolucao";
import { normalizarNome } from "./texto";
import {
  ROTULO_TIPO_ENTIDADE,
  TIPOS_ATOMO,
  TIPOS_ENTIDADE,
  ehTipoRelacaoConfronto,
  type AtomoAchado,
  type BuscaDeAtomos,
  type BuscaDeEntidades,
  type CoOcorrencia,
  type EntidadeAchada,
  type TipoEntidade,
  type EloDoHistorico,
  type Mensagem,
  type PassoDeFerramenta,
  type RecorteDaBusca,
  type TipoAtomo,
} from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_CHAT = "chat-5";

export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

// ──────────────────────── os tetos ────────────────────────

/**
 * Quantas chamadas de ferramenta o agente pode encadear antes da síntese.
 *
 * **Oito, por medida da pergunta real.** Quatro foi recusado na entrevista: o
 * caso Isinha gasta duas chamadas só para achar a data do término, e sobraria
 * orçamento demais de menos para o resto da pergunta. Dezesseis foi recusado
 * pelo lado oposto — o pior caso de latência cresce sem nenhum exemplo real
 * pedindo, e cada chamada é uma ida ao Gateway que eu pago.
 */
export const TETO_FERRAMENTAS = 8;

/**
 * Quantos átomos uma busca devolve.
 *
 * **Oito, e eram doze.** Doze cabiam no prompt e na tela do (i) — a conta que
 * sobrou de fora é a outra: doze vezes o teto de oito chamadas são quase cem
 * trechos num contexto só, e a primeira pergunta vaga de verdade ("quais são
 * minhas prioridades") devolveu exatamente isso, uma resposta que listava o
 * diário inteiro. Oito cabem numa resposta que se lê sem rolar, e o orçamento de
 * chamadas encadeadas continua o mesmo.
 */
export const TETO_ATOMOS = 8;

/**
 * Quantos vizinhos o índice vetorial traz antes dos filtros cortarem.
 *
 * Folgado em relação ao `TETO_ATOMOS` de propósito: `tipo`, `entidade` e
 * período entram **depois** do `queryNodes`, e um `k` justo faria uma busca com
 * filtro voltar vazia não por falta de átomo, mas por falta de candidato.
 */
export const K_BUSCA = 48;

/**
 * O piso de similaridade da busca por texto.
 *
 * **Era 0,30, e 0,30 não cortava nada.** O argumento original era que numa
 * leitura o átomo errado custa só uma linha que o modelo descarta — e a
 * primeira pergunta vaga de verdade mostrou que não: linha errada não é
 * descartada, ela **enterra** o acerto no meio de uma resposta longa, e com um
 * ranking quase plano os primeiros colocados viram sorteio.
 *
 * Quase plano por medida, e a medida já estava no repositório: `confronto.ts`
 * registra que neste diário o par de átomos **menos** parecido de uma varredura
 * inteira dava 0,728, e que o piso de 0,45 "nunca cortou nada". Os átomos daqui
 * vivem alto no espaço de cosseno; contra uma pergunta abstrata, 0,30 aprova o
 * corpus.
 *
 * 0,45 alinha com `PISO_CONFRONTO` e `PISO_VIZINHOS` — um número a menos para
 * calibrar. Quem diz que ainda está frouxo é a `similaridade` que o (i) já
 * mostra em cada achado.
 */
export const PISO_BUSCA = 0.45;

/**
 * Quantos degraus `historico_do_atomo` anda a partir do átomo dado.
 *
 * Não é 1 porque uma opinião pode ter mudado em mais de um passo — a cadeia
 * inteira é o que a pergunta "como eu mudei de ideia sobre X" quer. Não é
 * ilimitado porque `COMPLEMENTA` liga assunto vizinho, e sem teto uma cadeia
 * longa arrastaria meio grafo para dentro de uma resposta.
 *
 * Vai **literal** na consulta: Neo4j não aceita limite de caminho de tamanho
 * variável vindo de parâmetro. Mesmo motivo do tipo de relação em
 * `gravarRelacoes` (confronto.ts), e mesma defesa — o número sai daqui, nunca
 * do modelo.
 */
export const PROFUNDIDADE_HISTORICO = 4;

/** Quanto do texto de um átomo vai para o rastro do (i). */
export const TRECHO_NO_RASTRO = 400;

const MAX_TOKENS_SAIDA = 4000;
const FATOR_DE_FOLGA = 2;

// ──────────────────────── o que o modelo lê ────────────────────────

export const INSTRUCOES = `Você responde perguntas sobre um diário pessoal falado. Quem pergunta é o dono do diário, falando de si mesmo: "eu" é sempre ele.

O diário não está no seu contexto. Ele está num grafo, e você o alcança por três ferramentas:

buscar_atomos — procura trechos registrados. Todos os parâmetros são opcionais e se combinam:
  texto      busca por sentido, não por palavra exata. Escreva a ideia, não a pergunta.
  entidade   o nome de uma pessoa, projeto, objetivo ou organização.
  tipo       um ou mais de: FATO, OPINIAO, SENTIMENTO, APRENDIZADO, CONQUISTA, DECISAO, HISTORIA, ROTINA.
  desde/ate  datas AAAA-MM-DD.
historico_do_atomo — dado o id de um trecho, devolve a cadeia de trechos ligados a ele no tempo: o que o atualizou, o que o contradisse, o que o confirmou, o que o complementou. É o que responde "como isso mudou".
buscar_entidades — procura a ficha de pessoas, projetos, objetivos e organizações. Todos os parâmetros são opcionais:
  nome       nome ou apelido; sem casamento exato, devolve as de nome parecido.
  texto      busca por sentido na ficha: "quem entende de contabilidade".
  tipo       Pessoa, Projeto, Objetivo ou Organizacao.
  Sem nome nem texto, lista as mais faladas daquele tipo — é o que responde "quais são meus projetos".
  A ficha diz quem é, com o que pode ajudar, o que já fizemos juntos, quantos trechos há, de quando a quando, e com quem mais ela aparece nos mesmos trechos.

COMO BUSCAR
Busque antes de responder. Você não sabe nada sobre esta pessoa que não tenha vindo de uma busca.
Pergunta sobre quem alguém é, com quem eu faço o quê, ou quem pode ajudar com algo começa pela ficha, não pelos trechos: ela já diz por escrito o que você levaria várias buscas para reconstruir. A ficha é resumo; data e evidência estão nos trechos — busque-os com buscar_atomos e o nome da entidade quando a pergunta pedir. Ficha vazia não quer dizer que não há nada: quer dizer que ninguém escreveu, e os trechos continuam lá.
A maioria das perguntas se resolve em uma ou duas buscas. Mais que três é sinal de que você está varrendo em vez de procurar.
Buscas que não dependem uma da outra vão juntas, no mesmo passo. "O que eu aprendi e o que eu conquistei em agosto" são duas buscas independentes: peça as duas de uma vez. Só espere o resultado quando a busca seguinte precisar dele.
Encadeie quando a pergunta pedir. "Como eu estava depois que terminei com a Isinha" são duas buscas em sequência: primeiro achar quando foi o término, depois buscar o período seguinte. Uma data que você não tem, você procura — não estima.
Pergunta vaga se estreita, não se varre. "Minhas prioridades", "como eu estou", "no que eu ando mexendo" são perguntas sobre agora: ponha um desde nas últimas semanas e escolha os tipos que cabem, em vez de varrer o diário inteiro. Diga na resposta qual recorte você usou, para eu poder pedir outro.
A primeira linha de cada busca diz quanto ela achou e quanto mostrou: "mostrando 8 de 34". Quando disser o recorte na resposta, use esse número — ele vem da busca, nunca de estimativa. Com texto, a conta é entre os trechos mais parecidos, não no diário inteiro; não diga "de todo o diário" nesse caso.
Alargar é só para o vazio, e a primeira linha diz que vazio é. "Nada passou do piso": o sentido não bateu — tente outra palavra; alargar período ou tipo não muda nada. "O filtro cortou": havia trecho parecido fora do recorte — aí sim, alargue o período ou tire o tipo. "Nenhum trecho com esses filtros": não há registro, e é isso que você diz. Se a busca voltou pouco, pouco é a resposta: alargar aí só traz assunto de outro lugar.
Pare quando tiver o suficiente. Buscar mais do que precisa é lento e enche a resposta de material que não responde nada.

COMO RESPONDER
Responda a pergunta nas duas primeiras frases, antes de qualquer evidência. Sem preâmbulo, sem repetir a pergunta, sem dizer o que você procurou ou vai fazer. Se a resposta é "três vezes, todas em agosto", comece por isso.
Curto. Quatro ou cinco frases resolvem quase tudo. Se você passou de um parágrafo, ou está listando, foi porque despejou em vez de responder.
Prosa, não lista. Sem marcadores, sem títulos, sem tabela — só se eu pedir com essas palavras.
Escolha um trecho, no máximo dois. A procedência inteira de cada resposta fica guardada e eu a abro quando quero: cada busca que você fez e tudo que ela trouxe. A resposta não é o lugar de repetir isso. É o lugar de responder.
A data entra na frase, não num bloco de citações: "no fim de julho você escreveu que estava aliviado" — e não uma lista de trechos com a data na frente.
Sobrou coisa boa de fora? Diga em uma frase o que ficou, com o número que a busca deu, e ofereça continuar. "Tem mais três registros sobre isso em setembro, se você quiser." Uma oferta, não um despejo.
Você é um bibliotecário atento, não um coach. Devolve o que está registrado; não dá conselho que ninguém pediu, não anima, não interpreta sentimento além do que o texto diz.
Português, segunda pessoa ("você"), do jeito que eu falo: direto, sem formalidade.
Não invente. Nada que não tenha vindo de uma busca entra na resposta. Se o que você achou não responde a pergunta, diga isso em uma frase — é uma resposta melhor que uma inventada.
Se os trechos se contradizem, é isso que a resposta é: diga que mudou, quando, e para o quê. Não escolha um lado e não esconda o outro.`;

/**
 * O sistema que de fato vai ao modelo: o prompt (editável em `/agentes`) mais a
 * data de hoje.
 *
 * A data fica **fora** do texto editável de propósito. Ela é a única coisa aqui
 * que muda todo dia, e um prompt salvo com "hoje é 13/09" congelaria uma
 * mentira no objeto imutável do `prompt_hash` — e "esse mês", "semana passada",
 * "depois da viagem" passariam a ser resolvidos contra o dia em que eu editei o
 * prompt.
 */
export function montarSistema(base: string = INSTRUCOES, agora: Date = new Date()): string {
  return `${base}

Hoje é ${agora.toISOString().slice(0, 10)}.`;
}

// ──────────────────────── ferramenta 1: buscar_atomos ────────────────────────

/**
 * O trecho de Cypher que pendura as entidades de um átomo, **sem o `"eu"`**.
 *
 * Decalcado de `confronto.ts`, e pela mesma razão: `"eu"` é `SOBRE` em quase
 * todo átomo de um diário, e repeti-lo em toda linha é token gasto para dizer
 * o que o prompt já diz na primeira frase.
 */
const ENTIDADES_DE = (no: string) => `
     OPTIONAL MATCH (${no})-[:SOBRE]->(s:Entidade) WHERE toLower(coalesce(s.nome, '')) <> 'eu'
     OPTIONAL MATCH (${no})-[:MENCIONA]->(m:Entidade) WHERE toLower(coalesce(m.nome, '')) <> 'eu'`;

interface LinhaDeAtomo {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  sobre: string[];
  cita: string[];
  similaridade?: number;
}

const daLinha = (l: LinhaDeAtomo): AtomoAchado => ({
  id: l.id,
  texto: l.texto ?? "",
  tipo: l.tipo,
  valido_em: l.valido_em ?? "",
  sobre: l.sobre ?? [],
  cita: l.cita ?? [],
  ...(typeof l.similaridade === "number" ? { similaridade: l.similaridade } : {}),
});

/** `2026-09-13T10:00:00.000Z` e `13/09/2026` viram ambos `2026-09-13`, ou "". */
export function dataSimples(v: unknown): string {
  if (typeof v !== "string") return "";
  const iso = v.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

/** Só os tipos que existem. Tipo inventado pelo modelo é ignorado, não erra. */
export function tiposValidos(v: unknown): TipoAtomo[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const bons = lista.filter((t): t is TipoAtomo =>
    (TIPOS_ATOMO as readonly string[]).includes(t as string),
  );
  return [...new Set(bons)];
}

export interface ResultadoDeBusca {
  achados: AtomoAchado[];
  /** Preenchido quando pedi uma entidade que o grafo não conhece. */
  aviso?: string;
  /**
   * Quanto a busca achou e quanto mostrou (slice 9). Opcional: a busca que
   * nem chegou ao banco — entidade desconhecida — não tem o que contar.
   */
  recorte?: RecorteDaBusca;
}

/**
 * O que uma pergunta lê do grafo **uma vez só** (slice 9, decisão 4).
 *
 * Cada `buscar_atomos` com `entidade` chamava `listarEntidades()` — o Cypher de
 * quatro `OPTIONAL MATCH` —, e cada busca com `texto` chamava `embutir()`. Com
 * o teto de oito chamadas, eram até oito de cada por pergunta.
 *
 * Um fecho por chamada de `responder()`, no molde de `catalogoUmaVez()`
 * (pipeline.ts). Ele nasce **fora** do laço de `comEsperaDeLimite`, ao
 * contrário de `rastro` e `vistos`: o grafo não muda no meio de uma pergunta,
 * porque o chat não escreve.
 *
 * **O vetor é memoizado por texto**, e o ganho está menos na latência que na
 * exposição: `embutir` não tem escada de repetição, e um 429 no modelo de
 * embedding faz a busca falhar macia. Guarda-se a **promessa**, então duas
 * buscas paralelas com o mesmo texto esperam a mesma chamada. Falha não é
 * guardada — a busca seguinte tenta de novo.
 *
 * `umaVezPorInvocacao` foi recusado: nenhuma rota abre `comInvocacao`, e usá-lo
 * pediria abrir esse contexto na rota por um ganho que este fecho já dá.
 */
export interface LeituraDaPergunta {
  catalogo: () => Promise<EntidadeDoGrafo[]>;
  vetor: (texto: string) => Promise<number[]>;
}

export function leituraDaPergunta(): LeituraDaPergunta {
  let catalogo: Promise<EntidadeDoGrafo[]> | null = null;
  const vetores = new Map<string, Promise<number[]>>();
  return {
    catalogo: () =>
      (catalogo ??= listarEntidades().catch((e) => {
        catalogo = null;
        throw e;
      })),
    vetor: (texto) => {
      let v = vetores.get(texto);
      if (!v) {
        v = embutir(texto).then(
          (r) => r.embedding,
          (e) => {
            vetores.delete(texto);
            throw e;
          },
        );
        vetores.set(texto, v);
      }
      return v;
    },
  };
}

/** A linha do grafo, com as contagens que vêm em toda linha (slice 9). */
interface LinhaDeBusca extends Omit<LinhaDeAtomo, "id"> {
  /** `null` na linha única de uma busca vazia — ela existe só pelas contagens. */
  id: string | null;
  total?: number;
  janela?: number;
  acima_do_piso?: number;
  melhor_abaixo?: number | null;
}

/**
 * A ferramenta 1, por dentro.
 *
 * **Dois caminhos, e a diferença é só o `texto`:** sem ele, é um `MATCH`
 * filtrado ordenado do mais recente para o mais antigo; com ele, o índice
 * vetorial entra e os demais filtros se somam como condição, ordenando por
 * similaridade.
 *
 * **Os dois contam** (slice 9), e contam coisas diferentes — ver
 * `RecorteDaBusca`. A contagem vem em toda linha; na busca vazia, uma linha só
 * com `id` nulo carrega os números, pelo `[null]` do `UNWIND`. Sem ele, busca
 * vazia devolveria zero linhas e as três causas de vazio voltariam a ser uma.
 *
 * **As entidades se penduram depois do corte**, e não antes: os dois `OPTIONAL
 * MATCH` rodavam sobre todo átomo que passava no filtro, e o `LIMIT` jogava o
 * trabalho fora no fim. Agora rodam só sobre os mostrados.
 *
 * A entidade resolve pelo **catálogo inteiro** (`listarEntidades`), e não por
 * uma consulta de nome: é o único caminho que atravessa alias e fusão de graça
 * — a mesma lista que `acharPorChave` já varre na extração. "Isinha", "Isa" e
 * o nome completo caem no mesmo nó sem nenhuma consulta a mais.
 */
export async function buscarAtomos(
  p: BuscaDeAtomos,
  leitura: LeituraDaPergunta = leituraDaPergunta(),
  limite: number = TETO_ATOMOS,
): Promise<ResultadoDeBusca> {
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const nome = typeof p.entidade === "string" ? p.entidade.trim() : "";
  const tipos = tiposValidos(p.tipo);
  const desde = dataSimples(p.desde);
  const ate = dataSimples(p.ate);

  let entidadeId: string | null = null;
  if (nome !== "") {
    const catalogo = await leitura.catalogo();
    const achada = acharPorChave(normalizarNome(nome), catalogo);
    if (!achada) {
      // Não é erro: é informação que o modelo precisa para tentar outro nome em
      // vez de concluir que a pessoa nunca apareceu no diário.
      return {
        achados: [],
        aviso: `não existe entidade chamada "${nome}" no grafo. Nomes parecidos: ${vizinhosDeNome(nome, catalogo).join(", ") || "nenhum"}`,
      };
    }
    entidadeId = achada.id;
  }

  const condicoes = ["coalesce(a.status, 'ativo') = 'ativo'"];
  const parametros: Record<string, unknown> = { limite };

  if (entidadeId !== null) {
    // A fusão é atravessada aqui, e não no catálogo: o átomo antigo continua
    // apontando para o nó perdedor, e ele é do mesmo assunto.
    condicoes.push(
      `EXISTS { MATCH (a)-[:SOBRE|:MENCIONA]->(e:Entidade)
                WHERE e.id = $entidadeId OR (e)-[:FUNDIDA_EM]->(:Entidade { id: $entidadeId }) }`,
    );
    parametros.entidadeId = entidadeId;
  }
  if (tipos.length > 0) {
    condicoes.push(`a.tipo IN $tipos`);
    parametros.tipos = tipos;
  }
  if (desde !== "" || ate !== "") {
    // Átomo sem data nunca entra numa pergunta com período: `''` passaria no
    // `<= ate` e apareceria como se fosse de antes do começo do diário.
    condicoes.push(`coalesce(a.valido_em, '') <> ''`);
  }
  if (desde !== "") {
    condicoes.push(`left(a.valido_em, 10) >= $desde`);
    parametros.desde = desde;
  }
  if (ate !== "") {
    condicoes.push(`left(a.valido_em, 10) <= $ate`);
    parametros.ate = ate;
  }

  const filtro = condicoes.join("\n       AND ");
  const filtrado = condicoes.length > 1;

  const linhas =
    texto === ""
      ? await query<LinhaDeBusca>(
          `MATCH (a:Atomo)
     WHERE ${filtro}
     WITH a ORDER BY coalesce(a.valido_em, '') DESC
     WITH collect(a) AS todos
     UNWIND (CASE WHEN size(todos) = 0 THEN [null] ELSE todos[0..$limite] END) AS a
     WITH size(todos) AS total, a${ENTIDADES_DE("a")}
     WITH total, a, collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, sobre, cita, total
     ORDER BY valido_em DESC`,
          parametros,
        )
      : await query<LinhaDeBusca>(
          `CALL db.index.vector.queryNodes('atomo_embedding', $k, $vetor) YIELD node AS a, score
     WITH a, 2 * score - 1 AS similaridade
     WITH a, similaridade, similaridade >= $piso AS acima,
          (similaridade >= $piso
       AND ${filtro}) AS passou
     ORDER BY similaridade DESC
     WITH count(a) AS janela,
          sum(CASE WHEN acima THEN 1 ELSE 0 END) AS acima_do_piso,
          max(CASE WHEN acima THEN null ELSE similaridade END) AS melhor_abaixo,
          collect(CASE WHEN passou THEN { no: a, similaridade: similaridade } END) AS passaram
     UNWIND (CASE WHEN size(passaram) = 0 THEN [null] ELSE passaram[0..$limite] END) AS p
     WITH janela, acima_do_piso, melhor_abaixo, size(passaram) AS total,
          p.no AS a, p.similaridade AS similaridade${ENTIDADES_DE("a")}
     WITH janela, acima_do_piso, melhor_abaixo, total, a, similaridade,
          collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, sobre, cita, similaridade,
            total, janela, acima_do_piso, melhor_abaixo
     ORDER BY similaridade DESC`,
          {
            ...parametros,
            k: K_BUSCA,
            piso: PISO_BUSCA,
            vetor: await leitura.vetor(texto),
          },
        );

  const achados = linhas
    .filter((l): l is LinhaDeBusca & { id: string } => typeof l.id === "string" && l.id !== "")
    .map(daLinha);
  const conta = linhas[0];
  const numero = (v: unknown, padrao: number) => (typeof v === "number" ? v : padrao);

  const recorte: RecorteDaBusca = {
    total: numero(conta?.total, achados.length),
    mostrados: achados.length,
    filtrado,
    ...(texto === ""
      ? {}
      : {
          janela: numero(conta?.janela, achados.length),
          acima_do_piso: numero(conta?.acima_do_piso, achados.length),
          melhor_abaixo: typeof conta?.melhor_abaixo === "number" ? conta.melhor_abaixo : null,
          piso: PISO_BUSCA,
        }),
  };

  return { achados, recorte };
}

/**
 * A primeira linha do que a busca devolve ao modelo: quanto achou, quanto
 * mostrou — e, quando voltou vazia, **qual** vazio (slice 9).
 *
 * As três causas pedem gestos opostos, e é por isso que deixaram de ser uma
 * frase só: nada acima do piso pede outra palavra, e alargar o período é
 * inútil; o filtro que cortou pede alargar o período, e outra palavra é
 * inútil; e nada mesmo é a resposta.
 */
export function linhaDoRecorte(r: RecorteDaBusca): string {
  const vetorial = typeof r.janela === "number";
  const com = r.filtrado ? " com esses filtros" : "";

  if (r.mostrados === 0) {
    if (!vetorial || r.janela === 0) {
      return r.filtrado
        ? "nenhum trecho com esses filtros: o diário não tem nada que passe em todos eles."
        : "nenhum trecho no diário.";
    }
    if ((r.acima_do_piso ?? 0) === 0) {
      const melhor = typeof r.melhor_abaixo === "number" ? r.melhor_abaixo.toFixed(2) : "?";
      return (
        `nada passou do piso de similaridade (${(r.piso ?? PISO_BUSCA).toFixed(2)}): ` +
        `o mais parecido dos ${r.janela} ficou em ${melhor}. ` +
        `Outra palavra pode achar; alargar período ou tipo não muda nada.`
      );
    }
    return (
      `o filtro cortou: ${r.acima_do_piso} passaram do piso, e nenhum deles cabe nos filtros. ` +
      `Alargar período ou tipo pode achar; outra palavra, não.`
    );
  }

  if (vetorial) {
    return (
      `mostrando ${r.mostrados} de ${r.total} que passaram do piso${r.filtrado ? " e dos filtros" : ""}, ` +
      `contados entre os ${r.janela} trechos mais parecidos — não no diário inteiro.`
    );
  }
  return r.total > r.mostrados
    ? `mostrando ${r.mostrados} de ${r.total} trechos${com}, os mais recentes primeiro.`
    : `${r.total} ${r.total === 1 ? "trecho — o único" : "trechos — todos os"}${com}.`;
}

/**
 * Os nomes do catálogo que mais parecem com o que o modelo pediu.
 *
 * Existe só para a mensagem de "não achei": devolver a lista inteira gastaria
 * tokens à toa, e devolver nada faria o modelo concluir que a pessoa não está
 * no diário quando o que ele errou foi a grafia.
 */
function vizinhosDeNome(
  nome: string,
  catalogo: readonly { nome: string; chaves: string[] }[],
  quantos = 5,
): string[] {
  return parecidasPorNome(nome, catalogo, quantos).map((e) => e.nome);
}

/** As entradas do catálogo cujas grafias contêm um pedaço do nome, ou vice-versa. */
function parecidasPorNome<T extends { chaves: string[] }>(
  nome: string,
  catalogo: readonly T[],
  quantos = 5,
): T[] {
  const alvo = normalizarNome(nome);
  const pedacos = alvo.split(" ").filter((t) => t.length >= 3);
  return catalogo
    .filter((e) => e.chaves.some((c) => pedacos.some((t) => c.includes(t) || t.includes(c))))
    .slice(0, quantos);
}

// ──────────────────── ferramenta 3: buscar_entidades ────────────────────

/**
 * Quantas fichas uma busca de entidade devolve inteiras.
 *
 * Cinco, e não oito como os átomos: uma ficha é várias linhas — resumo, três
 * campos de perfil, contagens, quem co-ocorre —, e cinco já é mais texto que
 * oito átomos. Na listagem por tipo, as que sobram vão só pelo nome.
 */
export const TETO_ENTIDADES = 5;

/** Quantas entidades co-ocorrentes cada ficha mostra. */
export const TETO_JUNTO = 5;

/**
 * O piso da busca de entidade por `texto`: o mesmo `PISO_PERFIL` da camada 3a
 * da resolução, e não o `PISO_BUSCA`.
 *
 * É a mesma espécie de comparação — texto corrido contra a string canônica
 * curta de uma entidade (`fonteDaEntidade`), assimétrica, que pontua
 * sistematicamente menos que átomo contra átomo. O `PISO_BUSCA` de 0,45 vive
 * no outro espaço. Nenhum dos dois foi medido contra pergunta de chat; o (i)
 * mostra o melhor cortado, como na busca de átomos.
 */
export const PISO_ENTIDADE = PISO_PERFIL;

export interface ResultadoDeEntidades {
  entidades: EntidadeAchada[];
  /** Nomes que casaram por parecença, não por grafia exata. */
  parecidas?: boolean;
  /** Na listagem, os nomes que ficaram de fora do teto. */
  outras?: string[];
  recorte?: RecorteDaBusca;
  aviso?: string;
}

interface LinhaDeFicha {
  id: string;
  primeira: string | null;
  ultima: string | null;
  junto_com: CoOcorrencia[] | null;
}

/**
 * O que o catálogo não traz: a primeira e a última data, e quem co-ocorre.
 *
 * **Co-ocorrência, e não travessia.** Não há aresta semântica entre duas
 * entidades — `:ENVOLVIDA_EM`, `:CONTRIBUI_PARA` e `:APONTA_PARA` nunca
 * existiram. O que liga uma pessoa a um projeto são os átomos que citam as
 * duas: aqui, os átomos ativos da entidade e quais outras entidades **esses
 * átomos** citam, contadas por átomo.
 *
 * A fusão é atravessada como em `buscar_atomos`: o átomo antigo que ainda
 * aponta para o nó perdedor é da mesma entidade.
 */
async function lerFichas(ids: readonly string[]): Promise<Map<string, LinhaDeFicha>> {
  if (ids.length === 0) return new Map();
  const linhas = await query<LinhaDeFicha>(
    `UNWIND $ids AS id
     MATCH (e:Entidade { id: id })
     OPTIONAL MATCH (f:Entidade)-[:FUNDIDA_EM]->(e)
     WITH id, e, collect(f) + [e] AS nos
     UNWIND nos AS x
     MATCH (a:Atomo)-[:SOBRE|:MENCIONA]->(x)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
     WITH id, e, collect(DISTINCT a) AS atomos
     WITH id, e, atomos,
          [d IN [a IN atomos | left(coalesce(a.valido_em, ''), 10)] WHERE d <> ''] AS datas
     UNWIND atomos AS a
     OPTIONAL MATCH (a)-[:SOBRE|:MENCIONA]->(o:Entidade)
     WHERE o <> e AND NOT (o)-[:FUNDIDA_EM]->(e) AND toLower(coalesce(o.nome, '')) <> 'eu'
     WITH id, datas, o, count(DISTINCT a) AS vezes
     ORDER BY vezes DESC, o.nome
     WITH id, datas,
          collect(CASE WHEN o IS NULL THEN null ELSE { nome: o.nome, vezes: vezes } END) AS junto
     RETURN id,
            reduce(m = '', d IN datas | CASE WHEN m = '' OR d < m THEN d ELSE m END) AS primeira,
            reduce(m = '', d IN datas | CASE WHEN d > m THEN d ELSE m END) AS ultima,
            junto[0..$teto] AS junto_com`,
    { ids: [...ids], teto: TETO_JUNTO },
  );
  return new Map(linhas.map((l) => [l.id, l]));
}

const paraAchada = (
  e: EntidadeDoGrafo,
  ficha: LinhaDeFicha | undefined,
  similaridade?: number,
): EntidadeAchada => ({
  id: e.id,
  nome: e.nome,
  tipo: e.tipo,
  aliases: e.aliases,
  resumo: e.resumo,
  perfil: e.perfil,
  atomos: e.atomos,
  sessoes: e.sessoes,
  primeira: ficha?.primeira ?? "",
  ultima: ficha?.ultima ?? "",
  junto_com: (ficha?.junto_com ?? []).filter(
    (j): j is CoOcorrencia => typeof j?.nome === "string" && typeof j?.vezes === "number",
  ),
  ...(typeof similaridade === "number" ? { similaridade } : {}),
});

/**
 * A ferramenta 3, por dentro (slice 9): a ficha de uma entidade, que até aqui
 * era ilegível para o chat.
 *
 * **Três caminhos, na ordem em que se decidem:**
 *
 * - `nome` — pela grafia exata no catálogo (alias incluído, como em
 *   `buscar_atomos`); sem ela, pelas grafias parecidas, e a resposta diz que
 *   foram parecidas;
 * - `texto` — por sentido, sobre `entidade_embedding` (migration 006): o vetor
 *   é da string canônica — nome, tipo, grafias e os três campos de perfil —, e
 *   por isso "quem pode me ajudar com X" só acha quem tem `pode_ajudar_com`
 *   escrito;
 * - nenhum dos dois — a listagem, as mais faladas primeiro. É o que responde
 *   "quais são meus projetos".
 *
 * `tipo` filtra os três. O catálogo vem de `leitura`, então buscar entidade e
 * depois buscar átomo por ela na mesma pergunta lê o catálogo uma vez só.
 *
 * **Vale o que a ficha tem dentro.** Em 23/09, 2 das 51 entidades tinham
 * resumo. Ficha vazia faz esta ferramenta devolver casca — nome, contagens e
 * quem co-ocorre —, e o conserto disso é rodar o lote de enriquecimento em
 * `/entidades`, não mexer aqui.
 */
export async function buscarEntidades(
  p: BuscaDeEntidades,
  leitura: LeituraDaPergunta = leituraDaPergunta(),
): Promise<ResultadoDeEntidades> {
  const nome = typeof p.nome === "string" ? p.nome.trim() : "";
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const tipo = tipoDeEntidade(p.tipo);
  const doTipo = (e: EntidadeDoGrafo) => tipo === null || e.tipo === tipo;

  const catalogo = await leitura.catalogo();

  if (nome !== "") {
    const exata = acharPorChave(normalizarNome(nome), catalogo);
    if (exata && doTipo(exata)) {
      const fichas = await lerFichas([exata.id]);
      return { entidades: [paraAchada(exata, fichas.get(exata.id))] };
    }
    const parecidas = parecidasPorNome(nome, catalogo.filter(doTipo), TETO_ENTIDADES);
    if (parecidas.length === 0) {
      return {
        entidades: [],
        aviso: `nenhuma entidade${tipo ? ` do tipo ${ROTULO_TIPO_ENTIDADE[tipo]}` : ""} se chama "${nome}", nem nada parecido. Tente outra grafia, ou buscar_atomos com o texto.`,
      };
    }
    const fichas = await lerFichas(parecidas.map((e) => e.id));
    return {
      entidades: parecidas.map((e) => paraAchada(e, fichas.get(e.id))),
      parecidas: true,
    };
  }

  if (texto !== "") {
    const linhas = await query<{ id: string; similaridade: number }>(
      `CALL db.index.vector.queryNodes('entidade_embedding', $k, $vetor) YIELD node, score
       WITH node AS e, 2 * score - 1 AS similaridade
       OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(vencedor:Entidade)
       WITH coalesce(vencedor, e) AS alvo, max(similaridade) AS similaridade
       RETURN alvo.id AS id, similaridade
       ORDER BY similaridade DESC`,
      { k: K_BUSCA, vetor: await leitura.vetor(texto) },
    );
    const porId = new Map(catalogo.map((e) => [e.id, e]));
    const acima = linhas.filter((l) => l.similaridade >= PISO_ENTIDADE);
    const abaixo = linhas.filter((l) => l.similaridade < PISO_ENTIDADE);
    const passaram = acima
      .map((l) => ({ e: porId.get(l.id), similaridade: l.similaridade }))
      .filter((x): x is { e: EntidadeDoGrafo; similaridade: number } => !!x.e && doTipo(x.e));
    const mostradas = passaram.slice(0, TETO_ENTIDADES);
    const fichas = await lerFichas(mostradas.map((x) => x.e.id));
    return {
      entidades: mostradas.map((x) => paraAchada(x.e, fichas.get(x.e.id), x.similaridade)),
      recorte: {
        total: passaram.length,
        mostrados: mostradas.length,
        filtrado: tipo !== null,
        janela: linhas.length,
        acima_do_piso: acima.length,
        melhor_abaixo: abaixo.length > 0 ? abaixo[0].similaridade : null,
        piso: PISO_ENTIDADE,
      },
    };
  }

  // A listagem. "eu" fica de fora: é sujeito de quase todo átomo, e encabeçaria
  // qualquer lista das mais faladas sem dizer nada que o prompt já não diga.
  const lista = catalogo.filter((e) => doTipo(e) && e.nome_normalizado !== "eu");
  const mostradas = lista.slice(0, TETO_ENTIDADES);
  const fichas = await lerFichas(mostradas.map((e) => e.id));
  return {
    entidades: mostradas.map((e) => paraAchada(e, fichas.get(e.id))),
    outras: lista.slice(TETO_ENTIDADES).map((e) => e.nome),
    recorte: { total: lista.length, mostrados: mostradas.length, filtrado: tipo !== null },
  };
}

/** Uma ficha, do jeito que ela entra no prompt de volta ao modelo. */
export function textoDaFicha(e: EntidadeAchada): string {
  const marcas = [
    ROTULO_TIPO_ENTIDADE[e.tipo],
    ...(typeof e.similaridade === "number" ? [`similaridade ${e.similaridade.toFixed(2)}`] : []),
  ];
  const linhas = [`${e.nome} (${marcas.join(", ")})`];
  if (e.aliases.length > 0) linhas.push(`  também escrito: ${e.aliases.join(", ")}`);

  const campos: [string, string][] = [
    ["resumo", e.resumo],
    ["contexto", e.perfil.contexto],
    ["pode ajudar com", e.perfil.pode_ajudar_com],
    ["fizemos juntos", e.perfil.fizemos_juntos],
  ];
  const escritos = campos.filter(([, v]) => v !== "");
  if (escritos.length === 0) {
    // Dito, e não omitido: sem esta linha o modelo leria a ausência como "não
    // há nada a saber", quando o que há é ficha que ninguém escreveu.
    linhas.push("  ficha vazia: nada escrito sobre ela ainda — o que se sabe está nos trechos.");
  } else {
    for (const [rotulo, valor] of escritos) linhas.push(`  ${rotulo}: ${valor}`);
  }

  const periodo =
    e.primeira === ""
      ? ""
      : e.primeira === e.ultima
        ? `, em ${e.primeira}`
        : `, de ${e.primeira} a ${e.ultima}`;
  linhas.push(`  ${e.atomos} trecho(s) em ${e.sessoes} sessão(ões)${periodo}`);
  if (e.junto_com.length > 0) {
    linhas.push(`  aparece junto com: ${e.junto_com.map((j) => `${j.nome} (${j.vezes})`).join(", ")}`);
  }
  return linhas.join("\n");
}

/** O que `buscar_entidades` devolve ao modelo, com o recorte em cima. */
export function respostaDasEntidades(r: ResultadoDeEntidades): string {
  if (r.aviso) return r.aviso;

  const c = r.recorte;
  let topo: string | null = null;
  if (r.parecidas) {
    topo = "nenhuma se chama exatamente assim; estas são as de nome parecido:";
  } else if (c && typeof c.janela === "number") {
    if (c.mostrados === 0) {
      topo =
        (c.acima_do_piso ?? 0) === 0
          ? `nenhuma ficha passou do piso (${(c.piso ?? PISO_ENTIDADE).toFixed(2)}): a mais parecida ficou em ${typeof c.melhor_abaixo === "number" ? c.melhor_abaixo.toFixed(2) : "?"}. A maioria das fichas ainda não tem perfil escrito — procure nos trechos com buscar_atomos.`
          : `${c.acima_do_piso} fichas passaram do piso, e nenhuma é do tipo pedido.`;
    } else {
      topo = `mostrando ${c.mostrados} de ${c.total} fichas que passaram do piso${c.filtrado ? " e do tipo" : ""}.`;
    }
  } else if (c) {
    topo =
      c.total === 0
        ? "nenhuma entidade desse tipo no grafo."
        : c.total > c.mostrados
          ? `mostrando ${c.mostrados} de ${c.total}, as mais faladas primeiro. As outras: ${(r.outras ?? []).join(", ")}.`
          : `${c.total} no grafo, todas abaixo.`;
  }

  const fichas = r.entidades.map(textoDaFicha).join("\n\n");
  return [topo, fichas].filter((s) => s !== null && s !== "").join("\n\n") || "nenhuma entidade encontrada.";
}

/**
 * O tipo que o modelo mandou, se for um dos quatro. "organização", "Organizacao"
 * e "projetos" não casam por igual — o acento e a caixa sim, o plural não:
 * tipo inventado é ignorado, não erra, como em `tiposValidos`.
 */
export function tipoDeEntidade(v: unknown): TipoEntidade | null {
  if (typeof v !== "string") return null;
  const alvo = normalizarNome(v);
  return TIPOS_ENTIDADE.find((t) => normalizarNome(t) === alvo) ?? null;
}

/** A ficha cortada para o rastro: o (i) mostra um retrato, não o perfil inteiro. */
const fichaParaRastro = (e: EntidadeAchada): EntidadeAchada => {
  const corta = (s: string) => (s.length > TRECHO_NO_RASTRO ? `${s.slice(0, TRECHO_NO_RASTRO)}…` : s);
  return {
    ...e,
    resumo: corta(e.resumo),
    perfil: {
      contexto: corta(e.perfil.contexto),
      pode_ajudar_com: corta(e.perfil.pode_ajudar_com),
      fizemos_juntos: corta(e.perfil.fizemos_juntos),
    },
  };
};

/** Os parâmetros de fato usados em `buscar_entidades`, para o (i). */
export function parametrosDeEntidade(p: BuscaDeEntidades): Record<string, unknown> {
  const limpos: Record<string, unknown> = {};
  const nome = typeof p.nome === "string" ? p.nome.trim() : "";
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const tipo = tipoDeEntidade(p.tipo);
  if (nome !== "") limpos.nome = nome;
  if (texto !== "") limpos.texto = texto;
  if (tipo !== null) limpos.tipo = tipo;
  return limpos;
}

// ──────────────────── ferramenta 2: historico_do_atomo ────────────────────

export interface ResultadoDeHistorico {
  achados: AtomoAchado[];
  elos: EloDoHistorico[];
  aviso?: string;
}

/**
 * A ferramenta 2, por dentro: a cadeia de confronto em volta de um átomo.
 *
 * **Nas duas direções**, e é a parte que importa. As relações da migration 011
 * nascem sempre do mais novo para o mais antigo; andar só para frente mostraria
 * o que este átomo mudou, e andar só para trás mostraria o que mudou este
 * átomo. A pergunta "como minha opinião mudou" quer os dois lados do ponto onde
 * eu parei.
 *
 * **Duas consultas, não uma.** A primeira traz os átomos; a segunda, as arestas
 * entre eles. Uma consulta só devolveria objetos de relação, e todo o resto
 * deste sistema conversa com o Neo4j em escalar e mapa — é o que mantém
 * `linhas<T>` (neo4j.ts) simples.
 */
export async function historicoDoAtomo(atomoId: string): Promise<ResultadoDeHistorico> {
  const id = typeof atomoId === "string" ? atomoId.trim() : "";
  if (id === "") return { achados: [], elos: [], aviso: "id de átomo vazio" };

  const salto = `*1..${PROFUNDIDADE_HISTORICO}`;
  const linhas = await query<LinhaDeAtomo>(
    `MATCH (raiz:Atomo { id: $id })
     OPTIONAL MATCH (raiz)-[:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA${salto}]-(o:Atomo)
     WHERE coalesce(o.status, 'ativo') = 'ativo'
     WITH collect(DISTINCT o) + collect(DISTINCT raiz) AS todos
     UNWIND todos AS a
     WITH DISTINCT a${ENTIDADES_DE("a")}
     WITH a, collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, sobre, cita
     ORDER BY valido_em ASC`,
    { id },
  );

  if (linhas.length === 0) {
    return { achados: [], elos: [], aviso: `não existe átomo com id "${id}"` };
  }

  const achados = linhas.map(daLinha);
  if (achados.length === 1) {
    // O átomo existe e não tem vizinho nenhum. É o caso mais comum enquanto a
    // varredura do confronto não passou por ele, e dizer isso é melhor que
    // devolver uma lista de um item que o modelo leria como "não mudou".
    return {
      achados,
      elos: [],
      aviso: "este átomo ainda não tem nenhuma relação de confronto registrada",
    };
  }

  const ids = achados.map((a) => a.id);
  const arestas = await query<EloDoHistorico>(
    `UNWIND $ids AS x
     MATCH (a:Atomo { id: x })-[r:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]->(b:Atomo)
     WHERE b.id IN $ids
     RETURN a.id AS de, b.id AS para, type(r) AS tipo,
            coalesce(r.motivo, '') AS motivo, coalesce(r.confianca, 0) AS confianca`,
    { ids },
  );

  return { achados, elos: arestas.filter((e) => ehTipoRelacaoConfronto(e.tipo)) };
}

// ──────────────────────── o loop ────────────────────────

/** Um átomo, do jeito que ele entra no prompt de volta ao modelo. */
export function linhaDeAtomo(a: AtomoAchado): string {
  const quando = a.valido_em === "" ? "sem data" : a.valido_em.slice(0, 10);
  const quem = [
    ...(a.sobre.length > 0 ? [`sobre: ${a.sobre.join(", ")}`] : []),
    ...(a.cita.length > 0 ? [`cita: ${a.cita.join(", ")}`] : []),
  ];
  return `[id ${a.id} · ${a.tipo} · ${quando}${quem.length > 0 ? ` · ${quem.join(" · ")}` : ""}] ${a.texto}`;
}

/**
 * O que a ferramenta devolve ao modelo, em texto.
 *
 * Texto e não JSON, de propósito: o modelo vai **ler** isto para escrever prosa,
 * e o id precisa estar visível em cada linha para ele poder chamar
 * `historico_do_atomo` em seguida. Um envelope JSON gastaria tokens em chaves
 * que ninguém usa.
 */
/**
 * Uma linha de átomo, ou a lembrança dela — se `vistos` disser que o modelo já
 * a leu neste turno.
 *
 * **Colapsar, e não omitir.** Um átomo que duas buscas alcançam é informação: a
 * segunda busca *de fato* o achou, e sumir com ele faria o modelo ler a segunda
 * como mais pobre do que foi — e buscar de novo, que é justamente o que o teto
 * de oito chamadas não tem para gastar. O que sai é só o texto, que ele já leu
 * inteiro alguns milhares de tokens acima.
 *
 * Sem `vistos` nada colapsa: é o caminho de quem chama a função para conferir
 * uma busca isolada.
 */
function umaVezSo(a: AtomoAchado, vistos?: Set<string>): string {
  if (!vistos) return linhaDeAtomo(a);
  if (vistos.has(a.id)) return `[id ${a.id}] já mostrado acima`;
  vistos.add(a.id);
  return linhaDeAtomo(a);
}

/**
 * A busca como o modelo a lê: a linha do recorte em cima, os átomos embaixo.
 *
 * O recorte vai **antes** de propósito — é o número que o `chat-4` manda usar
 * quando disser que recorte usou, e é a frase que diz de que vazio se trata.
 */
export function respostaDaBusca(r: ResultadoDeBusca, vistos?: Set<string>): string {
  if (r.aviso) return r.aviso;
  const topo = r.recorte ? linhaDoRecorte(r.recorte) : null;
  if (r.achados.length === 0) return topo ?? "nenhum trecho encontrado.";
  const trechos = r.achados.map((a) => umaVezSo(a, vistos)).join("\n");
  return topo ? `${topo}\n${trechos}` : trechos;
}

export function respostaDoHistorico(r: ResultadoDeHistorico, vistos?: Set<string>): string {
  if (r.achados.length === 0) return r.aviso ?? "nenhum trecho encontrado.";
  const trechos = r.achados.map((a) => umaVezSo(a, vistos)).join("\n");
  const elos =
    r.elos.length === 0
      ? (r.aviso ?? "sem relação registrada entre eles.")
      : r.elos
          .map((e) => `${e.de} ${e.tipo} ${e.para}${e.motivo === "" ? "" : ` — ${e.motivo}`}`)
          .join("\n");
  return `${trechos}\n\nRELAÇÕES (o mais novo → o mais antigo):\n${elos}`;
}

/** O átomo cortado para o rastro: o (i) mostra uma linha, não o átomo inteiro. */
const paraRastro = (a: AtomoAchado): AtomoAchado => ({
  ...a,
  texto: a.texto.length > TRECHO_NO_RASTRO ? `${a.texto.slice(0, TRECHO_NO_RASTRO)}…` : a.texto,
});

/** Os parâmetros de fato usados, sem os vazios — é o que o (i) mostra. */
export function parametrosLimpos(p: BuscaDeAtomos): Record<string, unknown> {
  const limpos: Record<string, unknown> = {};
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const entidade = typeof p.entidade === "string" ? p.entidade.trim() : "";
  const tipos = tiposValidos(p.tipo);
  const desde = dataSimples(p.desde);
  const ate = dataSimples(p.ate);
  if (texto !== "") limpos.texto = texto;
  if (entidade !== "") limpos.entidade = entidade;
  if (tipos.length > 0) limpos.tipo = tipos;
  if (desde !== "") limpos.desde = desde;
  if (ate !== "") limpos.ate = ate;
  return limpos;
}

const ESQUEMA_BUSCA = jsonSchema<BuscaDeAtomos>({
  type: "object",
  properties: {
    texto: {
      type: "string",
      description:
        "busca por sentido no texto dos trechos. Escreva a ideia procurada, não a pergunta inteira.",
    },
    entidade: {
      type: "string",
      description:
        "nome de uma pessoa, projeto, objetivo ou organização. Apelido e grafia errada resolvem para o mesmo nó.",
    },
    tipo: {
      type: "array",
      items: { type: "string", enum: [...TIPOS_ATOMO] },
      description: "um ou mais tipos; eles se somam com OU.",
    },
    desde: { type: "string", description: "data AAAA-MM-DD, inclusive." },
    ate: { type: "string", description: "data AAAA-MM-DD, inclusive." },
  },
});

const ESQUEMA_HISTORICO = jsonSchema<{ atomo_id: string }>({
  type: "object",
  properties: {
    atomo_id: {
      type: "string",
      description: "o id de um trecho, como ele aparece em `[id ...]` numa busca anterior.",
    },
  },
  required: ["atomo_id"],
});

const ESQUEMA_ENTIDADES = jsonSchema<BuscaDeEntidades>({
  type: "object",
  properties: {
    nome: {
      type: "string",
      description: "nome, apelido ou grafia errada. Sem casamento exato, devolve as de nome parecido.",
    },
    texto: {
      type: "string",
      description:
        "busca por sentido na ficha — o que a pessoa faz, com o que pode ajudar. Escreva a ideia, não a pergunta.",
    },
    tipo: { type: "string", enum: [...TIPOS_ENTIDADE] },
  },
});

export interface OpcoesResposta {
  /** Chamado assim que uma ferramenta termina — é o progresso na tela. */
  aoPasso?: (passo: PassoDeFerramenta) => void;
  /** O "parar" da tela. Aborta a chamada em curso e nada é gravado. */
  sinal?: AbortSignal;
  agora?: Date;
}

export interface Resposta {
  texto: string;
  rastro: PassoDeFerramenta[];
  modelo: string;
  prompt_version: string;
}

/**
 * As duas ferramentas, prontas para o SDK.
 *
 * **Elas nunca propagam erro.** Ferramenta que estoura derruba o loop inteiro e
 * a pergunta fica sem resposta; ferramenta que devolve "não consegui" deixa o
 * modelo tentar outro caminho — que é o que uma pessoa faria. O erro vai para o
 * rastro do (i) do mesmo jeito, então nada fica escondido.
 *
 * **`vistos` é a memória do turno**, e ela é de quem monta as ferramentas, não
 * de dentro delas: o conjunto atravessa as duas (um átomo que a busca já
 * mostrou não volta inteiro no histórico, e vice-versa) e morre junto com a
 * tentativa. Quem o cria é `responder`, pelo mesmo motivo que zera o rastro.
 */
export function ferramentas(
  aoPasso?: (p: PassoDeFerramenta) => void,
  vistos?: Set<string>,
  leitura: LeituraDaPergunta = leituraDaPergunta(),
) {
  const anunciar = (p: PassoDeFerramenta) => {
    try {
      aoPasso?.(p);
    } catch (e) {
      // O progresso é enfeite: ninguém perde uma resposta porque a tela caiu.
      console.error("[chat] falha ao anunciar o passo:", e);
    }
  };

  return {
    buscar_atomos: tool({
      description:
        "Procura trechos do diário. Todos os parâmetros são opcionais e se combinam; sem nenhum, devolve os mais recentes.",
      inputSchema: ESQUEMA_BUSCA,
      execute: async (entrada: BuscaDeAtomos) => {
        const parametros = parametrosLimpos(entrada ?? {});
        const inicio = Date.now();
        try {
          const r = await buscarAtomos(entrada ?? {}, leitura);
          anunciar({
            ferramenta: "buscar_atomos",
            parametros,
            achados: r.achados.map(paraRastro),
            ...(r.recorte ? { recorte: r.recorte } : {}),
            duracao_ms: Date.now() - inicio,
            ...(r.aviso ? { erro: r.aviso } : {}),
          });
          return respostaDaBusca(r, vistos);
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          console.error("[chat] buscar_atomos falhou:", e);
          anunciar({
            ferramenta: "buscar_atomos",
            parametros,
            achados: [],
            duracao_ms: Date.now() - inicio,
            erro,
          });
          return `a busca falhou: ${erro}`;
        }
      },
    }),

    historico_do_atomo: tool({
      description:
        "Dado o id de um trecho, devolve a cadeia de trechos ligados a ele no tempo — o que o atualizou, contradisse, confirmou ou complementou.",
      inputSchema: ESQUEMA_HISTORICO,
      execute: async ({ atomo_id }: { atomo_id: string }) => {
        const parametros = { atomo_id };
        const inicio = Date.now();
        try {
          const r = await historicoDoAtomo(atomo_id);
          anunciar({
            ferramenta: "historico_do_atomo",
            parametros,
            achados: r.achados.map(paraRastro),
            elos: r.elos,
            duracao_ms: Date.now() - inicio,
            ...(r.aviso ? { erro: r.aviso } : {}),
          });
          return respostaDoHistorico(r, vistos);
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          console.error("[chat] historico_do_atomo falhou:", e);
          anunciar({
            ferramenta: "historico_do_atomo",
            parametros,
            achados: [],
            duracao_ms: Date.now() - inicio,
            erro,
          });
          return `a busca falhou: ${erro}`;
        }
      },
    }),

    buscar_entidades: tool({
      description:
        "Procura a ficha de pessoas, projetos, objetivos e organizações: quem é, o que pode ajudar, o que fizemos juntos, quantos trechos, e com quem mais aparece. Sem parâmetro, lista as mais faladas.",
      inputSchema: ESQUEMA_ENTIDADES,
      execute: async (entrada: BuscaDeEntidades) => {
        const parametros = parametrosDeEntidade(entrada ?? {});
        const inicio = Date.now();
        try {
          const r = await buscarEntidades(entrada ?? {}, leitura);
          anunciar({
            ferramenta: "buscar_entidades",
            parametros,
            achados: [],
            entidades: r.entidades.map(fichaParaRastro),
            ...(r.recorte ? { recorte: r.recorte } : {}),
            duracao_ms: Date.now() - inicio,
            ...(r.aviso ? { erro: r.aviso } : {}),
          });
          return respostaDasEntidades(r);
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          console.error("[chat] buscar_entidades falhou:", e);
          anunciar({
            ferramenta: "buscar_entidades",
            parametros,
            achados: [],
            duracao_ms: Date.now() - inicio,
            erro,
          });
          return `a busca falhou: ${erro}`;
        }
      },
    }),
  };
}

/** Quantas chamadas de ferramenta já saíram. É o que o teto conta. */
export const chamadasFeitas = (
  passos: readonly { toolCalls?: readonly unknown[] }[],
): number => passos.reduce((n, p) => n + (p.toolCalls?.length ?? 0), 0);

/**
 * A conversa como o modelo a recebe.
 *
 * **O rastro das respostas antigas não volta.** Ele fica na mensagem, para o
 * (i), mas não entra no prompt: replicar as chamadas de ferramenta de todos os
 * turnos anteriores encheria o contexto de material que já virou prosa. O que o
 * modelo relê de um turno passado é a resposta que ele escreveu — que é também
 * o que eu li.
 */
export const paraOModelo = (m: Mensagem) =>
  ({ role: m.papel === "eu" ? "user" : "assistant", content: m.texto }) as const;

/**
 * A resposta a uma pergunta, com o rastro do que foi consultado.
 *
 * `historico` termina na pergunta nova. Nada é gravado aqui — quem grava é
 * `conversas.ts`.
 *
 * **A síntese pode custar uma segunda chamada.** Quando o loop para no teto de
 * `TETO_FERRAMENTAS`, ele para *em cima de um resultado de ferramenta*: o
 * modelo ainda não escreveu nada. A segunda chamada vai com o mesmo histórico e
 * `toolChoice: "none"` — ou seja, "agora responda com o que você tem". Sem ela,
 * a pergunta mais composta do sistema seria justamente a que volta vazia.
 */
export async function responder(
  historico: readonly Mensagem[],
  opcoes: OpcoesResposta = {},
): Promise<Resposta> {
  garantirGateway();
  const { aoPasso, sinal, agora = new Date() } = opcoes;

  const meu = await efetivo("chat", { prompt: INSTRUCOES, modelo: modeloChat() });
  const system = montarSistema(meu.prompt, agora);
  const messages = historico.map(paraOModelo);

  // O rastro definitivo sai dos `steps` no fim, e não do `aoPasso`: se
  // `comEsperaDeLimite` repetir a chamada inteira por rate limit, as
  // ferramentas rodam de novo e o `aoPasso` anunciaria os dois conjuntos.
  const rastro: PassoDeFerramenta[] = [];

  // Fora do laço, ao contrário do rastro e dos vistos: o grafo não muda no meio
  // de uma pergunta, e uma tentativa repetida por rate limit reaproveita o que
  // a perdida já leu.
  const leitura = leituraDaPergunta();

  /**
   * As ferramentas de **uma tentativa** — rastro zerado e memória de vistos
   * nova.
   *
   * Montar por tentativa, e não uma vez fora do laço, é pelo mesmo motivo que o
   * `rastro.length = 0` já existia aqui: `comEsperaDeLimite` repete a chamada
   * inteira por rate limit, e um conjunto de vistos sobrevivente colapsaria, na
   * tentativa boa, exatamente o átomo que só a tentativa perdida mostrou — uma
   * resposta que cita "já mostrado acima" sem nada acima.
   */
  const ferramentasDaTentativa = () => {
    rastro.length = 0;
    return ferramentas(
      (p) => {
        rastro.push(p);
        aoPasso?.(p);
      },
      new Set<string>(),
      leitura,
    );
  };

  const comum = {
    model: meu.modelo, // string de propósito: id em string sai pelo Gateway (regra 8)
    system,
    temperature: 0,
    maxRetries: 0,
    ...(sinal ? { abortSignal: sinal } : {}),
  };

  const r = await comEsperaDeLimite(`chat ${meu.modelo}`, () =>
    generateText({
      ...comum,
      tools: ferramentasDaTentativa(),
      messages,
      maxOutputTokens: MAX_TOKENS_SAIDA,
      stopWhen: ({ steps }) => chamadasFeitas(steps) >= TETO_FERRAMENTAS,
    }),
  );

  let texto = textoDaResposta(r).trim();
  let ultima: { response?: { modelId?: string } } = r;

  if (texto === "") {
    console.warn(
      `[chat] o loop parou sem texto (${chamadasFeitas(r.steps)} chamada(s) de ferramenta); ` +
        `pedindo a síntese.`,
      diagnostico(r),
    );
    const sintese = await comEsperaDeLimite(`chat síntese ${meu.modelo}`, () =>
      generateText({
        ...comum,
        // As definições ainda são necessárias para o SDK reler os resultados de
        // ferramenta que já estão no histórico — mas estas nunca rodam
        // (`toolChoice: "none"`), e por isso não zeram o rastro nem ganham
        // memória de vistos.
        tools: ferramentas(),
        messages: [...messages, ...r.responseMessages],
        toolChoice: "none",
        maxOutputTokens: MAX_TOKENS_SAIDA * FATOR_DE_FOLGA,
      }),
    );
    texto = textoDaResposta(sintese).trim();
    ultima = sintese;
    if (veioDoPensamento(sintese)) {
      console.warn(`[chat] texto vazio na síntese, lendo o pensamento.`, diagnostico(sintese));
    }
    if (faltouOrcamento(sintese) && texto === "") {
      throw new ChatError(
        `o modelo não escreveu resposta nenhuma: ${diagnostico(sintese)}`,
      );
    }
  } else if (veioDoPensamento(r)) {
    console.warn(`[chat] texto vazio, lendo a resposta do pensamento.`, diagnostico(r));
  }

  if (texto === "") throw new ChatError(`o modelo não escreveu resposta nenhuma: ${diagnostico(r)}`);

  return {
    texto,
    rastro,
    modelo: ultima.response?.modelId ?? meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_CHAT, meu.hash),
  };
}
