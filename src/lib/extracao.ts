/**
 * Extração de átomos a partir de uma **janela** da transcrição.
 *
 * Desde a slice 4.8 a unidade não é mais a sessão: é uma fatia de 2 minutos,
 * extraída enquanto eu ainda estou falando. Quem decide quando uma janela pode
 * fechar, e quem soma o que ela produziu ao acumulado, é `janela.ts` — este
 * módulo recebe o trecho pronto e devolve o que achou nele. A sessão inteira
 * continua sendo um caso: uma janela que se declara `unica`, e aí o prompt sai
 * byte a byte igual ao de antes da fatia (`extrair`).
 *
 * Sai pelo Vercel AI Gateway como todo o resto que fala com modelo — o
 * endereçamento está em `modelos.ts` (regra 8). Este arquivo monta o prompt,
 * valida a resposta, casa cada trecho com o áudio (`offsets.ts`) e chama o
 * agente de resolução (`resolucao.ts`), que atribui cada menção a uma entidade.
 *
 * **Os offsets não saem do modelo.** Ele devolve o trecho; `offsets.ts` acha o
 * segundo. Ver o cabeçalho de lá para o porquê.
 *
 * **São dois agentes, não um** (slice 4). Este arquivo é o primeiro: extrai os
 * átomos e devolve o nome cru que ouviu ("Rafa"). Quem decide **qual** Rafa é
 * `resolucao.ts`, num segundo passo, sobre os átomos já extraídos. O prompt
 * daqui não sabe que entidades existem no grafo, e é de propósito: cinco versões
 * de calibração produziram uma extração que presta, e enfiar a desambiguação
 * dentro dela arriscaria o que está bom por um problema que não é dela.
 *
 * O grafo é **lido** (para saber que entidade já existe) e nunca escrito. Nada
 * vai para o R2 tampouco: a função devolve a proposta e quem a chamar decide o
 * que fazer com ela. Antes da confirmação na revisão o grafo não recebe nada
 * (regra 5).
 */
import { generateText } from "ai";
import { agregarCandidatas, listarEntidades } from "./entidades";
import { comEsperaDeLimite, ehLimiteDeTaxa } from "./limite";
import { diagnostico, garantirGateway, modeloExtracao } from "./modelos";
import { criarLocalizador } from "./offsets";
import { carimbo, efetivo } from "./overrides";
import type { Dossie } from "./recuperacao";
import { sobreDe } from "./referencias";
import { hashDeRegras, regras } from "./regras";
import { resolverReferencias } from "./resolucao";
import type { Atribuicoes } from "./resolucao";
import { normalizarNome } from "./texto";
import {
  DURACAO_CHUNK_S,
  ORCAMENTO_POR_15_MIN,
  TIPOS_ATOMO,
  TIPOS_SEMPRE_EU,
} from "./tipos";
import type { EntidadeDoGrafo } from "./entidades";
import type {
  AtomoCru,
  AtomoProposto,
  Descarte,
  EntidadePropostaFrase,
  Extensao,
  Extracao,
  MencaoCrua,
  Regra,
  TipoAtomo,
  TrechoAncorado,
  Transcricao,
} from "./tipos";

/**
 * Muda sempre que o prompt mudar. Vai gravado em todo átomo (regra 7): sem
 * isso, daqui a três meses não há como saber qual versão produziu o quê.
 *
 * Subiu para `extracao-6` na slice 4.8 sem que `INSTRUCOES_BASE` mudasse um
 * byte: o que mudou foi a **entrada**. O extrator passou a receber um trecho da
 * sessão em vez da sessão inteira, mais a lista do que ele já propôs, e mesmo
 * palavra por palavra idêntico o prompt produz outra saída. É o mesmo motivo
 * pelo qual o `resolucao-2` subiu de versão na 4.5 — a versão acompanha a
 * entrada, não só a redação.
 *
 * Subiu para `extracao-7` na 4.9 pelo mesmo critério, e desta vez a entrada
 * mudou de natureza: o extrator passou a receber o dossiê do que o grafo acha
 * que aquele trecho cita, e a devolver `{citado, chave}` em vez de um nome
 * solto. `INSTRUCOES_BASE` e `FORMATO` continuam sem mudar um byte.
 */
export const PROMPT_VERSION = "extracao-7";

export class ExtracaoError extends Error {
  /** Mesma distinção de `SttError`: voltar mais tarde, ou mexer no código. */
  readonly limiteDeTaxa: boolean;

  constructor(message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes);
    this.name = "ExtracaoError";
    this.limiteDeTaxa = ehLimiteDeTaxa(opcoes?.cause);
  }
}

/**
 * Teto de saída generoso porque `zai/glm-5.3-flash` é modelo de raciocínio: numa
 * sessão de 4 mil caracteres ele gastou 1720 tokens raciocinando para 122 de
 * texto. Sem folga, o raciocínio come o orçamento e a resposta chega sem JSON
 * nenhum — foi assim que a sessão `mtgo3kaf5` falhou.
 */
const MAX_TOKENS_SAIDA = 8000;

/** Quanto da resposta crua entra na mensagem de erro. */
const AMOSTRA_ERRO = 400;

export const INSTRUCOES_BASE = `Você recebe a transcrição de um diário falado, em português, gravado no fim do dia. Sua tarefa é devolver uma versão ESTRUTURADA E ORGANIZADA do que foi dito — não um recorte da transcrição.

Pense assim: daqui a um ano, o que desta sessão eu vou querer reencontrar, ou ver que mudou de ideia, ou lembrar que tinha esquecido?

QUANTOS
Uma sessão de 15 minutos deve render de 10 a 20 átomos. Prefira sempre o átomo maior e mais organizado a vários recortes pequenos. Se você está produzindo um átomo por frase, está errado.

O QUE MERECE UM ÁTOMO
- Carga: o que eu senti, o que me incomodou, o que me deu alívio ou orgulho.
- Conclusão: o que eu aprendi, percebi ou entendi.
- Consequência: o que muda alguma coisa daqui pra frente.
- Decisão: o que eu decidi fazer ou parar de fazer.
- Interação: o que aconteceu com uma pessoa, num projeto, num objetivo — inclusive detalhe sobre alguém que eu vou querer saber antes da próxima conversa.

A TRIVIALIDADE DO DIA VIRA UM ÁTOMO SÓ
Tarefa doméstica, rotina de exercício, deslocamento, compra corriqueira, refeição — nada disso merece átomo próprio. Junte TUDO num único átomo de tipo ROTINA, no máximo um por sessão, listando as coisas numa frase. Se a rotina tiver carga ("foi muito bom"), essa parte vira um átomo separado de SENTIMENTO; a lista continua na ROTINA.

JUNTE O QUE É O MESMO ASSUNTO
Se eu falo de uma coisa no começo e volto a ela mais tarde, isso é UM átomo, não dois. Reúna o que foi dito nos dois momentos numa afirmação só, e devolva os dois trechos.

OS CAMPOS
"texto": a afirmação, limpa e organizada, COM AS MINHAS PALAVRAS. Tire muleta de fala ("aí", "tipo", "basicamente", "né", "assim"), resolva pronome solto ("ele" → o nome), monte uma frase que se sustente sozinha daqui a um ano. NÃO parafraseie para outro vocabulário, não interprete, não psicologize, não melhore o que eu penso. Se eu falei feio, fica feio; o que não pode é ficar ininteligível fora do contexto.

"trechos": lista de 1 ou mais pedaços COPIADOS LITERALMENTE da transcrição, sem corrigir nada, que sustentam a afirmação. É o que liga o átomo ao áudio. Cada trecho tem que aparecer palavra por palavra na transcrição. Se o átomo junta dois momentos, devolva os dois trechos.

"tipo": um de
  FATO        aconteceu, e importa
  OPINIAO     o que eu acho
  SENTIMENTO  como eu me senti
  APRENDIZADO o que eu concluí
  CONQUISTA   o que eu consegui
  DECISAO     o que eu decidi fazer ou parar de fazer
  ROTINA      a trivialidade do dia, colapsada (no máximo um por sessão)

"sobre": exatamente uma entidade, e ela depende do tipo. Esta regra não tem exceção:
  SENTIMENTO, APRENDIZADO e ROTINA  → SEMPRE "eu". Sentimento é meu por definição, mesmo quando foi outra pessoa que o provocou; quem provocou vai em "menciona". Aprendizado é meu mesmo quando é sobre outra pessoa.
  FATO, OPINIAO, CONQUISTA, DECISAO → o assunto de que trata: a pessoa, o projeto ou o objetivo. Só use "eu" quando não houver mesmo nenhum outro assunto.

"menciona": as OUTRAS entidades citadas, ou []. Nunca repita aqui o que já está em "sobre", e não liste "eu" num átomo que já é sobre "eu".

ENTIDADES
Devolva também "entidades": cada entidade citada uma vez só, com o tipo proposto — PESSOA, PROJETO ou OBJETIVO. "eu" é PESSOA. Só liste o que for de fato uma pessoa, um projeto ou um objetivo; coisa que não é nenhum dos três não entra nessa lista e fica apenas dentro do texto do átomo.

NOME DE ENTIDADE É NOME
Procure o nome na transcrição INTEIRA antes de desistir: se em algum momento eu digo "a Marina" e depois passo a falar "ela", a entidade é "Marina" em todos os átomos, inclusive nos que só dizem "ela". O mesmo vale para "meu chefe", "esse cara", "a gente".

Só quando a pessoa NUNCA é nomeada na sessão inteira, devolva o pronome como está ("ela"). Não invente nome, não escreva "ela (namorada)", não use apelido que eu não usei. Quem vai perguntar quem é sou eu, na revisão.

NÃO COMENTE A TRANSCRIÇÃO
Você extrai o que eu disse; não avalia como eu disse. Nunca devolva um átomo sobre a transcrição em si ("o texto é confuso", "não há conclusões claras", "o relato é circular"). Falar desorganizado, repetir e voltar atrás é o esperado num diário falado — é o meu jeito de pensar, não um defeito a ser relatado.

Se não houver nada que mereça um átomo, devolva {"atomos":[],"entidades":[]}. Lista vazia é uma resposta legítima; comentário sobre o material não é.

`;

/**
 * A segunda metade, do cabeçalho `FORMATO` até a transcrição.
 *
 * O corte entre as duas é o ponto exato onde uma regra aprovada entra: depois
 * de tudo o que instrui, antes do que descreve o envelope de saída. Regra
 * enfiada depois do FORMATO seria lida como parte do exemplo de JSON.
 */
export const FORMATO = `FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"atomos":[{"texto":"...","tipo":"FATO","sobre":"...","menciona":[],"trechos":["...","..."]}],
 "entidades":[{"nome":"...","tipo":"PESSOA"}]}

Transcrição:
`;

/**
 * O bloco das regras aprovadas, ou string vazia.
 *
 * `blocoDeRegras([]) === ""` não é detalhe: é o que faz esta fatia inteira ser
 * um **no-op** até a primeira aprovação. Sem regra, o prompt sai byte a byte
 * igual ao de antes dela, e as substrings que `tests/extracao.test.ts` trava
 * continuam onde estavam.
 */
export function blocoDeRegras(lista: readonly Regra[]): string {
  if (lista.length === 0) return "";

  const linhas = lista.map((r) => {
    const alvo = r.substitui?.trim();
    return `- ${r.texto.trim()}${alvo ? ` (isto substitui a seção ${alvo})` : ""}`;
  });

  return `AJUSTES QUE EU PEDI
Vieram da minha revisão de sessões reais e valem sobre tudo o que está acima. Onde um ajuste contradisser uma seção anterior, o ajuste vence.
${linhas.join("\n")}

`;
}

/**
 * O bloco do dossiê, ou string vazia (slice 4.9).
 *
 * **Dossiê vazio devolve `""`, e aí a chamada sai byte a byte igual à da 4.8.**
 * Grafo vazio, primeira sessão da vida do sistema, Gateway fora: tudo como
 * antes. É o mesmo no-op que `blocoDeRegras([]) === ""` garante desde a 4.6, e
 * é o que permite esta fatia inteira ser reversível olhando uma linha.
 *
 * Ele declara a chave nova **de dentro de si** — o precedente é o `estende` da
 * 4.8: quem pede um campo é quem explica o campo, e sem o bloco não há campo
 * nenhum a pedir. `INSTRUCOES_BASE` e `FORMATO` continuam intactos.
 *
 * A amarra do fim é a que evita o pior efeito colateral possível: a lista de
 * entidades conhecidas na frente do modelo é convite para ele pendurar um
 * SENTIMENTO em alguém que não é `eu`. A frase pede; o parse recusa.
 */
export function blocoDasCandidatas(dossie: Dossie): string {
  if (dossie.length === 0) return "";

  const lista = dossie
    .map(({ entidade: e }) => {
      const alias = e.aliases.length > 0 ? `; também escrito: ${e.aliases.join(", ")}` : "";
      const contexto = e.perfil.contexto ? `\n    ${e.perfil.contexto}` : "";
      return `- chave "${e.nome_normalizado}" — ${e.nome} (${e.tipo.toLowerCase()}${alias})${contexto}`;
    })
    .join("\n");

  return `QUEM O DIÁRIO JÁ CONHECE
Estas entidades já existem no diário, e este trecho parece citar alguma delas. A grafia da transcrição pode estar errada: quem transcreve erra nome próprio o tempo todo — "Jean" por "Giampaolo Lepore", "Dapta" por "Adapta".
${lista}

Então, em "sobre" e em cada item de "menciona", devolva um objeto e não um nome solto:
{"citado":"<a grafia como ela aparece na transcrição>","chave":"<uma chave da lista, ou null>"}

- "citado" é sempre o que a transcrição escreveu, sem consertar nada.
- "chave" é a chave da lista quando a menção for uma delas, e null quando não for. NUNCA invente chave fora da lista acima.
- Quando você apontar uma chave, escreva no "texto" do átomo o NOME GRAVADO daquela entidade, e não o que a transcrição escreveu: se a transcrição diz "giam" e a chave é "giampaolo lepore", o texto do átomo diz "Giampaolo Lepore". **Só o nome próprio se troca** — no resto continua valendo tudo o que está acima, inclusive COM AS MINHAS PALAVRAS.
- Isto não abre exceção na regra do "sobre": SENTIMENTO, APRENDIZADO e ROTINA continuam sendo sempre de "eu", por mais que a lista acima ofereça um nome que combine com o assunto.

`;
}

/**
 * O que a janela precisa saber, e o extrator não teria como adivinhar.
 *
 * `jaPropostos` é o que faz a lista acumulada não virar trinta átomos: a janela
 * vê o que já existe e **estende** em vez de duplicar. Sem esta fatia haveria
 * uma passada de costura no fim para consertar isso depois; com ela, o conserto
 * acontece antes de o erro existir, e a espera depois de parar de falar
 * continua sendo só a da janela do fim.
 */
export interface ContextoDeJanela {
  /** Os átomos que as janelas anteriores desta sessão já propuseram. */
  jaPropostos: readonly { tipo: TipoAtomo; texto: string; sobre: string }[];
  /** Onde a janela começa e termina, em segundos da sessão. */
  de_s: number;
  ate_s: number;
  /**
   * A janela é a sessão inteira? Então não há janela nenhuma a declarar, e o
   * bloco some — é o caso do arquivo importado, da gravação curta e do
   * fallback de passe único. Aí o prompt sai byte a byte igual ao da 4.7.
   */
  unica: boolean;
}

/** Quantos átomos pedir de uma janela desta duração, na proporção do prompt. */
export function orcamentoDaJanela(segundos: number): [number, number] {
  const fatia = Math.max(segundos, 0) / (15 * 60);
  const [min, max] = ORCAMENTO_POR_15_MIN;
  const de = Math.max(1, Math.round(min * fatia));
  return [de, Math.max(de + 1, Math.round(max * fatia))];
}

/** "2", "1,5" — minuto redondo não ganha casa decimal à toa. */
function minutos(segundos: number): string {
  const m = Math.max(segundos, 0) / 60;
  return (Math.round(m * 10) / 10).toString().replace(".", ",");
}

/**
 * O bloco que transforma o prompt de sessão inteira em prompt de janela.
 *
 * String vazia quando não há janela nenhuma — e isso não é detalhe: é o que faz
 * o arquivo importado, a gravação de menos de dois minutos e o fallback de
 * passe único continuarem recebendo exatamente o prompt de antes desta fatia.
 */
export function blocoDaJanela(contexto?: ContextoDeJanela): string {
  if (!contexto) return "";
  const { jaPropostos, de_s, ate_s, unica } = contexto;
  if (unica && jaPropostos.length === 0) return "";

  const [de, ate] = orcamentoDaJanela(ate_s - de_s);

  const cabeca = `ESTA JANELA
Você está lendo um TRECHO da sessão — dos minutos ${minutos(de_s)} a ${minutos(ate_s)} —, e não a sessão inteira. Ele pode começar e terminar no meio de uma frase, e a fala continua depois dele.
A janela cobre ${minutos(ate_s - de_s)} minuto(s): pela proporção acima, ela deve render de ${de} a ${ate} átomos. Lista vazia é resposta legítima — o assunto que não fecha aqui volta inteiro na janela seguinte. Não estique o trecho para chegar a um número.

`;

  if (jaPropostos.length === 0) return cabeca;

  const lista = jaPropostos
    .map((a, i) => `${i}. [${a.tipo}] ${a.texto} (sobre: ${a.sobre})`)
    .join("\n");

  return `${cabeca}O QUE VOCÊ JÁ PROPÔS NESTA SESSÃO
${lista}

Nenhum desses pode ser repetido. Se este trecho continua um assunto que já está na lista — inclusive a ROTINA, que é no máximo UMA na sessão inteira —, não crie átomo novo: devolva o número dele em "estende", com a afirmação reescrita inteira e apenas os trechos NOVOS. Átomo da lista que este trecho não tocou não vai em lugar nenhum.
O JSON ganha então uma terceira chave:
{"atomos":[...],"entidades":[...],"estende":[{"ref":0,"texto":"...","trechos":["..."]}]}

`;
}

/**
 * Os cabeçalhos de seção do prompt base, lidos do próprio texto.
 *
 * Existem para o `calibracao-1` poder dizer **qual** seção uma regra nova
 * contradiz. Derivados por leitura, e não escritos numa constante ao lado:
 * uma lista copiada à mão desatualiza no dia em que alguém renomear uma seção,
 * e desatualizaria em silêncio.
 */
export function secoesDoPrompt(): string[] {
  return INSTRUCOES_BASE.split("\n").filter((l) =>
    /^[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÇ ]{3,}$/.test(l),
  );
}

/**
 * O prompt sem a transcrição: é ele que o painel de agentes mostra e edita, e é
 * dele que sai o hash do carimbo. `INSTRUCOES_BASE + FORMATO` **nesta ordem** é
 * o texto de origem; o bloco de regras não entra aqui porque ele tem dono
 * próprio (`/calibracao`) e hash próprio.
 */
export const BASE = INSTRUCOES_BASE + FORMATO;

/**
 * O cabeçalho antes do qual o bloco de regras entra.
 *
 * Enquanto as duas metades eram duas constantes, o ponto de inserção era a
 * emenda entre elas. Com o prompt editável inteiro (slice 4.7) ele passa a ser
 * um cabeçalho procurado no texto — e continua sendo exatamente o mesmo ponto:
 * depois de tudo o que instrui, antes do que descreve o envelope de saída.
 * Regra enfiada depois do FORMATO seria lida como parte do exemplo de JSON.
 */
const CABECALHO_FORMATO = "FORMATO\n";

/**
 * A base com as regras aprovadas no lugar certo.
 *
 * Se eu renomear o cabeçalho ao editar o prompt, as regras vão para o fim, antes
 * da transcrição — pior lugar, e ainda assim o comportamento certo: o prompt que
 * eu escrevi é o que manda, e uma regra aprovada não pode simplesmente sumir
 * porque o cabeçalho mudou de nome.
 */
export function inserirAntesDoFormato(base: string, bloco: string): string {
  if (bloco === "") return base;

  const i = base.lastIndexOf(CABECALHO_FORMATO);
  return i === -1 ? base + bloco : base.slice(0, i) + bloco + base.slice(i);
}

export const comRegras = (base: string, lista: readonly Regra[]): string =>
  inserirAntesDoFormato(base, blocoDeRegras(lista));

/**
 * O prompt de uma chamada: base + regras aprovadas + o dossiê + o bloco da
 * janela + o texto. Os três blocos injetados entram no **mesmo** ponto, na ordem
 * em que aparecem aqui — regra primeiro, porque ela vale sobre tudo; o dossiê
 * depois, porque ele é material; e a janela por último, porque ela é sobre esta
 * chamada e mais nenhuma.
 *
 * Sem `contexto` e sem dossiê, sai byte a byte igual ao de antes da slice 4.8.
 */
export const montarPrompt = (
  texto: string,
  lista: readonly Regra[] = [],
  base: string = BASE,
  contexto?: ContextoDeJanela,
  dossie: Dossie = [],
): string =>
  inserirAntesDoFormato(
    inserirAntesDoFormato(comRegras(base, lista), blocoDasCandidatas(dossie)),
    blocoDaJanela(contexto),
  ) + texto.trim();

/**
 * A versão que vai carimbada no átomo (regra 7).
 *
 * O sufixo sai das regras **usadas nesta chamada**, não do arquivo: se o R2
 * falhar, entram zero regras e a versão é a base. A procedência é verdadeira
 * nos dois caminhos, que é o ponto — carimbar `+a3f91c7d` numa extração que
 * rodou sem regra nenhuma seria mentira gravada no grafo para sempre.
 */
export function versaoDoPrompt(
  lista: readonly Regra[],
  /** O hash do prompt editado no painel (slice 4.7), ou `null` se é a base. */
  hashPrompt: string | null = null,
): string {
  const base = carimbo(PROMPT_VERSION, hashPrompt);
  return lista.length === 0 ? base : `${base}+${hashDeRegras(lista)}`;
}

/**
 * O modelo às vezes embrulha o JSON em cerca de markdown ou emenda uma frase
 * antes. Pegar do primeiro `{` ao último `}` resolve os dois casos sem afrouxar
 * a validação, que continua item por item logo abaixo.
 */
export function isolarJson(bruto: string): string {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");

  // Objeto ou lista solta, o que vier primeiro — o modelo às vezes devolve só
  // o array, sem o envelope que o prompt pediu.
  const aberturas = [semCerca.indexOf("{"), semCerca.indexOf("[")].filter((i) => i >= 0);
  if (aberturas.length === 0) throw new ExtracaoError("resposta sem JSON reconhecível");

  const inicio = Math.min(...aberturas);
  const fim = semCerca.lastIndexOf(semCerca[inicio] === "{" ? "}" : "]");
  if (fim <= inicio) throw new ExtracaoError("resposta sem JSON reconhecível");
  return semCerca.slice(inicio, fim + 1);
}

/** "OPINIÃO" e "opiniao" são a mesma coisa; qualquer outra não é tipo nenhum. */
export function normalizarTipo(valor: unknown): TipoAtomo | null {
  if (typeof valor !== "string") return null;
  const limpo = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  return (TIPOS_ATOMO as readonly string[]).includes(limpo) ? (limpo as TipoAtomo) : null;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Lista de strings não vazias. Aceita uma string solta como lista de um: o
 * modelo às vezes devolve `"trechos": "..."` em vez do array, e recusar o átomo
 * por causa disso seria perder conteúdo bom por erro de forma.
 */
function listaDeTexto(v: unknown): string[] {
  if (typeof v === "string") return texto(v) === "" ? [] : [texto(v)];
  if (!Array.isArray(v)) return [];
  return v.map(texto).filter((x) => x !== "");
}

/**
 * Uma menção, **nas duas formas** (slice 4.9).
 *
 * String vira `{ citado, chave: null }`. É o que mantém intacto o caminho sem
 * dossiê — onde o bloco das candidatas não entra, o modelo continua devolvendo
 * o nome solto que o `extracao-6` pedia — e é o que lê qualquer resposta no
 * formato antigo sem uma linha de migração.
 *
 * A chave sai normalizada: o modelo às vezes devolve "Giampaolo Lepore" onde a
 * lista dizia `giampaolo lepore`, e recusar por causa da caixa seria jogar fora
 * a resposta certa. Quem confere se ela existe no catálogo é a resolução, que é
 * quem tem o catálogo na mão.
 */
export function comoMencaoCrua(v: unknown): MencaoCrua | null {
  if (typeof v === "string") {
    const citado = texto(v);
    return citado === "" ? null : { citado, chave: null };
  }
  if (!v || typeof v !== "object") return null;

  const o = v as Record<string, unknown>;
  const citado = texto(o.citado);
  const chave = normalizarNome(texto(o.chave));

  // Sem citado e sem chave não há menção nenhuma. Com chave e sem citado, a
  // chave serve de grafia: é pior perder a menção do que mostrar o nome do nó
  // onde deveria estar o que eu falei.
  if (citado === "" && chave === "") return null;
  return { citado: citado === "" ? chave : citado, chave: chave === "" ? null : chave };
}

/** As menções de `menciona`, aceitando item solto como lista de um. */
function listaDeMencoes(v: unknown): MencaoCrua[] {
  const itens = Array.isArray(v) ? v : [v];
  return itens.flatMap((x) => {
    const m = comoMencaoCrua(x);
    return m ? [m] : [];
  });
}

export interface RespostaExtrator {
  atomos: AtomoCru[];
  /** Só uma dica de tipo: quem decide o que vira nó é a revisão. */
  entidades: EntidadePropostaFrase[];
  /** Os átomos de janelas anteriores que esta janela mandou engordar. */
  estende: Extensao[];
  descartados: Descarte[];
}

/**
 * Valida item por item. O que não passa vai para `descartados` com o motivo —
 * item malformado não derruba a extração inteira, e não some em silêncio: a
 * lista de descarte é o que diz se o prompt está piorando.
 */
export function parsearResposta(
  bruto: string,
  /**
   * Quantos átomos a lista acumulada tinha quando o prompt foi montado. É a
   * faixa válida de `ref`: um `estende` que aponta para fora dela vira
   * descarte, e não uma escrita silenciosa no átomo errado.
   */
  jaPropostos = 0,
): RespostaExtrator {
  let cru: unknown;
  try {
    cru = JSON.parse(isolarJson(bruto));
  } catch (e) {
    // A resposta crua vai junto: sem ela, "não é JSON" é indiagnosticável
    // depois do fato — a mesma lição que o STT já ensinou uma vez.
    const amostra = bruto.trim().slice(0, AMOSTRA_ERRO);
    throw new ExtracaoError(
      `resposta não é JSON válido: ${e instanceof Error ? e.message : String(e)}. ` +
        `Vieram ${bruto.length} caractere(s): ${amostra === "" ? "(resposta vazia)" : JSON.stringify(amostra)}`,
    );
  }

  const lista = Array.isArray(cru) ? cru : (cru as { atomos?: unknown })?.atomos;
  if (!Array.isArray(lista)) throw new ExtracaoError('resposta sem a lista "atomos"');

  const atomos: AtomoCru[] = [];
  const descartados: Descarte[] = [];

  for (const item of lista) {
    if (!item || typeof item !== "object") {
      descartados.push({ motivo: "item não é objeto", bruto: item });
      continue;
    }
    const i = item as Record<string, unknown>;
    const tipo = normalizarTipo(i.tipo);
    const t = texto(i.texto);
    const trechos = listaDeTexto(i.trechos);
    const sobre = comoMencaoCrua(i.sobre);

    if (t === "") descartados.push({ motivo: "texto vazio", bruto: item });
    else if (tipo === null) descartados.push({ motivo: `tipo desconhecido: ${String(i.tipo)}`, bruto: item });
    else if (trechos.length === 0) descartados.push({ motivo: "sem trecho — não haveria como ligar ao áudio", bruto: item });
    else if (sobre === null) descartados.push({ motivo: "sem sujeito", bruto: item });
    else {
      atomos.push({
        texto: t,
        tipo,
        // A guarda do `eu` (4.8.1), do lado da extração: o dossiê não pode
        // fazer o sujeito de um SENTIMENTO, APRENDIZADO ou ROTINA apontar para
        // um nó do grafo. A lista de conhecidos na frente do modelo é convite
        // exatamente para isso, e o prompt pede o contrário — aqui a chave cai,
        // e o `citado` fica como veio: quem arbitra o sujeito errado do
        // extrator é a revisão, não este código.
        sobre: TIPOS_SEMPRE_EU.includes(tipo) ? { ...sobre, chave: null } : sobre,
        menciona: listaDeMencoes(i.menciona),
        trechos,
      });
    }
  }

  return {
    atomos,
    entidades: propostasDeEntidade(cru),
    estende: extensoes(cru, jaPropostos, descartados),
    descartados,
  };
}

/**
 * Os `estende` válidos. Item malformado vai para `descartados` com o motivo,
 * como todo o resto — extensão que aponta para um átomo que não existe é o
 * único jeito de esta fatia corromper a lista acumulada, e ela não some em
 * silêncio.
 */
function extensoes(cru: unknown, jaPropostos: number, descartados: Descarte[]): Extensao[] {
  const lista = (cru as { estende?: unknown })?.estende;
  if (!Array.isArray(lista)) return [];

  const saida: Extensao[] = [];
  for (const item of lista) {
    const i = (item ?? {}) as Record<string, unknown>;
    const ref = typeof i.ref === "number" ? i.ref : Number(i.ref);
    const t = texto(i.texto);
    const trechos = listaDeTexto(i.trechos);

    if (!Number.isInteger(ref) || ref < 0 || ref >= jaPropostos) {
      descartados.push({ motivo: `estende aponta para o átomo ${String(i.ref)}, que não está na lista`, bruto: item });
    } else if (t === "" && trechos.length === 0) {
      descartados.push({ motivo: "estende sem texto e sem trecho — não acrescenta nada", bruto: item });
    } else {
      saida.push({ ref, texto: t, trechos });
    }
  }
  return saida;
}

/**
 * As entidades que o modelo listou, com o tipo proposto. Item malformado é
 * ignorado em silêncio, e não descartado: isto é palpite de tipo, não conteúdo
 * — `entidades.ts` cai no padrão quando falta, e a contagem de verdade sai dos
 * átomos.
 */
function propostasDeEntidade(cru: unknown): EntidadePropostaFrase[] {
  const lista = (cru as { entidades?: unknown })?.entidades;
  if (!Array.isArray(lista)) return [];

  return lista.flatMap((e) => {
    const nome = texto((e as { nome?: unknown })?.nome);
    return nome === "" ? [] : [{ nome, tipo: (e as { tipo?: unknown })?.tipo }];
  });
}

/**
 * Ata cada átomo ao áudio e carimba a procedência. O id é determinístico
 * (`<sessao_id>-<índice>`) — é o que fará o MERGE do confirmar ser idempotente
 * quando o confirmar existir (regra 4).
 *
 * Só o **primeiro** trecho de cada átomo empurra o cursor do localizador. Os
 * demais podem estar em qualquer ponto da sessão — é o que significa juntar o
 * mesmo assunto dito em dois momentos —, e deixá-los mover o cursor jogaria a
 * busca do próximo átomo para o fim da transcrição.
 */
export function ancorar(
  sessao_id: string,
  crus: AtomoCru[],
  transcricao: Transcricao,
  modelo: string,
  atribuicoes: Atribuicoes,
  /**
   * A versão efetiva do prompt: `extracao-6` sem regra aprovada,
   * `extracao-6+<hash>` com. O padrão é a base porque uma extração sem regra
   * nenhuma é o caso comum — e porque um carimbo tem de ser verdadeiro por
   * omissão, nunca otimista.
   */
  versao: string = PROMPT_VERSION,
  /**
   * Quantos átomos a sessão já tinha antes desta janela. O id é `<sessao>-<n>`
   * e é ele que faz o `MERGE` do confirmar ser idempotente: numerar cada janela
   * a partir do zero faria a janela 1 sobrescrever os átomos da janela 0.
   */
  deslocamento = 0,
): AtomoProposto[] {
  const localizar = criarLocalizador(transcricao.palavras);

  return crus.map(({ trechos, sobre, menciona, ...atomo }, ordem) => ({
    ...atomo,
    // O nome cru do extrator (`sobre`, `menciona`) foi substituído pela
    // atribuição do agente 2. Ele continua guardado dentro da referência, em
    // `citado`: é o que a revisão mostra quando eu quero ver o que foi ouvido.
    sobre: atribuicoes.sobre[ordem],
    menciona: atribuicoes.menciona[ordem] ?? [],
    perfila: atribuicoes.perfila[ordem] ?? [],
    trechos: trechos.map((texto, k) => ({
      texto,
      ...(k === 0 ? localizar(texto) : localizar.semAvancar(texto)),
    })),
    id: `${sessao_id}-${deslocamento + ordem}`,
    indice: deslocamento + ordem,
    prompt_version: versao,
    modelo,
  }));
}

/**
 * Os trechos de um `estende`, casados com o áudio da janela.
 *
 * Localizador próprio, e não o de `ancorar`: a extensão fala de um átomo que
 * nasceu em outra janela, e deixá-la empurrar o cursor dos átomos novos
 * embaralharia a ordem narrativa que o cursor existe para seguir. A janela tem
 * dois minutos — o custo de indexá-la duas vezes é ruído.
 */
export function ancorarTrechos(
  textos: readonly string[],
  transcricao: Transcricao,
): TrechoAncorado[] {
  const localizar = criarLocalizador(transcricao.palavras);
  return textos.map((texto, ordem) => ({
    texto,
    ...(ordem === 0 ? localizar(texto) : localizar.semAvancar(texto)),
  }));
}

/** Um `estende` já casado com o áudio da janela. */
export interface ExtensaoAncorada {
  ref: number;
  texto: string;
  trechos: TrechoAncorado[];
}

/**
 * O que uma janela produziu. Não é uma proposta — é um pedaço dela.
 *
 * `catalogo` viaja junto porque quem monta a proposta final precisa exatamente
 * do que esta chamada já leu do grafo, e uma segunda leitura seria pagar duas
 * vezes pela mesma pergunta.
 */
export interface ResultadoDaJanela {
  novos: AtomoProposto[];
  estende: ExtensaoAncorada[];
  entidades: EntidadePropostaFrase[];
  descartados: Descarte[];
  prompt_version: string;
  /** `""` na janela silenciosa: nenhum modelo foi chamado, e dizer um seria mentira. */
  modelo: string;
  prompt_version_resolucao: string | null;
  modelo_resolucao: string | null;
  catalogo: EntidadeDoGrafo[];
  /**
   * As chaves do dossiê que esta janela recebeu (slice 4.9). Vai carimbada no
   * `EstadoJanela` — é o que diz depois com que lista na mão ela decidiu.
   */
  candidatas: string[];
}

export interface OpcoesDeJanela {
  /** Os átomos que as janelas anteriores já propuseram. */
  jaPropostos?: readonly AtomoProposto[];
  /** Esta janela é a sessão inteira (import, gravação curta, fallback). */
  unica?: boolean;
  /** Prazo de quem chama, repassado à espera de rate limit (`limite.ts`). */
  ate?: number;
  /**
   * Quem o grafo acha que esta janela cita (slice 4.9). Vazio ou ausente faz a
   * chamada sair **byte a byte igual à da 4.8** — é o mesmo no-op que
   * `blocoDeRegras([]) === ""` garante desde a 4.6.
   */
  dossie?: Dossie;
  /**
   * O catálogo que quem chama já leu. `pipeline.ts` precisa dele para montar o
   * dossiê, e sem isto a mesma consulta sairia duas vezes por janela.
   */
  catalogo?: EntidadeDoGrafo[];
}

/** Onde a janela começa e termina, em segundos da sessão. */
export function faixaDaJanela(t: Transcricao): { de_s: number; ate_s: number } {
  const p0 = t.palavras[0];
  const pn = t.palavras[t.palavras.length - 1];
  if (p0 && pn) return { de_s: p0.inicio, ate_s: Math.max(pn.fim, p0.inicio) };

  const b0 = t.blocos[0];
  const bn = t.blocos[t.blocos.length - 1];
  if (b0 && bn) return { de_s: b0.offset_s, ate_s: bn.offset_s + DURACAO_CHUNK_S };

  return { de_s: 0, ate_s: 0 };
}

/**
 * Uma janela: extrai, resolve e ancora o trecho que recebeu.
 *
 * É aqui que a chamada de modelo da extração mora — a única do projeto, e é o
 * que faz `agentes.ts` continuar podendo dizer que todo `generateText` pertence
 * a um agente do registro. `janela.ts` orquestra e não fala com modelo nenhum.
 *
 * Uma janela **silenciosa não é falha**: dois minutos sem fala transcrita
 * devolvem lista vazia e a janela fecha. Só a sessão inteira vazia estoura, que
 * é o comportamento que `extrair` sempre teve.
 */
export async function extrairJanela(
  janela: Transcricao,
  opcoes: OpcoesDeJanela = {},
): Promise<ResultadoDaJanela> {
  garantirGateway(); // falha cedo, antes de mandar a transcrição para qualquer lugar

  const { jaPropostos = [], unica = false, ate, dossie = [], catalogo: catalogoLido } = opcoes;
  const candidatas = dossie.map((d) => d.entidade.nome_normalizado);

  if (janela.texto.trim() === "") {
    if (unica) throw new ExtracaoError("transcrição vazia — não há o que extrair");
    return {
      novos: [],
      estende: [],
      entidades: [],
      descartados: [],
      prompt_version: PROMPT_VERSION,
      modelo: "",
      prompt_version_resolucao: null,
      modelo_resolucao: null,
      catalogo: [],
      candidatas,
    };
  }

  // As regras aprovadas, ou lista vazia se ainda não há nenhuma — e também se
  // o R2 falhar. A extração nunca deixa de acontecer por causa disto: sem
  // regra, o prompt sai byte a byte igual ao de antes da slice 4.6.
  const aprovadas = await regras();

  // O que eu editei no painel de agentes, ou a base do git — e também a base se
  // o R2 falhar, pela mesma razão das regras (slice 4.7). `modeloExtracao()`
  // continua sendo quem valida o id e lê `EXTRACAO_MODEL`: o painel só
  // acrescenta uma camada acima dela.
  const meu = await efetivo("extracao", { prompt: BASE, modelo: modeloExtracao() });
  const modelo = meu.modelo;

  const versao = versaoDoPrompt(aprovadas, meu.hash);

  const anteriores = jaPropostos.map((a) => ({
    tipo: a.tipo,
    texto: a.texto,
    sobre: sobreDe(a).entidade,
  }));
  const contexto: ContextoDeJanela = { jaPropostos: anteriores, ...faixaDaJanela(janela), unica };
  const prompt = montarPrompt(janela.texto, aprovadas, meu.prompt, contexto, dossie);

  async function chamar() {
    try {
      // O rate limit do Gateway é da conta inteira (`limite.ts`). Durante a
      // gravação não há prazo e esperar é de graça; na janela do fim quem chama
      // passa o seu `ate`, porque ali a espera divide o orçamento do
      // `waitUntil` com o resto do `finalizar`.
      return await comEsperaDeLimite(
        `extracao ${modelo}`,
        () =>
          // `model` é string de propósito: id em string sai pelo Gateway. Objeto
          // de provedor furaria a porta única — ver o cabeçalho de `modelos.ts`.
          generateText({
            model: modelo,
            prompt,
            temperature: 0,
            maxOutputTokens: MAX_TOKENS_SAIDA,
          }),
        { ate },
      );
    } catch (e) {
      throw new ExtracaoError(e instanceof Error ? e.message : String(e), { cause: e });
    }
  }

  let resposta = await chamar();
  let lido;
  try {
    lido = parsearResposta(resposta.text ?? "", jaPropostos.length);
  } catch (primeira) {
    // Modelo de raciocínio às vezes gasta a saída inteira pensando e devolve
    // nada de texto. É intermitente, então uma segunda tentativa resolve o caso
    // comum; a segunda falha sobe com a resposta crua e o diagnóstico junto.
    console.error(
      `[extracao] sessão ${janela.sessao_id}: primeira tentativa sem JSON, repetindo.`,
      `${primeira instanceof Error ? primeira.message : primeira} — ${diagnostico(resposta)}`,
    );
    resposta = await chamar();
    try {
      lido = parsearResposta(resposta.text ?? "", jaPropostos.length);
    } catch (segunda) {
      // O diagnóstico da SEGUNDA resposta, que é a que de fato derrubou a
      // janela. Sobe junto com a mensagem porque quem loga o erro final é o
      // `pipeline.ts`, e lá não há mais resposta nenhuma para consultar.
      throw new ExtracaoError(
        `${segunda instanceof Error ? segunda.message : segunda} — ${diagnostico(resposta)}`,
      );
    }
  }

  const { atomos, entidades, estende, descartados } = lido;
  const modeloReal = resposta.response?.modelId ?? modelo;

  // Lê o grafo; não escreve nada nele (regra 5). O catálogo é o mesmo objeto que
  // a tela de manutenção mostra — inclusive os três campos de perfil, que são o
  // que o agente 2 usa para desambiguar. Quem montou o dossiê já o leu (4.9), e
  // reler seria pagar duas vezes pela mesma pergunta.
  const catalogo = catalogoLido ?? (await listarEntidades());
  const atribuicoes = await resolverReferencias(atomos, catalogo, { jaPropostos: anteriores });

  return {
    novos: ancorar(
      janela.sessao_id,
      atomos,
      janela,
      modeloReal,
      atribuicoes,
      versao,
      jaPropostos.length,
    ),
    estende: estende.map((e) => ({
      ref: e.ref,
      texto: e.texto,
      trechos: ancorarTrechos(e.trechos, janela),
    })),
    entidades,
    descartados,
    prompt_version: versao,
    modelo: modeloReal,
    prompt_version_resolucao: atribuicoes.prompt_version,
    modelo_resolucao: atribuicoes.modelo,
    catalogo,
    candidatas,
  };
}

/**
 * A proposta inteira num passe só. Não grava nada em lugar nenhum.
 *
 * Desde a slice 4.8 ela é **uma janela que cobre a sessão toda**, e não um
 * caminho paralelo: mesmo prompt, mesmo parser, mesma âncora. É por aqui que
 * passam o arquivo importado (um bloco só), a gravação curta demais para fechar
 * janela, e o fallback de quando alguma janela não fecha (`pipeline.ts`).
 */
export async function extrair(transcricao: Transcricao): Promise<Extracao> {
  const r = await extrairJanela(transcricao, { unica: true });

  return {
    sessao_id: transcricao.sessao_id,
    atomos: r.novos,
    entidades: agregarCandidatas(
      r.novos.flatMap((a) => [a.sobre, ...a.menciona]),
      r.catalogo,
      r.entidades,
    ),
    descartados: r.descartados,
    prompt_version: r.prompt_version,
    modelo: r.modelo,
    prompt_version_resolucao: r.prompt_version_resolucao,
    modelo_resolucao: r.modelo_resolucao,
    granularidade: transcricao.granularidade,
    criado_em: new Date().toISOString(),
  };
}
