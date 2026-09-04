"use client";

/**
 * Tela de calibração — o que eu já corrigi, junto num lugar só.
 *
 * Não é placar e não é nota. Não há percentual, não há "melhorou", não há
 * contagem por sessão: `CLAUDE.md` proíbe métrica de qualidade automática, e
 * esta tela não é a exceção. O que ela mostra é **memória do que eu corrigi**,
 * para eu decidir, olhando, se aquilo virou padrão.
 *
 * O desenho saiu do material, não do palpite. Medido na primeira rodada real
 * (5 sessões, 21 correções): **metade é correção de `texto`, com `antes` e
 * `depois` de 200 a 660 caracteres.** Então isto aqui não é uma lista de
 * rótulos curtos — é uma tela de ler dois parágrafos e enxergar onde eles
 * diferem. Daí a regra de apresentação: par curto vai em linha, com a seta; par
 * longo vai empilhado, um bloco embaixo do outro, cada um com sua etiqueta.
 * Sem diff colorido: cor que decide o que mudou é a tela afirmando uma leitura
 * que eu não pedi.
 *
 * **O áudio é o que torna a correção legível meses depois.** Um `antes → depois`
 * solto não diz se eu tinha razão; o trecho tocando diz. Por isso cada correção
 * com âncora ganha `▶ mm:ss`, e a proposta da sessão só é buscada quando eu
 * clico — uma ida à rede por sessão, guardada, e não uma por correção ao abrir.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { localizarNoAudio } from "@/lib/transcricao";
import { MAX_REGRAS } from "@/lib/tipos";
import type { BlocoAbsoluto, Correcao, Regra, TipoCorrecao } from "@/lib/tipos";

/** O que eu fiz, dito como eu diria. O tipo interno é do código, não da tela. */
const ROTULO: Record<TipoCorrecao, string> = {
  rejeitado: "rejeitei o átomo",
  texto: "reescrevi o texto",
  tipo: "troquei o tipo",
  sujeito: "troquei o sujeito",
  mencao_adicionada: "acrescentei menção",
  mencao_removida: "tirei menção",
  entidade_recusada: "recusei a entidade",
  entidade_renomeada: "renomeei a entidade",
  entidade_tipo: "troquei o tipo da entidade",
  faltou: "faltou isto",
};

const SELO: Record<string, string> = {
  extracao: "extração",
  resolucao: "resolução",
  grafo: "grafo",
};

/**
 * Acima disto, o par não cabe numa linha e vai empilhado.
 *
 * 90 é onde os dois grupos do material real se separam: renome e troca de tipo
 * vivem abaixo de 30 caracteres, reescrita de átomo vive acima de 200.
 */
export const LIMITE_LINHA = 90;

export const cabeEmLinha = (antes: string, depois: string): boolean =>
  antes.length + depois.length <= LIMITE_LINHA;

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * "2026-09-04T00:55Z" → "03 de set", no fuso de quem lê. Situa a correção sem
 * pesar a linha — e a data que importa é a local, que é quando eu revisei.
 */
export function diaMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

/** O que a tela precisa de uma sessão para tocar o áudio e mostrar o refugo. */
interface DaSessao {
  blocos: BlocoAbsoluto[];
  descartados: { motivo: string }[];
}

interface Indice {
  correcoes: Correcao[];
  regras_correntes: string | null;
  regras: Regra[];
  visitado_em: string | null;
  atualizado_em: string;
}

/**
 * Uma regra na tela: a que já vale ou a que o agente acabou de propor.
 *
 * `nova` só muda a aparência. O que define "sobreviveu à minha edição" é o
 * `id` ainda estar na lista que eu submeto — regra rascunhada que eu apago
 * some, e as correções que a motivavam continuam em aberto para a próxima
 * rodada.
 */
interface RegraNaTela extends Regra {
  nova?: boolean;
}

/**
 * O que o parser recusou, agrupado por motivo.
 *
 * A revisão já carregava `descartados` e nunca os renderizou — item que o
 * modelo devolveu e a validação jogou fora, com o motivo. É o outro lado da
 * correção: ali eu digo o que ficou torto, aqui o código diz o que nem passou.
 */
export function agruparDescartes(
  porSessao: Record<string, DaSessao | undefined>,
): { motivo: string; n: number }[] {
  const contagem = new Map<string, number>();
  for (const dados of Object.values(porSessao)) {
    for (const d of dados?.descartados ?? []) {
      contagem.set(d.motivo, (contagem.get(d.motivo) ?? 0) + 1);
    }
  }
  return [...contagem]
    .map(([motivo, n]) => ({ motivo, n }))
    .sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo));
}

export function Calibracao() {
  const [indice, setIndice] = useState<Indice | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [sessoes, setSessoes] = useState<Record<string, DaSessao | undefined>>({});
  const [refugoAberto, setRefugoAberto] = useState(false);

  /** A composição inteira: o que já vale mais o que o agente propôs. */
  const [composicao, setComposicao] = useState<RegraNaTela[]>([]);
  const [rascunhando, setRascunhando] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  /** Aprovei nesta visita: a lista deixa de estar suja. */
  const [salvo, setSalvo] = useState(false);

  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/calibracao", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json()) as { erro?: string }).erro ?? `erro ${r.status}`);
        return (await r.json()) as Indice;
      })
      .then((d) => {
        if (!vivo) return;
        setIndice(d);
        setComposicao(d.regras ?? []);
      })
      .catch((e: Error) => vivo && setFalha(e.message));
    return () => {
      vivo = false;
    };
  }, []);

  /** Uma ida por sessão, guardada. A tela abre sem buscar proposta nenhuma. */
  const carregarSessao = useCallback(
    async (sessao_id: string): Promise<DaSessao | null> => {
      const guardada = sessoes[sessao_id];
      if (guardada) return guardada;

      const r = await fetch(`/api/sessoes/${sessao_id}/extracao`, { cache: "no-store" }).catch(
        () => null,
      );
      if (!r || !r.ok) return null;

      const d = (await r.json()) as {
        blocos: BlocoAbsoluto[];
        extracao: { descartados?: { motivo: string }[] };
      };
      const dados: DaSessao = { blocos: d.blocos ?? [], descartados: d.extracao?.descartados ?? [] };
      setSessoes((s) => ({ ...s, [sessao_id]: dados }));
      return dados;
    },
    [sessoes],
  );

  /** Mesma mecânica da revisão: bloco certo, segundo certo, URL por clique. */
  const escutar = useCallback(
    async (sessao_id: string, segundo: number) => {
      const dados = await carregarSessao(sessao_id);
      if (!dados) return;

      const alvo = localizarNoAudio(dados.blocos, segundo);
      if (!alvo) return;

      const r = await fetch(`/api/sessoes/${sessao_id}/chunks/${alvo.i}/audio`);
      if (!r.ok) return;
      const { url } = (await r.json()) as { url: string };

      const el = audio.current;
      if (!el) return;
      el.pause();
      el.src = url;
      // Safari só aceita currentTime depois dos metadados, como na revisão.
      el.onloadedmetadata = () => {
        el.currentTime = alvo.dentro;
        void el.play();
      };
      el.currentTime = alvo.dentro;
      void el.play().catch(() => {});
    },
    [carregarSessao],
  );

  /** O agente propõe. Uma chamada de modelo por toque, e nunca ao abrir. */
  async function pedirRascunho() {
    setRascunhando(true);
    setRecado(null);
    setSalvo(false);

    const r = await fetch("/api/calibracao/rascunho", { method: "POST" }).catch(() => null);
    setRascunhando(false);

    if (!r || !r.ok) {
      setRecado(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    const d = (await r.json()) as { regras: Omit<Regra, "aprovada_em">[] };
    if (d.regras.length === 0) {
      setRecado("o agente não achou padrão suficiente para propor regra — o que é uma resposta legítima, e frequente");
      return;
    }
    setComposicao((atual) => [
      ...atual,
      ...d.regras.map((r) => ({ ...r, aprovada_em: "", nova: true })),
    ]);
  }

  /** O único toque que escreve. A lista inteira, não um delta. */
  async function aprovar() {
    setAprovando(true);
    setRecado(null);

    const r = await fetch("/api/calibracao/regras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        regras: composicao.map(({ id, texto, cita, substitui }) => ({ id, texto, cita, substitui })),
      }),
    }).catch(() => null);
    setAprovando(false);

    if (!r || !r.ok) {
      setRecado(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    const d = (await r.json()) as { hash: string | null; fechadas: number };
    setSalvo(true);
    setComposicao((atual) => atual.map(({ nova: _, ...r }) => r));
    setRecado(
      d.hash === null
        ? "sem regra nenhuma — a extração volta a ser só o prompt base"
        : `em vigor a partir da próxima sessão · ${d.hash}${d.fechadas > 0 ? ` · ${d.fechadas} correção(ões) endereçada(s)` : ""}`,
    );
    // O índice mudou: `incorporada_em` fechou o que a regra citou.
    const novo = await fetch("/api/calibracao", { cache: "no-store" }).catch(() => null);
    if (novo?.ok) setIndice((await novo.json()) as Indice);
  }

  async function abrirRefugo() {
    setRefugoAberto(true);
    const ids = [...new Set((indice?.correcoes ?? []).map((c) => c.sessao_id))];
    for (const id of ids) await carregarSessao(id);
  }

  if (falha && !indice) {
    return (
      <main className="leitura">
        <h1>calibração</h1>
        <p className="aguardando">{falha}</p>
      </main>
    );
  }

  if (!indice) {
    return (
      <main className="leitura">
        <h1>calibração</h1>
        <p className="aguardando">…</p>
      </main>
    );
  }

  const abertas = indice.correcoes.filter((c) => c.incorporada_em === null);
  const descartes = agruparDescartes(sessoes);

  return (
    <main className="calibracao">
      <header>
        <h1>o que eu corrigi</h1>
        <p className="aguardando">
          {abertas.length === 0
            ? "nada em aberto — toda correção já foi endereçada por alguma regra"
            : `${abertas.length} em aberto · o que se repete aqui é o que vale virar regra do prompt`}
        </p>
      </header>

      {indice.correcoes.length === 0 && (
        <p className="aguardando">
          Nenhuma correção ainda. Elas nascem sozinhas quando eu confirmo uma revisão em que mexi
          em alguma coisa — não há nada a apertar.
        </p>
      )}

      <section className="regras">
        <h2>o que o extrator lê antes de extrair</h2>
        <p className="aguardando">
          {composicao.length === 0
            ? "nenhuma regra ainda — a extração roda com o prompt base, igual a sempre"
            : `${composicao.length} de ${MAX_REGRAS} · vale a partir da próxima sessão que eu gravar`}
        </p>

        {composicao.map((r, k) => (
          <div key={r.id} className={r.nova ? "regra nova" : "regra"}>
            <textarea
              value={r.texto}
              rows={2}
              aria-label={`texto da regra ${k + 1}`}
              onChange={(e) =>
                setComposicao((atual) =>
                  atual.map((x) => (x.id === r.id ? { ...x, texto: e.target.value } : x)),
                )
              }
            />
            <div className="meta-regra">
              {r.nova && <span className="proposta">proposta agora</span>}
              {r.substitui && <span>substitui {r.substitui}</span>}
              {/* `cita` é do agente e imutável na tela: é a procedência do que
                  motivou a regra, não coisa minha para editar. */}
              <span>a partir de {r.cita.length} correção(ões)</span>
              <button
                className="apagar-regra"
                onClick={() => setComposicao((atual) => atual.filter((x) => x.id !== r.id))}
              >
                apagar
              </button>
            </div>
          </div>
        ))}

        <div className="acoes-regras">
          <button
            className="rascunhar"
            disabled={rascunhando || composicao.length >= MAX_REGRAS}
            onClick={() => void pedirRascunho()}
          >
            {rascunhando ? "lendo o que eu corrigi…" : "pedir um rascunho"}
          </button>
          <button className="aprovar" disabled={aprovando} onClick={() => void aprovar()}>
            {aprovando ? "gravando…" : "aprovar esta lista"}
          </button>
          {salvo && <span className="ok-regras">aprovado</span>}
        </div>

        {recado && <p className="aguardando">{recado}</p>}
      </section>

      <ul className="correcoes">
        {indice.correcoes.map((c) => {
          const emLinha = cabeEmLinha(c.antes, c.depois);
          // O texto do átomo só entra quando ele **não** é o próprio `antes`:
          // numa correção de texto seria a mesma coisa duas vezes na tela.
          const contexto =
            c.texto_proposto !== "" && c.texto_proposto !== c.antes ? c.texto_proposto : "";

          return (
            <li key={c.id} className={c.incorporada_em === null ? "correcao" : "correcao fechada"}>
              <div className="cabecalho">
                <span className={`selo ${c.agente}`}>{SELO[c.agente] ?? c.agente}</span>
                <span className="acao">{ROTULO[c.tipo] ?? c.tipo}</span>
                {c.tipo_atomo && <span className="tipo-atomo">{c.tipo_atomo}</span>}
                <span className="quando">{diaMes(c.em)}</span>
              </div>

              {contexto !== "" && <p className="contexto">{contexto}</p>}

              {emLinha ? (
                <p className="par-curto">
                  <span className="antes">{c.antes === "" ? "—" : c.antes}</span>
                  <span className="seta" aria-hidden="true">
                    →
                  </span>
                  <span className="depois">{c.depois === "" ? "—" : c.depois}</span>
                </p>
              ) : (
                <div className="par-longo">
                  {c.antes !== "" && (
                    <div className="lado">
                      <span className="rotulo">o que veio</span>
                      <p>{c.antes}</p>
                    </div>
                  )}
                  {c.depois !== "" && (
                    <div className="lado">
                      <span className="rotulo">o que eu deixei</span>
                      <p>{c.depois}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="rodape">
                {c.inicios_s.map((s, k) => (
                  <button key={k} className="ouvir" onClick={() => void escutar(c.sessao_id, s)}>
                    ▶ {mmss(s)}
                  </button>
                ))}
                {!c.tocado && (
                  // Trava 2 (§4.11): chave diferente sem gesto que a testemunhe.
                  // Provável travessia de alias, não edição minha — e a tela
                  // tem que dizer isso, senão eu leio como correção que fiz.
                  <span className="inferida" title="deduzida do valor, sem gesto meu na tela">
                    inferida
                  </span>
                )}
                {c.incorporada_em !== null && (
                  <span className="meta">já virou regra ({c.incorporada_em})</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {indice.correcoes.length > 0 && (
        <section className="refugo">
          {refugoAberto ? (
            <>
              <h2>o que o parser recusou</h2>
              {descartes.length === 0 ? (
                <p className="aguardando">nada — todo item que o modelo devolveu passou</p>
              ) : (
                <ul>
                  {descartes.map((d) => (
                    <li key={d.motivo}>
                      <span className="n">{d.n}</span> {d.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <button className="abrir-refugo" onClick={() => void abrirRefugo()}>
              o que o parser recusou
            </button>
          )}
        </section>
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audio} preload="none" />
    </main>
  );
}
