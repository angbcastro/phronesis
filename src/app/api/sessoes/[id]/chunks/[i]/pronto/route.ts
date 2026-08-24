import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { chaveChunkAudio } from "@/lib/chaves";
import { atualizarManifest, registrarChunk } from "@/lib/manifest";
import { existe } from "@/lib/r2";
import { transcreverBloco } from "@/lib/pipeline";
import { atualizarSessao } from "@/lib/sessoes";
import { erro, parametros } from "@/lib/rotas";
import { DURACAO_CHUNK_S } from "@/lib/tipos";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/sessoes/:id/chunks/:i/pronto
 *
 * O cliente avisa que o PUT no R2 confirmou. Atualizamos o manifest e
 * disparamos a transcrição do bloco em `waitUntil` — o cliente não espera
 * pelo STT, ele volta a gravar.
 *
 * Idempotente por (sessao_id, i): reenviar o mesmo bloco não duplica
 * entrada no manifest nem retranscreve o que já está pronto.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; i: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id, i } = p;

  const objeto = await existe(chaveChunkAudio(id, i));
  if (!objeto) return erro("bloco não encontrado no R2", 409);

  const manifest = await atualizarManifest(id, (m) =>
    registrarChunk(m, { i, bytes: objeto.bytes, subido_em: new Date().toISOString() }),
  );

  await atualizarSessao(
    id,
    {
      chunks_total: manifest.chunks.length,
      duracao_s: manifest.chunks.length * DURACAO_CHUNK_S,
    },
    ["gravando", "abandonada"],
  );

  waitUntil(
    transcreverBloco(id, i).catch((e) => {
      console.error(`[stt] sessão ${id} bloco ${i} falhou:`, e);
    }),
  );

  return NextResponse.json({ ok: true, chunks_total: manifest.chunks.length });
}
