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
import { medirAgente } from "./medidas";
import { agregarCandidatas, apresentarEntidade, listarEntidades } from "./entidades";
import { comEsperaDeLimite, ehLimiteDeTaxa } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloExtracao,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import type { RespostaDoModelo } from "./modelos";
import { criarLocalizador } from "./offsets";
import { carimbo, efetivo } from "./overrides";
import type { Dossie } from "./recuperacao";
import { sobreDe } from "./referencias";
import { resolverReferencias } from "./resolucao";
import type { Atribuicoes } from "./resolucao";
import { normalizarNome } from "./texto";
import {
  DURACAO_CHUNK_S,
  ORCAMENTO_POR_15_MIN,
  ROTULO_TIPO_ENTIDADE,
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
 *
 * Subiu para `extracao-8` com a migration 007, e aqui `INSTRUCOES_BASE` **mudou
 * de verdade** pela primeira vez desde o `extracao-5`: o tipo HISTORIA e a
 * seção que o explica, o sujeito travado em `eu` também nele, e ORGANIZACAO na
 * lista de tipos de entidade. Átomo carimbado `extracao-7` saiu de um prompt
 * que não conhecia nenhum dos dois — é exatamente isso que o carimbo existe
 * para dizer.
 *
 * Subiu para `extracao-9` na 4.11, e é o critério do `extracao-6` de novo: o
 * texto do bloco do dossiê mudou, e a **entrada** com ele. Cada candidato
 * passou a se apresentar com `resumo`, as grafias como lista e a marca de ficha
 * oficial, no lugar do `contexto` isolado — um dos três campos de perfil, que
 * alguém escolheu em código sem que nunca se tivesse decidido que era o que
 * mais identifica uma pessoa. `INSTRUCOES_BASE` e `FORMATO` continuam sem mudar
 * um byte, e o resto do bloco das candidatas também: ele foi calibrado e
 * funciona.
 */
export const PROMPT_VERSION = "extracao-9";

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
 *
 * **E subir este número não é o conserto.** Depois da `mtgo3kaf5` ele já foi
 * subido uma vez, e a janela 0 da `mtqoeoqh3e3724514q1f` gastou os 8000
 * inteiros pensando do mesmo jeito, com 5210 tokens de entrada. O modelo enche
 * o que houver.
 *
 * O conserto também **não** é mandar o modelo pensar menos, embora se saiba
 * como (`modelos.ts`, e a medição no §4.4): o raciocínio é o que esta tarefa
 * tem de mais útil, e cortá-lo cobraria a conta na qualidade da lista — a única
 * coisa aqui que não tem teste automático. O conserto é `faltouOrcamento()` com
 * o escalonamento abaixo: cortado no pensamento, a segunda tentativa vai com o
 * dobro de teto em vez de repetir a mesma chamada. Custa uma chamada a mais nas
 * janelas em que ele pensa muito, e essa é a troca escolhida.
 */
const MAX_TOKENS_SAIDA = 8000;

/**
 * Quanto a segunda tentativa ganha de orçamento quando a primeira foi cortada
 * no meio do pensamento. Dobrar é o suficiente para o caso medido — 8000 de
 * raciocínio contra um JSON que nunca passou de algumas centenas de tokens — e
 * é uma chamada só, não uma escada.
 */
const FATOR_DE_FOLGA = 2;

/**
 * Com quanto orçamento a segunda tentativa vai.
 *
 * Separado da chamada para poder ser testado sem rede — nenhum teste deste
 * projeto simula o `generateText`, e a decisão que importa aqui é pura: ela
 * olha só o `finishReason` da primeira resposta.
 */
export function tetoDaSegundaTentativa(primeira: RespostaDoModelo): number {
  return faltouOrcamento(primeira) ? MAX_TOKENS_SAIDA * FATOR_DE_FOLGA : MAX_TOKENS_SAIDA;
}

/** Quanto da resposta crua entra na mensagem de erro. */
const AMOSTRA_ERRO = 400;

/**
 * A resposta do modelo virando lista de átomos, com o pensamento como plano B.
 *
 * Existe para os dois pontos de leitura (primeira e segunda tentativa) lerem do
 * mesmo jeito: `textoDaResposta` cai no `reasoningText` quando o modelo escreveu
 * a resposta na parte de raciocínio em vez da de texto (`modelos.ts`). O log
 * diz quando isso aconteceu — proposta tirada do pensamento merece um olhar
 * mais atento na revisão, e antes disto o caso passava calado.
 */
function ler(resposta: RespostaDoModelo, sessao_id: string, jaPropostos: number) {
  if (veioDoPensamento(resposta)) {
    console.warn(
      `[extracao] sessão ${sessao_id}: texto vazio, lendo o JSON do pensamento.`,
      diagnostico(resposta),
    );
  }
  const lido = parsearResposta(textoDaResposta(resposta), jaPropostos);

  // Log próprio, e não uma linha a mais no de cima: proposta que veio de uma
  // resposta cortada merece um olhar mais atento na revisão, e sem a linha uma
  // lista curta parece decisão do modelo em vez de acidente de teto.
  if (lido.truncada) {
    console.warn(
      `[extracao] sessão ${sessao_id}: resposta cortada, ${lido.atomos.length} átomo(s) recuperado(s).`,
      diagnostico(resposta),
    );
  }
  return lido;
}

/**
 * Qual das duas leituras vale mais: a que trouxe mais átomos.
 *
 * É a lição da sessão `mtqoeoqh3e3724514q1f`, onde a segunda chamada trouxe
 * uns dez átomos, foi descartada por estar cortada, e a terceira trouxe menos.
 * Empate fica com a íntegra: mesma colheita, e uma delas tem a lista inteira.
 *
 * Pura e exportada para ser testável sem rede — nenhum teste deste projeto
 * simula o `generateText`.
 */
export function melhorLeitura(a: RespostaExtrator, b: RespostaExtrator): RespostaExtrator {
  if (b.atomos.length > a.atomos.length) return b;
  if (b.atomos.length === a.atomos.length && a.truncada && !b.truncada) return b;
  return a;
}

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

A HISTÓRIA GUARDA O DETALHE
Quando eu conto um episódio — o que aconteceu, com quem, onde, o que foi dito, como terminou —, isso é UM átomo de tipo HISTORIA, e é o único em que o texto pode ser longo. Aqui NÃO resuma: mantenha os detalhes que eu contei, na ordem em que eu contei, porque é deles que a história vive daqui a um ano. Continua valendo COM AS MINHAS PALAVRAS — guardar o detalhe não é bordar em cima dele, e o que eu não contei não entra.
Não é HISTORIA o dia comum ("acordei, treinei, trabalhei"): isso é ROTINA. Não é HISTORIA o fato solto, sem episódio em volta ("o contrato atrasou"): isso é FATO. Se do episódio saiu uma conclusão ou um sentimento que se sustenta sozinho, ele vira átomo próprio de APRENDIZADO ou SENTIMENTO; a narrativa continua inteira na HISTORIA.

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
  HISTORIA    um episódio que eu vivi e contei com detalhe
  ROTINA      a trivialidade do dia, colapsada (no máximo um por sessão)

"sobre": exatamente uma entidade, e ela depende do tipo. Esta regra não tem exceção:
  SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA → SEMPRE "eu". Sentimento é meu por definição, mesmo quando foi outra pessoa que o provocou; quem provocou vai em "menciona". Aprendizado é meu mesmo quando é sobre outra pessoa. História é minha porque eu a vivi; quem a viveu comigo vai em "menciona".
  FATO, OPINIAO, CONQUISTA, DECISAO → o assunto de que trata: a pessoa, a organização, o projeto ou o objetivo. Só use "eu" quando não houver mesmo nenhum outro assunto.

"menciona": as OUTRAS entidades citadas, ou []. Nunca repita aqui o que já está em "sobre", e não liste "eu" num átomo que já é sobre "eu".

ENTIDADES
Devolva também "entidades": cada entidade citada uma vez só, com o tipo proposto — PESSOA, ORGANIZACAO, PROJETO ou OBJETIVO. "eu" é PESSOA. ORGANIZACAO é a instituição: empresa, ONG, startup, escola, faculdade, igreja, time, cliente, fornecedor — e não o trabalho que corre dentro dela, que é PROJETO. Só liste o que for de fato uma dessas quatro coisas; coisa que não é nenhuma delas não entra nessa lista e fica apenas dentro do texto do átomo.

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
 * O bloco do dossiê, ou string vazia (slice 4.9; a apresentação mudou na 4.11).
 *
 * **Dossiê vazio devolve `""`, e aí a chamada sai byte a byte igual à da 4.8.**
 * Grafo vazio, primeira sessão da vida do sistema, Gateway fora: tudo como
 * antes. É a disciplina que todo bloco injetado neste prompt segue — bloco
 * vazio devolve `""` —, e é o que permite cada fatia que mexe aqui ser
 * reversível olhando uma linha.
 *
 * Ele declara a chave nova **de dentro de si** — o precedente é o `estende` da
 * 4.8: quem pede um campo é quem explica o campo, e sem o bloco não há campo
 * nenhum a pedir. `INSTRUCOES_BASE` e `FORMATO` continuam intactos.
 *
 * **Como o candidato se apresenta** (4.11): chave, nome, tipo, a marca de ficha
 * oficial, as grafias **como lista** e o `resumo`. O `contexto` saiu — ele era
 * um dos três campos de perfil, escolhido em código, sem que ninguém tivesse
 * decidido que era o que mais identifica alguém. Agora a entidade tem **uma**
 * apresentação, e é a mesma que o agente 2 lê (`descrever`, em `resolucao.ts`):
 * até aqui eram duas caras da mesma entidade para dois agentes que leem o mesmo
 * trecho.
 *
 * Entidade sem resumo entra com nome, tipo e grafias e mais nada — **não há
 * fallback para o perfil**. Resumo vazio faz o agente 2 devolver confiança
 * baixa, e é a confiança baixa que dispara a segunda passada com o perfil
 * inteiro (§4.8). Até a 4.12 rodar isso vai ser a regra, e é o preço declarado.
 *
 * O resto do bloco — a explicação de que o STT erra nome próprio, o formato
 * `{"citado","chave"}`, a regra de só trocar o nome próprio e a trava de tipo —
 * fica byte a byte igual: foi calibrado e funciona.
 *
 * A amarra do fim é a que evita o pior efeito colateral possível: a lista de
 * entidades conhecidas na frente do modelo é convite para ele pendurar um
 * SENTIMENTO em alguém que não é `eu`. A frase pede; o parse recusa.
 */
export function blocoDasCandidatas(dossie: Dossie): string {
  if (dossie.length === 0) return "";

  const lista = dossie.map(({ entidade: e }) => apresentarEntidade(e)).join("\n");

  return `QUEM O DIÁRIO JÁ CONHECE
Estas entidades já existem no diário, e este trecho parece citar alguma delas. A grafia da transcrição pode estar errada: quem transcreve erra nome próprio o tempo todo — "Jean" por "Giampaolo Lepore", "Dapta" por "Adapta".
${lista}

Então, em "sobre" e em cada item de "menciona", devolva um objeto e não um nome solto:
{"citado":"<a grafia como ela aparece na transcrição>","chave":"<uma chave da lista, ou null>"}

- "citado" é sempre o que a transcrição escreveu, sem consertar nada.
- "chave" é a chave da lista quando a menção for uma delas, e null quando não for. NUNCA invente chave fora da lista acima.
- Quando você apontar uma chave, escreva no "texto" do átomo o NOME GRAVADO daquela entidade, e não o que a transcrição escreveu: se a transcrição diz "giam" e a chave é "giampaolo lepore", o texto do átomo diz "Giampaolo Lepore". **Só o nome próprio se troca** — no resto continua valendo tudo o que está acima, inclusive COM AS MINHAS PALAVRAS.
- Isto não abre exceção na regra do "sobre": SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA continuam sendo sempre de "eu", por mais que a lista acima ofereça um nome que combine com o assunto.

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
 * O prompt sem a transcrição: é ele que o painel de agentes mostra e edita, e é
 * dele que sai o hash do carimbo. `INSTRUCOES_BASE + FORMATO` **nesta ordem** é
 * o texto de origem — e, desde a slice 7, o texto que o `redacao-1` emenda
 * quando eu aprovo uma calibração.
 */
export const BASE = INSTRUCOES_BASE + FORMATO;

/**
 * O cabeçalho antes do qual os blocos de uma chamada entram.
 *
 * Enquanto as duas metades eram duas constantes, o ponto de inserção era a
 * emenda entre elas. Com o prompt editável inteiro (slice 4.7) ele passa a ser
 * um cabeçalho procurado no texto — e continua sendo exatamente o mesmo ponto:
 * depois de tudo o que instrui, antes do que descreve o envelope de saída.
 * Bloco enfiado depois do FORMATO seria lido como parte do exemplo de JSON —
 * e é a mesma razão pela qual `aplicarEdicoes` põe seção nova antes dele.
 */
const CABECALHO_FORMATO = "FORMATO\n";

/**
 * O bloco entra no lugar certo, ou no fim se o cabeçalho não estiver lá.
 *
 * Se eu renomear o cabeçalho ao editar o prompt, o bloco vai para o fim, antes
 * da transcrição — pior lugar, e ainda assim o comportamento certo: o prompt que
 * eu escrevi é o que manda, e o dossiê da janela não pode simplesmente sumir
 * porque o cabeçalho mudou de nome.
 */
export function inserirAntesDoFormato(base: string, bloco: string): string {
  if (bloco === "") return base;

  const i = base.lastIndexOf(CABECALHO_FORMATO);
  return i === -1 ? base + bloco : base.slice(0, i) + bloco + base.slice(i);
}

/**
 * O prompt de uma chamada: base + o dossiê + o bloco da janela + o texto. Os
 * dois blocos injetados entram no **mesmo** ponto, na ordem em que aparecem
 * aqui — o dossiê primeiro, porque ele é material; a janela depois, porque ela
 * é sobre esta chamada e mais nenhuma.
 *
 * **Eram três até a slice 7**, e o primeiro era o das regras aprovadas. Ele
 * saiu porque a correção deixou de virar apêndice e passou a virar emenda no
 * corpo do prompt (`redacao.ts`): o que a 4.6 colava aqui a cada chamada agora
 * está escrito dentro do texto que `efetivo("extracao", …)` devolve.
 *
 * Sem `contexto` e sem dossiê, sai byte a byte igual ao de antes da slice 4.8.
 */
export const montarPrompt = (
  texto: string,
  base: string = BASE,
  contexto?: ContextoDeJanela,
  dossie: Dossie = [],
): string =>
  inserirAntesDoFormato(
    inserirAntesDoFormato(base, blocoDasCandidatas(dossie)),
    blocoDaJanela(contexto),
  ) + texto.trim();

/**
 * A versão que vai carimbada no átomo (regra 7).
 *
 * Um sufixo só desde a slice 7 (`extracao-9+p1b2c3d4`), e não mais dois: o que
 * a 4.6 carimbava com `+a<hash>` era o apêndice de regras, que deixou de
 * existir. Carimbo de átomo antigo com os dois sufixos continua resolvendo —
 * os dois snapshots são imutáveis e os dois leitores continuam de pé.
 */
export function versaoDoPrompt(
  /** O hash do prompt em vigor (slice 4.7), ou `null` se é a base do git. */
  hashPrompt: string | null = null,
): string {
  return carimbo(PROMPT_VERSION, hashPrompt);
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

/**
 * O maior prefixo válido de um JSON cortado no meio, ou `null`.
 *
 * O modelo estoura o teto de saída no meio da lista e o que chega é um JSON sem
 * fim: dez átomos completos, o décimo primeiro pela metade. `isolarJson` acha o
 * último `}` do texto, o `JSON.parse` estoura, e os dez que estavam inteiros
 * vão para o lixo junto com o que faltava — foi o que custou duas chamadas de
 * modelo na sessão `mtqoeoqh3e3724514q1f`.
 *
 * Aqui o texto é varrido com uma máquina de estados mínima — dentro/fora de
 * string, escape, profundidade de `{}` e `[]` — guardando o índice logo depois
 * de **cada elemento completo do array de átomos**. Corta no último e fecha o
 * que ficou aberto. Sem elemento completo nenhum, devolve `null`: aí não há o
 * que salvar, e inventar `[]` seria transformar um acidente de teto numa
 * resposta legítima de lista vazia.
 *
 * **Separada de `isolarJson` de propósito.** Aquela responde "onde começa e
 * termina o JSON nesta resposta", e para um texto cortado a resposta dela está
 * certa — o problema é que não há fim. Misturar as duas perguntas faria
 * `isolarJson` mentir sobre resposta íntegra.
 *
 * O array de átomos é achado pela chave `"atomos"`, e não pelo primeiro `[` que
 * aparece: o envelope pode trazer `"entidades"` antes, e aí o primeiro `[` seria
 * o array errado. Resposta que é um array solto — o modelo às vezes devolve só
 * a lista — é ela própria o alvo.
 */
export function fecharJsonTruncado(bruto: string): string | null {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const aberturas = [semCerca.indexOf("{"), semCerca.indexOf("[")].filter((i) => i >= 0);
  if (aberturas.length === 0) return null;
  const inicio = Math.min(...aberturas);

  const pilha: string[] = [];
  /** Profundidade em que o array de átomos mora, ou -1 enquanto não achado. */
  let alvo = -1;
  /** Os fechadores do que estava aberto por fora dele, do mais interno para fora. */
  let porFora: string[] = [];
  /** Índice logo depois do último elemento que fechou inteiro. */
  let fim = -1;
  let elementos = 0;

  let emString = false;
  let escape = false;
  let inicioString = -1;
  let ultimaString = "";
  let chave = "";

  for (let i = inicio; i < semCerca.length; i++) {
    const c = semCerca[i];

    if (emString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') {
        emString = false;
        ultimaString = semCerca.slice(inicioString + 1, i);
      }
      continue;
    }

    if (c === '"') {
      emString = true;
      inicioString = i;
      continue;
    }

    if (c === ":") {
      chave = ultimaString;
      continue;
    }

    if (c === "{" || c === "[") {
      const ehOAlvo =
        c === "[" &&
        alvo < 0 &&
        (pilha.length === 0 || (pilha[pilha.length - 1] === "{" && chave === "atomos"));
      if (ehOAlvo) {
        alvo = pilha.length;
        porFora = pilha.map((a) => (a === "{" ? "}" : "]")).reverse();
      }
      pilha.push(c);
      chave = "";
      continue;
    }

    if (c === "}" || c === "]") {
      pilha.pop();
      chave = "";
      // Um elemento do array de átomos acabou de fechar.
      if (alvo >= 0 && pilha.length === alvo + 1) {
        fim = i + 1;
        elementos++;
      }
      // O próprio array fechou: daqui para a frente é outro array, e contar
      // elemento dele seria salvar a lista errada.
      if (alvo >= 0 && pilha.length === alvo) break;
      continue;
    }
  }

  if (elementos === 0 || fim < 0) return null;
  return `${semCerca.slice(inicio, fim)}]${porFora.join("")}`;
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
  /**
   * A resposta chegou cortada e o que está aqui é o que deu para salvar.
   *
   * Ausente é o caso normal — resposta íntegra —, e não `false`, para que o
   * JSON gravado no R2 continue byte a byte o de antes desta fatia enquanto
   * nada truncar.
   */
  truncada?: boolean;
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
  let truncada = false;
  try {
    cru = JSON.parse(isolarJson(bruto));
  } catch (e) {
    // Antes de desistir, o salvamento: resposta cortada no teto de saída traz
    // átomos inteiros até o ponto do corte, e jogá-los fora custou duas
    // chamadas de modelo na sessão `mtqoeoqh3e3724514q1f`. O caminho estrito
    // acima continua sendo o primeiro, e resposta íntegra nem passa por aqui.
    const salvo = fecharJsonTruncado(bruto);
    if (salvo !== null) {
      try {
        cru = JSON.parse(salvo);
        truncada = true;
      } catch {
        // Salvamento que não parseia é bug meu, não resposta ruim: cai no erro
        // de sempre, com a resposta crua junto.
      }
    }

    if (!truncada) {
      // A resposta crua vai junto: sem ela, "não é JSON" é indiagnosticável
      // depois do fato — a mesma lição que o STT já ensinou uma vez.
      const amostra = bruto.trim().slice(0, AMOSTRA_ERRO);
      throw new ExtracaoError(
        `resposta não é JSON válido: ${e instanceof Error ? e.message : String(e)}. ` +
          `Vieram ${bruto.length} caractere(s): ${amostra === "" ? "(resposta vazia)" : JSON.stringify(amostra)}`,
      );
    }
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
        // fazer o sujeito de um SENTIMENTO, APRENDIZADO, HISTORIA ou ROTINA
        // apontar para um nó do grafo. A lista de conhecidos na frente do
        // modelo é convite exatamente para isso, e o prompt pede o contrário —
        // aqui a chave cai, e o `citado` fica como veio: quem arbitra o
        // sujeito errado do extrator é a revisão, não este código.
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
    ...(truncada ? { truncada: true } : {}),
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
  /**
   * A resposta que esta janela usou veio cortada, e o que ela produziu é o que
   * deu para salvar (slice 4.10). Sobe até a revisão: uma lista curta que veio
   * de um teto estourado não é a mesma coisa que uma lista curta que o modelo
   * escolheu, e quem julga a diferença sou eu.
   */
  truncada?: boolean;
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
   * chamada sair **byte a byte igual à da 4.8** — bloco vazio devolve `""`, e é
   * o que torna toda fatia que injeta texto aqui reversível olhando uma linha.
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

  // O prompt em vigor, ou a base do git — e também a base se o R2 falhar.
  // A extração nunca deixa de acontecer por causa disto: sem override, o prompt
  // sai byte a byte igual ao do git. Desde a slice 7 esta é a **única** fonte
  // que não é o git: a emenda que a calibração aprova é gravada aqui dentro, em
  // vez de virar um apêndice colado a cada chamada. `modeloExtracao()` continua
  // sendo quem valida o id e lê `EXTRACAO_MODEL`.
  const meu = await efetivo("extracao", { prompt: BASE, modelo: modeloExtracao() });
  const modelo = meu.modelo;

  const versao = versaoDoPrompt(meu.hash);

  const anteriores = jaPropostos.map((a) => ({
    tipo: a.tipo,
    texto: a.texto,
    sobre: sobreDe(a).entidade,
  }));
  const contexto: ContextoDeJanela = { jaPropostos: anteriores, ...faixaDaJanela(janela), unica };
  const prompt = montarPrompt(janela.texto, meu.prompt, contexto, dossie);

  async function chamar(teto: number) {
    try {
      // O rate limit do Gateway é da conta inteira (`limite.ts`). Durante a
      // gravação não há prazo e esperar é de graça; na janela do fim quem chama
      // passa o seu `ate`, porque ali a espera divide o orçamento do
      // `waitUntil` com o resto do `finalizar`.
      return await comEsperaDeLimite(
        `extracao ${modelo}`,
        // A contagem vai **dentro** da espera: cada tentativa é uma ida ao
        // Gateway e custa igual, e é essa conta — quantas chamadas por sessão —
        // que a slice 8 foi medir (`medidas.ts`).
        () =>
          medirAgente("extracao", () =>
            // `model` é string de propósito: id em string sai pelo Gateway. Objeto
            // de provedor furaria a porta única — ver o cabeçalho de `modelos.ts`.
            generateText({
              model: modelo,
              prompt,
              temperature: 0,
              maxOutputTokens: teto,
              // A espera longa daqui é a única camada de retry (`limite.ts`): as
              // três tentativas rápidas que o SDK faz sozinho contra um 429 não
              // destravam nada e ainda alimentam o limite que estão esperando.
              maxRetries: 0,
            }),
          ),
        { ate },
      );
    } catch (e) {
      throw new ExtracaoError(e instanceof Error ? e.message : String(e), { cause: e });
    }
  }

  let resposta = await chamar(MAX_TOKENS_SAIDA);
  let lido: RespostaExtrator | null = null;
  let motivoDaRepeticao: string | null = null;

  try {
    lido = ler(resposta, janela.sessao_id, jaPropostos.length);
    // Salvou átomos de uma resposta cortada. Vale repetir com mais orçamento —
    // o que veio pode estar faltando o fim da lista —, mas agora **com rede**:
    // se a segunda vier pior, é a primeira que fica.
    if (lido.truncada) motivoDaRepeticao = `${lido.atomos.length} átomo(s) salvos de uma resposta cortada`;
  } catch (primeira) {
    motivoDaRepeticao = primeira instanceof Error ? primeira.message : String(primeira);
  }

  if (motivoDaRepeticao !== null) {
    // Duas causas com consertos diferentes, e a diferença está no `finishReason`
    // (`modelos.ts`). Cortado no meio do pensamento, repetir igual é
    // determinístico com `temperature: 0` — mesmo prompt, mesmo teto, mesmo
    // estouro —, então a segunda tentativa vai com o dobro de orçamento. Nos
    // outros casos ela é a de sempre, que cobre a resposta vazia intermitente.
    const faltou = faltouOrcamento(resposta);
    const teto = tetoDaSegundaTentativa(resposta);

    console.error(
      `[extracao] sessão ${janela.sessao_id}: repetindo a primeira tentativa` +
        `${faltou ? ` com teto de ${teto} (o raciocínio comeu o orçamento)` : ""}.`,
      `${motivoDaRepeticao} — ${diagnostico(resposta)}`,
    );

    const segundaResposta = await chamar(teto);
    let segundaLeitura: RespostaExtrator | null = null;
    try {
      segundaLeitura = ler(segundaResposta, janela.sessao_id, jaPropostos.length);
    } catch (segunda) {
      // Só derruba a janela se não houver nada salvo da primeira. O diagnóstico
      // da SEGUNDA resposta sobe junto com a mensagem porque quem loga o erro
      // final é o `pipeline.ts`, e lá não há mais resposta nenhuma para
      // consultar.
      if (lido === null) {
        throw new ExtracaoError(
          `${segunda instanceof Error ? segunda.message : segunda} — ${diagnostico(segundaResposta)}`,
        );
      }
      console.error(
        `[extracao] sessão ${janela.sessao_id}: segunda tentativa também sem JSON — ` +
          `fico com os ${lido.atomos.length} átomo(s) da primeira.`,
        `${segunda instanceof Error ? segunda.message : segunda} — ${diagnostico(segundaResposta)}`,
      );
    }

    if (segundaLeitura !== null) {
      const escolhida = lido === null ? segundaLeitura : melhorLeitura(lido, segundaLeitura);
      if (escolhida === segundaLeitura) resposta = segundaResposta;
      lido = escolhida;
    }
  }

  // Invariante do bloco acima: ou há leitura, ou a janela já estourou. O
  // TypeScript não a enxerga através do `try`, e afirmar com `!` esconderia um
  // caminho novo que a quebrasse.
  if (lido === null) throw new ExtracaoError("nenhuma tentativa produziu JSON");

  const { atomos, entidades, estende, descartados, truncada } = lido;
  const modeloReal = resposta.response?.modelId ?? modelo;

  // Lê o grafo; não escreve nada nele (regra 5). O catálogo é o mesmo objeto que
  // a tela de manutenção mostra — inclusive o `resumo`, que é o que o agente 2
  // usa para desambiguar desde a 4.11, e os três campos de perfil, que a segunda
  // passada lê quando a confiança fica abaixo do limiar. Quem montou o dossiê já
  // o leu (4.9), e reler seria pagar duas vezes pela mesma pergunta.
  const catalogo = catalogoLido ?? (await listarEntidades());
  const atribuicoes = await resolverReferencias(atomos, catalogo, {
    jaPropostos: anteriores,
    // O mesmo prazo da chamada de extração: desde a 4.9 o agente 2 também
    // espera o rate limit passar, e essa espera divide o orçamento de quem
    // chama — na janela do fim, o `waitUntil` do `/finalizar` (§5.3). Desde a
    // 4.11 a segunda passada divide o mesmo prazo.
    ate,
    // Só para a linha `[desempate]` do log dizer de qual sessão ela é.
    sessao_id: janela.sessao_id,
  });

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
    ...(truncada ? { truncada: true } : {}),
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
    ...(r.truncada ? { truncada: true } : {}),
  };
}
