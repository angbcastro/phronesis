/** Tipos do domínio da slice 1: gravar, subir, transcrever. */

/** Duração alvo de cada bloco. É também o passo do offset absoluto. */
export const DURACAO_CHUNK_S = 30;

export const STATUS_SESSAO = [
  "gravando",
  "finalizando",
  "transcrevendo",
  "transcrito",
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

export const TIPOS_ATOMO = ["FATO", "OPINIAO", "SENTIMENTO", "APRENDIZADO", "CONQUISTA"] as const;

export type TipoAtomo = (typeof TIPOS_ATOMO)[number];

/**
 * Label da entidade no grafo. Os três carregam sempre também `:Entidade` — a
 * constraint de `nome_normalizado` é por lá, e vale para os três de uma vez.
 */
export const TIPOS_ENTIDADE = ["Pessoa", "Projeto", "Objetivo"] as const;

export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];

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
  /** Pedaço literal da transcrição. É o que vira `inicio_s`/`fim_s` em código. */
  trecho: string;
}

/** Átomo da proposta: já com offsets casados e procedência (regra 7). */
export interface AtomoProposto extends AtomoCru {
  /** `<sessao_id>-<índice>` — determinístico, é o que faz o MERGE ser idempotente. */
  id: string;
  indice: number;
  inicio_s: number | null;
  fim_s: number | null;
  ancora: Ancora;
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
}

/**
 * A proposta de extração. Vive no R2 e não no grafo: nada é gravado antes da
 * confirmação na revisão (regra 5).
 */
export interface Extracao {
  sessao_id: string;
  atomos: AtomoProposto[];
  entidades: EntidadeCandidata[];
  descartados: Descarte[];
  prompt_version: string;
  modelo: string;
  granularidade: Granularidade;
  criado_em: string;
}
