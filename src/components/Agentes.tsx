"use client";

/**
 * O painel dos agentes: o fluxo desenhado, e cada caixa abrindo o que a comanda.
 *
 * **Por que um desenho e não uma lista.** Sete agentes numa lista não dizem que
 * a resolução roda dentro da extração, que a regra que eu aprovo volta para o
 * prompt do extrator, nem que existe exatamente um nó humano no meio de tudo —
 * e é esse nó que a regra 5 protege. A lista descreve; o desenho explica.
 *
 * **Vertical, e não um canvas horizontal de n8n.** Este app vive no celular. Um
 * quadro que se arrasta e se dá zoom é confortável no monitor e inútil no
 * telefone; três colunas que descem cabem nos dois. O caminho principal desce
 * pelo meio, e o que é ramo fica nas laterais.
 *
 * **Nenhuma dependência entrou.** As caixas são uma grade CSS posicionada pelo
 * `linha`/`coluna` que `agentes.ts` declara, e as setas são um `<svg>` por cima,
 * medido do DOM. Mesma escolha do `SeletorEntidade`, que foi escrito à mão em
 * vez de trazer um combobox de biblioteca: o grafo aqui é fixo e pequeno, e um
 * motor de pan/zoom seria pagar por um problema que este desenho não tem.
 *
 * A gaveta de edição é a mesma forma do menu de gestão — véu que fecha ao toque,
 * Esc, e o foco entrando e voltando. Quem edita prompt de madrugada merece Esc.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgenteNaTela } from "@/lib/agentes";
import type { ArestaDoFluxo, NoDoFluxo } from "@/lib/agentes";
import type { AgenteId, QuandoRoda } from "@/lib/tipos";

interface Dados {
  agentes: AgenteNaTela[];
  fluxo: { nos: NoDoFluxo[]; arestas: ArestaDoFluxo[] };
  atualizado_em: string | null;
}

/** O selo de quando. Três palavras, e a diferença é o que o agente custa. */
const QUANDO: Record<QuandoRoda, string> = {
  automatico: "automático",
  condicional: "condicional",
  sob_demanda: "sob demanda",
};

// ───────────────────────────── as setas ─────────────────────────────

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Traco {
  chave: string;
  d: string;
  volta: boolean;
  rotulo?: string;
  rx: number;
  ry: number;
}

/**
 * O caminho de uma seta, em pixels do palco.
 *
 * Três formas, e cada uma existe por um motivo de leitura:
 *
 *   mesma linha   reta horizontal — o vocabulário entrando no STT de lado
 *   descendo      cotovelo: desce, atravessa, desce. Nunca diagonal: diagonal
 *                 em grade cruza as caixas vizinhas e fica ilegível
 *   voltando      curva pontilhada por fora da grade. Realimentação é o que
 *                 este sistema tem de mais difícil de enxergar, e ela merece
 *                 traço próprio em vez de virar mais uma reta no meio do bolo
 */
export function tracar(a: Caixa, b: Caixa, volta: boolean, largura: number): { d: string; rx: number; ry: number } {
  const meioAx = a.x + a.w / 2;
  const meioBx = b.x + b.w / 2;

  if (volta) {
    // Sai pela borda mais próxima da parede e sobe por fora. O lado é o da
    // caixa de origem: assim a curva não atravessa o miolo do desenho.
    const paraDireita = meioAx > largura / 2;
    const saida = paraDireita ? a.x + a.w : a.x;
    const entrada = paraDireita ? b.x + b.w : b.x;
    const parede = paraDireita ? Math.min(largura - 4, saida + 46) : Math.max(4, saida - 46);
    const ya = a.y + a.h / 2;
    const yb = b.y + b.h / 2;
    return {
      d: `M ${saida} ${ya} C ${parede} ${ya}, ${parede} ${yb}, ${entrada} ${yb}`,
      rx: parede,
      ry: (ya + yb) / 2,
    };
  }

  const mesmaAltura = Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2;
  if (mesmaAltura) {
    const daEsquerda = meioAx < meioBx;
    const x1 = daEsquerda ? a.x + a.w : a.x;
    const x2 = daEsquerda ? b.x : b.x + b.w;
    const y = a.y + a.h / 2;
    return { d: `M ${x1} ${y} L ${x2} ${y}`, rx: (x1 + x2) / 2, ry: y };
  }

  const y1 = a.y + a.h;
  const y2 = b.y;
  const meio = y1 + (y2 - y1) / 2;
  const d =
    Math.abs(meioAx - meioBx) < 2
      ? `M ${meioAx} ${y1} L ${meioBx} ${y2}`
      : `M ${meioAx} ${y1} L ${meioAx} ${meio} L ${meioBx} ${meio} L ${meioBx} ${y2}`;
  return { d, rx: (meioAx + meioBx) / 2, ry: meio };
}

// ───────────────────────────── a tela ─────────────────────────────

export function Agentes() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [aberto, setAberto] = useState<AgenteId | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/agentes", { cache: "no-store" });
      const j = (await r.json()) as Dados & { erro?: string };
      if (!r.ok) throw new Error(j.erro ?? "não consegui ler os agentes");
      setDados(j);
      setFalha(null);
    } catch (e) {
      setFalha(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (falha) {
    return (
      <main className="leitura">
        <h1>agentes</h1>
        <p className="aguardando">{falha}</p>
      </main>
    );
  }

  if (!dados) {
    return (
      <main className="leitura">
        <h1>agentes</h1>
        <p className="aguardando">…</p>
      </main>
    );
  }

  const porId = new Map(dados.agentes.map((a) => [a.id, a]));
  const editando = aberto ? porId.get(aberto) : undefined;

  const comOverride = dados.agentes.filter((a) => a.promptEditado || a.modeloEditado).length;

  return (
    <main className="agentes">
      <header>
        <h1>quem faz o trabalho</h1>
        <p className="aguardando">
          {comOverride === 0
            ? "tudo na base do git — nenhum prompt e nenhum modelo foi tocado por aqui"
            : `${comOverride} ${comOverride === 1 ? "agente editado" : "agentes editados"} · o resto está na base do git`}
        </p>
      </header>

      {/* Rola na horizontal quando não couber, em vez de esmagar as caixas:
          diagrama espremido não é diagrama responsivo, é diagrama ilegível. */}
      <div className="palco-fluxo">
        <Fluxo
          nos={dados.fluxo.nos}
          arestas={dados.fluxo.arestas}
          porId={porId}
          aoAbrir={setAberto}
        />
      </div>

      <p className="rodape-fluxo">
        Toda chamada de modelo deste sistema está aqui, e todas saem pelo Vercel AI Gateway.
        Clique numa caixa de agente para ver e editar o que a comanda.
      </p>

      {editando && (
        <Editor
          a={editando}
          aoFechar={() => setAberto(null)}
          aoSalvar={async (corpo) => {
            const r = await fetch(`/api/agentes/${editando.id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(corpo),
            });
            const j = (await r.json()) as { erro?: string };
            if (!r.ok) throw new Error(j.erro ?? "não consegui gravar");
            await carregar();
          }}
        />
      )}
    </main>
  );
}

// ───────────────────────────── o desenho ─────────────────────────────

function Fluxo({
  nos,
  arestas,
  porId,
  aoAbrir,
}: {
  nos: NoDoFluxo[];
  arestas: ArestaDoFluxo[];
  porId: Map<AgenteId, AgenteNaTela>;
  aoAbrir: (id: AgenteId) => void;
}) {
  const palco = useRef<HTMLDivElement | null>(null);
  const caixas = useRef(new Map<string, HTMLElement>());
  const [tracos, setTracos] = useState<Traco[]>([]);
  const [tamanho, setTamanho] = useState({ w: 0, h: 0 });

  const medir = useCallback(() => {
    const alvo = palco.current;
    if (!alvo) return;

    const base = alvo.getBoundingClientRect();
    const de = (id: string): Caixa | null => {
      const el = caixas.current.get(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    };

    setTamanho({ w: base.width, h: base.height });
    setTracos(
      arestas.flatMap((e) => {
        const a = de(e.de);
        const b = de(e.para);
        if (!a || !b) return [];
        const { d, rx, ry } = tracar(a, b, e.volta === true, base.width);
        return [{ chave: `${e.de}→${e.para}`, d, volta: e.volta === true, rotulo: e.rotulo, rx, ry }];
      }),
    );
  }, [arestas]);

  // `useLayoutEffect` e não `useEffect`: medir depois da pintura faria as setas
  // aparecerem um quadro atrasadas, e num celular isso se vê.
  useLayoutEffect(() => {
    medir();
  }, [medir, nos]);

  useEffect(() => {
    const alvo = palco.current;
    if (!alvo || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => medir());
    obs.observe(alvo);
    // A fonte carregando depois muda a altura das caixas — sem isto as setas
    // ficam apontando para onde as caixas estavam.
    document.fonts?.ready.then(() => medir()).catch(() => {});
    return () => obs.disconnect();
  }, [medir]);

  const guardar = (id: string) => (el: HTMLElement | null) => {
    if (el) caixas.current.set(id, el);
    else caixas.current.delete(id);
  };

  return (
    <div className="fluxo" ref={palco}>
      <svg
        className="arestas"
        width={tamanho.w}
        height={tamanho.h}
        viewBox={`0 0 ${tamanho.w} ${tamanho.h}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <marker
            id="ponta"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0 0 L6 3 L0 6 z" />
          </marker>
        </defs>
        {tracos.map((t) => (
          <g key={t.chave} className={t.volta ? "volta" : undefined}>
            <path d={t.d} markerEnd="url(#ponta)" />
            {t.rotulo && (
              <text x={t.rx} y={t.ry} dy="-0.35em" textAnchor="middle">
                {t.rotulo}
              </text>
            )}
          </g>
        ))}
      </svg>

      {nos.map((n) => {
        const a = n.agente ? porId.get(n.agente) : undefined;
        const estilo = { gridColumn: n.coluna, gridRow: n.linha };

        if (!a) {
          return (
            <div
              key={n.id}
              ref={guardar(n.id)}
              className={`no ${n.tipo}`}
              style={estilo}
              title={n.nota}
            >
              <span className="rotulo">{n.rotulo}</span>
              {n.nota && <span className="nota">{n.nota}</span>}
            </div>
          );
        }

        return (
          <button
            key={n.id}
            ref={guardar(n.id)}
            type="button"
            className={`no agente${a.promptEditado || a.modeloEditado ? " editado" : ""}`}
            style={estilo}
            onClick={() => aoAbrir(a.id)}
          >
            <span className="rotulo">
              {a.rotulo}
              {(a.promptEditado || a.modeloEditado) && <i className="marca" aria-label="editado" />}
            </span>
            <span className="modelo">{a.modelo}</span>
            <span className={`quando ${a.quando}`}>{QUANDO[a.quando]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── o editor ─────────────────────────────

function Editor({
  a,
  aoFechar,
  aoSalvar,
}: {
  a: AgenteNaTela;
  aoFechar: () => void;
  aoSalvar: (corpo: { prompt?: string | null; modelo?: string | null }) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(a.prompt ?? "");
  const [modelo, setModelo] = useState(a.modelo);
  const [editandoPrompt, setEditandoPrompt] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gaveta = useRef<HTMLElement | null>(null);

  // Trocar de agente com a gaveta aberta tem de recarregar os campos; sem isto o
  // texto do agente anterior ficaria na tela sobre o nome do novo.
  useEffect(() => {
    setPrompt(a.prompt ?? "");
    setModelo(a.modelo);
    setEditandoPrompt(false);
    setErro(null);
  }, [a]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    gaveta.current?.querySelector<HTMLElement>("button, input, textarea")?.focus();
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const promptMudou = a.prompt !== null && prompt.trim() !== (a.prompt ?? "").trim();
  const modeloMudou = modelo.trim() !== a.modelo;
  const podeSalvar = (promptMudou || modeloMudou) && !gravando;

  async function salvar(corpo: { prompt?: string | null; modelo?: string | null }) {
    setGravando(true);
    setErro(null);
    try {
      await aoSalvar(corpo);
      setEditandoPrompt(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <>
      <div className="veu aberto" onClick={aoFechar} />
      <aside className="editor-agente aberta" ref={gaveta} aria-label={`agente ${a.rotulo}`}>
        <header>
          <div>
            <h2>{a.rotulo}</h2>
            <p className="versao">{a.versao ?? "sem prompt — só modelo"}</p>
          </div>
          <button type="button" className="fechar" onClick={aoFechar} aria-label="fechar">
            ×
          </button>
        </header>

        <p className="papel">{a.papel}</p>
        <p className="gatilho">
          <span className={`quando ${a.quando}`}>{QUANDO[a.quando]}</span> {a.gatilho}
        </p>

        {/* ── o modelo ── */}
        <section className="campo">
          <label htmlFor={`modelo-${a.id}`}>modelo</label>
          {a.modeloEditavel ? (
            <>
              <input
                id={`modelo-${a.id}`}
                value={modelo}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => setModelo(e.target.value)}
                placeholder={a.modeloPadrao}
              />
              <p className="dica">
                padrão <code>{a.modeloPadrao}</code>, de <code>{a.variavel}</code>
                {a.modeloEditado && " · você trocou por aqui"}
              </p>
            </>
          ) : (
            <p className="dica travado">
              <code>{a.modelo}</code> — {a.travado}
            </p>
          )}

          {a.aceitaVocabulario === false && (
            <p className="alerta">
              Este provedor não tem canal de vocabulário: a lista de nomes próprios do grafo some
              sem avisar, e nome próprio errado custa mais que prosa torta neste sistema.
            </p>
          )}
        </section>

        {/* ── o prompt ── */}
        {a.prompt !== null && (
          <section className="campo prompt">
            <div className="cabecalho">
              <label htmlFor={`prompt-${a.id}`}>prompt</label>
              <button
                type="button"
                className="fraco"
                onClick={() => setEditandoPrompt((v) => !v)}
                disabled={gravando}
              >
                {editandoPrompt ? "só ler" : "editar"}
              </button>
            </div>
            <textarea
              id={`prompt-${a.id}`}
              value={prompt}
              readOnly={!editandoPrompt}
              spellCheck={false}
              rows={editandoPrompt ? 22 : 12}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="dica">
              {a.promptEditado
                ? "editado por aqui · o original continua no git, e o botão abaixo volta a ele"
                : "é o texto do git, byte a byte"}
            </p>
          </section>
        )}

        {erro && <p className="alerta">{erro}</p>}

        <footer>
          <button
            type="button"
            className="principal"
            disabled={!podeSalvar}
            onClick={() =>
              salvar({
                ...(promptMudou ? { prompt } : {}),
                ...(modeloMudou ? { modelo: modelo.trim() } : {}),
              })
            }
          >
            {gravando ? "gravando…" : "salvar"}
          </button>
          {(a.promptEditado || a.modeloEditado) && (
            <button
              type="button"
              className="fraco"
              disabled={gravando}
              onClick={() => salvar({ prompt: a.prompt === null ? undefined : null, modelo: null })}
            >
              voltar ao original
            </button>
          )}
        </footer>

        <p className="dica final">
          Vale na próxima vez que este agente rodar — sem deploy. O que ele produzir vai carimbado
          com a versão do prompt que de fato usou.
        </p>
      </aside>
    </>
  );
}
