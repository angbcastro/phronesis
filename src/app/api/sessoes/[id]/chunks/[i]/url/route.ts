import { NextResponse } from "next/server";
import { EXT_GRAVACAO, extensaoAceita } from "@/lib/audio";
import { chaveChunkAudio } from "@/lib/chaves";
import { urlPresignadaPut, VALIDADE_PRESIGN_S } from "@/lib/r2";
import { erro, parametros } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/sessoes/:id/chunks/:i/url
 *
 * Devolve uma presigned PUT de 5 minutos, uma por bloco. O áudio nunca
 * passa por esta function (regra 1).
 *
 * Corpo opcional `{ ext }`: o formato do arquivo importado. Sem ele, a
 * chave é `.webm` — o que a gravação no navegador produz.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; i: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const corpo = (await req.json().catch(() => ({}))) as { ext?: string };
  const ext = corpo.ext ?? EXT_GRAVACAO;
  if (!extensaoAceita(ext)) return erro(`formato de áudio não aceito: ${ext}`, 415);

  const { url, expira_em } = await urlPresignadaPut(
    chaveChunkAudio(p.id, p.i, ext),
    VALIDADE_PRESIGN_S,
  );

  return NextResponse.json({ url, expira_em, ext });
}
