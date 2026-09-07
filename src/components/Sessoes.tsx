"use client";

/**
 * Lista de sessões — a porta de serviço.
 *
 * Existe para duas coisas: achar uma sessão e forçar a re-extração dela — é
 * como se calibra o prompt sem gravar áudio novo, já que a trava de
 * idempotência impede reprocessar uma sessão que já tem proposta — e ler a
 * transcrição literal, que saiu da jornada de gravar e mora aqui.
 *
 * **É aqui que se vê o que falta revisar**, e é pela cor: verde é sessão que já
 * passou pela revisão, branco é sessão que ainda tem trabalho. Antes isso era um
 * chip na tela de gravar, que aparecia sozinho e cobrava. Um estado que eu leio
 * de relance no lugar onde eu já vou procurar não cobra nada.
 *
 * Fica atrás de um link discreto de propósito. A tela de gravar é "um botão,
 * um timer, um jeito de parar — idealmente nada mais" (`Specs/visao.md` §6), e
 * uma lista de sessões passadas ali vira cobrança: quantos dias, quanto tempo,
 * o que ficou pendente. Aqui não há contagem de nada.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { temTranscricao, terminouDeProcessar } from "@/lib/estados";
import type { StatusSessao } from "@/lib/tipos";

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

/**
 * Para onde a sessão leva quando eu clico nela: **sempre para onde ainda há o
 * que fazer**.
 *
 * Proposta esperando abre na revisão. Sessão confirmada não tem mais trabalho
 * nenhum, e o que resta dela é o texto literal. Todo o resto — inclusive
 * `transcrito` e `extraindo` — vai para o corredor, que é quem sabe empurrar a
 * sessão para o passo seguinte e abre a revisão sozinho quando a proposta fica
 * pronta.
 *
 * `transcrito` levava ao texto literal, e isso era um beco: uma sessão que
 * transcreveu e nunca extraiu — `waitUntil` perdido, extração que morreu — não
 * tinha caminho nenhum até a revisão. Ler a transcrição continua a um toque
 * daqui, no botão ao lado, que é onde essa porta de serviço deve estar.
 */
export function destino(s: Sessao): string {
  if (s.status === "em_revisao") return `/sessao/${s.id}/revisar`;
  if (s.status === "confirmada") return `/sessao/${s.id}/transcricao`;
  return `/sessao/${s.id}`;
}

/**
 * A transcrição literal só se oferece quando ela está inteira no R2. Enquanto
 * a sessão transcreve, o texto ainda está crescendo e quem clica na linha cai
 * na tela de processamento, que é onde essa espera acontece.
 */
export const podeLerTranscricao = (s: Sessao): boolean => temTranscricao(s.status as StatusSessao);

/**
 * Uma sessão já confirmada não se re-extrai: os átomos dela estão no grafo e o
 * confirmar não aceita `confirmada` de novo, então a proposta nova nasceria
 * morta. Desfazer um confirmar não existe nesta slice.
 */
export const podeReextrair = (s: Sessao): boolean =>
  ["transcrito", "extraindo", "em_revisao", "erro"].includes(s.status);

/**
 * Já passou pela revisão: os átomos dela estão no grafo.
 *
 * É o único estado terminal da máquina (`ARCHITECTURE.md` §5) e o único que a
 * lista pinta. Verde tem de querer dizer "terminado" — pintar de verde uma
 * sessão que ainda tem trabalho é pior que não pintar nada.
 */
export const jaRevisada = (s: Sessao): boolean => s.status === "confirmada";

/**
 * Dá para apagar: nada mais vai mudar sozinho nesta sessão.
 *
 * A mesma guarda que a rota aplica, e pelo mesmo motivo — apagar no meio do
 * pipeline correria com um `waitUntil` vivo, que voltaria a gravar o que acabou
 * de sumir. Aqui ela só evita oferecer um botão que levaria 409.
 */
export const podeApagar = (s: Sessao): boolean => terminouDeProcessar(s.status as StatusSessao);

export function Sessoes() {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [armado, setArmado] = useState<string | null>(null);
  const [armadoApagar, setArmadoApagar] = useState<string | null>(null);
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

  /**
   * Dois toques, como o reextrair, e pelo mesmo motivo escrito lá: um toque
   * acidental numa lista custaria trabalho. Aqui custaria a sessão — o áudio, a
   * transcrição e a proposta somem do R2 e não voltam.
   *
   * A linha sai da lista no sucesso em vez de recarregar: `todasSessoes` já
   * filtra a descartada, mas recarregar seria uma ida ao grafo para descobrir o
   * que esta tela acabou de mandar acontecer.
   */
  async function apagar(id: string) {
    if (armadoApagar !== id) {
      setArmadoApagar(id);
      return;
    }
    setArmadoApagar(null);
    setRodando(id);
    setFalha(null);

    const r = await fetch(`/api/sessoes/${id}`, { method: "DELETE" }).catch(() => null);

    setRodando(null);
    if (!r || !r.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setSessoes((atual) => (atual ?? []).filter((s) => s.id !== id));
  }

  return (
    <main className="sessoes">
      <header>
        <h1>sessões</h1>
        <p className="aguardando">
          {sessoes ? `${sessoes.length} sessão(ões)` : "…"} · verde é o que eu já revisei —
          reextrair chama o modelo de novo e sobrescreve a proposta atual; transcrição abre o
          texto literal; apagar tira o áudio e a proposta do R2 e some com a linha
        </p>
      </header>

      {falha && <p className="aguardando">{falha}</p>}

      <ul className="lista-sessoes">
        {(sessoes ?? []).map((s) => (
          <li key={s.id} className={jaRevisada(s) ? "revisada" : undefined}>
            <Link href={destino(s)} className="quando">
              <span>{quando(s.iniciada_em)}</span>
              <span className="meta">
                {duracao(s.duracao_s)} · {s.status.replace("_", " ")}
                {feito.has(s.id) && " · reextraindo…"}
              </span>
            </Link>

            <div className="acoes-sessao">
              {podeLerTranscricao(s) && (
                <Link className="reextrair" href={`/sessao/${s.id}/transcricao`}>
                  transcrição
                </Link>
              )}

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

              {podeApagar(s) && (
                <button
                  className={armadoApagar === s.id ? "reextrair armado" : "reextrair"}
                  disabled={rodando === s.id}
                  onClick={() => void apagar(s.id)}
                  onBlur={() => armadoApagar === s.id && setArmadoApagar(null)}
                  title="apaga o áudio, a transcrição e a proposta no R2; o que já está no grafo fica"
                >
                  {rodando === s.id ? "…" : armadoApagar === s.id ? "apagar?" : "apagar"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {sessoes?.length === 0 && <p className="aguardando">nenhuma sessão ainda</p>}

    </main>
  );
}
