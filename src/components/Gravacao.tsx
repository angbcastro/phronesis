"use client";

/**
 * A tela de gravar: um botão, um timer, um jeito de parar.
 *
 * Durante a fala não aparece nada além do timer e de um ponto discreto de
 * "salvo". Sem waveform, sem contador de blocos, sem barra de progresso —
 * a mecânica de upload é invisível.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Gravador, suportado } from "@/client/gravador";
import { acordar, enfileirar, observarFila, type EstadoFila } from "@/client/fila";
import { guardarSessaoAtual, limparSessaoAtual } from "@/client/deposito";
import { ChipRecuperacao } from "./ChipRecuperacao";
import { Importacao } from "./Importacao";

type Fase = "parado" | "abrindo" | "gravando" | "encerrando";

function mmss(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Gravacao() {
  const router = useRouter();
  const gravador = useRef<Gravador | null>(null);
  const sessaoId = useRef<string | null>(null);

  const [fase, setFase] = useState<Fase>("parado");
  const [segundos, setSegundos] = useState(0);
  const [fila, setFila] = useState<EstadoFila>({ pendentes: 0, ultimo_salvo_em: null, offline: false });
  const [problema, setProblema] = useState<string | null>(null);

  useEffect(() => observarFila(setFila), []);
  useEffect(() => acordar(), []);

  useEffect(() => {
    if (fase !== "gravando") return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [fase]);

  const comecar = useCallback(
    async (retomar?: { id: string; proximo_chunk: number; duracao_s: number }) => {
      if (!suportado()) {
        setProblema("Este navegador não grava áudio no formato que o sistema usa.");
        return;
      }
      setProblema(null);
      setFase("abrindo");

      try {
        let id = retomar?.id;
        if (!id) {
          const r = await fetch("/api/sessoes", { method: "POST" });
          if (!r.ok) throw new Error(`/api/sessoes respondeu ${r.status}`);
          id = ((await r.json()) as { id: string }).id;
        }

        sessaoId.current = id;
        await guardarSessaoAtual(id);

        const g = new Gravador({
          indiceInicial: retomar?.proximo_chunk ?? 0,
          aoBloco: ({ i, blob }) => void enfileirar(id!, i, blob),
          aoErro: (e) => console.error("[gravador]", e),
        });

        await g.iniciar();
        gravador.current = g;
        setSegundos(retomar?.duracao_s ?? 0);
        setFase("gravando");
      } catch (e) {
        console.error(e);
        setProblema("Não consegui começar a gravar. O microfone está liberado?");
        setFase("parado");
      }
    },
    [],
  );

  const parar = useCallback(async () => {
    if (fase !== "gravando") return;
    setFase("encerrando");

    const g = gravador.current;
    const id = sessaoId.current;
    const duracao = g?.duracaoS() ?? segundos;

    await g?.parar();
    gravador.current = null;
    await limparSessaoAtual();
    acordar();

    if (id) {
      sessionStorage.setItem(`duracao:${id}`, String(Math.round(duracao)));
      router.push(`/sessao/${id}`);
    } else {
      setFase("parado");
    }
  }, [fase, router, segundos]);

  if (fase === "gravando" || fase === "encerrando") {
    const salvo = fila.pendentes === 0 && fila.ultimo_salvo_em !== null;
    return (
      <main className="tela">
        <div className="timer">{mmss(segundos)}</div>
        <div className={`ponto-salvo ${salvo ? "" : "pendente"}`}>
          <i /> {salvo ? "salvo" : "salvando"}
        </div>
        <button className="botao-parar" onClick={parar} disabled={fase === "encerrando"}>
          {fase === "encerrando" ? "encerrando…" : "parar"}
        </button>
      </main>
    );
  }

  return (
    <main className="tela">
      <button className="botao-gravar" onClick={() => comecar()} disabled={fase === "abrindo"}>
        Como foi seu dia?
      </button>
      <Importacao />
      <ChipRecuperacao aoRetomar={comecar} />
      {problema && <p className="aviso">{problema}</p>}
    </main>
  );
}
