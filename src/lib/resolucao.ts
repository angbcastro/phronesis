/**
 * Agente 2 — de quem eu estava falando.
 *
 * O fato que decide o desenho: **"Raffa" e "Rapha" são o mesmo som.** O STT
 * escreve uma grafia só para os dois, e ter os dois nomes no vocabulário não
 * ajuda — só torna arbitrário qual sai. A grafia na transcrição carrega **zero**
 * sinal sobre quem é.
 *
 * Isso mata qualquer solução baseada em nome, e é o que separa esta slice da 3.
 * Lá o problema era duas grafias para a mesma coisa, e `nome_normalizado`
 * resolvia. Aqui é o contrário — uma grafia para duas coisas — e a chave não
 * pode resolver, por construção. Só o contexto resolve, e o contexto mora nos
 * três campos de perfil da entidade (migration 005).
 *
 * **O prompt da extração não muda.** Cinco versões de calibração produziram uma
 * extração que presta; enfiar o catálogo de entidades e a desambiguação dentro
 * daquele prompt arriscaria justamente o que está bom, por um problema que não é
 * dele. Os dois agentes têm `prompt_version` própria (regra 7), calibram
 * separado, e um erro de atribuição se conserta sem tocar na extração. De
 * quebra, este agente roda **sem re-extrair**: calibrar a resolução não custa
 * uma chamada de extração a cada tentativa.
 *
 * **Desde a slice 4.8 ele roda por janela**, dentro da extração de cada fatia de
 * 2 min: decide as menções daquela janela e recebe as anteriores como contexto,
 * sem reabri-las. Ele não vê o que ainda vai ser dito — mesma limitação da
 * extração, mesmo conserto: eu, na revisão.
 *
 * **Nada é escrito no grafo.** Este módulo só lê o catálogo e devolve
 * atribuições; quem grava é o confirmar, depois da revisão (regra 5).
 */
import { generateText } from "ai";
import { proximidade } from "./duplicatas";
import { acharPorChave, candidatosSemanticos } from "./entidades";
import type { CandidatoSemantico, EntidadeDoGrafo } from "./entidades";
import { diagnostico, garantirGateway, modeloResolucao } from "./modelos";
import { carimbo, efetivo } from "./overrides";
import type { RespostaDoModelo } from "./modelos";
import { normalizarNome } from "./texto";
import { CAMPOS_PERFIL } from "./tipos";
import type {
  AtomoCru,
  Camada,
  CampoPerfil,
  Evidencia,
  MarcaPerfil,
  ReferenciaResolvida,
} from "./tipos";

// A camada mora em `tipos.ts` desde a 4.8.1: `ReferenciaResolvida` a carrega até
// a revisão, e a tela não importa o módulo que fala com o Gateway. Reexportada
// aqui porque é aqui que ela se decide.
export type { Camada };

/**
 * Muda sempre que o prompt mudar — mesma disciplina da extração (regra 7).
 *
 * Subiu para `resolucao-2` na slice 4.5, e o texto do prompt quase não mudou:
 * **a versão acompanha a entrada, não só a redação.** O conjunto de candidatos
 * que o agente recebe passou a incluir os que vieram por vetor, e mesmo palavra
 * por palavra idêntico o prompt produz outra saída — que é o que a regra 7
 * existe para deixar rastreável.
 */
export const PROMPT_VERSION_RESOLUCAO = "resolucao-2";

/**
 * Teto de candidatos sobre a **união** das quatro camadas.
 *
 * Ele e os pisos abaixo são obrigatórios, e é o mesmo motivo: uma camada
 * semântica sem corte é uma camada que **sempre acha alguém**. Sem teto e sem
 * piso, todo átomo ganha candidato, `decidir()` cai sempre em `julgar`, o agente
 * 2 é chamado em toda sessão, e o critério 5 da slice 4 morre — aquele que diz
 * que sessão sem ambiguidade não paga nada.
 *
 * Três é o que cabe numa frase de dúvida na revisão sem virar lista.
 */
export const TOP_K = 3;

/**
 * Os pisos, **em cosseno** (as consultas de `entidades.ts` desfazem a
 * normalização do Neo4j antes de comparar).
 *
 * **Os dois se calibram separado, e o mesmo número não significa a mesma coisa
 * nas duas camadas.** A 3a é assimétrica — texto corrido de átomo contra uma
 * string canônica curta de perfil —, e a 3b é simétrica, átomo contra átomo.
 * Igualá-los seria coincidência, não economia.
 *
 * O ponto de partida é medido, não escolhido: com
 * `openai/text-embedding-3-small`, o par de APRENDIZADO do "Pronto quando" da
 * slice 4.5 dá 0,594 entre si e 0,19–0,29 contra assunto não relacionado. O piso
 * dos vizinhos fica no meio dessa distância; o do perfil, mais baixo, porque a
 * comparação assimétrica pontua sistematicamente menos.
 *
 * Estes são números para eu mexer olhando a revisão, sessão real por sessão
 * real — como toda avaliação de qualidade aqui. Piso alto demais faz a camada
 * calar; baixo demais faz o agente 2 ser chamado à toa.
 */
export const PISO_PERFIL = 0.34;
export const PISO_VIZINHOS = 0.45;

/**
 * Quantos nós cada índice devolve **antes** do piso cortar.
 *
 * Mais largo nos vizinhos porque lá o que interessa é contar voto: com `k`
 * pequeno, uma entidade com muitos átomos abafa as outras antes de a contagem
 * significar alguma coisa.
 */
export const ALCANCE = { perfis: 5, vizinhos: 8 };

/** Como a extração: modelo de raciocínio come orçamento antes de escrever JSON. */
const MAX_TOKENS_SAIDA = 4000;

/** Quanto da resposta crua entra no log quando o parse falha. */
const AMOSTRA_ERRO = 400;

/** O que o modelo responde quando a menção não é nenhuma das entidades listadas. */
const NOVA = "NOVA";

/** O dono do diário, como chave. Não é pronome (`texto.ts`): é uma entidade. */
const EU = "eu";

/**
 * Os três tipos cujo sujeito é `eu` **por contrato do `extracao-6`**: "SENTIMENTO,
 * APRENDIZADO e ROTINA → SEMPRE 'eu'". Sentimento é meu por definição mesmo
 * quando foi outra pessoa que o provocou; quem provocou vai em `menciona`.
 */
const TIPOS_SEMPRE_EU: readonly string[] = ["SENTIMENTO", "APRENDIZADO", "ROTINA"];

/**
 * O sujeito desta menção está travado em `eu` pelo tipo do átomo?
 *
 * Só o **sujeito**, e só quando o extrator de fato escreveu `eu`: se ele já
 * violou o próprio contrato e pôs outra pessoa ali, não é este código que
 * arbitra — a guarda existe para impedir que a resolução **tire** o sujeito de
 * `eu`, não para reescrever o que veio da extração.
 */
export function travadoEmEu(tipo: string | undefined, papel: Papel, citado: string): boolean {
  return (
    papel === "sobre" &&
    TIPOS_SEMPRE_EU.includes(String(tipo ?? "").toUpperCase()) &&
    normalizarNome(citado) === EU
  );
}

export class ResolucaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolucaoError";
  }
}

/** Onde no átomo a menção estava. O sujeito é um, as menções são 0..n. */
export type Papel = "sobre" | "menciona";

export interface Mencao {
  atomo: number;
  papel: Papel;
  ordem: number;
  citado: string;
}

/** Um candidato da união, com a camada que o achou e o que ela tem a dizer. */
export interface Candidato {
  entidade: EntidadeDoGrafo;
  /** A **primeira** camada que o achou — o mesmo nó pode vir por várias. */
  camada: Camada;
  /** Cosseno, quando veio por vetor. `null` nas camadas de string. */
  similaridade: number | null;
  /** Os átomos que o elegeram na camada dos vizinhos. Vazio nas outras. */
  porque: Evidencia[];
}

export interface Candidatos {
  /** Casamento de chave — inclui as grafias já fundidas no nó (slice 3). */
  exatos: EntidadeDoGrafo[];
  /** Parecidos por string, que é onde o homófono aparece. */
  parecidos: EntidadeDoGrafo[];
  /**
   * Camadas 3a e 3b (slice 4.5), já resolvidas a nós do catálogo e na ordem em
   * que o vetor as devolveu. Vazio quando o índice não existe, o Gateway falhou
   * ou nada passou do piso — e aí tudo se comporta como na slice 4.
   */
  semanticos: Candidato[];
}

/**
 * Quem pode ser esta menção.
 *
 * Reusa `proximidade` de `duplicatas.ts`, que pega o caso homófono de brinde:
 * "Rafa" fica a uma ou duas letras de "Raffa" e de "Rapha". É a mesma camada de
 * string da slice 3 — de graça, e boa o bastante para decidir **quando** vale
 * pagar uma chamada de modelo.
 */
export function candidatosDe(
  citado: string,
  catalogo: readonly EntidadeDoGrafo[],
  semanticos: readonly CandidatoSemantico[] = [],
): Candidatos {
  const chave = normalizarNome(citado);
  const exato = acharPorChave(chave, catalogo);
  const exatos = exato ? [exato] : [];

  const parecidos = catalogo.filter(
    (e) => e.id !== exato?.id && proximidade(citado, e.nome) !== null,
  );

  return { exatos, parecidos, semanticos: comoCandidatos(semanticos, catalogo) };
}

/**
 * As chaves que o vetor devolveu, de volta a nós do catálogo.
 *
 * Chave que não está no catálogo cai fora em silêncio: o índice pode conter o
 * vetor de um nó que a leitura de hoje não lista — um fundido cuja travessia
 * não achou vencedor, por exemplo. Candidato que não existe na lista da revisão
 * seria um nome que eu não consigo escolher.
 *
 * Ordena por **voto primeiro, similaridade depois**: dois átomos apontando para
 * a mesma pessoa dizem mais do que um átomo apontando um pouco mais parecido. A
 * camada de perfil sempre tem um voto, e por isso perde de um empate de
 * vizinhos — o que está certo: lá há evidência de uso, aqui só descrição.
 */
function comoCandidatos(
  semanticos: readonly CandidatoSemantico[],
  catalogo: readonly EntidadeDoGrafo[],
): Candidato[] {
  return [...semanticos]
    .sort((a, b) => b.votos - a.votos || b.similaridade - a.similaridade)
    .flatMap((c) => {
      const no = acharPorChave(c.chave, catalogo);
      if (!no) return [];
      return [
        {
          entidade: no,
          camada: c.camada,
          similaridade: c.similaridade,
          porque: c.porque,
        } satisfies Candidato,
      ];
    });
}

/**
 * A união das quatro camadas, sem repetição e com teto.
 *
 * **Aditivas, nunca substitutivas**: a ordem é exato, string, vetor, e o mesmo
 * nó achado por duas camadas aparece uma vez só, pela mais forte — mas leva
 * junto o `porque` da camada dos vizinhos, que é a única que tem o que mostrar.
 *
 * Essa deduplicação é o que faz o critério 5 da slice 4 sobreviver ao vetor. O
 * caso comum de uma sessão sem ambiguidade é justamente este: a grafia casa com
 * o nó, e os vizinhos votam **no mesmo nó**. União de tamanho 1, decisão de
 * graça, agente 2 não chamado.
 */
export function unir(c: Candidatos): Candidato[] {
  const uniao: Candidato[] = [];
  const porId = new Map<string, Candidato>();

  const acrescentar = (entidade: EntidadeDoGrafo, camada: Camada, vindoDe?: Candidato) => {
    const ja = porId.get(entidade.id);
    if (ja) {
      // O nó já entrou por uma camada mais forte; o que ele ainda pode ganhar
      // aqui é a evidência, que só a camada dos vizinhos produz.
      if (ja.porque.length === 0 && vindoDe && vindoDe.porque.length > 0) {
        ja.porque = vindoDe.porque;
      }
      return;
    }
    const novo: Candidato = {
      entidade,
      camada,
      similaridade: vindoDe?.similaridade ?? null,
      porque: vindoDe?.porque ?? [],
    };
    porId.set(entidade.id, novo);
    uniao.push(novo);
  };

  for (const e of c.exatos) acrescentar(e, "exato");
  for (const e of c.parecidos) acrescentar(e, "string");
  for (const s of c.semanticos) acrescentar(s.entidade, s.camada, s);

  return uniao.slice(0, TOP_K);
}

export type Decisao =
  | { tipo: "no"; no: EntidadeDoGrafo }
  | { tipo: "nova" }
  | { tipo: "julgar"; candidatos: Candidato[] };

/**
 * Só se chama o modelo quando há o que decidir.
 *
 * | Situação da menção | O que acontece |
 * |---|---|
 * | a união é um candidato só, e ele é o exato | resolve ali, de graça |
 * | a união é vazia | entidade nova, de graça |
 * | qualquer outra coisa | vai ao agente |
 *
 * **A conta é sobre a união deduplicada** (slice 4.5), e não sobre cada camada
 * em separado. É o que faz o vetor caber sem quebrar o critério 5 da slice 4:
 * quando os vizinhos votam no mesmo nó que a grafia já achou, a união continua
 * tendo um candidato só e ninguém paga nada. Uma sessão só passa a custar
 * quando o vetor traz alguém que a string **não** tinha trazido — que é
 * exatamente o buraco que ele existe para tapar.
 *
 * A última linha cobre o caso traiçoeiro, e é o motivo de ela não ser "dois ou
 * mais candidatos": o STT escreve "Rapha" exatamente, o casamento de string
 * acerta **por sorte**, e como "Raffa" é parecido a menção vai ao agente mesmo
 * assim. Sem isso o sistema acertaria metade das vezes por acidente e erraria a
 * outra metade em silêncio.
 *
 * Um parecido sozinho, sem exato, também vai: decidir entre "é o Raffa" e "é
 * alguém novo chamado Rafa" é exatamente o julgamento que esta slice existe para
 * fazer.
 */
export function decidir(c: Candidatos): Decisao {
  const uniao = unir(c);
  if (uniao.length === 0) return { tipo: "nova" };
  if (uniao.length === 1 && c.exatos.length === 1) return { tipo: "no", no: c.exatos[0] };
  return { tipo: "julgar", candidatos: uniao };
}

/** Todas as menções de todos os átomos, na ordem em que a revisão as mostra. */
export function listarMencoes(atomos: readonly AtomoCru[]): Mencao[] {
  const lista: Mencao[] = [];
  atomos.forEach((a, atomo) => {
    lista.push({ atomo, papel: "sobre", ordem: 0, citado: a.sobre });
    (a.menciona ?? []).forEach((citado, ordem) =>
      lista.push({ atomo, papel: "menciona", ordem, citado }),
    );
  });
  return lista;
}

const referenciaAoNo = (citado: string, no: EntidadeDoGrafo, motivo: string): ReferenciaResolvida => ({
  citado,
  entidade: no.nome,
  conhecida: true,
  certo: true,
  alternativas: [],
  motivo,
  // Sem dúvida não há o que auditar: esta é a menção que resolveu de graça,
  // e a revisão não mostra nada sobre ela.
  porque: [],
  // Mas a tela diz de onde veio: "a grafia bateu" é a frase que separa esta
  // sugestão de uma herdada de átomos passados (4.8.1).
  camada: "exato",
});

const referenciaNova = (citado: string): ReferenciaResolvida => ({
  citado,
  entidade: citado.trim(),
  conhecida: false,
  certo: true,
  alternativas: [],
  motivo: "",
  porque: [],
});

export const INSTRUCOES = `Você recebe os átomos extraídos de um diário falado pessoal, em português, e a lista de pessoas, projetos e objetivos que já existem no diário — cada um com o perfil que o dono escreveu.

Sua tarefa é decidir, para cada MENÇÃO EM DÚVIDA, a qual dessas entidades ela se refere — ou se é alguém/algo novo.

POR QUE ISSO É DIFÍCIL
Nomes que soam igual ("Raffa" e "Rapha") chegam da transcrição com UMA grafia só, escolhida pelo transcritor. A grafia NÃO diz quem é. O que diz é o contexto: o que a pessoa faz, o que ela sabe, o que já foi feito junto com ela. O campo "fizemos juntos" costuma ser o sinal mais forte, porque atividade compartilhada é o que aparece na transcrição.

COMO DECIDIR
- Compare o que o átomo diz com o perfil de cada candidato.
- Cada candidato vem com o MOTIVO de estar na lista: grafia igual, nome parecido, perfil parecido, ou átomos passados parecidos que já são dele. Motivo é pista, não veredito — um candidato que entrou por nome parecido continua podendo ser o certo, e um que entrou por átomo parecido continua podendo ser o errado.
- Quando o motivo cita átomos passados, eles são o que você tem de mais próximo de evidência de uso: eu já disse aquilo daquela pessoa. Vale mais que semelhança de nome, e menos que o perfil contradizer.
- Se o átomo casa claramente com o perfil de um deles, escolha esse, com "certo": true.
- Se nada no átomo distingue os candidatos ("falei com o Rafa hoje"), escolha o mais provável e marque "certo": false. A dúvida vai ser mostrada para o dono decidir; ela é útil, não é fracasso.
- Se nenhum candidato serve — o contexto contradiz todos —, responda "${NOVA}". Duas entidades a mais é grafo um pouco sujo; atribuir ao errado é grafo mentindo.
- Nunca invente uma entidade que não está na lista. Ou uma das chaves oferecidas, ou "${NOVA}".

INFORMAÇÃO DE PERFIL
Além disso, aponte os átomos que dizem algo que MERECE ENTRAR no perfil de alguém, nestes três campos:
  contexto          quem a pessoa é para o dono do diário e qualquer outro contexto relevante sobre ela — a relação, o papel, o momento de vida, o que está acontecendo com ela
  pode_ajudar_com   o que ela sabe, com o que já trabalhou, o que sabe fazer
  fizemos_juntos    o que o dono e ela fizeram juntos

A informação é DE QUEM ELA FALA, não de quem é o sujeito do átomo: "fui no parque andar de slackline com o Raffa" é um átomo sobre "eu", e a informação de perfil é do Raffa, no campo fizemos_juntos.
Só aponte quando o átomo de fato acrescenta algo duradouro sobre a pessoa. Trivialidade do dia não é perfil. Lista vazia é resposta legítima e comum.
A entidade apontada tem que ser uma das que o próprio átomo cita.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"referencias":[{"n":1,"entidade":"<chave da lista ou ${NOVA}>","certo":true,"motivo":"<uma frase curta>"}],
 "perfil":[{"atomo":0,"entidade":"<chave da lista>","campo":"fizemos_juntos"}]}

"motivo" é uma frase curta, em português, dizendo o que no átomo te fez escolher. Ela é mostrada ao dono quando você marca "certo": false.`;

/** Como cada entidade aparece no prompt: nome, tipo e o que o dono escreveu dela. */
function descrever(e: EntidadeDoGrafo): string {
  const campos = CAMPOS_PERFIL.flatMap((c) =>
    e.perfil[c] ? [`    ${c}: ${e.perfil[c]}`] : [],
  );
  const cabeca = `- chave "${e.nome_normalizado}" — ${e.nome} (${e.tipo.toLowerCase()}, ${e.sessoes} sessão(ões))`;
  const alias = e.aliases.length > 0 ? `\n    também escrito: ${e.aliases.join(", ")}` : "";
  const perfil = campos.length > 0 ? `\n${campos.join("\n")}` : "\n    (sem perfil escrito)";
  return cabeca + alias + perfil;
}

/** Uma menção que sobrou para o agente decidir, com quem ela pode ser. */
interface Pendente {
  n: number;
  mencao: Mencao;
  candidatos: Candidato[];
  /**
   * Todas as menções que esta pergunta responde — a representada e as iguais a
   * ela **no mesmo átomo** (slice 4.8.1).
   *
   * Duas menções com a mesma grafia dentro do mesmo átomo têm, por construção,
   * a mesma lista de candidatos: as camadas de string olham o citado e as
   * semânticas são calculadas por átomo. Numerá-las duas vezes pagava a mesma
   * pergunta duas vezes e ainda admitia duas respostas diferentes para a mesma
   * coisa. **Entre átomos elas não colapsam** — é o ponto inteiro da slice 4.
   *
   * Ausente é a menção sozinha: quem monta prompt em teste não precisa dela.
   */
  iguais?: Mencao[];
}

/**
 * Por que este nó está na lista — a frase que vai ao lado do candidato no
 * prompt.
 *
 * A da camada dos vizinhos carrega os trechos dos átomos que votaram, e isso
 * não é só auditoria: é o sinal mais útil que esta slice acrescenta ao agente.
 * "dois átomos parecidos com este já são dela, e dizem isto" é evidência de uso,
 * que é justamente o que falta quando o perfil está vazio.
 */
function porqueDoCandidato(c: Candidato): string {
  switch (c.camada) {
    case "exato":
      return "a grafia bate com o nome dela no grafo (ou com um alias)";
    case "string":
      return "o nome é parecido com o que o extrator escreveu";
    case "perfil":
      return `o perfil dela se parece com o que este átomo diz (${(c.similaridade ?? 0).toFixed(2)})`;
    case "vizinhos": {
      const trechos = c.porque.map((e) => `"${e.texto}"`).join("; ");
      return `${c.porque.length} átomo(s) parecidos com este já são dela: ${trechos}`;
    }
  }
}

/**
 * Um átomo de uma janela anterior, como esta chamada o vê: contexto, não
 * pergunta. Mesma forma que `extracao.ts` monta para o bloco da janela.
 */
export interface AtomoAnterior {
  tipo: string;
  texto: string;
  sobre: string;
}

export function montarPrompt(
  atomos: readonly AtomoCru[],
  pendentes: readonly Pendente[],
  catalogo: readonly EntidadeDoGrafo[],
  /** O prompt em vigor — a base do git, ou o que eu editei no painel (4.7). */
  base: string = INSTRUCOES,
  /**
   * O que as janelas anteriores desta sessão já propuseram (slice 4.8).
   *
   * Entra como bloco à parte, **antes** dos átomos desta janela, e sem número:
   * quem é numerado no prompt são os átomos desta janela, que é a numeração que
   * as menções em dúvida endereçam. Duas listas contando do zero no mesmo texto
   * seriam duas leituras possíveis de "no átomo 0".
   *
   * O bloco some quando está vazio — que é o caso do passe único. Assim o
   * prompt de uma sessão não fatiada continua saindo byte a byte igual ao de
   * antes da fatia, e por isso `PROMPT_VERSION_RESOLUCAO` não muda com ela.
   */
  jaPropostos: readonly AtomoAnterior[] = [],
): string {
  const listaAtomos = atomos
    .map((a, i) => `${i}. [${a.tipo}] ${a.texto}\n   trecho: ${(a.trechos ?? [])[0] ?? ""}`)
    .join("\n");

  const listaEntidades = catalogo.map(descrever).join("\n");

  const listaPendentes = pendentes
    .map(({ n, mencao, candidatos }) =>
      [
        `${n}. no átomo ${mencao.atomo}, o extrator escreveu "${mencao.citado}" ` +
          `(${mencao.papel === "sobre" ? "sujeito" : "menção"}). Candidatos:`,
        ...candidatos.map(
          (c) => `   - "${c.entidade.nome_normalizado}" — ${porqueDoCandidato(c)}`,
        ),
      ].join("\n"),
    )
    .join("\n");

  const anteriores =
    jaPropostos.length === 0
      ? ""
      : `
ÁTOMOS JÁ PROPOSTOS ANTES DESTA JANELA (contexto; não decida sobre eles):
${jaPropostos.map((a) => `- [${a.tipo}] ${a.texto} (é de: ${a.sobre})`).join("\n")}
`;

  return `${base}
${anteriores}
ÁTOMOS DESTA SESSÃO:
${listaAtomos}

ENTIDADES QUE JÁ EXISTEM:
${listaEntidades}

MENÇÕES EM DÚVIDA:
${listaPendentes}`;
}

interface JulgamentoCru {
  n?: unknown;
  entidade?: unknown;
  certo?: unknown;
  motivo?: unknown;
}

interface MarcaCru {
  atomo?: unknown;
  entidade?: unknown;
  campo?: unknown;
}

export interface RespostaResolucao {
  referencias: JulgamentoCru[];
  perfil: MarcaCru[];
}

/**
 * Mesma tolerância da extração (`isolarJson`), e agora de verdade: cerca de
 * markdown, frase antes, **e array solto**.
 *
 * O comentário anterior prometia o array e o código não entregava: procurando
 * só `{`, uma resposta `[{"n":1,…}]` não estourava — pegava do primeiro `{` ao
 * último `}` e devolvia um julgamento único sem `referencias`, ou seja, duas
 * listas vazias. A chamada tinha sido paga, o agente tinha respondido, e cada
 * menção saía com "o agente não respondeu por esta menção". Promessa que o
 * código não cumpre é pior que limite declarado: ela esconde o modo de falha.
 *
 * Array solto é lido como a lista de julgamentos sem o envelope — é o que o
 * modelo omite quando omite alguma coisa, e é o que o `perfil` vazio custa
 * nada em assumir.
 */
export function parsearResposta(bruto: string): RespostaResolucao {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");

  // Objeto ou lista solta, o que vier primeiro — igual à extração.
  const aberturas = [semCerca.indexOf("{"), semCerca.indexOf("[")].filter((i) => i >= 0);
  const inicio = aberturas.length === 0 ? -1 : Math.min(...aberturas);
  const fim = inicio === -1 ? -1 : semCerca.lastIndexOf(semCerca[inicio] === "{" ? "}" : "]");
  if (inicio === -1 || fim <= inicio) {
    throw new ResolucaoError(`resposta sem JSON reconhecível: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }

  let cru: unknown;
  try {
    cru = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch (e) {
    throw new ResolucaoError(
      `resposta não é JSON válido: ${e instanceof Error ? e.message : String(e)}. ` +
        `Vieram ${bruto.length} caractere(s): ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }

  // A lista solta é a de julgamentos: é a que o prompt pede primeiro, e a que
  // o modelo devolve quando devolve só uma.
  if (Array.isArray(cru)) return { referencias: cru as JulgamentoCru[], perfil: [] };

  const obj = (cru ?? {}) as { referencias?: unknown; perfil?: unknown };
  return {
    referencias: Array.isArray(obj.referencias) ? (obj.referencias as JulgamentoCru[]) : [],
    perfil: Array.isArray(obj.perfil) ? (obj.perfil as MarcaCru[]) : [],
  };
}

/** O que a resolução devolve: uma atribuição por menção, e as marcas de perfil. */
export interface Atribuicoes {
  sobre: ReferenciaResolvida[];
  menciona: ReferenciaResolvida[][];
  perfila: MarcaPerfil[][];
  /** `null` quando nenhuma menção precisou de julgamento — ninguém pagou nada. */
  modelo: string | null;
  prompt_version: string | null;
}

const normalizarCampo = (v: unknown): CampoPerfil | null =>
  typeof v === "string" && (CAMPOS_PERFIL as readonly string[]).includes(v.trim().toLowerCase())
    ? (v.trim().toLowerCase() as CampoPerfil)
    : null;

/**
 * Dos átomos crus às atribuições, menção por menção.
 *
 * Uma passada determinística e de graça monta os candidatos de cada menção; só o
 * que sobra em dúvida vai ao modelo, numa chamada só para a sessão inteira. Se
 * nada sobrar, o modelo **não é chamado** e a sessão não paga nada.
 *
 * Falha do agente não derruba a extração, que já foi paga: as menções em dúvida
 * voltam com `certo: false` e o motivo dizendo o que houve. A revisão destaca
 * cada uma e eu escolho na mão — muito melhor que perder a proposta inteira.
 */
export async function resolverReferencias(
  atomos: readonly AtomoCru[],
  catalogo: readonly EntidadeDoGrafo[],
  /**
   * Os átomos das janelas anteriores desta sessão (slice 4.8). Entram como
   * contexto no prompt e **não** são resolvidos de novo: eles já foram
   * atribuídos quando nasceram, e reabrir a decisão a cada janela seria pagar a
   * mesma pergunta oito vezes.
   */
  { jaPropostos = [] }: { jaPropostos?: readonly AtomoAnterior[] } = {},
): Promise<Atribuicoes> {
  const mencoes = listarMencoes(atomos);
  const resolvidas = new Map<Mencao, ReferenciaResolvida>();
  const pendentes: Pendente[] = [];

  // As duas camadas semânticas, uma vez para a sessão inteira: uma passada de
  // `embedMany` e duas consultas de índice, e não uma por menção. O resultado é
  // por **átomo** — o sujeito e as menções do mesmo átomo compartilham o mesmo
  // texto, e portanto os mesmos vizinhos.
  //
  // Catálogo vazio pula tudo: sem entidade no grafo não há em que o vetor
  // acertar, e pagar uma chamada de embedding para descobrir isso seria gastar
  // por nada na primeira sessão da vida do sistema.
  //
  // `garantirGateway()` vem **antes** desta chamada, e não só no ramo com
  // pendentes: embutir o texto do átomo já é tráfego de modelo, e conferir a
  // chave depois de o Gateway ter sido chamado é conferir tarde. Continua fora
  // do ramo do catálogo vazio — lá nada sai pelo Gateway, e exigir a chave
  // seria cobrar por um caminho que não gasta.
  let semanticos: CandidatoSemantico[][];
  if (catalogo.length === 0) {
    semanticos = atomos.map(() => []);
  } else {
    garantirGateway();
    semanticos = await candidatosSemanticos(
      atomos.map((a) => a.texto),
      { perfil: PISO_PERFIL, vizinhos: PISO_VIZINHOS },
      ALCANCE,
    );
  }

  /** `átomo|chave` → a pergunta que já cobre esta menção neste átomo (D2). */
  const jaPerguntada = new Map<string, Pendente>();

  for (const m of mencoes) {
    const decisao = decidir(candidatosDe(m.citado, catalogo, semanticos[m.atomo] ?? []));
    if (decisao.tipo === "no") {
      resolvidas.set(m, referenciaAoNo(m.citado, decisao.no, "casou com o nome no grafo"));
    } else if (decisao.tipo === "nova") {
      resolvidas.set(m, referenciaNova(m.citado));
    } else {
      const chave = `${m.atomo}|${normalizarNome(m.citado)}`;
      const ja = jaPerguntada.get(chave);
      if (ja) {
        ja.iguais!.push(m);
        continue;
      }
      const p: Pendente = {
        n: pendentes.length + 1,
        mencao: m,
        candidatos: decisao.candidatos,
        iguais: [m],
      };
      jaPerguntada.set(chave, p);
      pendentes.push(p);
    }
  }

  // As entidades que esta sessão pode citar. O catálogo inteiro não vai ao
  // prompt de propósito: uma menção só pode resolver para um candidato dela, e
  // mandar o resto seria pagar por texto que não muda resposta nenhuma.
  const envolvidas = new Map<string, EntidadeDoGrafo>();
  for (const r of resolvidas.values()) {
    const no = acharPorChave(normalizarNome(r.entidade), catalogo);
    if (no) envolvidas.set(no.id, no);
  }
  for (const p of pendentes) {
    for (const c of p.candidatos) envolvidas.set(c.entidade.id, c.entidade);
  }

  let julgamentos = new Map<number, JulgamentoCru>();
  let marcas: MarcaCru[] = [];
  let modelo: string | null = null;
  /**
   * A frase que vale para **todas** as pendentes quando a chamada inteira se
   * perdeu — o agente caiu, ou respondeu sem julgar ninguém. `null` quando a
   * chamada produziu julgamentos: aí cada menção responde por si, e a frase
   * dela distingue "não respondeu por esta" de "respondeu fora dos candidatos"
   * (C1).
   */
  let falha: string | null = null;
  /** O hash do prompt editado no painel, ou `null` — vira o carimbo lá embaixo. */
  let hashPrompt: string | null = null;
  let prompt = "";

  if (pendentes.length > 0) {
    garantirGateway();
    // Só aqui, e não no topo: sessão sem menção ambígua não chama este agente e
    // não paga nada — nem a chamada de modelo, nem a leitura do override.
    const meu = await efetivo("resolucao", { prompt: INSTRUCOES, modelo: modeloResolucao() });
    modelo = meu.modelo;
    hashPrompt = meu.hash;
    prompt = montarPrompt(atomos, pendentes, [...envolvidas.values()], meu.prompt, jaPropostos);

    // Guardada fora do `try` porque é no `catch` que ela interessa: este agente
    // usa o mesmo modelo de raciocínio da extração e tem o mesmo modo de falha —
    // saída vazia porque o pensamento comeu o orçamento. Sem o diagnóstico, o
    // log diz "falhou" e não diz o que fazer a respeito (ARCHITECTURE.md §4.6).
    let resposta: RespostaDoModelo | null = null;
    try {
      const r = await generateText({
        // String de propósito: id em string sai pelo Gateway (regra 8).
        model: modelo,
        prompt,
        temperature: 0,
        maxOutputTokens: MAX_TOKENS_SAIDA,
      });
      resposta = r;
      // Antes do parse: o modelo que de fato atendeu é procedência, e vale
      // registrar mesmo quando a resposta dele não presta.
      modelo = r.response?.modelId ?? modelo;

      const lido = parsearResposta(r.text ?? "");
      julgamentos = new Map(
        lido.referencias.flatMap((j) => (typeof j.n === "number" ? [[j.n, j] as const] : [])),
      );
      marcas = lido.perfil;

      // A chamada foi paga, o agente respondeu, e **nada** do que veio é
      // julgamento. Antes isso descia calado e virava "o agente não respondeu
      // por esta menção" em cada pendente — a etiqueta errada, porque ele
      // respondeu. Aqui é onde o instrumento entra: o log com o diagnóstico e
      // uma amostra da resposta é o que me diz o que aconteceu com a janela,
      // e a frase na tela para de afirmar silêncio onde houve resposta (A1).
      if (julgamentos.size === 0) {
        falha = "o agente respondeu, mas não julgou nenhuma menção — escolha você";
        console.error(
          `[resolucao] resposta sem julgamento nenhum; ` +
            `${pendentes.length} menção(ões) ficam em dúvida:`,
          `${diagnostico(r)} — ${(r.text ?? "").slice(0, AMOSTRA_ERRO)}`,
        );
      }
    } catch (e) {
      const causa = e instanceof Error ? e.message : String(e);
      falha = "o agente de resolução falhou nesta sessão — escolha você";
      console.error(
        `[resolucao] o agente falhou; ${pendentes.length} menção(ões) ficam em dúvida:`,
        resposta ? `${causa} — ${diagnostico(resposta)}` : causa,
      );
    }
  }

  for (const { n, mencao, candidatos, iguais } of pendentes) {
    const nomes = candidatos.map((c) => c.entidade.nome);
    const j = julgamentos.get(n);
    const escolhida = typeof j?.entidade === "string" ? j.entidade.trim() : "";
    const motivo = typeof j?.motivo === "string" ? j.motivo.trim() : "";

    /**
     * A guarda do `"eu"` (A2).
     *
     * As camadas semânticas são calculadas **por átomo** e entregues a todas as
     * menções dele sem filtro pelo citado. `"eu"` casa exato, a 3b traz de quem
     * são os vizinhos, a união vira 2 e a menção vai ao agente — que então pode
     * responder outra pessoa. Foi assim que um `SENTIMENTO` saiu
     * `sobre: "Giampaolo Lepore"` com `certo: true`, sem marca nenhuma na tela.
     *
     * **O conserto é validação, não atalho.** Não mandar `eu` ao agente
     * contradiria a decisão de continuar validando toda menção; o agente
     * continua vendo a menção e é o **código** que recusa a resposta que quebra
     * o contrato de quem veio antes — a mesma forma de `validarMarcas`, que
     * deixa o agente opinar e recusa a marca sobre entidade que o átomo não
     * cita. A frase equivalente no prompt fica para o `resolucao-3` (4.9): ela
     * poupa a decisão, esta guarda é que impede o dado errado.
     *
     * A recusa **aparece**: `certo: false` com o motivo dizendo o que houve. Um
     * agente querendo tirar um SENTIMENTO de `eu` costuma ser sinal de que o
     * tipo do átomo está errado, e isso eu só conserto se vir.
     */
    const travado = travadoEmEu(atomos[mencao.atomo]?.tipo, mencao.papel, mencao.citado);
    const euNoGrafo = candidatos.find((c) => c.entidade.chaves.includes(EU));

    const recusarSaidaDeEu = (
      r: Omit<ReferenciaResolvida, "citado">,
    ): Omit<ReferenciaResolvida, "citado"> => ({
      entidade: euNoGrafo ? euNoGrafo.entidade.nome : mencao.citado.trim(),
      conhecida: Boolean(euNoGrafo),
      certo: false,
      alternativas: [],
      motivo:
        `o agente pôs este ${atomos[mencao.atomo]?.tipo} em "${r.entidade}", e ` +
        `${atomos[mencao.atomo]?.tipo} é sempre de "eu" — mantive o sujeito`,
      porque: [],
    });

    /**
     * A resposta vale para todas as menções que esta pergunta cobriu (D2). O
     * `citado` é o de cada uma: a chave normalizada é que as juntou, e as
     * grafias podem diferir em caixa.
     */
    const responder = (r: Omit<ReferenciaResolvida, "citado">) => {
      const decidida = travado && normalizarNome(r.entidade) !== EU ? recusarSaidaDeEu(r) : r;
      for (const m of iguais ?? [mencao]) resolvidas.set(m, { citado: m.citado, ...decidida });
    };

    const alvo =
      escolhida === "" || escolhida.toUpperCase() === NOVA
        ? undefined
        : candidatos.find((c) => c.entidade.chaves.includes(normalizarNome(escolhida)));

    if (escolhida.toUpperCase() === NOVA) {
      const nome = mencao.citado.trim();
      /**
       * O agente disse "é outra pessoa" e a grafia **já é** o nome de um nó.
       *
       * A causa é legítima: `nome_normalizado` é único no grafo inteiro
       * (migration 002), então o `MERGE` do confirmar não tem como criar um
       * segundo nó — `agregarCandidatas` remapeia para o que existe e o átomo
       * cai nele. O que faltava era o sinal: até aqui isso acontecia com
       * `certo: true` e nada na tela, ou seja, o agente dizia uma coisa e o
       * sistema fazia a oposta em silêncio. Marcar a dúvida é o que me manda
       * renomear um dos dois (C2).
       */
      const colidiu = acharPorChave(normalizarNome(nome), catalogo);
      responder({
        entidade: nome,
        conhecida: false,
        certo: colidiu ? false : j?.certo !== false,
        // Sem o próprio nome escolhido: oferecer como alternativa aquilo que
        // já está escolhido é linha morta na frase de dúvida.
        alternativas: [
          ...new Set(
            [...nomes, ...(colidiu ? [colidiu.nome] : [])].filter(
              (x) => normalizarNome(x) !== normalizarNome(nome),
            ),
          ),
        ],
        motivo: colidiu
          ? `o agente disse que não é nenhuma das conhecidas, mas "${nome}" já é uma ` +
            `entidade no grafo ("${colidiu.nome}") e o átomo vai cair nela — ` +
            `renomeie uma das duas`
          : motivo || "o agente não viu nenhuma das conhecidas neste átomo",
        porque: [],
      });
      continue;
    }

    if (alvo) {
      responder({
        entidade: alvo.entidade.nome,
        conhecida: true,
        certo: j?.certo !== false,
        alternativas: nomes.filter((nome) => nome !== alvo.entidade.nome),
        motivo,
        // A evidência do candidato ESCOLHIDO, e só dele: é o que deixa a revisão
        // dizer "sugeri o Raffa porque isto se parece com o que você disse em
        // 12/ago", com o trecho à mão. Sem isto na tela, a camada dos vizinhos
        // seria realimentação invisível — e não entraria.
        porque: alvo.porque,
        // De onde veio o candidato que o agente escolheu (4.8.1).
        camada: alvo.camada,
      });
      continue;
    }

    // Sem resposta, ou resposta que não é nenhum dos candidatos. O fallback é o
    // casamento exato quando existe, e entidade nova quando não — nunca o
    // parecido. Duas entidades a mais eu conserto em /entidades; fundir duas
    // pessoas por um palpite não tem desfazer.
    const exato = candidatos.find((c) =>
      c.entidade.chaves.includes(normalizarNome(mencao.citado)),
    );

    // **Primeiro não-vazio, não primeiro não-nulo.** `exato?.porque ??
    // candidatos[0]?.porque` nunca caía para o segundo termo: `??` só passa por
    // `null`/`undefined`, e a camada `exato` tem sempre `porque: []`. Quando o
    // fallback era o exato, a evidência dos outros candidatos sumia justamente
    // no caso em que eu tenho de decidir na mão (C3).
    const comEvidencia = [exato, ...candidatos].find((c) => (c?.porque.length ?? 0) > 0);

    responder({
      entidade: exato ? exato.entidade.nome : mencao.citado.trim(),
      conhecida: Boolean(exato),
      certo: false,
      alternativas: exato
        ? nomes.filter((nome) => nome !== exato.entidade.nome)
        : nomes,
      // Três coisas diferentes, três frases diferentes: a chamada inteira se
      // perdeu; o agente julgou outras menções e não esta; ou ele respondeu uma
      // chave que não está entre os candidatos **desta** menção. A frase antiga
      // afirmava silêncio nos três casos, e é ela que eu leio para decidir se o
      // agente está funcionando (C1).
      motivo:
        falha ??
        (escolhida === ""
          ? "o agente não respondeu por esta menção"
          : `o agente respondeu "${escolhida}", que não está entre os candidatos desta menção`),
      // A evidência dos candidatos que sobraram vai junto mesmo sem escolha
      // feita: é justamente quando eu tenho que decidir na mão que saber quais
      // átomos passados puxaram para cada lado vale mais.
      porque: comEvidencia?.porque ?? [],
      // O fallback do exato veio da grafia; o outro não veio de camada nenhuma.
      camada: exato?.camada,
    });
  }

  // De volta à forma do átomo.
  const sobre: ReferenciaResolvida[] = [];
  const menciona: ReferenciaResolvida[][] = atomos.map(() => []);
  for (const m of mencoes) {
    const r = resolvidas.get(m);
    if (!r) continue;
    if (m.papel === "sobre") sobre[m.atomo] = r;
    else menciona[m.atomo][m.ordem] = r;
  }

  return {
    sobre,
    menciona: menciona.map((lista) => lista.filter(Boolean)),
    perfila: validarMarcas(marcas, sobre, menciona, atomos.length),
    modelo,
    prompt_version:
      pendentes.length > 0 ? carimbo(PROMPT_VERSION_RESOLUCAO, hashPrompt) : null,
  };
}

/**
 * A marca de perfil só vale se apontar para uma entidade que o **próprio átomo**
 * cita, num dos três campos. É o que impede o agente de pendurar informação num
 * nó que não tem nada a ver com aquela frase.
 */
export function validarMarcas(
  marcas: readonly MarcaCru[],
  sobre: readonly ReferenciaResolvida[],
  menciona: readonly ReferenciaResolvida[][],
  total: number,
): MarcaPerfil[][] {
  const porAtomo: MarcaPerfil[][] = Array.from({ length: total }, () => []);

  for (const m of marcas) {
    const i = typeof m.atomo === "number" ? m.atomo : Number.NaN;
    const campo = normalizarCampo(m.campo);
    const alvo = typeof m.entidade === "string" ? normalizarNome(m.entidade) : "";
    if (!Number.isInteger(i) || i < 0 || i >= total || !campo || alvo === "") continue;

    const doAtomo = [sobre[i], ...(menciona[i] ?? [])].filter(Boolean);
    const ref = doAtomo.find(
      (r) => normalizarNome(r.entidade) === alvo || normalizarNome(r.citado) === alvo,
    );
    if (!ref) continue;

    const ja = porAtomo[i].some((x) => x.campo === campo && x.entidade === ref.entidade);
    if (!ja) porAtomo[i].push({ entidade: ref.entidade, campo });
  }

  return porAtomo;
}
