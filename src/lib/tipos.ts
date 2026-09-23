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
  /**
   * Quando alguém reivindicou a transcrição deste bloco (slice 8).
   *
   * É a trava que impede o `waitUntil` de `/chunks/:i/pronto` e o laço de espera
   * de `finalizarSessao` de mandarem o **mesmo** bloco ao STT e pagarem duas
   * vezes por ele — o `/finalizar` chega segundos depois do último `/pronto`, e
   * até aqui a única guarda era a existência de `chunk_NNN.json`, que só existe
   * **depois** de a transcrição voltar.
   *
   * Ausente = livre. Vence sozinho por `LEASE_BLOCO_MS`, como a janela: o
   * `waitUntil` que reivindicou pode ter morrido, e sem prazo o bloco ficaria
   * travado para sempre.
   */
  transcrevendo_em?: string;
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
 *
 * HISTORIA entrou na migration 007, e é o contrário do resto da lista: os
 * outros seis pedem a afirmação **destilada**, e ela pede o episódio **com o
 * detalhe que eu contei** — quem, onde, o que foi dito, como terminou. Sem tipo
 * próprio o detalhe não tinha onde caber: a disciplina de volume do prompt
 * ("prefira o átomo maior e mais organizado") o espremeria em uma frase, e a
 * frase é justamente o que não devolve a história um ano depois.
 *
 * Ela fica **antes** de ROTINA na lista porque ROTINA é a sobra do dia, e sobra
 * se lê por último — na tela e no prompt.
 */
export const TIPOS_ATOMO = [
  "FATO",
  "OPINIAO",
  "SENTIMENTO",
  "APRENDIZADO",
  "CONQUISTA",
  "DECISAO",
  "HISTORIA",
  "ROTINA",
] as const;

export type TipoAtomo = (typeof TIPOS_ATOMO)[number];

/**
 * Label da entidade no grafo. Os quatro carregam sempre também `:Entidade` — a
 * constraint de `nome_normalizado` é por lá, e vale para os quatro de uma vez.
 *
 * `Organizacao` entrou na migration 007: empresa, ONG, startup, escola, cliente.
 * Até ela, tudo isso caía em `:Pessoa` (o padrão de quem o extrator não
 * classifica) ou virava `:Projeto` — e as duas mentem. A Adapta não é uma
 * pessoa, e o trabalho que corre dentro dela é que é o projeto.
 *
 * **Sem acento, de propósito.** Label vai literal na string de toda consulta
 * (`atomos.ts`, `fusao.ts`) porque Neo4j não aceita label vindo de parâmetro;
 * ASCII é o que mantém aquelas strings fáceis de ler e de casar. Como aparece
 * na tela é `ROTULO_TIPO_ENTIDADE`, logo abaixo.
 */
export const TIPOS_ENTIDADE = ["Pessoa", "Projeto", "Objetivo", "Organizacao"] as const;

export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];

/**
 * Como o tipo é escrito para gente ler — na tela e nos dois prompts que listam
 * candidatos. `Organizacao` é o único em que rótulo e label divergem, e é por
 * ele que este mapa existe: `"organizacao"` num select é português errado.
 *
 * Minúsculo porque é assim que os quatro já apareciam (`t.toLowerCase()` em
 * cada `<option>`) — o mapa troca a regra pela tabela, sem mudar o que se lê
 * nos três que já existiam.
 */
export const ROTULO_TIPO_ENTIDADE: Record<TipoEntidade, string> = {
  Pessoa: "pessoa",
  Projeto: "projeto",
  Objetivo: "objetivo",
  Organizacao: "organização",
};

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

// **O `TETO_PERFIL = 300` morreu na 4.11**, e a migration 009 diz por quê. Ele
// não era estética: os três campos de **todas** as entidades entravam no prompt
// do agente 2 a cada resolução, e sem teto o custo daquela chamada crescia junto
// com o grafo. Esse consumo saiu do caminho comum — os três campos só aparecem
// na segunda passada (`desempate.ts`), para os poucos candidatos de uma menção
// em dúvida. O motivo do teto deixou de existir, e o teto com ele. Quem cobra
// tamanho agora é o `TETO_RESUMO`, do campo que entra em todo prompt.

/**
 * O **retrato de identidade** de uma entidade (migration 009, slice 4.11): quem
 * ela é para mim e, antes de tudo, o que a distingue de outra parecida.
 *
 * Teto de 500, cortado no servidor. Sem teto o custo de todo prompt passa a
 * depender do tamanho de cada ficha, e uma entidade muito falada empurra as
 * outras para fora do contexto. 300 era pouco para um retrato — e este campo
 * cobra sozinho o que antes se cobrava dos três de perfil juntos.
 *
 * Nasce vazio, e vazio é estado válido: entidade sem resumo entra no prompt com
 * nome, tipo e grafias, o agente devolve confiança baixa, e a confiança baixa é
 * o que dispara a segunda passada com o perfil inteiro.
 */
export const TETO_RESUMO = 500;

/**
 * O estado da entidade na fila de enriquecimento (migration 010, slice 4.12).
 *
 * Ele mora no **nó**, e não no navegador, e é isso que faz "fechar a aba não
 * interrompe nada" ser verdade: o elo seguinte da fila lê o banco. É também a
 * trava de idempotência da fatia (regra 4), chaveada pela entidade.
 */
export const ESTADOS_ENRIQUECIMENTO = ["na_fila", "rodando", "pronta", "falhou"] as const;

export type EstadoEnriquecimento = (typeof ESTADOS_ENRIQUECIMENTO)[number];

export const ehEstadoEnriquecimento = (v: unknown): v is EstadoEnriquecimento =>
  typeof v === "string" && (ESTADOS_ENRIQUECIMENTO as readonly string[]).includes(v);

/** O que a linha de `/entidades` mostra sobre a última rodada do lote. */
export interface Enriquecimento {
  /** `null` = nunca enriquecida. Não é erro: é o estado de toda entidade hoje. */
  estado: EstadoEnriquecimento | null;
  /** O erro, quando `falhou`. É o que aparece na própria linha. */
  motivo: string;
  /** ISO 8601 — quando o estado mudou. */
  em: string;
  /** Quantos átomos entraram na última rodada. */
  atomos: number;
  /**
   * Há uma geração anterior guardada? É o que acende o desfazer.
   *
   * **Uma geração só**, e o desfazer é uma troca: ele põe o `_anterior` de volta
   * e guarda o que estava lá. Por isso o botão não some depois de usado — o
   * pior caso de um toque acidental é outro toque.
   */
  tem_anterior: boolean;
}

/** Entidade que nunca passou pelo lote — o estado de todas elas até a 4.12. */
export const NUNCA_ENRIQUECIDA: Enriquecimento = {
  estado: null,
  motivo: "",
  em: "",
  atomos: 0,
  tem_anterior: false,
};

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
 * Os quatro tipos cujo sujeito é `eu` **por contrato do prompt da extração**:
 * "SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA → SEMPRE 'eu'". Sentimento é meu
 * por definição mesmo quando foi outra pessoa que o provocou; quem provocou vai
 * em `menciona`. História é minha porque eu a vivi — e quem a viveu comigo vai
 * em `menciona`, que é o que faz a marca de `fizemos_juntos` cair na pessoa
 * certa sem o sujeito do átomo mudar de dono.
 *
 * Mora aqui desde a 4.9 porque são dois lugares que não podem divergir: o parse
 * da extração, que recusa a chave do dossiê no sujeito desses tipos, e a
 * resolução, que recusa o julgamento que tira o sujeito de `eu`.
 */
export const TIPOS_SEMPRE_EU: readonly TipoAtomo[] = [
  "SENTIMENTO",
  "APRENDIZADO",
  "HISTORIA",
  "ROTINA",
];

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
  /**
   * Alguma janela desta proposta leu uma resposta cortada no teto de saída, e o
   * que ela trouxe é o que deu para salvar (slice 4.10).
   *
   * Existe para a revisão avisar. Não há como saber o que faltava — o modelo
   * foi interrompido, não perguntado —, e sem o aviso uma lista curta parece
   * decisão dele em vez de acidente de teto.
   *
   * Opcional, e ausente quando nada truncou: proposta gravada antes desta fatia
   * não tem o campo, e não há nada a migrar.
   */
  truncada?: boolean;
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
 * Quem produziu o que não presta.
 *
 * **Era um enum de três valores até a slice 7**, e é a mudança que abre o laço:
 * agora é o `AgenteId` do registro, mais `"grafo"`, que não é agente nenhum —
 * é higiene de grafia minha, e continua existindo porque um renome precisa de
 * um lugar para ser etiquetado sem culpar um modelo que não errou.
 *
 * O que está gravado no R2 hoje migra sozinho: `"extracao"` e `"resolucao"` já
 * são `AgenteId`, e `"grafo"` continua sendo ele mesmo. Nenhuma conversão.
 */
export type AgenteCorrecao = AgenteId | "grafo";

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
  /**
   * Do átomo da proposta, nunca do corpo (regra 7) — e **do agente que a
   * etiqueta acusa** (slice 8.1). Correção de `sujeito` ou `mencao_removida`
   * marcada como `resolucao` carrega `prompt_version_resolucao` e
   * `modelo_resolucao`; todo o resto carrega a versão da extração, que é quem
   * produziu o átomo.
   */
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
  /**
   * Os padrões vivos: rascunhados, confirmados por mim, ou já aplicados
   * (slice 7). Vivem no índice, e não na tela, para sobreviverem a eu fechar a
   * aba entre confirmar o padrão e aprovar a redação — que são dois passos e
   * duas chamadas de modelo.
   */
  padroes: Padrao[];
  /**
   * Última vez que `/calibracao` carregou de fato, **por agente** (slice 7).
   *
   * Era um só até a 7, e com o laço aberto para todos isso passou a ser erro:
   * abrir a tela de um agente zerava o relógio da sugestão de todos os outros.
   *
   * Índice gravado antes da 7 traz uma string aqui; quem lê aceita as duas
   * formas e trata a string como "visitei tudo naquele dia".
   */
  visitado_em: Partial<Record<AgenteId, string>> | string | null;
  atualizado_em: string;
}

/**
 * Teto do índice. Estourado, a eviction remove **fechadas** antes de
 * **abertas**: fechada já cumpriu o papel e o registro por sessão cobre
 * auditoria; aberta é a única que ainda importa para o `calibracao-1`.
 */
export const TETO_CORRECOES = 500;

/**
 * Um padrão que o `calibracao-2` enxergou nas minhas correções (slice 7).
 *
 * **É a `Regra` da 4.6 com outro destino.** A forma é a mesma, e de propósito:
 * `id` atribuído no rascunho e nunca editável — é ele que define "sobreviveu à
 * minha edição" —, `texto` o único campo que a tela deixa mexer, `cita` do
 * agente e imutável porque é a procedência do que o motivou.
 *
 * O que mudou é o que acontece depois. A regra virava apêndice colado antes do
 * `FORMATO`, para sempre; o padrão vira **a pauta de uma emenda**: eu confirmo
 * que ele faz sentido, o `redacao-1` decide onde no corpo do prompt aquilo
 * entra, e o padrão se aposenta com `aplicado_em` preenchido.
 */
export interface Padrao {
  id: string;
  /** De quem é o prompt que este padrão vai emendar. */
  agente: AgenteId;
  /** O único campo que a tela deixa eu editar. */
  texto: string;
  /** `Correcao.id[]` — o que motivou este padrão. Nunca menos de dois. */
  cita: string[];
  /** Qual seção do prompt corrente ele contradiz, quando for o caso. */
  substitui?: string;
  criado_em: string;
  /** `null` = rascunhado e ainda não confirmado por mim. */
  confirmado_em: string | null;
  /** O `p<hash>` do prompt que o incorporou; `null` = ainda é pauta. */
  aplicado_em: string | null;
}

/**
 * Uma regra aprovada na 4.6. **Nada mais a escreve desde a slice 7** — ela
 * sobrevive porque `calibracao/regras-<hash>.json` é imutável e um átomo
 * carimbado `extracao-9+a3f91c7d` tem de continuar resolvendo para o texto que
 * o produziu.
 */
export interface Regra {
  id: string;
  texto: string;
  cita: string[];
  substitui?: string;
  aprovada_em: string;
}

/**
 * `calibracao/regras-<hash>.json` — **imutável para sempre**, e desde a slice 7
 * só de leitura: nada mais grava um destes.
 *
 * Existe porque `prompt_version` carrega um sufixo (`extracao-9+a3f91c7d`) e um
 * hash tem que resolver para um texto: sem o snapshot, aquele carimbo apontaria
 * para uma versão de prompt que não está versionada em lugar nenhum.
 */
export interface VersaoDeRegras {
  hash: string;
  regras: Regra[];
  /** Hash da versão que esta substituiu — dá para andar para trás lendo. */
  anterior: string | null;
  criada_em: string;
}

/**
 * Quantos padrões um rascunho pode propor. **É a curadoria**, não um limite
 * técnico: mais que isto não é rascunho, é reescrita do prompt.
 */
export const MAX_PADROES_POR_RODADA = 2;

/**
 * Quantas seções uma emenda pode tocar numa rodada (slice 7).
 *
 * A amarra que define "incremental". Mais que duas seções mexidas de uma vez e
 * o que eu estou lendo não é mais uma emenda que dá para conferir — é um prompt
 * novo com cara de diff.
 */
export const MAX_SECOES_POR_EMENDA = 2;

/**
 * O que o `redacao-1` pode fazer com uma seção. **Não existe `apagar`**, e a
 * ausência é a amarra: apagar uma seção inteira do prompt é decisão minha, no
 * editor de `/agentes`, olhando o texto — não efeito colateral de um padrão que
 * eu confirmei em três segundos.
 */
export const OPERACOES_EDICAO = ["reescrever", "acrescentar", "criar"] as const;

export type OperacaoEdicao = (typeof OPERACOES_EDICAO)[number];

/**
 * Uma emenda a uma seção do prompt (slice 7).
 *
 * **O redator devolve isto, e nunca o prompt inteiro.** É o que torna
 * "incremental" uma garantia em vez de um pedido: seção que ele não nomeia
 * nunca sai do servidor, então volta byte a byte por construção. Um prompt
 * inteiro de volta exigiria confiar num diff para descobrir o que mudou — e
 * confiar que o que parece igual é igual.
 */
export interface Edicao {
  /** O cabeçalho da seção, exatamente como ele aparece no prompt corrente. */
  secao: string;
  operacao: OperacaoEdicao;
  /**
   * O corpo da seção **sem o cabeçalho**: em `reescrever` e `criar` ele
   * substitui o corpo inteiro, em `acrescentar` ele entra no fim do que já há.
   */
  texto: string;
  /** O `Padrao.id` confirmado que motiva esta edição. */
  padrao: string;
}

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
 *
 * `titulo-chat` é o primeiro id com hífen, e por isso `chavePromptAgente`
 * (`chaves.ts`) passou a aceitá-lo: o nome do agente vira caminho no R2, e o
 * que aquele validador barra é travessia de caminho, não hífen.
 */
export const AGENTE_IDS = [
  "stt",
  "extracao",
  "resolucao",
  "desempate",
  "perfil",
  "enriquecimento",
  "calibracao",
  "redacao",
  "duplicatas",
  "embedding",
  "confronto",
  "chat",
  "titulo-chat",
] as const;

export type AgenteId = (typeof AGENTE_IDS)[number];

export const ehAgenteId = (v: unknown): v is AgenteId =>
  typeof v === "string" && (AGENTE_IDS as readonly string[]).includes(v);

/**
 * O mesmo, para a etiqueta de uma `Correcao` — que aceita um valor a mais.
 *
 * Mora aqui, e não junto da `Correcao` lá em cima, por ordem de avaliação:
 * `AGENTE_IDS` é uma `const` declarada nesta seção, e uma função que a lê tem
 * de ser declarada depois dela. O tipo pode ficar lá porque tipo não é valor.
 */
export const ehAgenteCorrecao = (v: unknown): v is AgenteCorrecao =>
  v === "grafo" || ehAgenteId(v);

/**
 * Quando cada agente roda. É selo na tela, e a diferença importa para ler o
 * custo: `automatico` roda em toda sessão, `condicional` só quando o caso
 * aparece, `sob_demanda` só quando eu aperto um botão, `periodico` sozinho
 * num cron próprio — e também sob demanda, o que nenhum dos três anteriores
 * descreve sozinho (slice 5, `confronto`).
 */
export type QuandoRoda = "automatico" | "condicional" | "sob_demanda" | "periodico";

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
  /**
   * O limiar de confiança da resolução (slice 4.11), de 0 a 1. Só o agente
   * `resolucao` o usa; nos outros ele fica ausente.
   *
   * Terceiro campo ao lado dos dois, com a mesma regra: ausente = a base do git.
   * Ele mora aqui, e não numa constante de código, porque é um número para eu
   * mexer olhando a revisão, sessão real por sessão real — como os pisos das
   * camadas semânticas, e como toda avaliação de qualidade deste sistema.
   */
  limiar?: number | null;
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
 * Quanto vale a reivindicação de um bloco (slice 8).
 *
 * Mesmo número e mesmo raciocínio do `LEASE_MS` da janela: não é o tempo que um
 * bloco leva — é o tempo depois do qual vale mais arriscar pagar o STT duas
 * vezes do que deixar o bloco travado. Um bloco que tropeça no rate limit fica
 * legitimamente preso em `comEsperaDeLimite` por até ~110 s (`limite.ts`), e um
 * lease mais curto que isso liberaria o bloco exatamente enquanto alguém ainda
 * está trabalhando nele.
 *
 * O `waitUntil` que reivindicou pode ter morrido, e aí o laço de
 * `finalizarSessao` — que tem `ESPERA_MAX_MS` de 150 s — espera o lease vencer
 * antes de tentar. É a troca declarada: recuperação mais lenta no caso raro em
 * troca de não pagar o STT duas vezes no caso comum, que é o `/finalizar`
 * chegando segundos depois do último `/pronto`.
 *
 * Mora aqui, e não em `manifest.ts`, pelo mesmo motivo que `JANELA_BLOCOS`: este
 * é o módulo sem import nenhum.
 */
export const LEASE_BLOCO_MS = 120_000;

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
  /** A resposta que esta janela leu veio cortada no teto de saída (4.10). */
  truncada?: boolean;
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

// ───────── Slice 5: confrontar — relações entre átomos ao longo do tempo ─────────

/**
 * As quatro relações entre átomos que o agente `confronto` decide, sempre do
 * mais novo para o mais antigo. `ATUALIZA` substitui a afirmação anterior,
 * `CONTRADIZ` se opõe a ela, `CONFIRMA` a repete sem mudar nada, e
 * `COMPLEMENTA` acrescenta informação nova e compatível sem mudar nem repetir
 * o que já estava dito — é o meio-termo que faltava entre os três primeiros,
 * que só nomeiam "igual", "oposto" e "substituído".
 */
export const TIPOS_RELACAO_CONFRONTO = ["ATUALIZA", "CONTRADIZ", "CONFIRMA", "COMPLEMENTA"] as const;

export type TipoRelacaoConfronto = (typeof TIPOS_RELACAO_CONFRONTO)[number];

export const ehTipoRelacaoConfronto = (v: unknown): v is TipoRelacaoConfronto =>
  typeof v === "string" && (TIPOS_RELACAO_CONFRONTO as readonly string[]).includes(v);

/**
 * O estado do átomo na varredura de confronto (migration 011).
 *
 * Mais curto que o da fila de enriquecimento (`ESTADOS_ENRIQUECIMENTO`) porque
 * não há passo de enfileirar: o cron e o botão "rodar agora" processam direto
 * o que estiver pendente. `rodando` é só o *lease* que evita duas invocações
 * pegando o mesmo átomo — mesma ideia de `reivindicarProxima`, na entidade.
 * Ausente conta como nunca tentado, e é o estado de todo átomo hoje.
 */
export const ESTADOS_CONFRONTO = ["rodando", "processado", "falhou"] as const;

export type EstadoConfronto = (typeof ESTADOS_CONFRONTO)[number];

export const ehEstadoConfronto = (v: unknown): v is EstadoConfronto =>
  typeof v === "string" && (ESTADOS_CONFRONTO as readonly string[]).includes(v);

/**
 * As entidades que um átomo aponta, como o prompt do confronto as vê.
 *
 * **Sem o `"eu"`** (slice 5.1): ele é `SOBRE` em quase todo átomo de um diário,
 * e listá-lo ensinaria o modelo que "entidade em comum" é barato — que é
 * exatamente a pista falsa que se está tentando cortar. Um átomo sem entidade
 * nomeada chega ao modelo dizendo isso, e é o contraste entre os dois lados que
 * desfaz a suposição de referente.
 */
export interface EntidadesDoAtomo {
  /** O sujeito principal, quando não sou eu. */
  sobre: string[];
  /** As citadas. */
  cita: string[];
}

/**
 * Um átomo como o acervo numerado do lote o apresenta — a mesma forma para o
 * que está sendo julgado e para o que serve de candidato, porque no acervo os
 * dois papéis se misturam: um alvo de hoje é candidato do alvo de amanhã.
 */
export interface AtomoNoAcervo {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  entidades: EntidadesDoAtomo;
}

/**
 * Um átomo mais antigo, candidato a se relacionar com o que está sendo
 * processado — o resultado cru da busca vetorial, antes do agente decidir.
 */
export interface CandidatoDeConfronto extends AtomoNoAcervo {
  similaridade: number;
}

/** O que o agente decidiu para um candidato — `null` quando decidiu "nenhuma". */
export interface RelacaoDecidida {
  candidato_id: string;
  tipo: TipoRelacaoConfronto;
  confianca: number;
  motivo: string;
}

// ─────────────── Slice 6: o chat — a conversa, e o rastro da resposta ───────────────

/**
 * O nó `:Conversa` (migration 012). Metadado de aplicação, como `:Sessao`: não
 * é `:Entidade` nem `:Atomo`, e não se liga a nada do grafo de conhecimento.
 *
 * As mensagens **não** estão aqui — elas vivem em `mensagens_key`, no R2
 * (regra 2). O que o nó carrega é só o que a lista precisa para desenhar uma
 * linha e ordenar.
 */
export interface Conversa {
  id: string;
  /** Gerado pelo agente `titulo-chat`. Vazio enquanto ele não respondeu. */
  titulo: string;
  criado_em: string;
  /** Sobe a cada mensagem. É por ele que a lista ordena. */
  atualizada_em: string;
  /** ISO quando congelada; `null` = ativa. */
  arquivada_em: string | null;
  mensagens_key: string;
}

/** Quem falou. Duas partes, e uma delas sou eu — é um diário, não um grupo. */
export const PAPEIS_MENSAGEM = ["eu", "agente"] as const;

export type PapelMensagem = (typeof PAPEIS_MENSAGEM)[number];

export const ehPapelMensagem = (v: unknown): v is PapelMensagem =>
  typeof v === "string" && (PAPEIS_MENSAGEM as readonly string[]).includes(v);

/** As duas ferramentas do agente `chat`. Só leitura, as duas (regra 5). */
export const FERRAMENTAS_CHAT = ["buscar_atomos", "historico_do_atomo"] as const;

export type FerramentaChat = (typeof FERRAMENTAS_CHAT)[number];

/**
 * O que `buscar_atomos` aceita. **Todos opcionais e combináveis**, e é essa
 * composição que dispensou as quatro ferramentas de dimensão única que a
 * entrevista desenhou primeiro: "o que eu fiz, aprendi e conquistei em agosto"
 * é uma chamada, não três encadeadas à mão.
 */
export interface BuscaDeAtomos {
  /** Dispara a busca vetorial sobre `atomo_embedding` (migration 006). */
  texto?: string;
  /** Nome ou grafia de uma entidade; resolve pelo catálogo, alias incluído. */
  entidade?: string;
  /** Lista, não valor único: os tipos se somam com OU. */
  tipo?: TipoAtomo[];
  /** `AAAA-MM-DD`. Compara contra os dez primeiros caracteres de `valido_em`. */
  desde?: string;
  ate?: string;
}

/** Um átomo como as ferramentas o devolvem ao modelo e ao rastro do (i). */
export interface AtomoAchado {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  sobre: string[];
  cita: string[];
  /** Só quando a busca foi vetorial. Cosseno, como em todo o resto. */
  similaridade?: number;
}

/**
 * Quanto uma busca achou, e quanto dela mostrou (slice 9).
 *
 * **Os dois caminhos não contam a mesma coisa**, e é o detalhe que erraria
 * calado. Sem `texto`, `total` é do diário inteiro: todo átomo que passou nos
 * filtros. Com `texto`, o índice só olha `janela` vizinhos (`K_BUSCA`), e
 * `total` é quantos **desses** passaram no piso e nos filtros — escrever "8 de
 * 34" ali seria trocar um silêncio por uma mentira.
 *
 * Os campos do caminho vetorial são o que separa as três causas de uma busca
 * vazia: nada passou do piso (`acima_do_piso = 0`, e `melhor_abaixo` diz por
 * quanto), passou e o filtro cortou (`acima_do_piso > 0`, `total = 0`), ou não
 * havia nada (`janela = 0`). É também o instrumento do `PISO_BUSCA`: quem
 * decide o número sou eu, olhando isto no (i).
 */
export interface RecorteDaBusca {
  /** Quantos passaram em tudo. Os mostrados são os primeiros deles. */
  total: number;
  /** Quantos foram mostrados. */
  mostrados: number;
  /** Só com `texto`: quantos vizinhos o índice trouxe (≤ `K_BUSCA`). */
  janela?: number;
  /** Só com `texto`: quantos da janela passaram do piso, antes dos filtros. */
  acima_do_piso?: number;
  /** Só com `texto`: a melhor similaridade que ficou abaixo do piso. */
  melhor_abaixo?: number | null;
  /** O piso em vigor na busca — sai daqui para o (i) não ter de adivinhar. */
  piso?: number;
  /** A busca tinha filtro de entidade, tipo ou período. */
  filtrado?: boolean;
}

/** Um elo da cadeia que `historico_do_atomo` percorre (as relações da 011). */
export interface EloDoHistorico {
  de: string;
  para: string;
  tipo: TipoRelacaoConfronto;
  motivo: string;
  confianca: number;
}

/**
 * Uma chamada de ferramenta, inteira: o que o modelo pediu e o que voltou.
 *
 * É o material do botão (i), e ele guarda o **rastro completo** — cada chamada,
 * os parâmetros usados, e o que ela trouxe. Uma lista plana dos átomos citados
 * (o que a revisão faz) foi recusada na entrevista: com até oito chamadas
 * possíveis, saber *por que* um átomo apareceu importa mais do que saber que
 * ele apareceu.
 */
export interface PassoDeFerramenta {
  ferramenta: FerramentaChat;
  parametros: Record<string, unknown>;
  /** Os átomos que a chamada trouxe, já cortados para caber na tela. */
  achados: AtomoAchado[];
  /** Só de `historico_do_atomo`: as relações entre os átomos achados. */
  elos?: EloDoHistorico[];
  /**
   * Quanto a busca achou e quanto mostrou (slice 9). Opcional como os dois
   * abaixo: mensagem gravada antes da slice 9 continua legível sem retrofill.
   */
  recorte?: RecorteDaBusca;
  /** Quanto a ferramenta levou, do pedido à resposta (slice 9). */
  duracao_ms?: number;
  /** Preenchido quando a ferramenta falhou — o modelo recebeu isto e seguiu. */
  erro?: string;
}

/**
 * Uma mensagem da conversa, como ela vive no R2.
 *
 * `rastro`, `modelo` e `prompt_version` só existem nas do agente. Os dois
 * últimos são a regra 7 aplicada em espírito: ela fala de átomo, e uma
 * resposta escrita por LLM pede a mesma auditoria.
 */
export interface Mensagem {
  papel: PapelMensagem;
  texto: string;
  criado_em: string;
  rastro?: PassoDeFerramenta[];
  modelo?: string;
  prompt_version?: string;
}

/** `conversas/<id>/mensagens.json` — a conversa inteira, num objeto só. */
export interface MensagensDaConversa {
  conversa_id: string;
  mensagens: Mensagem[];
}

// ───────── Slice 8: o sistema se cronometra ─────────

/**
 * Os passos que o servidor cronometra, e nada além deles.
 *
 * Lista fechada de propósito. O que impede o registro de inchar não é
 * disciplina, é a forma: com uma lista, um passo novo no pipeline que ninguém
 * instrumentar é uma linha que **falta** e se vê, em vez de um campo livre que
 * cada chamador inventa à sua maneira.
 *
 *   stt           a transcrição de um bloco (n = blocos)
 *   candidatas    a busca do grafo por bloco — o RAG da 4.9
 *   catalogo      `listarEntidades()`: o Cypher com quatro OPTIONAL MATCH
 *   janela        uma janela fechando: extração + resolução + desempate
 *   espera_blocos o laço que espera os blocos pendentes, no `/finalizar`
 *   concatenar    offsets absolutos e `transcricao.json`
 *   proposta      montar `extracao.json` a partir do acumulado
 *   finalizar     o `waitUntil` inteiro do `/finalizar`, de ponta a ponta
 *   pronto        o `waitUntil` inteiro do `/chunks/:i/pronto`
 *   extrair       o `waitUntil` inteiro do `/extrair` (re-extração à mão)
 */
export const PASSOS_MEDIDOS = [
  "stt",
  "candidatas",
  "catalogo",
  "janela",
  "espera_blocos",
  "concatenar",
  "proposta",
  "finalizar",
  "pronto",
  "extrair",
] as const;

export type PassoMedido = (typeof PASSOS_MEDIDOS)[number];

export const ehPassoMedido = (v: unknown): v is PassoMedido =>
  typeof v === "string" && (PASSOS_MEDIDOS as readonly string[]).includes(v);

/**
 * Quanto um passo custou, somado. **Agregado, não uma lista de eventos** — é o
 * que dá ao objeto da sessão um tamanho máximo conhecido: dez passos, trinta
 * blocos, e o JSON não cresce com nenhum dos dois.
 *
 * `pior_ms` existe porque a soma esconde o caso ruim: trinta blocos de STT que
 * somam 60 s podem ser trinta de 2 s ou vinte e nove de 1 s e um de 31 s, e os
 * dois pedem consertos diferentes.
 */
export interface CustoDoPasso {
  n: number;
  ms: number;
  pior_ms: number;
}

/** Quanto um agente custou nesta sessão. Tokens só quando o Gateway os devolve. */
export interface CustoDoAgente {
  n: number;
  ms: number;
  entrada?: number;
  saida?: number;
}

/**
 * Uma falha, como o objeto da sessão a guarda.
 *
 * `codigo` é o que vai ao índice; `motivo` é texto livre e **fica só aqui**,
 * onde o tamanho é limitado e o objeto morre com a sessão. É exatamente onde
 * esse tipo de registro incha.
 */
export interface FalhaMedida {
  passo: PassoMedido;
  codigo: CodigoDeFalha;
  motivo: string;
  em: string;
}

/**
 * Por que uma coisa falhou, em vocabulário fechado — o que o índice guarda.
 *
 * As três primeiras são as classes de falha que o §5 já nomeia; `janela_presa`
 * é o penhasco da 4.8 (uma janela que não fechou), e `vazio` é o provedor que
 * não devolveu texto nenhum.
 */
export const CODIGOS_DE_FALHA = [
  "limite",
  "rede",
  "servico",
  "janela_presa",
  "vazio",
  "orcamento",
  "outro",
] as const;

export type CodigoDeFalha = (typeof CODIGOS_DE_FALHA)[number];

/**
 * As três marcas que só o navegador sabe dar, em epoch ms **do relógio dele**.
 *
 * O número desta fatia é `revisou - parou`: do toque em parar até a revisão
 * abrir. Ele inclui a rede de propósito — é o tempo que eu espero olhando o
 * telefone, não o que o servidor gosta de contar.
 *
 * Os três instantes vêm do mesmo relógio, então a subtração é honesta. **Nunca
 * se subtrai marca de cliente de instante de servidor**: os passos do servidor
 * são gravados como duração, nunca como carimbo, justamente para essa conta não
 * ser possível.
 */
export interface MarcasDoCliente {
  /** O toque em "parar" — ou, na importação, o arquivo aceito. */
  parou?: number;
  /** A fila de upload esvaziou e o `/finalizar` vai sair. */
  fila_vazia?: number;
  /** A revisão montou a proposta na tela. É o fim da espera. */
  revisou?: number;
}

/** Por onde o áudio entrou. Os dois caminhos compartilham o pipeline. */
export const CAMINHOS_DE_ENTRADA = ["gravacao", "importacao"] as const;

export type CaminhoDeEntrada = (typeof CAMINHOS_DE_ENTRADA)[number];

export const ehCaminhoDeEntrada = (v: unknown): v is CaminhoDeEntrada =>
  typeof v === "string" && (CAMINHOS_DE_ENTRADA as readonly string[]).includes(v);

/**
 * `sessoes/<id>/medidas.json` — o detalhe de uma sessão.
 *
 * Morre com a sessão: entra em `chavesDaSessao`, e apagar a sessão o apaga. O
 * que sobrevive é a linha dela no índice — de propósito, como a correção já
 * sobrevive ao átomo. A série não pode ganhar buraco quando eu apago uma sessão
 * de teste, e sessão de teste que foi mal não some para melhorar a média.
 */
export interface MedidasDaSessao {
  sessao_id: string;
  criado_em: string;
  atualizado_em: string;
  caminho: CaminhoDeEntrada;
  cliente: MarcasDoCliente;
  passos: Partial<Record<PassoMedido, CustoDoPasso>>;
  agentes: Partial<Record<AgenteId, CustoDoAgente>>;
  falhas: FalhaMedida[];
}

/** Texto livre de falha não pode crescer sem teto nem dentro do objeto da sessão. */
export const TETO_FALHAS_POR_SESSAO = 20;
export const TETO_MOTIVO = 300;

/**
 * Uma linha do `medidas/indice.json` — os números de manchete de uma sessão.
 *
 * **Sem texto livre.** O que vem para cá é código e contagem; o motivo fica no
 * objeto da sessão, que é limitado e some com ela.
 *
 * Todo campo aqui responde a uma pergunta que eu de fato faço: "onde foi o
 * tempo" (`espera_ms`, `fila_ms`, `servidor_ms`), "isso piorou desde a emenda"
 * (a série inteira), "quantas janelas ficaram para trás" (`codigos`). Campo sem
 * pergunta atrás é o que apodrece.
 */
export interface LinhaDeMedida {
  sessao_id: string;
  em: string;
  caminho: CaminhoDeEntrada;
  /** Quanto eu falei, em segundos — sem isso os números não se comparam. */
  duracao_s: number | null;
  /** Do toque em parar à revisão aberta. **O número da fatia.** */
  espera_ms: number | null;
  /** Parar → fila vazia: o último bloco subindo. */
  fila_ms: number | null;
  /** Fila vazia → revisão aberta: tudo que é do servidor. */
  servidor_ms: number | null;
  blocos: number;
  /**
   * Quanto cada passo do servidor custou, somado, em ms. É a resposta a "onde
   * foi o tempo" sem precisar do objeto da sessão — que morre com ela — e é o
   * que alimenta o "por passo" do resumo mensal. O `pior_ms` de cada passo fica
   * só no detalhe: no índice ele seria um campo sem pergunta atrás.
   */
  passos: Partial<Record<PassoMedido, number>>;
  /** Chamadas de modelo, somadas — a conta de "quatro chamadas para entregar uma". */
  chamadas: number;
  tokens: number | null;
  falhas: number;
  codigos: CodigoDeFalha[];
}

/** `medidas/indice.json` — uma linha por sessão, podado por teto. */
export interface IndiceDeMedidas {
  linhas: LinhaDeMedida[];
  atualizado_em: string;
}

/**
 * Quantas linhas o índice guarda.
 *
 * A uma sessão por dia, é mais de um ano de série — e o que sai daqui já está
 * no resumo do mês, que é para sempre. Mais alto que isto seria guardar duas
 * vezes a mesma coisa.
 */
export const TETO_LINHAS_MEDIDA = 400;

/** Os três números que resumem uma distribuição pequena. */
export interface Resumo {
  n: number;
  mediana: number;
  pior: number;
}

/**
 * `medidas/<AAAA-MM>.json` — o mês inteiro em um objeto, para sempre.
 *
 * Escrito pela batida diária **antes** da poda: o detalhe de março some, a linha
 * de março fica. Doze objetos por ano.
 */
export interface ResumoMensal {
  mes: string;
  gerado_em: string;
  n: number;
  espera_ms: Resumo | null;
  fila_ms: Resumo | null;
  servidor_ms: Resumo | null;
  chamadas: Resumo | null;
  passos: Partial<Record<PassoMedido, Resumo>>;
  falhas: number;
  codigos: Partial<Record<CodigoDeFalha, number>>;
}
