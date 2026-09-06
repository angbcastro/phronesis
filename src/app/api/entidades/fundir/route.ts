import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { passadaDeVetores } from "@/lib/entidades";
import { fundir, FusaoError } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/entidades/fundir — `{ vencedora, perdedora }`, as duas por
 * `nome_normalizado`.
 *
 * A perdedora não é apagada: vira alias do vencedor (regra 6). Idempotente —
 * fundir de novo não acha o que migrar e devolve zero.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    vencedora?: unknown;
    perdedora?: unknown;
  } | null;

  const vencedora = typeof corpo?.vencedora === "string" ? corpo.vencedora : "";
  const perdedora = typeof corpo?.perdedora === "string" ? corpo.perdedora : "";
  if (vencedora === "" || perdedora === "") {
    return erro("corpo inválido: espera { vencedora, perdedora }", 400);
  }

  try {
    const r = await fundir(vencedora, perdedora);
    // A fusão acrescenta alias ao vencedor, e alias entra em `fonteDaEntidade`:
    // o hash muda, e o vetor tem de acompanhar (4.8.1).
    waitUntil(passadaDeVetores("fundir"));
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[fundir]", e);
    return erro(e instanceof Error ? e.message : "não consegui fundir", 502);
  }
}
