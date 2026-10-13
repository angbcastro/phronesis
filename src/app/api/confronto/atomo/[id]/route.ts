import { NextResponse } from "next/server";
import { idDeAtomoValido } from "@/lib/chaves";
import { lerRadial } from "@/lib/confronto";
import { erro, erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/confronto/atomo/[id] — o radial de um átomo (slice 5.2): ele, todas
 * as relações dele nas duas direções, e os vizinhos.
 *
 * Só leitura. Quem escreve é `POST /api/confronto/relacao`.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!idDeAtomoValido(id)) return erro("id de átomo inválido", 400);

  try {
    const radial = await lerRadial(id);
    if (!radial) return erro("esse átomo não está no grafo", 404);
    return NextResponse.json(radial);
  } catch (e) {
    return erroDeInfra("confronto/atomo", e);
  }
}
