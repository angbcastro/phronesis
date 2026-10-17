"use client";

/**
 * A barra, o painel, a lista — a tela do chat (slice 6).
 *
 * **Ela nasce da tela de gravar, e não de uma rota.** `/chat` ao lado de
 * Gravar/Revisar foi a primeira ideia levada à entrevista e caiu assim que
 * ficou claro que a integração era com a própria tela inicial: a caixa fechada
 * é periférica e semitransparente, e expande para o centro enquanto o círculo
 * de gravação minimiza e vai para o topo. Os dois ficam periféricos quando não
 * estão em foco, e nenhum dos dois some.
 *
 * **Era uma bolha de balão no canto de baixo à direita, e virou uma barra de
 * pesquisa no rodapé, centralizada, com `...` de convite.** Um ícone de balão
 * periférico lê como símbolo de suporte; uma barra lê como lugar de perguntar,
 * que é o que ela é. Ela **não** aceita texto: tocar nela abre o painel e o foco
 * vai para o campo de dentro — um campo que não recebesse o que eu digitasse
 * mentiria, e por isso o estado fechado é um botão com cara de campo, não um
 * `<input>`.
 *
 * **É o mesmo nó do DOM nos dois estados**, como o `BotaoGravar`: a barra e o
 * painel são o mesmo `<section>`, e é isso que faz a expansão ser uma transição
 * em vez de um corte. O conteúdo troca por dentro; a caixa cresce. Até a slice 6
 * ser usada de verdade isso era só o que o comentário dizia — o componente
 * voltava cedo com uma árvore diferente, e o `@keyframes` de entrada não tinha
 * simétrico nenhum na saída.
 *
 * **Durante a gravação ela não existe** — quem decide isso é a `Gravacao`, no
 * mesmo ramo que já esconde a `Gestao` hoje. A tela de gravar é onde este
 * projeto historicamente corta, não adiciona.
 *
 * As funções puras deste arquivo (`frasePasso`, `rotuloDaConversa`,
 * `separarConversas`, `trechosDoRastro`, `sessaoDoAtomo`, `rotuloDasLinhas`,
 * `celulaDoRastro`) são exportadas para
 * `tests/chat.test.ts`: elas são a lógica que erra calada — uma conversa sem
 * título, um passo sem parâmetro, um trecho repetido no (i).
 * `partirLinhas` era a quarta, e mudou de casa na slice 8.2: o fluxo NDJSON
 * ganhou um segundo consumidor (a revisão que cresce) e o parser foi para
 * `@/client/ndjson`. Continua reexportado daqui porque é daqui que o teste o
 * importa, e é o mesmo parser.
 */
import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { lerEventos, partirLinhas } from "@/client/ndjson";
import { nomeDoOuvir, textoDoOuvir, useTocador } from "@/client/tocador";
import { usaTransicao } from "@/client/transicao";
import { dataCurta, diaLocal } from "@/lib/dia";
import {
  mesAno,
  rotuloDoTipo,
  type AtomoAchado,
  type BlocoAbsoluto,
  type ConsultaNoRastro,
  type Conversa,
  type Mensagem,
  type PassoDeFerramenta,
} from "@/lib/tipos";

export { partirLinhas };

interface Props {
  aberto: boolean;
  aoAbrir: () => void;
  aoFechar: () => void;
}

/** Um evento do fluxo NDJSON de `POST /api/chat`. */
type Evento =
  | { tipo: "conversa"; conversa: Conversa }
  | { tipo: "passo"; passo: PassoDeFerramenta }
  | { tipo: "resposta"; mensagem: Mensagem }
  | { tipo: "titulo"; titulo: string }
  | { tipo: "erro"; erro: string };

// ─────────────────────────── as funções puras ───────────────────────────

const nomeDoTipo = (t: unknown): string =>
  Array.isArray(t) ? t.map((x) => String(x).toLowerCase()).join(", ") : "";

/**
 * O que a linha de progresso diz de um passo já concluído.
 *
 * No passado, e não no gerúndio: o evento chega **depois** que a ferramenta
 * respondeu, e escrever "buscando…" sobre trabalho terminado seria o tipo de
 * mentirinha de interface que faz a espera parecer mais longa do que é.
 */
export function frasePasso(p: PassoDeFerramenta): string {
  if (p.ferramenta === "buscar_entidades") return fraseEntidades(p);
  if (p.ferramenta === "ler_retrato") return fraseRetrato(p);
  if (p.ferramenta === "consultar_grafo") return fraseConsulta(p);
  const n = p.achados.length;
  // "8 de 34" quando a busca contou mais do que mostrou (slice 9). Mensagem
  // gravada antes da 9 não tem recorte e continua dizendo só "8 trechos".
  const de = p.recorte && p.recorte.total > n ? ` de ${p.recorte.total}` : "";
  const quantos = p.erro ? p.erro : n === 0 ? "nada" : `${n}${de} trecho${n === 1 && de === "" ? "" : "s"}`;

  if (p.ferramenta === "historico_do_atomo") return `seguiu o que mudou — ${quantos}`;

  const q = p.parametros as {
    texto?: string;
    entidade?: string;
    tipo?: unknown;
    desde?: string;
    ate?: string;
  };
  const partes: string[] = [];
  if (q.texto) partes.push(`“${q.texto}”`);
  if (q.entidade) partes.push(`sobre ${q.entidade}`);
  const tipos = nomeDoTipo(q.tipo);
  if (tipos !== "") partes.push(tipos);
  if (q.desde && q.ate) partes.push(`de ${q.desde} a ${q.ate}`);
  else if (q.desde) partes.push(`desde ${q.desde}`);
  else if (q.ate) partes.push(`até ${q.ate}`);

  return `buscou ${partes.length === 0 ? "o mais recente" : partes.join(" · ")} — ${quantos}`;
}

/**
 * A frase do passo de `ler_retrato` (slice 10): **qual seção** foi lida. É o
 * que deixa o (i) provar que a pergunta sobre o treino leu a dimensão do corpo,
 * e só ela.
 */
function fraseRetrato(p: PassoDeFerramenta): string {
  const r = p.retrato;
  if (p.erro && !r?.texto) return `leu o retrato — ${p.erro}`;
  if (!r || r.dimensao === null) {
    const n = r?.dimensoes?.length ?? 0;
    return `leu o Agora e a lista de dimensões — ${n} dimens${n === 1 ? "ão" : "ões"}`;
  }
  const n = p.achados.length;
  return `leu a dimensão ${r.nome || r.dimensao} — ${n} fonte${n === 1 ? "" : "s"}`;
}

/** Quanto do erro de uma consulta cabe na linha de progresso; o (i) mostra inteiro. */
export const TETO_ERRO_NA_FRASE = 120;

/**
 * A frase do passo de `consultar_grafo` (slice 12): linhas, e não trechos — as
 * colunas são do modelo, e uma linha pode ser uma contagem.
 */
function fraseConsulta(p: PassoDeFerramenta): string {
  if (p.erro) {
    const erro = p.erro.split("\n")[0];
    return `consultou o grafo — ${erro.length > TETO_ERRO_NA_FRASE ? `${erro.slice(0, TETO_ERRO_NA_FRASE)}…` : erro}`;
  }
  const c = p.consulta;
  if (!c || c.total === 0) return "consultou o grafo — nada";
  if (c.cortado) return `consultou o grafo — cortado em ${c.linhas.length} de ${c.total}`;
  return `consultou o grafo — ${c.total} linha${c.total === 1 ? "" : "s"}`;
}

/**
 * O botão que abre as linhas de uma consulta no (i): quantas o modelo leu, e de
 * quantas quando a saída cortou. A seta é a do "como procurei".
 */
export function rotuloDasLinhas(c: ConsultaNoRastro, aberto: boolean): string {
  const n = c.linhas.length;
  const quantas = c.cortado
    ? `as ${n} de ${c.total} linhas`
    : n === 1
      ? "a linha"
      : `as ${n} linhas`;
  return `ver ${quantas} ${aberto ? "▾" : "▸"}`;
}

/**
 * Uma célula da tabela do (i). A lista de valores simples vira texto corrido —
 * `["Nicole", "Isinha"]` se lê "Nicole, Isinha" —, e o resto, JSON. Vazio é um
 * traço, e não uma célula em branco que pareceria falha de desenho.
 */
export function celulaDoRastro(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v === "" ? "—" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) {
    return v.length === 0 ? "—" : v.map((x) => (x === null ? "—" : String(x))).join(", ");
  }
  return JSON.stringify(v);
}

/** A frase do passo de `buscar_entidades` (slice 9): fichas, não trechos. */
function fraseEntidades(p: PassoDeFerramenta): string {
  const n = p.entidades?.length ?? 0;
  const de = p.recorte && p.recorte.total > n ? ` de ${p.recorte.total}` : "";
  const quantas = p.erro ? p.erro : n === 0 ? "nada" : `${n}${de} ficha${n === 1 && de === "" ? "" : "s"}`;
  const q = p.parametros as { nome?: string; texto?: string; tipo?: string };
  const partes: string[] = [];
  if (q.nome) partes.push(q.nome);
  if (q.texto) partes.push(`“${q.texto}”`);
  if (q.tipo) partes.push(q.tipo.toLowerCase());
  return `procurou ${partes.length === 0 ? "as mais faladas" : partes.join(" · ")} — ${quantas}`;
}

/**
 * A linha do (i) que diz **de onde** saiu a contagem, e quanto o passo levou
 * (slice 9). É o instrumento da fatia: o piso, quantos ficaram abaixo dele e o
 * melhor cortado, ao lado da similaridade que cada achado já mostrava — quem
 * decide se o `PISO_BUSCA` está certo sou eu, olhando isto.
 *
 * `medidas.ts` não serve aqui, e é por desenho: `comMedicao` é chaveado por
 * `sessao_id`, e o chat não tem sessão.
 */
export function fraseRecorte(p: PassoDeFerramenta): string {
  const partes: string[] = [];
  const r = p.recorte;
  if (r && typeof r.janela === "number") {
    const abaixo = r.janela - (r.acima_do_piso ?? 0);
    partes.push(
      `${r.acima_do_piso ?? 0} de ${r.janela} mais parecidos passaram do piso ${(r.piso ?? 0).toFixed(2)}`,
    );
    if (r.filtrado) partes.push(`${r.total} passaram também nos filtros`);
    if (abaixo > 0 && typeof r.melhor_abaixo === "number") {
      partes.push(`${abaixo} abaixo, o melhor em ${r.melhor_abaixo.toFixed(2)}`);
    }
  } else if (r) {
    partes.push(`${r.total} no diário${r.filtrado ? " com esses filtros" : ""}`);
  }
  if (typeof p.duracao_ms === "number") {
    partes.push(`${(p.duracao_ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`);
  }
  return partes.join(" · ");
}

/** Quantos caracteres da primeira pergunta viram nome de uma conversa sem título. */
export const TETO_ROTULO = 48;

/**
 * Quanto tempo o painel continua montado depois de eu fechar, em ms.
 *
 * **É o mesmo número da transição da caixa em `globals.css`** — os dois mudam
 * juntos. Sem esta espera o conteúdo sumiria de uma vez enquanto a caixa ainda
 * encolhe até a barra, e o que se veria fechando seria uma caixa vazia.
 *
 * **Isto é do caminho sem View Transition.** Com ela, a foto do antes já mostra
 * o painel inteiro pelo tempo todo da volta, e segurar o painel montado por
 * mais 384 ms o põe dentro da foto do **depois**, por cima da barra — dois
 * conteúdos empilhados justo no quadro que tem de estar limpo.
 */
export const DURACAO_CAIXA = 384;

/**
 * O nome de uma conversa na lista.
 *
 * O título gerado por modelo vence sempre. O truncamento da primeira pergunta é
 * o **fallback**, não o padrão — foi exatamente essa a decisão da entrevista, e
 * é por isso que ele só aparece enquanto o `titulo-chat` não respondeu.
 */
export function rotuloDaConversa(c: Conversa, primeira?: string): string {
  const titulo = c.titulo.trim();
  if (titulo !== "") return titulo;
  const pergunta = (primeira ?? "").trim().replace(/\s+/g, " ");
  if (pergunta === "") return "conversa sem título";
  return pergunta.length > TETO_ROTULO ? `${pergunta.slice(0, TETO_ROTULO)}…` : pergunta;
}

/**
 * Os trechos do (i): todo átomo que as chamadas trouxeram, **uma vez só**, na
 * ordem em que vieram — a primeira aparição vence. É a origem da resposta como
 * eu a confiro, ouvindo; o porquê de cada um ter vindo fica em "como procurei".
 *
 * `consultar_grafo` e `buscar_entidades` não trazem átomo (`achados` vazio): a
 * resposta que só leu linhas ou fichas não tem trecho, e o (i) abre direto no
 * técnico.
 */
export function trechosDoRastro(passos: readonly PassoDeFerramenta[]): AtomoAchado[] {
  const vistos = new Set<string>();
  const trechos: AtomoAchado[] = [];
  for (const p of passos) {
    for (const a of p.achados ?? []) {
      if (vistos.has(a.id)) continue;
      vistos.add(a.id);
      trechos.push(a);
    }
  }
  return trechos;
}

/**
 * A sessão de um átomo, pelo id: ele é `<sessao_id>-<ordem>` (`extracao.ts`).
 * `null` fora do formato — e aí o trecho fica sem ▶, em vez de pedir áudio de
 * uma sessão inventada.
 */
export function sessaoDoAtomo(id: string): string | null {
  const m = /^([0-9a-z]{8,40})-\d{1,7}$/.exec(id);
  return m ? m[1] : null;
}

/**
 * A quantos px do fim a lista ainda conta como "no fim" e segue a resposta
 * chegando. Acima disso eu estou relendo, e ela fica parada.
 */
export const PERTO_DO_FIM_PX = 80;

/** Quanto o "apagar?" armado espera o segundo toque antes de desarmar. */
export const DESARME_MS = 4000;

/** As ativas e as arquivadas, na ordem em que vieram. */
export function separarConversas(conversas: readonly Conversa[]): {
  ativas: Conversa[];
  arquivadas: Conversa[];
} {
  return {
    ativas: conversas.filter((c) => c.arquivada_em === null),
    arquivadas: conversas.filter((c) => c.arquivada_em !== null),
  };
}

// ─────────────────────────── o componente ───────────────────────────

type Vista = "lista" | "conversa";

export function Chat({ aberto, aoAbrir, aoFechar }: Props) {
  const [vista, setVista] = useState<Vista>("conversa");
  const [conversas, setConversas] = useState<Conversa[]>([]);
  /**
   * A lista chegou de fato. Sem isto "nenhuma conversa ainda." aparecia antes
   * de a lista voltar — e também quando ela falhava, que é mentir.
   */
  const [listaLida, setListaLida] = useState(false);
  const [aberta, setAberta] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [passos, setPassos] = useState<PassoDeFerramenta[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [problema, setProblema] = useState<string | null>(null);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  const [rastroAberto, setRastroAberto] = useState<string | null>(null);
  // O painel sobrevive ao fechar por `DURACAO_CAIXA` — ver a constante.
  const [saindo, setSaindo] = useState(false);
  /** A conversa cujo "apagar" foi tocado uma vez, e espera o segundo. */
  const [armadoApagar, setArmadoApagar] = useState<string | null>(null);
  /** Chegou coisa nova enquanto eu relia mais acima — o "↓ resposta nova". */
  const [novidade, setNovidade] = useState(false);

  const parada = useRef<AbortController | null>(null);
  const fim = useRef<HTMLDivElement | null>(null);
  /**
   * Eu estou no fim da lista — ou perto dele, `PERTO_DO_FIM_PX`. Ref e não
   * estado: muda a cada evento de rolagem, e ninguém desenha a partir dele.
   * Crescer o conteúdo não dispara rolagem, então o valor é o da última vez que
   * **eu** rolei — que é exatamente a pergunta.
   */
  const noFim = useRef(true);
  /**
   * O próximo crescimento da lista rola ao fim sem perguntar: a pergunta que eu
   * acabei de mandar, a conversa que eu acabei de abrir. Ali eu não estou
   * relendo nada.
   */
  const rolarJa = useRef(true);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  // A caixa inteira, para o teclado virtual poder encolhê-la — ver o efeito do
  // `visualViewport`.
  const caixa = useRef<HTMLElement | null>(null);
  // Sem isto, a montagem da página (fechada, e nunca aberta) contaria como um
  // fechamento e o painel piscaria inteiro por 384 ms na tela de gravar.
  const jaAbriu = useRef(false);
  const barra = useRef<HTMLButtonElement | null>(null);
  /**
   * O fechamento veio do teclado — o Esc, ou o "×" acionado por Enter. Só aí o
   * foco volta para a barra: no toque, focá-la a deixaria acesa (`:focus-within`)
   * em vez da opacidade discreta de sempre.
   */
  const fechouPorTeclado = useRef(false);

  /**
   * Os blocos de cada sessão citada, para o ▶ dos trechos — uma ida por sessão
   * a `GET /api/sessoes/:id/extracao`, como na calibração. Guarda a promessa,
   * e não o resultado: dois ▶ da mesma sessão tocados em seguida esperam a
   * mesma ida. A falha não fica guardada, e o próximo toque tenta de novo.
   */
  const blocosPorSessao = useRef(new Map<string, Promise<readonly BlocoAbsoluto[] | null>>());
  const blocosDe = useCallback((sessao_id: string) => {
    const guardado = blocosPorSessao.current.get(sessao_id);
    if (guardado) return guardado;
    const pedido = (async () => {
      const r = await fetch(`/api/sessoes/${sessao_id}/extracao`, { cache: "no-store" }).catch(
        () => null,
      );
      if (!r || !r.ok) return null;
      const d = (await r.json().catch(() => null)) as { blocos?: BlocoAbsoluto[] } | null;
      return d?.blocos ?? null;
    })();
    blocosPorSessao.current.set(sessao_id, pedido);
    void pedido.then((b) => {
      if (b === null) blocosPorSessao.current.delete(sessao_id);
    });
    return pedido;
  }, []);
  const tocador = useTocador(blocosDe);
  const { parar: pararDeTocar } = tocador;

  const carregarMensagens = useCallback(async (id: string) => {
    setProblema(null);
    try {
      const r = await fetch(`/api/chat?conversa_id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`/api/chat respondeu ${r.status}`);
      const d = (await r.json()) as { conversa: Conversa; mensagens: Mensagem[] };
      rolarJa.current = true;
      setAberta(d.conversa);
      setMensagens(d.mensagens);
    } catch (e) {
      console.error("[chat]", e);
      setProblema("não consegui abrir a conversa");
    }
  }, []);

  /**
   * Começar do zero. Sobe até aqui porque o efeito de abertura a reusa — abrir
   * o chat **é** pedir conversa nova (slice 8.1).
   *
   * **Não cria conversa órfã:** o nó `:Conversa` nasce no `POST /api/chat`,
   * quando a primeira pergunta é enviada. Abrir e fechar sem perguntar não
   * grava nada.
   */
  const nova = useCallback(() => {
    parada.current?.abort();
    setAberta(null);
    setMensagens([]);
    setPassos([]);
    setProblema(null);
    setRastroAberto(null);
    setNovidade(false);
    rolarJa.current = true;
    setVista("conversa");
  }, []);

  useEffect(() => {
    if (aberto) {
      jaAbriu.current = true;
      setSaindo(false);
      return;
    }
    if (fechouPorTeclado.current) {
      fechouPorTeclado.current = false;
      barra.current?.focus();
    }
    // `usaTransicao()` dentro do efeito, e não no corpo do componente: no
    // servidor não há `document`, e ler isso na renderização divergiria da
    // hidratação.
    if (!jaAbriu.current || usaTransicao()) return;
    setSaindo(true);
    const t = setTimeout(() => setSaindo(false), DURACAO_CAIXA);
    return () => clearTimeout(t);
  }, [aberto]);

  /**
   * Abrir o chat é sempre começar do zero (slice 8.1).
   *
   * **Isto reverte a decisão da slice 6**, que era abrir a conversa ativa mais
   * recente para "toco de novo e continuo de onde parei" ser verdade. No uso
   * deu o contrário: eu abro o chat para perguntar uma coisa nova e caio no meio
   * da conversa de ontem, e tenho que sair dela primeiro. A decisão original
   * nem se cumpria como escrita — ela morava numa `useRef` por montagem, e o
   * `<Chat>` é desmontado ao gravar e ao navegar, então "só na primeira
   * abertura" virava "toda vez".
   *
   * O que defende a conversa longa que eu fechar sem querer é a lista, a um
   * toque no ícone do cabeçalho — e ela já existe.
   */
  useEffect(() => {
    if (aberto) nova();
  }, [aberto, nova]);

  /**
   * O teclado virtual, que o CSS não vê.
   *
   * `.chat.aberto` é `position: fixed`, e fixed se posiciona contra o viewport
   * de **layout** — que o teclado do Android não encolhe. O `bottom` da caixa
   * fica debaixo do teclado, e com ele a caixa de escrever: eu digito sem ver o
   * que escrevo. Só o `visualViewport` sabe quanto sobrou.
   *
   * **O `--teclado` é escrito no nó da caixa, e não na raiz**, e é essa a
   * escolha de mecanismo que a spec da 8.1 deixou em aberto.
   * `interactiveWidget: "resizes-content"` no `layout.tsx` seria uma linha e
   * consertaria a revisão de brinde, mas perde no critério declarado: o chat
   * mora **na tela de gravar**, onde a bola minimizada é posicionada por
   * `translateY(calc(3.75rem - 50dvh))` e o halo e as gavetas medem em `dvh`.
   * Encolher o viewport de layout mexeria em todos eles com o teclado subindo,
   * na tela onde a bola está visível. Este caminho não sai da caixa.
   *
   * O `scrollIntoView` acompanha porque a área de mensagens não rebobina
   * sozinha quando a caixa encolhe: sem ele, o teclado sobe e a última resposta
   * fica acima do corte. A guarda do valor igual é o que segura o jitter da
   * barra do navegador aparecendo e sumindo.
   */
  useEffect(() => {
    const visual = typeof window === "undefined" ? null : window.visualViewport;
    if (!aberto || !visual) return;

    let anterior = -1;
    const medir = () => {
      const coberto = Math.max(
        0,
        Math.round(window.innerHeight - visual.height - visual.offsetTop),
      );
      if (coberto === anterior) return;
      anterior = coberto;
      caixa.current?.style.setProperty("--teclado", `${coberto}px`);
      fim.current?.scrollIntoView({ block: "end" });
    };

    medir();
    visual.addEventListener("resize", medir);
    visual.addEventListener("scroll", medir);
    return () => {
      visual.removeEventListener("resize", medir);
      visual.removeEventListener("scroll", medir);
      caixa.current?.style.removeProperty("--teclado");
    };
  }, [aberto]);

  // A lista chega ao abrir, e não antes: a tela de gravar não consulta nada por
  // conta própria — mesma disciplina da sugestão de calibrar na `Gestao`.
  //
  // Ela chega, e **nenhuma conversa é aberta com ela**: a lista é o caminho de
  // volta, não o que abre por padrão (ver o efeito acima).
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;

    void (async () => {
      try {
        const r = await fetch("/api/conversas", { cache: "no-store" });
        if (!r.ok) throw new Error(`/api/conversas respondeu ${r.status}`);
        const d = (await r.json()) as { conversas: Conversa[] };
        if (!vivo) return;
        setConversas(d.conversas);
        setListaLida(true);
      } catch (e) {
        console.error("[chat]", e);
        if (vivo) setProblema("não consegui listar as conversas");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [aberto]);

  // Esc fecha, como na gaveta da `Gestao`. Enquanto o agente responde ele para
  // a geração em vez de fechar: sair no meio perderia a resposta que já custou.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (parada.current) parada.current.abort();
      else {
        fechouPorTeclado.current = true;
        aoFechar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);

  useEffect(() => {
    if (aberto && vista === "conversa") campo.current?.focus();
  }, [aberto, vista]);

  /**
   * A rolagem respeita quem está relendo (`Specs/interface-onda-3.md`, decisão
   * 14). No fim, a lista segue a resposta chegando, como sempre. Mais acima, ela
   * fica parada e aparece "↓ resposta nova" no pé — puxar a tela de volta ao
   * fim a cada passo que chega, enquanto eu leio a resposta de antes, era tirar
   * a linha de debaixo do olho.
   */
  useEffect(() => {
    if (rolarJa.current || noFim.current) {
      rolarJa.current = false;
      // Dito aqui, e não só no `onScroll`: lista que não transborda não rola, e
      // o valor velho de outra conversa ficaria valendo.
      noFim.current = true;
      fim.current?.scrollIntoView({ block: "end" });
      setNovidade(false);
    } else if (mensagens.length > 0 || passos.length > 0) {
      setNovidade(true);
    }
  }, [mensagens, passos]);

  const aoRolar = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM_PX;
    if (noFim.current) setNovidade(false);
  }, []);

  // Um som tocando sem o botão que o para à vista é microfone de outro: fechar
  // o (i), trocar de conversa ou fechar o chat para o tocador.
  useEffect(() => {
    pararDeTocar();
  }, [rastroAberto, aberto, vista, aberta?.id, pararDeTocar]);

  // O "apagar?" armado desarma sozinho: um segundo toque minutos depois não é
  // o segundo toque de nada.
  useEffect(() => {
    if (armadoApagar === null) return;
    const t = setTimeout(() => setArmadoApagar(null), DESARME_MS);
    return () => clearTimeout(t);
  }, [armadoApagar]);

  const enviar = useCallback(async () => {
    const texto = rascunho.trim();
    if (texto === "" || enviando) return;

    const controle = new AbortController();
    parada.current = controle;
    setEnviando(true);
    setProblema(null);
    setPassos([]);
    setRascunho("");
    rolarJa.current = true;
    setMensagens((m) => [...m, { papel: "eu", texto, criado_em: new Date().toISOString() }]);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversa_id: aberta?.id, texto }),
        signal: controle.signal,
      });
      if (!r.ok || !r.body) {
        const d = (await r.json().catch(() => null)) as { erro?: string } | null;
        // O status cru vai para o log; na tela, a frase.
        console.error(`[chat] /api/chat respondeu ${r.status}`);
        throw new Error(d?.erro ?? "não consegui responder");
      }

      // O id vive aqui, e não no estado: numa conversa nova ele só existe
      // depois do primeiro evento, e `aberta` dentro deste fecho é o valor de
      // antes do envio — o título chegaria e não acharia a linha para renomear.
      let idAtual = aberta?.id ?? "";

      await lerEventos<Evento>(
        r.body,
        (e) => {
          if (e.tipo === "conversa") {
            idAtual = e.conversa.id;
            setAberta(e.conversa);
            setConversas((cs) =>
              cs.some((c) => c.id === e.conversa.id) ? cs : [e.conversa, ...cs],
            );
          } else if (e.tipo === "passo") {
            setPassos((p) => [...p, e.passo]);
          } else if (e.tipo === "resposta") {
            setMensagens((m) => [...m, e.mensagem]);
            setPassos([]);
          } else if (e.tipo === "titulo") {
            setAberta((c) => (c ? { ...c, titulo: e.titulo } : c));
            setConversas((cs) =>
              cs.map((c) => (c.id === idAtual ? { ...c, titulo: e.titulo } : c)),
            );
          } else if (e.tipo === "erro") {
            setProblema(e.erro);
          }
        },
        "chat",
      );
    } catch (e) {
      if (controle.signal.aborted) {
        // Parar é uma decisão, não um erro: a pergunta já ficou gravada e a
        // resposta simplesmente não veio.
        setProblema(null);
      } else {
        console.error("[chat]", e);
        setProblema(e instanceof Error ? e.message : "não consegui responder");
      }
    } finally {
      parada.current = null;
      setEnviando(false);
      setPassos([]);
    }
  }, [aberta, enviando, rascunho]);

  const abrirConversa = useCallback(
    async (c: Conversa) => {
      parada.current?.abort();
      setVista("conversa");
      setPassos([]);
      setRastroAberto(null);
      setNovidade(false);
      await carregarMensagens(c.id);
    },
    [carregarMensagens],
  );

  const arquivar = useCallback(
    async (c: Conversa) => {
      const alvo = c.arquivada_em === null;
      try {
        const r = await fetch(`/api/conversas/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ arquivada: alvo }),
        });
        if (!r.ok) throw new Error(`/api/conversas respondeu ${r.status}`);
        const d = (await r.json()) as { conversa: Conversa };
        setConversas((cs) => cs.map((x) => (x.id === c.id ? d.conversa : x)));
        setAberta((a) => (a?.id === c.id ? d.conversa : a));
      } catch (e) {
        console.error("[chat]", e);
        setProblema("não consegui arquivar a conversa");
      }
    },
    [],
  );

  const apagar = useCallback(
    async (c: Conversa) => {
      // Dois toques na própria tela, como o apagar de sessão e o "reprocessar
      // tudo" de `/confronto` (decisão 13): apagar conversa não se desfaz. Era
      // o `confirm()` do navegador — a única janela nativa do sistema, e a que
      // menos parecia com ele.
      if (armadoApagar !== c.id) {
        setArmadoApagar(c.id);
        return;
      }
      setArmadoApagar(null);
      try {
        const r = await fetch(`/api/conversas/${c.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`/api/conversas respondeu ${r.status}`);
        setConversas((cs) => cs.filter((x) => x.id !== c.id));
        if (aberta?.id === c.id) {
          setAberta(null);
          setMensagens([]);
        }
      } catch (e) {
        console.error("[chat]", e);
        setProblema("não consegui apagar a conversa");
      }
    },
    [aberta, armadoApagar],
  );

  const { ativas, arquivadas } = separarConversas(conversas);
  const primeiraPergunta = mensagens.find((m) => m.papel === "eu")?.texto;

  return (
    <section ref={caixa} className={`chat ${aberto ? "aberto" : ""}`}>
      {!aberto && (
        <button ref={barra} className="barra" onClick={aoAbrir} aria-label="perguntar ao diário">
          {/* Só três pontos, por pedido: a barra convida sem prometer assunto.
              Um `<input>` aqui mentiria — ela abre o painel, não recebe texto. */}
          <span className="dica" aria-hidden="true">
            ...
          </span>
        </button>
      )}

      {/* `saindo` mantém o painel montado enquanto a caixa encolhe de volta até a
          barra; `inert` tira do caminho o que já não é mais alcançável. */}
      {(aberto || saindo) && (
        // `role="dialog"`: sem papel, o `aria-label` de um `div` é ignorado.
        // Não é modal — o círculo continua tocável por cima.
        <div className="painel" role="dialog" aria-label="conversa sobre o diário" inert={!aberto}>
          <header>
            {vista === "conversa" ? (
              <button className="icone" onClick={() => setVista("lista")} aria-label="conversas">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
              </button>
            ) : (
              <button className="icone" onClick={() => setVista("conversa")} aria-label="voltar">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
            )}

            <h2>
              {vista === "lista"
                ? "conversas"
                : aberta
                  ? rotuloDaConversa(aberta, primeiraPergunta)
                  : "nova conversa"}
            </h2>

            <button className="icone" onClick={nova} aria-label="nova conversa">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              className="icone fechar"
              onClick={(e) => {
                fechouPorTeclado.current = e.detail === 0;
                aoFechar();
              }}
              aria-label="fechar"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {vista === "lista" ? (
            <div className="corpo lista-conversas">
              {problema && (
                <p className="aviso erro" role="alert">
                  {problema}
                </p>
              )}
              {listaLida && ativas.length === 0 && (
                <p className="aguardando">
                  {arquivadas.length > 0 ? "nenhuma conversa ativa." : "nenhuma conversa ainda."}
                </p>
              )}
              <ul>
                {ativas.map((c) => (
                  <LinhaDaConversa
                    key={c.id}
                    conversa={c}
                    atual={c.id === aberta?.id}
                    armado={armadoApagar === c.id}
                    aoAbrir={() => void abrirConversa(c)}
                    aoArquivar={() => void arquivar(c)}
                    aoApagar={() => void apagar(c)}
                    aoDesarmar={() => setArmadoApagar((a) => (a === c.id ? null : a))}
                  />
                ))}
              </ul>

              {arquivadas.length > 0 && (
                <>
                  <button
                    className="separador"
                    onClick={() => setMostrarArquivadas((v) => !v)}
                    aria-expanded={mostrarArquivadas}
                  >
                    arquivadas ({arquivadas.length})
                  </button>
                  {mostrarArquivadas && (
                    <ul>
                      {arquivadas.map((c) => (
                        <LinhaDaConversa
                          key={c.id}
                          conversa={c}
                          atual={c.id === aberta?.id}
                          armado={armadoApagar === c.id}
                          aoAbrir={() => void abrirConversa(c)}
                          aoArquivar={() => void arquivar(c)}
                          aoApagar={() => void apagar(c)}
                          aoDesarmar={() => setArmadoApagar((a) => (a === c.id ? null : a))}
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="corpo mensagens" onScroll={aoRolar}>
                {mensagens.length === 0 && !enviando && (
                  <p className="aguardando">
                    pergunte o que quiser sobre o que você já registrou.
                  </p>
                )}

                {mensagens.map((m, i) => (
                  <article key={`${m.criado_em}-${i}`} className={`fala ${m.papel}`}>
                    <p>{m.texto}</p>
                    {m.papel === "agente" && (m.rastro?.length ?? 0) > 0 && (
                      <>
                        <button
                          className="porque"
                          aria-label="de onde veio esta resposta"
                          aria-expanded={rastroAberto === `${i}`}
                          onClick={() => setRastroAberto((a) => (a === `${i}` ? null : `${i}`))}
                        >
                          i
                        </button>
                        {rastroAberto === `${i}` && (
                          <Origem passos={m.rastro ?? []} tocador={tocador} />
                        )}
                      </>
                    )}
                  </article>
                ))}

                {enviando && (
                  <div className="progresso" role="status">
                    {passos.map((p, i) => (
                      <span key={i}>{frasePasso(p)}</span>
                    ))}
                    <span className="pensando">
                      {passos.length === 0 ? "procurando…" : "escrevendo…"}
                    </span>
                  </div>
                )}

                {novidade && (
                  <button
                    className="botao novidade"
                    onClick={() => {
                      setNovidade(false);
                      fim.current?.scrollIntoView({ block: "end" });
                    }}
                  >
                    ↓ resposta nova
                  </button>
                )}

                <div ref={fim} />
              </div>

              {problema && (
                <p className="aviso erro" role="alert">
                  {problema}
                </p>
              )}

              {aberta?.arquivada_em ? (
                <p className="aviso">
                  conversa arquivada — só leitura.{" "}
                  <button className="ligacao" onClick={() => void arquivar(aberta)}>
                    desarquivar
                  </button>
                </p>
              ) : (
                <form
                  className="escrever"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void enviar();
                  }}
                >
                  <textarea
                    ref={campo}
                    value={rascunho}
                    rows={1}
                    placeholder="pergunte alguma coisa"
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter manda, Shift+Enter quebra linha — no telefone o
                      // teclado manda, e é o gesto que todo mundo já tem no dedo.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void enviar();
                      }
                    }}
                  />
                  {enviando ? (
                    <button
                      type="button"
                      className="parar"
                      onClick={() => parada.current?.abort()}
                    >
                      parar
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="mandar"
                      aria-label="mandar"
                      disabled={rascunho.trim() === ""}
                    >
                      ↑
                    </button>
                  )}
                </form>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function LinhaDaConversa({
  conversa,
  atual,
  armado,
  aoAbrir,
  aoArquivar,
  aoApagar,
  aoDesarmar,
}: {
  conversa: Conversa;
  atual: boolean;
  /** O primeiro toque do apagar já veio; o próximo apaga. */
  armado: boolean;
  aoAbrir: () => void;
  aoArquivar: () => void;
  aoApagar: () => void;
  aoDesarmar: () => void;
}) {
  const arquivada = conversa.arquivada_em !== null;
  return (
    <li className={`${atual ? "atual" : ""} ${arquivada ? "arquivada" : ""}`}>
      <button className="titulo" onClick={aoAbrir}>
        <span>{rotuloDaConversa(conversa)}</span>
        <span className="meta">{dataCurta(conversa.atualizada_em)}</span>
      </button>
      <button className="acao" onClick={aoArquivar}>
        {arquivada ? "desarquivar" : "arquivar"}
      </button>
      <button
        className={`acao apagar${armado ? " armado" : ""}`}
        onClick={aoApagar}
        onBlur={() => armado && aoDesarmar()}
        aria-label={
          armado ? `apagar "${rotuloDaConversa(conversa)}" de vez? toque de novo — não tem volta` : undefined
        }
      >
        {armado ? "apagar?" : "apagar"}
      </button>
    </li>
  );
}

/**
 * O (i): a origem da resposta (`Specs/interface-onda-3.md`, decisão 11).
 *
 * **Abre pelos trechos** — cada átomo que as chamadas trouxeram, uma vez só,
 * com o tipo, a data e o ▶ do mesmo tocador da revisão. É a pergunta que eu
 * faço ao (i) quase sempre: *de onde saiu isso*, e ouvir é a resposta que
 * confere. Os trechos citados sob a própria resposta foram recusados: pediriam
 * contrato novo no prompt, para o modelo dizer quais usou.
 *
 * **O técnico fica inteiro, dobrado** sob "como procurei": cada chamada, os
 * parâmetros, o recorte, a similaridade, as fichas, o retrato e a Cypher. Sem
 * trecho nenhum — a resposta só leu fichas ou linhas —, ele já abre aberto, que
 * um toque para ver um botão seria toque à toa.
 */
function Origem({
  passos,
  tocador,
}: {
  passos: readonly PassoDeFerramenta[];
  tocador: ReturnType<typeof useTocador>;
}) {
  const trechos = trechosDoRastro(passos);
  const [comoAberto, setComoAberto] = useState(false);
  const tecnicoAberto = trechos.length === 0 || comoAberto;

  return (
    <div className="rastro">
      {trechos.length > 0 && (
        <ul className="trechos">
          {trechos.map((a) => {
            const sessao_id = sessaoDoAtomo(a.id);
            const inicio_s = a.inicio_s;
            const estado = tocador.estadoDe(a.id);
            return (
              <li key={a.id}>
                <span className="topo">
                  <span className="meta">
                    {rotuloDoTipo(a.tipo)}
                    {dataCurta(a.valido_em) === "" ? "" : ` · ${dataCurta(a.valido_em)}`}
                  </span>
                  {/* Sem o segundo — átomo sem âncora, ou mensagem gravada antes
                      de o rastro guardá-lo — o trecho fica sem ▶, e não com um
                      "sem áudio" que diria que o áudio sumiu. */}
                  {sessao_id !== null && typeof inicio_s === "number" && (
                    <button
                      className={`botao ouvir${estado ? ` ${estado}` : ""}`}
                      aria-label={nomeDoOuvir(estado, inicio_s)}
                      onClick={() =>
                        void tocador.tocar(a.id, { sessao_id, inicio_s, fim_s: a.fim_s ?? null })
                      }
                    >
                      {textoDoOuvir(estado, inicio_s, a.fim_s ?? null)}
                    </button>
                  )}
                </span>
                <span>{a.texto}</span>
              </li>
            );
          })}
        </ul>
      )}
      {trechos.length > 0 && (
        <button
          className="botao discreto como"
          aria-expanded={comoAberto}
          onClick={() => setComoAberto((v) => !v)}
        >
          como procurei {comoAberto ? "▾" : "▸"}
        </button>
      )}
      {tecnicoAberto && <ComoProcurei passos={passos} />}
    </div>
  );
}

/**
 * A consulta de `consultar_grafo` no (i) (slice 12): o sentido que virou
 * `$vetor`, os avisos do banco, a Cypher como o modelo a escreveu e as linhas que
 * ele leu. Nasce também na recusa e na falha — a Cypher é o que explica o erro.
 *
 * **As linhas vêm recolhidas.** Só a Cypher e a contagem obrigariam a rodar a
 * consulta de novo para auditar o que o modelo leu; tudo aberto, três consultas
 * de cinquenta linhas viram uma rolagem longa. Um toque abre.
 *
 * A tabela rola dentro da própria caixa: a página não ganha rolagem horizontal
 * no celular.
 */
function BlocoDaConsulta({ consulta: c }: { consulta: ConsultaNoRastro }) {
  const [linhasAbertas, setLinhasAbertas] = useState(false);
  return (
    <div className="consulta">
      {c.texto && <p className="meta">sentido: “{c.texto}”</p>}
      {c.avisos?.map((a, i) => (
        <p key={i} className="meta">
          aviso do banco: {a}
        </p>
      ))}
      <pre className="cypher">
        <code>{c.cypher}</code>
      </pre>
      {c.linhas.length > 0 && (
        <button
          className="botao discreto"
          aria-expanded={linhasAbertas}
          onClick={() => setLinhasAbertas((v) => !v)}
        >
          {rotuloDasLinhas(c, linhasAbertas)}
        </button>
      )}
      {linhasAbertas && c.linhas.length > 0 && (
        // Rola por dentro; o `tabIndex` deixa rolar pelo teclado também.
        <div className="tabela-consulta" role="region" aria-label="as linhas que o modelo leu" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {c.colunas.map((col, j) => (
                  <th key={j} scope="col">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.linhas.map((l, i) => (
                <tr key={i}>
                  {l.map((v, j) => (
                    <td key={j}>{celulaDoRastro(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * O rastro técnico do (i): cada chamada, o que foi pedido, e o que voltou.
 *
 * **Completo, e não uma lista plana dos átomos citados.** Com até oito chamadas
 * encadeadas, saber *por que* um átomo apareceu é o que separa uma resposta que
 * eu posso conferir de uma que eu tenho de acreditar.
 */
function ComoProcurei({ passos }: { passos: readonly PassoDeFerramenta[] }) {
  return (
    <div className="como-procurei">
      {passos.map((p, i) => (
        <div key={i} className="passo">
          <p className="cabecalho">
            <code>{p.ferramenta}</code> {frasePasso(p)}
          </p>
          {fraseRecorte(p) !== "" && <p className="meta">{fraseRecorte(p)}</p>}
          {p.erro && <p className="meta">{p.erro}</p>}
          {p.consulta && <BlocoDaConsulta consulta={p.consulta} />}
          {p.retrato && p.retrato.texto !== "" && (
            <p className="meta">
              {p.retrato.nome}
              {mesAno(diaLocal(p.retrato.ate)) === "" ? "" : ` · até ${mesAno(diaLocal(p.retrato.ate))}`}:{" "}
              {p.retrato.texto}
            </p>
          )}
          <ul>
            {p.achados.map((a) => (
              <li key={a.id}>
                <span className="meta">
                  {rotuloDoTipo(a.tipo)}
                  {dataCurta(a.valido_em) === "" ? "" : ` · ${dataCurta(a.valido_em)}`}
                  {a.sobre.length > 0 ? ` · ${a.sobre.join(", ")}` : ""}
                  {typeof a.similaridade === "number"
                    ? ` · ${a.similaridade.toFixed(2)}`
                    : ""}
                </span>
                <span>{a.texto}</span>
              </li>
            ))}
          </ul>
          {(p.entidades?.length ?? 0) > 0 && (
            <ul>
              {p.entidades?.map((e) => (
                <li key={e.id}>
                  <span className="meta">
                    {e.nome} · {e.tipo.toLowerCase()} · {e.atomos} trecho{e.atomos === 1 ? "" : "s"}
                    {e.ultima === "" ? "" : ` · até ${e.ultima}`}
                    {typeof e.similaridade === "number" ? ` · ${e.similaridade.toFixed(2)}` : ""}
                  </span>
                  <span>{e.resumo || e.perfil.contexto || "ficha vazia"}</span>
                  {e.junto_com.length > 0 && (
                    <span className="meta">
                      junto com {e.junto_com.map((j) => `${j.nome} (${j.vezes})`).join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(p.elos?.length ?? 0) > 0 && (
            <ul className="elos">
              {p.elos?.map((e, j) => (
                <li key={j}>
                  <span className="meta">{e.tipo.toLowerCase()}</span>
                  <span>{e.motivo}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
