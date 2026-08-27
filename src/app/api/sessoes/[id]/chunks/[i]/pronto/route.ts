import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { EXT_GRAVACAO, extensaoAceita } from "@/lib/audio";
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
 * Corpo opcional `{ ext, duracao_s }`, para o arquivo importado: o formato
 * onde o áudio está no R2 e a duração real do arquivo. A gravação não manda
 * nenhum dos dois — lá o bloco é `.webm` e a duração sai da contagem.
 *
 * Idempotente por (sessao_id, i): reenviar o mesmo bloco não duplica
 * entrada no manifest nem retranscreve o que já está pronto.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; i: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id, i } = p;

  const corpo = (await req.json().catch(() => ({}))) as { ext?: string; duracao_s?: number };
  const ext = corpo.ext ?? EXT_GRAVACAO;
  if (!extensaoAceita(ext)) return erro(`formato de áudio não aceito: ${ext}`, 415);

  const objeto = await existe(chaveChunkAudio(id, i, ext));
  if (!objeto) return erro("bloco não encontrado no R2", 409);

  const manifest = await atualizarManifest(id, (m) =>
    registrarChunk(m, {
      i,
      bytes: objeto.bytes,
      subido_em: new Date().toISOString(),
      // Só grava o campo quando não é o padrão: manifest de gravação
      // continua byte a byte igual ao que a slice 1 escrevia.
      ...(ext === EXT_GRAVACAO ? {} : { ext }),
    }),
  );

  // Arquivo importado é um bloco só, de duração arbitrária — a conta por
  // contagem de blocos diria 30 s para um diário de 15 min.
  const duracao_s =
    typeof corpo.duracao_s === "number" && corpo.duracao_s > 0
      ? Math.round(corpo.duracao_s)
      : manifest.chunks.length * DURACAO_CHUNK_S;

  await atualizarSessao(id, { chunks_total: manifest.chunks.length, duracao_s }, [
    "gravando",
    "abandonada",
  ]);

  waitUntil(
    transcreverBloco(id, i).catch((e) => {
      console.error(`[stt] sessão ${id} bloco ${i} falhou:`, e);
    }),
  );

  return NextResponse.json({ ok: true, chunks_total: manifest.chunks.length });
}
