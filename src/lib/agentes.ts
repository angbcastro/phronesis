/**
 * O registro dos agentes: tudo que fala com o Gateway, nomeado num lugar só.
 *
 * **Ele importa o prompt de cada agente; não o copia.** Duas cópias do mesmo
 * texto divergem no primeiro ajuste, e divergiriam em silêncio — a tela mostraria
 * um prompt e o modelo receberia outro, que é a falha mais cara que este painel
 * poderia ter. Por isso as constantes viraram `export` em cada módulo de agente.
 *
 * **Ele fica acima dos agentes, nunca abaixo.** Este módulo importa todos eles;
 * nenhum deles importa este. Quem cada agente consulta em tempo de execução é
 * `overrides.ts`, que não sabe que este registro existe. Invertida, a dependência
 * fecharia um ciclo, e ciclo de módulo com `const` no topo vira `undefined` em
 * tempo de execução.
 *
 * Consumidores: `GET /api/agentes` (a tela) e `tests/agentes.test.ts` (a
 * varredura que impede um agente novo de nascer fora do painel). O pipeline não
 * importa este arquivo, e não deve.
 */
import { BASE as BASE_EXTRACAO, PROMPT_VERSION as VERSAO_EXTRACAO } from "./extracao";
import { INSTRUCOES as BASE_RESOLUCAO, LIMIAR_CONFIANCA, PROMPT_VERSION_RESOLUCAO } from "./resolucao";
import { INSTRUCOES as BASE_DESEMPATE, PROMPT_VERSION_DESEMPATE } from "./desempate";
import { INSTRUCOES as BASE_PERFIL, PROMPT_VERSION_PERFIL } from "./perfil";
import {
  INSTRUCOES as BASE_ENRIQUECIMENTO,
  PROMPT_VERSION_ENRIQUECIMENTO,
} from "./enriquecimento";
import { INSTRUCOES as BASE_CALIBRACAO, PROMPT_VERSION_CALIBRACAO } from "./calibracao";
import { INSTRUCOES as BASE_DUPLICATAS, PROMPT_VERSION_DUPLICATAS } from "./duplicatas";
import {
  INSTRUCOES as BASE_CONFRONTO,
  LIMIAR_COMPLEMENTA,
  PROMPT_VERSION_CONFRONTO,
} from "./confronto";
import {
  DIMENSAO_EMBEDDING,
  modeloCalibracao,
  modeloConfronto,
  modeloDesempate,
  modeloDuplicatas,
  modeloEmbedding,
  modeloEnriquecimento,
  modeloExtracao,
  modeloPerfil,
  modeloResolucao,
  modeloStt,
  provedorAceitaVocabulario,
} from "./modelos";
import { carimbo, resolver } from "./overrides";
import type { ConfigAgentes } from "./tipos";
import type { AgenteId, QuandoRoda } from "./tipos";

/** As três faixas do desenho. `eu` tem um habitante só, e é o ponto da regra 5. */
export type Faixa = "ingestao" | "eu" | "higiene";

export interface Agente {
  id: AgenteId;
  /** O que vai no carimbo: `extracao-6`. `null` em quem não tem prompt. */
  versao: string | null;
  /** Como eu chamo na tela. */
  rotulo: string;
  /** O papel, numa frase. */
  papel: string;
  quando: QuandoRoda;
  /** Quando exatamente, em palavras — o selo sozinho não conta a história toda. */
  gatilho: string;
  /** O prompt do git. `null` em quem não tem prompt (STT, embedding). */
  base: string | null;
  /** Lido na hora: `EXTRACAO_MODEL` trocado no `.env` tem de aparecer na tela. */
  padrao: () => string;
  /** A variável de ambiente que este agente lê, para a tela dizer de onde veio. */
  variavel: string;
  /**
   * O arquivo de onde a chamada de modelo deste agente sai.
   *
   * Existe para `tests/agentes.test.ts` poder varrer `src/` e cobrar: todo
   * `generateText`/`transcribe`/`embed` do projeto tem de pertencer a um agente
   * daqui. Sem isso, um agente novo nasceria funcionando e invisível — rodando
   * em toda sessão, cobrando, e sem uma caixa no painel nem um prompt que eu
   * possa ler. Mesmo desenho de `tests/gateway.test.ts`, que varre a mesma
   * árvore para cobrar a porta única.
   */
  modulo: string;
  /** Posso trocar o modelo dele pela tela? */
  modeloEditavel: boolean;
  /** Quando não posso, por quê — a tela mostra o motivo em vez de um campo morto. */
  travado?: string;
  /**
   * As chaves que o parser deste agente exige encontrar no prompt.
   *
   * É o guarda-corpo do envelope: eu posso reescrever o prompt inteiro, mas não
   * posso salvar um que não peça o JSON que o código sabe ler. Vazio em quem não
   * tem prompt.
   */
  envelope: string[];
  /**
   * O limiar da base do git, para os agentes que têm um (slice 4.11).
   *
   * São dois, e eles medem coisas diferentes: na resolução, abaixo dele a
   * menção vai à segunda passada; no confronto (5.1), abaixo dele a relação
   * `COMPLEMENTA` é descartada em vez de gravada. Ausente em todos os outros,
   * e é essa ausência que faz a tela não desenhar um campo morto.
   */
  limiarPadrao?: number;
}

/**
 * Os dez. A ordem é a do fluxo, e é a que a tela usa quando lista em vez de
 * desenhar.
 */
export const AGENTES: readonly Agente[] = [
  {
    id: "stt",
    versao: null,
    rotulo: "STT",
    papel: "transcreve cada bloco de 30 s, com o tempo de cada palavra",
    quando: "automatico",
    gatilho: "assim que um bloco sobe, por `waitUntil` em /pronto",
    base: null,
    padrao: modeloStt,
    variavel: "STT_MODEL",
    modulo: "src/lib/stt.ts",
    modeloEditavel: true,
    envelope: [],
  },
  {
    id: "extracao",
    versao: VERSAO_EXTRACAO,
    rotulo: "extração",
    papel:
      "lê uma janela de 2 min, com o dossiê de quem o grafo acha que ela cita, e propõe os átomos já apontando o nó",
    quando: "automatico",
    gatilho: "a cada 4 blocos transcritos, durante a própria gravação",
    base: BASE_EXTRACAO,
    padrao: modeloExtracao,
    variavel: "EXTRACAO_MODEL",
    modulo: "src/lib/extracao.ts",
    modeloEditavel: true,
    envelope: ["atomos", "entidades"],
  },
  {
    id: "resolucao",
    versao: PROMPT_VERSION_RESOLUCAO,
    rotulo: "resolução",
    papel: "decide de quem eu estava falando, lendo o perfil de cada candidato",
    quando: "automatico",
    gatilho:
      "dentro da extração de cada janela, sobre toda menção que tenha candidato — desde a 4.9 nenhuma atribuição do extrator entra sem segunda opinião",
    base: BASE_RESOLUCAO,
    padrao: modeloResolucao,
    variavel: "RESOLUCAO_MODEL",
    modulo: "src/lib/resolucao.ts",
    modeloEditavel: true,
    envelope: ["referencias", "perfil"],
    limiarPadrao: LIMIAR_CONFIANCA,
  },
  {
    id: "desempate",
    versao: PROMPT_VERSION_DESEMPATE,
    rotulo: "desempate",
    papel:
      "a segunda leitura de UMA menção, com a ficha completa dos candidatos daquela menção",
    quando: "condicional",
    gatilho:
      "quando a resolução devolve confiança abaixo do limiar — enquanto os resumos estiverem vazios, isso é quase toda menção",
    base: BASE_DESEMPATE,
    padrao: modeloDesempate,
    variavel: "DESEMPATE_MODEL",
    modulo: "src/lib/desempate.ts",
    modeloEditavel: true,
    envelope: ["entidade", "duvida", "motivo"],
  },
  {
    id: "calibracao",
    versao: PROMPT_VERSION_CALIBRACAO,
    rotulo: "calibração",
    papel: "lê as minhas correções e rascunha regra nova para o prompt da extração",
    quando: "sob_demanda",
    gatilho: "botão em /calibracao",
    base: BASE_CALIBRACAO,
    padrao: modeloCalibracao,
    variavel: "CALIBRACAO_MODEL",
    modulo: "src/lib/calibracao.ts",
    modeloEditavel: true,
    envelope: ["regras", "cita"],
  },
  {
    id: "perfil",
    versao: PROMPT_VERSION_PERFIL,
    rotulo: "perfil",
    papel: "rascunha o texto de um campo de perfil a partir dos átomos marcados",
    quando: "sob_demanda",
    gatilho: "botão em /entidades",
    base: BASE_PERFIL,
    padrao: modeloPerfil,
    variavel: "PERFIL_MODEL",
    modulo: "src/lib/perfil.ts",
    modeloEditavel: true,
    envelope: ["texto"],
  },
  {
    id: "enriquecimento",
    versao: PROMPT_VERSION_ENRIQUECIMENTO,
    rotulo: "enriquecimento",
    papel:
      "escreve a ficha inteira de uma entidade a partir de TODOS os átomos que falam dela — e grava sozinho",
    quando: "sob_demanda",
    gatilho:
      "checkbox e botão em /entidades; a fila anda sozinha, um elo por entidade, sem janela aberta",
    base: BASE_ENRIQUECIMENTO,
    padrao: modeloEnriquecimento,
    variavel: "ENRIQUECIMENTO_MODEL",
    modulo: "src/lib/enriquecimento.ts",
    modeloEditavel: true,
    envelope: ["resumo", "contexto", "pode_ajudar_com", "fizemos_juntos"],
  },
  {
    id: "duplicatas",
    versao: PROMPT_VERSION_DUPLICATAS,
    rotulo: "duplicatas",
    papel: "julga se duas entidades parecidas são a mesma coisa — e só propõe",
    quando: "sob_demanda",
    gatilho: "botão em /entidades",
    base: BASE_DUPLICATAS,
    padrao: modeloDuplicatas,
    variavel: "DUPLICATAS_MODEL",
    modulo: "src/lib/duplicatas.ts",
    modeloEditavel: true,
    envelope: ["mesma", "explicacao"],
  },
  {
    id: "embedding",
    versao: null,
    rotulo: "embedding",
    papel: `dá a átomo e entidade o vetor de ${DIMENSAO_EMBEDDING} dimensões que a busca por sentido usa`,
    quando: "automatico",
    gatilho: "depois de gravar o átomo, e no refresh de entidade por hash",
    base: null,
    padrao: modeloEmbedding,
    variavel: "EMBEDDING_MODEL",
    modulo: "src/lib/embedding.ts",
    modeloEditavel: false,
    travado: `os dois índices vetoriais declaram ${DIMENSAO_EMBEDDING} dimensões na migration 006 — trocar por um modelo de outra dimensão pede DROP e migration nova, que é decisão aprovada e não toque de tela`,
    envelope: [],
  },
  {
    id: "confronto",
    versao: PROMPT_VERSION_CONFRONTO,
    rotulo: "confronto",
    papel:
      "julga um lote de átomos contra os mais antigos parecidos por vetor, com as entidades de cada um à vista, e decide se ATUALIZA, CONTRADIZ, CONFIRMA ou COMPLEMENTA — e grava sozinho",
    quando: "periodico",
    gatilho: "cron próprio (`/api/cron/confronto`) e botão \"rodar agora\" em /confronto — nunca em tempo real",
    base: BASE_CONFRONTO,
    padrao: modeloConfronto,
    variavel: "CONFRONTO_MODEL",
    modulo: "src/lib/confronto.ts",
    modeloEditavel: true,
    envelope: ["relacoes", "novo", "velho"],
    limiarPadrao: LIMIAR_COMPLEMENTA,
  },
];

export const agentePorId = (id: AgenteId): Agente | undefined =>
  AGENTES.find((a) => a.id === id);

/**
 * As chaves de envelope que faltam num texto. Vazio = pode salvar.
 *
 * Substring simples e não JSON de verdade, de propósito: o que se está checando
 * é se o prompt continua **pedindo** o formato que o parser sabe ler, e isso é
 * uma pergunta sobre o texto. Validar o JSON do exemplo seria validar um exemplo.
 */
export function envelopeFaltando(a: Agente, texto: string): string[] {
  return a.envelope.filter((chave) => !texto.includes(chave));
}

// ───────────────────────────── o desenho do fluxo ─────────────────────────────

/**
 * O fluxo é dado, e não desenho no componente, porque ele descreve o sistema —
 * e sistema que muda tem de quebrar um teste, não só ficar feio numa tela.
 *
 * A grade é **vertical**: este app vive no celular, e um canvas horizontal de
 * n8n não cabe num telefone. Cinco colunas, muitas linhas, e o que desce pelo
 * meio é o caminho principal.
 *
 * **A regra que amarra o desenho: aresta de ida liga linhas vizinhas.** O
 * roteador desenha cotovelo — desce, atravessa, desce —, e um cotovelo que pula
 * uma linha atravessa a caixa que estiver no meio do caminho. É essa regra que
 * decide o número de colunas: o `grafo` tem cinco filhos (`duplicatas`,
 * `perfil`, `enriquecimento`, `embedding`, `confronto`), eles têm de caber na
 * **mesma** linha, e a coluna que sobra é onde a calibração desce sem disputar
 * espaço com eles. Foi assim que a grade foi de três para quatro na 4.7, de
 * quatro para cinco na 4.12 — o agente 4 é o quarto filho do grafo — e de
 * cinco para seis na slice 5 — o `confronto` é o quinto.
 * `tests/agentes.test.ts` cobra o invariante. Realimentação (`volta`) é a única
 * exceção, e ela passa por fora da grade justamente por isso.
 *
 * A sexta coluna cabe porque o palco já rola na horizontal (`.palco-fluxo`):
 * quem decide a largura de cada caixa é o `min-width` do `.fluxo`, e ele cresceu
 * junto para as caixas não encolherem no telefone.
 */
export type TipoDoNo = "agente" | "dado" | "eu";

export interface NoDoFluxo {
  id: string;
  rotulo: string;
  tipo: TipoDoNo;
  /** Preenchido só quando o nó é um agente: é o que abre o editor. */
  agente?: AgenteId;
  faixa: Faixa;
  coluna: 1 | 2 | 3 | 4 | 5 | 6;
  linha: number;
  /** Uma linha de explicação, para o nó que não é agente. */
  nota?: string;
}

export interface ArestaDoFluxo {
  de: string;
  para: string;
  rotulo?: string;
  /** Realimentação: o que volta para trás no desenho. Sai pontilhada. */
  volta?: boolean;
}

export const NOS: readonly NoDoFluxo[] = [
  { id: "audio", rotulo: "áudio", tipo: "dado", faixa: "ingestao", coluna: 2, linha: 1, nota: "blocos de 30 s, ou um arquivo importado inteiro" },
  { id: "vocabulario", rotulo: "vocabulário", tipo: "dado", faixa: "ingestao", coluna: 1, linha: 2, nota: "os nomes do grafo somados a config/vocabulario.txt" },
  { id: "stt", rotulo: "STT", tipo: "agente", agente: "stt", faixa: "ingestao", coluna: 2, linha: 2 },
  { id: "transcricao", rotulo: "transcrição", tipo: "dado", faixa: "ingestao", coluna: 2, linha: 3, nota: "no R2; no grafo vai só a chave" },
  { id: "candidatas", rotulo: "candidatas", tipo: "dado", faixa: "ingestao", coluna: 1, linha: 3, nota: "quem o grafo acha que cada bloco cita — buscado por RAG, guardado no R2" },
  { id: "extracao", rotulo: "extração", tipo: "agente", agente: "extracao", faixa: "ingestao", coluna: 2, linha: 4 },
  { id: "resolucao", rotulo: "resolução", tipo: "agente", agente: "resolucao", faixa: "ingestao", coluna: 2, linha: 5 },
  { id: "desempate", rotulo: "desempate", tipo: "agente", agente: "desempate", faixa: "ingestao", coluna: 1, linha: 6 },
  { id: "proposta", rotulo: "proposta", tipo: "dado", faixa: "ingestao", coluna: 2, linha: 6, nota: "parcial.json enquanto cresce, extracao.json no fim — nada disto está no grafo ainda" },

  { id: "revisao", rotulo: "revisão", tipo: "eu", faixa: "eu", coluna: 2, linha: 7, nota: "eu. nada entra no grafo antes daqui" },

  { id: "grafo", rotulo: "grafo", tipo: "dado", faixa: "higiene", coluna: 2, linha: 8, nota: "átomos e entidades no Neo4j" },
  { id: "correcoes", rotulo: "correções", tipo: "dado", faixa: "higiene", coluna: 5, linha: 8, nota: "o que a proposta dizia contra o que eu aprovei" },

  { id: "duplicatas", rotulo: "duplicatas", tipo: "agente", agente: "duplicatas", faixa: "higiene", coluna: 1, linha: 9 },
  { id: "perfil", rotulo: "perfil", tipo: "agente", agente: "perfil", faixa: "higiene", coluna: 2, linha: 9 },
  { id: "enriquecimento", rotulo: "enriquecimento", tipo: "agente", agente: "enriquecimento", faixa: "higiene", coluna: 3, linha: 9 },
  { id: "embedding", rotulo: "embedding", tipo: "agente", agente: "embedding", faixa: "higiene", coluna: 4, linha: 9 },
  { id: "calibracao", rotulo: "calibração", tipo: "agente", agente: "calibracao", faixa: "higiene", coluna: 5, linha: 9 },
  { id: "confronto", rotulo: "confronto", tipo: "agente", agente: "confronto", faixa: "higiene", coluna: 6, linha: 9 },

  { id: "regras", rotulo: "regras", tipo: "dado", faixa: "higiene", coluna: 5, linha: 10, nota: "aprovadas por mim; entram no prompt da extração sem deploy" },
];

export const ARESTAS: readonly ArestaDoFluxo[] = [
  { de: "audio", para: "stt" },
  { de: "vocabulario", para: "stt" },
  { de: "stt", para: "transcricao" },
  { de: "transcricao", para: "candidatas", rotulo: "por bloco" },
  { de: "transcricao", para: "extracao", rotulo: "por janela de 2 min" },
  { de: "candidatas", para: "extracao", rotulo: "o dossiê da janela" },
  { de: "extracao", para: "resolucao", rotulo: "toda menção com candidato" },
  { de: "resolucao", para: "desempate", rotulo: "abaixo do limiar" },
  { de: "desempate", para: "proposta" },
  { de: "resolucao", para: "proposta" },
  { de: "proposta", para: "revisao" },
  { de: "revisao", para: "grafo", rotulo: "confirmar" },
  { de: "revisao", para: "correcoes" },
  { de: "grafo", para: "duplicatas" },
  { de: "grafo", para: "perfil" },
  { de: "grafo", para: "enriquecimento", rotulo: "todos os átomos dela" },
  { de: "grafo", para: "embedding" },
  { de: "grafo", para: "confronto", rotulo: "os mais antigos parecidos por vetor" },
  { de: "correcoes", para: "calibracao" },
  { de: "calibracao", para: "regras" },
  { de: "regras", para: "extracao", rotulo: "entram no prompt", volta: true },
  { de: "perfil", para: "desempate", rotulo: "a ficha completa", volta: true },
  { de: "embedding", para: "resolucao", rotulo: "candidato por sentido", volta: true },
  { de: "duplicatas", para: "grafo", rotulo: "propõe; quem funde sou eu", volta: true },
  // A única seta deste desenho que escreve no grafo sem passar pelo nó humano.
  // Ela é a reabertura do §4.9 desenhada: a regra 5 continua inteira porque
  // nenhum ÁTOMO entra por aqui — o que entra é a ficha da entidade.
  { de: "enriquecimento", para: "grafo", rotulo: "escreve a ficha sozinho", volta: true },
  { de: "grafo", para: "candidatas", rotulo: "quem já existe", volta: true },
  // A segunda seta que escreve no grafo sem passar pelo nó humano — mesma
  // reabertura declarada da 4.12, agora para relação entre átomos em vez de
  // ficha de entidade.
  { de: "confronto", para: "grafo", rotulo: "grava a relação sozinho", volta: true },
];


// ─────────────────────────── o retrato para a tela ───────────────────────────

/** Um agente como a tela o recebe: a base, o que está em vigor, e a diferença. */
export interface AgenteNaTela {
  id: AgenteId;
  rotulo: string;
  papel: string;
  quando: QuandoRoda;
  gatilho: string;
  variavel: string;
  modeloEditavel: boolean;
  travado?: string;
  /** O prompt do git, para eu poder comparar e para o "voltar ao original". */
  base: string | null;
  /** O que vai de fato ao modelo. Igual à base quando não editei nada. */
  prompt: string | null;
  /** O que a variável de ambiente (ou o padrão) diz, sem o meu override. */
  modeloPadrao: string;
  /** O que vai de fato ao Gateway. */
  modelo: string;
  /** A `prompt_version` efetiva, já com o sufixo. `null` em quem não carimba. */
  versao: string | null;
  promptEditado: boolean;
  modeloEditado: boolean;
  /** O limiar da base do git. `null` em quem não tem limiar — quase todos. */
  limiarPadrao: number | null;
  /** O que vale de fato. Igual ao padrão quando não editei. */
  limiar: number | null;
  limiarEditado: boolean;
  /** Só para o STT: o provedor escolhido tem canal de vocabulário? */
  aceitaVocabulario?: boolean;
}

/**
 * Os nove resolvidos contra a configuração, numa leitura só do índice.
 *
 * Um `resolver` por agente e um `configAgentes()` para todos: nove GETs para
 * responder a mesma pergunta seria pagar nove vezes por um objeto só.
 */
export async function retrato(cfg: ConfigAgentes): Promise<AgenteNaTela[]> {
  return Promise.all(
    AGENTES.map(async (a) => {
      const padrao = a.padrao();
      const e = await resolver(
        a.id,
        { prompt: a.base ?? undefined, modelo: padrao, limiar: a.limiarPadrao },
        cfg,
      );

      return {
        id: a.id,
        rotulo: a.rotulo,
        papel: a.papel,
        quando: a.quando,
        gatilho: a.gatilho,
        variavel: a.variavel,
        modeloEditavel: a.modeloEditavel,
        ...(a.travado ? { travado: a.travado } : {}),
        base: a.base,
        prompt: a.base === null ? null : e.prompt,
        modeloPadrao: padrao,
        modelo: e.modelo,
        // O carimbo aqui é só do prompt editado. A extração soma ainda o hash
        // das regras aprovadas na hora de extrair (`versaoDoPrompt`), e é lá que
        // ele tem de ser montado: só lá se sabe quais regras entraram.
        versao: a.versao === null ? null : carimbo(a.versao, e.hash),
        promptEditado: e.hash !== null,
        modeloEditado: e.modelo !== padrao,
        limiarPadrao: a.limiarPadrao ?? null,
        limiar: e.limiar ?? null,
        limiarEditado: e.limiar !== undefined && e.limiar !== a.limiarPadrao,
        ...(a.id === "stt" ? { aceitaVocabulario: provedorAceitaVocabulario(e.modelo) } : {}),
      };
    }),
  );
}
