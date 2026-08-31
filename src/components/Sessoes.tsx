"use client";

/**
 * Lista de áudios — a porta de serviço.
 *
 * Existe para uma coisa: achar uma sessão e forçar a re-extração dela. É como
 * se calibra o prompt sem gravar áudio novo, já que a trava de idempotência
 * impede reprocessar uma sessão que já tem proposta.
 *
 * Fica atrás de um link discreto de propósito. A tela de gravar é "um botão,
 * um timer, um jeito de parar — idealmente nada mais" (`Specs/visao.md` §6), e
 * uma lista de sessões passadas ali vira cobrança: quantos dias, quanto tempo,
 * o que ficou pendente. Aqui não há contagem de nada.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Sessao {
  id: string;
  iniciada_em: string;
  duracao_s: number;
  status: string;
  chunks_total: number;
}

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const quando = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "data desconhecida" : QUANDO.format(d);
};

export const duracao = (s: number): string =>
  s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`;

/** Para onde a sessão leva quando eu clico nela. */
export function destino(s: Sessao): string {
  return s.status === "em_revisao" ? `/sessao/${s.id}/revisar` : `/sessao/${s.id}`;
}

/**
 * Uma sessão já confirmada não se re-extrai: os átomos dela estão no grafo e o
 * confirmar não aceita `confirmada` de novo, então a proposta nova nasceria
 * morta. Desfazer um confirmar não existe nesta slice.
 */
export const podeReextrair = (s: Sessao): boolean =>
  ["transcrito", "extraindo", "em_revisao", "erro"].includes(s.status);

export function Sessoes() {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [armado, setArmado] = useState<string | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);
  const [feito, setFeito] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    const r = await fetch("/api/sessoes", { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) {
      setFalha("não deu para carregar a lista");
      return;
    }
    setSessoes(((await r.json()) as { sessoes: Sessao[] }).sessoes);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Dois toques, não um: forçar sobrescreve uma proposta que eu posso já ter
   * revisado, e um toque acidental numa lista custaria esse trabalho.
   */
  async function reextrair(id: string) {
    if (armado !== id) {
      setArmado(id);
      return;
    }
    setArmado(null);
    setRodando(id);
    setFalha(null);

    const r = await fetch(`/api/sessoes/${id}/extrair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forcar: true }),
    }).catch(() => null);

    setRodando(null);
    if (!r || !r.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setFeito((s) => new Set(s).add(id));
    void carregar();
  }

  return (
    <main className="sessoes">
      <header>
        <h1>áudios</h1>
        <p className="aguardando">
          {sessoes ? `${sessoes.length} sessão(ões)` : "…"} — reextrair chama o modelo de novo e
          sobrescreve a proposta atual
        </p>
      </header>

      {falha && <p className="aguardando">{falha}</p>}

      <ul className="lista-sessoes">
        {(sessoes ?? []).map((s) => (
          <li key={s.id}>
            <Link href={destino(s)} className="quando">
              <span>{quando(s.iniciada_em)}</span>
              <span className="meta">
                {duracao(s.duracao_s)} · {s.status.replace("_", " ")}
                {feito.has(s.id) && " · reextraindo…"}
              </span>
            </Link>

            {podeReextrair(s) ? (
              <button
                className={armado === s.id ? "reextrair armado" : "reextrair"}
                disabled={rodando === s.id}
                onClick={() => void reextrair(s.id)}
                onBlur={() => armado === s.id && setArmado(null)}
              >
                {rodando === s.id ? "…" : armado === s.id ? "sobrescrever?" : "reextrair"}
              </button>
            ) : (
              <span
                className="meta"
                title={
                  s.status === "confirmada"
                    ? "já está no grafo — desfazer um confirmar não existe"
                    : "ainda não tem transcrição"
                }
              >
                —
              </span>
            )}
          </li>
        ))}
      </ul>

      {sessoes?.length === 0 && <p className="aguardando">nenhum áudio ainda</p>}

      <Link className="voltar" href="/">
        voltar
      </Link>
    </main>
  );
}
