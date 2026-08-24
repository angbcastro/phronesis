"use client";

/**
 * Tela de processamento e leitura.
 *
 * A transcrição aparece em pedaços conforme fica pronta — cada bloco foi
 * transcrito assim que subiu, então ao parar só falta o último. Quando
 * termina, é só o texto na tela: nesta slice não há ação seguinte.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { acordar, aguardarFilaVazia } from "@/client/fila";

interface Estado {
  status: string;
  texto: string;
  completa: boolean;
  chunks_total: number;
  chunks_transcritos: number;
}

const INTERVALO_POLL_MS = 2000;

export function Leitura({ id }: { id: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [falhou, setFalhou] = useState(false);
  const finalizou = useRef(false);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;

    async function buscar(): Promise<Estado | null> {
      const r = await fetch(`/api/sessoes/${id}`, { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()) as Estado;
    }

    /** Os blocos que ainda não subiram têm que chegar antes de finalizar. */
    async function garantirFinalizacao(atual: Estado) {
      if (finalizou.current) return;
      if (["finalizando", "transcrevendo", "transcrito"].includes(atual.status)) return;
      finalizou.current = true;

      acordar();
      await aguardarFilaVazia();

      const guardada = sessionStorage.getItem(`duracao:${id}`);
      await fetch(`/api/sessoes/${id}/finalizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guardada ? { duracao_s: Number(guardada) } : {}),
      }).catch(() => setFalhou(true));
    }

    async function volta() {
      const atual = await buscar();
      if (!vivo) return;

      if (atual) {
        setEstado(atual);
        setFalhou(atual.status === "erro");
        void garantirFinalizacao(atual);
        if (atual.completa) return; // pronto: para o polling
      }
      timer = setTimeout(volta, INTERVALO_POLL_MS);
    }

    void volta();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [id]);

  const texto = estado?.texto ?? "";

  return (
    <main className="leitura">
      <h1>{estado?.completa ? "transcrição" : "transcrevendo"}</h1>

      {texto ? <p>{texto}</p> : <p className="aguardando">…</p>}

      {!estado?.completa && texto && <p className="aguardando">…</p>}

      {falhou && (
        <p className="aguardando">
          A transcrição falhou. O áudio está inteiro no servidor — dá para tentar de novo.
        </p>
      )}

      <Link className="voltar" href="/">
        voltar
      </Link>
    </main>
  );
}
