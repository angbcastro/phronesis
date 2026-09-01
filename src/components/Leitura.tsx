"use client";

/**
 * Tela de transcrição — porta de serviço, fora da jornada padrão.
 *
 * Mostra o texto do que foi falado, em pedaços conforme fica pronto. **Não é
 * por aqui que a gravação passa**: quem grava vai de `Processando` direto para
 * a revisão. Esta tela existe para quando eu quero conferir a transcrição
 * literal — checar um nome que saiu errado, ver se o STT comeu um trecho — e
 * se chega a ela pelo botão "transcrição" na lista de sessões.
 *
 * Por isso ela não finaliza sessão nem redireciona para lugar nenhum: só lê.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { temTranscricao } from "@/lib/estados";
import type { StatusSessao } from "@/lib/tipos";

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

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;

    async function volta() {
      const r = await fetch(`/api/sessoes/${id}`, { cache: "no-store" }).catch(() => null);
      if (!vivo) return;

      if (r?.ok) {
        const atual = (await r.json()) as Estado;
        if (!vivo) return;
        setEstado(atual);
        // O texto é o que interessa aqui; quando ele está inteiro, para de
        // perguntar. A extração continua atrás, e não muda nada nesta tela.
        if (atual.completa || temTranscricao(atual.status as StatusSessao)) return;
        if (atual.status === "erro") return;
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

      {estado?.status === "erro" && (
        <p className="aguardando">
          A transcrição falhou. O áudio está inteiro no servidor — dá para tentar de novo.
        </p>
      )}

      {estado?.status === "em_revisao" && (
        <Link className="revisar" href={`/sessao/${id}/revisar`}>
          revisar o que eu entendi
        </Link>
      )}

      <Link className="voltar" href="/sessoes">
        voltar
      </Link>
    </main>
  );
}
