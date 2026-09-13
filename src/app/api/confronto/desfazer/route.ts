import { NextResponse } from "next/server";
import { ConfrontoError, desfazerConfronto } from "@/lib/confronto";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/confronto/desfazer — `{ atomo_id }`.
 *
 * O contrapeso do "escreve sozinho": o agente `confronto` grava relação sem
 * eu ver antes, e esta rota apaga o que a última rodada daquele átomo
 * escreveu — mesmo par de `POST /api/entidades/desfazer` para a ficha.
 *
 * Um toque, e não dois: ela restaura o átomo a "nunca tentado", não destrói
 * conteúdo nenhum — a pior consequência de um toque acidental é o átomo
 * reentrar na fila e ser reprocessado.
 *
 * Sem geração guardada, 400: o átomo nunca passou pela varredura, e não há o
 * que desfazer.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { atomo_id?: unknown } | null;
  const atomoId = typeof corpo?.atomo_id === "string" ? corpo.atomo_id : "";
  if (atomoId === "") return erro("corpo inválido: espera { atomo_id }", 400);

  try {
    const r = await desfazerConfronto(atomoId);
    if (!r) return erro("este átomo nunca foi tocado pelo confronto", 400);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ConfrontoError) return erro(e.message, 400);
    console.error("[confronto/desfazer]", e);
    return erro(e instanceof Error ? e.message : "não consegui desfazer", 502);
  }
}
