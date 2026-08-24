import { NextResponse } from "next/server";
import { sessoesAbertas } from "@/lib/sessoes";
import { carregarManifest, duracaoEstimadaS, proximoIndice } from "@/lib/manifest";
import { foiAbandonada } from "@/lib/estados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sessoes/abertas — alimenta o chip de recuperação da home.
 * A duração vem do manifest, não do nó: é ela que aparece no chip.
 */
export async function GET() {
  const sessoes = await sessoesAbertas();

  const abertas = await Promise.all(
    sessoes.map(async (s) => {
      const m = await carregarManifest(s.id);
      const ultimo = m.chunks.at(-1)?.subido_em ?? null;
      return {
        id: s.id,
        iniciada_em: s.iniciada_em,
        status: foiAbandonada(s.status, ultimo) ? ("abandonada" as const) : s.status,
        duracao_s: Math.max(s.duracao_s, duracaoEstimadaS(m)),
        chunks_total: m.chunks.length,
        proximo_chunk: proximoIndice(m),
      };
    }),
  );

  return NextResponse.json({ sessoes: abertas.filter((s) => s.chunks_total > 0) });
}
