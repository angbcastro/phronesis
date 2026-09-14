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
import { INSTRUCOES as BASE_CHAT, PROMPT_VERSION_CHAT, TETO_FERRAMENTAS } from "./chat";
import {
  INSTRUCOES_TITULO as BASE_TITULO,
  PROMPT_VERSION_TITULO,
} from "./conversas";
import {
  DIMENSAO_EMBEDDING,
  modeloCalibracao,
  modeloChat,
  modeloConfronto,
  modeloDesempate,
  modeloDuplicatas,
  modeloEmbedding,
  modeloEnriquecimento,
  modeloExtracao,
  modeloPerfil,
  modeloResolucao,
  modeloStt,
  modeloTituloChat,
  provedorAceitaVocabulario,
} from "./modelos";
import { carimbo, resolver } from "./overrides";
import type { ConfigAgentes } from "./tipos";
import type { AgenteId, QuandoRoda } from "./tipos";

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
 * Os doze. A ordem é a do fluxo, e é a que a tela usa quando lista em vez de
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
  {
    id: "chat",
    versao: PROMPT_VERSION_CHAT,
    rotulo: "chat",
    papel:
      "lê a minha pergunta, escolhe sozinho quais buscas fazer no grafo, encadeia até " +
      `${TETO_FERRAMENTAS} e escreve a resposta citando os átomos que usou`,
    quando: "sob_demanda",
    gatilho: "a cada mensagem que eu mando na barra de chat da tela inicial",
    base: BASE_CHAT,
    padrao: modeloChat,
    variavel: "CHAT_MODEL",
    modulo: "src/lib/chat.ts",
    modeloEditavel: true,
    // As duas ferramentas, e não chaves de JSON: este é o único agente cujo
    // parser é o loop de tool-calling. O que um prompt editado não pode perder
    // é justamente o nome do que ele pode chamar.
    envelope: ["buscar_atomos", "historico_do_atomo"],
  },
  {
    id: "titulo-chat",
    versao: PROMPT_VERSION_TITULO,
    rotulo: "título",
    papel: "dá nome a uma conversa a partir da primeira troca",
    quando: "sob_demanda",
    gatilho: "uma vez por conversa, assim que a primeira resposta sai",
    base: BASE_TITULO,
    padrao: modeloTituloChat,
    variavel: "CHAT_TITULO_MODEL",
    modulo: "src/lib/conversas.ts",
    modeloEditavel: true,
    envelope: ["titulo"],
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
 * Duas telas, e não um desenho só.
 *
 * **Por que duas.** O chat não escreve nada. Ele é o caminho de *sair* do
 * grafo, e estava desenhado por cima do caminho de *entrar* nele — pendurado no
 * mesmo nó `grafo`, na mesma linha dos agentes de higiene. Quem olhava separava
 * os dois com o olho, toda vez. Agora a separação é do dado: cada fluxo tem a
 * sua tela, a sua URL e a sua aba, e `tests/agentes.test.ts` cobra que nenhum
 * agente da consulta apareça no caminho de gravar.
 *
 * **Por que espinha, e não grade.** O desenho anterior era uma grade de sete
 * colunas com as setas roteadas à mão em SVG, medidas do DOM. As colunas não
 * cresceram por clareza: cresceram por pressão de um invariante geométrico —
 * aresta que pulasse uma linha atravessava a caixa do meio, então todo filho
 * novo do `grafo` exigia uma coluna nova. Foram quatro na 4.7, cinco na 4.12,
 * seis na 5, sete na 6, e `min-width: 51rem` num app que vive no celular.
 *
 * Uma espinha não tem esse problema porque não tem geometria: um passo abaixo
 * do outro, o elo entre eles é uma borda de CSS, e nada precisa ser medido.
 * O que era caixa lateral virou campo do passo, e cada campo diz uma coisa
 * diferente:
 *
 *   entradas   o que chega de fora — o vocabulário no STT, o dossiê na extração
 *   dentro     quem roda DENTRO do passo, que é mais verdadeiro do que a
 *              sequência de antes: `resolverReferencias` é chamada de dentro de
 *              `extrairJanela`, e `desempatar` de dentro dela
 *   volta      a realimentação, escrita em palavra em vez de curva pontilhada.
 *              Era o traço mais difícil de seguir do desenho antigo, e uma
 *              frase de seis palavras diz o mesmo sem cruzar o palco
 *
 * O fluxo continua sendo **dado**, e não marcação no componente, pelo motivo de
 * sempre: sistema que muda tem de quebrar um teste, não só ficar feio numa tela.
 */
export type Fluxo = "ingestao" | "consulta";

export type TipoDoPasso = "agente" | "dado" | "eu";

/** O que chega no passo sem ser o passo de cima. */
export interface Entrada {
  rotulo: string;
  nota: string;
}

/** O que este passo devolve para um passo anterior. `para` é id de passo. */
export interface Volta {
  para: string;
  rotulo: string;
}

export interface Passo {
  id: string;
  rotulo: string;
  tipo: TipoDoPasso;
  /** Preenchido só quando o passo é um agente: é o que abre o editor. */
  agente?: AgenteId;
  /** Uma linha de explicação. */
  nota?: string;
  entradas?: readonly Entrada[];
  /** Os agentes que rodam dentro deste passo. */
  dentro?: readonly Passo[];
  volta?: Volta;
}

export interface Secao {
  id: string;
  titulo: string;
  legenda: string;
  /**
   * `espinha`: um passo abaixo do outro, ligados, na ordem em que acontecem.
   * `leque`: lado a lado, todos partindo do último passo da espinha acima — é o
   * que os seis agentes de higiene são, e enfileirá-los mentiria dizendo que um
   * espera o outro.
   */
  forma: "espinha" | "leque";
  passos: readonly Passo[];
}

export interface Tela {
  fluxo: Fluxo;
  /** O rótulo curto, que vai na aba. */
  aba: string;
  titulo: string;
  legenda: string;
  secoes: readonly Secao[];
}

export const TELAS: readonly Tela[] = [
  {
    fluxo: "ingestao",
    aba: "o que entra",
    titulo: "da minha voz até o grafo",
    legenda: "o caminho de gravar, e o que roda depois que o que eu aprovei já está lá dentro",
    secoes: [
      {
        id: "ate-o-grafo",
        titulo: "até o grafo",
        legenda: "roda sozinho, do primeiro bloco de áudio até a tela de revisão",
        forma: "espinha",
        passos: [
          {
            id: "audio",
            rotulo: "áudio",
            tipo: "dado",
            nota: "blocos de 30 s, ou um arquivo importado inteiro",
          },
          {
            id: "stt",
            rotulo: "STT",
            tipo: "agente",
            agente: "stt",
            entradas: [
              { rotulo: "vocabulário", nota: "os nomes do grafo mais config/vocabulario.txt" },
            ],
          },
          {
            id: "transcricao",
            rotulo: "transcrição",
            tipo: "dado",
            nota: "no R2; no grafo vai só a chave",
          },
          {
            id: "extracao",
            rotulo: "extração",
            tipo: "agente",
            agente: "extracao",
            entradas: [
              {
                rotulo: "candidatas",
                nota: "quem o grafo acha que a janela cita, buscado por RAG",
              },
            ],
            dentro: [
              { id: "resolucao", rotulo: "resolução", tipo: "agente", agente: "resolucao" },
              { id: "desempate", rotulo: "desempate", tipo: "agente", agente: "desempate" },
            ],
          },
          {
            id: "proposta",
            rotulo: "proposta",
            tipo: "dado",
            nota: "parcial.json enquanto cresce, extracao.json no fim — nada disto está no grafo ainda",
          },
          {
            id: "revisao",
            rotulo: "revisão",
            tipo: "eu",
            nota: "eu. nada entra no grafo antes daqui",
          },
          {
            id: "grafo",
            rotulo: "grafo",
            tipo: "dado",
            nota: "átomos e entidades no Neo4j",
          },
        ],
      },
      {
        id: "depois-do-grafo",
        titulo: "depois do grafo",
        legenda:
          "partem do grafo já gravado; nenhum deles roda no meio de uma gravação, e cada um devolve alguma coisa ao caminho de cima",
        forma: "leque",
        passos: [
          {
            id: "duplicatas",
            rotulo: "duplicatas",
            tipo: "agente",
            agente: "duplicatas",
            volta: { para: "grafo", rotulo: "propõe; quem funde sou eu" },
          },
          {
            id: "perfil",
            rotulo: "perfil",
            tipo: "agente",
            agente: "perfil",
            volta: { para: "desempate", rotulo: "a ficha completa dos candidatos" },
          },
          {
            id: "enriquecimento",
            rotulo: "enriquecimento",
            tipo: "agente",
            agente: "enriquecimento",
            volta: { para: "grafo", rotulo: "escreve a ficha sozinho" },
          },
          {
            id: "embedding",
            rotulo: "embedding",
            tipo: "agente",
            agente: "embedding",
            volta: { para: "resolucao", rotulo: "candidato por sentido" },
          },
          {
            id: "confronto",
            rotulo: "confronto",
            tipo: "agente",
            agente: "confronto",
            volta: { para: "grafo", rotulo: "grava a relação sozinho" },
          },
          {
            id: "calibracao",
            rotulo: "calibração",
            tipo: "agente",
            agente: "calibracao",
            entradas: [
              { rotulo: "correções", nota: "o que a proposta dizia contra o que eu aprovei" },
            ],
            volta: { para: "extracao", rotulo: "a regra que eu aprovo entra no prompt" },
          },
        ],
      },
    ],
  },
  {
    fluxo: "consulta",
    aba: "o que sai",
    titulo: "da minha pergunta até a resposta",
    legenda: "nada nesta tela escreve no grafo: as duas ferramentas do chat são só de leitura",
    secoes: [
      {
        id: "perguntar",
        titulo: "perguntar ao grafo",
        legenda: "uma pergunta por vez, na barra da tela inicial",
        forma: "espinha",
        passos: [
          {
            id: "pergunta",
            rotulo: "pergunta",
            tipo: "dado",
            nota: "o que eu escrevo na barra da tela inicial",
          },
          {
            id: "chat",
            rotulo: "chat",
            tipo: "agente",
            agente: "chat",
            nota: `escolhe sozinho as buscas e encadeia até ${TETO_FERRAMENTAS}`,
            entradas: [
              {
                rotulo: "grafo",
                nota: "as duas buscas, só de leitura: buscar_atomos e historico_do_atomo",
              },
            ],
          },
          {
            id: "resposta",
            rotulo: "resposta",
            tipo: "dado",
            nota: "o texto citando os átomos, com o rastro de cada busca",
          },
          {
            id: "titulo-chat",
            rotulo: "título",
            tipo: "agente",
            agente: "titulo-chat",
            nota: "uma vez por conversa, na primeira troca",
          },
          {
            id: "conversa",
            rotulo: "conversa",
            tipo: "dado",
            nota: "nó leve no Neo4j; as mensagens e o rastro no R2",
          },
        ],
      },
    ],
  },
];

/** Todos os passos de uma tela, achatando os que rodam `dentro` de outro. */
export function passosDaTela(t: Tela): Passo[] {
  return t.secoes.flatMap((s) => s.passos.flatMap((p) => [p, ...(p.dentro ?? [])]));
}


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
 * Todos eles resolvidos contra a configuração, numa leitura só do índice.
 *
 * Um `resolver` por agente e um `configAgentes()` para todos: um GET por agente
 * para responder a mesma pergunta seria pagar doze vezes por um objeto só.
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
