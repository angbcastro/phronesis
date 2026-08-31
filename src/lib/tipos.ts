/** Tipos do domínio da slice 1: gravar, subir, transcrever. */

/** Duração alvo de cada bloco. É também o passo do offset absoluto. */
export const DURACAO_CHUNK_S = 30;

export const STATUS_SESSAO = [
  "gravando",
  "finalizando",
  "transcrevendo",
  "transcrito",
  "extraindo",
  "em_revisao",
  "confirmada",
  "abandonada",
  "erro",
] as const;

export type StatusSessao = (typeof STATUS_SESSAO)[number];

/** Sem bloco novo por mais que isso, a sessão é considerada abandonada. */
export const ABANDONO_MIN = 10;

export interface Sessao {
  id: string;
  iniciada_em: string;
  duracao_s: number;
  status: StatusSessao;
  audio_key: string;
  transcricao_key: string;
  chunks_total: number;
}

export interface ChunkManifest {
  i: number;
  bytes: number;
  subido_em: string;
  transcrito: boolean;
  /**
   * Extensão do áudio no R2. Ausente = `webm`, o que a gravação produz —
   * é o que mantém legível todo manifest escrito antes da importação.
   */
  ext?: string;
}

/** sessoes/<id>/manifest.json */
export interface Manifest {
  sessao_id: string;
  chunks: ChunkManifest[];
  finalizado: boolean;
}

/** Precisão dos timestamps que o provedor devolveu para o bloco. */
export type Granularidade = "palavra" | "segmento";

export interface Palavra {
  palavra: string;
  inicio: number;
  fim: number;
}

/** sessoes/<id>/chunk_NNN.json — offsets relativos ao início do bloco. */
export interface TranscricaoBloco {
  i: number;
  texto: string;
  palavras: Palavra[];
  /** Procedência: qual modelo transcreveu e com que precisão. */
  modelo: string;
  granularidade: Granularidade;
}

export interface BlocoAbsoluto {
  i: number;
  texto: string;
  offset_s: number;
}

/** sessoes/<id>/transcricao.json — offsets absolutos na sessão. */
export interface Transcricao {
  sessao_id: string;
  texto: string;
  palavras: Palavra[];
  blocos: BlocoAbsoluto[];
  modelo: string;
  granularidade: Granularidade;
}

// ─────────────────────────── Slice 2: extração ───────────────────────────

/**
 * DECISAO e ROTINA entraram na migration 003. DECISAO é o material do trabalho
 * "confrontar": mudar de ideia sobre uma decisão é o que mais vale ser
 * confrontado. ROTINA é o átomo único por sessão que colapsa a trivialidade do
 * dia — tipo próprio para poder ser filtrado para fora de uma busca por
 * aprendizado, e para dentro de "como eram meus dias em agosto".
 */
export const TIPOS_ATOMO = [
  "FATO",
  "OPINIAO",
  "SENTIMENTO",
  "APRENDIZADO",
  "CONQUISTA",
  "DECISAO",
  "ROTINA",
] as const;

export type TipoAtomo = (typeof TIPOS_ATOMO)[number];

/**
 * Label da entidade no grafo. Os três carregam sempre também `:Entidade` — a
 * constraint de `nome_normalizado` é por lá, e vale para os três de uma vez.
 */
export const TIPOS_ENTIDADE = ["Pessoa", "Projeto", "Objetivo"] as const;

export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];

// ──────────────────── Slice 4: identidade por contexto ────────────────────

/**
 * Os três campos de perfil de uma `:Entidade` (migration 005). Texto livre,
 * editado à mão em `/entidades`, e é o que o agente de resolução lê para saber
 * de quem eu estou falando.
 *
 * `fizemos_juntos` é provavelmente o melhor desambiguador dos três: atividade
 * compartilhada ("slackline no parque") é exatamente o que aparece na
 * transcrição — mais do que um rótulo de relação.
 */
export const CAMPOS_PERFIL = ["contexto", "pode_ajudar_com", "fizemos_juntos"] as const;

export type CampoPerfil = (typeof CAMPOS_PERFIL)[number];

/**
 * Teto por campo. Não é estética: os três campos de **todas** as entidades
 * entram no prompt do agente 2, então sem teto o custo daquela chamada cresce
 * junto com o grafo.
 */
export const TETO_PERFIL = 300;

/** Perfil completo. Campo ausente no grafo é lido como string vazia. */
export type Perfil = Record<CampoPerfil, string>;

export const PERFIL_VAZIO: Perfil = {
  contexto: "",
  pode_ajudar_com: "",
  fizemos_juntos: "",
};

/**
 * Uma menção do extrator já atribuída a alguém — **por menção, não por sessão**.
 *
 * É a diferença que carrega a slice 4. Até a 3, todas as menções ao mesmo nome
 * colapsavam numa candidata só, válida para a sessão inteira; isso deixa de
 * servir quando dois átomos que dizem "Rafa" podem ser duas pessoas.
 */
export interface ReferenciaResolvida {
  /** O que o extrator escreveu: "Rafa". */
  citado: string;
  /** A quem foi atribuído: o nome canônico do nó, ou o nome de uma entidade nova. */
  entidade: string;
  /** Casou com nó do grafo, ou seria criada no confirmar. */
  conhecida: boolean;
  /** `false` = o agente não teve certeza; a revisão destaca e eu decido. */
  certo: boolean;
  /** Os outros candidatos, para o seletor da revisão já abrir com eles. */
  alternativas: string[];
  /** Uma frase curta do porquê. Só é mostrada na dúvida. */
  motivo: string;
}

/**
 * "Este átomo diz algo que pertence ao perfil daquela entidade, neste campo."
 * Vira `(:Atomo)-[:PERFILA { campo }]->(:Entidade)` no confirmar (migration 005).
 *
 * `entidade` é o nome canônico, como em `ReferenciaResolvida` — a normalização
 * para `nome_normalizado` acontece no confirmar, com a mesma regra de tudo.
 */
export interface MarcaPerfil {
  entidade: string;
  campo: CampoPerfil;
}

/**
 * Como o offset do átomo foi obtido. Vai gravado junto: a tela não promete
 * mais precisão do que tem, e átomo sem âncora é o primeiro candidato a ser
 * rejeitado na revisão — trecho que não existe na transcrição costuma ser
 * afirmação que o modelo inventou.
 */
export type Ancora = "exata" | "aproximada" | "nenhuma";

/** O que o modelo devolve, antes de qualquer casamento com o áudio. */
export interface AtomoCru {
  texto: string;
  tipo: TipoAtomo;
  sobre: string;
  menciona: string[];
  /**
   * Pedaços literais da transcrição que sustentam o átomo — 1..n.
   *
   * São vários porque o átomo junta o mesmo assunto dito em momentos distintos,
   * e porque o átomo de ROTINA colapsa a trivialidade do dia inteiro. Com um
   * trecho só, ele afirmaria mais do que dá para escutar.
   */
  trechos: string[];
}

/**
 * O que o extrator propôs sobre uma entidade citada, antes de olhar o grafo.
 * Só uma dica de tipo: quem decide o que vira nó é a revisão.
 */
export interface EntidadePropostaFrase {
  nome: string;
  tipo?: unknown;
}

/** Um pedaço literal já casado com o áudio. */
export interface TrechoAncorado {
  texto: string;
  inicio_s: number | null;
  fim_s: number | null;
  ancora: Ancora;
}

/**
 * Átomo da proposta: já com offsets casados, referências atribuídas e
 * procedência (regra 7).
 *
 * `sobre` e `menciona` deixaram de ser o nome cru do extrator e passaram a ser
 * `ReferenciaResolvida` (slice 4) — o extrator continua devolvendo "Rafa", e
 * quem diz **qual** Rafa é o agente de resolução.
 *
 * Proposta gravada antes da slice 4 tem os dois como string. `referencias.ts`
 * lê os dois formatos; é o que impede a revisão de quebrar numa sessão que já
 * estava esperando (`Specs/slice-4.md` §2).
 */
export interface AtomoProposto extends Omit<AtomoCru, "trechos" | "sobre" | "menciona"> {
  /** `<sessao_id>-<índice>` — determinístico, é o que faz o MERGE ser idempotente. */
  id: string;
  indice: number;
  sobre: ReferenciaResolvida;
  menciona: ReferenciaResolvida[];
  /**
   * A proposta guarda a forma rica; o achatamento em listas paralelas
   * (`inicios_s`/`fins_s`/`ancoras`, migration 003) acontece só no confirmar,
   * porque é o grafo que não sabe guardar array de mapa.
   */
  trechos: TrechoAncorado[];
  /** O que este átomo diz do perfil de quem — vira `:PERFILA` no confirmar. */
  perfila: MarcaPerfil[];
  prompt_version: string;
  modelo: string;
}

/** Item que o modelo devolveu e o parse recusou. Nada some em silêncio. */
export interface Descarte {
  motivo: string;
  bruto: unknown;
}

/**
 * Entidade citada na sessão, já confrontada com o grafo.
 *
 * `conhecida` é o que a revisão mostra: nó que já existe versus nó que seria
 * criado. Criar entidade é decisão de quem revisa, na mesma tela.
 */
export interface EntidadeCandidata {
  /** Como aparece na sessão — ou como já está no grafo, quando conhecida. */
  nome: string;
  /** Chave única entre TODAS as entidades. É ela que impede o grafo duplicado. */
  nome_normalizado: string;
  tipo: TipoEntidade;
  conhecida: boolean;
  /** Id do nó existente; `null` quando seria criada no confirmar. */
  id: string | null;
  /** Quantos átomos desta proposta apontam para ela, como sujeito ou menção. */
  ocorrencias: number;
  /**
   * Em quantas sessões passadas ela já apareceu. É o que a revisão mostra para
   * eu decidir se vira nó: "conhecida (3 sessões)" contra "nova, citada 1x".
   * Zero para entidade que ainda não existe no grafo.
   */
  sessoes: number;
  /**
   * O extrator devolveu um pronome em vez de um nome ("ela", "esse cara"). A
   * revisão pergunta quem é e trava o confirmar até eu responder — nó chamado
   * "ela" é grafo apodrecido garantido.
   */
  precisa_nome: boolean;
}

/**
 * A proposta de extração. Vive no R2 e não no grafo: nada é gravado antes da
 * confirmação na revisão (regra 5).
 */
export interface Extracao {
  sessao_id: string;
  atomos: AtomoProposto[];
  /**
   * Visão **agregada** do que foi resolvido, uma linha por entidade. Continua
   * sendo onde eu decido se uma entidade nova vira nó; a atribuição de cada
   * menção, essa vive no átomo.
   */
  entidades: EntidadeCandidata[];
  descartados: Descarte[];
  prompt_version: string;
  modelo: string;
  /**
   * Procedência do agente de resolução (regra 7, critério 8 da slice 4).
   * `null` quando nenhuma menção precisou de julgamento — sessão sem ambiguidade
   * não chama o modelo, e registrar uma versão que não rodou seria mentira.
   */
  prompt_version_resolucao: string | null;
  modelo_resolucao: string | null;
  granularidade: Granularidade;
  criado_em: string;
}
