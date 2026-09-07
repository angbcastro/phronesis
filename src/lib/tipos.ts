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
  "erro",
] as const;

export type StatusSessao = (typeof STATUS_SESSAO)[number];

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
 * Um átomo já gravado que sustenta uma sugestão — o **porquê** da camada 3b
 * (slice 4.5).
 *
 * A camada dos vizinhos herda atribuição passada: ela sugere o Raffa porque
 * átomos que já são do Raffa se parecem com este. Isso é realimentação, e o que
 * a torna aceitável é ser **um voto entre `k`, com o id na tela** — visível e
 * corrigível. Sem esta lista chegando à revisão, a camada não entra.
 */
export interface Evidencia {
  atomo_id: string;
  /** A data do átomo: "isto se parece com o que você disse em 12/ago". */
  valido_em: string;
  /** Trecho curto do texto, o bastante para eu reconhecer sem abrir nada. */
  texto: string;
  /** Cosseno com o átomo desta sessão. */
  similaridade: number;
}

/**
 * De que camada saiu a sugestão. A ordem é a da força do sinal.
 *
 * Mora aqui, e não em `resolucao.ts`, porque `ReferenciaResolvida` a carrega até
 * a revisão: a tela precisa do tipo, e ela não importa o módulo que fala com o
 * Gateway.
 *
 * `extrator` nasceu na 4.9 e vai na frente: é o nó que o **próprio extrator**
 * apontou, lendo o trecho com o dossiê do grafo na mão (`recuperacao.ts`). É o
 * sinal mais forte porque é o único que olhou a frase inteira, e é o único que
 * também mudou o texto do átomo — por isso a revisão o mostra sempre.
 */
export const CAMADAS_DE_CANDIDATO = ["extrator", "exato", "string", "perfil", "vizinhos"] as const;

export type Camada = (typeof CAMADAS_DE_CANDIDATO)[number];

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
  /**
   * Os átomos passados que elegeram esta entidade na camada dos vizinhos
   * (slice 4.5). Vazio quando quem decidiu foi string, perfil ou nada.
   *
   * Vai à revisão junto com o resto: é o que permite a tela dizer "sugeri o
   * Raffa porque isto se parece com o que você disse em 12/ago", com o trecho
   * à mão. É a condição de a camada 3b existir, não um enfeite dela.
   */
  porque: Evidencia[];
  /**
   * Qual camada achou a entidade escolhida (slice 4.8.1).
   *
   * É o que deixa a tela dizer **por que** aquele nome foi escolhido — "a
   * grafia bateu" contra "dois átomos seus votaram" são coisas muito
   * diferentes, e sem este campo o `porque` chega sem dizer se decidiu alguma
   * coisa.
   *
   * Opcional, e assim fica: proposta anterior à 4.8.1 não tem, e ausente é
   * "não sei de onde veio" — mesma degradação de `certo` e `porque`.
   */
  camada?: Camada;
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

/**
 * Uma entidade citada, como o extrator a devolve desde a slice 4.9.
 *
 * Eram duas strings — `sobre: "Jean"` — e viraram um par, porque o extrator
 * passou a receber o dossiê do que o grafo acha que aquele trecho cita
 * (`recuperacao.ts`) e agora responde as duas coisas: **o que a transcrição
 * escreveu** e **qual nó é**, quando ele reconhece um.
 *
 * `chave` é `null` quando a menção não é nenhuma das candidatas — e é sempre
 * `null` no caminho sem dossiê, que é o que faz aquele caminho continuar se
 * comportando como na 4.8. Chave que não existe no catálogo é descartada em
 * silêncio na resolução, mesma regra que o vetor já tem.
 */
export interface MencaoCrua {
  /** A grafia como ela aparece na transcrição: "Jean", "giam", "Dapta". */
  citado: string;
  /** `nome_normalizado` do nó apontado, ou `null`. */
  chave: string | null;
}

/**
 * Os três tipos cujo sujeito é `eu` **por contrato do prompt da extração**:
 * "SENTIMENTO, APRENDIZADO e ROTINA → SEMPRE 'eu'". Sentimento é meu por
 * definição mesmo quando foi outra pessoa que o provocou; quem provocou vai em
 * `menciona`.
 *
 * Mora aqui desde a 4.9 porque são dois lugares que não podem divergir: o parse
 * da extração, que recusa a chave do dossiê no sujeito desses tipos, e a
 * resolução, que recusa o julgamento que tira o sujeito de `eu`.
 */
export const TIPOS_SEMPRE_EU: readonly TipoAtomo[] = ["SENTIMENTO", "APRENDIZADO", "ROTINA"];

/** O que o modelo devolve, antes de qualquer casamento com o áudio. */
export interface AtomoCru {
  texto: string;
  tipo: TipoAtomo;
  sobre: MencaoCrua;
  menciona: MencaoCrua[];
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

// ───────── Slice 4.6: o prompt aprende com a revisão ─────────

/**
 * O que eu corrigi na revisão. Nada aqui é nota nem percentual: é o registro
 * de um gesto que hoje se perde no clique de confirmar.
 *
 * `mencao_adicionada` e `mencao_removida` são dois tipos e não um `mencao_*`
 * genérico porque a chave de uma correção de átomo é `${atomo_id}|${tipo}`
 * (spec §2): com um tipo só, acrescentar e tirar menção no mesmo átomo
 * colapsariam num registro só, e o segundo apagaria o primeiro.
 */
export const TIPOS_CORRECAO = [
  "rejeitado",
  "texto",
  "tipo",
  "sujeito",
  "mencao_adicionada",
  "mencao_removida",
  "entidade_recusada",
  "entidade_renomeada",
  "entidade_tipo",
  "faltou",
] as const;

export type TipoCorrecao = (typeof TIPOS_CORRECAO)[number];

/**
 * Quem produziu o que não presta. **Captura os três, calibra um de cada vez** —
 * esta fatia consome só `extracao`; `resolucao` e `grafo` acumulam etiquetados
 * até a fatia que os calibrar.
 */
export const AGENTES_CORRECAO = ["extracao", "resolucao", "grafo"] as const;

export type AgenteCorrecao = (typeof AGENTES_CORRECAO)[number];

/**
 * Um campo do átomo que eu toquei na tela. A chave existir **é** o gesto — o
 * valor já viaja no corpo do confirmar, e duplicá-lo aqui faria duas fontes
 * para a mesma coisa.
 */
export const CAMPOS_GESTO = ["texto", "tipo", "sobre", "menciona"] as const;

export type CampoGesto = (typeof CAMPOS_GESTO)[number];

/**
 * O que o servidor não tem como derivar sozinho: só o navegador testemunhou.
 *
 * Corpo de confirmar sem `gestos` continua confirmando — a apuração cai no que
 * dá para inferir por valor e marca `tocado: false`. Retrocompatível de
 * propósito: nenhum 400 novo nasce nesta fatia.
 */
export interface Gestos {
  /** Quais campos de cada átomo eu de fato editei. */
  atomos: { indice: number; campos: CampoGesto[] }[];
  /** Chaves das candidatas que eu desmarquei — recusa, não desuso por acaso. */
  entidades_recusadas: string[];
  /** O par original→final de um renome. O POST manda só o final. */
  renomes: { de: string; para: string }[];
  /** O que o extrator não viu e eu digitei no rodapé da revisão (spec §6). */
  faltantes: { texto: string }[];
}

export const GESTOS_VAZIOS: Gestos = {
  atomos: [],
  entidades_recusadas: [],
  renomes: [],
  faltantes: [],
};

/**
 * Uma correção minha, guardada no R2 e **nunca** no grafo.
 *
 * O grafo é o que eu vivi; correção é o que o pipeline errou. Um `:Atomo`
 * dizendo "o modelo escreveu FATO onde era OPINIAO" apareceria numa busca por
 * "o que eu aprendi" e apodreceria a coisa que o sistema existe para fazer.
 */
export interface Correcao {
  /**
   * Condicional ao tipo (spec §2):
   *
   *   átomo    `${atomo_id}|${tipo}`
   *   entidade `${sessao_id}|${tipo}|${normalizarNome(entidade)}`
   *   faltou   `${sessao_id}|faltou|${normalizarNome(texto).slice(0,40)}`
   *
   * Não é sempre `${atomo_id}|${tipo}` porque três tipos não têm átomo: com um
   * id fixo por tipo, uma correção nova apagaria a anterior em silêncio —
   * exatamente o oposto de "as correções se acumulam".
   */
  id: string;
  sessao_id: string;
  /** Só para correção de átomo. */
  atomo_id: string | null;
  /** Só para `entidade_recusada`, `entidade_renomeada`, `entidade_tipo`. */
  entidade_chave: string | null;
  agente: AgenteCorrecao;
  tipo: TipoCorrecao;
  /** "" quando eu acrescentei. */
  antes: string;
  /** "" quando eu rejeitei. */
  depois: string;
  tipo_atomo: TipoAtomo | null;
  texto_proposto: string;
  /** As âncoras, para o player da tela de calibração. */
  inicios_s: number[];
  /** Do átomo da proposta, nunca do corpo (regra 7). */
  prompt_version: string;
  modelo: string;
  /** `false` = inferida pelo valor, sem gesto que a testemunhe. */
  tocado: boolean;
  em: string;
  /** Hash da versão de regras que a endereçou; `null` = em aberto. */
  incorporada_em: string | null;
}

/**
 * `calibracao/indice.json` — a mesa de trabalho.
 *
 * Guarda as correções inteiras porque `r2.ts` não tem `LIST`: sem índice, uma
 * correção fora dele é inatingível para sempre. O corpus é esparso por
 * construção, então cabe.
 */
export interface IndiceCalibracao {
  /** Mais novas primeiro, teto de `TETO_CORRECOES`. */
  correcoes: Correcao[];
  /** Hash da versão de regras em vigor; `null` = nenhuma aprovada. */
  regras_correntes: string | null;
  /** Última vez que `/calibracao` carregou de fato. */
  visitado_em: string | null;
  atualizado_em: string;
}

/**
 * Teto do índice. Estourado, a eviction remove **fechadas** antes de
 * **abertas**: fechada já cumpriu o papel e o registro por sessão cobre
 * auditoria; aberta é a única que ainda importa para o `calibracao-1`.
 */
export const TETO_CORRECOES = 500;

/**
 * Uma regra aprovada por mim, que entra no prompt de extração a partir da
 * próxima sessão.
 *
 * `id` é atribuído no rascunho e nunca muda: é ele que define "sobreviveu à
 * minha edição". `cita` é do `calibracao-1` e imutável na tela — eu edito o
 * texto da regra, não a lista do que a motivou.
 */
export interface Regra {
  id: string;
  /** O único campo que a tela deixa eu editar. */
  texto: string;
  /** `Correcao.id[]` — o que motivou esta regra. */
  cita: string[];
  /** Qual seção do prompt base ela contradiz, quando for o caso. */
  substitui?: string;
  aprovada_em: string;
}

/**
 * `calibracao/regras-<hash>.json` — **imutável para sempre**.
 *
 * Existe porque `prompt_version` passa a carregar um sufixo (`extracao-6+a3f91c7d`)
 * e um hash tem que resolver para um texto: sem o snapshot, aquele carimbo
 * apontaria para uma versão de prompt que não está versionada em lugar nenhum.
 */
export interface VersaoDeRegras {
  hash: string;
  regras: Regra[];
  /** Hash da versão que esta substituiu — dá para andar para trás lendo. */
  anterior: string | null;
  criada_em: string;
}

/**
 * Teto de regras no prompt. **É a curadoria**, não um limite técnico: prompt
 * sem limite é exatamente como esta fatia estragaria a extração que já presta.
 */
export const MAX_REGRAS = 12;

// ───────────────────────── slice 4.7: os agentes ─────────────────────────

/**
 * Todo ponto deste sistema que fala com o Gateway, nomeado.
 *
 * Mora aqui, no módulo sem import nenhum, porque três camadas precisam do mesmo
 * id sem depender umas das outras: `overrides.ts` (que grava), cada agente (que
 * lê o override do próprio id) e `agentes.ts` (o registro que a tela mostra).
 * Se ele morasse no registro, todo agente importaria o registro, e o registro
 * importa todo agente — ciclo.
 *
 * `stt` e `embedding` estão na lista mesmo sem prompt: eles têm modelo, e o
 * painel é de tudo que sai pelo Gateway, não só do que tem texto.
 */
export const AGENTE_IDS = [
  "stt",
  "extracao",
  "resolucao",
  "perfil",
  "calibracao",
  "duplicatas",
  "embedding",
] as const;

export type AgenteId = (typeof AGENTE_IDS)[number];

export const ehAgenteId = (v: unknown): v is AgenteId =>
  typeof v === "string" && (AGENTE_IDS as readonly string[]).includes(v);

/**
 * Quando cada agente roda. É selo na tela, e a diferença importa para ler o
 * custo: `automatico` roda em toda sessão, `condicional` só quando o caso
 * aparece, `sob_demanda` só quando eu aperto um botão.
 */
export type QuandoRoda = "automatico" | "condicional" | "sob_demanda";

/**
 * O que eu editei de um agente. Ausente em qualquer campo = a base do git.
 *
 * `prompt_hash` e não o texto: o texto vive num objeto imutável próprio
 * (`config/prompt-<id>-<hash>.json`), porque é ele que um `prompt_version`
 * carimbado meses atrás precisa resolver. O índice guarda só o ponteiro.
 */
export interface OverrideDeAgente {
  prompt_hash?: string | null;
  modelo?: string | null;
  atualizado_em: string;
}

/** `config/agentes.json` — o índice inteiro, um objeto por agente tocado. */
export interface ConfigAgentes {
  overrides: Partial<Record<AgenteId, OverrideDeAgente>>;
  atualizado_em: string;
}

/**
 * `config/prompt-<id>-<hash>.json` — **imutável para sempre**, pela mesma razão
 * que `VersaoDeRegras`: o sufixo de `prompt_version` tem que resolver para um
 * texto, e um átomo de três meses atrás é quem cobra essa promessa.
 */
export interface VersaoDePrompt {
  agente: AgenteId;
  hash: string;
  texto: string;
  /** Hash do que esta substituiu, ou `null` quando veio direto da base. */
  anterior: string | null;
  criada_em: string;
}

// ───────── Slice 4.8: a extração acompanha a fala ─────────

/**
 * Quantos blocos formam uma janela de extração — 4 × 30 s = 2 min.
 *
 * O número é o meio-termo entre duas pressões opostas. Menor, a janela corta
 * frase no meio e multiplica a chamada de modelo, que é exatamente a rajada que
 * o rate limit da conta recusa (§5.3). Maior, sobra fala demais para a janela
 * do fim e a espera depois de parar volta a crescer.
 *
 * `0` desliga o caminho incremental: nenhuma janela fecha durante a gravação e
 * a sessão inteira sai num passe só, como antes desta fatia. É o botão de
 * pânico, e é por isso que ele existe.
 */
export const JANELA_BLOCOS = 4;

/**
 * De quantos átomos uma sessão de 15 min deve render — o par que o prompt base
 * anuncia. A janela pede a sua fatia disto, em proporção à própria duração.
 */
export const ORCAMENTO_POR_15_MIN = [10, 20] as const;

/**
 * Uma fatia contígua de blocos, a unidade de extração.
 *
 * `de` e `ate` são índices de bloco, ambos inclusive. A janela do fim pode ter
 * menos que `JANELA_BLOCOS` — é a única que pode.
 */
export interface Janela {
  n: number;
  de: number;
  ate: number;
}

/**
 * Em que pé está uma janela.
 *
 * `em_curso` é um *lease*: dois `waitUntil` podem chegar ao mesmo bloco, e é
 * este carimbo de tempo que impede os dois de extraírem a mesma janela — e que
 * libera a janela quando o worker que a reivindicou morreu no meio.
 */
export type EstadoDaJanela = "em_curso" | "pronta" | "falhou";

export interface EstadoJanela extends Janela {
  estado: EstadoDaJanela;
  /** ISO da última mudança. É dele que o lease vence. */
  em: string;
  /** Procedência do que esta janela produziu (regra 7). */
  prompt_version?: string;
  modelo?: string;
  prompt_version_resolucao?: string | null;
  modelo_resolucao?: string | null;
  /**
   * As chaves do dossiê que esta janela viu (slice 4.9).
   *
   * É procedência (regra 7), e é o que responde três meses depois "por que ele
   * apontou aquele nó": o dossiê é uma foto do grafo no momento da janela, e o
   * grafo de hoje não a reconstrói.
   *
   * Opcional em JSON do R2: parcial escrito antes da 4.9 não tem, e nada a
   * migrar — ausente é "esta janela rodou sem dossiê", que é o certo.
   */
  candidatas?: string[];
  /** Só em `falhou`, e é o que aparece no log `[janela]`. */
  motivo?: string;
}

/**
 * `sessoes/<id>/parcial.json` — a proposta enquanto ela ainda cresce.
 *
 * Vive no R2 e não no grafo, como `extracao.json`: nada é gravado antes da
 * confirmação na revisão (regra 5). A diferença entre os dois é o tempo — este
 * é escrito durante a gravação, aquele é montado a partir dele quando a última
 * janela fecha.
 */
export interface Parcial {
  sessao_id: string;
  janelas: EstadoJanela[];
  /** A lista acumulada, já ancorada e resolvida, na ordem em que nasceu. */
  atomos: AtomoProposto[];
  /** A dica de tipo do extrator, somada janela a janela. */
  entidades: EntidadePropostaFrase[];
  descartados: Descarte[];
  atualizado_em: string;
}

/**
 * Um átomo que a janela mandou **engordar** em vez de duplicar.
 *
 * É o mecanismo que carrega a disciplina de volume, já que não há passada de
 * costura no fim: a janela vê o que já foi proposto e continua o átomo que já
 * existe — inclusive o `ROTINA`, que é no máximo um por sessão.
 *
 * `ref` é a posição na lista acumulada que o prompt mostrou. Ela **não** mexe
 * em `sobre` nem em `menciona`: é o que mantém a resolução estritamente
 * incremental, sem retrabalho sobre átomo já atribuído.
 */
export interface Extensao {
  ref: number;
  /** A afirmação reescrita com o que a janela acrescentou. */
  texto: string;
  /** Os trechos novos, literais da janela. Somam-se aos que o átomo já tinha. */
  trechos: string[];
}
