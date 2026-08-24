import { NextResponse } from "next/server";
import { chaveTranscricao } from "@/lib/chaves";
import { carregarManifest } from "@/lib/manifest";
import { transcricaoParcial } from "@/lib/pipeline";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import { erro, parametros } from "@/lib/rotas";
import type { Transcricao } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sessoes/:id — estado + transcrição (parcial enquanto processa).
 * É o que o front busca de 2 em 2 segundos.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const sessao = await buscarSessao(p.id);
  if (!sessao) return erro("sessão não encontrada", 404);

  const manifest = await carregarManifest(p.id);
  const base = {
    id: sessao.id,
    status: sessao.status,
    iniciada_em: sessao.iniciada_em,
    duracao_s: sessao.duracao_s,
    chunks_total: manifest.chunks.length,
    chunks_transcritos: manifest.chunks.filter((c) => c.transcrito).length,
    proximo_chunk: manifest.chunks.reduce((max, c) => Math.max(max, c.i + 1), 0),
  };

  if (sessao.status === "transcrito") {
    const pronta = await getJson<Transcricao>(chaveTranscricao(p.id));
    if (pronta) {
      return NextResponse.json({
        ...base,
        completa: true,
        texto: pronta.valor.texto,
        blocos: pronta.valor.blocos,
      });
    }
  }

  const parcial = await transcricaoParcial(p.id);
  return NextResponse.json({ ...base, completa: false, texto: parcial.texto });
}
