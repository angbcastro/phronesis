"use client";

/**
 * Tela de revisão — a última porta antes do grafo.
 *
 * O caso comum é aprovar tudo: a tela abre com todos os átomos marcados e o
 * botão de confirmar pronto. Discordar de um item custa um toque (desmarcar) e
 * editar custa dois (abrir, mexer). Menos de 60 s numa sessão de 15 min, ou o
 * sistema morre em três semanas — `Specs/visao.md` §8.
 *
 * O player é o que torna a revisão confiável: escuto antes de aprovar. Um átomo
 * pode ter vários trechos, então há um botão por âncora. Átomo sem âncora não
 * ganha player nenhum e aparece marcado — trecho que não existe na transcrição
 * costuma ser afirmação que o modelo inventou.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { tokenizar } from "@/lib/texto";
import { TIPOS_ATOMO } from "@/lib/tipos";
import type { AtomoProposto, BlocoAbsoluto, EntidadeCandidata, TipoAtomo } from "@/lib/tipos";

interface Proposta {
  status: string;
  extracao: {
    atomos: AtomoProposto[];
    entidades: EntidadeCandidata[];
    descartados: { motivo: string }[];
    modelo: string;
    prompt_version: string;
  };
  blocos: BlocoAbsoluto[];
}

/** Edições locais. Só o que eu mexi entra aqui; o resto vem da proposta. */
interface Edicao {
  texto?: string;
  tipo?: TipoAtomo;
  sobre?: string;
}

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Do segundo absoluto para "bloco N, segundo M dentro dele".
 *
 * O último bloco que começa antes do offset é o que contém o trecho. Serve
 * para os dois formatos sem caso especial: gravação tem um bloco a cada 30 s,
 * importação tem um bloco só com offset zero.
 */
export function localizarNoAudio(blocos: BlocoAbsoluto[], segundo: number) {
  const bloco = [...blocos].reverse().find((b) => b.offset_s <= segundo) ?? blocos[0];
  if (!bloco) return null;
  return { i: bloco.i, dentro: Math.max(0, segundo - bloco.offset_s) };
}

export function Revisao({ id }: { id: string }) {
  const router = useRouter();
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const [rejeitados, setRejeitados] = useState<Set<number>>(new Set());
  const [semEntidade, setSemEntidade] = useState<Set<string>>(new Set());
  const [edicoes, setEdicoes] = useState<Record<number, Edicao>>({});
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [gravando, setGravando] = useState(false);

  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/sessoes/${id}/extracao`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json()) as { erro?: string }).erro ?? `erro ${r.status}`);
        return (await r.json()) as Proposta;
      })
      .then((d) => vivo && setProposta(d))
      .catch((e: Error) => vivo && setFalha(e.message));
    return () => {
      vivo = false;
    };
  }, [id]);

  /** Toca o bloco certo no segundo certo. Uma URL presigned por clique. */
  const escutar = useCallback(
    async (segundo: number) => {
      if (!proposta) return;
      const alvo = localizarNoAudio(proposta.blocos, segundo);
      if (!alvo) return;

      const r = await fetch(`/api/sessoes/${id}/chunks/${alvo.i}/audio`);
      if (!r.ok) return;
      const { url } = (await r.json()) as { url: string };

      const el = audio.current;
      if (!el) return;
      el.pause();
      el.src = url;
      el.currentTime = alvo.dentro;
      // Safari só aceita currentTime depois dos metadados; refazemos no evento.
      el.onloadedmetadata = () => {
        el.currentTime = alvo.dentro;
        void el.play();
      };
      void el.play().catch(() => {});
    },
    [id, proposta],
  );

  const atomos = proposta?.extracao.atomos ?? [];
  const entidades = proposta?.extracao.entidades ?? [];

  const valorDe = (a: AtomoProposto): Required<Edicao> => ({
    texto: edicoes[a.indice]?.texto ?? a.texto,
    tipo: edicoes[a.indice]?.tipo ?? a.tipo,
    sobre: edicoes[a.indice]?.sobre ?? a.sobre,
  });

  /**
   * Mesma normalização do servidor — `texto.ts` é módulo puro justamente para
   * os dois lados não divergirem. É `nome_normalizado` que a rota usa de chave.
   */
  const normal = (s: string) => tokenizar(s).join(" ");

  /**
   * Entidade que é sujeito de algum átomo aprovado não pode ser desmarcada:
   * sem ela o átomo ficaria sem `:SOBRE`, o que o schema não admite.
   */
  const travadas = useMemo(() => {
    const s = new Set<string>();
    for (const a of atomos) {
      if (!rejeitados.has(a.indice)) s.add(normal(valorDe(a).sobre));
    }
    return s;
  }, [atomos, rejeitados, edicoes]);

  const aprovados = atomos.filter((a) => !rejeitados.has(a.indice));

  async function confirmar() {
    if (!proposta || gravando) return;
    setGravando(true);
    setFalha(null);

    const usadas = entidades
      .map((e) => e.nome_normalizado)
      .filter((n) => !semEntidade.has(n) || travadas.has(n));

    const r = await fetch(`/api/sessoes/${id}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aprovados: aprovados.map((a) => {
          const v = valorDe(a);
          return {
            indice: a.indice,
            texto: v.texto,
            tipo: v.tipo,
            sobre: v.sobre,
            menciona: a.menciona.filter((m) => usadas.includes(normal(m))),
          };
        }),
        entidades: usadas,
      }),
    }).catch(() => null);

    if (!r || !r.ok) {
      const motivo = r ? ((await r.json()) as { erro?: string }).erro : "sem resposta do servidor";
      setFalha(motivo ?? "falhou");
      setGravando(false);
      return;
    }
    router.push("/");
  }

  if (falha && !proposta) {
    return (
      <main className="leitura">
        <h1>revisão</h1>
        <p className="aguardando">{falha}</p>
        <Link className="voltar" href="/">
          voltar
        </Link>
      </main>
    );
  }

  if (!proposta) {
    return (
      <main className="leitura">
        <h1>revisão</h1>
        <p className="aguardando">…</p>
      </main>
    );
  }

  return (
    <main className="revisao">
      <header>
        <h1>o que eu entendi</h1>
        <p className="aguardando">
          {aprovados.length} de {atomos.length} — desmarque o que não presta, toque para editar
        </p>
      </header>

      <ol className="atomos">
        {atomos.map((a) => {
          const rejeitado = rejeitados.has(a.indice);
          const aberto = abertos.has(a.indice);
          const v = valorDe(a);
          // `?? []` protege contra proposta gravada por um prompt anterior, de
          // quando o átomo tinha uma âncora só. Ela aparece sem player, e
          // re-extrair com `forcar` devolve o formato novo.
          const ancorados = (a.trechos ?? []).filter((t) => t.inicio_s !== null);

          return (
            <li key={a.indice} className={rejeitado ? "atomo fora" : "atomo"}>
              <div className="linha">
                <input
                  type="checkbox"
                  checked={!rejeitado}
                  aria-label="manter este item"
                  onChange={() =>
                    setRejeitados((s) => {
                      const n = new Set(s);
                      if (n.has(a.indice)) n.delete(a.indice);
                      else n.add(a.indice);
                      return n;
                    })
                  }
                />
                <div className="corpo">
                  <span className="tipo">{v.tipo}</span>
                  <p onClick={() => setAbertos((s) => new Set(s).add(a.indice))}>{v.texto}</p>
                  <p className="meta">
                    sobre {v.sobre}
                    {a.menciona.length > 0 && ` · menciona ${a.menciona.join(", ")}`}
                  </p>
                  <div className="trechos">
                    {ancorados.map((t, k) => (
                      <button key={k} className="ouvir" onClick={() => void escutar(t.inicio_s!)}>
                        ▶ {mmss(t.inicio_s!)}
                        {t.ancora === "aproximada" && <span title="casamento aproximado">~</span>}
                      </button>
                    ))}
                    {ancorados.length === 0 && (
                      <span className="sem-ancora" title="o trecho não foi achado na transcrição">
                        sem áudio
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {aberto && (
                <div className="editor">
                  <textarea
                    value={v.texto}
                    rows={3}
                    onChange={(e) =>
                      setEdicoes((s) => ({ ...s, [a.indice]: { ...s[a.indice], texto: e.target.value } }))
                    }
                  />
                  <div className="campos">
                    <select
                      value={v.tipo}
                      onChange={(e) =>
                        setEdicoes((s) => ({
                          ...s,
                          [a.indice]: { ...s[a.indice], tipo: e.target.value as TipoAtomo },
                        }))
                      }
                    >
                      {TIPOS_ATOMO.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      value={v.sobre}
                      aria-label="sobre quem"
                      onChange={(e) =>
                        setEdicoes((s) => ({ ...s, [a.indice]: { ...s[a.indice], sobre: e.target.value } }))
                      }
                    />
                    <button
                      className="fraco"
                      onClick={() =>
                        setAbertos((s) => {
                          const n = new Set(s);
                          n.delete(a.indice);
                          return n;
                        })
                      }
                    >
                      fechar
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {entidades.length > 0 && (
        <section className="entidades">
          <h2>entidades</h2>
          <p className="aguardando">
            desmarcada, fica só no texto do átomo e não vira nó no grafo
          </p>
          {entidades.map((e) => {
            const travada = travadas.has(e.nome_normalizado);
            const marcada = travada || !semEntidade.has(e.nome_normalizado);
            return (
              <label key={e.nome_normalizado} className={travada ? "entidade travada" : "entidade"}>
                <input
                  type="checkbox"
                  checked={marcada}
                  disabled={travada}
                  title={travada ? "é o sujeito de um átomo aprovado" : undefined}
                  onChange={() =>
                    setSemEntidade((s) => {
                      const n = new Set(s);
                      if (n.has(e.nome_normalizado)) n.delete(e.nome_normalizado);
                      else n.add(e.nome_normalizado);
                      return n;
                    })
                  }
                />
                <span>{e.nome}</span>
                <span className="meta">
                  {e.tipo.toLowerCase()} ·{" "}
                  {e.conhecida ? `conhecida (${e.sessoes} sessões)` : `nova, citada ${e.ocorrencias}x`}
                </span>
              </label>
            );
          })}
        </section>
      )}

      <footer>
        {falha && <p className="aguardando">{falha}</p>}
        <button className="confirmar" onClick={() => void confirmar()} disabled={gravando}>
          {gravando ? "gravando…" : `confirmar ${aprovados.length} item(ns)`}
        </button>
        <Link className="voltar" href="/">
          depois
        </Link>
      </footer>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audio} preload="none" />
    </main>
  );
}
