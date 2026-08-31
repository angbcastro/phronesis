"use client";

/**
 * Chip de sessão não finalizada.
 *
 * É dispensável e não volta a insistir. Nenhuma contagem de dias, nenhuma
 * sequência, nenhum lembrete de dia pulado — nada que cobre.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

interface SessaoAberta {
  id: string;
  status: string;
  duracao_s: number;
  chunks_total: number;
  proximo_chunk: number;
}

const CHAVE_DISPENSADAS = "phronesis:dispensadas";

function dispensadas(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_DISPENSADAS) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function dispensar(id: string) {
  localStorage.setItem(CHAVE_DISPENSADAS, JSON.stringify([...dispensadas(), id].slice(-50)));
}

const minutos = (s: number) => Math.max(1, Math.round(s / 60));

export function ChipRecuperacao({
  aoRetomar,
}: {
  aoRetomar: (s: { id: string; proximo_chunk: number; duracao_s: number }) => void;
}) {
  const [sessao, setSessao] = useState<SessaoAberta | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/sessoes/abertas")
      .then((r) => (r.ok ? r.json() : { sessoes: [] }))
      .then((d: { sessoes: SessaoAberta[] }) => {
        if (!vivo) return;
        const ignoradas = dispensadas();
        setSessao(d.sessoes.find((s) => !ignoradas.includes(s.id)) ?? null);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (!sessao) return null;

  // Sessão extraída não se retoma nem se reprocessa: o que falta nela é a minha
  // revisão. Oferecer "retomar" aqui seria mandar gravar por cima do que já
  // está pronto.
  if (sessao.status === "em_revisao") {
    return (
      <div className="chip">
        <p>sessão de {minutos(sessao.duracao_s)} min esperando revisão</p>
        <Link href={`/sessao/${sessao.id}/revisar`} style={{ color: "inherit" }}>
          revisar
        </Link>
        <button
          className="fraco"
          onClick={() => {
            dispensar(sessao.id);
            setSessao(null);
          }}
        >
          depois
        </button>
      </div>
    );
  }

  return (
    <div className="chip">
      <p>sessão de {minutos(sessao.duracao_s)} min não finalizada</p>
      <button
        onClick={() =>
          aoRetomar({
            id: sessao.id,
            proximo_chunk: sessao.proximo_chunk,
            duracao_s: sessao.duracao_s,
          })
        }
      >
        retomar
      </button>
      <Link href={`/sessao/${sessao.id}`} style={{ color: "inherit" }}>
        processar
      </Link>
      <button
        className="fraco"
        onClick={() => {
          dispensar(sessao.id);
          setSessao(null);
        }}
      >
        descartar
      </button>
    </div>
  );
}
