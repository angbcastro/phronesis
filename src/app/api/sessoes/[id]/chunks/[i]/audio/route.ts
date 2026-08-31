import { NextResponse } from "next/server";
import { chaveChunkAudio } from "@/lib/chaves";
import { carregarManifest, extensaoDoChunk } from "@/lib/manifest";
import { existe, urlPresignadaGet } from "@/lib/r2";
import { erro, parametros } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * GET /api/sessoes/:id/chunks/:i/audio — presigned GET do bloco, para o player
 * da revisão.
 *
 * O áudio não passa por function nem na volta (regra 1): esta rota só assina, e
 * o navegador busca os bytes direto no R2. A extensão sai do manifest — sessão
 * importada não é `.webm`, e procurar sempre em `.webm` mataria o player dela.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; i: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const manifest = await carregarManifest(p.id);
  const key = chaveChunkAudio(p.id, p.i, extensaoDoChunk(manifest, p.i));

  // Assinar uma chave inexistente devolveria uma URL que dá 404 no R2, e o
  // <audio> falharia calado. Melhor o erro chegar aqui.
  if (!(await existe(key))) return erro(`bloco ${p.i} não está no R2`, 404);

  const { url, expira_em } = await urlPresignadaGet(key);
  return NextResponse.json({ url, expira_em });
}
