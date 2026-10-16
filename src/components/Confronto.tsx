"use client";

/**
 * Tela do agente `confronto` (slice 5, e desde a 5.2 o lugar onde ele aprende).
 *
 * **Duas vistas.** A lista — fila, "rodar agora", "reprocessar tudo", a busca
 * e os recém-processados — e o **radial** de um átomo: ele no centro, os
 * vizinhos em volta agrupados por tipo de relação, traço cheio para a camada
 * forte e pontilhado para a sutil, a seta apontando sempre para o mais antigo.
 * Tocar num vizinho recentra nele; "voltar" refaz o caminho.
 *
 * **O radial é instrumento de calibração, não de navegação** (entrevista de
 * 12/10). Tocar no rótulo de uma aresta abre a relação inteira e os gestos —
 * trocar tipo, trocar camada, reescrever o motivo, apagar. Toda edição congela
 * a relação (o agente nunca mais a toca) e vira correção do agente em
 * `/calibracao`. Apagar é recusa do par, para sempre, e por isso pede dois
 * toques — o único gesto daqui que não se desfaz voltando ao valor anterior.
 *
 * **SVG próprio, sem biblioteca**: um centro e no máximo algumas dezenas de
 * vizinhos não pedem simulação de forças, e o desenho tem de caber no celular.
 *
 * **Enquanto houver fila, a lista relê sozinha**, mesma decisão de
 * `/entidades`: fechar a aba não interrompe nada, só para de mostrar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AtomoRecente } from "@/lib/confronto";
import { dataCurta } from "@/lib/dia";
import { plural } from "@/lib/texto";
import { rotuloDoTipo } from "@/lib/tipos";
import type {
  AcaoNaRelacao,
  AtomoNoRadial,
  RadialDeAtomo,
  RelacaoNoRadial,
  TipoAtomo,
  TipoRelacaoConfronto,
} from "@/lib/tipos";

interface Estado {
  fila: number;
  recentes: AtomoRecente[];
}

interface Achado {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
}

/** O mesmo do corredor de entidades: rápido o bastante para parecer vivo, e barato. */
const INTERVALO_FILA_MS = 4000;

/** A ordem também é a do desenho: cada tipo ganha um quadrante, a partir do topo. */
const TIPOS: readonly TipoRelacaoConfronto[] = ["ATUALIZA", "CONFIRMA", "CONTRADIZ", "COMPLEMENTA"];

const ROTULO_RELACAO: Record<TipoRelacaoConfronto, string> = {
  ATUALIZA: "atualiza",
  CONTRADIZ: "contradiz",
  CONFIRMA: "confirma",
  COMPLEMENTA: "complementa",
};

/** A letra no rótulo da aresta — o que cabe no círculo da sigla. */
const SIGLA: Record<TipoRelacaoConfronto, string> = {
  ATUALIZA: "A",
  CONTRADIZ: "×",
  CONFIRMA: "=",
  COMPLEMENTA: "+",
};

/** A data do confronto: a das telas (`dia.ts`), com o ano quando não é o corrente — o radial atravessa anos. */
const data = (iso: string): string => dataCurta(iso) || "sem data";

const curto = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);

const chaveDe = (r: Pick<RelacaoNoRadial, "novo_id" | "velho_id">) => `${r.novo_id}|${r.velho_id}`;

// ──────────────────────── a geometria do radial ────────────────────────

/*
 * Tudo em unidade de `viewBox`. A 390 px o lado de 410 vira ~0,87 da tela:
 * letra de 14 dá ~12 px, e o alvo de raio 24 dá ~42 px — o mínimo de dedo
 * (onda 4 da interface). Os desenhos ficam pequenos; quem cresce é o alvo
 * invisível em volta deles.
 */
const LADO = 410;
const CENTRO = LADO / 2;
const RAIO_CENTRO = 20;
const RAIO_VIZINHO = 14;
const RAIO_SIGLA = 13;
/** O alvo de toque, invisível, em volta do nó e da sigla. */
const ALVO_VIZINHO = 24;
const ALVO_SIGLA = 18;
/**
 * A órbita encolheu de 128 para 118 quando a letra cresceu: a data ao lado de
 * um vizinho da direita, com o ano, precisa caber no lado do desenho.
 */
const ORBITA = 118;
/** Quanto de cada quadrante os vizinhos de um tipo ocupam, em graus. */
const ABERTURA_MAX = 76;
/**
 * O passo entre dois vizinhos do mesmo leque, em graus. A 118, 19° são ~39
 * unidades: a data de 14 cabe entre dois nós sem encostar na do lado.
 */
const PASSO_LEQUE = 20;

/** O quadrante, que diz para que lado do nó a data vai. */
type Lado = "cima" | "direita" | "baixo" | "esquerda";
const LADOS: readonly Lado[] = ["cima", "direita", "baixo", "esquerda"];

interface Posto {
  relacao: RelacaoNoRadial;
  vizinho: AtomoNoRadial;
  x: number;
  y: number;
  angulo: number;
  lado: Lado;
  /** Onde a sigla mora na aresta, do centro (0) ao vizinho (1). */
  fracao: number;
}

/**
 * Onde cada vizinho fica: um quadrante por tipo, os do mesmo tipo abertos em
 * leque dentro dele. Acima de cinco no mesmo quadrante, as órbitas alternam
 * para os nós não se sobreporem. Com três ou mais, as siglas alternam a
 * distância do centro: no mesmo raio, duas vizinhas se tocavam.
 */
function posicionar(radial: RadialDeAtomo): Posto[] {
  const vizinhoDe = new Map(radial.vizinhos.map((v) => [v.id, v]));
  const centroId = radial.centro.id;
  const postos: Posto[] = [];

  TIPOS.forEach((tipo, q) => {
    const doTipo = radial.relacoes.filter((r) => r.tipo === tipo);
    const n = doTipo.length;
    const abertura = Math.min(ABERTURA_MAX, PASSO_LEQUE * (n - 1));
    const meio = -90 + q * 90;

    doTipo.forEach((relacao, i) => {
      const outroId = relacao.novo_id === centroId ? relacao.velho_id : relacao.novo_id;
      const vizinho = vizinhoDe.get(outroId);
      if (!vizinho) return;
      const angulo = n === 1 ? meio : meio - abertura / 2 + (abertura * i) / (n - 1);
      const orbita = n > 5 ? ORBITA + (i % 2 === 0 ? -14 : 14) : ORBITA;
      const rad = (angulo * Math.PI) / 180;
      postos.push({
        relacao,
        vizinho,
        angulo,
        x: CENTRO + orbita * Math.cos(rad),
        y: CENTRO + orbita * Math.sin(rad),
        lado: LADOS[q],
        fracao: n >= 3 ? (i % 2 === 0 ? 0.52 : 0.64) : 0.56,
      });
    });
  });
  return postos;
}

/**
 * Onde a data do vizinho fica. Nos quadrantes de cima e de baixo ela vai para
 * fora do nó, centrada: ao lado, com a letra de 14, encostaria no vizinho
 * seguinte do leque. Nos dos lados ela segue para fora, no sentido do texto.
 */
export function rotuloDoVizinho(p: { x: number; y: number; lado: Lado }): {
  x: number;
  y: number;
  ancora: "start" | "middle" | "end";
} {
  const folga = RAIO_VIZINHO + 6;
  if (p.lado === "cima") return { x: p.x, y: p.y - folga, ancora: "middle" };
  if (p.lado === "baixo") return { x: p.x, y: p.y + folga + 11, ancora: "middle" };
  if (p.lado === "direita") return { x: p.x + folga - 2, y: p.y + 5, ancora: "start" };
  return { x: p.x - folga + 2, y: p.y + 5, ancora: "end" };
}

/** O segmento entre as bordas dos dois círculos, na direção do mais novo para o mais antigo. */
function segmento(p: Posto, centroId: string) {
  const deCentro = p.relacao.novo_id === centroId;
  const [x1, y1, r1, x2, y2, r2] = deCentro
    ? [CENTRO, CENTRO, RAIO_CENTRO, p.x, p.y, RAIO_VIZINHO]
    : [p.x, p.y, RAIO_VIZINHO, CENTRO, CENTRO, RAIO_CENTRO];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy) || 1;
  return {
    x1: x1 + (dx / d) * r1,
    y1: y1 + (dy / d) * r1,
    x2: x2 - (dx / d) * (r2 + 3),
    y2: y2 - (dy / d) * (r2 + 3),
  };
}

// ──────────────────────────── a tela ────────────────────────────

export function Confronto() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [armado, setArmado] = useState(false);

  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  /** O caminho de centros: o último é o que está aberto. Vazio = a lista. */
  const [caminho, setCaminho] = useState<string[]>([]);
  const [radial, setRadial] = useState<RadialDeAtomo | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);

  const centroId = caminho.at(-1) ?? null;

  const carregar = useCallback(async () => {
    const r = await fetch("/api/confronto", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) {
      setFalha("não deu para ler o estado do confronto");
      return;
    }
    setFalha(null);
    setEstado((await r.json()) as Estado);
  }, []);

  const carregarRadial = useCallback(async (id: string) => {
    const r = await fetch(`/api/confronto/atomo/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(
      () => null,
    );
    if (!r?.ok) {
      setFalha("não deu para abrir as relações deste átomo");
      return;
    }
    setFalha(null);
    setRadial((await r.json()) as RadialDeAtomo);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    setRadial(null);
    setSelecionada(null);
    if (centroId) void carregarRadial(centroId);
  }, [centroId, carregarRadial]);

  /** Enquanto houver fila, a lista relê sozinha — mesma decisão de `/entidades`. */
  useEffect(() => {
    if (centroId || !estado || estado.fila === 0) return;
    const t = setInterval(() => void carregar(), INTERVALO_FILA_MS);
    return () => clearInterval(t);
  }, [estado, carregar, centroId]);

  const abrir = (id: string) => setCaminho((c) => [...c, id]);
  const voltar = () => setCaminho((c) => c.slice(0, -1));

  async function rodar() {
    setRodando(true);
    setFalha(null);
    const r = await fetch("/api/confronto/rodar", { method: "POST" }).catch(() => null);
    if (!r?.ok) setFalha("não consegui começar a rodada");
    // A resposta chega antes de a fila terminar — a espera visível é o
    // próprio intervalo de releitura, não este botão.
    setTimeout(() => setRodando(false), INTERVALO_FILA_MS);
    await carregar();
  }

  /**
   * Dois toques, como o apagar sessão. Apaga todas as relações **do agente** —
   * as que eu editei e as minhas recusas ficam — e devolve o grafo à fila.
   */
  async function reprocessar() {
    if (!armado) {
      setArmado(true);
      return;
    }
    setArmado(false);
    setRodando(true);
    setFalha(null);

    const r = await fetch("/api/confronto/reprocessar", { method: "POST" }).catch(() => null);
    if (!r?.ok) {
      setRodando(false);
      setFalha("não consegui reprocessar");
      return;
    }
    // Reprocessar só devolve os átomos à fila; quem faz a fila andar é o elo.
    await fetch("/api/confronto/rodar", { method: "POST" }).catch(() => null);
    setTimeout(() => setRodando(false), INTERVALO_FILA_MS);
    await carregar();
  }

  async function desfazer(id: string) {
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/confronto/desfazer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atomo_id: id }),
    });
    setOcupado(null);
    if (!r.ok) {
      setFalha(((await r.json()) as { erro?: string }).erro ?? "não consegui desfazer");
      return;
    }
    await carregar();
  }

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = busca.trim();
    if (q === "") {
      setAchados(null);
      return;
    }
    setBuscando(true);
    setFalha(null);
    const r = await fetch(`/api/confronto/busca?q=${encodeURIComponent(q)}`, { cache: "no-store" }).catch(
      () => null,
    );
    setBuscando(false);
    if (!r?.ok) {
      setFalha("a busca falhou");
      return;
    }
    const corpo = (await r.json()) as { achados: Achado[]; aviso: string | null };
    setAchados(corpo.achados);
  }

  /** Um gesto sobre a relação. Devolve se deu certo, para o painel fechar o que abriu. */
  async function editar(rel: RelacaoNoRadial, acao: AcaoNaRelacao, valor = ""): Promise<boolean> {
    setOcupado(chaveDe(rel));
    setFalha(null);
    const r = await fetch("/api/confronto/relacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ novo_id: rel.novo_id, velho_id: rel.velho_id, acao, valor }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(((await r?.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "não consegui gravar");
      return false;
    }
    if (acao === "recusar") setSelecionada(null);
    if (centroId) await carregarRadial(centroId);
    return true;
  }

  if (centroId) {
    return (
      <main className="sessoes confronto">
        <header className="radial-topo">
          <button className="botao" onClick={voltar}>
            ← {caminho.length > 1 ? "voltar" : "lista"}
          </button>
          {caminho.length > 1 && (
            <button className="botao" onClick={() => setCaminho([])}>
              fechar
            </button>
          )}
        </header>

        {falha && (
          <p className="aviso erro" role="alert">
            {falha}
          </p>
        )}

        {!radial ? (
          <p className="aguardando">carregando…</p>
        ) : (
          <VistaRadial
            radial={radial}
            selecionada={selecionada}
            selecionar={setSelecionada}
            recentrar={abrir}
            editar={editar}
            ocupado={ocupado}
          />
        )}
      </main>
    );
  }

  return (
    <main className="sessoes confronto">
      <header>
        <h1>Confronto</h1>
        <p>
          Compara cada átomo com os cem mais parecidos do diário — antes, depois e na mesma
          gravação — e decide se um atualiza, contradiz, confirma ou complementa o outro, em
          camada forte ou sutil. Roda uma vez por dia, quando eu confirmo uma sessão, e quando eu
          peço. Toque num átomo para ver e corrigir as relações dele.
        </p>
      </header>

      {falha && (
        <p className="aviso erro" role="alert">
          {falha}
        </p>
      )}

      <div className="acoes-sessao">
        <button className="botao" onClick={() => void rodar()} disabled={rodando}>
          {rodando ? "rodando…" : "rodar agora"}
        </button>
        <button
          className={armado ? "botao perigo" : "botao"}
          onClick={() => void reprocessar()}
          onBlur={() => armado && setArmado(false)}
          disabled={rodando}
          title="apaga as relações do agente e devolve o grafo inteiro à fila — as que eu editei e as que eu apaguei ficam"
        >
          {armado ? "apagar as do agente e rodar de novo?" : "reprocessar tudo"}
        </button>
        {estado && estado.fila > 0 && (
          <span className="meta">{plural(estado.fila, "átomo", "átomos")} na fila — pode fechar a aba</span>
        )}
      </div>

      <form className="busca-confronto" onSubmit={(e) => void buscar(e)}>
        <input
          type="search"
          className="campo-nome"
          placeholder="achar um átomo pelo que foi dito"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            if (e.target.value.trim() === "") setAchados(null);
          }}
        />
        <button className="botao" type="submit" disabled={buscando}>
          {buscando ? "buscando…" : "buscar"}
        </button>
      </form>

      {achados ? (
        achados.length === 0 ? (
          <p className="aguardando">nada parecido o bastante.</p>
        ) : (
          <ul className="lista-sessoes">
            {achados.map((a) => (
              <li key={a.id}>
                <button className="quando abre-radial" onClick={() => abrir(a.id)}>
                  <span className="meta">
                    [{rotuloDoTipo(a.tipo)}] {data(a.valido_em)}
                  </span>
                  <span>{curto(a.texto, 180)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : !estado ? (
        <p className="aguardando">carregando…</p>
      ) : estado.recentes.length === 0 ? (
        <p className="aguardando">nenhum átomo processado ainda.</p>
      ) : (
        <ul className="lista-sessoes">
          {estado.recentes.map((a) => (
            <li key={a.id}>
              <button className="quando abre-radial" onClick={() => abrir(a.id)}>
                <span className="meta">
                  [{rotuloDoTipo(a.tipo)}] {dataCurta(a.em)} —{" "}
                  {a.estado === "falhou"
                    ? `falhou: ${a.motivo}`
                    : a.fortes + a.sutis === 0
                      ? "nenhuma relação"
                      : [
                          a.fortes > 0 ? plural(a.fortes, "forte", "fortes") : "",
                          a.sutis > 0 ? plural(a.sutis, "sutil", "sutis") : "",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                </span>
                <span>{a.texto}</span>
              </button>
              <div className="acoes-sessao">
                {a.estado === "processado" && (
                  <button
                    className="botao"
                    disabled={ocupado === a.id}
                    onClick={() => void desfazer(a.id)}
                    title="apaga o que a rodada deste átomo escreveu e o devolve à fila — o que eu editei fica"
                  >
                    desfazer
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// ──────────────────────────── o radial ────────────────────────────

function VistaRadial({
  radial,
  selecionada,
  selecionar,
  recentrar,
  editar,
  ocupado,
}: {
  radial: RadialDeAtomo;
  selecionada: string | null;
  selecionar: (k: string | null) => void;
  recentrar: (id: string) => void;
  editar: (rel: RelacaoNoRadial, acao: AcaoNaRelacao, valor?: string) => Promise<boolean>;
  ocupado: string | null;
}) {
  const { centro } = radial;
  const postos = useMemo(() => posicionar(radial), [radial]);
  const escolhido = postos.find((p) => chaveDe(p.relacao) === selecionada) ?? null;

  return (
    <>
      <section className="radial-centro">
        <span className="meta">
          [{rotuloDoTipo(centro.tipo)}] {data(centro.valido_em)}
          {centro.estado === "falhou" && ` — a última rodada falhou: ${centro.motivo_falha}`}
          {centro.estado === null && " — o confronto ainda não passou por aqui"}
        </span>
        <p>{centro.texto}</p>
      </section>

      {postos.length === 0 ? (
        <p className="aguardando">nenhuma relação.</p>
      ) : (
        <svg
          className="radial"
          viewBox={`0 0 ${LADO} ${LADO}`}
          role="group"
          aria-label={`${plural(postos.length, "relação", "relações")} deste átomo`}
        >
          <defs>
            {TIPOS.map((t) => (
              <marker
                key={t}
                id={`seta-${t}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className={`rel-${t}`} />
              </marker>
            ))}
          </defs>

          {postos.map((p) => {
            const s = segmento(p, centro.id);
            const k = chaveDe(p.relacao);
            const ativo = k === selecionada;
            return (
              <line
                key={`l-${k}`}
                {...s}
                className={`aresta rel-${p.relacao.tipo} ${p.relacao.camada}${ativo ? " ativa" : ""}`}
                markerEnd={`url(#seta-${p.relacao.tipo})`}
              />
            );
          })}

          <circle cx={CENTRO} cy={CENTRO} r={RAIO_CENTRO} className="no-centro" />
          <text x={CENTRO} y={CENTRO + 4} className="rotulo-centro">
            {centro.tipo.slice(0, 4).toLowerCase()}
          </text>

          {postos.map((p) => {
            const k = chaveDe(p.relacao);
            // O rótulo da aresta fica a pouco mais da metade do caminho, do
            // centro para fora: perto o bastante do vizinho para dizer de quem é.
            const mx = CENTRO + (p.x - CENTRO) * p.fracao;
            const my = CENTRO + (p.y - CENTRO) * p.fracao;
            const rotulo = rotuloDoVizinho(p);
            return (
              <g key={`n-${k}`}>
                <g
                  className={`sigla rel-${p.relacao.tipo}${k === selecionada ? " ativa" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${ROTULO_RELACAO[p.relacao.tipo]}, ${p.relacao.camada}`}
                  onClick={() => selecionar(k === selecionada ? null : k)}
                  onKeyDown={(e) => e.key === "Enter" && selecionar(k === selecionada ? null : k)}
                >
                  <circle cx={mx} cy={my} r={ALVO_SIGLA} className="alvo" />
                  <circle cx={mx} cy={my} r={RAIO_SIGLA} />
                  <text x={mx} y={my + 4.5}>
                    {SIGLA[p.relacao.tipo]}
                  </text>
                </g>
                <g
                  className={`no-vizinho rel-${p.relacao.tipo}${p.relacao.origem === "eu" ? " minha" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`abrir: ${curto(p.vizinho.texto, 60)}`}
                  onClick={() => recentrar(p.vizinho.id)}
                  onKeyDown={(e) => e.key === "Enter" && recentrar(p.vizinho.id)}
                >
                  <circle cx={p.x} cy={p.y} r={ALVO_VIZINHO} className="alvo" />
                  <circle cx={p.x} cy={p.y} r={RAIO_VIZINHO} />
                  <text x={rotulo.x} y={rotulo.y} textAnchor={rotulo.ancora}>
                    {data(p.vizinho.valido_em)}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      )}

      <p className="legenda">
        {TIPOS.map((t) => (
          <span key={t} className={`chave rel-${t}`}>
            {SIGLA[t]} {ROTULO_RELACAO[t]}
          </span>
        ))}
        <span>— cheio é forte, pontilhado é sutil, a seta aponta o mais antigo; ● editada por mim</span>
      </p>

      {escolhido && (
        <PainelDaRelacao
          key={selecionada}
          posto={escolhido}
          centroId={centro.id}
          editar={editar}
          ocupado={ocupado === selecionada}
          fechar={() => selecionar(null)}
          recentrar={recentrar}
        />
      )}

      <ul className="lista-sessoes relacoes-do-radial">
        {postos.map((p) => {
          const k = chaveDe(p.relacao);
          return (
            <li key={k} className={k === selecionada ? "ativa" : ""}>
              <button className="quando abre-radial" onClick={() => selecionar(k === selecionada ? null : k)}>
                <span className="meta">
                  <span className={`chave rel-${p.relacao.tipo}`}>{SIGLA[p.relacao.tipo]}</span>{" "}
                  {ROTULO_RELACAO[p.relacao.tipo]} · {p.relacao.camada}
                  {p.relacao.origem === "eu" && " · editada"} · {data(p.vizinho.valido_em)}
                </span>
                <span>{curto(p.vizinho.texto, 140)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PainelDaRelacao({
  posto,
  centroId,
  editar,
  ocupado,
  fechar,
  recentrar,
}: {
  // A `key` de quem chama é a relação: trocar de relação remonta o painel e
  // o rascunho do motivo não vaza de uma para a outra.
  posto: Posto;
  centroId: string;
  editar: (rel: RelacaoNoRadial, acao: AcaoNaRelacao, valor?: string) => Promise<boolean>;
  ocupado: boolean;
  fechar: () => void;
  recentrar: (id: string) => void;
}) {
  const { relacao: rel, vizinho } = posto;
  const [motivo, setMotivo] = useState(rel.motivo);
  const [armado, setArmado] = useState(false);

  // A frase diz quem é o mais novo, porque a relação é sempre lida dele para o outro.
  const centroEhNovo = rel.novo_id === centroId;
  const frase = centroEhNovo
    ? `este trecho ${ROTULO_RELACAO[rel.tipo]} aquele, que é mais antigo`
    : `aquele trecho, mais novo, ${ROTULO_RELACAO[rel.tipo]} este`;

  return (
    <section className="painel-relacao">
      <div className="cabecalho-relacao">
        <span className={`chave rel-${rel.tipo}`}>{SIGLA[rel.tipo]}</span>
        <span>{frase}</span>
        <button className="botao icone" onClick={fechar} aria-label="fechar">
          ×
        </button>
      </div>

      <button className="vizinho-relacao" onClick={() => recentrar(vizinho.id)}>
        <span className="meta">
          [{rotuloDoTipo(vizinho.tipo)}] {data(vizinho.valido_em)} — tocar abre as relações dele
        </span>
        <span>{vizinho.texto}</span>
      </button>

      <p className="meta">
        {rel.camada} · confiança {rel.confianca.toFixed(2).replace(".", ",")}
        {rel.origem === "eu" ? " · editada por mim — o agente não a toca mais" : ""}
        {rel.modelo !== "" && ` · ${rel.modelo}`}
        {rel.prompt_version !== "" && ` · ${rel.prompt_version}`}
      </p>

      <div className="gestos-relacao">
        {TIPOS.map((t) => (
          <button
            key={t}
            className={`botao${t === rel.tipo ? " ligado" : ""}`}
            disabled={ocupado || t === rel.tipo}
            onClick={() => void editar(rel, "tipo", t)}
          >
            {ROTULO_RELACAO[t]}
          </button>
        ))}
      </div>

      <div className="gestos-relacao">
        {(["forte", "sutil"] as const).map((c) => (
          <button
            key={c}
            className={`botao${c === rel.camada ? " ligado" : ""}`}
            disabled={ocupado || c === rel.camada}
            onClick={() => void editar(rel, "camada", c)}
          >
            {c}
          </button>
        ))}
      </div>

      <textarea
        className="motivo-relacao"
        value={motivo}
        rows={3}
        onChange={(e) => setMotivo(e.target.value)}
        aria-label="motivo da relação"
      />

      <div className="gestos-relacao">
        <button
          className="botao"
          disabled={ocupado || motivo.trim() === "" || motivo.trim() === rel.motivo}
          onClick={() => void editar(rel, "motivo", motivo)}
        >
          salvar motivo
        </button>
        <button
          className={armado ? "botao perigo" : "botao"}
          disabled={ocupado}
          onBlur={() => armado && setArmado(false)}
          onClick={() => {
            if (!armado) {
              setArmado(true);
              return;
            }
            setArmado(false);
            void editar(rel, "recusar");
          }}
          title="estes dois não se relacionam — o agente nunca mais os propõe"
        >
          {armado ? "apagar para sempre?" : "apagar"}
        </button>
      </div>
    </section>
  );
}
