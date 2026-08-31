import { NextResponse } from "next/server";
import { FusaoError, marcarDistintas } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/distintas — `{ a, b }`. "Essas duas são coisas
 * diferentes, não me pergunte de novo."
 *
 * Sem isto a tela repete a mesma sugestão a cada busca, e cobrança é uma das
 * formas de morte da visão. Ignorar continua sendo saída válida; ignorar a
 * mesma pergunta doze vezes não é.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { a?: unknown; b?: unknown } | null;

  const a = typeof corpo?.a === "string" ? corpo.a : "";
  const b = typeof corpo?.b === "string" ? corpo.b : "";
  if (a === "" || b === "") return erro("corpo inválido: espera { a, b }", 400);

  try {
    await marcarDistintas(a, b);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[distintas]", e);
    return erro(e instanceof Error ? e.message : "não consegui gravar", 502);
  }
}
