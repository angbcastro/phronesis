"use client";

/**
 * Tela de entidades — a manutenção do grafo, e a única janela para dentro dele.
 *
 * Três coisas acontecem aqui: eu vejo o que de fato entrou (até esta tela
 * existir, a resposta só saía rodando Cypher por fora); eu conserto o que entrou
 * torto — fundo duas grafias da mesma coisa, ou dou nome a uma entidade que
 * ficou como "meu pai"; e eu escrevo a **ficha** de cada uma.
 *
 * A ficha não é enfeite: é o que os agentes leem para decidir de quem eu estou
 * falando quando dois nomes soam igual. "Raffa" e "Rapha" chegam da transcrição
 * com uma grafia só — a grafia não diz quem é, a ficha diz.
 *
 * **Desde a 4.11 ela tem quatro partes**, e a primeira é a que os dois agentes
 * leem por padrão:
 *
 *   resumo    o retrato de identidade, teto de 500. É o que entra no dossiê do
 *             extrator e no catálogo do agente 2. Nasce vazio — e desde a 4.12
 *             é o lote quem costuma preenchê-lo
 *   grafias   `aliases`, editável à mão — é o único jeito de ensinar uma grafia
 *             **antes** de o STT errar pela primeira vez, que é quando ele mais
 *             erra
 *   canônico  "esta é a ficha oficial". Sinal nos dois prompts e desempate
 *             quando dois candidatos empatam; não trava nada
 *   perfil    os três campos da 005. Saíram do caminho comum: agora só entram
 *             na segunda passada, para os candidatos de uma menção em dúvida.
 *             `fizemos juntos` continua sendo o mais forte dos três
 *
 * ## A forma da tela, e por que ela mudou
 *
 * Era uma lista em que **cada linha carregava nove controles** — caixa do lote,
 * nome, estrela, uma meta de até seis fatos, o `select` de tipo, renomear,
 * canônica e ficha — num `flex` sem `wrap`, e a ficha abria como acordeão
 * empurrando a lista para baixo. Num aparelho de 390 px, que é onde este app
 * vive, nada disso se acerta com o dedo. Hoje:
 *
 * - **a linha é um nome e uma linha de meta**, e a linha inteira é o alvo;
 * - **a ficha é um painel de tela cheia**, entrando pela direita como o editor
 *   do painel de agentes — não é navegação, é o detalhe do que eu acabei de
 *   tocar. Fecha no `←`, no véu e no `Esc`, e o foco volta para a linha;
 * - **buscar, filtrar por tipo e esconder quem já tem resumo** ficam no topo. A
 *   busca é a mesma de `catalogo.ts` — acha por trecho e atravessa alias —, e
 *   sem termo a ordem é a de **mais falada**, não a alfabética;
 * - **fundir deixou de depender do agente.** A busca de duplicatas continua
 *   existindo, mas agora qualquer duas entidades se fundem à mão, de dentro da
 *   ficha: escolher com quem, comparar as duas lado a lado, e só então dizer
 *   quem sobrevive. A rota sempre aceitou qualquer par; era a tela que só sabia
 *   propor o que a distância de string tinha aproximado;
 * - **o lote virou modo.** Sem apertar "enriquecer" não há checkbox nenhum na
 *   tela; com ele, a barra de "selecionar todas" fica **grudada no topo**
 *   enquanto eu rolo, que é o que faz marcar vinte entidades não terminar numa
 *   subida de volta até o começo da lista.
 *
 * **Não é painel da revisão**, de propósito: a revisão só enxerga as entidades
 * da sessão atual, e o orçamento dela é 60 s — "revisão longa" é uma das formas
 * de morte da visão §8. Manutenção é trabalho de outro momento, e que eu faço
 * quando quiser, ou nunca.
 *
 * Procurar duplicatas e rascunhar um perfil são botões, não coisas que
 * acontecem ao abrir: a camada que compara nomes é de graça, mas a que julga e a
 * que escreve são chamadas de modelo.
 *
 * **Desde a 4.12 esta tela dispara o lote, e ele grava sem eu aprovar campo a
 * campo** — é a única coisa daqui que escreve conteúdo sem o meu toque em cada
 * campo, e é decisão declarada (`ARCHITECTURE.md` §4.9): o atrito de aprovar
 * campo por campo é o que deixou as fichas vazias. O contrapeso é que **eu leio
 * a ficha aqui mesmo, depois**, e que o desfazer está a um toque.
 *
 * O estado da fila mora **na linha de cada entidade**, e em nenhum outro lugar:
 * a fatia recusou notificação fora do app. Enquanto houver fila, a tela relê
 * sozinha; fechar a aba não interrompe nada, só para de mostrar.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apelidoQueCasa, buscar, montarCatalogo } from "@/lib/catalogo";
import { ehPronome, normalizarNome } from "@/lib/texto";
import {
  CAMPOS_PERFIL,
  ROTULO_TIPO_ENTIDADE,
  TETO_RESUMO,
  TIPOS_ENTIDADE,
} from "@/lib/tipos";
import type { CampoPerfil, Enriquecimento, Perfil, TipoEntidade } from "@/lib/tipos";

export interface Entidade {
  id: string;
  nome: string;
  nome_normalizado: string;
  /**
   * A grafia própria e as já fundidas nela. A rota sempre devolveu o campo; a
   * tela não o declarava, e é ele que faz a busca daqui atravessar alias sem
   * uma segunda implementação de `catalogo.ts`.
   */
  chaves: string[];
  tipo: TipoEntidade;
  sessoes: number;
  atomos: number;
  aliases: string[];
  resumo: string;
  canonico: boolean;
  perfil: Perfil;
  enriquecimento: Enriquecimento;
}

interface Par {
  a: string;
  b: string;
  nome_a: string;
  nome_b: string;
  sessoes_a: number;
  sessoes_b: number;
  motivo: string;
  explicacao: string;
}

interface Rascunho {
  texto: string;
  atual: string;
  atomos: number;
  modelo: string;
}

/** O nome do campo como eu leio, não como o grafo guarda. */
const ROTULO: Record<CampoPerfil, string> = {
  contexto: "contexto",
  pode_ajudar_com: "pode ajudar com",
  fizemos_juntos: "fizemos juntos",
};

const DICA: Record<CampoPerfil, string> = {
  contexto:
    "quem é para mim — “colega de trabalho”, “amigo, mora comigo” — e o resto que valha eu ter em mente: momento de vida, situação, o que está acontecendo",
  pode_ajudar_com: "o que sabe, com o que já trabalhou",
  fizemos_juntos: "o que já vivemos juntos — o melhor desambiguador dos três",
};

const PERFIL_VAZIO: Perfil = { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" };

/** O mesmo do corredor: rápido o bastante para parecer vivo, e barato. */
const INTERVALO_FILA_MS = 4000;

/** O mesmo número da transição do painel no CSS. Ver `fechar()`. */
const DURACAO_FICHA_MS = 220;

/** Quantas candidatas a fusão a lista mostra. O mesmo teto do `SeletorEntidade`. */
const TETO_CANDIDATAS = 12;

/** Só a data. A hora não muda o que eu faço, e a linha já é longa. */
const dia = (iso: string) => (iso === "" ? "" : iso.slice(0, 10).split("-").reverse().join("/"));

/**
 * O estado do lote **na própria linha** — a fatia decidiu que nenhum aviso mora
 * fora desta tela. Notificação de PWA seria o único canal que me alcança com o
 * app fechado, e seria o primeiro uso de push neste sistema: recusado por agora.
 *
 * `null` (nunca enriquecida) não vira selo nenhum: é o estado de quase todo o
 * grafo, e um selo em toda linha não informa nada.
 */
export function selo(e: Enriquecimento): string {
  if (e.estado === "na_fila") return " · na fila";
  if (e.estado === "rodando") return " · enriquecendo…";
  if (e.estado === "falhou") return ` · falhou: ${e.motivo || "sem motivo registrado"}`;
  if (e.estado === "pronta") {
    return e.atomos === 0
      ? ` · sem átomo para ler${e.em === "" ? "" : ` em ${dia(e.em)}`}`
      : ` · ficha de ${e.atomos} átomo(s)${e.em === "" ? "" : ` em ${dia(e.em)}`}`;
  }
  return "";
}

export interface Peneira {
  termo: string;
  tipo: TipoEntidade | "todas";
  semResumo: boolean;
}

/**
 * O que a lista mostra: busca, filtro de tipo, "só as sem resumo", e a ordem.
 *
 * O casamento é o de `catalogo.ts` — `buscar` acha por trecho no meio da
 * palavra e atravessa alias, que é o único jeito de "Rapha" achar a entidade
 * que hoje se chama "Raffael". Reimplementar isso aqui criaria uma segunda
 * regra de busca para divergir da primeira; o que esta função faz por cima é
 * reencontrar o objeto inteiro (o catálogo carrega só o subconjunto que a
 * revisão usa) e decidir a ordem.
 *
 * **Sem termo, a ordem é a de mais falada.** A rota devolve canônico primeiro,
 * depois sessões — boa para desempate de agente, ruim para eu procurar com o
 * olho: o que eu quero ver em cima é o que eu mais falo. **Com termo, quem
 * manda é a relevância** de `porRelevancia` (prefixo antes de trecho no meio);
 * reordenar por volume ali jogaria o casamento exato para o meio da lista.
 */
export function peneirar(lista: Entidade[], { termo, tipo, semResumo }: Peneira): Entidade[] {
  const porChave = new Map(lista.map((e) => [e.nome_normalizado, e]));
  const achadas = buscar(montarCatalogo(lista), termo, tipo)
    .map((c) => porChave.get(c.nome_normalizado))
    .filter((e): e is Entidade => e !== undefined);

  const restantes = semResumo ? achadas.filter((e) => e.resumo === "") : achadas;

  return normalizarNome(termo) === ""
    ? [...restantes].sort((a, b) => b.atomos - a.atomos || a.nome.localeCompare(b.nome))
    : restantes;
}

/**
 * Com quem esta entidade pode ser fundida.
 *
 * A própria sai da lista antes da busca, e não depois: `fundir` recusa a
 * auto-fusão no servidor (`fusao.ts`), mas oferecer na tela um botão que só
 * existe para dar erro é pior que não oferecer.
 */
export function candidatasParaFundir(
  lista: Entidade[],
  alvo: Entidade,
  termo: string,
): Entidade[] {
  const outras = lista.filter((e) => e.nome_normalizado !== alvo.nome_normalizado);
  const porChave = new Map(outras.map((e) => [e.nome_normalizado, e]));
  return buscar(montarCatalogo(outras), termo, "todas")
    .map((c) => porChave.get(c.nome_normalizado))
    .filter((e): e is Entidade => e !== undefined)
    .slice(0, TETO_CANDIDATAS);
}

/** Os três passos da fusão à mão. `alvo` nulo é o passo de escolher com quem. */
interface Fusao {
  termo: string;
  alvo: string | null;
}

export function Entidades() {
  const [entidades, setEntidades] = useState<Entidade[] | null>(null);
  const [pares, setPares] = useState<Par[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");

  /** O topo da lista: o que eu vejo, e em que ordem. */
  const [termo, setTermo] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<TipoEntidade | "todas">("todas");
  const [semResumo, setSemResumo] = useState(false);

  /** Semear um nome: o formulário só aparece quando eu peço. */
  const [criando, setCriando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [tipoNovo, setTipoNovo] = useState<TipoEntidade>("Pessoa");

  /**
   * A ficha: quem ela mostra (`foco`) e se está na tela (`aberta`).
   *
   * São dois estados e não um porque o painel precisa **sobreviver ao fechar**
   * pelos 220 ms da transição — desmontar junto com a classe esvaziaria a caixa
   * no meio do caminho de volta, que é o corte que o `.chat` já aprendeu a não
   * fazer.
   */
  const [foco, setFoco] = useState<string | null>(null);
  const [aberta, setAberta] = useState(false);

  /** O modo do lote. Sem ele, nenhuma caixa de seleção existe na tela. */
  const [selecionando, setSelecionando] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  /** O que está no textarea, por `chave|campo`. Ausente = o que veio do grafo. */
  const [textos, setTextos] = useState<Record<string, string>>({});
  /** O que o agente 3 propôs, por `chave|campo`. Nunca entra por cima do atual. */
  const [propostas, setPropostas] = useState<Record<string, Rascunho>>({});
  /** A grafia que estou digitando para acrescentar, por chave de entidade. */
  const [grafiaNova, setGrafiaNova] = useState<Record<string, string>>({});
  /** A fusão à mão em curso, se houver. */
  const [fusao, setFusao] = useState<Fusao | null>(null);

  const idBusca = useId();
  const idFusao = useId();
  const idFicha = useId();
  const painel = useRef<HTMLElement | null>(null);
  /** A linha que abriu a ficha — é para ela que o foco volta ao fechar. */
  const linhaTocada = useRef<HTMLButtonElement | null>(null);

  const carregar = useCallback(async () => {
    // `?perfil=1`: esta é a tela que edita os três campos. A revisão não pede,
    // e por isso não baixa o campo mais pesado da resposta (4.8.1).
    const r = await fetch("/api/entidades?perfil=1", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) {
      setFalha("não deu para ler o grafo");
      return;
    }
    setEntidades(((await r.json()) as { entidades: Entidade[] }).entidades);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Enquanto houver fila, a tela relê sozinha.
   *
   * **É o único aviso que esta fatia dá**, e é por decisão: notificação de PWA
   * seria o primeiro uso de push neste sistema, e a informação mora onde a ação
   * foi disparada. Fechar a aba não interrompe a fila — só para de mostrar o
   * que ela está fazendo, e voltar aqui reencontra o estado no grafo.
   *
   * O intervalo é o do corredor (`Processando`), e o efeito se desliga sozinho
   * quando a última linha sai de `na fila` ou `enriquecendo`.
   */
  const andando = (entidades ?? []).some(
    (e) => e.enriquecimento.estado === "na_fila" || e.enriquecimento.estado === "rodando",
  );

  useEffect(() => {
    if (!andando) return;
    const t = setInterval(() => void carregar(), INTERVALO_FILA_MS);
    return () => clearInterval(t);
  }, [andando, carregar]);

  const todas = entidades ?? [];
  const mostradas = useMemo(
    () => peneirar(todas, { termo, tipo: tipoFiltro, semResumo }),
    [todas, termo, tipoFiltro, semResumo],
  );

  const emFoco = foco === null ? null : (todas.find((e) => e.nome_normalizado === foco) ?? null);
  const alvoDaFusao =
    fusao?.alvo == null ? null : (todas.find((e) => e.nome_normalizado === fusao.alvo) ?? null);
  const candidatas = useMemo(
    () => (emFoco && fusao ? candidatasParaFundir(todas, emFoco, fusao.termo) : []),
    [todas, emFoco, fusao],
  );

  function abrir(chave: string, botao: HTMLButtonElement) {
    linhaTocada.current = botao;
    setFoco(chave);
    setAberta(true);
    // A fusão e o renomear de uma ficha anterior não atravessam para a próxima.
    setFusao(null);
    setEditando(null);
  }

  /** O painel sobrevive ao fechar pela duração da transição — ver `foco`. */
  const fechar = useCallback(() => {
    setAberta(false);
    setFusao(null);
    setEditando(null);
    setTimeout(() => setFoco(null), DURACAO_FICHA_MS);
  }, []);

  /**
   * `Esc` desfaz uma coisa por vez: primeiro a fusão em curso, depois a ficha.
   * Fechar o painel inteiro por causa de uma busca de fusão aberta perderia o
   * lugar onde eu estava.
   */
  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fusao !== null) setFusao(null);
      else fechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta, fusao, fechar]);

  /**
   * O foco entra no painel ao abrir e volta para a linha ao fechar — mesma
   * forma da gaveta da gestão. Sem isto, quem navega por teclado abre a ficha e
   * continua com o cursor atrás dela.
   */
  const tocado = useRef(false);
  useEffect(() => {
    if (!tocado.current) {
      tocado.current = true;
      return;
    }
    if (aberta) painel.current?.querySelector<HTMLElement>("button, a, input")?.focus();
    else linhaTocada.current?.focus();
  }, [aberta]);

  async function procurar() {
    setProcurando(true);
    setFalha(null);
    const r = await fetch("/api/entidades/duplicatas", { method: "POST" }).catch(() => null);
    setProcurando(false);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setPares(((await r.json()) as { pares: Par[] }).pares);
  }

  /**
   * Fundir é irreversível: a perdedora vira alias e não há como desfazer.
   *
   * O mesmo caminho serve aos dois disparos — o par que o agente propôs e a
   * fusão à mão de dentro da ficha —, porque a rota sempre aceitou qualquer
   * par: as travas dela são existência, chaves diferentes, e nenhuma das duas
   * já fundida.
   */
  async function fundir(vencedora: string, perdedora: string) {
    setOcupado(`${vencedora}|${perdedora}`);
    setFalha(null);
    const r = await fetch("/api/entidades/fundir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vencedora, perdedora }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setPares((ps) => (ps ?? []).filter((p) => !(p.a === perdedora || p.b === perdedora)));
    setFusao(null);
    // O painel **reaponta para a vencedora**. A perdedora deixou de aparecer na
    // listagem no mesmo instante, e uma ficha aberta num nó que sumiu mentiria
    // até eu fechá-la.
    setFoco((f) => (f === perdedora ? vencedora : f));
    void carregar();
  }

  async function saoDistintas(par: Par) {
    setOcupado(`${par.a}|${par.b}`);
    await fetch("/api/entidades/distintas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: par.a, b: par.b }),
    }).catch(() => null);
    setOcupado(null);
    setPares((ps) => (ps ?? []).filter((p) => !(p.a === par.a && p.b === par.b)));
  }

  /**
   * O tipo não era editável depois da primeira revisão — a entidade vira
   * `conhecida` e a revisão a mostra fixa. Aqui é onde o label errado tem
   * conserto.
   */
  async function trocarTipo(chave: string, tipo: TipoEntidade) {
    setOcupado(chave);
    setFalha(null);
    const r = await fetch("/api/entidades/tipo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, tipo }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    void carregar();
  }

  /** Semear: o nome entra no vocabulário do STT antes da primeira menção. */
  async function criar() {
    const nome = nomeNovo.trim();
    if (nome === "") return;
    setOcupado("criar");
    setFalha(null);
    const r = await fetch("/api/entidades/criar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, tipo: tipoNovo }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setNomeNovo("");
    setCriando(false);
    void carregar();
  }

  async function salvarNome(chave: string) {
    const nome = rascunho.trim();
    if (nome === "" || ehPronome(normalizarNome(nome))) return;
    setOcupado(chave);
    setFalha(null);
    const r = await fetch("/api/entidades/renomear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, nome }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setEditando(null);
    void carregar();
  }

  /** Grava um dos três campos. É o único caminho de escrita do perfil. */
  async function salvarPerfil(chave: string, campo: CampoPerfil, texto: string) {
    const id = `${chave}|${campo}`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/perfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, campo, texto }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setPropostas((p) => {
      const { [id]: _fora, ...resto } = p;
      return resto;
    });
    setTextos((t) => {
      const { [id]: _fora, ...resto } = t;
      return resto;
    });
    void carregar();
  }

  /**
   * O retrato de identidade. É o campo que os dois agentes leem por padrão
   * desde a 4.11 — escrito errado, ele contamina toda atribuição futura.
   */
  async function salvarResumo(chave: string, texto: string) {
    const id = `${chave}|resumo`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/resumo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, texto }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setTextos((t) => {
      const { [id]: _fora, ...resto } = t;
      return resto;
    });
    void carregar();
  }

  /**
   * Acrescentar ou tirar uma grafia. Um item por chamada: a lista na tela é a
   * união de duas fontes (a propriedade e os nós de fusão real), e mandar a
   * lista inteira de volta gravaria uma na outra.
   */
  async function mexerNaGrafia(chave: string, grafia: string, acao: "acrescentar" | "remover") {
    const id = `${chave}|grafia|${grafia}`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, grafia, acao }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    if (acao === "acrescentar") setGrafiaNova((g) => ({ ...g, [chave]: "" }));
    void carregar();
  }

  /** A ficha oficial. Um toque, reversível, sem consequência retroativa. */
  async function alternarCanonico(chave: string, canonico: boolean) {
    setOcupado(`${chave}|canonico`);
    setFalha(null);
    const r = await fetch("/api/entidades/canonico", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, canonico }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    void carregar();
  }

  /**
   * O agente 4 escreve a ficha inteira — e **grava**, sem eu ver antes.
   *
   * É a única coisa desta tela que escreve conteúdo sem o meu toque campo a
   * campo, e é decisão declarada da 4.12: o atrito de aprovar campo por campo é
   * o que deixou as fichas vazias. O contrapeso é o desfazer, logo abaixo.
   */
  async function enriquecerUma(chave: string) {
    const id = `${chave}|enriquecer`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/enriquecer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
    }
    // Recarrega nos dois casos: quando falha, é a linha da entidade que passa a
    // mostrar o motivo, e é isso que a fatia prometeu.
    void carregar();
  }

  /** Os quatro campos voltam de uma vez. Um toque — ele restaura, não destrói. */
  async function desfazer(chave: string) {
    const id = `${chave}|desfazer`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/desfazer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    // O textarea local tem de sair da frente: o que ele mostra é o texto de
    // antes do desfazer, e ele venceria o que veio do grafo.
    setTextos({});
    void carregar();
  }

  /**
   * O lote: as marcadas entram na fila, e a fila anda sozinha.
   *
   * A resposta volta na hora — o que ela confirma é que o `na_fila` está
   * gravado, não que o trabalho acabou. Daí em diante quem conta a história é o
   * selo de cada linha.
   */
  async function enriquecerMarcadas() {
    if (marcadas.size === 0) return;
    setOcupado("lote");
    setFalha(null);
    const r = await fetch("/api/entidades/enriquecer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chaves: [...marcadas] }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    // A seleção sai do caminho, e o modo junto: o que interessa a partir daqui
    // é o selo de cada linha, e uma lista marcada por cima disso só atrapalharia
    // a leitura.
    sairDaSelecao();
    void carregar();
  }

  function sairDaSelecao() {
    setSelecionando(false);
    setMarcadas(new Set());
  }

  /** O agente 3 propõe; nada é gravado até eu apertar salvar. */
  async function pedirRascunho(chave: string, campo: CampoPerfil) {
    const id = `${chave}|${campo}`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/perfil/rascunho", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, campo }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    const proposto = (await r.json()) as Rascunho;
    setPropostas((p) => ({ ...p, [id]: proposto }));
  }

  /** Uma coluna da comparação de fusão. As duas são idênticas de propósito. */
  function lado(e: Entidade, contra: Entidade) {
    const escritos = CAMPOS_PERFIL.filter((c) => (e.perfil ?? PERFIL_VAZIO)[c] !== "").length;
    return (
      <div className="lado" key={e.id}>
        <h4>{e.nome}</h4>
        <span className="meta">
          {ROTULO_TIPO_ENTIDADE[e.tipo]} · {e.atomos} átomo(s) · {e.sessoes} sessão(ões)
          {escritos > 0 && ` · perfil ${escritos}/3`}
        </span>
        <p className={e.resumo === "" ? "resumo vazio" : "resumo"}>
          {e.resumo === "" ? "sem resumo" : e.resumo}
        </p>
        <button
          className="reextrair"
          disabled={ocupado === `${e.nome_normalizado}|${contra.nome_normalizado}`}
          onClick={() => void fundir(e.nome_normalizado, contra.nome_normalizado)}
        >
          manter esta
        </button>
      </div>
    );
  }

  return (
    <main className="sessoes tela-entidades">
      <header>
        <h1>entidades</h1>
        <p>
          {entidades ? `${entidades.length} no grafo` : "…"} — o que já entrou, onde se conserta
          o que entrou torto, e a ficha que diz de quem eu estou falando
        </p>
      </header>

      {falha && <p className="aviso">{falha}</p>}

      {/* O topo: achar. A busca é a de `catalogo.ts` — atravessa alias, então
          digitar a grafia antiga acha a vencedora da fusão. */}
      <div className="barra-entidades">
        <input
          id={idBusca}
          className="campo-nome busca"
          type="search"
          placeholder="buscar por nome ou grafia"
          aria-label="buscar entidade"
          value={termo}
          onChange={(ev) => setTermo(ev.target.value)}
        />
        <select
          className="campo-nome tipo"
          aria-label="filtrar por tipo"
          value={tipoFiltro}
          onChange={(ev) => setTipoFiltro(ev.target.value as TipoEntidade | "todas")}
        >
          <option value="todas">todas</option>
          {TIPOS_ENTIDADE.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO_ENTIDADE[t]}
            </option>
          ))}
        </select>
        <label className="alternador">
          <input
            type="checkbox"
            checked={semResumo}
            onChange={(ev) => setSemResumo(ev.target.checked)}
          />
          <span>sem resumo</span>
        </label>
      </div>

      {/* Manutenção: semear um nome, procurar duplicatas, entrar no lote. */}
      <div className="barra-manutencao">
        <button
          className={criando ? "reextrair armado" : "reextrair"}
          aria-expanded={criando}
          onClick={() => setCriando((c) => !c)}
        >
          + nova
        </button>
        <button className="reextrair" onClick={() => void procurar()} disabled={procurando}>
          {procurando ? "olhando…" : "procurar duplicatas"}
        </button>
        {/* O lote é modo: sem apertar aqui, nenhuma caixa de seleção existe na
            tela. Elas eram permanentes, e uma coluna de checkbox em toda linha
            cobra uma decisão que eu quase nunca vou tomar. */}
        <button
          className={selecionando ? "reextrair armado" : "reextrair"}
          aria-pressed={selecionando}
          onClick={() => (selecionando ? sairDaSelecao() : setSelecionando(true))}
        >
          enriquecer
        </button>
        {andando && <span className="conta">a fila está andando — pode fechar a aba</span>}
      </div>

      {criando && (
        <div className="acoes-sessao criar-entidade">
          <input
            className="campo-nome"
            placeholder="nome que eu ainda vou falar"
            autoFocus
            value={nomeNovo}
            onChange={(ev) => setNomeNovo(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Enter" && void criar()}
          />
          <select
            className="campo-nome tipo"
            aria-label="tipo da entidade nova"
            value={tipoNovo}
            onChange={(ev) => setTipoNovo(ev.target.value as TipoEntidade)}
          >
            {TIPOS_ENTIDADE.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_ENTIDADE[t]}
              </option>
            ))}
          </select>
          <button
            className="reextrair"
            disabled={ocupado === "criar" || nomeNovo.trim() === ""}
            onClick={() => void criar()}
          >
            criar
          </button>
        </div>
      )}

      {/* A barra do lote **gruda** no topo: marcar vinte entidades é percorrer a
          lista inteira, e o botão que dispara não pode ficar lá em cima. A
          contagem aparece ANTES de disparar, porque é a única coisa que a tela
          sabe dizer sobre o tamanho da conta (§14). */}
      {selecionando && (
        <div className="barra-selecao">
          <label className="marca-todas">
            <input
              type="checkbox"
              checked={marcadas.size > 0 && marcadas.size === mostradas.length}
              // Meio marcado quando é parte: sem isso, marcar duas de dez faria
              // a caixa do topo parecer "nenhuma".
              ref={(el) => {
                if (el) el.indeterminate = marcadas.size > 0 && marcadas.size < mostradas.length;
              }}
              onChange={(ev) =>
                setMarcadas(
                  ev.target.checked ? new Set(mostradas.map((e) => e.nome_normalizado)) : new Set(),
                )
              }
            />
            {/* "todas" é o que está na lista agora, e não o grafo inteiro: com
                um filtro ligado, marcar o que não está à vista é surpresa. */}
            <span>selecionar todas</span>
          </label>
          <button
            className="reextrair"
            disabled={ocupado === "lote" || marcadas.size === 0}
            title="o agente lê TODOS os átomos de cada uma e escreve a ficha inteira — e grava, sem eu aprovar campo a campo"
            onClick={() => void enriquecerMarcadas()}
          >
            {ocupado === "lote"
              ? "enfileirando…"
              : `enriquecer ${marcadas.size === 0 ? "" : `${marcadas.size} `}marcada(s)`}
          </button>
          <button className="reextrair" onClick={sairDaSelecao}>
            cancelar
          </button>
        </div>
      )}

      {pares?.length === 0 && <p className="aguardando">nenhuma duplicata — o grafo está limpo.</p>}

      {(pares ?? []).map((p) => {
        const chave = `${p.a}|${p.b}`;
        return (
          <div className="par" key={chave}>
            <p>
              <strong>{p.nome_a}</strong> e <strong>{p.nome_b}</strong> são a mesma coisa?
            </p>
            <p className="aguardando">
              {p.explicacao || p.motivo} · {p.sessoes_a} e {p.sessoes_b} sessão(ões)
            </p>
            <div className="acoes-sessao">
              {/* Qual sobrevive é escolha minha: o nome do vencedor vira o nome
                  de exibição e vai para o vocabulário do STT. */}
              <button
                className="reextrair"
                disabled={ocupado === chave}
                onClick={() => void fundir(p.a, p.b)}
              >
                manter {p.nome_a}
              </button>
              <button
                className="reextrair"
                disabled={ocupado === chave}
                onClick={() => void fundir(p.b, p.a)}
              >
                manter {p.nome_b}
              </button>
              <button
                className="reextrair"
                disabled={ocupado === chave}
                onClick={() => void saoDistintas(p)}
              >
                são diferentes
              </button>
            </div>
          </div>
        );
      })}

      {/* A lista: um nome e uma linha de meta. Os sete controles que moravam
          aqui estão todos dentro da ficha. */}
      <ul className="lista-entidades">
        {mostradas.map((e) => (
          <li key={e.id} className={foco === e.nome_normalizado && aberta ? "aberta" : undefined}>
            {selecionando && (
              <input
                type="checkbox"
                className="marca-lote"
                aria-label={`marcar ${e.nome} para enriquecer`}
                checked={marcadas.has(e.nome_normalizado)}
                onChange={(ev) =>
                  setMarcadas((m) => {
                    const proximo = new Set(m);
                    if (ev.target.checked) proximo.add(e.nome_normalizado);
                    else proximo.delete(e.nome_normalizado);
                    return proximo;
                  })
                }
              />
            )}
            <button
              className="abre-ficha"
              aria-expanded={foco === e.nome_normalizado && aberta}
              aria-controls={idFicha}
              onClick={(ev) => abrir(e.nome_normalizado, ev.currentTarget)}
            >
              <span className="nome">
                {e.nome}
                {/* A ficha oficial se vê na linha, sem abrir nada — é o que
                    "destacar" quer dizer aqui. */}
                {e.canonico && (
                  <span className="canonica" title="ficha oficial desta entidade">
                    ★
                  </span>
                )}
              </span>
              <span className="meta">
                {e.atomos} átomo(s) · {e.sessoes} sessão(ões)
                {e.resumo === "" && " · sem resumo"}
                {selo(e.enriquecimento)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {entidades?.length === 0 && (
        <p className="aguardando">
          nada no grafo ainda — entidade nasce quando eu confirmo uma revisão.
        </p>
      )}

      {entidades !== null && entidades.length > 0 && mostradas.length === 0 && (
        <p className="aguardando">nada com esse recorte.</p>
      )}

      {/* O véu fecha ao toque e escurece a lista atrás — a ficha é modal de
          fato, como a gaveta da gestão. */}
      <div className={`veu${aberta ? " aberto" : ""}`} onClick={fechar} />

      {/* Fica montada sempre: desmontar junto com a classe esvaziaria a caixa no
          meio do caminho de volta, e a transição viraria um corte. */}
      <aside
        ref={painel}
        id={idFicha}
        className={`ficha${aberta ? " aberta" : ""}`}
        aria-label={emFoco ? `ficha de ${emFoco.nome}` : "ficha"}
        aria-hidden={!aberta}
      >
        {emFoco &&
          (() => {
            const chave = emFoco.nome_normalizado;
            const perfil = emFoco.perfil ?? PERFIL_VAZIO;
            const idResumo = `${chave}|resumo`;
            const valorResumo = textos[idResumo] ?? emFoco.resumo;

            return (
              <>
                <header>
                  <button className="voltar" aria-label="fechar a ficha" onClick={fechar}>
                    ←
                  </button>
                  <h2>{emFoco.nome}</h2>
                  <button
                    className={emFoco.canonico ? "reextrair canonico" : "reextrair"}
                    disabled={ocupado === `${chave}|canonico`}
                    aria-pressed={emFoco.canonico}
                    title="marcar esta como a ficha oficial desta entidade"
                    onClick={() => void alternarCanonico(chave, !emFoco.canonico)}
                  >
                    {emFoco.canonico ? "★ canônica" : "☆ canônica"}
                  </button>
                </header>

                <p className="aguardando">
                  é isto que o agente lê para saber de quem eu estou falando quando dois nomes
                  soam igual
                </p>

                {/* O tipo e o nome. Os dois moravam na linha da lista, e é aqui
                    que eles deixam de disputar espaço com o nome. */}
                <div className="identidade">
                  <select
                    className="campo-nome tipo"
                    value={emFoco.tipo}
                    disabled={ocupado === chave}
                    aria-label={`tipo de ${emFoco.nome}`}
                    onChange={(ev) => void trocarTipo(chave, ev.target.value as TipoEntidade)}
                  >
                    {TIPOS_ENTIDADE.map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_ENTIDADE[t]}
                      </option>
                    ))}
                  </select>
                  {editando === chave ? (
                    <>
                      <input
                        className="campo-nome"
                        aria-label={`novo nome de ${emFoco.nome}`}
                        value={rascunho}
                        autoFocus
                        onChange={(ev) => setRascunho(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") void salvarNome(chave);
                          if (ev.key === "Escape") setEditando(null);
                        }}
                      />
                      <button
                        className="reextrair"
                        disabled={ocupado === chave}
                        onClick={() => void salvarNome(chave)}
                      >
                        salvar
                      </button>
                    </>
                  ) : (
                    <button
                      className="reextrair"
                      onClick={() => {
                        setEditando(chave);
                        setRascunho(emFoco.nome);
                      }}
                    >
                      renomear
                    </button>
                  )}
                  <span className="conta">
                    {emFoco.atomos} átomo(s) · {emFoco.sessoes} sessão(ões)
                  </span>
                </div>

                {/* O resumo vem primeiro porque é o que os dois agentes leem
                    por padrão. Os três campos abaixo dele só entram na segunda
                    passada, quando a primeira leitura não resolveu. */}
                <div className="secao">
                  <div className="campo-perfil">
                    <label htmlFor={idResumo}>
                      resumo{" "}
                      <span className="meta">
                        quem é, e sobretudo o que a distingue de outra parecida — é isto que vai
                        no prompt dos dois agentes
                      </span>
                    </label>
                    <textarea
                      id={idResumo}
                      rows={3}
                      maxLength={TETO_RESUMO}
                      value={valorResumo}
                      placeholder="—"
                      onChange={(ev) => setTextos((t) => ({ ...t, [idResumo]: ev.target.value }))}
                    />
                    <div className="acoes-sessao">
                      <span className="meta">
                        {valorResumo.length}/{TETO_RESUMO}
                      </span>
                      <button
                        className="reextrair"
                        disabled={ocupado === idResumo || valorResumo === emFoco.resumo}
                        onClick={() => void salvarResumo(chave, valorResumo)}
                      >
                        salvar
                      </button>
                    </div>
                  </div>
                </div>

                {/* As grafias. Acrescentar à mão é o único jeito de ensinar uma
                    antes de o STT errar pela primeira vez. */}
                <div className="secao">
                  <div className="campo-perfil grafias">
                    <label htmlFor={`grafia-${chave}`}>
                      grafias{" "}
                      <span className="meta">
                        como esta entidade já foi falada ou escrita — o que o STT costuma errar
                      </span>
                    </label>
                    {emFoco.aliases.length > 0 && (
                      <ul className="lista-grafias">
                        {emFoco.aliases.map((a) => (
                          <li key={a}>
                            <span>{a}</span>
                            <button
                              type="button"
                              aria-label={`tirar a grafia ${a}`}
                              disabled={ocupado === `${chave}|grafia|${a}`}
                              onClick={() => void mexerNaGrafia(chave, a, "remover")}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="acoes-sessao">
                      <input
                        id={`grafia-${chave}`}
                        className="campo-nome"
                        placeholder="grafia que o STT ainda vai errar"
                        value={grafiaNova[chave] ?? ""}
                        onChange={(ev) =>
                          setGrafiaNova((g) => ({ ...g, [chave]: ev.target.value }))
                        }
                        onKeyDown={(ev) => {
                          if (ev.key !== "Enter") return;
                          const g = (grafiaNova[chave] ?? "").trim();
                          if (g !== "") void mexerNaGrafia(chave, g, "acrescentar");
                        }}
                      />
                      <button
                        className="reextrair"
                        disabled={(grafiaNova[chave] ?? "").trim() === ""}
                        onClick={() =>
                          void mexerNaGrafia(chave, (grafiaNova[chave] ?? "").trim(), "acrescentar")
                        }
                      >
                        acrescentar
                      </button>
                    </div>
                  </div>
                </div>

                <div className="secao">
                  {CAMPOS_PERFIL.map((campo) => {
                    const id = `${chave}|${campo}`;
                    const valor = textos[id] ?? perfil[campo];
                    const proposta = propostas[id];
                    const mexido = valor !== perfil[campo];

                    return (
                      <div className="campo-perfil" key={campo}>
                        <label htmlFor={id}>
                          {ROTULO[campo]} <span className="meta">{DICA[campo]}</span>
                        </label>
                        {/* Sem `maxLength` e sem contador desde a 4.11: o teto
                            de 300 existia porque estes três campos entravam no
                            prompt do agente 2 em toda chamada, e isso acabou. */}
                        <textarea
                          id={id}
                          rows={2}
                          value={valor}
                          placeholder="—"
                          onChange={(ev) => setTextos((t) => ({ ...t, [id]: ev.target.value }))}
                        />
                        <div className="acoes-sessao">
                          <button
                            className="reextrair"
                            disabled={ocupado === id || !mexido}
                            onClick={() => void salvarPerfil(chave, campo, valor)}
                          >
                            salvar
                          </button>
                          <button
                            className="reextrair"
                            disabled={ocupado === id}
                            title="o agente propõe a partir dos átomos que marcaram este campo; nada é gravado"
                            onClick={() => void pedirRascunho(chave, campo)}
                          >
                            {ocupado === id ? "pensando…" : "rascunhar"}
                          </button>
                        </div>

                        {proposta && (
                          // Ao lado, nunca por cima: o texto atual é meu, e o
                          // agente 3 é quem mais pode contaminar a resolução.
                          <div className="proposta-perfil">
                            <p className="meta">
                              proposto de {proposta.atomos} átomo(s) marcado(s) · {proposta.modelo}
                            </p>
                            <p>{proposta.texto}</p>
                            <div className="acoes-sessao">
                              <button
                                className="reextrair"
                                onClick={() => setTextos((t) => ({ ...t, [id]: proposta.texto }))}
                              >
                                usar este texto
                              </button>
                              <button
                                className="reextrair"
                                onClick={() =>
                                  setPropostas((p) => {
                                    const { [id]: _fora, ...resto } = p;
                                    return resto;
                                  })
                                }
                              >
                                descartar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* O agente 4, e o que o desfaz. O desfazer tem de estar à vista
                    de quem acabou de ver a ficha mudar sem ter aprovado nada. */}
                <div className="secao">
                  <p className="aguardando">
                    o agente lê TODOS os átomos que falam dela e escreve a ficha inteira — e
                    grava, sem eu aprovar campo a campo
                  </p>
                  <div className="acoes-sessao">
                    <button
                      className="reextrair"
                      disabled={ocupado === `${chave}|enriquecer`}
                      onClick={() => void enriquecerUma(chave)}
                    >
                      {ocupado === `${chave}|enriquecer` ? "escrevendo…" : "enriquecer esta"}
                    </button>
                    {emFoco.enriquecimento.tem_anterior && (
                      <button
                        className="reextrair"
                        disabled={ocupado === `${chave}|desfazer`}
                        title="volta os quatro campos para a geração anterior — outro toque traz de volta"
                        onClick={() => void desfazer(chave)}
                      >
                        {ocupado === `${chave}|desfazer` ? "voltando…" : "desfazer"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Fundir fica por último: é a única coisa desta tela que não
                    tem volta. */}
                <div className="secao fusao">
                  {fusao === null ? (
                    <>
                      <p className="aguardando">
                        duas grafias da mesma pessoa viram uma só — a perdedora fica como grafia
                        da vencedora
                      </p>
                      <div className="acoes-sessao">
                        <button
                          className="reextrair"
                          onClick={() => setFusao({ termo: "", alvo: null })}
                        >
                          fundir com…
                        </button>
                      </div>
                    </>
                  ) : alvoDaFusao === null ? (
                    <>
                      <label htmlFor={idFusao}>
                        fundir com{" "}
                        <span className="meta">qual outra entidade é a mesma coisa que esta</span>
                      </label>
                      <input
                        id={idFusao}
                        className="campo-nome busca"
                        type="search"
                        autoFocus
                        placeholder="buscar no grafo"
                        value={fusao.termo}
                        onChange={(ev) => setFusao({ termo: ev.target.value, alvo: null })}
                      />
                      {candidatas.length === 0 ? (
                        <p className="aguardando">nada com esse nome no grafo.</p>
                      ) : (
                        <ul className="candidatas">
                          {candidatas.map((c) => {
                            const apelido = apelidoQueCasa(c, fusao.termo);
                            return (
                              <li key={c.id}>
                                <button
                                  onClick={() =>
                                    setFusao({ termo: fusao.termo, alvo: c.nome_normalizado })
                                  }
                                >
                                  <span>
                                    {c.nome}
                                    {apelido && <em> — por “{apelido}”</em>}
                                  </span>
                                  <span className="meta">
                                    {ROTULO_TIPO_ENTIDADE[c.tipo]} · {c.atomos} átomo(s) ·{" "}
                                    {c.sessoes} sessão(ões)
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <div className="acoes-sessao">
                        <button className="reextrair" onClick={() => setFusao(null)}>
                          cancelar
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* As duas coisas que a fusão faz e que não se adivinham
                          da tela. Sem elas eu escolho o vencedor errado e perco
                          a ficha boa sem saber que perdi. */}
                      <p className="aviso-fusao">
                        <strong>Isto não tem desfazer.</strong> A perdedora vira grafia da
                        vencedora e os átomos dela migram — mas o resumo e o perfil dela{" "}
                        <strong>não são copiados</strong>. Escolher a vencedora é escolher qual
                        ficha sobrevive.
                      </p>
                      <div className="comparacao">
                        {lado(emFoco, alvoDaFusao)}
                        {lado(alvoDaFusao, emFoco)}
                      </div>
                      <div className="acoes-sessao">
                        <button
                          className="reextrair"
                          onClick={() => setFusao({ termo: fusao.termo, alvo: null })}
                        >
                          voltar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            );
          })()}
      </aside>
    </main>
  );
}
