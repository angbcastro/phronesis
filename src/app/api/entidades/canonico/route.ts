import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { passadaDeVetores } from "@/lib/entidades";
import { FusaoError, marcarCanonico } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/canonico — `{ chave, canonico }`.
 *
 * "Esta é a ficha oficial desta entidade." Um toque, reversível, sem
 * consequência retroativa — nenhum átomo já gravado muda por causa disto.
 *
 * **É preferência, não obrigação** (migration 009): não exige sobrenome, não
 * impede entidade nova de nascer e não trava unicidade nenhuma. O que a flag faz
 * é entrar marcada nos dois prompts e vencer, em código, quando dois candidatos
 * empatam no desempate determinístico.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    canonico?: unknown;
  } | null;

  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  if (chave === "" || typeof corpo?.canonico !== "boolean") {
    return erro("corpo inválido: espera { chave, canonico: boolean }", 400);
  }

  try {
    await marcarCanonico(chave, corpo.canonico);
    waitUntil(passadaDeVetores("canonico"));
    return NextResponse.json({ ok: true, canonico: corpo.canonico });
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[canonico]", e);
    return erro(e instanceof Error ? e.message : "não consegui marcar", 502);
  }
}
