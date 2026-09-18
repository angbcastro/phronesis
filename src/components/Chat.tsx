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
 * As funções puras deste arquivo (`partirLinhas`, `frasePasso`,
 * `rotuloDaConversa`, `separarConversas`) são exportadas para
 * `tests/chat.test.ts`: elas são a lógica que erra calada — um NDJSON partido
 * no meio de um caractere, uma conversa sem título, um passo sem parâmetro.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usaTransicao } from "@/client/transicao";
import type { Conversa, Mensagem, PassoDeFerramenta } from "@/lib/tipos";

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

/**
 * Parte o que chegou do fluxo em linhas inteiras, guardando o resto.
 *
 * **O resto não é detalhe**: um chunk de rede corta onde quiser, inclusive no
 * meio de um `\n` ou de um caractere multibyte, e `JSON.parse` de meia linha
 * derruba a leitura inteira. É a única coisa deste arquivo que erraria em
 * silêncio — daí ela ser pura e testada.
 */
export function partirLinhas(acumulado: string): { linhas: string[]; resto: string } {
  const partes = acumulado.split("\n");
  const resto = partes.pop() ?? "";
  return { linhas: partes.filter((l) => l.trim() !== ""), resto };
}

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
  const n = p.achados.length;
  const quantos = p.erro ? p.erro : n === 0 ? "nada" : `${n} trecho${n === 1 ? "" : "s"}`;

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

/** `2026-09-13T...` → `13/09`. A lista mostra o dia, não a hora. */
export function diaCurto(iso: string): string {
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "";
}

// ─────────────────────────── o componente ───────────────────────────

type Vista = "lista" | "conversa";

export function Chat({ aberto, aoAbrir, aoFechar }: Props) {
  const [vista, setVista] = useState<Vista>("conversa");
  const [conversas, setConversas] = useState<Conversa[]>([]);
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

  const parada = useRef<AbortController | null>(null);
  const fim = useRef<HTMLDivElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  // A caixa inteira, para o teclado virtual poder encolhê-la — ver o efeito do
  // `visualViewport`.
  const caixa = useRef<HTMLElement | null>(null);
  // Sem isto, a montagem da página (fechada, e nunca aberta) contaria como um
  // fechamento e o painel piscaria inteiro por 384 ms na tela de gravar.
  const jaAbriu = useRef(false);

  const carregarMensagens = useCallback(async (id: string) => {
    setProblema(null);
    try {
      const r = await fetch(`/api/chat?conversa_id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`/api/chat respondeu ${r.status}`);
      const d = (await r.json()) as { conversa: Conversa; mensagens: Mensagem[] };
      setAberta(d.conversa);
      setMensagens(d.mensagens);
    } catch (e) {
      console.error("[chat]", e);
      setProblema("Não consegui abrir a conversa.");
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
    setVista("conversa");
  }, []);

  useEffect(() => {
    if (aberto) {
      jaAbriu.current = true;
      setSaindo(false);
      return;
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
      } catch (e) {
        console.error("[chat]", e);
        if (vivo) setProblema("Não consegui listar as conversas.");
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
      else aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);

  useEffect(() => {
    if (aberto && vista === "conversa") campo.current?.focus();
  }, [aberto, vista]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens, passos]);

  const enviar = useCallback(async () => {
    const texto = rascunho.trim();
    if (texto === "" || enviando) return;

    const controle = new AbortController();
    parada.current = controle;
    setEnviando(true);
    setProblema(null);
    setPassos([]);
    setRascunho("");
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
        throw new Error(d?.erro ?? `/api/chat respondeu ${r.status}`);
      }

      const leitor = r.body.getReader();
      const decodificador = new TextDecoder();
      let sobra = "";
      // O id vive aqui, e não no estado: numa conversa nova ele só existe
      // depois do primeiro evento, e `aberta` dentro deste fecho é o valor de
      // antes do envio — o título chegaria e não acharia a linha para renomear.
      let idAtual = aberta?.id ?? "";

      for (;;) {
        const { done, value } = await leitor.read();
        // `stream: true` é o que impede um caractere acentuado partido entre
        // dois chunks de virar "�" no meio de uma resposta em português.
        sobra += decodificador.decode(value ?? new Uint8Array(), { stream: !done });
        const { linhas, resto } = partirLinhas(sobra);
        sobra = resto;

        for (const linha of linhas) {
          let e: Evento;
          try {
            e = JSON.parse(linha) as Evento;
          } catch {
            console.error("[chat] linha que não é JSON:", linha.slice(0, 200));
            continue;
          }
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
        }

        if (done) break;
      }
    } catch (e) {
      if (controle.signal.aborted) {
        // Parar é uma decisão, não um erro: a pergunta já ficou gravada e a
        // resposta simplesmente não veio.
        setProblema(null);
      } else {
        console.error("[chat]", e);
        setProblema(e instanceof Error ? e.message : "Não consegui responder.");
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
        setProblema("Não consegui arquivar a conversa.");
      }
    },
    [],
  );

  const apagar = useCallback(
    async (c: Conversa) => {
      // Dois toques, como o "reprocessar tudo" de `/confronto`: esta é a única
      // deleção de verdade do sistema, e ela não se desfaz.
      if (!confirm(`Apagar "${rotuloDaConversa(c)}" de vez? Isso não tem volta.`)) return;
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
        setProblema("Não consegui apagar a conversa.");
      }
    },
    [aberta],
  );

  const { ativas, arquivadas } = separarConversas(conversas);
  const primeiraPergunta = mensagens.find((m) => m.papel === "eu")?.texto;

  return (
    <section ref={caixa} className={`chat ${aberto ? "aberto" : ""}`}>
      {!aberto && (
        <button className="barra" onClick={aoAbrir} aria-label="perguntar ao diário">
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
        <div className="painel" aria-label="conversa sobre o diário" inert={!aberto}>
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
            <button className="icone fechar" onClick={aoFechar} aria-label="fechar">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {vista === "lista" ? (
            <div className="corpo lista-conversas">
              {ativas.length === 0 && <p className="aguardando">nenhuma conversa ainda.</p>}
              <ul>
                {ativas.map((c) => (
                  <LinhaDaConversa
                    key={c.id}
                    conversa={c}
                    atual={c.id === aberta?.id}
                    aoAbrir={() => void abrirConversa(c)}
                    aoArquivar={() => void arquivar(c)}
                    aoApagar={() => void apagar(c)}
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
                          aoAbrir={() => void abrirConversa(c)}
                          aoArquivar={() => void arquivar(c)}
                          aoApagar={() => void apagar(c)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="corpo mensagens">
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
                        {rastroAberto === `${i}` && <Rastro passos={m.rastro ?? []} />}
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

                <div ref={fim} />
              </div>

              {problema && <p className="aviso">{problema}</p>}

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
                    <button type="submit" className="mandar" disabled={rascunho.trim() === ""}>
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
  aoAbrir,
  aoArquivar,
  aoApagar,
}: {
  conversa: Conversa;
  atual: boolean;
  aoAbrir: () => void;
  aoArquivar: () => void;
  aoApagar: () => void;
}) {
  const arquivada = conversa.arquivada_em !== null;
  return (
    <li className={`${atual ? "atual" : ""} ${arquivada ? "arquivada" : ""}`}>
      <button className="titulo" onClick={aoAbrir}>
        <span>{rotuloDaConversa(conversa)}</span>
        <span className="meta">{diaCurto(conversa.atualizada_em)}</span>
      </button>
      <button className="acao" onClick={aoArquivar}>
        {arquivada ? "desarquivar" : "arquivar"}
      </button>
      <button className="acao apagar" onClick={aoApagar}>
        apagar
      </button>
    </li>
  );
}

/**
 * O rastro do botão (i): cada chamada, o que foi pedido, e o que voltou.
 *
 * **Completo, e não uma lista plana dos átomos citados.** Com até oito chamadas
 * encadeadas, saber *por que* um átomo apareceu é o que separa uma resposta que
 * eu posso conferir de uma que eu tenho de acreditar.
 */
function Rastro({ passos }: { passos: readonly PassoDeFerramenta[] }) {
  return (
    <div className="rastro">
      {passos.map((p, i) => (
        <div key={i} className="passo">
          <p className="cabecalho">
            <code>{p.ferramenta}</code> {frasePasso(p)}
          </p>
          {p.erro && <p className="meta">{p.erro}</p>}
          <ul>
            {p.achados.map((a) => (
              <li key={a.id}>
                <span className="meta">
                  {a.tipo.toLowerCase()}
                  {a.valido_em === "" ? "" : ` · ${a.valido_em.slice(0, 10)}`}
                  {a.sobre.length > 0 ? ` · ${a.sobre.join(", ")}` : ""}
                  {typeof a.similaridade === "number"
                    ? ` · ${a.similaridade.toFixed(2)}`
                    : ""}
                </span>
                <span>{a.texto}</span>
              </li>
            ))}
          </ul>
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
