"use client";

/**
 * O painel dos agentes: duas telas, uma espinha em cada, e cada caixa abrindo o
 * que a comanda.
 *
 * **Duas telas, e não um desenho só.** O chat não escreve nada — ele é o
 * caminho de sair do grafo, e estava desenhado por cima do caminho de entrar
 * nele. Agora `/agentes` mostra o que entra e `/agentes/consulta` mostra o que
 * sai, cada uma com URL própria. A razão inteira está no cabeçalho de `TELAS`,
 * em `agentes.ts`, que é onde o desenho mora.
 *
 * **Uma espinha, e nenhum SVG.** O desenho anterior era uma grade de sete
 * colunas com as setas roteadas à mão, medidas do DOM com `ResizeObserver` — e
 * rolava na horizontal num app que vive no celular. Agora é uma coluna só: os
 * passos descem, o elo entre eles é uma borda de CSS, e o que era caixa lateral
 * virou linha dentro do cartão. Nada é medido, então nada pode apontar para o
 * lugar errado.
 *
 * **Nenhuma dependência entrou**, e continua sendo pelo mesmo motivo de antes:
 * o fluxo aqui é fixo e pequeno, e um motor de pan/zoom seria pagar por um
 * problema que este desenho não tem — menos ainda agora.
 *
 * A gaveta de edição é a mesma forma do menu de gestão — véu que fecha ao toque,
 * Esc, e o foco entrando e voltando. Quem edita prompt de madrugada merece Esc.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AgenteNaTela, Fluxo, Passo, Secao, Tela } from "@/lib/agentes";
import type { AgenteId, QuandoRoda } from "@/lib/tipos";

interface Dados {
  agentes: AgenteNaTela[];
  telas: Tela[];
  atualizado_em: string | null;
}

/** O selo de quando. Quatro palavras, e a diferença é o que o agente custa. */
const QUANDO: Record<QuandoRoda, string> = {
  automatico: "automático",
  condicional: "condicional",
  sob_demanda: "sob demanda",
  periodico: "periódico",
};

/** A porta de cada tela. Aqui e não em `agentes.ts`: rota é assunto do app. */
const ROTA: Record<Fluxo, string> = {
  ingestao: "/agentes",
  consulta: "/agentes/consulta",
};

const editado = (a: AgenteNaTela) => a.promptEditado || a.modeloEditado || a.limiarEditado;

// ───────────────────────────── a tela ─────────────────────────────

export function Agentes({ fluxo }: { fluxo: Fluxo }) {
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

  if (falha || !dados) {
    return (
      <main className="agentes">
        <h1>quem faz o trabalho</h1>
        <p className="aguardando">{falha ?? "…"}</p>
      </main>
    );
  }

  const tela = dados.telas.find((t) => t.fluxo === fluxo);
  if (!tela) {
    return (
      <main className="agentes">
        <h1>quem faz o trabalho</h1>
        <p className="aguardando">não conheço este fluxo</p>
      </main>
    );
  }

  const porId = new Map(dados.agentes.map((a) => [a.id, a]));
  const editando = aberto ? porId.get(aberto) : undefined;

  const todos = tela.secoes.flatMap((s) => s.passos.flatMap((p) => [p, ...(p.dentro ?? [])]));
  // A volta diz para onde volta, e o desenho antigo dizia isso com a ponta da
  // curva. Sem o rótulo do destino, "candidato por sentido" não diria a quem.
  const rotulos = new Map(todos.map((p) => [p.id, p.rotulo]));

  // Os desta tela, e não os doze: cabeçalho de tela não fala do que a tela não
  // mostra. Quem quiser o total troca de aba e soma.
  const daTela = todos
    .flatMap((p) => (p.agente ? [porId.get(p.agente)] : []))
    .filter((a): a is AgenteNaTela => a !== undefined);
  const comOverride = daTela.filter(editado).length;

  return (
    <main className="agentes">
      <header>
        <h1>quem faz o trabalho</h1>
        <Abas telas={dados.telas} atual={fluxo} />
        <p className="titulo-tela">{tela.titulo}</p>
        <p className="aguardando">{tela.legenda}</p>
      </header>

      {tela.secoes.map((s) => (
        <Bloco key={s.id} secao={s} porId={porId} rotulos={rotulos} aoAbrir={setAberto} />
      ))}

      <p className="rodape-fluxo">
        {comOverride === 0
          ? "nenhum agente desta tela foi tocado por aqui — todos na base do git. "
          : `${comOverride} ${comOverride === 1 ? "agente desta tela está editado" : "agentes desta tela estão editados"}; o resto está na base do git. `}
        Clique num agente para ver e editar o que o comanda. Toda chamada de
        modelo deste sistema sai pelo Vercel AI Gateway.
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

// ───────────────────────────── as abas ─────────────────────────────

/**
 * Links de verdade, e não estado local: cada fluxo tem URL própria, o botão de
 * voltar do navegador funciona, e eu posso guardar a aba que uso mais.
 */
function Abas({ telas, atual }: { telas: Tela[]; atual: Fluxo }) {
  return (
    <nav className="abas" aria-label="fluxos">
      {telas.map((t) => (
        <Link
          key={t.fluxo}
          href={ROTA[t.fluxo]}
          className={t.fluxo === atual ? "aba atual" : "aba"}
          aria-current={t.fluxo === atual ? "page" : undefined}
        >
          {t.aba}
        </Link>
      ))}
    </nav>
  );
}

// ───────────────────────────── o desenho ─────────────────────────────

function Bloco({
  secao,
  porId,
  rotulos,
  aoAbrir,
}: {
  secao: Secao;
  porId: Map<AgenteId, AgenteNaTela>;
  rotulos: Map<string, string>;
  aoAbrir: (id: AgenteId) => void;
}) {
  const Lista = secao.forma === "espinha" ? "ol" : "ul";
  return (
    <section className="secao">
      <h2>{secao.titulo}</h2>
      <p className="aguardando">{secao.legenda}</p>
      <Lista className={secao.forma}>
        {secao.passos.map((p) => (
          <li key={p.id}>
            <Cartao passo={p} porId={porId} rotulos={rotulos} aoAbrir={aoAbrir} />
          </li>
        ))}
      </Lista>
    </section>
  );
}

/**
 * Um passo. Agente é botão e abre a gaveta; dado e `eu` são caixa parada.
 *
 * A ordem de leitura é sempre a mesma — o que entra, o que o passo é, o que
 * roda dentro dele, o que ele devolve —, e é ela que faz a espinha poder ser
 * lida em diagonal sem se perder.
 */
function Cartao({
  passo,
  porId,
  rotulos,
  aoAbrir,
  miudo = false,
}: {
  passo: Passo;
  porId: Map<AgenteId, AgenteNaTela>;
  rotulos: Map<string, string>;
  aoAbrir: (id: AgenteId) => void;
  miudo?: boolean;
}) {
  const a = passo.agente ? porId.get(passo.agente) : undefined;
  // O papel é o que o agente faz numa frase, e é a linha que faltava no desenho
  // antigo: lá ele só aparecia depois de abrir a gaveta.
  const nota = passo.nota ?? a?.papel;

  const miolo = (
    <>
      <span className="rotulo">
        {passo.rotulo}
        {a && editado(a) && <i className="marca" aria-label="editado" />}
        {a && <span className={`quando ${a.quando}`}>{QUANDO[a.quando]}</span>}
      </span>
      {a && <span className="modelo">{a.modelo}</span>}
      {nota && <span className="nota">{nota}</span>}
    </>
  );

  return (
    <div className={`passo ${passo.tipo}${miudo ? " miudo" : ""}`}>
      {passo.entradas?.map((e) => (
        <p className="entra" key={e.rotulo}>
          <span className="seta" aria-hidden="true">
            ←
          </span>
          <b>{e.rotulo}</b> {e.nota}
        </p>
      ))}

      {a ? (
        <button
          type="button"
          className={`caixa agente${editado(a) ? " editado" : ""}`}
          onClick={() => aoAbrir(a.id)}
        >
          {miolo}
        </button>
      ) : (
        <div className="caixa">{miolo}</div>
      )}

      {passo.dentro && passo.dentro.length > 0 && (
        <div className="dentro">
          <p className="legenda-dentro">roda dentro dela</p>
          <ul>
            {passo.dentro.map((d) => (
              <li key={d.id}>
                <Cartao passo={d} porId={porId} rotulos={rotulos} aoAbrir={aoAbrir} miudo />
              </li>
            ))}
          </ul>
        </div>
      )}

      {passo.volta && (
        <p className="volta">
          <span className="seta" aria-hidden="true">
            ↩
          </span>
          volta para <b>{rotulos.get(passo.volta.para) ?? passo.volta.para}</b> ·{" "}
          {passo.volta.rotulo}
        </p>
      )}
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
  aoSalvar: (corpo: {
    prompt?: string | null;
    modelo?: string | null;
    limiar?: number | null;
  }) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(a.prompt ?? "");
  const [modelo, setModelo] = useState(a.modelo);
  const [limiar, setLimiar] = useState(a.limiar === null ? "" : String(a.limiar));
  const [editandoPrompt, setEditandoPrompt] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gaveta = useRef<HTMLElement | null>(null);

  // Trocar de agente com a gaveta aberta tem de recarregar os campos; sem isto o
  // texto do agente anterior ficaria na tela sobre o nome do novo.
  useEffect(() => {
    setPrompt(a.prompt ?? "");
    setModelo(a.modelo);
    setLimiar(a.limiar === null ? "" : String(a.limiar));
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
  // Vazio, ou fora de [0,1], não é mudança: o campo em branco é "não mexi", e o
  // servidor recusa o resto de qualquer jeito.
  const limiarNovo = Number(limiar);
  const limiarMudou =
    a.limiar !== null &&
    limiar.trim() !== "" &&
    Number.isFinite(limiarNovo) &&
    limiarNovo >= 0 &&
    limiarNovo <= 1 &&
    limiarNovo !== a.limiar;
  const podeSalvar = (promptMudou || modeloMudou || limiarMudou) && !gravando;

  async function salvar(corpo: {
    prompt?: string | null;
    modelo?: string | null;
    limiar?: number | null;
  }) {
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

          {a.limiar !== null && (
            <>
              <label htmlFor={`limiar-${a.id}`}>limiar de confiança</label>
              <input
                id={`limiar-${a.id}`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={limiar}
                inputMode="decimal"
                onChange={(e) => setLimiar(e.target.value)}
                placeholder={String(a.limiarPadrao ?? "")}
              />
              <p className="dica">
                abaixo disto a menção vai para a segunda leitura, com a ficha completa dos
                candidatos. Padrão <code>{a.limiarPadrao}</code>, do git
                {a.limiarEditado && " · você trocou por aqui"}
              </p>
            </>
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
                ...(limiarMudou ? { limiar: limiarNovo } : {}),
              })
            }
          >
            {gravando ? "gravando…" : "salvar"}
          </button>
          {(a.promptEditado || a.modeloEditado || a.limiarEditado) && (
            <button
              type="button"
              className="fraco"
              disabled={gravando}
              onClick={() =>
              salvar({
                prompt: a.prompt === null ? undefined : null,
                modelo: null,
                ...(a.limiar === null ? {} : { limiar: null }),
              })
            }
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
