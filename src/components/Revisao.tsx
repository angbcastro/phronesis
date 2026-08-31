"use client";

/**
 * Tela de revisão — a última porta antes do grafo.
 *
 * O caso comum é aprovar tudo: a tela abre com todos os átomos marcados.
 * Discordar de um item custa um toque (desmarcar) e editar custa dois (botão
 * "editar"). Menos de 60 s numa sessão de 15 min, ou o sistema morre em três
 * semanas — `Specs/visao.md` §8.
 *
 * **A entidade é o lugar onde se corrige.** Quando o extrator devolve "ela"
 * porque eu nunca digo o nome dela em voz alta, eu renomeio uma vez no painel
 * de entidades e todos os átomos que apontam para ela passam a apontar para o
 * nome novo. Enquanto sobrar pronome, o confirmar fica travado: um nó chamado
 * "ela" é grafo apodrecido garantido — daqui a seis meses ninguém sabe quem era.
 *
 * O player é o que torna a revisão confiável: escuto antes de aprovar. Um átomo
 * pode ter vários trechos, então há um botão por âncora. Átomo sem âncora não
 * ganha player e aparece marcado — trecho que não existe na transcrição costuma
 * ser afirmação que o modelo inventou.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ehPronome, normalizarNome } from "@/lib/texto";
import { TIPOS_ATOMO, TIPOS_ENTIDADE } from "@/lib/tipos";
import type {
  AtomoProposto,
  BlocoAbsoluto,
  EntidadeCandidata,
  TipoAtomo,
  TipoEntidade,
} from "@/lib/tipos";

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

/** Edições locais de um átomo. Só o que eu mexi; o resto vem da proposta. */
interface Edicao {
  texto?: string;
  tipo?: TipoAtomo;
  sobre?: string;
}

/** Como a entidade ficou depois que eu mexi nela. */
interface Renome {
  nome: string;
  tipo: TipoEntidade;
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
  const [renomes, setRenomes] = useState<Record<string, Renome>>({});
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
      // Safari só aceita currentTime depois dos metadados; refazemos no evento.
      el.onloadedmetadata = () => {
        el.currentTime = alvo.dentro;
        void el.play();
      };
      el.currentTime = alvo.dentro;
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

  /** O que a entidade virou depois das minhas edições. */
  const finalDe = useCallback(
    (e: EntidadeCandidata): Renome => renomes[e.nome_normalizado] ?? { nome: e.nome, tipo: e.tipo },
    [renomes],
  );

  /**
   * Traduz um nome cru do átomo para o nome final. É isto que faz renomear a
   * entidade uma vez consertar todos os átomos que apontam para ela.
   */
  const nomeFinal = useCallback(
    (nomeCru: string): string => {
      const chave = normalizarNome(nomeCru);
      const candidata = entidades.find((e) => e.nome_normalizado === chave);
      return candidata ? finalDe(candidata).nome : nomeCru;
    },
    [entidades, finalDe],
  );

  const aprovados = atomos.filter((a) => !rejeitados.has(a.indice));

  /**
   * Entidade que é sujeito de um átomo aprovado não pode ser desmarcada: sem ela
   * o átomo ficaria sem `:SOBRE`, o que o schema não admite.
   */
  const travadas = useMemo(() => {
    const s = new Set<string>();
    for (const a of aprovados) s.add(normalizarNome(valorDe(a).sobre));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aprovados, edicoes]);

  const usada = (e: EntidadeCandidata) =>
    !semEntidade.has(e.nome_normalizado) || travadas.has(e.nome_normalizado);

  /** Ainda é pronome, e algum átomo aprovado depende dela. */
  const pendentes = entidades.filter(
    (e) => e.precisa_nome && usada(e) && ehPronome(finalDe(e).nome),
  );

  /** Pendente primeiro: é o que precisa da minha atenção. */
  const ordenadas = useMemo(
    () => [...entidades].sort((a, b) => Number(b.precisa_nome) - Number(a.precisa_nome)),
    [entidades],
  );

  function editarEntidade(e: EntidadeCandidata, mudanca: Partial<Renome>) {
    setRenomes((s) => ({
      ...s,
      [e.nome_normalizado]: {
        ...(s[e.nome_normalizado] ?? { nome: e.nome, tipo: e.tipo }),
        ...mudanca,
      },
    }));
  }

  async function confirmar() {
    if (!proposta || gravando || pendentes.length > 0) return;
    setGravando(true);
    setFalha(null);

    // A lista de entidades sai do painel, e qualquer sujeito que eu tenha
    // escrito à mão num átomo entra junto — senão o servidor recusaria o átomo
    // por sujeito fora da lista, que era o bug de antes.
    const paraGravar = new Map<string, Renome>();
    for (const e of entidades) {
      if (!usada(e)) continue;
      const f = finalDe(e);
      const chave = normalizarNome(f.nome);
      if (chave !== "" && !paraGravar.has(chave)) paraGravar.set(chave, f);
    }

    const corpoAtomos = aprovados.map((a) => {
      const v = valorDe(a);
      const sobre = nomeFinal(v.sobre);
      const chaveSobre = normalizarNome(sobre);
      if (chaveSobre !== "" && !paraGravar.has(chaveSobre)) {
        paraGravar.set(chaveSobre, { nome: sobre, tipo: "Pessoa" });
      }
      return {
        indice: a.indice,
        texto: v.texto,
        tipo: v.tipo,
        sobre,
        menciona: a.menciona
          .map(nomeFinal)
          .filter((m) => normalizarNome(m) !== chaveSobre && paraGravar.has(normalizarNome(m))),
      };
    });

    const r = await fetch(`/api/sessoes/${id}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aprovados: corpoAtomos, entidades: [...paraGravar.values()] }),
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
          {aprovados.length} de {atomos.length} — desmarque o que não presta, edite o que ficou torto
        </p>
      </header>

      <ol className="atomos">
        {atomos.map((a) => {
          const rejeitado = rejeitados.has(a.indice);
          const aberto = abertos.has(a.indice);
          const v = valorDe(a);
          const sobre = nomeFinal(v.sobre);
          const mencoes = a.menciona
            .map(nomeFinal)
            .filter((m) => normalizarNome(m) !== normalizarNome(sobre));
          // `?? []` protege contra proposta gravada por um prompt anterior, de
          // quando o átomo tinha uma âncora só.
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
                  <p>{v.texto}</p>
                  <p className="meta">
                    sobre {sobre}
                    {mencoes.length > 0 && ` · menciona ${mencoes.join(", ")}`}
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
                    <button
                      className="editar"
                      onClick={() =>
                        setAbertos((s) => {
                          const n = new Set(s);
                          if (n.has(a.indice)) n.delete(a.indice);
                          else n.add(a.indice);
                          return n;
                        })
                      }
                    >
                      {aberto ? "fechar" : "editar"}
                    </button>
                  </div>
                </div>
              </div>

              {aberto && (
                <div className="editor">
                  <textarea
                    value={v.texto}
                    rows={3}
                    aria-label="texto do átomo"
                    onChange={(e) =>
                      setEdicoes((s) => ({ ...s, [a.indice]: { ...s[a.indice], texto: e.target.value } }))
                    }
                  />
                  <div className="campos">
                    <select
                      value={v.tipo}
                      aria-label="tipo do átomo"
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
                      value={sobre}
                      aria-label="sobre quem"
                      onChange={(e) =>
                        setEdicoes((s) => ({ ...s, [a.indice]: { ...s[a.indice], sobre: e.target.value } }))
                      }
                    />
                  </div>
                  <p className="aguardando">
                    para trocar um nome em todos os átomos de uma vez, edite a entidade lá embaixo
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <section className="entidades">
        <h2>entidades</h2>
        <p className="aguardando">desmarcada, fica só no texto do átomo e não vira nó no grafo</p>

        {ordenadas.map((e) => {
          const f = finalDe(e);
          const travada = travadas.has(e.nome_normalizado);
          const marcada = usada(e);
          const pedindoNome = e.precisa_nome && marcada && ehPronome(f.nome);

          return (
            <div
              key={e.nome_normalizado}
              className={`entidade${travada ? " travada" : ""}${pedindoNome ? " pedindo" : ""}`}
            >
              <input
                type="checkbox"
                checked={marcada}
                disabled={travada}
                aria-label={`incluir ${e.nome}`}
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

              {e.conhecida ? (
                // O grafo vence: entidade que já existe mantém nome e tipo.
                <span className="nome">{e.nome}</span>
              ) : (
                <>
                  <input
                    className="nome"
                    value={f.nome}
                    placeholder={pedindoNome ? "quem é?" : undefined}
                    aria-label={`nome de ${e.nome}`}
                    onChange={(ev) => editarEntidade(e, { nome: ev.target.value })}
                  />
                  <select
                    value={f.tipo}
                    aria-label={`tipo de ${e.nome}`}
                    onChange={(ev) => editarEntidade(e, { tipo: ev.target.value as TipoEntidade })}
                  >
                    {TIPOS_ENTIDADE.map((t) => (
                      <option key={t} value={t}>
                        {t.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <span className="meta">
                {pedindoNome
                  ? `quem é "${e.nome}"? · ${e.ocorrencias} menção(ões)`
                  : e.conhecida
                    ? `${e.tipo.toLowerCase()} · conhecida (${e.sessoes} sessões)`
                    : `nova, citada ${e.ocorrencias}x`}
              </span>
            </div>
          );
        })}
      </section>

      <footer>
        {pendentes.length > 0 && (
          <p className="aguardando">
            diga quem {pendentes.length === 1 ? "é" : "são"}{" "}
            {pendentes.map((e) => `"${e.nome}"`).join(", ")} antes de confirmar
          </p>
        )}
        {falha && <p className="aguardando">{falha}</p>}
        <button
          className="confirmar"
          onClick={() => void confirmar()}
          disabled={gravando || pendentes.length > 0}
        >
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
