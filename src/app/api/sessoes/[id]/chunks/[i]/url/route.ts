import { NextResponse } from "next/server";
import { chaveChunkAudio } from "@/lib/chaves";
import { urlPresignadaPut, VALIDADE_PRESIGN_S } from "@/lib/r2";
import { parametros } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/sessoes/:id/chunks/:i/url
 *
 * Devolve uma presigned PUT de 5 minutos, uma por bloco. O áudio nunca
 * passa por esta function (regra 1).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; i: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const { url, expira_em } = await urlPresignadaPut(
    chaveChunkAudio(p.id, p.i),
    VALIDADE_PRESIGN_S,
  );

  return NextResponse.json({ url, expira_em });
}
