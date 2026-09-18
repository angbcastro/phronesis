"use client";

/**
 * Tela de processamento — o corredor entre parar de falar e revisar.
 *
 * Ela não mostra a transcrição. A transcrição é insumo do extrator, não coisa
 * que eu leio: parar aqui para ler quinze minutos de texto é exatamente o
 * atrito que mata o ritual. O que esta tela faz é fechar a sessão (esperar a
 * fila esvaziar e chamar `/finalizar`), dizer em que passo o sistema está e
 * **ir sozinha para a revisão** quando a proposta fica pronta.
 *
 * Quem quiser ler o texto vai pela lista de sessões — `/sessao/:id/transcricao`.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { acordar, aguardarFilaVazia } from "@/client/fila";
import { marcarFilaVazia } from "@/client/medidas";
import { terminouDeProcessar } from "@/lib/estados";
import type { StatusSessao } from "@/lib/tipos";

interface Estado {
  status: string;
  completa: boolean;
}

/**
 * De quanto em quanto tempo a tela pergunta em que passo a sessão está.
 *
 * Eram 2 s, e é o último dos três pollings do caminho (§4.17) — e o mais caro
 * dos três em espera percebida: a proposta pode ficar pronta logo depois de uma
 * pergunta, e aí a revisão só abre quase dois segundos depois de existir. 750 ms
 * é uma requisição a cada três quartos de segundo numa tela que dura dezenas de
 * segundos, num sistema de um usuário — e corta a metade dessa espera morta.
 */
const INTERVALO_POLL_MS = 750;

/**
 * A sessão precisa que alguém chame `/finalizar` para andar?
 *
 * Os estados de fora são os que já estão andando por conta própria, ou que
 * acabaram. Os de dentro são os que ficariam parados para sempre se ninguém
 * empurrasse:
 *
 *   gravando    a sessão nunca foi fechada — é o caso comum, vindo do botão
 *   transcrito  transcreveu e não extraiu: o `waitUntil` da extração se perdeu
 *   erro        falhou no meio; `/finalizar` é o retry manual
 *
 * `transcrito` estava de fora, e era um beco sem saída: a sessão tinha texto no
 * R2, nenhuma proposta, e nada em tela nenhuma que disparasse a extração. A
 * chamada é idempotente — proposta que já existe não rechama o modelo (regra 4),
 * e `finalizou` garante uma por visita.
 */
export function precisaFinalizar(status: string): boolean {
  return !["finalizando", "transcrevendo", "extraindo", "em_revisao", "confirmada"].includes(status);
}

/** O que dizer em cada passo. Um verbo, sem barra de progresso. */
export function legenda(status: string | undefined, completa: boolean): string {
  if (status === "extraindo") return "lendo o que você disse…";
  if (completa || status === "transcrito") return "lendo o que você disse…";
  if (status === "finalizando") return "guardando o áudio…";
  return "transcrevendo…";
}

export function Processando({ id }: { id: string }) {
  const router = useRouter();
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
      if (!precisaFinalizar(atual.status)) return;
      finalizou.current = true;

      acordar();
      await aguardarFilaVazia();

      // A segunda das três marcas do cliente (slice 8), mandada junto com a
      // primeira: é aqui que as duas existem, e é o último ponto antes de o
      // servidor assumir. Sem `await` — o `/finalizar` não espera por medida.
      void marcarFilaVazia(id);

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

        // A porta da frente: a proposta ficou pronta, a revisão abre sozinha.
        // `replace` porque voltar para um corredor já atravessado não faz
        // sentido — o botão de voltar tem que sair da sessão, não reentrar.
        if (atual.status === "em_revisao") {
          router.replace(`/sessao/${id}/revisar`);
          return;
        }
        if (terminouDeProcessar(atual.status as StatusSessao)) return;
      }
      timer = setTimeout(volta, INTERVALO_POLL_MS);
    }

    void volta();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [id, router]);

  const status = estado?.status;

  return (
    <main className="leitura">
      <h1>{status === "confirmada" ? "já está no grafo" : "um instante"}</h1>

      {status === "confirmada" ? (
        <p className="aguardando">Essa sessão já foi confirmada — os átomos dela estão no Neo4j.</p>
      ) : falhou ? (
        <p className="aguardando">
          Alguma coisa falhou no meio do caminho. O áudio está inteiro no servidor — dá para tentar
          de novo pela lista de <Link href="/sessoes">sessões</Link>.
        </p>
      ) : (
        <p className="aguardando">{legenda(status, estado?.completa ?? false)}</p>
      )}

    </main>
  );
}
