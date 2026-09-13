"use client";

/**
 * Tela de manutenção do agente `confronto` (slice 5) — o mesmo espírito de
 * `/agentes` e `/entidades`: aqui não se lê o diário, se olha o que o agente
 * de relações andou fazendo sozinho.
 *
 * **Só dois botões de verdade**: "rodar agora" dispara a fila (que anda
 * sozinha depois, em `waitUntil`, mesmo mecanismo da fila de enriquecimento),
 * e "desfazer" por linha apaga o que a última rodada daquele átomo escreveu.
 * Não há navegação de relações aqui — só a lista de recentes; uma visão mais
 * rica fica para quando o chat precisar mostrar isso como procedência.
 *
 * **Enquanto houver fila, a tela relê sozinha**, mesma decisão de
 * `/entidades`: fechar a aba não interrompe nada, só para de mostrar.
 */
import { useCallback, useEffect, useState } from "react";
import type { AtomoRecente } from "@/lib/confronto";

interface Estado {
  fila: number;
  recentes: AtomoRecente[];
}

/** O mesmo do corredor de entidades: rápido o bastante para parecer vivo, e barato. */
const INTERVALO_FILA_MS = 4000;

const ROTULO_RELACAO: Record<string, string> = {
  ATUALIZA: "atualiza",
  CONTRADIZ: "contradiz",
  CONFIRMA: "confirma",
  COMPLEMENTA: "complementa",
};

export function Confronto() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [armado, setArmado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/confronto", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) {
      setFalha("não deu para ler o estado do confronto");
      return;
    }
    setFalha(null);
    setEstado((await r.json()) as Estado);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** Enquanto houver fila, a tela relê sozinha — mesma decisão de `/entidades`. */
  useEffect(() => {
    if (!estado || estado.fila === 0) return;
    const t = setInterval(() => void carregar(), INTERVALO_FILA_MS);
    return () => clearInterval(t);
  }, [estado, carregar]);

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
   * Dois toques, como o apagar sessão: o primeiro arma e o rótulo passa a
   * dizer o tamanho do estrago, o segundo executa. É destrutivo — apaga TODAS
   * as relações — e sem desfazer próprio; o que o justifica é que a varredura
   * reconstrói, e que trocar o prompt sem isto deixaria o passado congelado no
   * prompt velho.
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

  return (
    <main className="sessoes">
      <header>
        <h1>Confronto</h1>
        <p>
          Compara cada átomo com os mais antigos parecidos por vetor e decide se um atualiza,
          contradiz, confirma ou complementa o outro. Roda sozinho, uma vez por dia, e também
          quando eu peço.
        </p>
      </header>

      {falha && <p className="aviso">{falha}</p>}

      <div className="acoes-sessao">
        <button className="reextrair" onClick={() => void rodar()} disabled={rodando}>
          {rodando ? "rodando…" : "rodar agora"}
        </button>
        <button
          className={armado ? "reextrair armado" : "reextrair"}
          onClick={() => void reprocessar()}
          onBlur={() => armado && setArmado(false)}
          disabled={rodando}
          title="apaga todas as relações e devolve o grafo inteiro à fila — é como um prompt novo alcança o que já foi julgado"
        >
          {armado ? "apagar tudo e rodar de novo?" : "reprocessar tudo"}
        </button>
        {estado && estado.fila > 0 && (
          <span className="meta">{estado.fila} átomo(s) na fila — pode fechar a aba</span>
        )}
      </div>

      {!estado ? (
        <p className="aguardando">carregando…</p>
      ) : estado.recentes.length === 0 ? (
        <p className="aguardando">nenhum átomo processado ainda.</p>
      ) : (
        <ul className="lista-sessoes">
          {estado.recentes.map((a) => (
            <li key={a.id}>
              <div className="quando">
                <span className="meta">
                  [{a.tipo}] {a.em.slice(0, 10)} —{" "}
                  {a.estado === "falhou"
                    ? `falhou: ${a.motivo}`
                    : a.tipos.length === 0
                      ? "nenhuma relação"
                      : a.tipos.map((t) => ROTULO_RELACAO[t] ?? t).join(", ")}
                </span>
                <span>{a.texto}</span>
              </div>
              <div className="acoes-sessao">
                {a.estado === "processado" && (
                  <button
                    className="reextrair"
                    disabled={ocupado === a.id}
                    onClick={() => void desfazer(a.id)}
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
